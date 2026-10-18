import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { buildApiMessages, buildAttachmentContext, buildWebContext, contextBudgetChars, estimateTokens, extractCodeFiles, parseMemoryCommand } from "@/lib/context";
import { ConfigStore, sanitizeConfig } from "@/lib/server/config-store";
import { exportDocx, exportPdf, exportPptx, exportXlsx } from "@/lib/server/exporters";
import { extractText } from "@/lib/server/extract";
import { addNote, deleteNote, memoryPromptBlock, setMemoryEnabled, updateNote } from "@/lib/server/memory";
import { composeSystemPrompt } from "@/lib/server/prompt";
import { DEFAULT_SEARCH_SETTINGS, validateSearchSettings } from "@/lib/server/validators";
import { searchWeb } from "@/lib/server/web-search";
import { getMode, MODES } from "@/lib/modes";
import { tmpDir } from "./helpers";

const servers: http.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));
async function serve(handler: http.RequestListener): Promise<string> {
  const srv = http.createServer(handler);
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}
const settings = (url: string) => ({ ...DEFAULT_SEARCH_SETTINGS, url });

describe("recherche web (SearXNG)", () => {
  it("est désactivée tant qu'aucune instance n'est configurée (hors ligne par défaut)", async () => {
    expect(DEFAULT_SEARCH_SETTINGS.url).toBe("");
    await expect(searchWeb(DEFAULT_SEARCH_SETTINGS, "bonjour")).rejects.toMatchObject({ code: "SEARCH_NOT_CONFIGURED" });
  });

  it("interroge /search en JSON, filtre, déduplique et limite les résultats", async () => {
    let seen: URL | undefined;
    const base = await serve((req, res) => {
      seen = new URL(req.url!, "http://x");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          results: [
            { title: "A", url: "https://a.example/1", content: "alpha" },
            { title: "A bis", url: "https://a.example/1", content: "doublon" },
            { title: "JS", url: "javascript:alert(1)", content: "dangereux" },
            { title: "B", url: "http://b.example/2", content: "  beta\n  gamma " },
            { title: "C", url: "https://c.example/3", content: "x".repeat(900) },
          ],
        }),
      );
    });
    const r = await searchWeb({ ...settings(base + "/"), maxResults: 3 }, "  Quelle est la météo  ");
    expect(seen?.pathname).toBe("/search");
    expect(seen?.searchParams.get("q")).toBe("Quelle est la météo");
    expect(seen?.searchParams.get("format")).toBe("json");
    expect(seen?.searchParams.get("language")).toBe("fr");
    expect(r.results.map((x) => x.url)).toEqual(["https://a.example/1", "http://b.example/2", "https://c.example/3"]);
    expect(r.results[1]?.content).toBe("beta gamma");
    expect(r.results[2]?.content).toHaveLength(400);
  });

  it("explique les échecs : format JSON refusé, HTTP, non-JSON, injoignable", async () => {
    const mk = (status: number, body: string) => serve((_q, r) => void r.writeHead(status).end(body));
    await expect(searchWeb(settings(await mk(403, "forbidden")), "x")).rejects.toMatchObject({ code: "SEARCH_FORMAT_DISABLED" });
    await expect(searchWeb(settings(await mk(429, "")), "x")).rejects.toMatchObject({ code: "SEARCH_FAILED" });
    await expect(searchWeb(settings(await mk(200, "<html>")), "x")).rejects.toMatchObject({ code: "SEARCH_FAILED" });
    const srv = http.createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as AddressInfo).port;
    await new Promise((r) => srv.close(r));
    const err = await searchWeb(settings(`http://127.0.0.1:${port}`), "x").catch((e) => e);
    expect(err.code).toBe("SEARCH_UNREACHABLE");
    expect(err.hint).toMatch(/Internet/);
    await expect(searchWeb(settings("http://127.0.0.1:1"), "   ")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("valide les paramètres de recherche", () => {
    const s = validateSearchSettings({ url: " http://127.0.0.1:8888/ ", maxResults: "3", language: "en" }, DEFAULT_SEARCH_SETTINGS);
    expect(s).toMatchObject({ url: "http://127.0.0.1:8888", maxResults: 3, language: "en" });
    expect(validateSearchSettings({ url: "" }, s).url).toBe("");
    for (const bad of [{ url: "ftp://x" }, { url: "http://user:pw@host" }, { url: "pas une url" }, { maxResults: 50 }, { timeoutSec: 0 }, { language: "français" }]) {
      expect(() => validateSearchSettings(bad as never, DEFAULT_SEARCH_SETTINGS)).toThrow();
    }
  });
});

describe("contexte (documents, web) et budget", () => {
  it("calcule un budget prudent selon le contexte", () => {
    expect(contextBudgetChars(2048, 512, 2000)).toBeLessThan(contextBudgetChars(4096, 512, 2000));
    expect(contextBudgetChars(1024, 1024, 5000)).toBe(0);
    expect(estimateTokens(350)).toBe(100);
  });

  it("tronque les documents au budget et le signale", () => {
    const r = buildAttachmentContext([{ name: "a.txt", text: "x".repeat(5000) }, { name: "b.md", text: "court" }], 1000);
    expect(r.meta).toEqual([
      { name: "a.txt", chars: 500, truncated: true },
      { name: "b.md", chars: 5, truncated: false },
    ]);
    expect(r.text).toContain("tronqué");
    expect(r.text).toContain("Document « b.md »");
    expect(buildAttachmentContext([], 100)).toEqual({ text: "", meta: [] });
  });

  it("construit le contexte web numéroté dans la limite du budget", () => {
    const res = [1, 2, 3, 4].map((i) => ({ title: `T${i}`, url: `https://x/${i}`, content: "c".repeat(100) }));
    const r = buildWebContext(res, { budgetChars: 400, now: new Date("2026-10-18T10:00:00Z"), query: "test" });
    expect(r.used.length).toBeGreaterThanOrEqual(1);
    expect(r.used.length).toBeLessThan(4);
    expect(r.text).toContain("[1] T1");
    expect(r.text).toMatch(/octobre 2026/);
    expect(buildWebContext([], { budgetChars: 100, now: new Date(), query: "x" }).text).toBe("");
  });

  it("joint le contexte aux questions récentes d'abord, selon le budget", () => {
    const msgs = [
      { role: "user" as const, content: "Q1", context: "A".repeat(500) },
      { role: "assistant" as const, content: "R1" },
      { role: "user" as const, content: "Q2", context: "B".repeat(500) },
    ];
    const out = buildApiMessages(msgs, 600);
    expect(out[2]?.content).toContain("B".repeat(500));
    expect(out[2]?.content).toContain("Question de l'utilisateur");
    expect(out[0]?.content).toBe("Q1"); // ancien contexte omis : le budget est épuisé
    expect(buildApiMessages(msgs, 5000)[0]?.content).toContain("A".repeat(500));
    expect(buildApiMessages([{ role: "user", content: "seul", context: "C".repeat(900) }], 10)[0]?.content).toContain("C"); // la dernière question garde son contexte
  });

  it("détecte « retiens que … »", () => {
    expect(parseMemoryCommand("Retiens que je m'appelle Ice")).toBe("je m'appelle Ice");
    expect(parseMemoryCommand("mémorise que mon PC a 12 Go de RAM")).toBe("mon PC a 12 Go de RAM");
    expect(parseMemoryCommand("Peux-tu retenir ça ?")).toBeNull();
  });
});

describe("blocs de code → fichiers (export ZIP)", () => {
  it("détecte les chemins dans l'info string ou la première ligne", () => {
    const md = [
      "```python title=src/main.py\nprint('a')\n```",
      "```js\n// fichier: web/app.js\nconsole.log(1)\n```",
      "```html\n<!-- index.html -->\n<p>x</p>\n```",
      "```css\nbody{}\n```",
      "```python\nprint('b')\n```",
      "```bash\n# ../../etc/passwd\nls\n```",
    ].join("\n\n");
    const files = extractCodeFiles(md);
    expect(files.map((f) => f.path)).toEqual(["src/main.py", "web/app.js", "index.html", "fichier-4.css", "fichier-5.py", "fichier-6.sh"]);
    expect(files[1]?.content).toBe("console.log(1)");
    expect(files[2]?.content).toContain("<!-- index.html -->");
    expect(files.every((f) => !f.path.includes(".."))).toBe(true);
  });
  it("évite les noms en double", () => {
    const f = extractCodeFiles("```py title=a.py\n1\n```\n```py title=a.py\n2\n```");
    expect(f.map((x) => x.path)).toEqual(["a.py", "a-2.py"]);
  });
});

describe("mémoire locale et prompt final", () => {
  it("ajoute, met à jour, supprime et évite les doublons", async () => {
    const store = new ConfigStore(await tmpDir());
    const a = await addNote(store, "  Je m'appelle   Ice ");
    expect(a.note.text).toBe("Je m'appelle Ice");
    expect((await addNote(store, "je m'appelle ice")).existing).toBe(true);
    await updateNote(store, a.note.id, "Je suis développeur");
    expect((await store.read()).memory.notes[0]?.text).toBe("Je suis développeur");
    await expect(addNote(store, "x")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(addNote(store, "y".repeat(301))).rejects.toMatchObject({ code: "VALIDATION" });
    await deleteNote(store, a.note.id);
    expect((await store.read()).memory.notes).toHaveLength(0);
    await expect(deleteNote(store, "inconnu")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("limite à 50 notes et persiste après redémarrage", async () => {
    const dir = await tmpDir();
    const store = new ConfigStore(dir);
    for (let i = 0; i < 50; i++) await addNote(store, `note numéro ${i}`);
    await expect(addNote(store, "une de trop")).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await new ConfigStore(dir).read()).memory.notes).toHaveLength(50);
  });

  it("compose le prompt : base + mode + mémoire (si activée)", async () => {
    const store = new ConfigStore(await tmpDir());
    await addNote(store, "Je préfère les réponses courtes");
    let cfg = await store.read();
    const p = composeSystemPrompt({ base: "BASE", modeId: "code", memory: cfg.memory });
    expect(p.startsWith("BASE")).toBe(true);
    expect(p).toContain("Mode Programmation");
    expect(p).toContain("- Je préfère les réponses courtes");
    await setMemoryEnabled(store, false);
    cfg = await store.read();
    expect(memoryPromptBlock(cfg.memory)).toBe("");
    expect(composeSystemPrompt({ base: "BASE", modeId: "inconnu", memory: cfg.memory })).toBe("BASE");
  });

  it("propose des modes cohérents", () => {
    expect(MODES.map((m) => m.id)).toContain("web");
    expect(getMode("nimporte").id).toBe("general");
    expect(new Set(MODES.map((m) => m.id)).size).toBe(MODES.length);
  });

  it("assainit la configuration (recherche, mémoire)", () => {
    const c = sanitizeConfig({ search: { url: "ftp://nope", maxResults: 3 }, memory: { enabled: false, notes: [{ id: "1", text: "ok" }, { bad: true }] } });
    expect(c.search.url).toBe(""); // invalide → valeurs par défaut
    expect(c.memory).toMatchObject({ enabled: false });
    expect(c.memory.notes).toHaveLength(1);
  });
});

const MD = `# Rapport

Un paragraphe avec **gras** et \`code\`.

- point un
- point deux

| Nom | Âge |
|-----|-----|
| Awa | 30 |
| Koffi | 25 |

## Suite

\`\`\`python
print("é")
\`\`\`
`;

describe("export de documents et relecture", () => {
  it("Word : crée un .docx lisible avec titres, listes et tableau", async () => {
    const buf = await exportDocx(MD, "Mon rapport");
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const back = await extractText("rapport.docx", buf);
    expect(back.text).toContain("Mon rapport");
    expect(back.text).toContain("point deux");
    expect(back.text).toContain("Koffi");
    expect(back.text).toContain('print("é")');
  });

  it("PDF : crée un PDF dont le texte est extractible", async () => {
    const buf = await exportPdf(MD + "\n\nÉté « test » 😀", "Titre PDF");
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const back = await extractText("x.pdf", buf);
    expect(back.pages).toBeGreaterThanOrEqual(1);
    expect(back.text).toContain("Titre PDF");
    expect(back.text).toContain("point un");
    expect(back.text).toContain("Été");
  });

  it("Excel : un onglet par tableau, nombres convertis ; erreur claire sans tableau", async () => {
    const buf = await exportXlsx(MD + "\n```csv\nville;pop\nCotonou;680000\n```\n");
    const back = await extractText("t.xlsx", buf);
    expect(back.text).toContain("# Feuille : Tableau 1");
    expect(back.text).toContain("Awa;30");
    expect(back.text).toContain("Cotonou;680000");
    await expect(exportXlsx("juste du texte")).rejects.toMatchObject({ code: "EXPORT_FAILED" });
  });

  it("PowerPoint : couverture + une diapositive par titre", async () => {
    const buf = await exportPptx(MD, "Présentation");
    const files = unzipSync(new Uint8Array(buf));
    const slides = Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    expect(slides.length).toBe(3); // couverture, « Rapport », « Suite »
    const all = slides.map((k) => strFromU8(files[k]!)).join(" ");
    expect(all).toContain("Présentation");
    expect(all).toContain("point un");
    expect(all).toContain("Suite");
  });
});

describe("lecture des fichiers joints", () => {
  it("lit les fichiers texte (BOM, CRLF)", async () => {
    const r = await extractText("notes.md", Buffer.from("\uFEFFligne1\r\nligne2", "utf8"));
    expect(r).toMatchObject({ name: "notes.md", text: "ligne1\nligne2", chars: 13 });
  });
  it("refuse les formats non lisibles avec une explication", async () => {
    await expect(extractText("virus.exe", Buffer.from("MZ"))).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(extractText("photo.png", Buffer.from("x"))).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(extractText("ancien.doc", Buffer.from("x"))).rejects.toMatchObject({ code: "UNSUPPORTED_FILE", hint: expect.stringContaining(".docx") });
    await expect(extractText("inconnu.zzz", Buffer.from([1, 2, 0, 3]))).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(extractText("vide.txt", Buffer.alloc(0))).rejects.toMatchObject({ code: "EXTRACT_FAILED" });
    await expect(extractText("faux.pdf", Buffer.from("pas un pdf"))).rejects.toMatchObject({ code: "EXTRACT_FAILED" });
    await expect(extractText("gros.txt", Buffer.alloc(9 * 1024 * 1024, 97))).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
  it("garde uniquement le nom du fichier (pas de chemin)", async () => {
    expect((await extractText("..\\..\\secret\\a.txt".replace(/\\/g, path.sep), Buffer.from("x"))).name).toBe("a.txt");
  });
});
