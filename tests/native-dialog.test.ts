import { describe, expect, it } from "vitest";
import { buildDialogScript, openNativeDialog, type PowerShellRunner } from "@/lib/server/native-dialog";

describe("dialogues Windows", () => {
  it("signale clairement l'indisponibilité hors Windows", async () => {
    await expect(openNativeDialog("engine", {}, "linux")).rejects.toMatchObject({ code: "DIALOG_UNAVAILABLE" });
  });

  it("retourne le chemin choisi (BOM et retours à la ligne retirés)", async () => {
    const runner: PowerShellRunner = async () => ({ stdout: "\uFEFFC:\\llama\\llama-server.exe\r\n", stderr: "", code: 0 });
    expect(await openNativeDialog("engine", {}, "win32", runner)).toEqual({ cancelled: false, path: "C:\\llama\\llama-server.exe" });
  });

  it("gère l'annulation par l'utilisateur", async () => {
    const runner: PowerShellRunner = async () => ({ stdout: "", stderr: "", code: 0 });
    expect(await openNativeDialog("gguf", {}, "win32", runner)).toEqual({ cancelled: true });
  });

  it("transforme une erreur PowerShell en message exploitable", async () => {
    const failing: PowerShellRunner = async () => ({ stdout: "", stderr: "boom", code: 1 });
    await expect(openNativeDialog("folder", {}, "win32", failing)).rejects.toMatchObject({ code: "DIALOG_FAILED" });
    const missing: PowerShellRunner = async () => {
      throw new Error("spawn ENOENT");
    };
    await expect(openNativeDialog("folder", {}, "win32", missing)).rejects.toMatchObject({ code: "DIALOG_UNAVAILABLE" });
  });

  it("passe titre et filtre par variables d'environnement (jamais dans le script)", async () => {
    let seen: { script: string; env: Record<string, string> } | undefined;
    const runner: PowerShellRunner = async (script, env) => {
      seen = { script, env };
      return { stdout: "", stderr: "", code: 0 };
    };
    await openNativeDialog("gguf", {}, "win32", runner);
    expect(seen?.env.LG_FILTER).toContain("*.gguf");
    expect(seen?.script).toContain("OpenFileDialog");
    expect(seen?.script).toContain("$env:LG_FILTER");
    expect(buildDialogScript("folder")).toContain("FolderBrowserDialog");
    expect(buildDialogScript("engine")).not.toContain("llama-server.exe"); // le filtre voyage par l'environnement
  });
});
