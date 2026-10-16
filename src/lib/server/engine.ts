import { spawn } from "node:child_process";
import path from "node:path";
import type { EngineCheck } from "@/types";
import { AppError, toErrorPayload } from "./errors";
import { classifyFailure } from "./diagnose";
import { validateEnginePath } from "./validators";

/** Exécute « llama-server --version » (sans shell) pour vérifier que le binaire démarre et lire sa version. */
export async function verifyEngine(enginePath: string | null, timeoutMs = 20000): Promise<EngineCheck> {
  let abs: string;
  try {
    abs = await validateEnginePath(enginePath);
  } catch (e) {
    return { ok: false, path: enginePath, version: null, error: toErrorPayload(e) };
  }
  return new Promise<EngineCheck>((resolve) => {
    let output = "";
    let done = false;
    const finish = (r: EngineCheck) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(r);
      }
    };
    let child;
    try {
      child = spawn(abs, ["--version"], { shell: false, windowsHide: true, cwd: path.dirname(abs), stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      finish({ ok: false, path: abs, version: null, error: toErrorPayload(e) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        path: abs,
        version: null,
        output,
        error: new AppError("ENGINE_START_FAILED", "Le moteur ne répond pas à « --version ».", "Vérifiez que le fichier est bien llama-server.exe d'une version officielle de llama.cpp.", 500).toPayload(),
      });
    }, timeoutMs);
    const collect = (d: Buffer) => (output += d.toString("utf8"));
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (e) =>
      finish({
        ok: false,
        path: abs,
        version: null,
        error: new AppError("ENGINE_START_FAILED", "Impossible de lancer llama-server.exe : " + e.message, "Vérifiez les droits d'accès et l'antivirus, puis resélectionnez le fichier.", 500).toPayload(),
      }),
    );
    child.on("close", (code) => {
      if (code === 0) {
        const m = output.match(/version:\s*([^\r\n]+)/i);
        finish({ ok: true, path: abs, version: m?.[1]?.trim() ?? (output.trim().split(/\r?\n/)[0] || null), output: output.trim() });
      } else {
        finish({ ok: false, path: abs, version: null, output, error: classifyFailure(output.split(/\r?\n/), code).toPayload() });
      }
    });
  });
}
