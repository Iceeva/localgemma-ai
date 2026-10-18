import { handler, ok, readJson } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { searchWeb } from "@/lib/server/web-search";
import { validateSearchSettings } from "@/lib/server/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Teste une configuration (éventuellement non enregistrée) avec une requête d'essai. */
export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const cfg = await getConfigStore().read();
  const settings = body.search ? validateSearchSettings(body.search as never, cfg.search) : cfg.search;
  const r = await searchWeb(settings, "LocalGemma test");
  return ok({ ok: true, count: r.results.length, tookMs: r.tookMs });
});
