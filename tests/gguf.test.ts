import { describe, expect, it } from "vitest";
import { parseGgufHeader, quantizationFromFileName, readGgufMetadata } from "@/lib/server/gguf";
import { buildGguf, tmpDir, writeGguf } from "./helpers";
import path from "node:path";

describe("métadonnées GGUF", () => {
  it("lit architecture, nom, quantification et contexte", () => {
    const meta = parseGgufHeader(buildGguf({ arch: "gemma2", name: "Gemma 2 2B", fileType: 15, contextLength: 8192 }));
    expect(meta).toMatchObject({ version: 3, architecture: "gemma2", name: "Gemma 2 2B", quantization: "Q4_K_M", contextLength: 8192 });
  });

  it("saute les tableaux (ex. vocabulaire) pour atteindre les clés suivantes", () => {
    const meta = parseGgufHeader(buildGguf({ arch: "llama", withTokenArray: true, fileType: 7, contextLength: 4096 }));
    expect(meta?.quantization).toBe("Q8_0");
    expect(meta?.contextLength).toBe(4096);
  });

  it("retourne null sans signature GGUF et résiste à un en-tête tronqué", () => {
    expect(parseGgufHeader(Buffer.from("PAS-UN-GGUF-DU-TOUT-1234567890"))).toBeNull();
    const full = buildGguf({ arch: "qwen2", name: "Q", fileType: 2, contextLength: 1000 });
    const cut = parseGgufHeader(full.subarray(0, full.length - 6));
    expect(cut?.architecture).toBe("qwen2");
  });

  it("lit un fichier sur disque", async () => {
    const f = await writeGguf(path.join(await tmpDir(), "x.gguf"), { arch: "phi3", fileType: 1 });
    expect((await readGgufMetadata(f))?.quantization).toBe("F16");
  });

  it("devine la quantification d'après le nom de fichier", () => {
    expect(quantizationFromFileName("gemma-2-2b-it-Q4_K_M.gguf")).toBe("Q4_K_M");
    expect(quantizationFromFileName("Llama-3.2-1B-Instruct-Q8_0.gguf")).toBe("Q8_0");
    expect(quantizationFromFileName("model.IQ3_XS.gguf")).toBe("IQ3_XS");
    expect(quantizationFromFileName("mystere.gguf")).toBeUndefined();
  });
});
