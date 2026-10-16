import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, FolderEntry, ModelEntry } from "@/types";
import { resolveDataDir } from "./paths";
import { DEFAULT_GENERATION, DEFAULT_SERVER_SETTINGS, validateGenerationParams, validateServerSettings } from "./validators";

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    enginePath: null,
    engineVersion: null,
    folders: [],
    models: [],
    selectedModelId: null,
    ignoredPaths: [],
    server: { ...DEFAULT_SERVER_SETTINGS },
    generation: { ...DEFAULT_GENERATION },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Reconstruit une configuration valide à partir de données lues sur disque (tolérant). */
export function sanitizeConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  if (!isObj(raw)) return base;

  base.enginePath = str(raw.enginePath) ?? null;
  base.engineVersion = str(raw.engineVersion) ?? null;
  base.selectedModelId = str(raw.selectedModelId) ?? null;

  if (Array.isArray(raw.ignoredPaths)) base.ignoredPaths = raw.ignoredPaths.filter((x): x is string => typeof x === "string");

  if (Array.isArray(raw.folders)) {
    for (const f of raw.folders) {
      if (!isObj(f) || !str(f.id) || !str(f.path)) continue;
      const entry: FolderEntry = {
        id: f.id as string,
        path: f.path as string,
        recursive: f.recursive === true,
        addedAt: str(f.addedAt) ?? new Date().toISOString(),
        lastScanAt: str(f.lastScanAt),
        lastScanCount: num(f.lastScanCount),
      };
      base.folders.push(entry);
    }
  }
  if (Array.isArray(raw.models)) {
    for (const m of raw.models) {
      if (!isObj(m) || !str(m.id) || !str(m.path)) continue;
      const entry: ModelEntry = {
        id: m.id as string,
        path: m.path as string,
        name: str(m.name) ?? (m.path as string),
        fileName: str(m.fileName) ?? path.basename(m.path as string),
        source: m.source === "folder" ? "folder" : "file",
        folderId: str(m.folderId),
        addedAt: str(m.addedAt) ?? new Date().toISOString(),
        lastUsedAt: str(m.lastUsedAt),
        sizeBytes: num(m.sizeBytes),
        architecture: str(m.architecture),
        quantization: str(m.quantization),
        quantizationSource: m.quantizationSource === "filename" ? "filename" : m.quantizationSource === "metadata" ? "metadata" : undefined,
        contextLength: num(m.contextLength),
        sizeLabel: str(m.sizeLabel),
      };
      base.models.push(entry);
    }
  }
  if (isObj(raw.server)) {
    try {
      base.server = validateServerSettings(raw.server as never, base.server);
    } catch {
      /* valeurs par défaut conservées */
    }
  }
  if (isObj(raw.generation)) {
    try {
      base.generation = validateGenerationParams(raw.generation as never, base.generation);
    } catch {
      /* valeurs par défaut conservées */
    }
  }
  return base;
}

export class ConfigStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {}

  get file(): string {
    return path.join(this.dir, "config.json");
  }

  async read(): Promise<AppConfig> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig();
      throw e;
    }
    try {
      return sanitizeConfig(JSON.parse(text));
    } catch {
      // Fichier corrompu : on le conserve de côté plutôt que de le perdre silencieusement.
      const backup = path.join(this.dir, `config.corrupt-${Date.now()}.json`);
      await fs.rename(this.file, backup).catch(() => undefined);
      return defaultConfig();
    }
  }

  /** Lecture-modification-écriture sérialisée (pas de perte en cas d'appels concurrents). */
  update(mutator: (config: AppConfig) => AppConfig | void): Promise<AppConfig> {
    const run = async (): Promise<AppConfig> => {
      const current = await this.read();
      const result = mutator(current);
      const next = sanitizeConfig(result ?? current);
      await this.write(next);
      return next;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async write(config: AppConfig): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), "utf8");
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, this.file);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (attempt < 5 && (code === "EPERM" || code === "EBUSY")) {
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
          continue;
        }
        await fs.rm(tmp, { force: true });
        throw e;
      }
    }
  }
}

const g = globalThis as unknown as { __lgConfigStores?: Map<string, ConfigStore> };

/** Instance unique par dossier de données (survit au rechargement à chaud de Next.js). */
export function getConfigStore(dir: string = resolveDataDir()): ConfigStore {
  g.__lgConfigStores ??= new Map();
  let store = g.__lgConfigStores.get(dir);
  if (!store) {
    store = new ConfigStore(dir);
    g.__lgConfigStores.set(dir, store);
  }
  return store;
}
