import { handler, ok, readJson } from "@/lib/server/http";
import { getConfigStore } from "@/lib/server/config-store";
import { addNote, setMemoryEnabled } from "@/lib/server/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => ok((await getConfigStore().read()).memory));

export const POST = handler(async (req: Request) => {
  const body = await readJson(req);
  return ok(await addNote(getConfigStore(), body.text), 201);
});

export const PUT = handler(async (req: Request) => {
  const body = await readJson(req);
  await setMemoryEnabled(getConfigStore(), body.enabled === true);
  return ok((await getConfigStore().read()).memory);
});
