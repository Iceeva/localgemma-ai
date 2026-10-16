import os from "node:os";
import path from "node:path";

/** Dossier de données persistantes (config.json, server.pid.json). */
export function resolveDataDir(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env.LOCALGEMMA_DATA_DIR && env.LOCALGEMMA_DATA_DIR.trim()) {
    return path.resolve(env.LOCALGEMMA_DATA_DIR.trim());
  }
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "LocalGemmaAI");
  }
  return path.join(home, ".localgemma-ai");
}
