import { handler, ok, readJson } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { addModelFromPath, buildModelViews } from "@/lib/server/model-library";
import { getManager } from "@/lib/server/process-manager";
import { resolveSelection } from "@/lib/server/selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const manager = getManager();
  await manager.ensureRecovered();
  const cfg = await getConfigStore().read();
  const models = await buildModelViews(cfg, manager.snapshotActive(), manager.modelErrors);
  return ok({ models, selectedModelId: cfg.selectedModelId });
});

export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const file = resolveSelection(body, "gguf");
  return ok(await addModelFromPath(getConfigStore(), file), 201);
});
