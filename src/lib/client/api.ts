import type { ErrorPayload } from "@/types";

export class ApiError extends Error {
  constructor(
    readonly payload: ErrorPayload,
    readonly status: number,
  ) {
    super(payload.message);
    this.name = "ApiError";
  }
}

export const REQUEST_HEADERS = { "Content-Type": "application/json", "x-localgemma-request": "1" } as const;

export function toPayload(err: unknown): ErrorPayload {
  if (err instanceof ApiError) return err.payload;
  if (err instanceof TypeError) {
    return { code: "NETWORK", message: "L'application LocalGemma AI ne répond pas.", hint: "Vérifiez que la fenêtre de LocalGemma AI (start.ps1) est toujours ouverte, puis rechargez la page." };
  }
  return { code: "INTERNAL", message: err instanceof Error ? err.message : "Erreur inattendue.", hint: "Réessayez." };
}

export async function parseError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { error?: ErrorPayload } | null;
  return new ApiError(data?.error ?? { code: "HTTP", message: `Erreur HTTP ${res.status}.`, hint: "Réessayez." }, res.status);
}

export async function api<T>(url: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: REQUEST_HEADERS,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: "no-store",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export interface DialogResponse {
  cancelled: boolean;
  ticket?: string;
  path?: string;
  name?: string;
}

/** Ouvre le vrai sélecteur Windows côté serveur et renvoie un ticket de sélection. */
export function pickWithDialog(kind: "engine" | "gguf" | "folder"): Promise<DialogResponse> {
  return api<DialogResponse>("/api/dialog", { method: "POST", body: { kind } });
}
