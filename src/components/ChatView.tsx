"use client";

import { Check, Copy, Download, Eraser, RefreshCw, Send, SlidersHorizontal, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorPayload, GenerationParams } from "@/types";
import { api, parseError, REQUEST_HEADERS, toPayload } from "@/lib/client/api";
import {
  downloadText,
  getConversation,
  INITIAL_PROMPT_KEY,
  newConversation,
  safeFileName,
  saveConversation,
  titleFrom,
  toMarkdown,
  type Conversation,
  type UiMessage,
} from "@/lib/client/conversations";
import { parseChunk, readSse } from "@/lib/client/sse";
import { useApp } from "./AppProvider";
import { GenerationForm } from "./GenerationForm";
import { Markdown } from "./Markdown";
import { Badge, Button, ErrorBox } from "./ui";

const uid = () => crypto.randomUUID();

export function ChatView({ id }: { id: string }) {
  const { status, config, notify } = useApp();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [params, setParams] = useState<GenerationParams | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<{ ctrl: AbortController; generationId: string } | null>(null);
  const convRef = useRef<Conversation | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  convRef.current = conv;

  // Chargement de la conversation (ou création d'une conversation vide, enregistrée au premier message).
  useEffect(() => {
    let alive = true;
    setError(null);
    getConversation(id)
      .then((c) => alive && setConv(c ?? newConversation(id)))
      .catch(() => alive && setConv(newConversation(id)));
    const prompt = sessionStorage.getItem(INITIAL_PROMPT_KEY);
    if (prompt) {
      sessionStorage.removeItem(INITIAL_PROMPT_KEY);
      setInput(prompt);
    }
    return () => {
      alive = false;
    };
  }, [id]);

  // Paramètres de génération : valeurs de la conversation par-dessus les valeurs par défaut du serveur.
  useEffect(() => {
    if (config && conv && !params) setParams({ ...config.generation, ...(conv.params ?? {}) });
  }, [config, conv, params]);
  useEffect(() => setParams(null), [id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [conv?.messages]);

  const persist = useCallback(async (c: Conversation) => {
    setConv(c);
    convRef.current = c;
    await saveConversation(c).catch(() => notify("error", "Impossible d'enregistrer la conversation dans ce navigateur."));
  }, [notify]);

  const generate = useCallback(
    async (base: Conversation, history: UiMessage[]) => {
      if (!params) return;
      setError(null);
      setGenerating(true);
      const modelName = status?.modelName ?? null;
      const assistant: UiMessage = { id: uid(), role: "assistant", content: "", createdAt: new Date().toISOString(), modelName };
      let current: Conversation = { ...base, messages: [...history, assistant], modelId: status?.modelId ?? base.modelId, modelName: modelName ?? base.modelName, params, updatedAt: new Date().toISOString() };
      setConv(current);
      const ctrl = new AbortController();
      const generationId = uid();
      abortRef.current = { ctrl, generationId };
      const update = (patch: Partial<UiMessage>) => {
        current = { ...current, messages: current.messages.map((m) => (m.id === assistant.id ? { ...m, ...patch } : m)) };
        setConv(current);
      };
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: REQUEST_HEADERS,
          signal: ctrl.signal,
          body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })), params, generationId }),
        });
        if (!res.ok) throw await parseError(res);
        if (!params.stream || !res.headers.get("content-type")?.includes("text/event-stream")) {
          const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          update({ content: j.choices?.[0]?.message?.content ?? "" });
        } else {
          let text = "";
          let sawDone = false;
          let tps: number | null = null;
          for await (const data of readSse(res.body as ReadableStream<Uint8Array>)) {
            const c = parseChunk(data);
            if (c.error) throw new Error(c.error);
            if (c.done) {
              sawDone = true;
              continue;
            }
            if (c.tokensPerSecond) tps = c.tokensPerSecond;
            if (c.delta) {
              text += c.delta;
              update({ content: text });
            }
          }
          if (!sawDone) update({ content: text, error: "La connexion avec le modèle s'est interrompue avant la fin de la réponse.", tokensPerSecond: tps });
          else update({ tokensPerSecond: tps });
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") update({ stopped: true });
        else {
          const p = toPayload(e);
          setError(p);
          // On retire l'éventuelle bulle vide : jamais de réponse simulée.
          if (!current.messages.find((m) => m.id === assistant.id)?.content) current = { ...current, messages: current.messages.filter((m) => m.id !== assistant.id) };
          else update({ error: p.message });
          setConv(current);
        }
      } finally {
        abortRef.current = null;
        setGenerating(false);
        await persist({ ...current, updatedAt: new Date().toISOString() });
      }
    },
    [params, status, persist],
  );

  async function send() {
    const text = input.trim();
    const base = convRef.current;
    if (!text || generating || !base || !params) return;
    setInput("");
    const user: UiMessage = { id: uid(), role: "user", content: text, createdAt: new Date().toISOString() };
    const history = [...base.messages.filter((m) => !m.error || m.content), user];
    const first = base.messages.length === 0;
    const next = { ...base, title: first ? titleFrom(text) : base.title };
    await persist({ ...next, messages: history });
    await generate(next, history);
  }

  async function regenerate() {
    const base = convRef.current;
    if (!base || generating) return;
    const msgs = [...base.messages];
    while (msgs.length && msgs[msgs.length - 1]?.role === "assistant") msgs.pop();
    if (!msgs.length) return;
    await generate(base, msgs);
  }

  async function stop() {
    const a = abortRef.current;
    if (!a) return;
    a.ctrl.abort();
    api("/api/chat/stop", { method: "POST", body: { generationId: a.generationId } }).catch(() => undefined);
  }

  async function clear() {
    const base = convRef.current;
    if (!base || generating || !window.confirm("Effacer tous les messages de cette conversation ?")) return;
    await persist({ ...base, messages: [], updatedAt: new Date().toISOString() });
  }

  const copy = (m: UiMessage) => {
    void navigator.clipboard.writeText(m.content);
    setCopied(m.id);
    setTimeout(() => setCopied(null), 1500);
  };

  const ready = status?.state === "running" && status.healthy;
  const messages = conv?.messages ?? [];
  const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{conv?.title ?? "…"}</h1>
          <p className="text-xs text-slate-400">
            Modèle de la conversation : {conv?.modelName ?? "—"}
            {ready && status?.modelName && conv?.modelName && conv.modelName !== status.modelName ? ` · actif maintenant : ${status.modelName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone={ready ? "ok" : status?.state === "starting" ? "warn" : "muted"}>{ready ? status?.modelName ?? "Prêt" : status?.state === "starting" ? "Chargement…" : "Aucun modèle actif"}</Badge>
          <Button variant="ghost" onClick={() => setShowSettings(!showSettings)} aria-label="Paramètres de génération"><SlidersHorizontal className="h-4 w-4" /></Button>
          <Button variant="ghost" disabled={!messages.length} onClick={() => conv && downloadText(`${safeFileName(conv.title)}.md`, toMarkdown(conv), "text/markdown")} title="Exporter en Markdown"><Download className="h-4 w-4" /> .md</Button>
          <Button variant="ghost" disabled={!messages.length} onClick={() => conv && downloadText(`${safeFileName(conv.title)}.json`, JSON.stringify(conv, null, 2), "application/json")} title="Exporter en JSON"><Download className="h-4 w-4" /> .json</Button>
          <Button variant="ghost" disabled={!messages.length || generating} onClick={() => void clear()} aria-label="Effacer la conversation"><Eraser className="h-4 w-4" /></Button>
        </div>
      </header>

      {showSettings && params && (
        <div className="border-b border-surface-border bg-surface-raised p-4">
          <GenerationForm value={params} onChange={setParams} />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <Button
              onClick={async () => {
                try {
                  await api("/api/config", { method: "PUT", body: { generation: params } });
                  notify("ok", "Enregistré comme valeurs par défaut.");
                } catch (e) {
                  setError(toPayload(e));
                }
              }}
            >
              Enregistrer par défaut
            </Button>
            <span>Contexte et threads : <Link href="/servers" className="text-accent-soft underline">Gestionnaire de serveurs</Link>.</span>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {messages.length === 0 && (
            <div className="py-16 text-center text-slate-400">
              <p className="text-lg text-slate-200">Que voulez-vous demander ?</p>
              <p className="mt-1 text-sm">{ready ? "Le modèle est prêt." : "Démarrez d'abord un modèle depuis la bibliothèque."}</p>
              {!ready && <Link href="/models" className="mt-3 inline-block text-sm text-accent-soft underline">Ouvrir la bibliothèque de modèles</Link>}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
              <div className={`max-w-[92%] rounded-2xl px-4 py-3 ${m.role === "user" ? "bg-accent/25 text-slate-50" : "border border-surface-border bg-surface-raised"}`}>
                {m.role === "assistant" && <p className="mb-1 text-xs font-medium text-slate-400">{m.modelName ?? "Assistant"}</p>}
                {m.role === "user" ? <p className="whitespace-pre-wrap break-words text-[0.95rem]">{m.content}</p> : m.content ? <Markdown text={m.content} /> : <span className="inline-flex items-center gap-2 text-sm text-slate-400"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Le modèle réfléchit…</span>}
                {m.stopped && <p className="mt-2 text-xs text-amber-300">Génération arrêtée.</p>}
                {m.error && <p className="mt-2 text-xs text-red-300">{m.error}</p>}
                {m.role === "assistant" && m.content && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
                    <button onClick={() => copy(m)} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/10">{copied === m.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copier</button>
                    {i === lastAssistantIdx && !generating && <button onClick={() => void regenerate()} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/10"><RefreshCw className="h-3 w-3" /> Régénérer</button>}
                    {m.tokensPerSecond ? <span className="ml-auto">{m.tokensPerSecond.toFixed(1)} tokens/s</span> : null}
                  </div>
                )}
              </div>
            </div>
          ))}
          <ErrorBox error={error} onClose={() => setError(null)} />
          {error?.code === "SERVER_NOT_RUNNING" && <Link href="/models" className="text-sm text-accent-soft underline">Aller à la bibliothèque de modèles</Link>}
          <div ref={bottom} />
        </div>
      </div>

      <div className="border-t border-surface-border p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Écrivez votre message… (Entrée pour envoyer, Maj+Entrée pour un saut de ligne)"
            className="max-h-48 min-h-[3rem] flex-1 resize-y rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {generating ? (
            <Button variant="danger" onClick={() => void stop()} className="h-12"><Square className="h-4 w-4" /> Arrêter</Button>
          ) : (
            <Button variant="primary" onClick={() => void send()} disabled={!input.trim() || !params} className="h-12"><Send className="h-4 w-4" /> Envoyer</Button>
          )}
        </div>
      </div>
    </div>
  );
}
