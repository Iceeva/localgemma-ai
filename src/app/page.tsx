"use client";

import { Cpu, Library, Play, Square, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useServerActions } from "@/components/ServerActions";
import { Badge, Button, Card, ErrorBox, statusTone } from "@/components/ui";
import { api } from "@/lib/client/api";
import { INITIAL_PROMPT_KEY } from "@/lib/client/conversations";
import { formatBytes, formatDate } from "@/lib/client/format";
import type { ModelView } from "@/types";

const SUGGESTIONS = [
  "Explique-moi le fonctionnement d'un modèle de langage en termes simples.",
  "Écris une fonction TypeScript qui supprime les doublons d'un tableau.",
  "Donne-moi un plan d'étude de 4 semaines pour apprendre l'anglais.",
  "Rédige un e-mail poli pour demander un délai supplémentaire.",
];

export default function HomePage() {
  const { status, config } = useApp();
  const router = useRouter();
  const actions = useServerActions();
  const [models, setModels] = useState<ModelView[]>([]);

  useEffect(() => {
    api<{ models: ModelView[] }>("/api/models")
      .then((r) => setModels(r.models))
      .catch(() => setModels([]));
  }, [status?.state, status?.modelId]);

  const selected = models.find((m) => m.id === config?.selectedModelId) ?? null;
  const running = status?.state === "running";
  const busy = actions.busy !== null || status?.state === "starting" || status?.state === "stopping";
  const recent = [...models].filter((m) => m.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "")).slice(0, 3);

  function startChat(prompt?: string) {
    if (prompt) sessionStorage.setItem(INITIAL_PROMPT_KEY, prompt);
    router.push(`/chat/${crypto.randomUUID()}`);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Bienvenue sur LocalGemma AI</h1>
        <p className="mt-2 text-slate-400">Discutez avec des modèles d'IA qui tournent entièrement sur votre ordinateur : aucune clé API, aucun cloud.</p>
      </div>

      <Card title="Mon IA locale">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Modèle sélectionné</p>
            <p className="mt-1 flex items-center gap-2 text-lg font-medium">
              <Cpu className="h-5 w-5 text-accent-soft" />
              {selected ? selected.name : "Aucun modèle sélectionné"}
            </p>
            {selected && <p className="mt-0.5 text-xs text-slate-400">{[selected.architecture, selected.quantization, formatBytes(selected.sizeBytes)].filter(Boolean).join(" · ")}</p>}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Serveur local</p>
            <p className="mt-1 flex items-center gap-2">
              <Badge tone={statusTone(status?.state ?? "stopped")}>
                {{ running: "En marche", starting: "Chargement…", stopping: "Arrêt…", error: "Erreur", stopped: "Arrêté" }[status?.state ?? "stopped"]}
              </Badge>
              {status && <span className="text-xs text-slate-400">{status.host}:{status.port}</span>}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/setup">
            <Button variant="secondary"><Wrench className="h-4 w-4" /> Configurer mon IA locale</Button>
          </Link>
          <Link href="/models">
            <Button variant="secondary"><Library className="h-4 w-4" /> Choisir un modèle</Button>
          </Link>
          {running || status?.state === "stopping" ? (
            <Button variant="danger" onClick={() => void actions.stop()} loading={actions.busy === "stop"} disabled={busy && actions.busy !== "stop"}>
              <Square className="h-4 w-4" /> Arrêter le modèle
            </Button>
          ) : (
            <Button variant="primary" onClick={() => selected && void actions.start(selected.id)} loading={actions.busy === "start" || status?.state === "starting"} disabled={!selected || busy} title={selected ? undefined : "Choisissez d'abord un modèle"}>
              <Play className="h-4 w-4" /> Démarrer le modèle
            </Button>
          )}
        </div>
        {actions.busy === "start" && <p className="mt-3 text-sm text-slate-400">Chargement du modèle en mémoire… cela peut prendre une à plusieurs minutes sur un PC modeste.</p>}
        <div className="mt-4">
          <ErrorBox error={actions.error ?? (status?.state === "error" ? status.error : null)} onClose={actions.clearError} />
        </div>
      </Card>

      {recent.length > 0 && (
        <Card title="Modèles récemment utilisés">
          <ul className="divide-y divide-surface-border text-sm">
            {recent.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="text-xs text-slate-400">Dernière utilisation : {formatDate(m.lastUsedAt)}</p>
                </div>
                <Badge tone={statusTone(m.status)}>{{ active: "actif", stopped: "arrêté", missing: "introuvable", error: "erreur", starting: "démarrage" }[m.status]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Pour commencer" subtitle="Cliquez sur une suggestion pour ouvrir une nouvelle conversation.">
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => startChat(s)} className="rounded-lg border border-surface-border bg-surface p-3 text-left text-sm text-slate-200 hover:border-accent/60">
              {s}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <Button variant="primary" onClick={() => startChat()}>Nouvelle conversation</Button>
        </div>
      </Card>
    </div>
  );
}
