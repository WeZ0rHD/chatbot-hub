// Chatbot Hub — tests (node:test, sans dépendance).
// Lancer : node --experimental-strip-types --test tests/
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDERS,
  buildAnthropicRequest,
  buildOllamaRequest,
  buildOpenAIRequest,
  buildPrompt,
  estimateTokens,
  fixtureScript,
  formatUsage,
  getProvider,
  localAvailability,
  localReply,
  normalizeOllamaHost,
  streamChunks,
  unknownUsage,
} from "../lib/providers.ts";
import {
  deriveTitle,
  exportAll,
  exportSession,
  importMany,
  importSession,
  newSession,
  sessionMatches,
  touchUnread,
} from "../lib/chat-store.ts";
import { TEMPLATES, getTemplate } from "../lib/templates.ts";

describe("providers — registre", () => {
  it("expose au moins 6 adapters modulaires, ids uniques", () => {
    assert.ok(PROVIDERS.length >= 6);
    const ids = PROVIDERS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("local + mock-fixture disponibles sans clé ; fixture labellisée", () => {
    assert.equal(localAvailability("local").available, true);
    assert.equal(localAvailability("mock-fixture").available, true);
    const fixture = getProvider("mock-fixture");
    assert.equal(fixture?.fixture, true);
  });

  it("openai/anthropic/ollama/axon non disponibles sans configuration", () => {
    for (const id of ["openai", "anthropic", "ollama", "axon"] as const) {
      assert.equal(localAvailability(id).available, false, id);
    }
  });

  it("chaque provider a nom, modèles et hint (identité claire)", () => {
    for (const p of PROVIDERS) {
      assert.ok(p.name.length > 0, p.id);
      assert.ok(p.models.length > 0, p.id);
      assert.ok(p.hint.length > 0, p.id);
    }
  });
});

describe("providers — payloads purs (aucun secret)", () => {
  it("openai vise le vrai endpoint, sans clé dans le payload", () => {
    const r = buildOpenAIRequest("gpt-4o-mini", [{ role: "user", content: "hello" }]);
    assert.equal(r.url, "https://api.openai.com/v1/chat/completions");
    assert.ok(!JSON.stringify(r.body).includes("sk-"));
    assert.equal(r.body.stream, true);
  });

  it("anthropic extrait le system et vise le vrai endpoint", () => {
    const r = buildAnthropicRequest("claude-sonnet-4-20250514", [
      { role: "system", content: "Projet associé : hub" },
      { role: "user", content: "hello" },
    ]);
    assert.equal(r.url, "https://api.anthropic.com/v1/messages");
    assert.equal(r.body.system, "Projet associé : hub");
    assert.equal(r.body.messages.length, 1);
  });

  it("ollama normalise l'hôte (avec ou sans schéma)", () => {
    assert.equal(normalizeOllamaHost(undefined), "127.0.0.1:11434");
    const a = buildOllamaRequest("127.0.0.1:11434", "llama3.1", []);
    const b = buildOllamaRequest("http://127.0.0.1:11434/", "llama3.1", []);
    assert.equal(a.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(b.url, "http://127.0.0.1:11434/api/chat");
  });

  it("buildPrompt injecte projet + contexte en system", () => {
    const msgs = buildPrompt("hub", "contexte X", [{ role: "user", content: "go" }]);
    assert.equal(msgs[0]?.role, "system");
    assert.ok(msgs[0]?.content.includes("hub"));
    assert.ok(msgs[0]?.content.includes("contexte X"));
  });

  it("usage UNKNOWN quand le provider ne renvoie rien", () => {
    const u = unknownUsage("abcdefgh");
    assert.equal(u.promptTokens, null);
    assert.ok(formatUsage(u).startsWith("usage UNKNOWN"));
    assert.equal(estimateTokens("abcd"), 1);
  });
});

describe("providers — streaming local (cancel/restart)", () => {
  it("streamChunks rejouent le texte complet joint", async () => {
    const text = "bonjour le monde, ceci est un test de streaming local.";
    const ctl = new AbortController();
    let acc = "";
    for await (const c of streamChunks(text, ctl.signal, 2, 1)) acc += c;
    assert.equal(acc, text);
  });

  it("abort (cancel) stoppe le stream sans erreur", async () => {
    const text = "un deux trois quatre cinq six sept huit neuf dix onze douze";
    const ctl = new AbortController();
    let acc = "";
    let n = 0;
    for await (const c of streamChunks(text, ctl.signal, 1, 5)) {
      acc += c;
      n += 1;
      if (n === 2) ctl.abort();
    }
    assert.ok(acc.length < text.length, "le cancel doit tronquer le stream");
  });

  it("fixture déterministe et labellisée ; local cite le projet", () => {
    assert.ok(fixtureScript("hello").includes("MOCK-FIXTURE"));
    assert.equal(fixtureScript("hello"), fixtureScript("hello"));
    assert.ok(localReply("hello", "hub", "", 0, 0).includes("hub"));
  });
});

describe("templates", () => {
  it("liste non vide, ids uniques, corps non vides", () => {
    assert.ok(TEMPLATES.length >= 4);
    assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
    for (const t of TEMPLATES) assert.ok(t.body.trim().length > 0, t.id);
    assert.ok(getTemplate("resume")?.body.includes("5 puces"));
  });
});

describe("chat-store — sessions", () => {
  it("newSession + deriveTitle", () => {
    const s = newSession("local", "local-assistant-v1");
    assert.equal(s.status, "idle");
    assert.equal(s.unread, 0);
    assert.deepEqual(s.messages, []);
    assert.equal(deriveTitle("  hello world  "), "hello world");
    assert.ok(deriveTitle("x".repeat(100)).endsWith("…"));
  });

  it("sessionMatches cherche titre/projet/messages", () => {
    const s = { ...newSession("openai", "gpt-4o-mini"), title: "Debug auth", project: "hub" };
    assert.equal(sessionMatches(s, "auth"), true);
    assert.equal(sessionMatches(s, "HUB"), true);
    assert.equal(sessionMatches(s, "zzz-introuvable"), false);
  });

  it("touchUnread : +1 si inactive, reset si active", () => {
    const s = newSession("local", "m");
    assert.equal(touchUnread(s, false).unread, 1);
    assert.equal(touchUnread({ ...s, unread: 3 }, true).unread, 0);
  });

  it("export/import roundtrip + import lot + rejets", () => {
    const s = { ...newSession("anthropic", "claude-sonnet-4-20250514"), title: "T" };
    const back = importSession(exportSession(s));
    assert.equal(back.id, s.id);
    assert.equal(back.status, "idle");
    const many = importMany(exportAll([s, s]));
    assert.equal(many.length, 2);
    assert.throws(() => importSession("pas du json"), Error);
    assert.throws(() => importSession(JSON.stringify({ nope: 1 })), /invalide/);
  });
});
