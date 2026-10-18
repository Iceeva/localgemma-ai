import { handler, ok, readJson } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { resolveDataDir } from "@/lib/server/paths";
import { allowPathInput } from "@/lib/server/selection";
import { validateGenerationParams, validateSearchSettings, validateServerSettings } from "@/lib/server/validators";
import { getManager } from "@/lib/server/process-manager";
import { AppError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const store = getConfigStore();
  const config = await store.read();
  return ok({
    config,
    meta: {
      platform: process.platform,
      dialogsAvailable: process.platform === "win32",
      pathInputAllowed: allowPathInput(),
      dataDir: resolveDataDir(),
      configFile: store.file,
    },
  });
});

export const PUT = handler(async (req: Request) => {
  const body = await readJson(req);
  const store = getConfigStore();
  const status = await getManager().getStatus();
  const touchesServer = body.server !== undefined;
  if (touchesServer && (status.state === "starting" || status.state === "stopping")) {
    throw new AppError("SERVER_BUSY", "Le serveur est en cours de démarrage ou d'arrêt.", "Patientez puis réessayez.", 409);
  }
  const current = await store.read();
  const server = body.server !== undefined ? validateServerSettings(body.server as never, current.server) : current.server;
  const generation = body.generation !== undefined ? validateGenerationParams(body.generation as never, current.generation) : current.generation;
  const search = body.search !== undefined ? validateSearchSettings(body.search as never, current.search) : current.search;
  const next = await store.update((c) => {
    c.server = server;
    c.generation = generation;
    c.search = search;
  });
  return ok({ config: next, restartRequired: touchesServer && status.state === "running" });
});
