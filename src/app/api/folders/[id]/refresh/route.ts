import { handler, ok, type IdContext } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { scanFolder } from "@/lib/server/model-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (_req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  return ok(await scanFolder(getConfigStore(), id));
});
