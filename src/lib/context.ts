/** Construction du contexte envoyé au modèle (pièces jointes, résultats web) : fonctions pures, testables. */
import type { SearchResult } from "@/types";

export const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

/**
 * Nombre de caractères que l'on peut ajouter à la question (documents, résultats web) sans saturer le contexte.
 * On réserve la réponse (maxTokens), le prompt système et une marge pour l'historique.
 */
export function contextBudgetChars(contextSize: number, maxTokens: number, systemChars: number): number {
  const free = contextSize - maxTokens - estimateTokens(systemChars) - 150;
  return Math.max(0, Math.floor(free * 0.6 * CHARS_PER_TOKEN));
}

export interface AttachmentInput {
  name: string;
  text: string;
}
export interface AttachmentMeta {
  name: string;
  chars: number;
  truncated: boolean;
}

export function buildAttachmentContext(files: AttachmentInput[], budgetChars: number): { text: string; meta: AttachmentMeta[] } {
  if (files.length === 0) return { text: "", meta: [] };
  const per = Math.max(200, Math.floor(budgetChars / files.length));
  const meta: AttachmentMeta[] = [];
  const blocks = files.map((f) => {
    const truncated = f.text.length > per;
    const body = truncated ? f.text.slice(0, per) : f.text;
    meta.push({ name: f.name, chars: body.length, truncated });
    return `--- Document « ${f.name} »${truncated ? " (tronqué : seul le début est fourni)" : ""} ---\n${body}\n--- Fin de « ${f.name} » ---`;
  });
  return { text: "Documents fournis par l'utilisateur :\n" + blocks.join("\n\n"), meta };
}

export function buildWebContext(results: SearchResult[], opts: { budgetChars: number; now: Date; query: string }): { text: string; used: SearchResult[] } {
  const used: SearchResult[] = [];
  const lines: string[] = [];
  let size = 0;
  for (const r of results) {
    const line = `[${used.length + 1}] ${r.title} — ${r.url}\n${r.content}`;
    if (used.length > 0 && size + line.length > opts.budgetChars) break;
    used.push(r);
    lines.push(line);
    size += line.length;
  }
  const date = opts.now.toLocaleDateString("fr-FR", { dateStyle: "long" });
  const head = `Résultats de recherche web du ${date} pour « ${opts.query} ». Appuie-toi dessus pour répondre, cite les sources par leur numéro [1], [2]… et dis clairement si elles ne suffisent pas.`;
  return { text: used.length ? `${head}\n\n${lines.join("\n\n")}` : "", used };
}

export interface ApiMessageInput {
  role: "user" | "assistant";
  content: string;
  context?: string;
}

/**
 * Prépare les messages envoyés au serveur. Le contexte (documents, web) est joint aux questions
 * en partant de la plus récente, tant que le budget le permet : les plus anciens sont omis.
 */
export function buildApiMessages(messages: ApiMessageInput[], budgetChars: number): Array<{ role: "user" | "assistant"; content: string }> {
  let remaining = budgetChars;
  const keep = new Set<number>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && m.context) {
      if (i === messages.length - 1 || m.context.length <= remaining) {
        keep.add(i);
        remaining -= m.context.length;
      }
    }
  }
  return messages.map((m, i) => ({ role: m.role, content: keep.has(i) && m.context ? `${m.context}\n\n---\nQuestion de l'utilisateur :\n${m.content}` : m.content }));
}

/** Détecte « retiens que … » pour enregistrer une note dans la mémoire locale. */
export function parseMemoryCommand(text: string): string | null {
  const m = text.trim().match(/^(?:retiens|mémorise|memorise|souviens-toi)\s+(?:que\s+|qu')?(.{3,300})$/is);
  return m?.[1]?.trim() ?? null;
}

// ---------- extraction de fichiers de code depuis une réponse (export ZIP) ----------

export interface CodeFile {
  path: string;
  content: string;
}

const EXT: Record<string, string> = {
  python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx", html: "html", css: "css", json: "json",
  bash: "sh", sh: "sh", powershell: "ps1", ps1: "ps1", sql: "sql", java: "java", c: "c", cpp: "cpp", csharp: "cs", cs: "cs", go: "go", rust: "rs",
  php: "php", ruby: "rb", yaml: "yml", yml: "yml", xml: "xml", markdown: "md", md: "md", svg: "svg", text: "txt", txt: "txt", csv: "csv", bat: "bat",
};

export function extensionForLang(lang: string): string {
  return EXT[lang.toLowerCase()] ?? "txt";
}

const SAFE_PATH = /^[\w][\w .\-/]*\.[A-Za-z0-9]{1,8}$/;

function cleanPath(p: string): string | null {
  const x = p.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!SAFE_PATH.test(x) || x.split("/").includes("..")) return null;
  return x;
}

/** Extrait les blocs de code d'un texte Markdown et leur attribue un nom de fichier (info string ou 1re ligne). */
export function extractCodeFiles(markdown: string): CodeFile[] {
  const files: CodeFile[] = [];
  const used = new Set<string>();
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(markdown))) {
    n++;
    const info = (m[1] ?? "").trim();
    let body = (m[2] ?? "").replace(/\n$/, "");
    const lang = info.split(/[\s:{=]/)[0] ?? "";
    let path: string | null = null;
    const infoPath = info.match(/(?:title|file|path|fichier)\s*[=:]\s*"?([^\s"]+)"?/i) ?? info.match(/^\w+[:\s]+(\S+\.[A-Za-z0-9]{1,8})$/);
    if (infoPath?.[1]) path = cleanPath(infoPath[1]);
    if (!path) {
      const first = body.split("\n")[0] ?? "";
      const c = first.match(/^\s*(?:#|\/\/|<!--|\/\*|--)\s*(?:fichier|file|path)?\s*:?\s*([\w./\\-]+\.[A-Za-z0-9]{1,8})\s*(?:-->|\*\/)?\s*$/i);
      if (c?.[1]) {
        path = cleanPath(c[1]);
        if (path && /fichier|file|path/i.test(first)) body = body.split("\n").slice(1).join("\n");
      }
    }
    if (!path) path = `fichier-${n}.${extensionForLang(lang)}`;
    let unique = path;
    for (let k = 2; used.has(unique); k++) unique = path.replace(/(\.[^./]+)?$/, `-${k}$1`);
    used.add(unique);
    files.push({ path: unique, content: body });
  }
  return files;
}
