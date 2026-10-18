import { handler, ok } from "@/lib/server/http";
import { AppError } from "@/lib/server/errors";
import { extractText, MAX_UPLOAD_BYTES } from "@/lib/server/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Extrait le texte d'un fichier joint (PDF, Word, Excel, texte). Le fichier n'est pas conservé. */
export const POST = handler(async (req: Request) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "Le fichier dépasse 8 Mo.", "Joignez un fichier plus petit.", 413);
  let name = "fichier";
  try {
    name = decodeURIComponent(req.headers.get("x-filename") ?? "fichier");
  } catch {
    /* nom brut conservé */
  }
  const buf = Buffer.from(await req.arrayBuffer());
  return ok(await extractText(name, buf));
});
