import { execFile } from "node:child_process";

export interface ProcessInspector {
  isAlive(pid: number): boolean;
  /** Nom de l'exécutable du processus, ou null s'il ne peut pas être déterminé de façon fiable. */
  name(pid: number): Promise<string | null>;
  terminate(pid: number): Promise<void>;
  forceKill(pid: number): Promise<void>;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 10000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

export const defaultInspector: ProcessInspector = {
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  async name(pid) {
    try {
      if (process.platform === "win32") {
        const out = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
        const m = out.match(/^"([^"]+)"/m);
        return m?.[1] ?? null;
      }
      const out = await run("ps", ["-p", String(pid), "-o", "comm="]);
      return out.trim() || null;
    } catch {
      return null;
    }
  },
  async terminate(pid) {
    if (process.platform === "win32") await run("taskkill", ["/PID", String(pid), "/T"]).catch(() => undefined);
    else process.kill(pid, "SIGTERM");
  },
  async forceKill(pid) {
    if (process.platform === "win32") await run("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => undefined);
    else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* déjà arrêté */
      }
    }
  },
};
