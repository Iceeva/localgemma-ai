import { spawn } from "node:child_process";
import { AppError } from "./errors";
import type { SelectionKind } from "./selection";

export interface DialogOptions {
  initialDir?: string;
}
export interface DialogResult {
  cancelled: boolean;
  path?: string;
}
export type PowerShellRunner = (script: string, env: Record<string, string>, timeoutMs: number) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const FILTERS: Record<Exclude<SelectionKind, "folder">, { title: string; filter: string }> = {
  engine: { title: "Choisir llama-server.exe", filter: "llama-server (llama-server.exe)|llama-server.exe|Exécutables (*.exe)|*.exe" },
  gguf: { title: "Choisir un modèle GGUF", filter: "Modèles GGUF (*.gguf)|*.gguf|Tous les fichiers (*.*)|*.*" },
};

/**
 * Script PowerShell affichant un vrai dialogue Windows (System.Windows.Forms).
 * Les paramètres passent par des variables d'environnement : aucune chaîne utilisateur n'est injectée dans le script.
 */
export function buildDialogScript(kind: SelectionKind): string {
  const common = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
# Fenêtre propriétaire invisible et au premier plan : le dialogue ne reste pas caché derrière le navigateur.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$owner.Show()
$owner.Activate()
`;
  const body =
    kind === "folder"
      ? `
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = $env:LG_TITLE
$dlg.ShowNewFolderButton = $false
if ($env:LG_INITIAL -and (Test-Path -LiteralPath $env:LG_INITIAL)) { $dlg.SelectedPath = $env:LG_INITIAL }
$result = $dlg.ShowDialog($owner)
$selected = $dlg.SelectedPath
`
      : `
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = $env:LG_TITLE
$dlg.Filter = $env:LG_FILTER
$dlg.CheckFileExists = $true
$dlg.Multiselect = $false
if ($env:LG_INITIAL -and (Test-Path -LiteralPath $env:LG_INITIAL)) { $dlg.InitialDirectory = $env:LG_INITIAL }
$result = $dlg.ShowDialog($owner)
$selected = $dlg.FileName
`;
  const tail = `
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $selected) { [Console]::Out.Write($selected) }
`;
  return common + body + tail;
}

export const runPowerShell: PowerShellRunner = (script, env, timeoutMs) =>
  new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-NonInteractive", "-EncodedCommand", encoded], {
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });

export async function openNativeDialog(
  kind: SelectionKind,
  options: DialogOptions = {},
  platform: NodeJS.Platform = process.platform,
  runner: PowerShellRunner = runPowerShell,
): Promise<DialogResult> {
  if (platform !== "win32") {
    throw new AppError(
      "DIALOG_UNAVAILABLE",
      "Le sélecteur graphique n'est disponible que sous Windows.",
      "Utilisez LocalGemma AI sur Windows (les dialogues passent par PowerShell).",
      501,
    );
  }
  const spec = kind === "folder" ? { title: "Choisir un dossier contenant des modèles GGUF", filter: "" } : FILTERS[kind];
  let out;
  try {
    out = await runner(
      buildDialogScript(kind),
      { LG_TITLE: spec.title, LG_FILTER: spec.filter, LG_INITIAL: options.initialDir ?? "" },
      10 * 60 * 1000,
    );
  } catch {
    throw new AppError(
      "DIALOG_UNAVAILABLE",
      "Impossible de lancer PowerShell pour afficher le sélecteur.",
      "Vérifiez que Windows PowerShell est installé (powershell.exe) et accessible.",
      500,
    );
  }
  if (out.code !== 0) {
    throw new AppError("DIALOG_FAILED", "Le sélecteur graphique s'est terminé en erreur.", "Réessayez. Détail technique : " + out.stderr.trim().slice(0, 300), 500);
  }
  const chosen = out.stdout.replace(/^\uFEFF/, "").trim();
  return chosen ? { cancelled: false, path: chosen } : { cancelled: true };
}
