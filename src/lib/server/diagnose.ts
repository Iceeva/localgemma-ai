import { AppError } from "./errors";

/** Codes de sortie Windows fréquents (NTSTATUS). */
const EXIT_DLL_NOT_FOUND = 3221225781; // 0xC0000135
const EXIT_ILLEGAL_INSTRUCTION = 3221225501; // 0xC000001D

/**
 * Transforme la fin des journaux de llama-server et le code de sortie en erreur compréhensible,
 * avec une action corrective. Les heuristiques portent sur des messages usuels de llama.cpp ; elles ne sont pas exhaustives.
 */
export function classifyFailure(logLines: string[], exitCode: number | null): AppError {
  const tail = logLines.slice(-25).join("\n");
  const details = { exitCode, logTail: tail };

  if (exitCode === EXIT_DLL_NOT_FOUND) {
    return new AppError(
      "ENGINE_DLL_MISSING",
      "Windows n'a pas pu charger llama-server.exe : une bibliothèque (DLL) est manquante.",
      "Gardez llama-server.exe dans son dossier d'origine avec tous les fichiers .dll de l'archive llama.cpp, et installez le « Microsoft Visual C++ Redistributable » si nécessaire.",
      500,
      details,
    );
  }
  if (exitCode === EXIT_ILLEGAL_INSTRUCTION) {
    return new AppError(
      "ENGINE_CPU_UNSUPPORTED",
      "Ce build de llama.cpp utilise des instructions que votre processeur ne gère pas.",
      "Téléchargez un autre build Windows de llama.cpp adapté à un CPU plus ancien (variante sans AVX2 / « noavx »).",
      500,
      details,
    );
  }
  if (/address already in use|failed to bind|couldn't bind|bind\(\) failed|only one usage of each socket/i.test(tail)) {
    return new AppError("PORT_IN_USE", "Le port du serveur est déjà utilisé par un autre programme.", "Changez le port dans « Gestionnaire de serveurs » (par exemple 8081) puis redémarrez.", 409, details);
  }
  if (/out of memory|failed to allocate|cannot allocate|bad_alloc|unable to allocate|ggml_backend_\w*alloc\w*.*fail/i.test(tail)) {
    return new AppError(
      "OUT_OF_MEMORY",
      "Mémoire insuffisante pour charger ce modèle avec ces paramètres.",
      "Fermez d'autres applications, réduisez la taille du contexte (par exemple 1024), ou choisissez un modèle plus petit / plus fortement quantifié (Q4 plutôt que Q8).",
      500,
      details,
    );
  }
  if (/unknown model architecture|unsupported|invalid magic|failed to load model|error loading model|unable to load model|llama_model_load.*(error|fail)|failed to read magic/i.test(tail)) {
    return new AppError(
      "MODEL_INCOMPATIBLE",
      "llama.cpp n'a pas réussi à charger ce modèle (fichier incomplet, corrompu ou architecture non gérée par cette version).",
      "Mettez à jour llama.cpp vers une version récente, ou retéléchargez le modèle. Consultez les journaux pour le détail.",
      500,
      details,
    );
  }
  return new AppError(
    "SERVER_CRASHED",
    `Le serveur llama.cpp s'est arrêté de façon inattendue (code ${exitCode ?? "inconnu"}).`,
    "Ouvrez les journaux du serveur pour voir la cause, puis réessayez avec un contexte plus petit ou un autre modèle.",
    500,
    details,
  );
}
