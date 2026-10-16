import { handler, ok, readJson, type IdContext } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { removeFolder, setFolderRecursive } from "@/lib/server/model-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = handler(async (req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return ok(await setFolderRecursive(getConfigStore(), id, body.recursive === true));
});

export const DELETE = handler(async (_req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  await removeFolder(getConfigStore(), id);
  return ok({ removed: true });
});
