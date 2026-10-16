import { handler, ok } from "@/lib/server/http";
import { getManager } from "@/lib/server/process-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  return ok(getManager().getLogs(Number.isFinite(since) ? since : 0));
});
