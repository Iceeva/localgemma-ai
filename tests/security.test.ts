import { describe, expect, it, vi } from "vitest";
import { checkRequestAllowed, hostnameOf, REQUEST_HEADER } from "@/lib/security";
import { allowPathInput, consumeTicket, issueTicket, resolveSelection } from "@/lib/server/selection";
import { AppError } from "@/lib/server/errors";

const base = { method: "GET", host: "localhost:3000", origin: null, customHeader: null };

describe("garde des routes API", () => {
  it("autorise les requêtes locales", () => {
    expect(checkRequestAllowed(base).allowed).toBe(true);
    expect(checkRequestAllowed({ ...base, host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }).allowed).toBe(true);
    expect(checkRequestAllowed({ ...base, host: "[::1]:3000" }).allowed).toBe(true);
  });

  it("refuse un hôte non local (DNS rebinding, accès réseau)", () => {
    expect(checkRequestAllowed({ ...base, host: "evil.example.com" }).allowed).toBe(false);
    expect(checkRequestAllowed({ ...base, host: "192.168.1.10:3000" }).allowed).toBe(false);
    expect(checkRequestAllowed({ ...base, host: null }).allowed).toBe(false);
  });

  it("refuse une origine différente ou opaque", () => {
    expect(checkRequestAllowed({ ...base, origin: "https://evil.example.com" }).allowed).toBe(false);
    expect(checkRequestAllowed({ ...base, origin: "http://localhost:9999" }).allowed).toBe(false);
    expect(checkRequestAllowed({ ...base, origin: "null" }).allowed).toBe(false);
    expect(checkRequestAllowed({ ...base, secFetchSite: "cross-site" }).allowed).toBe(false);
  });

  it("exige l'en-tête de protection sur les requêtes modifiantes", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(checkRequestAllowed({ ...base, method }).allowed).toBe(false);
      expect(checkRequestAllowed({ ...base, method, customHeader: "1" }).allowed).toBe(true);
    }
    expect(REQUEST_HEADER).toBe("x-localgemma-request");
  });

  it("extrait le nom d'hôte", () => {
    expect(hostnameOf("LOCALHOST:3000")).toBe("localhost");
    expect(hostnameOf("[::1]:3000")).toBe("[::1]");
  });
});

describe("tickets de sélection graphique", () => {
  it("sont à usage unique et liés à un type", () => {
    const t = issueTicket("engine", "/x/llama-server");
    expect(() => consumeTicket(t, "gguf")).toThrow(AppError); // mauvais type : refusé
    const t2 = issueTicket("engine", "/x/llama-server");
    expect(consumeTicket(t2, "engine")).toBe("/x/llama-server");
    expect(() => consumeTicket(t2, "engine")).toThrow(AppError); // déjà utilisé
  });

  it("expirent", () => {
    const t = issueTicket("folder", "/x");
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);
    expect(() => consumeTicket(t, "folder")).toThrow(AppError);
    spy.mockRestore();
  });

  it("refusent un ticket inconnu", () => {
    expect(() => consumeTicket("nimporte-quoi", "engine")).toThrow(AppError);
    expect(() => consumeTicket(undefined, "engine")).toThrow(AppError);
  });

  it("n'acceptent un chemin libre que si le mode avancé est activé", () => {
    expect(allowPathInput({})).toBe(false);
    expect(() => resolveSelection({ path: "/tmp/x.gguf" }, "gguf", {})).toThrow(AppError);
    expect(resolveSelection({ path: "/tmp/x.gguf" }, "gguf", { LOCALGEMMA_ALLOW_PATH_INPUT: "1" })).toBe("/tmp/x.gguf");
    expect(() => resolveSelection({ path: "../x.gguf" }, "gguf", { LOCALGEMMA_ALLOW_PATH_INPUT: "1" })).toThrow(AppError);
  });
});
