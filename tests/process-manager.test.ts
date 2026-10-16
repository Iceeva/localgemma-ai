import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ConfigStore } from "@/lib/server/config-store";
import { addModelFromPath, buildModelViews } from "@/lib/server/model-library";
import { ProcessManager } from "@/lib/server/process-manager";
import { defaultInspector } from "@/lib/server/process-inspector";
import { ensureEngineExecutable, FAKE_ENGINE, getFreePort, sleep, tmpDir, writeGguf } from "./helpers";

beforeAll(ensureEngineExecutable);

const managers: ProcessManager[] = [];
const strays: ChildProcess[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.stop().catch(() => undefined);
  for (const c of strays.splice(0)) c.kill("SIGKILL");
});

async function setup(models: string[] = ["alpha", "beta"], timeoutSec = 20) {
  const dir = await tmpDir();
  const dataDir = path.join(dir, "data");
  const store = new ConfigStore(dataDir);
  const port = await getFreePort();
  const ids: Record<string, string> = {};
  for (const n of models) {
    ids[n] = (await addModelFromPath(store, await writeGguf(path.join(dir, "models", `${n}.gguf`), { name: n }))).model.id;
  }
  await store.update((c) => {
    c.enginePath = FAKE_ENGINE;
    c.server.port = port;
    c.server.startupTimeoutSec = timeoutSec;
  });
  const make = (extra: Partial<ConstructorParameters<typeof ProcessManager>[0]> = {}) => {
    const m = new ProcessManager({ store, dataDir, pollIntervalMs: 50, stopGraceMs: 2000, ...extra });
    managers.push(m);
    return m;
  };
  return { dir, dataDir, store, port, ids, make };
}

const alive = (pid: number) => defaultInspector.isAlive(pid);
async function waitFor(cond: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
}

describe("démarrage et arrêt du processus géré", () => {
  it("démarre un modèle, attend l'API, puis l'arrête proprement", async () => {
    const { make, ids, store, port } = await setup();
    const m = make();
    const status = await m.start(ids.alpha!);

    expect(status).toMatchObject({ state: "running", healthy: true, managed: true, modelId: ids.alpha, modelName: "alpha", port, contextSize: 2048 });
    expect(status.pid).toBeGreaterThan(0);
    const logs = m.getLogs().lines.map((l) => l.text).join("\n");
    expect(logs).toContain("model=alpha.gguf ctx=2048 threads=2 parallel=1");

    const cfg = await store.read();
    expect(cfg.selectedModelId).toBe(ids.alpha);
    expect(cfg.models.find((x) => x.id === ids.alpha)?.lastUsedAt).toBeTruthy();

    const pid = status.pid!;
    const stopped = await m.stop();
    expect(stopped).toMatchObject({ state: "stopped", pid: null, modelId: null, healthy: false });
    expect(await waitFor(() => !alive(pid))).toBe(true);
    expect((await m.testConnection()).ok).toBe(false);
  });

  it("transmet les paramètres de lancement configurés, sans passer par un shell", async () => {
    const { make, ids, store } = await setup();
    await store.update((c) => {
      c.server.contextSize = 1024;
      c.server.threads = 1;
    });
    const m = make();
    await m.start(ids.alpha!);
    expect(m.getLogs().lines.map((l) => l.text).join("\n")).toContain("ctx=1024 threads=1 parallel=1");
  });

  it("un seul modèle à la fois : changer de modèle arrête l'ancien", async () => {
    const { make, ids } = await setup();
    const m = make();
    const a = await m.start(ids.alpha!);
    const b = await m.start(ids.beta!);
    expect(b).toMatchObject({ state: "running", modelId: ids.beta, modelName: "beta" });
    expect(b.pid).not.toBe(a.pid);
    expect(await waitFor(() => !alive(a.pid!))).toBe(true);
    // L'API répond bien avec le NOUVEAU modèle.
    const res = await fetch(`http://127.0.0.1:${b.port}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], stream: false }) });
    expect(JSON.stringify(await res.json())).toContain("beta.gguf");
  });

  it("redémarrer le même modèle n'en lance pas un second", async () => {
    const { make, ids } = await setup();
    const m = make();
    const a = await m.start(ids.alpha!);
    const again = await m.start(ids.alpha!);
    expect(again.pid).toBe(a.pid);
    const r = await m.restart();
    expect(r.state).toBe("running");
    expect(r.pid).not.toBe(a.pid);
  });

  it("annule un démarrage en cours quand on demande l'arrêt", async () => {
    const { make, ids } = await setup(["slowload"]);
    const m = make();
    const caught = m.start(ids.slowload!).catch((e) => e);
    await waitFor(() => m.snapshotActive().state === "starting");
    await m.stop();
    expect(await caught).toMatchObject({ code: "SERVER_NOT_RUNNING" });
    expect((await m.getStatus()).state).toBe("stopped");
  });
});

describe("erreurs de démarrage", () => {
  it("détecte un port occupé avant de lancer le processus", async () => {
    const { make, ids, port, store } = await setup();
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(port, "127.0.0.1", r));
    try {
      const m = make();
      await expect(m.start(ids.alpha!)).rejects.toMatchObject({ code: "PORT_IN_USE" });
      const status = await m.getStatus();
      expect(status.state).toBe("error");
      expect(status.error?.hint).toMatch(/port/i);
      const views = await buildModelViews(await store.read(), m.snapshotActive(), m.modelErrors);
      expect(views.find((v) => v.id === ids.alpha)?.status).toBe("error");
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });

  it("explique l'échec de chargement d'un modèle incompatible", async () => {
    const { make, ids } = await setup(["crash"]);
    const m = make();
    const err = await m.start(ids.crash!).catch((e) => e);
    expect(err).toMatchObject({ code: "MODEL_INCOMPATIBLE" });
    expect(err.hint).toMatch(/llama\.cpp|retéléchar/i);
    expect((await m.getStatus()).state).toBe("error");
    expect((await m.getStatus()).modelId).toBe(ids.crash); // jamais déclaré « actif »
    expect(m.snapshotActive().state).toBe("error");
  });

  it("détecte la mémoire insuffisante", async () => {
    const { make, ids } = await setup(["oom"]);
    await expect(make().start(ids.oom!)).rejects.toMatchObject({ code: "OUT_OF_MEMORY" });
  });

  it("refuse de démarrer sans moteur configuré", async () => {
    const { make, ids, store } = await setup();
    await store.update((c) => void (c.enginePath = null));
    await expect(make().start(ids.alpha!)).rejects.toMatchObject({ code: "ENGINE_NOT_SET" });
  });

  it("refuse de démarrer un modèle dont le fichier a disparu", async () => {
    const { make, ids, store } = await setup();
    const cfg = await store.read();
    await fs.rm(cfg.models.find((m) => m.id === ids.alpha)!.path);
    const m = make();
    await expect(m.start(ids.alpha!)).rejects.toMatchObject({ code: "MODEL_FILE_MISSING" });
    expect(m.modelErrors.get(ids.alpha!)?.code).toBe("MODEL_FILE_MISSING");
  });

  it("refuse un modèle inconnu de la bibliothèque (jamais de chemin libre)", async () => {
    const { make } = await setup();
    await expect(make().start("/etc/passwd")).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
  });

  it("signale un démarrage trop long et arrête le processus", async () => {
    const { make, ids } = await setup(["alpha"], 1);
    let child: ChildProcess | undefined;
    const m = make({
      // Processus qui ne répond jamais sur /health.
      spawn: ((_cmd: string, _args: readonly string[], opts: object) => {
        child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], opts as never);
        return child;
      }) as never,
    });
    const err = await m.start(ids.alpha!).catch((e) => e);
    expect(err).toMatchObject({ code: "START_TIMEOUT" });
    expect(await waitFor(() => child?.exitCode !== null || child?.signalCode !== null)).toBe(true);
  });

  it("signale un moteur qui ne peut pas être lancé", async () => {
    const { make, ids } = await setup();
    const m = make({
      spawn: (() => {
        throw new Error("EACCES");
      }) as never,
    });
    await expect(m.start(ids.alpha!)).rejects.toMatchObject({ code: "ENGINE_START_FAILED" });
  });
});

describe("serveur interrompu ou injoignable", () => {
  it("détecte l'arrêt inattendu du processus", async () => {
    const { make, ids } = await setup();
    const m = make();
    const s = await m.start(ids.alpha!);
    process.kill(s.pid!, "SIGKILL");
    expect(await waitFor(() => m.snapshotActive().state === "error")).toBe(true);
    const after = await m.getStatus();
    expect(after).toMatchObject({ state: "error", healthy: false, pid: null });
    expect(after.error?.code).toBe("SERVER_CRASHED");
    // Un nouveau démarrage reste possible après l'erreur.
    expect((await m.start(ids.alpha!)).state).toBe("running");
  });

  it("signale un serveur qui ne répond plus alors que le processus existe", async () => {
    const { make, ids } = await setup();
    const m = make();
    const s = await m.start(ids.alpha!);
    process.kill(s.pid!, "SIGSTOP"); // processus figé : vivant mais muet
    try {
      const st = await m.getStatus();
      expect(st.state).toBe("running");
      expect(st.healthy).toBe(false);
      expect(st.healthDetail).toBeTruthy();
    } finally {
      process.kill(s.pid!, "SIGCONT");
    }
  });
});

describe("reprise d'un processus après redémarrage de l'application", () => {
  it("reprend un llama-server dont l'identité est confirmée, puis l'arrête", async () => {
    const { make, ids, dataDir } = await setup();
    const first = make();
    const s = await first.start(ids.alpha!);
    expect(await fs.readFile(path.join(dataDir, "server.pid.json"), "utf8")).toContain(String(s.pid));

    // « Redémarrage » : nouveau gestionnaire, même dossier de données.
    const second = make({ inspector: { ...defaultInspector, name: async () => "llama-server" } });
    const st = await second.getStatus();
    expect(st).toMatchObject({ state: "running", managed: false, pid: s.pid, modelId: ids.alpha, healthy: true });
    await second.stop();
    expect(await waitFor(() => !alive(s.pid!))).toBe(true);
    expect(await fs.stat(path.join(dataDir, "server.pid.json")).catch(() => null)).toBeNull();
  });

  it("n'adopte jamais un processus dont l'identité n'est pas confirmée, et ne le tue pas", async () => {
    const { make, dataDir } = await setup();
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    strays.push(unrelated);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "server.pid.json"),
      JSON.stringify({ pid: unrelated.pid, modelId: "x", host: "127.0.0.1", port: 1, enginePath: "", startedAt: new Date().toISOString() }),
    );
    const m = make({ inspector: { ...defaultInspector, name: async () => "notepad.exe" } });
    expect((await m.getStatus()).state).toBe("stopped");
    await m.stop();
    expect(alive(unrelated.pid!)).toBe(true); // intact
    expect(m.getLogs().lines.some((l) => /identité non confirmée/.test(l.text))).toBe(true);
  });

  it("ignore un fichier pid périmé (processus disparu)", async () => {
    const { make, dataDir } = await setup();
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, "server.pid.json"), JSON.stringify({ pid: 999999, modelId: "x", host: "127.0.0.1", port: 1, enginePath: "", startedAt: "" }));
    expect((await make().getStatus()).state).toBe("stopped");
    expect(await fs.stat(path.join(dataDir, "server.pid.json")).catch(() => null)).toBeNull();
  });
});
