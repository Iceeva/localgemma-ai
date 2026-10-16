"use client";

import { FileUp, FolderPlus, FolderOpen, RefreshCw, Trash2, FlaskConical, Save, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Badge, Button, Card, ErrorBox, PageHeader } from "@/components/ui";
import { api, pickWithDialog, toPayload } from "@/lib/client/api";
import { formatBytes, formatDate } from "@/lib/client/format";
import type { EngineCheck, ErrorPayload, FileCheck, FolderEntry, ModelView } from "@/types";

interface EngineInfo {
  path: string | null;
  version: string | null;
  configured: boolean;
  valid: boolean;
  validationError: ErrorPayload | null;
  fileCheck: FileCheck | null;
}
type FolderView = FolderEntry & { exists: boolean; modelCount: number };

export default function SetupPage() {
  const { meta, refreshConfig, refreshStatus, notify, status } = useApp();
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [pending, setPending] = useState<{ ticket: string; path: string } | null>(null);
  const [test, setTest] = useState<EngineCheck | null>(null);
  const [folders, setFolders] = useState<FolderView[]>([]);
  const [models, setModels] = useState<ModelView[]>([]);
  const [recursive, setRecursive] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, f, m] = await Promise.all([api<EngineInfo>("/api/engine"), api<{ folders: FolderView[] }>("/api/folders"), api<{ models: ModelView[] }>("/api/models")]);
      setEngine(e);
      setFolders(f.folders);
      setModels(m.models);
    } catch (err) {
      setError(toPayload(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toPayload(e));
    } finally {
      setBusy(null);
      await Promise.all([load(), refreshConfig(), refreshStatus()]);
    }
  }

  const browseEngine = () =>
    run("browse-engine", async () => {
      const r = await pickWithDialog("engine");
      if (!r.cancelled && r.ticket && r.path) setPending({ ticket: r.ticket, path: r.path });
    });
  const saveEngine = () =>
    run("save-engine", async () => {
      if (!pending) return;
      const r = await api<{ check: EngineCheck }>("/api/engine", { method: "POST", body: { ticket: pending.ticket } });
      setPending(null);
      setTest(r.check);
      notify(r.check.ok ? "ok" : "error", r.check.ok ? "Moteur enregistré et vérifié." : "Moteur enregistré, mais le test a échoué : voir le détail.");
    });
  const testEngine = () =>
    run("test-engine", async () => {
      setTest(await api<EngineCheck>("/api/engine/test", { method: "POST" }));
    });
  const addFolder = () =>
    run("add-folder", async () => {
      const r = await pickWithDialog("folder");
      if (r.cancelled || !r.ticket) return;
      const res = await api<{ scan: { found: number; added: number } }>("/api/folders", { method: "POST", body: { ticket: r.ticket, recursive } });
      notify("ok", `${res.scan.found} modèle(s) trouvé(s), ${res.scan.added} ajouté(s).`);
    });
  const addModel = () =>
    run("add-model", async () => {
      const r = await pickWithDialog("gguf");
      if (r.cancelled || !r.ticket) return;
      const res = await api<{ existing: boolean }>("/api/models", { method: "POST", body: { ticket: r.ticket } });
      notify("ok", res.existing ? "Ce modèle était déjà dans la bibliothèque." : "Modèle ajouté à la bibliothèque.");
    });
  const refreshFolder = (f: FolderView) =>
    run("refresh-" + f.id, async () => {
      const r = await api<{ found: number; added: number; truncated: boolean }>(`/api/folders/${f.id}/refresh`, { method: "POST" });
      notify("ok", `${r.found} modèle(s) trouvé(s), ${r.added} nouveau(x).${r.truncated ? " Résultats limités (dossier très volumineux)." : ""}`);
    });
  const toggleRecursive = (f: FolderView) =>
    run("rec-" + f.id, async () => {
      await api(`/api/folders/${f.id}`, { method: "PATCH", body: { recursive: !f.recursive } });
    });
  const removeFolder = (f: FolderView) =>
    run("rm-" + f.id, async () => {
      if (!window.confirm(`Retirer ce dossier de la liste ?\n\n${f.path}\n\nLes fichiers ne sont PAS supprimés ; les modèles découverts via ce dossier quittent la bibliothèque.`)) return;
      await api(`/api/folders/${f.id}`, { method: "DELETE" });
    });

  const dialogsOff = meta !== null && !meta.dialogsAvailable;
  const engineRunning = status?.state === "running" || status?.state === "starting";

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <PageHeader title="Configuration locale" subtitle="Indiquez où se trouvent llama.cpp et vos modèles. Tout se fait avec les fenêtres de sélection Windows : aucun chemin à taper." />

      {dialogsOff && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-100">
          Les sélecteurs graphiques ne sont disponibles que sous Windows (plateforme détectée : {meta?.platform}). Lancez LocalGemma AI sur Windows avec <code>scripts\start.ps1</code>.
        </div>
      )}
      <ErrorBox error={error} onClose={() => setError(null)} />

      <Card title="Moteur d'IA local" subtitle="Le programme llama-server.exe de llama.cpp, qui exécute les modèles.">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-400">Chemin actuel</dt>
          <dd className="break-all">{engine?.path ?? <span className="text-slate-500">Non configuré</span>}</dd>
          <dt className="text-slate-400">Validation</dt>
          <dd>
            {!engine ? "…" : engine.valid ? <Badge tone="ok">Fichier valide</Badge> : engine.configured ? <Badge tone="error">Invalide ou introuvable</Badge> : <Badge tone="muted">Non configuré</Badge>}
            {engine?.validationError && <p className="mt-1 text-red-300">{engine.validationError.message}</p>}
          </dd>
          <dt className="text-slate-400">Version du moteur</dt>
          <dd>{engine?.version ?? <span className="text-slate-500">Inconnue (lancez « Tester le moteur »)</span>}</dd>
          {pending && (
            <>
              <dt className="text-slate-400">Nouvelle sélection</dt>
              <dd className="break-all text-accent-soft">{pending.path}</dd>
            </>
          )}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void browseEngine()} loading={busy === "browse-engine"} disabled={dialogsOff || engineRunning} title={engineRunning ? "Arrêtez d'abord le modèle actif" : undefined}>
            <FolderOpen className="h-4 w-4" /> Parcourir mon ordinateur
          </Button>
          <Button onClick={() => void testEngine()} loading={busy === "test-engine"} disabled={!engine?.configured}>
            <FlaskConical className="h-4 w-4" /> Tester le moteur
          </Button>
          <Button onClick={() => void saveEngine()} loading={busy === "save-engine"} disabled={!pending}>
            <Save className="h-4 w-4" /> Enregistrer
          </Button>
        </div>
        {test && (
          <div className={`mt-4 rounded-lg border p-3 text-sm ${test.ok ? "border-emerald-500/30 bg-emerald-950/30" : "border-red-500/40 bg-red-950/30"}`}>
            {test.ok ? <p>✅ Le moteur démarre correctement. Version : <strong>{test.version ?? "inconnue"}</strong></p> : <ErrorBox error={test.error} />}
            {test.output && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-slate-400">{test.output}</pre>}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Pas encore de llama.cpp ? Téléchargez une version Windows depuis les « Releases » officielles : github.com/ggml-org/llama.cpp (voir le README).</p>
      </Card>

      <Card
        title="Dossiers de modèles GGUF"
        subtitle="Seuls les dossiers que vous choisissez sont analysés (jamais tout le disque)."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> Inclure les sous-dossiers
            </label>
            <Button variant="primary" onClick={() => void addFolder()} loading={busy === "add-folder"} disabled={dialogsOff}>
              <FolderPlus className="h-4 w-4" /> Ajouter un dossier
            </Button>
          </>
        }
      >
        {folders.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun dossier enregistré.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {folders.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="break-all font-medium">{f.path}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    {f.exists ? <Badge tone="ok">Trouvé</Badge> : <Badge tone="error">Introuvable</Badge>}
                    <span>{f.modelCount} modèle(s)</span>
                    <span>Dernière analyse : {formatDate(f.lastScanAt)}</span>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={f.recursive} onChange={() => void toggleRecursive(f)} /> sous-dossiers
                    </label>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void refreshFolder(f)} loading={busy === "refresh-" + f.id} aria-label="Actualiser">
                    <RefreshCw className="h-4 w-4" /> Actualiser
                  </Button>
                  <Button variant="ghost" onClick={() => void removeFolder(f)} aria-label="Retirer le dossier">
                    <Trash2 className="h-4 w-4" /> Retirer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Ajouter un modèle individuel" subtitle="Le fichier reste où il est : il n'est ni copié, ni déplacé, ni supprimé.">
        <Button variant="primary" onClick={() => void addModel()} loading={busy === "add-model"} disabled={dialogsOff}>
          <FileUp className="h-4 w-4" /> Ajouter un modèle GGUF
        </Button>
      </Card>

      <Card title="Vérification des fichiers" subtitle="État des chemins enregistrés. La compatibilité réelle d'un modèle n'est connue qu'au chargement.">
        {models.length === 0 && !engine?.path ? (
          <p className="text-sm text-slate-400">Rien à vérifier pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Fichier</th><th className="pr-3">Trouvé</th><th className="pr-3">Accès</th><th className="pr-3">Taille</th><th className="pr-3">Ext.</th><th className="pr-3">Modifié</th><th>Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {engine?.path && engine.fileCheck && (
                  <Row label={"Moteur : " + engine.path.split(/[\\/]/).pop()} title={engine.path} c={engine.fileCheck} valid={engine.valid} />
                )}
                {models.map((m) => (
                  <Row key={m.id} label={m.fileName} title={m.path} c={m.fileCheck} valid={m.fileCheck.exists && m.fileCheck.readable && m.fileCheck.extension === ".gguf"} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 flex items-center gap-1 text-xs text-slate-500"><Search className="h-3 w-3" /> Détails complets d'un modèle : page « Bibliothèque de modèles ».</p>
      </Card>
    </div>
  );
}

function Row({ label, title, c, valid }: { label: string; title: string; c: FileCheck; valid: boolean }) {
  return (
    <tr>
      <td className="max-w-[16rem] truncate py-2 pr-3" title={title}>{label}</td>
      <td className="pr-3">{c.exists ? "Oui" : "Non"}</td>
      <td className="pr-3">{c.readable ? "Lecture OK" : "—"}</td>
      <td className="pr-3">{formatBytes(c.sizeBytes)}</td>
      <td className="pr-3">{c.extension || "—"}</td>
      <td className="pr-3">{formatDate(c.modifiedAt)}</td>
      <td>{valid ? <Badge tone="ok">Valide</Badge> : <Badge tone="error">À corriger</Badge>}</td>
    </tr>
  );
}
