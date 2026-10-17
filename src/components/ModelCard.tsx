"use client";

import { FileSearch, Info, MessageSquare, Play, Repeat, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ModelView, ServerStatus } from "@/types";
import { formatBytes, formatDate } from "@/lib/client/format";
import { Badge, Button, ErrorBox, statusTone } from "./ui";

const LABEL = { active: "Actif", stopped: "Arrêté", missing: "Introuvable", error: "Erreur", starting: "Démarrage…" } as const;

export function ModelCard(props: {
  model: ModelView;
  status: ServerStatus | null;
  selected: boolean;
  busy: boolean;
  busyThis: boolean;
  onStart: () => void;
  onStop: () => void;
  onSelect: () => void;
  onDetails: () => void;
  onRemove: () => void;
  onRelocate: () => void;
}) {
  const router = useRouter();
  const { model: m, status, selected, busy, busyThis } = props;
  const anotherRunning = status?.state === "running" && status.modelId !== m.id;
  const missing = m.status === "missing";
  return (
    <div className={`flex flex-col rounded-xl border bg-surface-raised p-4 ${selected ? "border-accent/70" : "border-surface-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold" title={m.name}>{m.name}</h3>
          <p className="truncate text-xs text-slate-400" title={m.fileName}>{m.fileName}</p>
        </div>
        <Badge tone={statusTone(m.status)}>{LABEL[m.status]}</Badge>
      </div>
      <p className="mt-2 break-all text-xs text-slate-500" title={m.path}>{m.path}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Taille</dt><dd>{formatBytes(m.sizeBytes)}</dd>
        <dt className="text-slate-500">Architecture</dt><dd>{m.architecture ?? "—"}</dd>
        <dt className="text-slate-500">Quantification</dt><dd>{m.quantization ? `${m.quantization}${m.quantizationSource === "filename" ? " (d'après le nom)" : ""}` : "—"}</dd>
        <dt className="text-slate-500">Dernière utilisation</dt><dd>{formatDate(m.lastUsedAt)}</dd>
      </dl>
      {m.lastError && <div className="mt-3"><ErrorBox error={m.lastError} /></div>}
      {missing && <p className="mt-3 text-xs text-red-300">Le fichier est introuvable : il a peut-être été déplacé. La référence est conservée.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {m.status === "active" ? (
          <>
            <Button variant="primary" onClick={() => router.push(`/chat/${crypto.randomUUID()}`)}><MessageSquare className="h-4 w-4" /> Discuter</Button>
            <Button variant="danger" onClick={props.onStop} disabled={busy}><Square className="h-4 w-4" /> Arrêter</Button>
          </>
        ) : missing ? (
          <Button variant="primary" onClick={props.onRelocate}><FileSearch className="h-4 w-4" /> Localiser à nouveau le fichier</Button>
        ) : anotherRunning ? (
          <Button variant="primary" onClick={props.onStart} loading={busyThis} disabled={busy && !busyThis} title="Arrête proprement le modèle actif puis démarre celui-ci">
            <Repeat className="h-4 w-4" /> Utiliser ce modèle
          </Button>
        ) : (
          <Button variant="primary" onClick={props.onStart} loading={busyThis || m.status === "starting"} disabled={busy && !busyThis}>
            <Play className="h-4 w-4" /> Démarrer
          </Button>
        )}
        {!selected && !missing && <Button onClick={props.onSelect} disabled={busy}>Sélectionner</Button>}
        <Button variant="ghost" onClick={props.onDetails}><Info className="h-4 w-4" /> Détails</Button>
        <Button variant="ghost" onClick={props.onRemove} disabled={busy || m.status === "active"} title="Retire la référence ; le fichier n'est jamais supprimé">
          <Trash2 className="h-4 w-4" /> Retirer de la bibliothèque
        </Button>
      </div>
    </div>
  );
}
