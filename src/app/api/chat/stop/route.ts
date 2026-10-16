import { handler, ok, readJson } from "@/lib/server/http";
import { stopGeneration } from "@/lib/server/llama-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  const stopped = typeof body.generationId === "string" ? stopGeneration(body.generationId) : false;
  return ok({ stopped });
});
