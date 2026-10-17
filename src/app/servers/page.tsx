"use client";

import { Activity, FileCheck, Play, RotateCw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useServerActions } from "@/components/ServerActions";
import { ServerSettingsForm } from "@/components/ServerSettingsForm";
import { Badge, Button, Card, ErrorBox, PageHeader, statusTone } from "@/components/ui";
import { api, toPayload } from "@/lib/client/api";
import { formatBytes, formatDate } from "@/lib/client/format";
import type { ErrorPayload, ModelView } from "@/types";

interface LogLine { idx: number; ts: string; stream: string; text: string }
const STATE_LABEL = { running: "En marche", starting: "Démarrage…", stopping: "Arrêt…", error: "Erreur", stopped: "Arrêté" } as const;

export default function ServersPage() {
  const { status, config, notify } = useApp();
  const actions = useServerActions();
  const [models, setModels] = useState<ModelView[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const since = useRef(0);
  const logBox = useRef<HTMLPreElement>(null);

  const loadModels = useCallback(async () => {
    try {
      setModels((await api<{ models: ModelView[] }>("/api/models")).models);
    } catch (e) {
      setError(toPayload(e));
    }
  }, []);
  useEffect(() => {
    void loadModels();
  }, [loadModels, status?.state]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api<{ lines: LogLine[]; next: number }>(`/api/server/logs?since=${since.current}`);
        if (!alive) return;
        if (r.lines.length) setLogs((l) => [...l, ...r.lines].slice(-1000));
        since.current = r.next;
      } catch {
        /* le bandeau d'état signale déjà l'indisponibilité */
      }
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [logs]);

  const selected = models.find((m) => m.id === config?.selectedModelId) ?? null;
  const active = models.find((m) => m.id === status?.modelId) ?? null;
  const busy = actions.busy !== null || status?.state === "starting" || status?.state === "stopping";
  const running = status?.state === "running";

  async function testConnection() {
    setTesting(true);
    try {
      const r = await api<{ ok: boolean; detail: string; url: string }>("/api/server/test", { method: "POST" });
      notify(r.ok ? "ok" : "error", `${r.url} — ${r.detail}`);
    } catch (e) {
      setError(toPayload(e));
    } finally {
      setTesting(false);
    }
  }
  async function checkFile() {
    await loadModels();
    const m = selected ?? active;
    if (!m) return setFileMsg("Aucun modèle sélectionné.");
    const c = m.fileCheck;
    setFileMsg(c.exists && c.isFile ? `✅ « ${m.fileName} » est présent, ${c.readable ? "lisible" : "NON lisible"}, ${formatBytes(c.sizeBytes)}.` : `❌ « ${m.fileName} » est introuvable. Utilisez « Localiser à nouveau le fichier » dans la bibliothèque.`);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <PageHeader title="Gestionnaire de serveurs" subtitle="Un seul modèle est chargé à la fois pour ménager la mémoire de votre PC." />
      <ErrorBox error={error ?? actions.error} onClose={() => { setError(null); actions.clearError(); }} />

      <Card
        title="État du serveur"
        actions={<Badge tone={statusTone(status?.state ?? "stopped")}>{STATE_LABEL[status?.state ?? "stopped"]}</Badge>}
      >
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
          <dt className="text-slate-400">llama-server.exe</dt><dd className="break-all">{config?.enginePath ?? <span className="text-red-300">Non configuré (voir « Configuration locale »)</span>}</dd>
          <dt className="text-slate-400">Modèle</dt><dd>{status?.modelName ?? selected?.name ?? "Aucun modèle sélectionné"}</dd>
          <dt className="text-slate-400">Adresse / port</dt><dd>{status ? `${status.host}:${status.port}` : "—"}</dd>
          <dt className="text-slate-400">Contexte</dt><dd>{status?.contextSize ?? config?.server.contextSize ?? "—"} tokens</dd>
          <dt className="text-slate-400">Processus</dt><dd>{status?.pid ? `PID ${status.pid}${status.managed ? "" : " (repris d'une session précédente)"}` : "—"}</dd>
          <dt className="text-slate-400">Santé de l'API</dt><dd>{status?.state === "running" ? <Badge tone={status.healthy ? "ok" : "error"}>{status.healthDetail ?? "—"}</Badge> : "—"}</dd>
          <dt className="text-slate-400">Démarré le</dt><dd>{formatDate(status?.startedAt)}</dd>
        </dl>
        {status?.state === "error" && <div className="mt-4"><ErrorBox error={status.error} /></div>}
        <div className="mt-5 flex flex-wrap gap-2">
          {!running && (
            <Button variant="primary" onClick={() => selected && void actions.start(selected.id)} loading={actions.busy === "start" || status?.state === "starting"} disabled={!selected || busy} title={selected ? undefined : "Sélectionnez un modèle dans la bibliothèque"}>
              <Play className="h-4 w-4" /> Démarrer le modèle sélectionné
            </Button>
          )}
          {(running || status?.state === "stopping") && (
            <Button variant="danger" onClick={() => void actions.stop()} loading={actions.busy === "stop"} disabled={busy && actions.busy !== "stop"}><Square className="h-4 w-4" /> Arrêter le modèle actif</Button>
          )}
          <Button onClick={() => void actions.restart()} loading={actions.busy === "restart"} disabled={!running || busy}><RotateCw className="h-4 w-4" /> Redémarrer</Button>
          <Button onClick={() => void testConnection()} loading={testing}><Activity className="h-4 w-4" /> Tester la connexion</Button>
          <Button onClick={() => void checkFile()}><FileCheck className="h-4 w-4" /> Vérifier le fichier GGUF</Button>
        </div>
        {fileMsg && <p className="mt-3 text-sm text-slate-300">{fileMsg}</p>}
        {actions.busy === "start" && <p className="mt-3 text-sm text-slate-400">Chargement du modèle… suivez la progression dans les journaux ci-dessous.</p>}
      </Card>

      <Card title="Paramètres de lancement" subtitle="Appliqués au prochain démarrage du modèle.">
        <ServerSettingsForm model={selected ?? active} />
      </Card>

      <Card title="Journaux" actions={<Button variant="ghost" onClick={() => setLogs([])}>Vider l'affichage</Button>}>
        <pre ref={logBox} className="h-72 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-300">
          {logs.length === 0 ? "Aucun journal pour l'instant." : logs.map((l) => `${new Date(l.ts).toLocaleTimeString("fr-FR")} [${l.stream}] ${l.text}`).join("\n")}
        </pre>
      </Card>
    </div>
  );
}
