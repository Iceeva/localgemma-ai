import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/server/errors";
import {
  assertSafeAbsolutePath,
  DEFAULT_GENERATION,
  DEFAULT_SERVER_SETTINGS,
  inspectFile,
  validateEnginePath,
  validateGenerationParams,
  validateModelFile,
  validateServerSettings,
} from "@/lib/server/validators";
import { ensureEngineExecutable, FAKE_ENGINE, tmpDir, writeGguf } from "./helpers";

beforeAll(ensureEngineExecutable);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof AppError ? e.code : "AUTRE";
  }
}

describe("validation des paramètres", () => {
  it("accepte des paramètres valides, y compris sous forme de texte", () => {
    const s = validateServerSettings({ port: "8081", contextSize: 4096, threads: 2 }, DEFAULT_SERVER_SETTINGS);
    expect(s.port).toBe(8081);
    expect(s.contextSize).toBe(4096);
  });

  it.each([
    [{ port: 80 }, "port"],
    [{ port: 70000 }, "port"],
    [{ port: 8080.5 }, "port"],
    [{ contextSize: 10 }, "contextSize"],
    [{ threads: 0 }, "threads"],
    [{ threads: "beaucoup" }, "threads"],
    [{ host: "0.0.0.0" }, "host"],
    [{ host: "192.168.1.20" }, "host"],
  ])("refuse %j", (input, field) => {
    try {
      validateServerSettings(input as never, DEFAULT_SERVER_SETTINGS);
      throw new Error("aurait dû échouer");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("VALIDATION");
      expect(Object.keys((e as AppError).details as object)).toContain(field);
    }
  });

  it("n'accepte que des adresses d'écoute locales", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      expect(validateServerSettings({ host }, DEFAULT_SERVER_SETTINGS).host).toBe(host);
    }
  });

  it("valide les paramètres de génération", () => {
    const g = validateGenerationParams({ temperature: 1.2, topP: 0.5, topK: 0, maxTokens: 256, stream: false }, DEFAULT_GENERATION);
    expect(g).toMatchObject({ temperature: 1.2, topP: 0.5, topK: 0, maxTokens: 256, stream: false });
    expect(() => validateGenerationParams({ temperature: 5 }, DEFAULT_GENERATION)).toThrow(AppError);
    expect(() => validateGenerationParams({ topP: -1 }, DEFAULT_GENERATION)).toThrow(AppError);
    expect(() => validateGenerationParams({ maxTokens: 0 }, DEFAULT_GENERATION)).toThrow(AppError);
    expect(() => validateGenerationParams({ stream: "oui" }, DEFAULT_GENERATION)).toThrow(AppError);
  });
});

describe("validation des chemins", () => {
  it("refuse les chemins relatifs, vides, avec octet nul ou traversée", () => {
    expect(() => assertSafeAbsolutePath("modele.gguf")).toThrow(AppError);
    expect(() => assertSafeAbsolutePath("")).toThrow(AppError);
    expect(() => assertSafeAbsolutePath("/tmp/a\0b")).toThrow(AppError);
    expect(() => assertSafeAbsolutePath("/tmp/../etc/passwd")).toThrow(AppError);
    expect(assertSafeAbsolutePath("/tmp/ok/modele.gguf")).toBe(path.normalize("/tmp/ok/modele.gguf"));
  });

  it("valide le moteur : non configuré, introuvable, mauvais nom, valide", async () => {
    const dir = await tmpDir();
    expect(await code(validateEnginePath(null))).toBe("ENGINE_NOT_SET");
    expect(await code(validateEnginePath(path.join(dir, "llama-server")))).toBe("ENGINE_NOT_FOUND");
    const other = path.join(dir, "autre-programme");
    await fs.writeFile(other, "x");
    expect(await code(validateEnginePath(other))).toBe("ENGINE_INVALID");
    expect(await validateEnginePath(FAKE_ENGINE)).toBe(FAKE_ENGINE);
  });

  it("exige un .exe sous Windows", async () => {
    expect(await code(validateEnginePath(FAKE_ENGINE, "win32"))).toBe("ENGINE_INVALID");
  });

  it("refuse un moteur sans droit d'exécution", async () => {
    const dir = await tmpDir();
    const f = path.join(dir, "llama-server");
    await fs.writeFile(f, "#!/bin/sh\n");
    await fs.chmod(f, 0o644);
    expect(await code(validateEnginePath(f))).toBe("ENGINE_INVALID");
  });

  it("détecte un modèle manquant, mal nommé, corrompu, ou valide", async () => {
    const dir = await tmpDir();
    expect(await code(validateModelFile(path.join(dir, "absent.gguf")))).toBe("MODEL_FILE_MISSING");
    const txt = path.join(dir, "notes.txt");
    await fs.writeFile(txt, "x");
    expect(await code(validateModelFile(txt))).toBe("MODEL_INVALID");
    const bad = path.join(dir, "faux.gguf");
    await fs.writeFile(bad, "pas un gguf du tout");
    expect(await code(validateModelFile(bad))).toBe("MODEL_INVALID");
    const good = await writeGguf(path.join(dir, "bon.gguf"));
    const res = await validateModelFile(good);
    expect(res.check.exists && res.check.readable).toBe(true);
    expect(res.check.sizeBytes).toBeGreaterThan(24);
  });

  it("décrit un fichier (existence, taille, extension, date)", async () => {
    const dir = await tmpDir();
    const f = await writeGguf(path.join(dir, "m.gguf"));
    const c = await inspectFile(f);
    expect(c).toMatchObject({ exists: true, isFile: true, readable: true, extension: ".gguf" });
    expect(c.modifiedAt).toBeTruthy();
    expect((await inspectFile(path.join(dir, "nope.gguf"))).exists).toBe(false);
  });
});
