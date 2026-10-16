import { handler, ok, readJson } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { addFolder } from "@/lib/server/model-library";
import { resolveSelection } from "@/lib/server/selection";
import { inspectFile } from "@/lib/server/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const cfg = await getConfigStore().read();
  const folders = await Promise.all(
    cfg.folders.map(async (f) => ({
      ...f,
      exists: (await inspectFile(f.path)).exists,
      modelCount: cfg.models.filter((m) => m.folderId === f.id).length,
    })),
  );
  return ok({ folders });
});

export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const dir = resolveSelection(body, "folder");
  const result = await addFolder(getConfigStore(), dir, body.recursive === true);
  return ok(result, 201);
});
