import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, ErrorPayload, FolderEntry, ModelEntry, ModelStatus, ModelView, ScanResult, ServerState } from "@/types";
import type { ConfigStore } from "./config-store";
import { AppError } from "./errors";
import { quantizationFromFileName, readGgufMetadata } from "./gguf";
import { assertSafeAbsolutePath, inspectFile, makeId, pathKey, validateModelFile } from "./validators";

const MAX_DEPTH = 8;
const MAX_MODELS_PER_SCAN = 2000;

/** Fichiers à ne pas lister : parties 2..N d'un modèle découpé et projecteurs multimodaux (non chargeables seuls). */
export function isListableGguf(fileName: string): boolean {
  if (!fileName.toLowerCase().endsWith(".gguf")) return false;
  if (/^mmproj/i.test(fileName)) return false;
  const shard = fileName.match(/-(\d{5})-of-(\d{5})\.gguf$/i);
  if (shard && Number(shard[1]) !== 1) return false;
  return true;
}

async function buildEntry(file: string, source: "file" | "folder", folderId?: string): Promise<ModelEntry> {
  const { path: abs, check } = await validateModelFile(file);
  const fileName = path.basename(abs);
  let meta = null;
  try {
    meta = await readGgufMetadata(abs);
  } catch {
    meta = null;
  }
  const fromName = quantizationFromFileName(fileName);
  return {
    id: makeId(abs),
    name: meta?.name?.trim() || fileName.replace(/\.gguf$/i, ""),
    fileName,
    path: abs,
    source,
    folderId,
    addedAt: new Date().toISOString(),
    sizeBytes: check.sizeBytes,
    architecture: meta?.architecture,
    quantization: meta?.quantization ?? fromName,
    quantizationSource: meta?.quantization ? "metadata" : fromName ? "filename" : undefined,
    contextLength: meta?.contextLength,
    sizeLabel: meta?.sizeLabel,
  };
}

export async function addModelFromPath(store: ConfigStore, file: string): Promise<{ model: ModelEntry; existing: boolean }> {
  const entry = await buildEntry(file, "file");
  let result: { model: ModelEntry; existing: boolean } = { model: entry, existing: false };
  await store.update((c) => {
    const key = pathKey(entry.path);
    c.ignoredPaths = c.ignoredPaths.filter((p) => p !== key);
    const found = c.models.find((m) => pathKey(m.path) === key);
    if (found) {
      result = { model: found, existing: true };
      return;
    }
    c.models.push(entry);
  });
  return result;
}

export async function removeModel(store: ConfigStore, id: string): Promise<void> {
  let found = false;
  await store.update((c) => {
    const m = c.models.find((x) => x.id === id);
    if (!m) return;
    found = true;
    // Le fichier GGUF n'est jamais touché : seule la référence est retirée.
    c.models = c.models.filter((x) => x.id !== id);
    if (m.source === "folder") c.ignoredPaths.push(pathKey(m.path));
    if (c.selectedModelId === id) c.selectedModelId = null;
  });
  if (!found) throw new AppError("MODEL_NOT_FOUND", "Ce modèle n'est pas dans la bibliothèque.", "Actualisez la liste.", 404);
}

export async function relocateModel(store: ConfigStore, id: string, file: string): Promise<ModelEntry> {
  const fresh = await buildEntry(file, "file");
  let updated: ModelEntry | undefined;
  await store.update((c) => {
    const m = c.models.find((x) => x.id === id);
    if (!m) return;
    const key = pathKey(fresh.path);
    if (c.models.some((x) => x.id !== id && pathKey(x.path) === key)) {
      throw new AppError("VALIDATION", "Ce fichier est déjà enregistré sous un autre modèle.", "Retirez le doublon puis réessayez.");
    }
    m.path = fresh.path;
    m.fileName = fresh.fileName;
    m.sizeBytes = fresh.sizeBytes;
    m.architecture = fresh.architecture;
    m.quantization = fresh.quantization;
    m.quantizationSource = fresh.quantizationSource;
    m.contextLength = fresh.contextLength;
    m.sizeLabel = fresh.sizeLabel;
    m.source = "file";
    m.folderId = undefined;
    c.ignoredPaths = c.ignoredPaths.filter((p) => p !== key);
    updated = m;
  });
  if (!updated) throw new AppError("MODEL_NOT_FOUND", "Ce modèle n'est pas dans la bibliothèque.", "Actualisez la liste.", 404);
  return updated;
}

export async function selectModel(store: ConfigStore, id: string): Promise<void> {
  const cfg = await store.read();
  if (!cfg.models.some((m) => m.id === id)) throw new AppError("MODEL_NOT_FOUND", "Ce modèle n'est pas dans la bibliothèque.", "Actualisez la liste.", 404);
  await store.update((c) => {
    c.selectedModelId = id;
  });
}

export async function touchModelUsed(store: ConfigStore, id: string): Promise<void> {
  await store.update((c) => {
    const m = c.models.find((x) => x.id === id);
    if (m) m.lastUsedAt = new Date().toISOString();
  });
}

export async function addFolder(store: ConfigStore, dir: string, recursive: boolean): Promise<{ folder: FolderEntry; scan: ScanResult }> {
  const abs = assertSafeAbsolutePath(dir, "chemin du dossier");
  const st = await fs.stat(abs).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new AppError("NOT_FOUND", "Ce dossier est introuvable.", "Sélectionnez un dossier existant.", 404);
  }
  let folder: FolderEntry | undefined;
  await store.update((c) => {
    const key = pathKey(abs);
    folder = c.folders.find((f) => pathKey(f.path) === key);
    if (!folder) {
      folder = { id: makeId(abs), path: abs, recursive, addedAt: new Date().toISOString() };
      c.folders.push(folder);
    } else {
      folder.recursive = recursive;
    }
  });
  const scan = await scanFolder(store, (folder as FolderEntry).id);
  const cfg = await store.read();
  return { folder: cfg.folders.find((f) => f.id === (folder as FolderEntry).id) as FolderEntry, scan };
}

export async function setFolderRecursive(store: ConfigStore, id: string, recursive: boolean): Promise<ScanResult> {
  let ok = false;
  await store.update((c) => {
    const f = c.folders.find((x) => x.id === id);
    if (f) {
      f.recursive = recursive;
      ok = true;
    }
  });
  if (!ok) throw new AppError("NOT_FOUND", "Dossier inconnu.", "Actualisez la page.", 404);
  return scanFolder(store, id);
}

export async function removeFolder(store: ConfigStore, id: string): Promise<void> {
  let ok = false;
  await store.update((c) => {
    const f = c.folders.find((x) => x.id === id);
    if (!f) return;
    ok = true;
    // Seules les références sont retirées ; aucun fichier n'est supprimé du disque.
    c.folders = c.folders.filter((x) => x.id !== id);
    const gone = c.models.filter((m) => m.source === "folder" && m.folderId === id).map((m) => m.id);
    c.models = c.models.filter((m) => !gone.includes(m.id));
    if (c.selectedModelId && gone.includes(c.selectedModelId)) c.selectedModelId = null;
  });
  if (!ok) throw new AppError("NOT_FOUND", "Dossier inconnu.", "Actualisez la page.", 404);
}

async function walk(root: string, recursive: boolean): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  let truncated = false;
  async function visit(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // dossier inaccessible : ignoré
    }
    for (const e of entries) {
      if (files.length >= MAX_MODELS_PER_SCAN) {
        truncated = true;
        return;
      }
      const full = path.join(dir, e.name);
      if (e.isFile() && isListableGguf(e.name)) files.push(full);
      // Les liens symboliques ne sont pas suivis (évite les boucles et les sorties du dossier choisi).
      else if (e.isDirectory() && recursive && depth < MAX_DEPTH) await visit(full, depth + 1);
    }
  }
  await visit(root, 0);
  return { files, truncated };
}

export async function scanFolder(store: ConfigStore, folderId: string): Promise<ScanResult> {
  const cfg = await store.read();
  const folder = cfg.folders.find((f) => f.id === folderId);
  if (!folder) throw new AppError("NOT_FOUND", "Dossier inconnu.", "Actualisez la page.", 404);

  const { files, truncated } = await walk(folder.path, folder.recursive);
  const known = new Set(cfg.models.map((m) => pathKey(m.path)));
  const ignored = new Set(cfg.ignoredPaths);
  const fresh: ModelEntry[] = [];
  for (const f of files) {
    const key = pathKey(f);
    if (known.has(key) || ignored.has(key)) continue;
    try {
      fresh.push(await buildEntry(f, "folder", folderId));
    } catch {
      /* fichier illisible ou non GGUF : ignoré */
    }
  }
  let added = 0;
  await store.update((c) => {
    const f = c.folders.find((x) => x.id === folderId);
    if (!f) return;
    for (const m of fresh) {
      if (c.models.some((x) => pathKey(x.path) === pathKey(m.path))) continue;
      c.models.push(m);
      added++;
    }
    f.lastScanAt = new Date().toISOString();
    f.lastScanCount = files.length;
  });
  return { folderId, found: files.length, added, truncated };
}

export async function scanAllFolders(store: ConfigStore): Promise<ScanResult[]> {
  const cfg = await store.read();
  const out: ScanResult[] = [];
  for (const f of cfg.folders) out.push(await scanFolder(store, f.id));
  return out;
}

export interface ActiveInfo {
  modelId: string | null;
  state: ServerState;
}

export async function buildModelViews(config: AppConfig, active: ActiveInfo, errors: Map<string, ErrorPayload>): Promise<ModelView[]> {
  return Promise.all(
    config.models.map(async (m) => {
      const fileCheck = await inspectFile(m.path);
      let status: ModelStatus = "stopped";
      if (!fileCheck.exists || !fileCheck.isFile) status = "missing";
      else if (active.modelId === m.id && active.state === "running") status = "active";
      else if (active.modelId === m.id && (active.state === "starting" || active.state === "stopping")) status = "starting";
      else if (errors.has(m.id)) status = "error";
      return { ...m, sizeBytes: fileCheck.sizeBytes ?? m.sizeBytes, status, fileCheck, lastError: errors.get(m.id) };
    }),
  );
}
