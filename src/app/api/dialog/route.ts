import { handler, ok, readJson } from "@/lib/server/http";
import { openNativeDialog } from "@/lib/server/native-dialog";
import { issueTicket, type SelectionKind } from "@/lib/server/selection";
import { AppError } from "@/lib/server/errors";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const kind = body.kind;
  if (kind !== "engine" && kind !== "gguf" && kind !== "folder") {
    throw new AppError("VALIDATION", "Type de sélection inconnu.", "Rechargez la page.");
  }
  const result = await openNativeDialog(kind as SelectionKind);
  if (result.cancelled || !result.path) return ok({ cancelled: true });
  return ok({ cancelled: false, ticket: issueTicket(kind as SelectionKind, result.path), path: result.path, name: path.basename(result.path) });
});
