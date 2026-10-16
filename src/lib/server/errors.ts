import type { ErrorPayload } from "@/types";

export type ErrorCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ENGINE_NOT_SET"
  | "ENGINE_NOT_FOUND"
  | "ENGINE_INVALID"
  | "ENGINE_START_FAILED"
  | "ENGINE_DLL_MISSING"
  | "ENGINE_CPU_UNSUPPORTED"
  | "MODEL_NOT_FOUND"
  | "MODEL_FILE_MISSING"
  | "MODEL_UNREADABLE"
  | "MODEL_INVALID"
  | "MODEL_INCOMPATIBLE"
  | "OUT_OF_MEMORY"
  | "PORT_IN_USE"
  | "START_TIMEOUT"
  | "SERVER_CRASHED"
  | "SERVER_NOT_RUNNING"
  | "SERVER_BUSY"
  | "SERVER_UNREACHABLE"
  | "CHAT_UPSTREAM_ERROR"
  | "CONTEXT_EXCEEDED"
  | "DIALOG_UNAVAILABLE"
  | "DIALOG_FAILED"
  | "TICKET_INVALID"
  | "CONFIG_CORRUPT"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, hint: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.hint = hint;
    this.status = status;
    this.details = details;
  }

  toPayload(): ErrorPayload {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details };
  }
}

export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof AppError) return err.toPayload();
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: "INTERNAL",
    message: "Une erreur inattendue s'est produite.",
    hint: "Réessayez. Si le problème persiste, consultez la console du serveur et le README (section dépannage).",
    details: message,
  };
}

export function statusOf(err: unknown): number {
  return err instanceof AppError ? err.status : 500;
}
