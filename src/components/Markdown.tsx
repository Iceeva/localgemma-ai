"use client";

import { Check, Copy, Download, Eye, EyeOff } from "lucide-react";
import { memo, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { extensionForLang } from "@/lib/context";
import { downloadText } from "@/lib/client/conversations";

/** Politique de sécurité de l'aperçu : aucun accès réseau, scripts de la page autorisés uniquement dans le cadre isolé. */
const PREVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data:;">`;

export function previewDocument(lang: string, code: string): string {
  if (lang === "svg") return `<!doctype html><html><head>${PREVIEW_CSP}</head><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body></html>`;
  return /<head[^>]*>/i.test(code) ? code.replace(/<head[^>]*>/i, (m) => `${m}${PREVIEW_CSP}`) : `<!doctype html><html><head>${PREVIEW_CSP}</head><body>${code}</body></html>`;
}

function langOf(props: ComponentProps<"pre">): string {
  const child = (props.children as { props?: { className?: string } } | undefined)?.props;
  return /language-([\w+-]+)/.exec(child?.className ?? "")?.[1]?.toLowerCase() ?? "";
}

function Pre(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  const [preview, setPreview] = useState(false);
  const lang = langOf(props);
  const previewable = lang === "html" || lang === "svg";
  const code = () => ref.current?.textContent ?? "";
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-surface-border bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-surface-border px-2 py-1 text-xs text-slate-400">
        <span>{lang || "code"}</span>
        <div className="flex gap-1">
          {previewable && (
            <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-white/10 hover:text-white" onClick={() => setPreview(!preview)}>
              {preview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {preview ? "Masquer l'aperçu" : "Aperçu"}
            </button>
          )}
          <button className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-white/10 hover:text-white" onClick={() => downloadText(`fichier.${extensionForLang(lang)}`, code(), "text/plain")}>
            <Download className="h-3 w-3" /> Télécharger
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-white/10 hover:text-white"
            onClick={() => {
              void navigator.clipboard.writeText(code());
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            }}
          >
            {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {done ? "Copié" : "Copier"}
          </button>
        </div>
      </div>
      <pre ref={ref} {...props} />
      {preview && (
        <div className="border-t border-surface-border bg-white">
          {/* sandbox sans allow-same-origin : la page de l'aperçu ne peut ni lire l'application ni accéder au réseau (CSP). */}
          <iframe title="Aperçu" sandbox="allow-scripts" srcDoc={previewDocument(lang, code())} className="h-96 w-full" />
        </div>
      )}
    </div>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md break-words text-[0.95rem]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={{ pre: Pre }}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
