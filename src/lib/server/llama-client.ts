import type { ChatMessage, GenerationParams, ServerSettings } from "@/types";
import { AppError } from "./errors";

export type FetchFn = typeof fetch;

export function baseUrl(s: Pick<ServerSettings, "host" | "port">): string {
  const host = s.host === "::1" ? "[::1]" : s.host;
  return `http://${host}:${s.port}`;
}

export async function fetchWithTimeout(fetchFn: FetchFn, url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Interroge /health de llama-server (200 = prêt, 503 = modèle en cours de chargement). */
export async function checkHealth(base: string, fetchFn: FetchFn = fetch, timeoutMs = 2000): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchWithTimeout(fetchFn, `${base}/health`, timeoutMs);
    if (res.ok) return { ok: true, detail: "Le serveur répond." };
    if (res.status === 503) return { ok: false, detail: "Le modèle est en cours de chargement." };
    return { ok: false, detail: `Réponse inattendue du serveur (HTTP ${res.status}).` };
  } catch {
    return { ok: false, detail: "Le serveur ne répond pas." };
  }
}

export function buildChatPayload(messages: ChatMessage[], params: GenerationParams): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    messages: params.systemPrompt.trim() ? [{ role: "system", content: params.systemPrompt }, ...messages.filter((m) => m.role !== "system")] : messages,
    temperature: params.temperature,
    top_p: params.topP,
    max_tokens: params.maxTokens,
    stream: params.stream,
  };
  if (params.topK > 0) payload.top_k = params.topK;
  return payload;
}

export function validateChatMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 500) {
    throw new AppError("VALIDATION", "La conversation envoyée est vide ou trop longue.", "Envoyez au moins un message.");
  }
  if (input.reduce((n, m) => n + (typeof (m as { content?: unknown })?.content === "string" ? (m as { content: string }).content.length : 0), 0) > 600_000) {
    throw new AppError("VALIDATION", "La conversation est trop volumineuse.", "Effacez la conversation ou joignez moins de documents.");
  }
  return input.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    if ((r.role !== "user" && r.role !== "assistant" && r.role !== "system") || typeof r.content !== "string") {
      throw new AppError("VALIDATION", "Un message de la conversation est invalide.", "Rechargez la page et réessayez.");
    }
    return { role: r.role, content: r.content };
  });
}

export function mapUpstreamError(status: number, bodyText: string): AppError {
  let message = bodyText.slice(0, 500);
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } | string };
    message = typeof j.error === "string" ? j.error : (j.error?.message ?? message);
  } catch {
    /* corps non JSON */
  }
  if (/exceeds the available context size|context size|n_ctx|too many tokens/i.test(message)) {
    return new AppError(
      "CONTEXT_EXCEEDED",
      "La conversation dépasse la taille de contexte du modèle.",
      "Effacez ou raccourcissez la conversation, ou augmentez la taille du contexte dans « Gestionnaire de serveurs » (puis redémarrez le modèle).",
      413,
      { status, message },
    );
  }
  if (status === 503) {
    return new AppError("SERVER_BUSY", "Le serveur est occupé ou charge encore le modèle.", "Patientez quelques secondes puis réessayez.", 503, { status, message });
  }
  return new AppError("CHAT_UPSTREAM_ERROR", `Le serveur llama.cpp a renvoyé une erreur (HTTP ${status}).`, "Consultez les journaux du serveur ; essayez de redémarrer le modèle.", 502, { status, message });
}

/** Ouvre la requête de chat vers llama-server. Lève une AppError explicite en cas d'échec. */
export async function openChat(opts: {
  base: string;
  messages: ChatMessage[];
  params: GenerationParams;
  signal?: AbortSignal;
  fetchFn?: FetchFn;
}): Promise<Response> {
  const fetchFn = opts.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(`${opts.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: opts.params.stream ? "text/event-stream" : "application/json" },
      body: JSON.stringify(buildChatPayload(opts.messages, opts.params)),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new AppError("SERVER_UNREACHABLE", "Impossible de joindre le serveur llama.cpp.", "Vérifiez qu'un modèle est démarré dans « Gestionnaire de serveurs ».", 502);
  }
  if (!res.ok) throw mapUpstreamError(res.status, await res.text().catch(() => ""));
  return res;
}

/** Relaie un flux en appelant onEnd exactement une fois (fin normale, erreur ou annulation du client). */
export function relayStream(body: ReadableStream<Uint8Array>, onEnd: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let ended = false;
  const end = () => {
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          end();
          controller.close();
        } else if (value) controller.enqueue(value);
      } catch {
        end();
        try {
          controller.close();
        } catch {
          /* déjà fermé */
        }
      }
    },
    cancel(reason) {
      end();
      return reader.cancel(reason).catch(() => undefined);
    },
  });
}

const g = globalThis as unknown as { __lgGenerations?: Map<string, AbortController> };
const generations = (): Map<string, AbortController> => (g.__lgGenerations ??= new Map());

export function registerGeneration(id: string, ctrl: AbortController): void {
  generations().set(id, ctrl);
}
export function finishGeneration(id: string): void {
  generations().delete(id);
}
export function stopGeneration(id: string): boolean {
  const c = generations().get(id);
  if (!c) return false;
  c.abort();
  generations().delete(id);
  return true;
}
