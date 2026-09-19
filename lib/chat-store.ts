// Chatbot Hub — sessions de conversation unifiées (coquille persistée).
// Les fonctions pures (newSession, sessionMatches, export/import, unread)
// sont testées par tests/chat-hub.test.ts. La persistance utilise
// localStorage et est gardée (typeof localStorage) pour le SSR.

import type { ProviderId } from "./providers.ts";
import { unknownUsage, type Usage } from "./providers.ts";

export type ChatStatus = "idle" | "streaming" | "error" | "completed";
export type ChatRole = "user" | "assistant";

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** dataURL (images uniquement, plafonné à la sélection). */
  dataUrl: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: number;
  attachments?: Attachment[];
  usage?: Usage;
  /** arrière-plan : provider/modèle qui a produit le message. */
  provider?: ProviderId;
  model?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  project: string;
  context: string;
  messages: ChatMessage[];
  status: ChatStatus;
  unread: number;
  createdAt: number;
  updatedAt: number;
}

const CHATS_KEY = "chatbot-hub:chats:v1";
const TRASH_KEY = "chatbot-hub:chats-trash:v1";

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function newSession(provider: ProviderId, model: string): ChatSession {
  const now = Date.now();
  return {
    id: uid("chat"),
    title: "Nouvelle conversation",
    provider,
    model,
    project: "",
    context: "",
    messages: [],
    status: "idle",
    unread: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function deriveTitle(firstUserText: string): string {
  const t = firstUserText.trim().replace(/\s+/g, " ");
  if (!t) return "Conversation sans titre";
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

export function sessionMatches(s: ChatSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    s.title,
    s.project,
    s.context,
    s.provider,
    s.model,
    ...s.messages.map((m) => m.content),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function touchUnread(s: ChatSession, active: boolean): ChatSession {
  // Un message terminé alors que la session n'est pas affichée => +1 non-lu.
  if (active) return { ...s, unread: 0 };
  return { ...s, unread: s.unread + 1 };
}

export function markMessageUsage(
  text: string,
  promptTokens: number | null,
  completionTokens: number | null,
): Usage {
  if (promptTokens == null) return unknownUsage(text);
  return {
    promptTokens,
    completionTokens,
    localEstimate: Math.ceil(text.length / 4),
  };
}

// ---------- Export / import (history/export) ----------

export function exportSession(s: ChatSession): string {
  return JSON.stringify({ kind: "chatbot-hub-session", version: 1, session: s }, null, 2);
}

export function exportAll(sessions: ChatSession[]): string {
  return JSON.stringify({ kind: "chatbot-hub-sessions", version: 1, sessions }, null, 2);
}

function isSession(v: unknown): v is ChatSession {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.provider === "string" &&
    typeof s.model === "string" &&
    Array.isArray(s.messages)
  );
}

export function importSession(raw: string): ChatSession {
  const parsed: unknown = JSON.parse(raw);
  const candidate =
    typeof parsed === "object" &&
    parsed !== null &&
    "session" in parsed
      ? (parsed as { session: unknown }).session
      : parsed;
  if (!isSession(candidate)) throw new Error("Fichier de session invalide.");
  return { ...candidate, unread: 0, status: "idle" as ChatStatus };
}

export function importMany(raw: string): ChatSession[] {
  const parsed: unknown = JSON.parse(raw);
  const list =
    typeof parsed === "object" && parsed !== null && "sessions" in parsed
      ? (parsed as { sessions: unknown }).sessions
      : parsed;
  if (!Array.isArray(list)) throw new Error("Fichier d'import invalide.");
  const ok = list.filter(isSession).map((s) => ({ ...s, unread: 0, status: "idle" as ChatStatus }));
  if (ok.length === 0) throw new Error("Aucune session valide dans ce fichier.");
  return ok;
}

// ---------- Persistance locale ----------

function readKey<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeKey(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible : on continue sans persistance.
  }
}

export function loadSessions(): ChatSession[] {
  const list = readKey<unknown>(CHATS_KEY, []);
  return Array.isArray(list) ? list.filter(isSession) : [];
}

export function saveSessions(sessions: ChatSession[]): void {
  writeKey(CHATS_KEY, sessions);
}

export function loadTrash(): ChatSession[] {
  const list = readKey<unknown>(TRASH_KEY, []);
  return Array.isArray(list) ? list.filter(isSession) : [];
}

export function saveTrash(sessions: ChatSession[]): void {
  writeKey(TRASH_KEY, sessions);
}
