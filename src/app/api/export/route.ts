import { handler, readJson } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { EXPORT_MIME, exportDocument, type ExportFormat } from "@/lib/server/exporters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Convertit une réponse Markdown en Word, PDF, Excel ou PowerPoint. */
export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const format = body.format as ExportFormat;
  if (!(format in EXPORT_MIME)) throw new AppError("VALIDATION", "Format d'export inconnu.", "Choisissez Word, PDF, Excel ou PowerPoint.");
  if (typeof body.markdown !== "string" || !body.markdown.trim() || body.markdown.length > 300_000) {
    throw new AppError("VALIDATION", "Le contenu à exporter est vide ou trop long.", "Exportez une réponse plus courte.");
  }
  const title = (typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Document").slice(0, 120);
  const buf = await exportDocument(format, body.markdown, title);
  const file = title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "document";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": EXPORT_MIME[format],
      "Content-Disposition": `attachment; filename="export.${format}"; filename*=UTF-8''${encodeURIComponent(file)}.${format}`,
      "Cache-Control": "no-store",
    },
  });
});
