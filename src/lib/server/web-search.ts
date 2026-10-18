import type { SearchResult, SearchSettings } from "@/types";
import { AppError } from "./errors";
import { fetchWithTimeout, type FetchFn } from "./llama-client";

export function cleanQuery(q: unknown): string {
  const s = typeof q === "string" ? q.replace(/\s+/g, " ").trim() : "";
  if (!s) throw new AppError("VALIDATION", "La recherche est vide.", "Saisissez une question.");
  return s.slice(0, 300);
}

/**
 * Interroge l'API JSON de SearXNG (GET /search?q=…&format=json).
 * C'est le seul code de l'application qui sort vers un autre service : il n'est appelé que si l'utilisateur
 * a configuré une instance ET activé le bouton « Recherche Web » dans la conversation.
 */
export async function searchWeb(settings: SearchSettings, query: unknown, fetchFn: FetchFn = fetch): Promise<{ query: string; results: SearchResult[]; tookMs: number }> {
  const q = cleanQuery(query);
  if (!settings.url) {
    throw new AppError(
      "SEARCH_NOT_CONFIGURED",
      "La recherche web n'est pas configurée.",
      "Ouvrez Paramètres → Recherche Web et indiquez l'adresse de votre instance SearXNG (ex. http://127.0.0.1:8888).",
      409,
    );
  }
  const url = new URL(settings.url.replace(/\/+$/, "") + "/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageno", "1");
  if (settings.language && settings.language !== "all") url.searchParams.set("language", settings.language);

  const started = Date.now();
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchFn, url.toString(), settings.timeoutSec * 1000, { headers: { Accept: "application/json" } });
  } catch {
    throw new AppError(
      "SEARCH_UNREACHABLE",
      `Impossible de joindre SearXNG à l'adresse ${settings.url}.`,
      "Vérifiez que l'instance est démarrée et que l'adresse est correcte. La recherche exige aussi une connexion Internet pour interroger les moteurs externes.",
      502,
    );
  }
  if (res.status === 403) {
    throw new AppError(
      "SEARCH_FORMAT_DISABLED",
      "SearXNG refuse le format JSON.",
      "Dans le fichier settings.yml de SearXNG, ajoutez « json » à search.formats (formats: [html, json]) puis redémarrez l'instance.",
      502,
    );
  }
  if (!res.ok) {
    throw new AppError("SEARCH_FAILED", `SearXNG a répondu par une erreur (HTTP ${res.status}).`, res.status === 429 ? "Trop de requêtes : patientez un instant." : "Consultez les journaux de votre instance SearXNG.", 502);
  }
  let data: { results?: unknown };
  try {
    data = (await res.json()) as { results?: unknown };
  } catch {
    throw new AppError("SEARCH_FAILED", "La réponse de SearXNG n'est pas du JSON.", "Vérifiez que l'adresse pointe bien vers SearXNG et que le format JSON est activé.", 502);
  }
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const r of Array.isArray(data.results) ? data.results : []) {
    const o = (r ?? {}) as Record<string, unknown>;
    const link = typeof o.url === "string" ? o.url : "";
    if (!/^https?:\/\//i.test(link) || seen.has(link)) continue;
    seen.add(link);
    results.push({
      title: String(o.title ?? link).replace(/\s+/g, " ").trim().slice(0, 200),
      url: link,
      content: String(o.content ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    });
    if (results.length >= settings.maxResults) break;
  }
  return { query: q, results, tookMs: Date.now() - started };
}
