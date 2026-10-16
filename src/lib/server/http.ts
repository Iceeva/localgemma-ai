import { NextResponse } from "next/server";
import { AppError, statusOf, toErrorPayload } from "./errors";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function failure(err: unknown): NextResponse {
  return NextResponse.json({ error: toErrorPayload(err) }, { status: statusOf(err), headers: { "Cache-Control": "no-store" } });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* corps absent ou invalide */
  }
  throw new AppError("VALIDATION", "Le corps de la requête est invalide.", "Rechargez la page et réessayez.");
}

export async function readJsonOptional(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* ignoré */
  }
  throw new AppError("VALIDATION", "Le corps de la requête est invalide.", "Rechargez la page et réessayez.");
}

/** Enveloppe commune : les erreurs deviennent des réponses JSON structurées (message + action corrective). */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return failure(e);
    }
  };
}

export type IdContext = { params: Promise<{ id: string }> };
