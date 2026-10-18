import { marked, type Token, type Tokens } from "marked";
import { AppError } from "./errors";

export type ExportFormat = "docx" | "pdf" | "xlsx" | "pptx";
export const EXPORT_MIME: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");

/** Texte brut d'un jeton Markdown (sans la mise en forme en ligne). */
export function plain(t: Token | undefined): string {
  if (!t) return "";
  const x = t as Token & { tokens?: Token[]; text?: string };
  if (x.type === "br") return "\n";
  if (x.type === "image") return (x as Tokens.Image).text;
  if (x.tokens?.length) return x.tokens.map(plain).join("");
  return decode(x.text ?? x.raw ?? "");
}

function blocks(markdown: string): Token[] {
  return marked.lexer(markdown).filter((t) => t.type !== "space");
}
const listItems = (t: Tokens.List) => t.items.map((it) => it.tokens.filter((x) => x.type !== "list").map(plain).join(" ").trim());
const tableRows = (t: Tokens.Table): string[][] => [t.header.map((h) => plain({ type: "text", raw: h.text, text: h.text, tokens: h.tokens } as Token)), ...t.rows.map((r) => r.map((c) => plain({ type: "text", raw: c.text, text: c.text, tokens: c.tokens } as Token)))];

// ---------------------------------------------------------------- Word
export async function exportDocx(markdown: string, title: string): Promise<Buffer> {
  const d = await import("docx");
  const runs = (tokens: Token[] | undefined, base: { bold?: boolean; italics?: boolean } = {}): InstanceType<typeof d.TextRun>[] => {
    const out: InstanceType<typeof d.TextRun>[] = [];
    for (const t of tokens ?? []) {
      const x = t as Token & { tokens?: Token[]; text?: string };
      if (x.type === "strong") out.push(...runs(x.tokens, { ...base, bold: true }));
      else if (x.type === "em") out.push(...runs(x.tokens, { ...base, italics: true }));
      else if (x.type === "codespan") out.push(new d.TextRun({ text: decode(x.text ?? ""), font: "Consolas", ...base }));
      else if (x.type === "br") out.push(new d.TextRun({ break: 1 }));
      else if (x.tokens?.length) out.push(...runs(x.tokens, base));
      else out.push(new d.TextRun({ text: plain(x), ...base }));
    }
    return out;
  };
  const heading = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
  const children: Array<InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>> = [];
  children.push(new d.Paragraph({ text: title, heading: d.HeadingLevel.TITLE }));

  const addList = (t: Tokens.List, level: number) => {
    t.items.forEach((it) => {
      const inline = it.tokens.filter((x) => x.type !== "list");
      children.push(new d.Paragraph({ children: runs(inline.flatMap((x) => (x as Token & { tokens?: Token[] }).tokens ?? [x])), ...(t.ordered ? { numbering: { reference: "num", level } } : { bullet: { level } }) }));
      for (const sub of it.tokens) if (sub.type === "list") addList(sub as Tokens.List, level + 1);
    });
  };

  for (const t of blocks(markdown)) {
    if (t.type === "heading") children.push(new d.Paragraph({ children: runs((t as Tokens.Heading).tokens), heading: heading[Math.min(5, (t as Tokens.Heading).depth - 1)] }));
    else if (t.type === "paragraph") children.push(new d.Paragraph({ children: runs((t as Tokens.Paragraph).tokens), spacing: { after: 120 } }));
    else if (t.type === "list") addList(t as Tokens.List, 0);
    else if (t.type === "code") {
      for (const line of decode((t as Tokens.Code).text).split("\n")) {
        children.push(new d.Paragraph({ children: [new d.TextRun({ text: line || " ", font: "Consolas", size: 20 })], shading: { type: d.ShadingType.CLEAR, fill: "F3F4F6" } }));
      }
    } else if (t.type === "blockquote") children.push(new d.Paragraph({ children: [new d.TextRun({ text: plain(t), italics: true })], indent: { left: 540 } }));
    else if (t.type === "table") {
      const rows = tableRows(t as Tokens.Table);
      children.push(
        new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          rows: rows.map((r, i) => new d.TableRow({ children: r.map((c) => new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text: c, bold: i === 0 })] })] })) })),
        }),
      );
      children.push(new d.Paragraph({ text: "" }));
    } else if (t.type === "hr") children.push(new d.Paragraph({ text: "", border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } }));
    else if (t.raw.trim()) children.push(new d.Paragraph({ text: plain(t) }));
  }
  const doc = new d.Document({
    title,
    creator: "LocalGemma AI",
    numbering: { config: [{ reference: "num", levels: [0, 1, 2].map((level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.START })) }] },
    sections: [{ children }],
  });
  return Buffer.from(await d.Packer.toBuffer(doc));
}

// ---------------------------------------------------------------- PDF
/** Les polices PDF standard ne couvrent que le jeu WinAnsi : le reste est remplacé par « ? ». */
function winAnsi(s: string): string {
  return s.replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF‘’“”–—…•€™]/g, "?");
}

export async function exportPdf(markdown: string, title: string): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: title, Creator: "LocalGemma AI" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const sizes = [20, 16, 14, 12, 11, 11];
  doc.font("Helvetica-Bold").fontSize(22).text(winAnsi(title)).moveDown(0.8);
  const writeList = (t: Tokens.List, indent: number) => {
    t.items.forEach((it, i) => {
      const text = it.tokens.filter((x) => x.type !== "list").map(plain).join(" ").trim();
      doc.font("Helvetica").fontSize(11).text(`${t.ordered ? `${i + 1}.` : "•"} ${winAnsi(text)}`, { indent, paragraphGap: 2 });
      for (const sub of it.tokens) if (sub.type === "list") writeList(sub as Tokens.List, indent + 16);
    });
  };
  for (const t of blocks(markdown)) {
    if (t.type === "heading") doc.moveDown(0.4).font("Helvetica-Bold").fontSize(sizes[Math.min(5, (t as Tokens.Heading).depth - 1)] ?? 12).text(winAnsi(plain(t))).moveDown(0.3);
    else if (t.type === "paragraph") doc.font("Helvetica").fontSize(11).text(winAnsi(plain(t)), { paragraphGap: 6, lineGap: 2 });
    else if (t.type === "list") writeList(t as Tokens.List, 8);
    else if (t.type === "code") doc.moveDown(0.2).font("Courier").fontSize(9).fillColor("#222222").text(winAnsi(decode((t as Tokens.Code).text)), { paragraphGap: 8 }).fillColor("black");
    else if (t.type === "blockquote") doc.font("Helvetica-Oblique").fontSize(11).fillColor("#444444").text(winAnsi(plain(t)), { indent: 16, paragraphGap: 6 }).fillColor("black");
    else if (t.type === "table") {
      for (const [i, r] of tableRows(t as Tokens.Table).entries()) doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10).text(winAnsi(r.join("   |   ")), { paragraphGap: 2 });
      doc.moveDown(0.5);
    } else if (t.type === "hr") doc.moveDown(0.3).moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#999999").stroke().moveDown(0.5);
    else if (t.raw.trim()) doc.font("Helvetica").fontSize(11).text(winAnsi(plain(t)));
  }
  doc.end();
  return done;
}

// ---------------------------------------------------------------- Excel
function parseCsv(text: string): string[][] {
  const delim = (text.split("\n")[0] ?? "").split(";").length > (text.split("\n")[0] ?? "").split(",").length ? ";" : ",";
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const cells: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (ch === '"') {
          if (q && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = !q;
        } else if (ch === delim && !q) {
          cells.push(cur);
          cur = "";
        } else cur += ch;
      }
      cells.push(cur);
      return cells.map((c) => c.trim());
    });
}

export async function exportXlsx(markdown: string): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const tables: string[][][] = [];
  for (const t of blocks(markdown)) {
    if (t.type === "table") tables.push(tableRows(t as Tokens.Table));
    else if (t.type === "code" && /^(csv|tsv)$/i.test((t as Tokens.Code).lang ?? "")) tables.push(parseCsv((t as Tokens.Code).text));
  }
  if (tables.length === 0) {
    throw new AppError("EXPORT_FAILED", "Cette réponse ne contient aucun tableau.", "Demandez au modèle un tableau Markdown ou un bloc CSV, puis réessayez l'export Excel.");
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "LocalGemma AI";
  tables.forEach((rows, i) => {
    const ws = wb.addWorksheet(`Tableau ${i + 1}`);
    rows.forEach((r) => ws.addRow(r.map((c) => (c !== "" && !Number.isNaN(Number(c.replace(",", "."))) ? Number(c.replace(",", ".")) : c))));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col, ci) => {
      col.width = Math.min(60, Math.max(10, ...rows.map((r) => (r[ci] ?? "").length + 2)));
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PowerPoint
export async function exportPptx(markdown: string, title: string): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  pptx.author = "LocalGemma AI";
  const cover = pptx.addSlide();
  cover.background = { color: "1F2937" };
  cover.addText(title, { x: 0.7, y: 2.4, w: 11.9, h: 1.5, fontSize: 38, bold: true, color: "FFFFFF", fontFace: "Calibri" });
  cover.addText("Généré avec LocalGemma AI", { x: 0.7, y: 4.0, w: 11.9, h: 0.5, fontSize: 16, color: "9CA3AF" });

  type Slide = { title: string; bullets: string[]; code: string[]; tables: string[][][] };
  const slides: Slide[] = [];
  let cur: Slide | null = null;
  const ensure = (): Slide => (cur ??= (slides[slides.push({ title, bullets: [], code: [], tables: [] }) - 1] as Slide));
  for (const t of blocks(markdown)) {
    if (t.type === "heading" && (t as Tokens.Heading).depth <= 2) {
      cur = { title: plain(t), bullets: [], code: [], tables: [] };
      slides.push(cur);
    } else if (t.type === "heading") ensure().bullets.push(plain(t));
    else if (t.type === "paragraph") ensure().bullets.push(plain(t));
    else if (t.type === "list") ensure().bullets.push(...listItems(t as Tokens.List));
    else if (t.type === "code") ensure().code.push(decode((t as Tokens.Code).text));
    else if (t.type === "table") ensure().tables.push(tableRows(t as Tokens.Table));
  }
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.6, y: 0.3, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: "111827", fontFace: "Calibri" });
    let y = 1.3;
    if (s.bullets.length) {
      const items = s.bullets.slice(0, 9);
      slide.addText(items.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.7, y, w: 11.9, h: Math.min(4.2, 0.5 * items.length + 0.4), fontSize: 18, color: "1F2937", valign: "top", fontFace: "Calibri" });
      y += Math.min(4.2, 0.5 * items.length + 0.4) + 0.1;
    }
    for (const t of s.tables.slice(0, 1)) {
      slide.addTable(t.slice(0, 10).map((r, i) => r.map((c) => ({ text: c, options: { bold: i === 0, fontSize: 12 } }))), { x: 0.7, y, w: 11.9, border: { type: "solid", color: "CCCCCC", pt: 1 } });
      y += 0.4 * Math.min(10, t.length) + 0.2;
    }
    if (s.code.length && y < 6.4) slide.addText(s.code.join("\n").slice(0, 900), { x: 0.7, y, w: 11.9, h: Math.max(0.8, 7.2 - y), fontSize: 11, fontFace: "Consolas", color: "111827", fill: { color: "F3F4F6" }, valign: "top" });
  }
  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return Buffer.from(out);
}

export async function exportDocument(format: ExportFormat, markdown: string, title: string): Promise<Buffer> {
  try {
    if (format === "docx") return await exportDocx(markdown, title);
    if (format === "pdf") return await exportPdf(markdown, title);
    if (format === "xlsx") return await exportXlsx(markdown);
    return await exportPptx(markdown, title);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("EXPORT_FAILED", "La création du fichier a échoué.", "Réessayez avec un texte plus court.", 500, String(e));
  }
}
