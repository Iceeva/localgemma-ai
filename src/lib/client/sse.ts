/** Lecture d'un flux SSE (Server-Sent Events) tel que renvoyé par llama.cpp (/v1/chat/completions, stream=true). */

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const sep = /\r?\n\r?\n/;
  const dataOf = (block: string): string =>
    block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const m = sep.exec(buf);
        if (!m) break;
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const data = dataOf(block);
        if (data) yield data;
      }
    }
    buf += decoder.decode();
    const rest = dataOf(buf);
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

export interface ParsedChunk {
  done: boolean;
  delta: string;
  finishReason: string | null;
  tokensPerSecond: number | null;
  error: string | null;
}

export function parseChunk(data: string): ParsedChunk {
  const out: ParsedChunk = { done: false, delta: "", finishReason: null, tokensPerSecond: null, error: null };
  if (data.trim() === "[DONE]") return { ...out, done: true };
  try {
    const j = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string | null }; finish_reason?: string | null }>;
      timings?: { predicted_per_second?: number };
      error?: { message?: string } | string;
    };
    if (j.error) out.error = typeof j.error === "string" ? j.error : (j.error.message ?? "Erreur du serveur");
    const choice = j.choices?.[0];
    out.delta = choice?.delta?.content ?? choice?.message?.content ?? "";
    out.finishReason = choice?.finish_reason ?? null;
    out.tokensPerSecond = j.timings?.predicted_per_second ?? null;
  } catch {
    /* ligne non JSON (commentaire, keep-alive) : ignorée */
  }
  return out;
}
