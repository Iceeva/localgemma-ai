/** Types partagés entre le serveur Node.js et l'interface (aucune dépendance Node ici). */

export interface GenerationParams {
  temperature: number;
  topP: number;
  /** 0 = désactivé */
  topK: number;
  maxTokens: number;
  stream: boolean;
  systemPrompt: string;
}

export interface ServerSettings {
  /** Toujours une adresse de boucle locale (voir validators.ts). */
  host: string;
  port: number;
  contextSize: number;
  threads: number;
  /** Nombre de « slots » parallèles (--parallel). 1 évite de diviser le contexte. */
  parallel: number;
  startupTimeoutSec: number;
}

export interface FolderEntry {
  id: string;
  path: string;
  recursive: boolean;
  addedAt: string;
  lastScanAt?: string;
  lastScanCount?: number;
}

export interface ModelEntry {
  id: string;
  name: string;
  fileName: string;
  path: string;
  source: "file" | "folder";
  folderId?: string;
  addedAt: string;
  lastUsedAt?: string;
  sizeBytes?: number;
  architecture?: string;
  quantization?: string;
  quantizationSource?: "metadata" | "filename";
  contextLength?: number;
  sizeLabel?: string;
}

export interface AppConfig {
  version: 1;
  enginePath: string | null;
  engineVersion: string | null;
  folders: FolderEntry[];
  models: ModelEntry[];
  selectedModelId: string | null;
  /** Chemins (normalisés) retirés de la bibliothèque : ignorés lors des actualisations de dossiers. */
  ignoredPaths: string[];
  server: ServerSettings;
  generation: GenerationParams;
}

export interface ErrorPayload {
  code: string;
  message: string;
  /** Action corrective compréhensible par un utilisateur non expert. */
  hint: string;
  details?: unknown;
}

export type ModelStatus = "stopped" | "starting" | "active" | "missing" | "error";

export interface FileCheck {
  exists: boolean;
  isFile: boolean;
  readable: boolean;
  extension: string;
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface ModelView extends ModelEntry {
  status: ModelStatus;
  fileCheck: FileCheck;
  lastError?: ErrorPayload;
}

export type ServerState = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ServerStatus {
  state: ServerState;
  modelId: string | null;
  modelName: string | null;
  pid: number | null;
  /** true si le processus a été lancé par cette application (sinon : processus récupéré). */
  managed: boolean;
  host: string;
  port: number;
  contextSize: number | null;
  startedAt: string | null;
  healthy: boolean;
  healthDetail: string | null;
  error: ErrorPayload | null;
  engineConfigured: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface EngineCheck {
  ok: boolean;
  path: string | null;
  version: string | null;
  output?: string;
  error?: ErrorPayload;
}

export interface ScanResult {
  folderId: string;
  found: number;
  added: number;
  truncated: boolean;
}
