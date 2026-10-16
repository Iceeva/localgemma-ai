import { handler, ok } from "@/lib/server/http";
import { getManager } from "@/lib/server/process-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

export const POST = handler(async () => ok({ status: await getManager().restart() }));
