"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppConfig, ServerStatus } from "@/types";
import { api, toPayload } from "@/lib/client/api";

export interface ConfigMeta {
  platform: string;
  dialogsAvailable: boolean;
  pathInputAllowed: boolean;
  dataDir: string;
  configFile: string;
}

interface Toast {
  id: number;
  tone: "ok" | "error" | "info";
  text: string;
}

interface Ctx {
  status: ServerStatus | null;
  statusError: string | null;
  config: AppConfig | null;
  meta: ConfigMeta | null;
  refreshStatus: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  notify: (tone: Toast["tone"], text: string) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp doit être utilisé dans <AppProvider>");
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [meta, setMeta] = useState<ConfigMeta | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<ServerStatus>("/api/server/status"));
      setStatusError(null);
    } catch (e) {
      setStatusError(toPayload(e).message);
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const r = await api<{ config: AppConfig; meta: ConfigMeta }>("/api/config");
      setConfig(r.config);
      setMeta(r.meta);
    } catch (e) {
      setStatusError(toPayload(e).message);
    }
  }, []);

  const notify = useCallback((tone: Toast["tone"], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  // Interrogation régulière de l'état du serveur (plus rapide pendant un démarrage ou un arrêt).
  const stateRef = useRef<string>("stopped");
  stateRef.current = status?.state ?? "stopped";
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refreshStatus();
      if (alive) timer = setTimeout(tick, stateRef.current === "starting" || stateRef.current === "stopping" ? 1000 : 3000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refreshStatus]);

  const value = useMemo(() => ({ status, statusError, config, meta, refreshStatus, refreshConfig, notify }), [status, statusError, config, meta, refreshStatus, refreshConfig, notify]);

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg ${
              t.tone === "error" ? "border-red-500/40 bg-red-950/90 text-red-100" : t.tone === "ok" ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100" : "border-surface-border bg-surface-raised text-slate-100"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
