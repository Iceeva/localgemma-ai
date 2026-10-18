"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ErrorPayload, MemorySettings } from "@/types";
import { api, toPayload } from "@/lib/client/api";
import { useApp } from "./AppProvider";
import { Button, Card, ErrorBox, inputClass } from "./ui";

export function MemoryCard() {
  const { refreshConfig } = useApp();
  const [mem, setMem] = useState<MemorySettings | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const load = useCallback(async () => {
    try {
      setMem(await api<MemorySettings>("/api/memory"));
    } catch (e) {
      setError(toPayload(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toPayload(e));
    } finally {
      await Promise.all([load(), refreshConfig()]);
    }
  }
  const add = () => run(async () => {
    await api("/api/memory", { method: "POST", body: { text } });
    setText("");
  });
  const edit = (id: string, old: string) => run(async () => {
    const t = window.prompt("Modifier la note :", old);
    if (t !== null) await api(`/api/memory/${id}`, { method: "PATCH", body: { text: t } });
  });
  const remove = (id: string) => run(() => api(`/api/memory/${id}`, { method: "DELETE" }));
  const toggle = (enabled: boolean) => run(() => api("/api/memory", { method: "PUT", body: { enabled } }));

  return (
    <Card title="Mémoire locale" subtitle="Informations que le modèle doit garder en tête dans toutes vos conversations (stockées uniquement sur cet ordinateur).">
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={mem?.enabled ?? true} onChange={(e) => void toggle(e.target.checked)} /> Utiliser la mémoire dans les conversations
      </label>
      <div className="flex gap-2">
        <input className={inputClass} placeholder="Ex. Je m'appelle Ice, je suis développeur et je préfère les réponses courtes." value={text} maxLength={300} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && void add()} />
        <Button variant="primary" onClick={() => void add()} disabled={text.trim().length < 2}><Plus className="h-4 w-4" /> Ajouter</Button>
      </div>
      <div className="mt-3"><ErrorBox error={error} onClose={() => setError(null)} /></div>
      <ul className="mt-3 divide-y divide-surface-border text-sm">
        {(mem?.notes ?? []).map((n) => (
          <li key={n.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 break-words">{n.text}</span>
            <span className="flex shrink-0 gap-1">
              <Button variant="ghost" onClick={() => void edit(n.id, n.text)} aria-label="Modifier"><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" onClick={() => void remove(n.id)} aria-label="Supprimer"><Trash2 className="h-4 w-4" /></Button>
            </span>
          </li>
        ))}
        {mem && mem.notes.length === 0 && <li className="py-2 text-slate-400">Aucune note. Vous pouvez aussi écrire « Retiens que … » dans une conversation.</li>}
      </ul>
      <p className="mt-3 text-xs text-slate-500">Chaque note consomme un peu de contexte. N'enregistrez pas de mots de passe ni de données sensibles. 50 notes maximum.</p>
    </Card>
  );
}
