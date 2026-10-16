/**
 * Garde de sécurité des routes /api (pure, sans dépendance Node : utilisable dans le middleware Edge).
 *
 * - Hôte : uniquement loopback (protège contre le DNS rebinding).
 * - Origine : si présente, doit être la même que l'hôte (protège contre les requêtes d'autres sites).
 * - Sec-Fetch-Site : "cross-site" refusé.
 * - Méthodes modifiantes : en-tête personnalisé obligatoire (impossible à poser depuis un autre site sans préflight CORS,
 *   que l'application n'autorise jamais).
 */
export const REQUEST_HEADER = "x-localgemma-request";

export interface RequestInfo {
  method: string;
  host: string | null;
  origin: string | null;
  secFetchSite?: string | null;
  customHeader: string | null;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  return h.split(":")[0] ?? h;
}

export function checkRequestAllowed(r: RequestInfo): { allowed: true } | { allowed: false; reason: string } {
  if (!r.host) return { allowed: false, reason: "En-tête Host manquant." };
  if (!LOOPBACK.has(hostnameOf(r.host))) {
    return { allowed: false, reason: "Hôte non autorisé : l'API n'est accessible que depuis cet ordinateur." };
  }
  if (r.secFetchSite && r.secFetchSite.toLowerCase() === "cross-site") {
    return { allowed: false, reason: "Requête inter-sites refusée." };
  }
  if (r.origin && r.origin !== "null") {
    let originHost = "";
    try {
      originHost = new URL(r.origin).host.toLowerCase();
    } catch {
      return { allowed: false, reason: "Origine invalide." };
    }
    if (originHost !== r.host.toLowerCase()) {
      return { allowed: false, reason: "Origine non autorisée." };
    }
  } else if (r.origin === "null") {
    return { allowed: false, reason: "Origine opaque refusée." };
  }
  const method = r.method.toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (mutating && r.customHeader !== "1") {
    return { allowed: false, reason: "En-tête de protection manquant sur une requête modifiante." };
  }
  return { allowed: true };
}
