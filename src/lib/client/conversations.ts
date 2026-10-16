/** Historique des conversations, stocké localement dans IndexedDB (aucun serveur, aucun compte). */
import type { GenerationParams } from "@/types";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  modelName?: string | null;
  stopped?: boolean;
  error?: string;
  tokensPerSecond?: number | null;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelId: string | null;
  modelName: string | null;
  messages: UiMessage[];
  params?: Partial<GenerationParams>;
}

const DB_NAME = "localgemma-ai";
const STORE = "conversations";
/** Clé sessionStorage : prompt suggéré à pré-remplir dans une nouvelle conversation. */
export const INITIAL_PROMPT_KEY = "lg-initial-prompt";
export const CONVERSATIONS_CHANGED = "lg-conversations-changed";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const notify = () => window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));

export async function listConversations(): Promise<Conversation[]> {
  const all = await tx<Conversation[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getConversation(id: string): Promise<Conversation | undefined> {
  return tx<Conversation | undefined>("readonly", (s) => s.get(id));
}
export async function saveConversation(c: Conversation): Promise<void> {
  await tx("readwrite", (s) => s.put(c));
  notify();
}
export async function deleteConversation(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  notify();
}

export function newConversation(id: string): Conversation {
  const now = new Date().toISOString();
  return { id, title: "Nouvelle conversation", createdAt: now, updatedAt: now, modelId: null, modelName: null, messages: [] };
}

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 47) + "…" : t || "Nouvelle conversation";
}

export function toMarkdown(c: Conversation): string {
  const head = `# ${c.title}\n\n*Modèle : ${c.modelName ?? "inconnu"} — créée le ${new Date(c.createdAt).toLocaleString("fr-FR")}*\n`;
  const body = c.messages.map((m) => `\n## ${m.role === "user" ? "Vous" : (m.modelName ?? "Assistant")}\n\n${m.content}\n`).join("");
  return head + body;
}

export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "conversation";
}
