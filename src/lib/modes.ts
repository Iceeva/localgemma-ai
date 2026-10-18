/** Modes d'assistant : un court complément de prompt adapté à la tâche (partagé client/serveur). */

export interface Mode {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export const MODES: Mode[] = [
  { id: "general", label: "Général", description: "Conversation libre.", prompt: "" },
  {
    id: "code",
    label: "Programmation",
    description: "Code complet, débogage, projets.",
    prompt:
      "Mode Programmation : donne du code complet, exécutable et idiomatique, dans un bloc Markdown avec le langage indiqué. Utilise uniquement des fonctions, modules et options qui existent réellement. Indique en une ligne comment l'exécuter. Pour un bug, explique la cause puis donne le correctif. Pour un projet à plusieurs fichiers, donne d'abord l'arborescence, puis un bloc par fichier dont la première ligne est un commentaire avec son chemin (ex. # fichier: src/main.py).",
  },
  {
    id: "ecriture",
    label: "Rédaction et langues",
    description: "Écrire, corriger, traduire, résumer.",
    prompt:
      "Mode Rédaction et langues : respecte le ton, le registre et la longueur demandés. Donne directement une version finale prête à copier, sans menu d'options. Pour une traduction, donne la traduction puis, seulement si utile, une courte note sur les nuances. Quand tu corriges un texte, ne change pas le sens.",
  },
  {
    id: "apprentissage",
    label: "Apprentissage",
    description: "Cours, explications, exercices.",
    prompt:
      "Mode Apprentissage : explique pas à pas, du simple au complexe, avec un exemple concret et au niveau de l'utilisateur. Termine par une courte question ou un mini-exercice pour vérifier la compréhension, sauf si on demande uniquement la réponse.",
  },
  {
    id: "analyse",
    label: "Analyse et raisonnement",
    description: "Maths, logique, comparaisons, décisions.",
    prompt:
      "Mode Analyse : décompose le problème, raisonne étape par étape, vérifie les calculs, compare les options avec leurs avantages et inconvénients, puis donne une conclusion claire. Signale tes hypothèses.",
  },
  {
    id: "quotidien",
    label: "Vie pratique",
    description: "Recettes, achats, voyages, organisation.",
    prompt:
      "Mode Vie pratique : donne des conseils concrets et réalisables (recettes avec quantités, achats, organisation, voyages jour par jour). Pour la santé, le droit et la finance, donne des informations générales utiles et rappelle de consulter un professionnel pour les décisions importantes.",
  },
  {
    id: "web",
    label: "Pages web",
    description: "Pages HTML prévisualisables.",
    prompt:
      "Mode Pages web : produis une page complète dans UN seul bloc ```html (HTML, CSS et JavaScript intégrés), responsive, sans bibliothèque externe, sans image distante et sans appel réseau. L'utilisateur pourra la prévisualiser et la télécharger. Pour un graphique, dessine-le avec du SVG ou un canvas.",
  },
  {
    id: "documents",
    label: "Documents",
    description: "Questions sur les fichiers joints.",
    prompt:
      "Mode Documents : base-toi uniquement sur les documents fournis. Cite les passages ou sections utiles, n'invente rien qui n'y figure pas et dis-le si l'information est absente. Pour un résumé, commence par les points clés.",
  },
];

export function getMode(id: string | undefined | null): Mode {
  return MODES.find((m) => m.id === id) ?? MODES[0]!;
}
