// Chatbot Hub — passerelle serveur /api/chat.
// SÉCURITÉ : les clés sont lues ici uniquement (process.env), jamais envoyées
// au client, jamais loggées (ni valeur, ni préfixe). Les logs ne contiennent
// que provider/modèle/compteurs. Les adapters local/mock-fixture sont
// traités côté client et sont refusés ici (400).

import { NextRequest } from "next/server";
import { normalizeOllamaHost } from "../../../lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "openai" | "anthropic" | "ollama" | "axon";

interface WireMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function hasKey(name: string): boolean {
  const v = process.env[name];
  return !!v && v.trim().length > 0;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function probe(url: string, ms: number, init?: RequestInit): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { ...init, signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const ollamaHost = normalizeOllamaHost(process.env.OLLAMA_HOST);
  const ollamaBase = ollamaHost.startsWith("http") ? ollamaHost : `http://${ollamaHost}`;
  const [ollamaUp, axonUp] = await Promise.all([
    probe(`${ollamaBase.replace(/\/$/, "")}/api/tags`, 3000),
    process.env.AXON_CHAT_URL ? probe(process.env.AXON_CHAT_URL, 3000) : Promise.resolve(false),
  ]);
  return json({
    providers: [
      { id: "local", available: true, reason: "moteur hors-ligne embarqué" },
      { id: "mock-fixture", available: true, reason: "fixture de test (mock labellisé)" },
      {
        id: "openai",
        available: hasKey("OPENAI_API_KEY"),
        reason: hasKey("OPENAI_API_KEY") ? "clé serveur configurée" : "OPENAI_API_KEY absente côté serveur",
      },
      {
        id: "anthropic",
        available: hasKey("ANTHROPIC_API_KEY"),
        reason: hasKey("ANTHROPIC_API_KEY") ? "clé serveur configurée" : "ANTHROPIC_API_KEY absente côté serveur",
      },
      {
        id: "ollama",
        available: ollamaUp,
        reason: ollamaUp ? `daemon joint (${ollamaBase})` : `daemon injoignable (${ollamaBase})`,
      },
      {
        id: "axon",
        available: axonUp,
        reason: process.env.AXON_CHAT_URL
          ? axonUp ? "passerelle jointe" : "AXON_CHAT_URL injoignable"
          : "AXON_CHAT_URL non configuré",
      },
    ],
  });
}

export async function POST(req: NextRequest) {
  let body: {
    provider?: string;
    model?: string;
    messages?: WireMessage[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Corps JSON invalide." }, 400);
  }
  const rawProvider = body.provider as string | undefined;
  const model = (body.model ?? "").trim();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!rawProvider || !model || messages.length === 0)
    return json({ error: "provider, model et messages sont requis." }, 400);
  if (rawProvider === "local" || rawProvider === "mock-fixture")
    return json({ error: "Adapter local géré côté client (pas d'appel serveur)." }, 400);
  const provider = rawProvider as Provider;

  // Log volontairement pauvre : aucun secret, aucun contenu.
  console.log(
    `[chat] provider=${provider} model=${model} messages=${messages.length} chars=${messages.reduce((n, m) => n + (m.content?.length ?? 0), 0)}`,
  );

  try {
    if (provider === "openai") {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return json({ error: "OPENAI_API_KEY absente côté serveur.", code: "unavailable" }, 503);
      return streamFromUpstream(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          }),
        },
        parseOpenAIStream,
        req.signal,
      );
    }
    if (provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) return json({ error: "ANTHROPIC_API_KEY absente côté serveur.", code: "unavailable" }, 503);
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const rest = messages.filter((m) => m.role !== "system");
      return streamFromUpstream(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            ...(system ? { system } : {}),
            messages: rest,
            stream: true,
          }),
        },
        parseAnthropicStream,
        req.signal,
      );
    }
    if (provider === "ollama") {
      const host = normalizeOllamaHost(process.env.OLLAMA_HOST);
      const base = (host.startsWith("http") ? host : `http://${host}`).replace(/\/$/, "");
      return streamFromUpstream(
        `${base}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, messages, stream: true }),
        },
        parseOllamaStream,
        req.signal,
      );
    }
    if (provider === "axon") {
      const url = (process.env.AXON_CHAT_URL ?? "").trim();
      if (!url) return json({ error: "AXON_CHAT_URL non configuré.", code: "unavailable" }, 503);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (hasKey("AXON_API_KEY")) headers.authorization = `Bearer ${process.env.AXON_API_KEY}`;
      return streamFromUpstream(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
        },
        parseOpenAIStream,
        req.signal,
      );
    }
    return json({ error: `Provider inconnu : ${provider}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur passerelle.";
    return json({ error: msg, code: "upstream-error" }, 502);
  }
}

type ParseFn = (
  push: (delta: string) => void,
  setUsage: (u: { promptTokens: number | null; completionTokens: number | null }) => void,
) => (chunkText: string) => void;

function parseOpenAIStream(
  push: (d: string) => void,
  setUsage: (u: { promptTokens: number | null; completionTokens: number | null }) => void,
): (t: string) => void {
  let buf = "";
  return (text: string) => {
    buf += text;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) push(delta);
        if (j.usage) setUsage({ promptTokens: j.usage.prompt_tokens ?? null, completionTokens: j.usage.completion_tokens ?? null });
      } catch {
        // fragment non-JSON : ignoré (jamais de log de contenu).
      }
    }
  };
}

function parseAnthropicStream(
  push: (d: string) => void,
  setUsage: (u: { promptTokens: number | null; completionTokens: number | null }) => void,
): (t: string) => void {
  let buf = "";
  return (text: string) => {
    buf += text;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      try {
        const j = JSON.parse(payload) as {
          type?: string;
          delta?: { text?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        };
        if (j.delta?.text) push(j.delta.text);
        const u = j.usage ?? j.message?.usage;
        if (u) setUsage({ promptTokens: u.input_tokens ?? null, completionTokens: u.output_tokens ?? null });
      } catch {
        // ignoré
      }
    }
  };
}

function parseOllamaStream(
  push: (d: string) => void,
  setUsage: (u: { promptTokens: number | null; completionTokens: number | null }) => void,
): (t: string) => void {
  let buf = "";
  return (text: string) => {
    buf += text;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        const j = JSON.parse(s) as {
          message?: { content?: string };
          prompt_eval_count?: number;
          eval_count?: number;
        };
        if (j.message?.content) push(j.message.content);
        if (j.prompt_eval_count != null || j.eval_count != null)
          setUsage({ promptTokens: j.prompt_eval_count ?? null, completionTokens: j.eval_count ?? null });
      } catch {
        // ignoré
      }
    }
  };
}

async function streamFromUpstream(
  url: string,
  init: RequestInit,
  makeParser: ParseFn,
  clientSignal: AbortSignal,
): Promise<Response> {
  const upstream = await fetch(url, { ...init, signal: clientSignal });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    // On ne renvoie jamais la clé ; le corps d'erreur amont est tronqué.
    return json(
      { error: `Amont ${upstream.status} : ${text.slice(0, 300)}`, code: "upstream-error" },
      upstream.status === 401 || upstream.status === 403 ? upstream.status : 502,
    );
  }
  let usage: { promptTokens: number | null; completionTokens: number | null } = {
    promptTokens: null,
    completionTokens: null,
  };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const feed = makeParser(
        (delta) => controller.enqueue(encoder.encode(`${JSON.stringify({ delta })}\n`)),
        (u) => {
          usage = u;
        },
      );
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          feed(decoder.decode(value, { stream: true }));
        }
        controller.enqueue(encoder.encode(`${JSON.stringify({ done: true, usage })}\n`));
        controller.close();
      } catch (e) {
        if (clientSignal.aborted) {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ cancelled: true })}\n`));
          } catch {
            // client déjà parti
          }
        } else {
          const msg = e instanceof Error ? e.message : "Erreur de streaming.";
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify({ error: msg })}\n`));
          } catch {
            // client déjà parti
          }
        }
        try {
          controller.close();
        } catch {
          // déjà fermé
        }
      }
    },
    cancel() {
      // Le signal client propage déjà l'annulation à l'amont.
    },
  });
  return new Response(out, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
