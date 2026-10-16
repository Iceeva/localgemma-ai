import { handler, ok } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { scanAllFolders } from "@/lib/server/model-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async () => ok({ results: await scanAllFolders(getConfigStore()) }));
