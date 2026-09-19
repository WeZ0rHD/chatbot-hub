// Chatbot Hub — registre des fournisseurs (adapters modulaires).
// Aucune clé secrète ici : les clés vivent côté serveur (process.env lu dans
// app/api/chat/route.ts) et ne sont JAMAIS loggées ni envoyées au client.
// Les builders ci-dessous sont purs (aucun secret en entrée) donc testables.

export type ProviderId =
  | "openai"
  | "anthropic"
  | "ollama"
  | "axon"
  | "local"
  | "mock-fixture";

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderCaps {
  streaming: boolean;
  attachments: boolean;
  needsKey: boolean;
  offline: boolean;
}

export interface ProviderDef {
  id: ProviderId;
  name: string;
  icon: string;
  models: ProviderModel[];
  caps: ProviderCaps;
  hint: string;
  /** true = fixture de test explicitement labellisée, pas un vrai provider. */
  fixture?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "local",
    name: "Local",
    icon: "💻",
    models: [
      { id: "local-assistant-v1", label: "local-assistant-v1 (hors-ligne)" },
    ],
    caps: { streaming: true, attachments: false, needsKey: false, offline: true },
    hint: "Assistant local hors-ligne : répond à partir du contexte projet + templates. Toujours disponible.",
  },
  {
    id: "mock-fixture",
    name: "Test Fixture (mock)",
    icon: "🧪",
    models: [{ id: "fixture-stream-v1", label: "fixture-stream-v1 (scripté)" }],
    caps: { streaming: true, attachments: false, needsKey: false, offline: true },
    hint: "Fixture de test labellisée : réponses scriptées pour prouver streaming / cancel / restart. Pas un vrai provider.",
    fixture: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    icon: "✨",
    models: [
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "gpt-4o", label: "gpt-4o" },
    ],
    caps: { streaming: true, attachments: true, needsKey: true, offline: false },
    hint: "Clé OPENAI_API_KEY côté serveur uniquement. Sans clé : indisponible (jamais de fausse réponse).",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    icon: "🟠",
    models: [
      { id: "claude-sonnet-4-20250514", label: "claude-sonnet-4" },
      { id: "claude-haiku-3-5-20241022", label: "claude-haiku-3.5" },
    ],
    caps: { streaming: true, attachments: true, needsKey: true, offline: false },
    hint: "Clé ANTHROPIC_API_KEY côté serveur uniquement. Sans clé : indisponible.",
  },
  {
    id: "ollama",
    name: "Ollama",
    icon: "🦙",
    models: [
      { id: "llama3.1", label: "llama3.1" },
      { id: "mistral", label: "mistral" },
      { id: "qwen2.5", label: "qwen2.5" },
    ],
    caps: { streaming: true, attachments: true, needsKey: false, offline: false },
    hint: "Modèle local via OLLAMA_HOST (défaut 127.0.0.1:11434). Indisponible si le daemon ne répond pas.",
  },
  {
    id: "axon",
    name: "AxonRelay",
    icon: "🔗",
    models: [{ id: "axon-default", label: "axon-default (passerelle locale)" }],
    caps: { streaming: true, attachments: false, needsKey: false, offline: false },
    hint: "Passerelle locale via AXON_CHAT_URL (endpoint compatible OpenAI). Indisponible si non configuré.",
  },
];

export function getProvider(id: string | null | undefined): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export type Availability = { available: boolean; reason: string };

/** Disponibilité évaluable côté client sans secret. */
export function localAvailability(id: ProviderId): Availability {
  if (id === "local")
    return { available: true, reason: "moteur hors-ligne embarqué" };
  if (id === "mock-fixture")
    return { available: true, reason: "fixture de test (mock labellisé)" };
  if (id === "openai" || id === "anthropic")
    return { available: false, reason: "clé serveur absente ou non vérifiée (voir /api/chat)" };
  if (id === "ollama")
    return { available: false, reason: "daemon Ollama non joint (voir /api/chat)" };
  return { available: false, reason: "passerelle non configurée (voir /api/chat)" };
}

// ---------- Payloads (purs, sans secret) ----------

export interface WireMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function buildPrompt(
  project: string,
  context: string,
  history: WireMessage[],
): WireMessage[] {
  const out: WireMessage[] = [];
  const sysParts: string[] = [];
  if (project.trim()) sysParts.push(`Projet associé : ${project.trim()}`);
  if (context.trim()) sysParts.push(`Contexte : ${context.trim()}`);
  if (sysParts.length > 0)
    out.push({ role: "system", content: sysParts.join("\n") });
  return [...out, ...history];
}

export function buildOpenAIRequest(model: string, messages: WireMessage[]) {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    body: { model, messages, stream: true },
  };
}

export function buildAnthropicRequest(model: string, messages: WireMessage[]) {
  const { system, rest } = splitSystem(messages);
  return {
    url: "https://api.anthropic.com/v1/messages",
    body: {
      model,
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    },
  };
}

function splitSystem(messages: WireMessage[]): {
  system: string;
  rest: WireMessage[];
} {
  const sys = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  return { system: sys, rest: messages.filter((m) => m.role !== "system") };
}

export function buildOllamaRequest(host: string, model: string, messages: WireMessage[]) {
  const base = host.startsWith("http") ? host : `http://${host}`;
  return {
    url: `${base.replace(/\/$/, "")}/api/chat`,
    body: { model, messages, stream: true },
  };
}

export function normalizeOllamaHost(raw: string | undefined): string {
  const h = (raw ?? "").trim();
  return h || "127.0.0.1:11434";
}

// ---------- Usage (UNKNOWN si le provider ne le donne pas) ----------

export interface Usage {
  /** Tokens prompt si fournis, sinon null = UNKNOWN. */
  promptTokens: number | null;
  completionTokens: number | null;
  /** Estimation locale (caractères/4), toujours labellisée comme telle. */
  localEstimate: number;
}

export function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

export function unknownUsage(text: string): Usage {
  return { promptTokens: null, completionTokens: null, localEstimate: estimateTokens(text) };
}

export function formatUsage(u: Usage): string {
  if (u.promptTokens == null) return `usage UNKNOWN (estimation locale ~${u.localEstimate} tok)`;
  return `usage ${u.promptTokens}+${u.completionTokens ?? "?"} tok`;
}

// ---------- Réponses locales (offline + fixture), streamées par mots ----------

/** Réponse déterministe de l'assistant local hors-ligne (aucun réseau). */
export function localReply(
  userText: string,
  project: string,
  context: string,
  historyTurns: number,
  attachmentCount: number,
): string {
  const lines = [
    `💻 Local (hors-ligne) — j'ai bien reçu ton message (${userText.length} caractères, tour n°${historyTurns + 1}).`,
  ];
  if (project.trim()) lines.push(`Projet associé : ${project.trim()}`);
  if (context.trim()) lines.push(`Contexte pris en compte : ${context.trim().slice(0, 200)}`);
  if (attachmentCount > 0)
    lines.push(`Pièces jointes : ${attachmentCount} fichier(s) conservé(s) localement (aperçu uniquement, non envoyé).`);
  lines.push(
    "Je fonctionne sans clé ni réseau : reformule avec un template (Résumé, Plan d'action, Debug…) pour un rendu structuré, ou passe sur OpenAI / Anthropic / Ollama / Axon quand ils sont disponibles.",
  );
  return lines.join("\n");
}

/** Réponse scriptée de la fixture de test — déterministe, labellisée. */
export function fixtureScript(userText: string): string {
  const echo = userText.trim().slice(0, 80) || "(message vide)";
  return `🧪 MOCK-FIXTURE chunk=1/3 :: reçu « ${echo} »\n🧪 MOCK-FIXTURE chunk=2/3 :: streaming actif, annulable à tout moment\n🧪 MOCK-FIXTURE chunk=3/3 :: done — relance avec Réessayer pour rejouer`;
}

/**
 * Découpe un texte en morceaux de mots, avec petit délai entre chacun.
 * Respecte AbortSignal (cancel) : s'arrête sans erreur, morceaux déjà
 * émis conservés (restart = relancer la génération).
 */
export async function* streamChunks(
  text: string,
  signal: AbortSignal,
  chunkWords = 4,
  delayMs = 14,
): AsyncGenerator<string, void, void> {
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);
  let buf = "";
  let count = 0;
  for (const w of words) {
    if (signal.aborted) return;
    buf += w;
    count += 1;
    if (count >= chunkWords || /[\n.!?]$/.test(w)) {
      yield buf;
      buf = "";
      count = 0;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        }, { once: true });
      });
      if (signal.aborted) return;
    }
  }
  if (buf && !signal.aborted) yield buf;
}
