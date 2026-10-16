import { handler, ok, readJson } from "@/lib/server/http";
import { getManager } from "@/lib/server/process-manager";
import { AppError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  if (typeof body.modelId !== "string") throw new AppError("VALIDATION", "Aucun modèle indiqué.", "Choisissez un modèle dans la bibliothèque.");
  return ok({ status: await getManager().start(body.modelId) });
});
