"use client";

import { Download } from "lucide-react";
import { useRef, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { extractCodeFiles } from "@/lib/context";
import { REQUEST_HEADERS, parseError, toPayload } from "@/lib/client/api";
import { downloadText, safeFileName } from "@/lib/client/conversations";
import { useApp } from "./AppProvider";

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export d'une réponse : Word, PDF, Excel, PowerPoint, Markdown, texte, ou fichiers de code en ZIP. */
export function ExportMenu({ markdown, title }: { markdown: string; title: string }) {
  const { notify } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const base = safeFileName(title);
  const codeFiles = extractCodeFiles(markdown);

  async function viaApi(format: "docx" | "pdf" | "xlsx" | "pptx") {
    setBusy(format);
    try {
      const res = await fetch("/api/export", { method: "POST", headers: REQUEST_HEADERS, body: JSON.stringify({ format, markdown, title }) });
      if (!res.ok) throw await parseError(res);
      saveBlob(`${base}.${format}`, await res.blob());
      setOpen(false);
    } catch (e) {
      const p = toPayload(e);
      notify("error", `${p.message} ${p.hint}`);
    } finally {
      setBusy(null);
    }
  }
  function zip() {
    const files: Record<string, Uint8Array> = {};
    for (const f of codeFiles) files[f.path] = strToU8(f.content + "\n");
    saveBlob(`${base}-code.zip`, new Blob([zipSync(files) as BlobPart], { type: "application/zip" }));
    setOpen(false);
  }

  const item = "block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-white/10 disabled:opacity-50";
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/10">
        <Download className="h-3 w-3" /> Exporter
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-52 rounded-lg border border-surface-border bg-surface-raised p-1 shadow-xl">
          <button className={item} disabled={busy !== null} onClick={() => void viaApi("docx")}>{busy === "docx" ? "Création…" : "Word (.docx)"}</button>
          <button className={item} disabled={busy !== null} onClick={() => void viaApi("pdf")}>{busy === "pdf" ? "Création…" : "PDF (.pdf)"}</button>
          <button className={item} disabled={busy !== null} onClick={() => void viaApi("xlsx")} title="Utilise les tableaux et blocs CSV de la réponse">{busy === "xlsx" ? "Création…" : "Excel (.xlsx) — tableaux"}</button>
          <button className={item} disabled={busy !== null} onClick={() => void viaApi("pptx")} title="Une diapositive par titre">{busy === "pptx" ? "Création…" : "PowerPoint (.pptx)"}</button>
          <button className={item} onClick={() => { downloadText(`${base}.md`, markdown, "text/markdown"); setOpen(false); }}>Markdown (.md)</button>
          <button className={item} onClick={() => { downloadText(`${base}.txt`, markdown, "text/plain"); setOpen(false); }}>Texte (.txt)</button>
          {codeFiles.length > 0 && <button className={item} onClick={zip}>Fichiers de code (.zip, {codeFiles.length})</button>}
        </div>
      )}
    </div>
  );
}
