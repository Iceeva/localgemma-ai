import { handler, ok } from "@/lib/server/http";
import { getManager } from "@/lib/server/process-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => ok(await getManager().getStatus()));
