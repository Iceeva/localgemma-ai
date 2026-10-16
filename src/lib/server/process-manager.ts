import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { ErrorPayload, ServerSettings, ServerState, ServerStatus } from "@/types";
import { getConfigStore, type ConfigStore } from "./config-store";
import { classifyFailure } from "./diagnose";
import { AppError, toErrorPayload } from "./errors";
import { baseUrl, checkHealth, type FetchFn } from "./llama-client";
import { touchModelUsed } from "./model-library";
import { resolveDataDir } from "./paths";
import { defaultInspector, type ProcessInspector } from "./process-inspector";
import { validateEnginePath, validateModelFile, validateServerSettings } from "./validators";

export interface LogLine {
  idx: number;
  ts: string;
  stream: "stdout" | "stderr" | "app";
  text: string;
}

export interface ManagerDeps {
  store: ConfigStore;
  dataDir: string;
  spawn?: typeof nodeSpawn;
  fetchFn?: FetchFn;
  inspector?: ProcessInspector;
  isPortFree?: (host: string, port: number) => Promise<boolean>;
  pollIntervalMs?: number;
  stopGraceMs?: number;
}

interface PidFile {
  pid: number;
  modelId: string;
  host: string;
  port: number;
  enginePath: string;
  startedAt: string;
}

const MAX_LOG_LINES = 1000;

export function isPortFreeDefault(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host === "localhost" ? "127.0.0.1" : host);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gère UN serveur llama-server à la fois (politique par défaut : un seul modèle chargé).
 * L'état est volontairement regroupé dans une instance : un futur gestionnaire multi-serveurs
 * pourra en créer une par port sans toucher au reste du code.
 */
export class ProcessManager {
  private state: ServerState = "stopped";
  private child: ChildProcess | null = null;
  private pid: number | null = null;
  private managed = true;
  private modelId: string | null = null;
  private startedAt: string | null = null;
  private activeSettings: ServerSettings | null = null;
  private error: ErrorPayload | null = null;
  private exit: { code: number | null } | null = null;
  private cancelRequested = false;
  private logs: LogLine[] = [];
  private logIdx = 0;
  private partial: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
  private recovered: Promise<void> | null = null;
  readonly modelErrors = new Map<string, ErrorPayload>();

  private readonly store: ConfigStore;
  private readonly spawnFn: typeof nodeSpawn;
  private readonly fetchFn: FetchFn;
  private readonly inspector: ProcessInspector;
  private readonly portFree: (host: string, port: number) => Promise<boolean>;
  private readonly pollMs: number;
  private readonly graceMs: number;
  private readonly pidFile: string;

  constructor(deps: ManagerDeps) {
    this.store = deps.store;
    this.spawnFn = deps.spawn ?? nodeSpawn;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.inspector = deps.inspector ?? defaultInspector;
    this.portFree = deps.isPortFree ?? isPortFreeDefault;
    this.pollMs = deps.pollIntervalMs ?? 500;
    this.graceMs = deps.stopGraceMs ?? 5000;
    this.pidFile = path.join(deps.dataDir, "server.pid.json");
  }

  // ---------- journaux ----------
  private log(stream: LogLine["stream"], text: string): void {
    this.logs.push({ idx: ++this.logIdx, ts: new Date().toISOString(), stream, text });
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
  }
  private feed(stream: "stdout" | "stderr", chunk: Buffer): void {
    const text = this.partial[stream] + chunk.toString("utf8");
    const parts = text.split(/\r?\n/);
    this.partial[stream] = parts.pop() ?? "";
    for (const p of parts) if (p.trim() !== "") this.log(stream, p);
  }
  getLogs(since = 0): { lines: LogLine[]; next: number } {
    return { lines: this.logs.filter((l) => l.idx > since), next: this.logIdx };
  }
  private recentLogText(): string[] {
    return this.logs.slice(-40).map((l) => l.text);
  }

  // ---------- récupération d'un processus précédent ----------
  ensureRecovered(): Promise<void> {
    this.recovered ??= this.recoverOrphan().catch(() => undefined);
    return this.recovered;
  }

  /** Reprend un llama-server lancé par une exécution précédente, uniquement si son identité est vérifiable. */
  async recoverOrphan(): Promise<void> {
    let info: PidFile;
    try {
      info = JSON.parse(await fs.readFile(this.pidFile, "utf8")) as PidFile;
    } catch {
      return;
    }
    if (!Number.isInteger(info.pid) || !this.inspector.isAlive(info.pid)) {
      await this.removePidFile();
      return;
    }
    const name = await this.inspector.name(info.pid);
    if (!name || !/llama-server/i.test(name)) {
      this.log("app", `Processus ${info.pid} ignoré : identité non confirmée (${name ?? "inconnue"}).`);
      await this.removePidFile();
      return;
    }
    const cfg = await this.store.read();
    this.pid = info.pid;
    this.managed = false;
    this.modelId = info.modelId;
    this.startedAt = info.startedAt;
    this.activeSettings = { ...cfg.server, host: info.host, port: info.port };
    this.state = "running";
    this.log("app", `Serveur existant (PID ${info.pid}) repris au démarrage de l'application.`);
  }

  private async writePidFile(): Promise<void> {
    if (!this.pid || !this.modelId || !this.activeSettings) return;
    const cfg = await this.store.read();
    const data: PidFile = {
      pid: this.pid,
      modelId: this.modelId,
      host: this.activeSettings.host,
      port: this.activeSettings.port,
      enginePath: cfg.enginePath ?? "",
      startedAt: this.startedAt ?? new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(this.pidFile), { recursive: true });
    await fs.writeFile(this.pidFile, JSON.stringify(data), "utf8");
  }
  private async removePidFile(): Promise<void> {
    await fs.rm(this.pidFile, { force: true });
  }

  // ---------- état ----------
  async getStatus(): Promise<ServerStatus> {
    await this.ensureRecovered();
    const cfg = await this.store.read();
    const settings = this.activeSettings ?? cfg.server;
    let healthy = false;
    let healthDetail: string | null = null;
    if (this.state === "running") {
      const h = await checkHealth(baseUrl(settings), this.fetchFn, 1500);
      healthy = h.ok;
      healthDetail = h.detail;
      if (!healthy && this.managed && this.child === null) healthDetail = "Le processus ne répond plus.";
    }
    const model = this.modelId ? cfg.models.find((m) => m.id === this.modelId) : undefined;
    return {
      state: this.state,
      modelId: this.modelId,
      modelName: model?.name ?? null,
      pid: this.pid,
      managed: this.managed,
      host: settings.host,
      port: settings.port,
      contextSize: this.state === "stopped" ? null : settings.contextSize,
      startedAt: this.startedAt,
      healthy,
      healthDetail,
      error: this.error,
      engineConfigured: cfg.enginePath !== null,
    };
  }

  async testConnection(): Promise<{ ok: boolean; detail: string; url: string }> {
    await this.ensureRecovered();
    const cfg = await this.store.read();
    const s = this.activeSettings ?? cfg.server;
    const url = baseUrl(s);
    const h = await checkHealth(url, this.fetchFn, 3000);
    return { ...h, url };
  }

  // ---------- démarrage ----------
  async start(modelId: string, overrides?: Partial<ServerSettings>): Promise<ServerStatus> {
    await this.ensureRecovered();
    if (this.state === "starting" || this.state === "stopping") {
      throw new AppError("SERVER_BUSY", "Une opération est déjà en cours sur le serveur.", "Patientez la fin du démarrage ou de l'arrêt.", 409);
    }
    const cfg = await this.store.read();
    const enginePath = await validateEnginePath(cfg.enginePath);
    const model = cfg.models.find((m) => m.id === modelId);
    if (!model) throw new AppError("MODEL_NOT_FOUND", "Ce modèle n'est pas dans la bibliothèque.", "Actualisez la bibliothèque.", 404);
    const modelFile = await validateModelFile(model.path).catch((e) => {
      this.modelErrors.set(modelId, toErrorPayload(e));
      throw e;
    });
    const settings = validateServerSettings(overrides ?? {}, cfg.server);

    if (this.state === "running") {
      if (this.modelId === modelId) return this.getStatus();
      await this.stopInternal(); // un seul modèle chargé à la fois : arrêt propre avant de changer
    }

    if (!(await this.portFree(settings.host, settings.port))) {
      const err = new AppError("PORT_IN_USE", `Le port ${settings.port} est déjà utilisé par un autre programme.`, "Changez le port dans « Gestionnaire de serveurs » (par exemple 8081) puis réessayez.", 409);
      this.fail(modelId, err);
      throw err;
    }

    this.state = "starting";
    this.error = null;
    this.cancelRequested = false;
    this.exit = null;
    this.modelId = modelId;
    this.activeSettings = settings;
    this.startedAt = null;
    this.managed = true;
    this.partial = { stdout: "", stderr: "" };

    const args = [
      "--model", modelFile.path,
      "--host", settings.host,
      "--port", String(settings.port),
      "--ctx-size", String(settings.contextSize),
      "--threads", String(settings.threads),
      "--parallel", String(settings.parallel),
    ];
    this.log("app", `Démarrage : ${path.basename(enginePath)} ${args.map((a) => (a === modelFile.path ? path.basename(a) : a)).join(" ")}`);

    let child: ChildProcess;
    try {
      child = this.spawnFn(enginePath, args, { shell: false, windowsHide: true, cwd: path.dirname(enginePath), stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const err = new AppError("ENGINE_START_FAILED", "Impossible de lancer llama-server.exe : " + (e as Error).message, "Vérifiez le fichier dans « Configuration locale » (bouton « Tester le moteur »).", 500);
      this.fail(modelId, err);
      throw err;
    }
    this.child = child;
    this.pid = child.pid ?? null;
    child.stdout?.on("data", (d: Buffer) => this.feed("stdout", d));
    child.stderr?.on("data", (d: Buffer) => this.feed("stderr", d));
    let spawnError: Error | null = null;
    child.on("error", (e) => {
      spawnError = e;
      this.exit = { code: null };
    });
    child.on("exit", (code) => this.onExit(child, code));
    await this.writePidFile().catch(() => undefined);

    // Attente de la disponibilité de l'API.
    const base = baseUrl(settings);
    const deadline = Date.now() + settings.startupTimeoutSec * 1000;
    while (true) {
      const exitInfo = this.getExit();
      if (exitInfo) {
        const err = this.cancelRequested
          ? new AppError("SERVER_NOT_RUNNING", "Le démarrage a été annulé.", "Relancez le modèle quand vous le souhaitez.", 409)
          : spawnError
            ? new AppError("ENGINE_START_FAILED", "Impossible de lancer llama-server.exe : " + (spawnError as Error).message, "Vérifiez le fichier, les droits d'accès et l'antivirus.", 500)
            : classifyFailure(this.recentLogText(), exitInfo.code);
        this.cleanupProcess();
        this.fail(modelId, err);
        throw err;
      }
      const h = await checkHealth(base, this.fetchFn, 1500);
      if (h.ok) break;
      if (Date.now() > deadline) {
        const err = new AppError(
          "START_TIMEOUT",
          `Le modèle n'a pas répondu dans le délai de ${settings.startupTimeoutSec} s.`,
          "Les gros modèles sont lents à charger sur un PC modeste : augmentez le délai de démarrage, ou choisissez un modèle plus petit.",
          504,
          { logTail: this.recentLogText().slice(-15) },
        );
        await this.killOwnChild();
        this.cleanupProcess();
        this.fail(modelId, err);
        throw err;
      }
      await sleep(this.pollMs);
    }

    this.state = "running";
    this.startedAt = new Date().toISOString();
    this.modelErrors.delete(modelId);
    await this.writePidFile().catch(() => undefined);
    await this.store.update((c) => {
      c.selectedModelId = modelId;
    });
    await touchModelUsed(this.store, modelId);
    this.log("app", "Serveur prêt.");
    return this.getStatus();
  }

  /** Lecture indirecte : évite que TypeScript fige l'état à null pendant la boucle d'attente. */
  private getExit(): { code: number | null } | null {
    return this.exit;
  }

  private onExit(child: ChildProcess, code: number | null): void {
    if (this.child !== child) return;
    for (const s of ["stdout", "stderr"] as const) {
      if (this.partial[s].trim()) this.log(s, this.partial[s]);
      this.partial[s] = "";
    }
    this.log("app", `Processus terminé (code ${code ?? "inconnu"}).`);
    this.exit = { code };
    if (this.state === "running") {
      // Arrêt inattendu pendant l'utilisation.
      const err = classifyFailure(this.recentLogText(), code);
      const failed = this.modelId;
      this.cleanupProcess();
      if (failed) this.fail(failed, err);
    }
  }

  private fail(modelId: string, err: AppError): void {
    this.state = "error";
    this.error = err.toPayload();
    this.modelErrors.set(modelId, err.toPayload());
    this.log("app", `Erreur : ${err.message}`);
  }

  private cleanupProcess(): void {
    this.child = null;
    this.pid = null;
    this.startedAt = null;
    void this.removePidFile();
  }

  // ---------- arrêt ----------
  async stop(): Promise<ServerStatus> {
    await this.ensureRecovered();
    if (this.state === "starting") {
      this.cancelRequested = true;
      await this.killOwnChild();
      // start() détecte la sortie et nettoie ; on attend brièvement son retour à l'état d'erreur/arrêt.
      for (let i = 0; i < 50 && this.state === "starting"; i++) await sleep(50);
      this.state = "stopped";
      this.error = null;
      this.modelId = null;
      return this.getStatus();
    }
    if (this.state === "stopping") return this.getStatus();
    await this.stopInternal();
    return this.getStatus();
  }

  async restart(): Promise<ServerStatus> {
    await this.ensureRecovered();
    const id = this.modelId;
    if (!id) throw new AppError("SERVER_NOT_RUNNING", "Aucun modèle n'est actif.", "Démarrez d'abord un modèle depuis la bibliothèque.", 409);
    await this.stopInternal();
    return this.start(id);
  }

  private async stopInternal(): Promise<void> {
    if (this.pid === null && this.state !== "error") {
      this.state = "stopped";
      this.modelId = null;
      return;
    }
    this.state = "stopping";
    try {
      if (this.child) await this.killOwnChild();
      else if (this.pid !== null) await this.killAdopted(this.pid);
    } finally {
      this.cleanupProcess();
      this.state = "stopped";
      this.error = null;
      this.modelId = null;
      this.managed = true;
      this.log("app", "Serveur arrêté.");
    }
  }

  /** Arrêt du processus lancé par l'application : demande polie, puis arrêt forcé après un délai. */
  private async killOwnChild(): Promise<void> {
    const child = this.child;
    if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    const done = await Promise.race([exited.then(() => true), sleep(this.graceMs).then(() => false)]);
    if (!done) {
      await this.inspector.forceKill(child.pid);
      await Promise.race([exited, sleep(3000)]);
    }
  }

  /** Arrêt d'un processus repris : uniquement après vérification d'identité (jamais « tous les llama-server »). */
  private async killAdopted(pid: number): Promise<void> {
    const name = await this.inspector.name(pid);
    if (!name || !/llama-server/i.test(name)) {
      this.log("app", `Arrêt refusé : le processus ${pid} n'est pas confirmé comme llama-server (${name ?? "inconnu"}).`);
      return;
    }
    await this.inspector.terminate(pid);
    const end = Date.now() + this.graceMs;
    while (Date.now() < end && this.inspector.isAlive(pid)) await sleep(100);
    if (this.inspector.isAlive(pid)) {
      await this.inspector.forceKill(pid);
      const end2 = Date.now() + 3000;
      while (Date.now() < end2 && this.inspector.isAlive(pid)) await sleep(100);
    }
  }

  /** Arrêt synchrone au plus vite lors de la sortie de Node.js (dernier recours). */
  shutdownSync(): void {
    try {
      if (this.child && this.child.exitCode === null) this.child.kill();
    } catch {
      /* ignoré */
    }
  }

  snapshotActive(): { modelId: string | null; state: ServerState } {
    return { modelId: this.modelId, state: this.state };
  }
}

const g = globalThis as unknown as { __lgManager?: ProcessManager; __lgExitHook?: boolean };

/** Instance unique (conservée entre les rechargements à chaud et partagée par toutes les routes). */
export function getManager(): ProcessManager {
  if (!g.__lgManager) {
    g.__lgManager = new ProcessManager({ store: getConfigStore(), dataDir: resolveDataDir() });
    if (!g.__lgExitHook) {
      g.__lgExitHook = true;
      process.on("exit", () => g.__lgManager?.shutdownSync());
    }
  }
  return g.__lgManager;
}
