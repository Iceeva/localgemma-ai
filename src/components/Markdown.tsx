"use client";

import { Check, Copy } from "lucide-react";
import { memo, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function Pre(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-surface-border bg-[#0d1117]">
      <div className="flex justify-end border-b border-surface-border px-2 py-1">
        <button
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
          onClick={() => {
            void navigator.clipboard.writeText(ref.current?.textContent ?? "");
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {done ? "Copié" : "Copier le code"}
        </button>
      </div>
      <pre ref={ref} {...props} />
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
