export type BotKind = "local" | "external";
export type Theme = "dark" | "light";

export interface ChatbotEntry {
  id: string;
  name: string;
  url: string;
  icon: string;
  color: string;
  kind: BotKind;
  description?: string;
  favorite?: boolean;
  // Affichage intégré en iframe. Faux par défaut pour les sites externes
  // (protections anti-iframe => page blanche), vrai pour les apps locales.
  allowEmbed?: boolean;
  hint?: string;
}

export interface HubState {
  bots: ChatbotEntry[];
  openIds: string[];
  activeId: string | "home";
  theme: Theme;
}

export function canEmbed(bot: ChatbotEntry): boolean {
  // Par défaut : seuls les bots locaux s'affichent en iframe.
  // Les sites externes bloquent l'iframe (X-Frame-Options / CSP) et
  // n'afficheraient qu'une page blanche : on leur montre un écran
  // d'ouverture externe à la place, sauf opt-in explicite.
  if (typeof bot.allowEmbed === "boolean") return bot.allowEmbed;
  return bot.kind === "local";
}

export const BOT_COLORS = [
  "#6ea8fe",
  "#a6e3a1",
  "#f9e2af",
  "#f38ba8",
  "#cba6f7",
  "#94e2d5",
  "#fab387",
  "#89dceb",
];

export const DEFAULT_BOTS: ChatbotEntry[] = [
  {
    id: "mindmap",
    name: "Mindmap Chatbot",
    url: "http://127.0.0.1:8767",
    icon: "🧠",
    color: "#cba6f7",
    kind: "local",
    description: "Mindmap + chatbot local (Vite React).",
    favorite: true,
    allowEmbed: true,
    hint: "Lance avec : npm run dev dans 2026-08-26_mindmap-chatbot-final",
  },
  {
    id: "reverse-prompt",
    name: "Reverse Prompt",
    url: "",
    icon: "🔍",
    color: "#f9e2af",
    kind: "local",
    description: "Master prompt de reverse engineering (page statique).",
    allowEmbed: true,
    hint: "Servez START.html de 2026-06-06-reverse-engineering-chatbot puis collez son URL ici (modifier).",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com",
    icon: "✨",
    color: "#a6e3a1",
    kind: "external",
    description: "Assistant OpenAI.",
    favorite: true,
    allowEmbed: false,
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai",
    icon: "🟠",
    color: "#fab387",
    kind: "external",
    description: "Assistant Anthropic.",
    favorite: true,
    allowEmbed: false,
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com",
    icon: "🔵",
    color: "#6ea8fe",
    kind: "external",
    description: "Assistant Google.",
    allowEmbed: false,
  },
  {
    id: "mistral",
    name: "Le Chat",
    url: "https://chat.mistral.ai",
    icon: "🇫🇷",
    color: "#f38ba8",
    kind: "external",
    description: "Assistant Mistral AI.",
    allowEmbed: false,
  },
];

const STATE_KEY = "chatbot-hub:state:v2";
const LEGACY_KEY = "chatbot-hub:tabs:v1";

function isBot(value: unknown): value is ChatbotEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    typeof e.url === "string" &&
    typeof e.icon === "string" &&
    (e.kind === "local" || e.kind === "external")
  );
}

function migrateLegacy(): ChatbotEntry[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const bots = parsed.filter(isBot).map((b, i) => ({
      ...b,
      color: BOT_COLORS[i % BOT_COLORS.length],
      description: b.hint ?? "",
    }));
    return bots.length > 0 ? bots : null;
  } catch {
    return null;
  }
}

export function defaultState(): HubState {
  return {
    bots: DEFAULT_BOTS,
    openIds: ["mindmap", "chatgpt", "claude"],
    activeId: "home",
    theme: "dark",
  };
}

export function loadState(): HubState {
  const fallback = defaultState();
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) {
      const legacy = migrateLegacy();
      if (legacy) {
        return {
          ...fallback,
          bots: legacy,
          openIds: legacy.slice(0, 3).map((b) => b.id),
        };
      }
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<HubState>;
    const bots =
      Array.isArray(parsed.bots) && parsed.bots.filter(isBot).length > 0
        ? (parsed.bots.filter(isBot) as ChatbotEntry[])
        : fallback.bots;
    const ids = new Set(bots.map((b) => b.id));
    const openIds =
      Array.isArray(parsed.openIds) && parsed.openIds.length > 0
        ? (parsed.openIds as string[]).filter((id) => ids.has(id))
        : bots.slice(0, 3).map((b) => b.id);
    const activeId =
      parsed.activeId === "home" ||
      (typeof parsed.activeId === "string" && ids.has(parsed.activeId))
        ? (parsed.activeId as string)
        : "home";
    const theme = parsed.theme === "light" ? "light" : "dark";
    return { bots, openIds, activeId: activeId as HubState["activeId"], theme };
  } catch {
    return fallback;
  }
}

export function saveState(state: HubState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Stockage indisponible : on continue sans persistance.
  }
}

export function resetState(): HubState {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    // Ignoré.
  }
  return defaultState();
}
