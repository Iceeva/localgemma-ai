import type { MemorySettings } from "@/types";
import { getMode } from "@/lib/modes";
import { memoryPromptBlock } from "./memory";

/** Prompt système final : prompt de base + mode choisi + mémoire locale. */
export function composeSystemPrompt(opts: { base: string; modeId?: string | null; memory: MemorySettings }): string {
  return [opts.base.trim(), getMode(opts.modeId).prompt, memoryPromptBlock(opts.memory)].filter(Boolean).join("\n\n");
}
