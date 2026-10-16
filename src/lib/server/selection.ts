import crypto from "node:crypto";
import { AppError } from "./errors";
import { assertSafeAbsolutePath } from "./validators";

export type SelectionKind = "engine" | "gguf" | "folder";

interface Ticket {
  kind: SelectionKind;
  path: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const g = globalThis as unknown as { __lgTickets?: Map<string, Ticket> };
const tickets = (): Map<string, Ticket> => (g.__lgTickets ??= new Map());

/**
 * Un « ticket » prouve qu'un chemin a été choisi par l'utilisateur dans un vrai sélecteur Windows.
 * Les routes d'enregistrement acceptent un ticket (à usage unique) et non un chemin libre envoyé par le navigateur.
 */
export function issueTicket(kind: SelectionKind, selectedPath: string): string {
  const now = Date.now();
  for (const [k, t] of tickets()) if (t.expiresAt < now) tickets().delete(k);
  const id = crypto.randomBytes(16).toString("hex");
  tickets().set(id, { kind, path: selectedPath, expiresAt: now + TTL_MS });
  return id;
}

export function allowPathInput(env: Record<string, string | undefined> = process.env): boolean {
  return env.LOCALGEMMA_ALLOW_PATH_INPUT === "1";
}

/** Retourne le chemin lié à un ticket valide (et consomme le ticket). */
export function consumeTicket(ticket: unknown, kind: SelectionKind): string {
  const t = typeof ticket === "string" ? tickets().get(ticket) : undefined;
  if (!t || t.kind !== kind || t.expiresAt < Date.now()) {
    throw new AppError(
      "TICKET_INVALID",
      "La sélection a expiré ou n'est pas valide.",
      "Recommencez en utilisant le bouton de sélection graphique.",
      400,
    );
  }
  tickets().delete(ticket as string);
  return t.path;
}

/** Résout le chemin d'une requête : ticket du sélecteur, ou chemin direct si le mode avancé est activé. */
export function resolveSelection(body: { ticket?: unknown; path?: unknown }, kind: SelectionKind, env: Record<string, string | undefined> = process.env): string {
  if (body.ticket !== undefined) return consumeTicket(body.ticket, kind);
  if (allowPathInput(env) && body.path !== undefined) return assertSafeAbsolutePath(body.path);
  throw new AppError(
    "TICKET_INVALID",
    "Aucune sélection graphique n'accompagne cette demande.",
    "Utilisez le bouton « Parcourir » : les chemins ne peuvent pas être saisis à la main.",
    400,
  );
}
