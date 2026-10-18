import { handler, ok, readJson, type IdContext } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { deleteNote, updateNote } from "@/lib/server/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = handler(async (req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return ok({ note: await updateNote(getConfigStore(), id, body.text) });
});

export const DELETE = handler(async (_req: Request, ctx: IdContext) => {
  const { id } = await ctx.params;
  await deleteNote(getConfigStore(), id);
  return ok({ removed: true });
});
