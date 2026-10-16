import { handler, ok, readJson } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { verifyEngine } from "@/lib/server/engine";
import { resolveSelection } from "@/lib/server/selection";
import { inspectFile, validateEnginePath } from "@/lib/server/validators";
import { getManager } from "@/lib/server/process-manager";
import { AppError, toErrorPayload } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const cfg = await getConfigStore().read();
  let validation = null;
  if (cfg.enginePath) {
    try {
      await validateEnginePath(cfg.enginePath);
    } catch (e) {
      validation = toErrorPayload(e);
    }
  }
  return ok({
    path: cfg.enginePath,
    version: cfg.engineVersion,
    configured: cfg.enginePath !== null,
    valid: cfg.enginePath !== null && validation === null,
    validationError: validation,
    fileCheck: cfg.enginePath ? await inspectFile(cfg.enginePath) : null,
  });
});

/** Enregistre llama-server.exe choisi via le sélecteur graphique, après validation et test « --version ». */
export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const selected = resolveSelection(body, "engine");
  const status = await getManager().getStatus();
  if (status.state === "running" || status.state === "starting") {
    throw new AppError("SERVER_BUSY", "Arrêtez le modèle actif avant de changer de moteur.", "Utilisez « Arrêter le modèle » puis réessayez.", 409);
  }
  const abs = await validateEnginePath(selected);
  const check = await verifyEngine(abs);
  await getConfigStore().update((c) => {
    c.enginePath = abs;
    c.engineVersion = check.version;
  });
  return ok({ saved: true, check });
});
