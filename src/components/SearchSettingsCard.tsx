"use client";

import { Activity, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { ErrorPayload, SearchSettings } from "@/types";
import { api, toPayload } from "@/lib/client/api";
import { useApp } from "./AppProvider";
import { Badge, Button, Card, ErrorBox, Field, inputClass } from "./ui";

export function SearchSettingsCard() {
  const { config, refreshConfig, notify } = useApp();
  const [form, setForm] = useState<SearchSettings | null>(null);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    if (config && !form) setForm(config.search);
  }, [config, form]);
  if (!form) return null;
  const fe = (error?.details ?? {}) as Record<string, string>;

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await api("/api/config", { method: "PUT", body: { search: form } });
      await refreshConfig();
      notify("ok", form?.url ? "Recherche web configurée. Activez le bouton « Recherche Web » dans une conversation." : "Recherche web désactivée : l'application reste 100 % hors ligne.");
    } catch (e) {
      setError(toPayload(e));
    } finally {
      setBusy(null);
    }
  }
  async function test() {
    setBusy("test");
    setError(null);
    setTestMsg(null);
    try {
      const r = await api<{ count: number; tookMs: number }>("/api/search/test", { method: "POST", body: { search: form } });
      setTestMsg(`✅ SearXNG répond : ${r.count} résultat(s) en ${r.tookMs} ms.`);
    } catch (e) {
      setError(toPayload(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title="Recherche Web (SearXNG)"
      subtitle="Facultatif. Sans configuration, l'application fonctionne entièrement hors ligne avec votre modèle GGUF."
      actions={<Badge tone={config?.search.url ? "warn" : "ok"}>{config?.search.url ? "Configurée" : "Hors ligne"}</Badge>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Adresse de l'instance SearXNG" hint="Laissez vide pour désactiver. Exemple : http://127.0.0.1:8888" error={fe.url}>
            <input className={inputClass} placeholder="http://127.0.0.1:8888" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </Field>
        </div>
        <Field label="Résultats transmis au modèle" hint="1 à 10. Moins = moins de contexte consommé." error={fe.maxResults}>
          <input type="number" min={1} max={10} className={inputClass} value={form.maxResults} onChange={(e) => setForm({ ...form, maxResults: Number(e.target.value) })} />
        </Field>
        <Field label="Délai d'attente (s)" error={fe.timeoutSec}>
          <input type="number" min={1} max={60} className={inputClass} value={form.timeoutSec} onChange={(e) => setForm({ ...form, timeoutSec: Number(e.target.value) })} />
        </Field>
        <Field label="Langue des résultats" hint="fr, en, fr-FR… ou all" error={fe.language}>
          <input className={inputClass} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 space-y-3">
        <ErrorBox error={error} onClose={() => setError(null)} />
        {testMsg && <p className="text-sm text-emerald-300">{testMsg}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void save()} loading={busy === "save"}><Save className="h-4 w-4" /> Enregistrer</Button>
          <Button onClick={() => void test()} loading={busy === "test"} disabled={!form.url.trim()}><Activity className="h-4 w-4" /> Tester la connexion</Button>
        </div>
      </div>
      <details className="mt-4 text-sm text-slate-300">
        <summary className="cursor-pointer text-slate-200">Comment installer SearXNG ?</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
          <li>Installez Docker Desktop, puis lancez : <code className="rounded bg-black/30 px-1">docker run -d --name searxng -p 127.0.0.1:8888:8080 searxng/searxng</code></li>
          <li>Dans le fichier <code className="rounded bg-black/30 px-1">settings.yml</code> de SearXNG, activez le format JSON : <code className="rounded bg-black/30 px-1">search: formats: [html, json]</code>, puis redémarrez le conteneur.</li>
          <li>Saisissez ici <code className="rounded bg-black/30 px-1">http://127.0.0.1:8888</code> et cliquez sur « Tester la connexion ».</li>
          <li>Dans une conversation, activez le bouton « Recherche Web » : la recherche n'est jamais lancée automatiquement.</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">Même avec une instance locale, SearXNG interroge des moteurs externes : une connexion Internet est nécessaire et vos requêtes de recherche quittent l'ordinateur. Votre modèle et vos conversations, eux, restent locaux.</p>
      </details>
    </Card>
  );
}
