import { handler, ok, type IdContext } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { removeModel } from "@/lib/server/model-library";
import { getManager } from "@/lib/server/process-manager";
import { AppError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = handler(async (_req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  const active = getManager().snapshotActive();
  if (active.modelId === id && (active.state === "running" || active.state === "starting")) {
    throw new AppError("SERVER_BUSY", "Ce modèle est en cours d'utilisation.", "Arrêtez-le avant de le retirer de la bibliothèque.", 409);
  }
  await removeModel(getConfigStore(), id); // retire la référence uniquement ; le fichier n'est jamais supprimé
  return ok({ removed: true });
});
