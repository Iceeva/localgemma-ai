import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "llama-server");

export async function tmpDir(prefix = "lg-test-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function ensureEngineExecutable(): Promise<void> {
  await fs.chmod(FAKE_ENGINE, 0o755);
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function str(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(b.length));
  return Buffer.concat([len, b]);
}
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

export interface FakeGguf {
  arch?: string;
  name?: string;
  fileType?: number;
  contextLength?: number;
  withTokenArray?: boolean;
}

/** Construit un minuscule fichier GGUF valide (en-tête + métadonnées, sans tenseurs). */
export function buildGguf(o: FakeGguf = {}): Buffer {
  const kvs: Buffer[] = [];
  const kv = (key: string, type: number, value: Buffer) => kvs.push(Buffer.concat([str(key), u32(type), value]));
  const arch = o.arch ?? "gemma2";
  kv("general.architecture", 8, str(arch));
  if (o.name) kv("general.name", 8, str(o.name));
  if (o.withTokenArray) {
    const tokens = ["<a>", "<b>", "é"].map(str);
    const count = Buffer.alloc(8);
    count.writeBigUInt64LE(BigInt(tokens.length));
    kv("tokenizer.ggml.tokens", 9, Buffer.concat([u32(8), count, ...tokens]));
  }
  if (o.fileType !== undefined) kv("general.file_type", 4, u32(o.fileType));
  if (o.contextLength !== undefined) kv(`${arch}.context_length`, 4, u32(o.contextLength));
  const head = Buffer.alloc(24);
  head.write("GGUF", 0, "latin1");
  head.writeUInt32LE(3, 4);
  head.writeBigUInt64LE(0n, 8);
  head.writeBigUInt64LE(BigInt(kvs.length), 16);
  return Buffer.concat([head, ...kvs]);
}

export async function writeGguf(file: string, o: FakeGguf = {}): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buildGguf(o));
  return file;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
