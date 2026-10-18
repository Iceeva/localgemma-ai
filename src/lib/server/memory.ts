import type { MemoryNote, MemorySettings } from "@/types";
import type { ConfigStore } from "./config-store";
import { AppError } from "./errors";
import { makeId } from "./validators";

export const MAX_NOTES = 50;
export const MAX_NOTE_CHARS = 300;
const MAX_PROMPT_CHARS = 1500;

export function cleanNote(text: unknown): string {
  const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (t.length < 2 || t.length > MAX_NOTE_CHARS) {
    throw new AppError("VALIDATION", `Une note doit contenir entre 2 et ${MAX_NOTE_CHARS} caractères.`, "Raccourcissez ou précisez la note.");
  }
  return t;
}

export async function addNote(store: ConfigStore, text: unknown): Promise<{ note: MemoryNote; existing: boolean }> {
  const t = cleanNote(text);
  let result: { note: MemoryNote; existing: boolean } | undefined;
  await store.update((c) => {
    const dup = c.memory.notes.find((n) => n.text.toLowerCase() === t.toLowerCase());
    if (dup) {
      result = { note: dup, existing: true };
      return;
    }
    if (c.memory.notes.length >= MAX_NOTES) {
      throw new AppError("VALIDATION", `La mémoire est pleine (${MAX_NOTES} notes).`, "Supprimez des notes devenues inutiles.");
    }
    const note: MemoryNote = { id: makeId(t), text: t, createdAt: new Date().toISOString() };
    c.memory.notes.push(note);
    result = { note, existing: false };
  });
  return result as { note: MemoryNote; existing: boolean };
}

export async function updateNote(store: ConfigStore, id: string, text: unknown): Promise<MemoryNote> {
  const t = cleanNote(text);
  let found: MemoryNote | undefined;
  await store.update((c) => {
    found = c.memory.notes.find((n) => n.id === id);
    if (found) found.text = t;
  });
  if (!found) throw new AppError("NOT_FOUND", "Cette note n'existe pas.", "Actualisez la liste.", 404);
  return found;
}

export async function deleteNote(store: ConfigStore, id: string): Promise<void> {
  let removed = false;
  await store.update((c) => {
    const before = c.memory.notes.length;
    c.memory.notes = c.memory.notes.filter((n) => n.id !== id);
    removed = c.memory.notes.length < before;
  });
  if (!removed) throw new AppError("NOT_FOUND", "Cette note n'existe pas.", "Actualisez la liste.", 404);
}

export async function setMemoryEnabled(store: ConfigStore, enabled: boolean): Promise<void> {
  await store.update((c) => {
    c.memory.enabled = enabled;
  });
}

/** Bloc de prompt listant les notes (vide si la mémoire est désactivée ou sans note). */
export function memoryPromptBlock(memory: MemorySettings): string {
  if (!memory.enabled || memory.notes.length === 0) return "";
  const lines: string[] = [];
  let size = 0;
  for (const n of memory.notes) {
    if (size + n.text.length > MAX_PROMPT_CHARS) break;
    lines.push(`- ${n.text}`);
    size += n.text.length;
  }
  return `Informations mémorisées par l'utilisateur (à utiliser seulement si elles sont pertinentes, sans les répéter inutilement) :\n${lines.join("\n")}`;
}
