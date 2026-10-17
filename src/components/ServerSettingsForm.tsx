"use client";

import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { ErrorPayload, ModelView, ServerSettings } from "@/types";
import { api, toPayload } from "@/lib/client/api";
import { useApp } from "./AppProvider";
import { Button, ErrorBox, Field, inputClass } from "./ui";

export function ServerSettingsForm({ model }: { model?: ModelView | null }) {
  const { config, refreshConfig, notify, status } = useApp();
  const [form, setForm] = useState<ServerSettings | null>(null);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config && !form) setForm(config.server);
  }, [config, form]);
  if (!form) return null;

  const fieldErrors = (error?.details ?? {}) as Record<string, string>;
  const num = (k: keyof ServerSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value === "" ? 0 : Number(e.target.value) });
  const ctxTooBig = model?.contextLength !== undefined && form.contextSize > model.contextLength;

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ restartRequired: boolean }>("/api/config", { method: "PUT", body: { server: form } });
      await refreshConfig();
      notify("ok", r.restartRequired ? "Enregistré. Redémarrez le modèle pour appliquer ces paramètres." : "Paramètres de lancement enregistrés.");
    } catch (e) {
      setError(toPayload(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Adresse d'écoute" hint="Toujours locale (127.0.0.1) : le serveur n'est pas exposé au réseau.">
          <input className={inputClass} value={form.host} disabled />
        </Field>
        <Field label="Port" hint="Par défaut 8080 ; à changer s'il est déjà pris." error={fieldErrors.port}>
          <input type="number" className={inputClass} value={form.port} onChange={num("port")} />
        </Field>
        <Field label="Taille du contexte (tokens)" hint="2048 = prudent. Plus grand = plus de mémoire." error={fieldErrors.contextSize}>
          <input type="number" className={inputClass} value={form.contextSize} onChange={num("contextSize")} />
        </Field>
        <Field label="Threads CPU" hint="Votre AMD A9-9410 a 2 cœurs : 2 est un bon départ." error={fieldErrors.threads}>
          <input type="number" className={inputClass} value={form.threads} onChange={num("threads")} />
        </Field>
        <Field label="Slots parallèles" hint="1 évite de diviser le contexte entre plusieurs requêtes." error={fieldErrors.parallel}>
          <input type="number" className={inputClass} value={form.parallel} onChange={num("parallel")} />
        </Field>
        <Field label="Délai de démarrage (s)" hint="Les gros modèles sont lents à charger." error={fieldErrors.startupTimeoutSec}>
          <input type="number" className={inputClass} value={form.startupTimeoutSec} onChange={num("startupTimeoutSec")} />
        </Field>
      </div>
      {ctxTooBig && <p className="text-sm text-amber-300">⚠️ Ce modèle annonce un contexte maximal de {model?.contextLength} tokens : une valeur plus grande peut échouer ou dégrader les réponses.</p>}
      <p className="text-xs text-slate-400">
        La mémoire nécessaire dépend de la taille du modèle, de la taille du contexte, des caches et des autres applications ouvertes. Ces réglages ne garantissent pas qu'un modèle donné fonctionnera sur votre PC.
      </p>
      <ErrorBox error={error} onClose={() => setError(null)} />
      <Button variant="primary" onClick={() => void save()} loading={saving} disabled={status?.state === "starting" || status?.state === "stopping"}>
        <Save className="h-4 w-4" /> Enregistrer les paramètres
      </Button>
    </div>
  );
}
