import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigStore, defaultConfig, sanitizeConfig } from "@/lib/server/config-store";
import { resolveDataDir } from "@/lib/server/paths";
import { tmpDir } from "./helpers";

describe("configuration persistante", () => {
  it("retourne les valeurs par défaut prudentes quand rien n'est enregistré", async () => {
    const store = new ConfigStore(await tmpDir());
    const cfg = await store.read();
    expect(cfg.enginePath).toBeNull();
    expect(cfg.models).toEqual([]);
    expect(cfg.server.contextSize).toBe(2048);
    expect(cfg.server.threads).toBe(2);
    expect(cfg.server.host).toBe("127.0.0.1");
  });

  it("enregistre puis relit la configuration (persistance après redémarrage)", async () => {
    const dir = await tmpDir();
    await new ConfigStore(dir).update((c) => {
      c.enginePath = "C:\\llama\\llama-server.exe";
      c.folders.push({ id: "f1", path: "D:\\modeles", recursive: true, addedAt: "2026-01-01T00:00:00Z" });
      c.server.port = 8123;
      c.generation.temperature = 0.3;
      c.selectedModelId = "m1";
    });
    // Nouvelle instance = redémarrage de l'application.
    const reloaded = await new ConfigStore(dir).read();
    expect(reloaded.enginePath).toBe("C:\\llama\\llama-server.exe");
    expect(reloaded.folders[0]?.recursive).toBe(true);
    expect(reloaded.server.port).toBe(8123);
    expect(reloaded.generation.temperature).toBe(0.3);
    expect(reloaded.selectedModelId).toBe("m1");
  });

  it("ne perd aucune mise à jour lors d'appels concurrents", async () => {
    const store = new ConfigStore(await tmpDir());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update((c) => {
          c.ignoredPaths.push(`p${i}`);
        }),
      ),
    );
    expect((await store.read()).ignoredPaths).toHaveLength(20);
  });

  it("met de côté un fichier corrompu au lieu de le perdre", async () => {
    const dir = await tmpDir();
    const store = new ConfigStore(dir);
    await fs.writeFile(path.join(dir, "config.json"), "{ pas du json", "utf8");
    const cfg = await store.read();
    expect(cfg).toEqual(defaultConfig());
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.startsWith("config.corrupt-"))).toBe(true);
  });

  it("assainit des valeurs invalides sans planter", () => {
    const cfg = sanitizeConfig({ server: { port: -5, contextSize: "abc" }, models: [{ nope: 1 }, { id: "a", path: "/x/a.gguf" }], folders: "x" });
    expect(cfg.server.port).toBe(8080);
    expect(cfg.models).toHaveLength(1);
    expect(cfg.models[0]?.fileName).toBe("a.gguf");
    expect(cfg.folders).toEqual([]);
  });

  it("choisit le dossier de données selon la plateforme", () => {
    expect(resolveDataDir({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "win32", "C:\\Users\\x")).toMatch(/LocalGemmaAI$/);
    expect(resolveDataDir({ LOCALGEMMA_DATA_DIR: "/tmp/lg" }, "linux", "/home/x")).toBe("/tmp/lg");
    expect(resolveDataDir({}, "linux", "/home/x")).toBe("/home/x/.localgemma-ai");
  });
});
