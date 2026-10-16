import { handler } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { AppError } from "@/lib/server/errors";
import { baseUrl, finishGeneration, openChat, registerGeneration, relayStream, validateChatMessages } from "@/lib/server/llama-client";
import { getManager } from "@/lib/server/process-manager";
import { validateGenerationParams } from "@/lib/server/validators";
import { readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

/** Relaie la conversation à llama-server. Aucune réponse n'est jamais simulée : sans serveur, une erreur explicite est renvoyée. */
export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const messages = validateChatMessages(body.messages);
  const store = getConfigStore();
  const cfg = await store.read();
  const params = validateGenerationParams((body.params ?? {}) as never, cfg.generation);
  const generationId = typeof body.generationId === "string" && body.generationId.length <= 64 ? body.generationId : crypto.randomUUID();

  const manager = getManager();
  const status = await manager.getStatus();
  if (status.state !== "running" || !status.healthy) {
    throw new AppError(
      "SERVER_NOT_RUNNING",
      status.state === "starting" ? "Le modèle est encore en cours de chargement." : "Aucun modèle n'est démarré (ou le serveur ne répond plus).",
      "Démarrez un modèle depuis la bibliothèque ou le gestionnaire de serveurs, puis réessayez.",
      409,
    );
  }

  const controller = new AbortController();
  registerGeneration(generationId, controller);
  req.signal.addEventListener("abort", () => controller.abort());
  let upstream: Response;
  try {
    upstream = await openChat({ base: baseUrl({ host: status.host, port: status.port }), messages, params, signal: controller.signal });
  } catch (e) {
    finishGeneration(generationId);
    throw e;
  }
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? (params.stream ? "text/event-stream" : "application/json"),
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
    "X-Generation-Id": generationId,
  });
  if (!upstream.body) {
    finishGeneration(generationId);
    return new Response(null, { status: 502, headers });
  }
  return new Response(relayStream(upstream.body, () => finishGeneration(generationId)), { headers });
});
