import fs from "node:fs/promises";
import path from "node:path";

export interface GgufMetadata {
  version: number;
  architecture?: string;
  name?: string;
  sizeLabel?: string;
  fileType?: number;
  quantization?: string;
  contextLength?: number;
}

/** Table llama_ftype de llama.cpp (valeur de general.file_type). */
const FILE_TYPES: Record<number, string> = {
  0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 7: "Q8_0", 8: "Q5_0", 9: "Q5_1", 10: "Q2_K", 11: "Q3_K_S", 12: "Q3_K_M",
  13: "Q3_K_L", 14: "Q4_K_S", 15: "Q4_K_M", 16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K", 19: "IQ2_XXS", 20: "IQ2_XS",
  21: "Q2_K_S", 22: "IQ3_XS", 23: "IQ3_XXS", 24: "IQ1_S", 25: "IQ4_NL", 26: "IQ3_S", 27: "IQ3_M", 28: "IQ2_S",
  29: "IQ2_M", 30: "IQ4_XS", 31: "IQ1_M", 32: "BF16",
};

const FIXED_SIZE: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const HEADER_BYTES = 4 * 1024 * 1024;

class Reader {
  pos = 0;
  constructor(private buf: Buffer) {}
  u32(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u64(): number {
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("valeur trop grande");
    return Number(v);
  }
  str(): string {
    const len = this.u64();
    if (len > 1 << 20 || this.pos + len > this.buf.length) throw new RangeError("chaîne hors limites");
    const s = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
  scalar(type: number): number | boolean | string {
    switch (type) {
      case 0: return this.buf.readUInt8(this.pos++);
      case 1: return this.buf.readInt8(this.pos++);
      case 2: { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
      case 3: { const v = this.buf.readInt16LE(this.pos); this.pos += 2; return v; }
      case 4: return this.u32();
      case 5: { const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
      case 6: { const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
      case 7: return this.buf.readUInt8(this.pos++) !== 0;
      case 8: return this.str();
      case 10: return this.u64();
      case 11: { const v = this.buf.readBigInt64LE(this.pos); this.pos += 8; return Number(v); }
      case 12: { const v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v; }
      default: throw new RangeError("type GGUF inconnu : " + type);
    }
  }
  skipArray(): void {
    const elemType = this.u32();
    const count = this.u64();
    const size = FIXED_SIZE[elemType];
    if (size !== undefined) {
      this.pos += size * count;
      if (this.pos > this.buf.length) throw new RangeError("tableau hors limites");
      return;
    }
    for (let i = 0; i < count; i++) {
      if (elemType === 8) this.str();
      else if (elemType === 9) this.skipArray();
      else throw new RangeError("type de tableau inconnu");
    }
  }
}

/** Lit l'en-tête GGUF (pure : testable sans fichier). Retourne null si la signature est absente. */
export function parseGgufHeader(buf: Buffer): GgufMetadata | null {
  if (buf.length < 24 || buf.toString("latin1", 0, 4) !== "GGUF") return null;
  const meta: GgufMetadata = { version: buf.readUInt32LE(4) };
  const contextLengths = new Map<string, number>();
  try {
    const r = new Reader(buf);
    r.pos = 8;
    r.u64(); // nombre de tenseurs
    const kvCount = r.u64();
    for (let i = 0; i < kvCount; i++) {
      const key = r.str();
      const type = r.u32();
      if (type === 9) {
        r.skipArray();
        continue;
      }
      const value = r.scalar(type);
      if (key === "general.architecture" && typeof value === "string") meta.architecture = value;
      else if (key === "general.name" && typeof value === "string") meta.name = value;
      else if (key === "general.size_label" && typeof value === "string") meta.sizeLabel = value;
      else if (key === "general.file_type" && typeof value === "number") meta.fileType = value;
      else if (key.endsWith(".context_length") && typeof value === "number") contextLengths.set(key, value);
      if (meta.architecture && meta.fileType !== undefined && contextLengths.has(`${meta.architecture}.context_length`)) break;
    }
  } catch {
    /* en-tête tronqué ou inattendu : on garde ce qui a été lu */
  }
  if (meta.fileType !== undefined) meta.quantization = FILE_TYPES[meta.fileType];
  if (meta.architecture) meta.contextLength = contextLengths.get(`${meta.architecture}.context_length`);
  return meta;
}

export async function readGgufMetadata(file: string): Promise<GgufMetadata | null> {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
    return parseGgufHeader(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

/** Devine la quantification à partir du nom de fichier (repli, à signaler comme tel). */
export function quantizationFromFileName(fileName: string): string | undefined {
  const base = path.basename(fileName, path.extname(fileName));
  const m = base.match(/(?:^|[-_. ])((?:IQ|Q)\d(?:_[A-Z0-9]+)*|BF16|F16|F32)(?=$|[-_. ])/i);
  return m?.[1]?.toUpperCase();
}
