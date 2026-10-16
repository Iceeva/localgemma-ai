import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { parseChunk, readSse } from "@/lib/client/sse";
import { buildChatPayload, finishGeneration, mapUpstreamError, openChat, registerGeneration, relayStream, stopGeneration, validateChatMessages } from "@/lib/server/llama-client";
import { DEFAULT_GENERATION } from "@/lib/server/validators";
import { sleep } from "./helpers";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}
const enc = new TextEncoder();

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of readSse(stream)) out.push(d);
  return out;
}

describe("traitement du streaming SSE", () => {
  it("reconstitue les événements même découpés n'importe où", async () => {
    const raw = 'data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n';
    const bytes = enc.encode(raw);
    const chunks = Array.from(bytes, (b) => new Uint8Array([b])); // octet par octet
    expect(await collect(streamOf(chunks))).toEqual(['{"a":1}', '{"a":2}', "[DONE]"]);
  });

  it("gère les caractères UTF-8 multi-octets coupés entre deux morceaux", async () => {
    const bytes = enc.encode('data: {"choices":[{"delta":{"content":"é à 日本"}}]}\n\n');
    const mid = bytes.indexOf(0xc3) + 1; // coupe au milieu de « é »
    const events = await collect(streamOf([bytes.slice(0, mid), bytes.slice(mid)]));
    expect(parseChunk(events[0]!).delta).toBe("é à 日本");
  });

  it("accepte les fins de ligne CRLF et un dernier événement sans ligne vide", async () => {
    expect(await collect(streamOf([enc.encode("data: un\r\n\r\ndata: deux")]))).toEqual(["un", "deux"]);
  });

  it("interprète les morceaux llama.cpp (delta, fin, vitesse, erreur)", () => {
    expect(parseChunk('{"choices":[{"delta":{"content":"Bon"}}]}')).toMatchObject({ delta: "Bon", done: false });
    expect(parseChunk('{"choices":[{"delta":{},"finish_reason":"stop"}],"timings":{"predicted_per_second":4.2}}')).toMatchObject({
      finishReason: "stop",
      tokensPerSecond: 4.2,
    });
    expect(parseChunk("[DONE]").done).toBe(true);
    expect(parseChunk('{"error":{"message":"oups"}}').error).toBe("oups");
    expect(parseChunk(": keep-alive").delta).toBe("");
  });
});

describe("transmission de la conversation à llama.cpp", () => {
  const servers: http.Server[] = [];
  afterEach(() => servers.splice(0).forEach((s) => s.close()));

  async function serve(handler: http.RequestListener): Promise<string> {
    const srv = http.createServer(handler);
    servers.push(srv);
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  }

  it("construit la requête : prompt système en tête, top_k omis à 0", () => {
    const p = buildChatPayload([{ role: "user", content: "Salut" }], { ...DEFAULT_GENERATION, systemPrompt: "Sois bref", topK: 0, maxTokens: 64 });
    expect(p.messages).toEqual([
      { role: "system", content: "Sois bref" },
      { role: "user", content: "Salut" },
    ]);
    expect(p).toMatchObject({ max_tokens: 64, stream: true, temperature: DEFAULT_GENERATION.temperature });
    expect("top_k" in p).toBe(false);
    expect(buildChatPayload([], { ...DEFAULT_GENERATION, topK: 20 }).top_k).toBe(20);
  });

  it("valide les messages reçus du navigateur", () => {
    expect(() => validateChatMessages([])).toThrow();
    expect(() => validateChatMessages([{ role: "root", content: "x" }])).toThrow();
    expect(() => validateChatMessages([{ role: "user", content: 5 }])).toThrow();
    expect(validateChatMessages([{ role: "user", content: "ok", extra: 1 }])).toEqual([{ role: "user", content: "ok" }]);
  });

  it("envoie la conversation complète et relaie le flux", async () => {
    let received: { messages: Array<{ role: string; content: string }>; stream: boolean } | undefined;
    const base = await serve((req, res) => {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        received = JSON.parse(raw);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"choices":[{"delta":{"content":"Bon"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"jour"}}]}\n\n');
        res.end("data: [DONE]\n\n");
      });
    });
    const res = await openChat({
      base,
      messages: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "R1" },
        { role: "user", content: "Q2" },
      ],
      params: DEFAULT_GENERATION,
    });
    let ended = 0;
    const text: string[] = [];
    for await (const d of readSse(relayStream(res.body!, () => ended++))) {
      const c = parseChunk(d);
      if (!c.done) text.push(c.delta); // on lit jusqu'à la fin réelle du flux
    }
    expect(text.join("")).toBe("Bonjour");
    expect(received?.messages.map((m) => m.content)).toEqual([DEFAULT_GENERATION.systemPrompt, "Q1", "R1", "Q2"]);
    expect(received?.stream).toBe(true);
    expect(ended).toBe(1);
  });

  it("traduit les erreurs HTTP en messages actionnables", async () => {
    const mk = (status: number, body: string) => serve((_q, r) => void r.writeHead(status, { "Content-Type": "application/json" }).end(body));
    await expect(openChat({ base: await mk(400, '{"error":{"message":"the request exceeds the available context size"}}'), messages: [{ role: "user", content: "x" }], params: DEFAULT_GENERATION })).rejects.toMatchObject({ code: "CONTEXT_EXCEEDED" });
    await expect(openChat({ base: await mk(503, '{"error":{"message":"Loading model"}}'), messages: [{ role: "user", content: "x" }], params: DEFAULT_GENERATION })).rejects.toMatchObject({ code: "SERVER_BUSY" });
    await expect(openChat({ base: await mk(500, "boum"), messages: [{ role: "user", content: "x" }], params: DEFAULT_GENERATION })).rejects.toMatchObject({ code: "CHAT_UPSTREAM_ERROR" });
    expect(mapUpstreamError(500, "x").hint).toBeTruthy();
  });

  it("détecte un serveur indisponible", async () => {
    const srv = http.createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as AddressInfo).port;
    await new Promise((r) => srv.close(r)); // port libéré : plus personne n'écoute
    await expect(openChat({ base: `http://127.0.0.1:${port}`, messages: [{ role: "user", content: "x" }], params: DEFAULT_GENERATION })).rejects.toMatchObject({ code: "SERVER_UNREACHABLE" });
  });

  it("interrompt la génération côté llama.cpp quand on l'arrête", async () => {
    let closedUpstream = false;
    const base = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
      res.on("close", () => (closedUpstream = true));
    });
    const ctrl = new AbortController();
    registerGeneration("gen-1", ctrl);
    const res = await openChat({ base, messages: [{ role: "user", content: "x" }], params: DEFAULT_GENERATION, signal: ctrl.signal });
    const reader = relayStream(res.body!, () => finishGeneration("gen-1")).getReader();
    await reader.read();
    expect(stopGeneration("gen-1")).toBe(true);
    await reader.read().catch(() => undefined);
    await sleep(100);
    expect(closedUpstream).toBe(true);
    expect(stopGeneration("gen-1")).toBe(false); // déjà arrêtée
  });
});
