"use client";

import { FileUp, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { ModelCard } from "@/components/ModelCard";
import { useServerActions } from "@/components/ServerActions";
import { Badge, Button, ErrorBox, inputClass, PageHeader } from "@/components/ui";
import { api, pickWithDialog, toPayload } from "@/lib/client/api";
import { formatBytes, formatDate } from "@/lib/client/format";
import type { ErrorPayload, ModelView } from "@/types";

type Sort = "name" | "size" | "used";
const GB = 1024 ** 3;

export default function ModelsPage() {
  const { status, config, notify, refreshConfig, meta } = useApp();
  const actions = useServerActions();
  const [models, setModels] = useState<ModelView[]>([]);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [q, setQ] = useState("");
  const [arch, setArch] = useState("");
  const [size, setSize] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [refreshing, setRefreshing] = useState(false);
  const [details, setDetails] = useState<ModelView | null>(null);

  const load = useCallback(async () => {
    try {
      setModels((await api<{ models: ModelView[] }>("/api/models")).models);
    } catch (e) {
      setError(toPayload(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, status?.state, status?.modelId, actions.busy]);

  async function guard(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toPayload(e));
    } finally {
      await Promise.all([load(), refreshConfig()]);
    }
  }

  const refreshAll = async () => {
    setRefreshing(true);
    await guard(async () => {
      const r = await api<{ results: { added: number }[] }>("/api/models/refresh", { method: "POST" });
      notify("ok", `Actualisé : ${r.results.reduce((n, x) => n + x.added, 0)} nouveau(x) modèle(s).`);
    });
    setRefreshing(false);
  };
  const addModel = () =>
    guard(async () => {
      const r = await pickWithDialog("gguf");
      if (!r.cancelled && r.ticket) await api("/api/models", { method: "POST", body: { ticket: r.ticket } });
    });
  const relocate = (m: ModelView) =>
    guard(async () => {
      const r = await pickWithDialog("gguf");
      if (!r.cancelled && r.ticket) await api(`/api/models/${m.id}/relocate`, { method: "POST", body: { ticket: r.ticket } });
    });
  const remove = (m: ModelView) =>
    guard(async () => {
      if (!window.confirm(`Retirer « ${m.name} » de la bibliothèque ?\n\nLe fichier GGUF reste sur votre disque, intact.`)) return;
      await api(`/api/models/${m.id}`, { method: "DELETE" });
    });
  const select = (m: ModelView) => guard(async () => void (await api(`/api/models/${m.id}/select`, { method: "POST" })));

  const archs = useMemo(() => [...new Set(models.map((m) => m.architecture).filter((a): a is string => !!a))].sort(), [models]);
  const shown = useMemo(() => {
    const f = models.filter((m) => {
      if (q && !`${m.name} ${m.fileName}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (arch && m.architecture !== arch) return false;
      const s = m.sizeBytes ?? 0;
      if (size === "small" && s >= 2 * GB) return false;
      if (size === "medium" && (s < 2 * GB || s > 5 * GB)) return false;
      if (size === "large" && s <= 5 * GB) return false;
      return true;
    });
    return f.sort((a, b) => (sort === "size" ? (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) : sort === "used" ? (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") : a.name.localeCompare(b.name)));
  }, [models, q, arch, size, sort]);

  const starting = status?.state === "starting" || status?.state === "stopping";
  const busy = actions.busy !== null || starting;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 md:p-10">
      <PageHeader
        title="Bibliothèque de modèles"
        subtitle="Un modèle présent ici n'est pas chargé en mémoire : il l'est seulement quand vous le démarrez (un seul à la fois)."
        actions={
          <>
            <Button onClick={() => void refreshAll()} loading={refreshing}><RefreshCw className="h-4 w-4" /> Actualiser les dossiers</Button>
            <Button variant="primary" onClick={() => void addModel()} disabled={meta !== null && !meta.dialogsAvailable}><FileUp className="h-4 w-4" /> Ajouter un modèle GGUF</Button>
          </>
        }
      />
      <ErrorBox error={error ?? actions.error} onClose={() => { setError(null); actions.clearError(); }} />
      {actions.busy === "start" && <p className="text-sm text-slate-400">Chargement en cours… patientez jusqu'à la confirmation que l'API répond.</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input className={`${inputClass} pl-9`} placeholder="Rechercher par nom…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={inputClass} value={arch} onChange={(e) => setArch(e.target.value)} aria-label="Architecture">
          <option value="">Toutes les architectures</option>
          {archs.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select className={inputClass} value={size} onChange={(e) => setSize(e.target.value)} aria-label="Taille">
          <option value="">Toutes les tailles</option>
          <option value="small">Moins de 2 Go</option>
          <option value="medium">2 à 5 Go</option>
          <option value="large">Plus de 5 Go</option>
        </select>
        <select className={inputClass} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Tri">
          <option value="name">Tri : alphabétique</option>
          <option value="size">Tri : taille</option>
          <option value="used">Tri : dernière utilisation</option>
        </select>
      </div>

      {models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surface-border p-10 text-center text-slate-400">
          Aucun modèle pour l'instant. Ajoutez un dossier ou un fichier GGUF dans « Configuration locale » ou avec le bouton ci-dessus.
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-400">Aucun modèle ne correspond à ces filtres.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              status={status}
              selected={config?.selectedModelId === m.id}
              busy={busy}
              busyThis={actions.busyModelId === m.id}
              onStart={() => void actions.start(m.id)}
              onStop={() => void actions.stop()}
              onSelect={() => void select(m)}
              onDetails={() => setDetails(m)}
              onRemove={() => void remove(m)}
              onRelocate={() => void relocate(m)}
            />
          ))}
        </div>
      )}

      {details && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetails(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-surface-border bg-surface-raised p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{details.name}</h2>
            <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Fichier</dt><dd className="break-all">{details.path}</dd>
              <dt className="text-slate-500">Trouvé</dt><dd>{details.fileCheck.exists ? "Oui" : "Non"}</dd>
              <dt className="text-slate-500">Accès en lecture</dt><dd>{details.fileCheck.readable ? "Oui" : "Non"}</dd>
              <dt className="text-slate-500">Taille</dt><dd>{formatBytes(details.sizeBytes)}</dd>
              <dt className="text-slate-500">Extension</dt><dd>{details.fileCheck.extension || "—"}</dd>
              <dt className="text-slate-500">Modifié le</dt><dd>{formatDate(details.fileCheck.modifiedAt)}</dd>
              <dt className="text-slate-500">Architecture</dt><dd>{details.architecture ?? "—"}</dd>
              <dt className="text-slate-500">Quantification</dt><dd>{details.quantization ?? "—"}</dd>
              <dt className="text-slate-500">Contexte max annoncé</dt><dd>{details.contextLength ?? "—"}</dd>
              <dt className="text-slate-500">Origine</dt><dd>{details.source === "folder" ? "Dossier analysé" : "Fichier ajouté à la main"}</dd>
              <dt className="text-slate-500">Ajouté le</dt><dd>{formatDate(details.addedAt)}</dd>
            </dl>
            <p className="mt-4"><Badge tone="muted">La compatibilité complète n'est confirmée qu'au chargement du modèle.</Badge></p>
            <div className="mt-5 text-right"><Button onClick={() => setDetails(null)}>Fermer</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
