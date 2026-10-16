import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigStore } from "@/lib/server/config-store";
import { AppError } from "@/lib/server/errors";
import {
  addFolder,
  addModelFromPath,
  buildModelViews,
  isListableGguf,
  relocateModel,
  removeFolder,
  removeModel,
  scanAllFolders,
  selectModel,
} from "@/lib/server/model-library";
import { tmpDir, writeGguf } from "./helpers";

async function env() {
  const dir = await tmpDir();
  return { dir, store: new ConfigStore(path.join(dir, "data")) };
}
const idle = { modelId: null, state: "stopped" as const };

describe("bibliothèque de modèles", () => {
  it("ajoute un modèle individuel avec ses métadonnées, sans le copier", async () => {
    const { dir, store } = await env();
    const f = await writeGguf(path.join(dir, "gemma-Q4_K_M.gguf"), { arch: "gemma2", name: "Gemma", fileType: 15, contextLength: 8192 });
    const { model, existing } = await addModelFromPath(store, f);
    expect(existing).toBe(false);
    expect(model).toMatchObject({ name: "Gemma", architecture: "gemma2", quantization: "Q4_K_M", quantizationSource: "metadata", contextLength: 8192, path: f });
    expect((await fs.readdir(dir)).sort()).toEqual(["data", "gemma-Q4_K_M.gguf"]); // aucune copie
  });

  it("n'enregistre pas deux fois le même fichier", async () => {
    const { dir, store } = await env();
    const f = await writeGguf(path.join(dir, "a.gguf"));
    await addModelFromPath(store, f);
    const again = await addModelFromPath(store, f);
    expect(again.existing).toBe(true);
    expect((await store.read()).models).toHaveLength(1);
  });

  it("indique la quantification d'après le nom quand les métadonnées l'ignorent", async () => {
    const { dir, store } = await env();
    const f = await writeGguf(path.join(dir, "petit-Q5_K_S.gguf"), { arch: "llama" });
    const { model } = await addModelFromPath(store, f);
    expect(model.quantization).toBe("Q5_K_S");
    expect(model.quantizationSource).toBe("filename");
  });

  it("retire un modèle de la bibliothèque sans supprimer le fichier", async () => {
    const { dir, store } = await env();
    const f = await writeGguf(path.join(dir, "a.gguf"));
    const { model } = await addModelFromPath(store, f);
    await selectModel(store, model.id);
    await removeModel(store, model.id);
    const cfg = await store.read();
    expect(cfg.models).toHaveLength(0);
    expect(cfg.selectedModelId).toBeNull();
    await expect(fs.stat(f)).resolves.toBeTruthy(); // le fichier original est intact
    await expect(removeModel(store, "inconnu")).rejects.toBeInstanceOf(AppError);
  });

  it("marque un fichier déplacé comme introuvable sans supprimer la référence, puis le relocalise", async () => {
    const { dir, store } = await env();
    const f = await writeGguf(path.join(dir, "a.gguf"), { name: "Alpha" });
    const { model } = await addModelFromPath(store, f);
    const moved = path.join(dir, "ailleurs", "a.gguf");
    await fs.mkdir(path.dirname(moved));
    await fs.rename(f, moved);

    let views = await buildModelViews(await store.read(), idle, new Map());
    expect(views[0]).toMatchObject({ status: "missing" });
    expect(views[0]?.fileCheck.exists).toBe(false);
    expect((await store.read()).models).toHaveLength(1); // référence conservée

    await relocateModel(store, model.id, moved);
    views = await buildModelViews(await store.read(), idle, new Map());
    expect(views[0]?.status).toBe("stopped");
    expect(views[0]?.id).toBe(model.id);
    expect(views[0]?.path).toBe(moved);
  });

  it("reflète l'état actif / en erreur dans les vues", async () => {
    const { dir, store } = await env();
    const a = (await addModelFromPath(store, await writeGguf(path.join(dir, "a.gguf")))).model;
    const b = (await addModelFromPath(store, await writeGguf(path.join(dir, "b.gguf")))).model;
    const errors = new Map([[b.id, { code: "OUT_OF_MEMORY", message: "m", hint: "h" }]]);
    const views = await buildModelViews(await store.read(), { modelId: a.id, state: "running" }, errors);
    expect(views.find((v) => v.id === a.id)?.status).toBe("active");
    expect(views.find((v) => v.id === b.id)?.status).toBe("error");
  });

  it("ignore les parties 2..N d'un modèle découpé et les fichiers mmproj", () => {
    expect(isListableGguf("m-00001-of-00003.gguf")).toBe(true);
    expect(isListableGguf("m-00002-of-00003.gguf")).toBe(false);
    expect(isListableGguf("mmproj-model-f16.gguf")).toBe(false);
    expect(isListableGguf("notes.txt")).toBe(false);
  });
});

describe("dossiers de modèles", () => {
  it("scanne un dossier (récursif ou non) et compte les modèles", async () => {
    const { dir, store } = await env();
    const root = path.join(dir, "modeles");
    await writeGguf(path.join(root, "un.gguf"));
    await writeGguf(path.join(root, "sous", "deux.gguf"));
    await writeGguf(path.join(root, "sous", "profond", "trois.gguf"));
    await fs.writeFile(path.join(root, "readme.txt"), "x");

    const flat = await addFolder(store, root, false);
    expect(flat.scan).toMatchObject({ found: 1, added: 1 });

    const cfg = await store.read();
    const id = cfg.folders[0]!.id;
    await store.update((c) => void (c.folders[0]!.recursive = true));
    const rec = await scanAllFolders(store);
    expect(rec[0]).toMatchObject({ folderId: id, found: 3, added: 2 });
    expect((await store.read()).models).toHaveLength(3);
    expect((await store.read()).folders[0]?.lastScanCount).toBe(3);
  });

  it("détecte les nouveaux fichiers à l'actualisation sans dupliquer", async () => {
    const { dir, store } = await env();
    const root = path.join(dir, "m");
    await writeGguf(path.join(root, "a.gguf"));
    await addFolder(store, root, true);
    await writeGguf(path.join(root, "b.gguf"));
    const [r] = await scanAllFolders(store);
    expect(r).toMatchObject({ found: 2, added: 1 });
    expect((await scanAllFolders(store))[0]).toMatchObject({ added: 0 });
  });

  it("un modèle retiré à la main n'est pas réajouté par l'actualisation", async () => {
    const { dir, store } = await env();
    const root = path.join(dir, "m");
    await writeGguf(path.join(root, "a.gguf"));
    await addFolder(store, root, true);
    const id = (await store.read()).models[0]!.id;
    await removeModel(store, id);
    await scanAllFolders(store);
    expect((await store.read()).models).toHaveLength(0);
    // …mais l'ajouter explicitement le rétablit.
    await addModelFromPath(store, path.join(root, "a.gguf"));
    expect((await store.read()).models).toHaveLength(1);
  });

  it("retirer un dossier ne supprime aucun fichier", async () => {
    const { dir, store } = await env();
    const root = path.join(dir, "m");
    const f = await writeGguf(path.join(root, "a.gguf"));
    const { folder } = await addFolder(store, root, false);
    await removeFolder(store, folder.id);
    const cfg = await store.read();
    expect(cfg.folders).toHaveLength(0);
    expect(cfg.models).toHaveLength(0);
    await expect(fs.stat(f)).resolves.toBeTruthy();
  });

  it("refuse un dossier inexistant", async () => {
    const { dir, store } = await env();
    await expect(addFolder(store, path.join(dir, "absent"), false)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("conserve la bibliothèque après redémarrage", async () => {
    const { dir, store } = await env();
    await addModelFromPath(store, await writeGguf(path.join(dir, "a.gguf"), { name: "Persistant" }));
    const again = new ConfigStore(store.dir);
    expect((await again.read()).models[0]?.name).toBe("Persistant");
  });
});
