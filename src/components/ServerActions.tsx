"use client";

import { useState } from "react";
import type { ErrorPayload } from "@/types";
import { api, toPayload } from "@/lib/client/api";
import { useApp } from "./AppProvider";

/** Actions de démarrage / arrêt partagées par l'accueil, la bibliothèque et le gestionnaire de serveurs. */
export function useServerActions() {
  const { refreshStatus, refreshConfig, notify } = useApp();
  const [busy, setBusy] = useState<null | "start" | "stop" | "restart">(null);
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [error, setError] = useState<ErrorPayload | null>(null);

  async function run(kind: "start" | "stop" | "restart", modelId: string | null, fn: () => Promise<unknown>, okText: string) {
    setBusy(kind);
    setBusyModelId(modelId);
    setError(null);
    void refreshStatus();
    try {
      await fn();
      notify("ok", okText);
    } catch (e) {
      setError(toPayload(e));
    } finally {
      setBusy(null);
      setBusyModelId(null);
      await Promise.all([refreshStatus(), refreshConfig()]);
    }
  }

  return {
    busy,
    busyModelId,
    error,
    clearError: () => setError(null),
    start: (modelId: string) => run("start", modelId, () => api(`/api/models/${modelId}/start`, { method: "POST" }), "Modèle prêt : vous pouvez discuter."),
    stop: () => run("stop", null, () => api("/api/server/stop", { method: "POST" }), "Modèle arrêté."),
    restart: () => run("restart", null, () => api("/api/server/restart", { method: "POST" }), "Modèle redémarré."),
  };
}
