import { handler, ok, readJson, type IdContext } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { relocateModel } from "@/lib/server/model-library";
import { resolveSelection } from "@/lib/server/selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  const body = await readJson(req);
  const file = resolveSelection(body, "gguf");
  return ok({ model: await relocateModel(getConfigStore(), id, file) });
});
