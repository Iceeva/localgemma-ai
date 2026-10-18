import fs from "node:fs/promises";
import { constants as fsc } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FileCheck, GenerationParams, SearchSettings, ServerSettings } from "@/types";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/defaults";
import { AppError } from "./errors";

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  host: "127.0.0.1",
  port: 8080,
  // Valeurs prudentes pour un AMD A9-9410 (2 cœurs) avec 12 Go de RAM.
  contextSize: 2048,
  threads: 2,
  parallel: 1,
  startupTimeoutSec: 180,
};

export const DEFAULT_GENERATION: GenerationParams = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  maxTokens: 512,
  stream: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = { url: "", maxResults: 5, timeoutSec: 10, language: "fr" };

export function validateSearchSettings(input: Partial<Record<keyof SearchSettings, unknown>>, current: SearchSettings): SearchSettings {
  const out = { ...current };
  const errors: Record<string, string> = {};
  if (input.url !== undefined) {
    const raw = typeof input.url === "string" ? input.url.trim() : null;
    if (raw === "") out.url = "";
    else if (raw === null) errors.url = "L'adresse doit être du texte.";
    else {
      try {
        const u = new URL(raw);
        if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error("x");
        out.url = (u.origin + u.pathname).replace(/\/+$/, "");
      } catch {
        errors.url = "L'adresse doit être de la forme http://127.0.0.1:8888 (http ou https, sans identifiants).";
      }
    }
  }
  if (input.maxResults !== undefined) {
    const n = intIn(input.maxResults, 1, 10);
    if (n === null) errors.maxResults = "Le nombre de résultats doit être entre 1 et 10.";
    else out.maxResults = n;
  }
  if (input.timeoutSec !== undefined) {
    const n = intIn(input.timeoutSec, 1, 60);
    if (n === null) errors.timeoutSec = "Le délai doit être entre 1 et 60 secondes.";
    else out.timeoutSec = n;
  }
  if (input.language !== undefined) {
    if (typeof input.language === "string" && /^(all|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/.test(input.language.trim())) out.language = input.language.trim();
    else errors.language = "Langue invalide (ex. fr, en, fr-FR, all).";
  }
  if (Object.keys(errors).length) throw fieldError(errors);
  return out;
}

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

function fieldError(errors: Record<string, string>): AppError {
  return new AppError(
    "VALIDATION",
    "Certains paramètres sont invalides : " + Object.values(errors).join(" "),
    "Corrigez les champs signalés puis réessayez.",
    400,
    errors,
  );
}

function intIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function numIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export function validateServerSettings(input: Partial<Record<keyof ServerSettings, unknown>>, current: ServerSettings): ServerSettings {
  const out: ServerSettings = { ...current };
  const errors: Record<string, string> = {};

  if (input.host !== undefined) {
    if (typeof input.host === "string" && LOOPBACK_HOSTS.includes(input.host.trim().toLowerCase())) {
      out.host = input.host.trim().toLowerCase();
    } else {
      errors.host = "L'adresse d'écoute doit rester locale (127.0.0.1, localhost ou ::1).";
    }
  }
  const specs: Array<[keyof ServerSettings, number, number, string]> = [
    ["port", 1024, 65535, "Le port doit être un entier entre 1024 et 65535."],
    ["contextSize", 256, 131072, "Le contexte doit être un entier entre 256 et 131072."],
    ["threads", 1, 128, "Le nombre de threads doit être un entier entre 1 et 128."],
    ["parallel", 1, 16, "Le nombre de slots parallèles doit être un entier entre 1 et 16."],
    ["startupTimeoutSec", 1, 1800, "Le délai de démarrage doit être entre 1 et 1800 secondes."],
  ];
  for (const [key, min, max, msg] of specs) {
    if (input[key] === undefined) continue;
    const n = intIn(input[key], min, max);
    if (n === null) errors[key] = msg;
    else (out as unknown as Record<string, number>)[key] = n;
  }
  if (Object.keys(errors).length) throw fieldError(errors);
  return out;
}

export function validateGenerationParams(input: Partial<Record<keyof GenerationParams, unknown>>, current: GenerationParams): GenerationParams {
  const out: GenerationParams = { ...current };
  const errors: Record<string, string> = {};

  const t = input.temperature === undefined ? undefined : numIn(input.temperature, 0, 2);
  if (t === null) errors.temperature = "La température doit être entre 0 et 2.";
  else if (t !== undefined) out.temperature = t;

  const p = input.topP === undefined ? undefined : numIn(input.topP, 0, 1);
  if (p === null) errors.topP = "Top-p doit être entre 0 et 1.";
  else if (p !== undefined) out.topP = p;

  const k = input.topK === undefined ? undefined : intIn(input.topK, 0, 1000);
  if (k === null) errors.topK = "Top-k doit être un entier entre 0 et 1000 (0 = désactivé).";
  else if (k !== undefined) out.topK = k;

  const m = input.maxTokens === undefined ? undefined : intIn(input.maxTokens, 1, 32768);
  if (m === null) errors.maxTokens = "Le nombre maximal de tokens doit être entre 1 et 32768.";
  else if (m !== undefined) out.maxTokens = m;

  if (input.stream !== undefined) {
    if (typeof input.stream === "boolean") out.stream = input.stream;
    else errors.stream = "Le streaming doit être vrai ou faux.";
  }
  if (input.systemPrompt !== undefined) {
    if (typeof input.systemPrompt === "string" && input.systemPrompt.length <= 8000) out.systemPrompt = input.systemPrompt;
    else errors.systemPrompt = "Le prompt système doit être un texte de 8000 caractères maximum.";
  }
  if (Object.keys(errors).length) throw fieldError(errors);
  return out;
}

/** Chemin absolu, sans octet nul ni segment « .. » (anti-traversée). */
export function assertSafeAbsolutePath(p: unknown, label = "chemin"): string {
  if (typeof p !== "string" || p.trim() === "") {
    throw new AppError("VALIDATION", `Le ${label} est vide.`, "Sélectionnez un élément avec le sélecteur graphique.");
  }
  if (p.includes("\0")) {
    throw new AppError("VALIDATION", `Le ${label} contient un caractère interdit.`, "Resélectionnez l'élément.");
  }
  if (!path.isAbsolute(p)) {
    throw new AppError("VALIDATION", `Le ${label} doit être un chemin absolu.`, "Utilisez le bouton « Parcourir » pour sélectionner l'élément.");
  }
  const segments = p.split(/[\\/]+/);
  if (segments.includes("..")) {
    throw new AppError("VALIDATION", `Le ${label} contient « .. ».`, "Sélectionnez directement l'élément voulu.");
  }
  return path.normalize(p);
}

/** Clé de comparaison de chemins (insensible à la casse sous Windows). */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  const n = path.normalize(p);
  return platform === "win32" ? n.toLowerCase() : n;
}

export function makeId(seed: string): string {
  return crypto.createHash("sha1").update(seed + ":" + crypto.randomBytes(4).toString("hex")).digest("hex").slice(0, 12);
}

export async function inspectFile(p: string): Promise<FileCheck> {
  const extension = path.extname(p).toLowerCase();
  try {
    const st = await fs.stat(p);
    let readable = true;
    try {
      await fs.access(p, fsc.R_OK);
    } catch {
      readable = false;
    }
    return {
      exists: true,
      isFile: st.isFile(),
      readable,
      extension,
      sizeBytes: st.isFile() ? st.size : undefined,
      modifiedAt: st.mtime.toISOString(),
    };
  } catch {
    return { exists: false, isFile: false, readable: false, extension };
  }
}

const ENGINE_NAME = /^llama-server(\.exe)?$/i;

/** Vérifie que le chemin désigne un exécutable llama-server utilisable. Lève une AppError sinon. */
export async function validateEnginePath(p: unknown, platform: NodeJS.Platform = process.platform): Promise<string> {
  if (p === null || p === undefined || p === "") {
    throw new AppError(
      "ENGINE_NOT_SET",
      "Le moteur llama.cpp (llama-server.exe) n'est pas configuré.",
      "Ouvrez « Configuration locale » puis cliquez sur « Parcourir mon ordinateur » pour choisir llama-server.exe.",
      409,
    );
  }
  const abs = assertSafeAbsolutePath(p, "chemin de l'exécutable");
  const base = path.basename(abs);
  if (!ENGINE_NAME.test(base)) {
    throw new AppError(
      "ENGINE_INVALID",
      `Le fichier « ${base} » n'est pas un llama-server.`,
      "Choisissez le fichier nommé llama-server.exe dans le dossier de llama.cpp.",
    );
  }
  const check = await inspectFile(abs);
  if (!check.exists || !check.isFile) {
    throw new AppError(
      "ENGINE_NOT_FOUND",
      "llama-server.exe est introuvable à l'emplacement enregistré.",
      "Le fichier a peut-être été déplacé ou supprimé. Resélectionnez-le avec « Parcourir mon ordinateur ».",
      404,
    );
  }
  if (platform === "win32") {
    if (check.extension !== ".exe") {
      throw new AppError("ENGINE_INVALID", "Le fichier choisi n'est pas un exécutable Windows (.exe).", "Choisissez llama-server.exe.");
    }
  } else {
    try {
      await fs.access(abs, fsc.X_OK);
    } catch {
      throw new AppError("ENGINE_INVALID", "Le fichier choisi n'est pas exécutable.", "Vérifiez les droits d'exécution du fichier.");
    }
  }
  if (!check.readable) {
    throw new AppError("ENGINE_INVALID", "llama-server.exe n'est pas lisible.", "Vérifiez les droits d'accès du fichier.");
  }
  return abs;
}

/** Vérifie qu'un fichier est un GGUF lisible (extension + signature « GGUF »). */
export async function validateModelFile(p: unknown): Promise<{ path: string; check: FileCheck }> {
  const abs = assertSafeAbsolutePath(p, "chemin du modèle");
  if (path.extname(abs).toLowerCase() !== ".gguf") {
    throw new AppError("MODEL_INVALID", "Le fichier choisi n'a pas l'extension .gguf.", "Choisissez un fichier de modèle au format GGUF.");
  }
  const check = await inspectFile(abs);
  if (!check.exists || !check.isFile) {
    throw new AppError("MODEL_FILE_MISSING", "Le fichier du modèle est introuvable.", "Il a peut-être été déplacé : utilisez « Localiser à nouveau le fichier ».", 404);
  }
  if (!check.readable) {
    throw new AppError("MODEL_UNREADABLE", "Le fichier du modèle n'est pas lisible.", "Vérifiez les droits d'accès du fichier ou fermez le programme qui l'utilise.");
  }
  let magic = "";
  const fh = await fs.open(abs, "r");
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    magic = buf.subarray(0, bytesRead).toString("latin1");
  } finally {
    await fh.close();
  }
  if (magic !== "GGUF") {
    throw new AppError("MODEL_INVALID", "Ce fichier n'a pas la signature d'un modèle GGUF (fichier corrompu ou téléchargement incomplet ?).", "Retéléchargez le modèle ou choisissez un autre fichier .gguf.");
  }
  return { path: abs, check };
}
