"use client";

import type { GenerationParams } from "@/types";
import { Field, inputClass } from "./ui";

export function GenerationForm({ value, onChange }: { value: GenerationParams; onChange: (v: GenerationParams) => void }) {
  const set = <K extends keyof GenerationParams>(k: K, v: GenerationParams[K]) => onChange({ ...value, [k]: v });
  const num = (s: string, fallback: number) => (s.trim() === "" || Number.isNaN(Number(s)) ? fallback : Number(s));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={`Température : ${value.temperature}`} hint="Plus haut = réponses plus variées ; plus bas = plus déterministes.">
        <input type="range" min={0} max={2} step={0.05} value={value.temperature} onChange={(e) => set("temperature", Number(e.target.value))} className="w-full" />
      </Field>
      <Field label={`Top-p : ${value.topP}`} hint="Échantillonnage par noyau (0 à 1).">
        <input type="range" min={0} max={1} step={0.01} value={value.topP} onChange={(e) => set("topP", Number(e.target.value))} className="w-full" />
      </Field>
      <Field label="Top-k" hint="0 = désactivé. Transmis à llama.cpp.">
        <input type="number" min={0} max={1000} className={inputClass} value={value.topK} onChange={(e) => set("topK", num(e.target.value, 0))} />
      </Field>
      <Field label="Tokens générés (maximum)" hint="Valeur basse = réponses plus rapides sur un PC modeste.">
        <input type="number" min={1} max={32768} className={inputClass} value={value.maxTokens} onChange={(e) => set("maxTokens", num(e.target.value, 512))} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={value.stream} onChange={(e) => set("stream", e.target.checked)} /> Afficher la réponse au fur et à mesure (streaming)
      </label>
      <div className="sm:col-span-2">
        <Field label="Prompt système">
          <textarea rows={3} className={inputClass} value={value.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
