import { handler, ok, type IdContext } from "@/lib/server/http";
import { getManager } from "@/lib/server/process-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

/** « Utiliser ce modèle » : arrête proprement l'éventuel autre modèle, démarre celui-ci et attend que l'API réponde. */
export const POST = handler(async (_req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  return ok({ status: await getManager().start(id) });
});
