import { handler, ok } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { verifyEngine } from "@/lib/server/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async () => {
  const store = getConfigStore();
  const cfg = await store.read();
  const check = await verifyEngine(cfg.enginePath);
  if (check.ok) await store.update((c) => void (c.engineVersion = check.version));
  return ok(check);
});
