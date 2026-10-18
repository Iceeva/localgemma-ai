import path from "node:path";
import { AppError } from "./errors";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "cs", "go", "rs",
  "php", "rb", "sh", "ps1", "bat", "sql", "yaml", "yml", "toml", "ini", "log", "svg", "tex", "rtf",
]);
const REFUSED_EXT = new Set(["exe", "dll", "zip", "rar", "7z", "png", "jpg", "jpeg", "gif", "webp", "mp3", "mp4", "gguf", "bin", "iso"]);

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export interface Extracted {
  name: string;
  text: string;
  chars: number;
  pages?: number;
  cut: boolean;
}

export async function extractText(fileName: string, buf: Buffer): Promise<Extracted> {
  const name = path.basename(fileName || "fichier");
  const ext = path.extname(name).slice(1).toLowerCase();
  if (buf.length === 0) throw new AppError("EXTRACT_FAILED", "Le fichier est vide.", "Choisissez un autre fichier.");
  if (buf.length > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "Le fichier dépasse 8 Mo.", "Joignez un fichier plus petit ou extrait d'un document plus long.", 413);

  let text = "";
  let pages: number | undefined;
  try {
    if (ext === "pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const r = await pdfText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
      pages = r.totalPages;
    } else if (ext === "docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (ext === "xlsx") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const parts: string[] = [];
      wb.eachSheet((ws) => {
        const rows: string[] = [];
        ws.eachRow((row) => {
          const vals = (row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? "" : typeof v === "object" ? ((v as { text?: string; result?: unknown }).text ?? String((v as { result?: unknown }).result ?? "")) : String(v)));
          rows.push(vals.join(";"));
        });
        parts.push(`# Feuille : ${ws.name}\n${rows.join("\n")}`);
      });
      text = parts.join("\n\n");
    } else if (ext === "doc" || ext === "xls" || ext === "ppt" || ext === "pptx") {
      throw new AppError("UNSUPPORTED_FILE", `Le format .${ext} n'est pas lu directement.`, "Enregistrez-le en .docx, .xlsx (ou .csv) ou .pdf puis rejoignez-le.");
    } else if (REFUSED_EXT.has(ext)) {
      throw new AppError("UNSUPPORTED_FILE", `Le format .${ext} ne peut pas être lu comme du texte.`, "Joignez un fichier texte, PDF, Word (.docx) ou Excel (.xlsx).");
    } else if (TEXT_EXT.has(ext) || !looksBinary(buf)) {
      text = buf.toString("utf8");
    } else {
      throw new AppError("UNSUPPORTED_FILE", "Ce fichier semble binaire.", "Joignez un fichier texte, PDF, Word (.docx) ou Excel (.xlsx).");
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("EXTRACT_FAILED", `Impossible de lire « ${name} ».`, "Le fichier est peut-être corrompu ou protégé par un mot de passe.", 422, String(e));
  }
  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (!text) throw new AppError("EXTRACT_FAILED", `Aucun texte trouvé dans « ${name} ».`, "S'il s'agit d'un PDF scanné (images), l'OCR n'est pas inclus : utilisez un PDF avec du texte sélectionnable.", 422);
  const cut = text.length > MAX_TEXT_CHARS;
  if (cut) text = text.slice(0, MAX_TEXT_CHARS);
  return { name, text, chars: text.length, pages, cut };
}
