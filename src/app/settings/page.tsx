"use client";

import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { GenerationForm } from "@/components/GenerationForm";
import { Button, Card, ErrorBox, PageHeader } from "@/components/ui";
import { api, toPayload } from "@/lib/client/api";
import type { ErrorPayload, GenerationParams } from "@/types";

export default function SettingsPage() {
  const { config, meta, refreshConfig, notify } = useApp();
  const [gen, setGen] = useState<GenerationParams | null>(null);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config && !gen) setGen(config.generation);
  }, [config, gen]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api("/api/config", { method: "PUT", body: { generation: gen } });
      await refreshConfig();
      notify("ok", "Préférences de génération enregistrées.");
    } catch (e) {
      setError(toPayload(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
      <PageHeader title="Paramètres" subtitle="Préférences par défaut des nouvelles conversations." />
      <ErrorBox error={error} onClose={() => setError(null)} />
      <Card title="Génération" subtitle="Valeurs prudentes pour un PC modeste. La taille du contexte et les threads se règlent dans « Gestionnaire de serveurs ».">
        {gen && <GenerationForm value={gen} onChange={setGen} />}
        <div className="mt-5">
          <Button variant="primary" onClick={() => void save()} loading={saving}><Save className="h-4 w-4" /> Enregistrer</Button>
        </div>
      </Card>
      <Card title="Stockage local">
        <dl className="grid gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
          <dt className="text-slate-400">Dossier de données</dt><dd className="break-all">{meta?.dataDir ?? "…"}</dd>
          <dt className="text-slate-400">Fichier de configuration</dt><dd className="break-all">{meta?.configFile ?? "…"}</dd>
          <dt className="text-slate-400">Conversations</dt><dd>Stockées dans IndexedDB, dans le navigateur de cet ordinateur (export Markdown/JSON depuis chaque conversation).</dd>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Sauvegarde : fermez l'application puis copiez config.json. Restauration : recopiez-le au même endroit (voir le README).</p>
      </Card>
    </div>
  );
}
