import { handler, ok, readJson } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { searchWeb } from "@/lib/server/web-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recherche web via SearXNG, appelée uniquement quand l'utilisateur a activé le bouton « Recherche Web ». */
export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const cfg = await getConfigStore().read();
  return ok(await searchWeb(cfg.search, body.query));
});
