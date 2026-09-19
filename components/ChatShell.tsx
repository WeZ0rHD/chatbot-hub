"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROVIDERS,
  buildPrompt,
  fixtureScript,
  formatUsage,
  getProvider,
  localAvailability,
  localReply,
  streamChunks,
  unknownUsage,
  type ProviderId,
  type WireMessage,
} from "../lib/providers";
import {
  deriveTitle,
  exportAll,
  exportSession,
  importMany,
  importSession,
  loadSessions,
  loadTrash,
  markMessageUsage,
  newSession,
  saveSessions,
  saveTrash,
  sessionMatches,
  uid,
  type Attachment,
  type ChatMessage,
  type ChatSession,
  type ChatStatus,
} from "../lib/chat-store";
import { TEMPLATES } from "../lib/templates";

interface RemoteAvailability {
  id: ProviderId;
  available: boolean;
  reason: string;
}

const STATUS_LABEL: Record<ChatStatus, string> = {
  idle: "En attente",
  streaming: "Génération…",
  error: "Erreur",
  completed: "Terminé",
};

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readFilesAsAttachments(files: FileList | File[]): Promise<Attachment[]> {
  const list = Array.from(files).slice(0, 5);
  return Promise.all(
    list.map(
      (f) =>
        new Promise<Attachment>((resolve, reject) => {
          if (f.size > 2 * 1024 * 1024) {
            reject(new Error(`« ${f.name} » dépasse 2 Mo.`));
            return;
          }
          const r = new FileReader();
          r.onload = () =>
            resolve({
              id: uid("att"),
              name: f.name,
              mime: f.type || "application/octet-stream",
              size: f.size,
              dataUrl: typeof r.result === "string" ? r.result : "",
            });
          r.onerror = () => reject(new Error(`Lecture de « ${f.name} » impossible.`));
          r.readAsDataURL(f);
        }),
    ),
  );
}

export default function ChatShell() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => []);
  const [trash, setTrash] = useState<ChatSession[]>(() => []);
  const [hydrated, setHydrated] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [query, setQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [newProvider, setNewProvider] = useState<ProviderId>("local");
  const [avail, setAvail] = useState<RemoteAvailability[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const sessionsRef = useRef<ChatSession[]>([]);
  sessionsRef.current = sessions;

  useEffect(() => {
    setSessions(loadSessions());
    setTrash(loadTrash());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveSessions(sessions);
  }, [sessions, hydrated]);

  useEffect(() => {
    if (hydrated) saveTrash(trash);
  }, [trash, hydrated]);

  // Disponibilités serveur (présence uniquement, jamais de clés).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch("/api/chat", { signal: ctl.signal });
        clearTimeout(t);
        if (!res.ok) return;
        const data = (await res.json()) as { providers?: RemoteAvailability[] };
        if (!cancelled && Array.isArray(data.providers)) setAvail(data.providers);
      } catch {
        // API injoignable : on garde les disponibilités locales.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const availById = useMemo(() => {
    const m = new Map<ProviderId, RemoteAvailability>();
    for (const a of avail) m.set(a.id, a);
    return m;
  }, [avail]);

  const availabilityOf = useCallback(
    (id: ProviderId): { available: boolean; reason: string } => {
      const remote = availById.get(id);
      if (remote) return { available: remote.available, reason: remote.reason };
      return localAvailability(id);
    },
    [availById],
  );

  const patchSession = useCallback((id: string, patch: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? patch(s) : s)));
  }, []);

  const createChat = useCallback(() => {
    const def = getProvider(newProvider);
    const s = newSession(newProvider, def?.models[0]?.id ?? "");
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  }, [newProvider]);

  const selectSession = useCallback((id: string) => {
    setActiveId(id);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, unread: 0 } : s)));
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const found = prev.find((s) => s.id === id);
        if (found) setTrash((t) => [found, ...t]);
        return prev.filter((s) => s.id !== id);
      });
      if (activeId === id) setActiveId(null);
      if (secondaryId === id) setSecondaryId(null);
    },
    [activeId, secondaryId],
  );

  const restoreSession = useCallback((id: string) => {
    setTrash((prev) => {
      const found = prev.find((s) => s.id === id);
      if (found) setSessions((cur) => [{ ...found, unread: 0, status: "idle" as ChatStatus }, ...cur]);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
  }, []);

  const send = useCallback(
    async (sessionId: string, text: string, attachments: Attachment[]) => {
      const clean = text.trim();
      if (!clean && attachments.length === 0) return;
      if (controllers.current.has(sessionId)) return; // déjà en génération

      const ctl = new AbortController();
      controllers.current.set(sessionId, ctl);

      const userMsg: ChatMessage = {
        id: uid("msg"),
        role: "user",
        content: clean || "(pièces jointes uniquement)",
        at: Date.now(),
        attachments: attachments.length > 0 ? attachments : undefined,
      };

      // Lecture synchrone via le miroir ref (updaters React doivent rester purs).
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      const provider = (current?.provider ?? "local") as ProviderId;
      const model = current?.model ?? "";
      const project = current?.project ?? "";
      const context = current?.context ?? "";
      const historyTurns = (current?.messages.length ?? 0) + 1;

      setSessions((prev) => {
        return prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: [...s.messages, userMsg],
                status: "streaming" as ChatStatus,
                updatedAt: Date.now(),
                title:
                  s.messages.length === 0
                    ? deriveTitle(userMsg.content)
                    : s.title,
              }
            : s,
        );
      });
      const assistantId = uid("msg");
      const pushAssistant = (content: string) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? { ...s, messages: [...s.messages, { id: assistantId, role: "assistant" as const, content, at: Date.now(), provider, model }] }
              : s,
          ),
        );
      };
      const appendDelta = (delta: string) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + delta } : m,
                  ),
                  updatedAt: Date.now(),
                }
              : s,
          ),
        );
      };
      const finish = (status: ChatStatus, usageText?: string, errorText?: string) => {
        controllers.current.delete(sessionId);
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const visible = s.id === activeId || (split && s.id === secondaryId);
            let messages = s.messages;
            if (errorText) {
              messages = [
                ...messages,
                { id: uid("msg"), role: "assistant" as const, content: `⚠️ ${errorText}`, at: Date.now(), provider, model },
              ];
            }
            if (usageText) {
              messages = messages.map((m) =>
                m.id === assistantId
                  ? { ...m, content: `${m.content}\n\n_${usageText}_` }
                  : m,
              );
            }
            return {
              ...s,
              messages,
              status,
              updatedAt: Date.now(),
              unread: status === "completed" && !visible ? s.unread + 1 : s.unread,
            };
          }),
        );
      };

      try {
        if (provider === "local" || provider === "mock-fixture") {
          const full =
            provider === "local"
              ? localReply(clean, project, context, historyTurns, attachments.length)
              : fixtureScript(clean);
          pushAssistant("");
          for await (const chunk of streamChunks(full, ctl.signal)) {
            appendDelta(chunk);
          }
          if (ctl.signal.aborted) {
            finish("idle", "génération annulée — le partiel est conservé, Relance avec Réessayer");
          } else {
            setSessions((prev) =>
              prev.map((s) =>
                s.id === sessionId
                  ? {
                      ...s,
                      messages: s.messages.map((m) =>
                        m.id === assistantId
                          ? { ...m, usage: markMessageUsage(m.content, null, null) }
                          : m,
                      ),
                    }
                  : s,
              ),
            );
            finish("completed", formatUsage(unknownUsage(full)));
          }
          return;
        }

        // Adapters distants via la passerelle serveur (clés jamais exposées).
        const def = getProvider(provider);
        const history: WireMessage[] = buildPrompt(
          project,
          context,
          (current?.messages ?? []).map((m) => ({
            role: m.role,
            content:
              m.content +
              (m.attachments?.length
                ? `\n[pièces jointes : ${m.attachments.map((a) => `${a.name} (${a.mime}, ${a.size} o)`).join(", ")} — aperçu local, envoi natif à venir]`
                : ""),
          })),
        );
        history.push({
          role: "user",
          content:
            clean +
            (attachments.length > 0
              ? `\n[pièces jointes : ${attachments.map((a) => `${a.name} (${a.mime}, ${a.size} o)`).join(", ")} — aperçu local${def?.caps.attachments ? "" : " (provider sans support natif dans cette version)"}]`
              : ""),
        });
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider, model, messages: history }),
          signal: ctl.signal,
        });
        if (!res.ok || !res.body) {
          let detail = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) detail = j.error;
          } catch {
            // corps non-JSON
          }
          finish("error", undefined, `${provider}/${model} indisponible : ${detail}`);
          return;
        }
        pushAssistant("");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let usage: { promptTokens: number | null; completionTokens: number | null } = {
          promptTokens: null,
          completionTokens: null,
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const s = line.trim();
            if (!s) continue;
            try {
              const evt = JSON.parse(s) as {
                delta?: string;
                done?: boolean;
                cancelled?: boolean;
                error?: string;
                usage?: { promptTokens?: number | null; completionTokens?: number | null };
              };
              if (evt.delta) appendDelta(evt.delta);
              if (evt.usage)
                usage = {
                  promptTokens: evt.usage.promptTokens ?? null,
                  completionTokens: evt.usage.completionTokens ?? null,
                };
              if (evt.error) {
                finish("error", undefined, evt.error);
                return;
              }
            } catch {
              // ligne non-JSON : ignorée
            }
          }
          if (ctl.signal.aborted) break;
        }
        if (ctl.signal.aborted) {
          finish("idle", "génération annulée — le partiel est conservé, Relance avec Réessayer");
          return;
        }
        const usageObj = markMessageUsage("", usage.promptTokens, usage.completionTokens);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantId ? { ...m, usage: usageObj } : m,
                  ),
                }
              : s,
          ),
        );
        finish("completed", formatUsage(usageObj));
      } catch (e) {
        if (ctl.signal.aborted) {
          finish("idle", "génération annulée — le partiel est conservé, Relance avec Réessayer");
        } else {
          finish("error", undefined, e instanceof Error ? e.message : "Erreur inconnue");
        }
      }
    },
    [activeId, split, secondaryId],
  );

  const retry = useCallback(
    (sessionId: string) => {
      const s = sessions.find((x) => x.id === sessionId);
      if (!s || controllers.current.has(sessionId)) return;
      const lastUser = [...s.messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return;
      // Retire un éventuel message d'erreur/annulation final pour repartir propre.
      setSessions((prev) =>
        prev.map((x) =>
          x.id === sessionId
            ? {
                ...x,
                messages: x.messages.filter(
                  (m) => !(m.role === "assistant" && m.content.startsWith("⚠️")),
                ),
                status: "idle" as ChatStatus,
              }
            : x,
        ),
      );
      void send(sessionId, lastUser.content, lastUser.attachments ?? []);
    },
    [sessions, send],
  );

  const filtered = useMemo(
    () => sessions.filter((s) => sessionMatches(s, query)),
    [sessions, query],
  );
  const active = sessions.find((s) => s.id === activeId) ?? null;
  const secondary = split ? (sessions.find((s) => s.id === secondaryId) ?? null) : null;

  const onImportFile = useCallback(async (file: File) => {
    const raw = await file.text();
    try {
      const one = importSession(raw);
      setSessions((prev) => [one, ...prev]);
      setActiveId(one.id);
    } catch {
      const many = importMany(raw);
      setSessions((prev) => [...many, ...prev]);
      setActiveId(many[0]?.id ?? null);
    }
  }, []);

  if (!hydrated) {
    return (
      <div className="boot">
        <p>Chargement des conversations…</p>
      </div>
    );
  }

  return (
    <div className="chats">
      <div className="chats-toolbar">
        <div className="chats-new">
          <select
            aria-label="Fournisseur pour la nouvelle conversation"
            value={newProvider}
            onChange={(e) => setNewProvider(e.target.value as ProviderId)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name}
                {p.fixture ? " — fixture" : ""}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={createChat}>
            + Nouvelle conversation
          </button>
        </div>
        <div className="chats-tools">
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (titre, projet, messages)…"
            aria-label="Rechercher dans les conversations"
          />
          <button
            type="button"
            className={`btn ${split ? "btn-primary" : ""}`}
            onClick={() => setSplit((v) => !v)}
            title="Comparer deux conversations côte à côte"
            aria-pressed={split}
          >
            ⬒ Split
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => download("chatbot-hub-sessions.json", exportAll(sessions))}
            disabled={sessions.length === 0}
          >
            Exporter
          </button>
          <label className="btn" title="Importer une session ou un export">
            Importer
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f).catch(() => alert("Import impossible : fichier invalide."));
                e.target.value = "";
              }}
            />
          </label>
          <button type="button" className="btn btn-ghost" onClick={() => setShowTrash((v) => !v)}>
            🗑 {showTrash ? "Masquer" : `Corbeille (${trash.length})`}
          </button>
        </div>
      </div>

      {showTrash && (
        <div className="trash">
          <h3>Corbeille — restauration possible</h3>
          {trash.length === 0 ? (
            <p className="muted">Corbeille vide.</p>
          ) : (
            <ul>
              {trash.map((s) => (
                <li key={s.id}>
                  <span>{s.title}</span>
                  <button type="button" className="btn" onClick={() => restoreSession(s.id)}>
                    Restaurer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="chats-tabs" role="tablist" aria-label="Conversations">
        {filtered.length === 0 && (
          <p className="muted">
            {sessions.length === 0
              ? "Aucune conversation — crée la première avec le bouton ci-dessus."
              : `Aucune conversation ne correspond à « ${query} ».`}
          </p>
        )}
        {filtered.map((s) => {
          const def = getProvider(s.provider);
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              className={`chat-tab chat-status-${s.status} ${isActive ? "chat-tab-active" : ""}`}
              onClick={() => selectSession(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectSession(s.id);
                }
              }}
              title={`${def?.name ?? s.provider} · ${s.model}`}
            >
              <span className="chat-dot" aria-hidden="true" />
              <span aria-hidden="true">{def?.icon ?? "💬"}</span>
              <span className="chat-tab-name">{s.title}</span>
              <span className="chat-tab-provider">
                {def?.name ?? s.provider} · {s.model || "—"}
              </span>
              {s.unread > 0 && <span className="unread-badge">{s.unread}</span>}
              <button
                type="button"
                className="tabstrip-close"
                aria-label={`Supprimer ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className={`chats-panes ${split ? "split" : ""}`}>
        {active ? (
          <ChatPane
            key={active.id}
            session={active}
            availability={availabilityOf(active.provider)}
            onSend={(text, atts) => void send(active.id, text, atts)}
            onCancel={() => cancel(active.id)}
            onRetry={() => retry(active.id)}
            onPatch={(fn) => patchSession(active.id, fn)}
            onExport={() => download(`${active.id}.json`, exportSession(active))}
            streaming={controllers.current.has(active.id)}
          />
        ) : (
          <div className="empty">
            <p>Sélectionne une conversation ou crée-en une nouvelle.</p>
          </div>
        )}
        {split && (
          <div className="split-second">
            <select
              aria-label="Conversation secondaire (split)"
              value={secondaryId ?? ""}
              onChange={(e) => setSecondaryId(e.target.value || null)}
            >
              <option value="">— Choisir la 2ᵉ conversation —</option>
              {sessions
                .filter((s) => s.id !== activeId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.provider}/{s.model})
                  </option>
                ))}
            </select>
            {secondary && (
              <ChatPane
                key={secondary.id}
                session={secondary}
                availability={availabilityOf(secondary.provider)}
                onSend={(text, atts) => void send(secondary.id, text, atts)}
                onCancel={() => cancel(secondary.id)}
                onRetry={() => retry(secondary.id)}
                onPatch={(fn) => patchSession(secondary.id, fn)}
                onExport={() => download(`${secondary.id}.json`, exportSession(secondary))}
                streaming={controllers.current.has(secondary.id)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatPane({
  session,
  availability,
  onSend,
  onCancel,
  onRetry,
  onPatch,
  onExport,
  streaming,
}: {
  session: ChatSession;
  availability: { available: boolean; reason: string };
  onSend: (text: string, atts: Attachment[]) => void;
  onCancel: () => void;
  onRetry: () => void;
  onPatch: (fn: (s: ChatSession) => ChatSession) => void;
  onExport: () => void;
  streaming: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [showMeta, setShowMeta] = useState(false);
  const [attachError, setAttachError] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [templateId, setTemplateId] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const def = getProvider(session.provider);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages.length]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    if (!id) return;
    const t = TEMPLATES.find((x) => x.id === id);
    if (t) setDraft((d) => (d ? `${d}\n\n${t.body}` : t.body));
  };

  const submit = () => {
    if (streaming) return;
    onSend(draft, pending);
    setDraft("");
    setPending([]);
    setAttachError("");
  };

  return (
    <section className="chat-pane" aria-label={session.title}>
      <div className="chat-pane-header">
        <div>
          <h2>
            {def?.icon ?? "💬"} {session.title}
          </h2>
          <p className="muted">
            {def?.name ?? session.provider} · {session.model || "modèle non choisi"} ·{" "}
            <span className={`status status-${availability.available ? "online" : "offline"}`}>
              <span className="dot" aria-hidden="true" />
              {availability.available ? "Disponible" : "Indisponible"}
            </span>{" "}
            — {availability.reason} · {STATUS_LABEL[session.status]}
          </p>
        </div>
        <div className="header-actions">
          <select
            aria-label="Modèle"
            value={session.model}
            onChange={(e) => onPatch((s) => ({ ...s, model: e.target.value, updatedAt: Date.now() }))}
          >
            {(def?.models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost" onClick={() => setShowMeta((v) => !v)}>
            {showMeta ? "Masquer projet" : "Projet / contexte"}
          </button>
          <button type="button" className="btn" onClick={onExport}>
            Exporter
          </button>
        </div>
      </div>

      {showMeta && (
        <div className="chat-meta">
          <label>
            Projet associé
            <input
              value={session.project}
              onChange={(e) => onPatch((s) => ({ ...s, project: e.target.value }))}
              placeholder="Ex. chatbot-hub, site vitrine…"
            />
          </label>
          <label>
            Contexte
            <textarea
              value={session.context}
              onChange={(e) => onPatch((s) => ({ ...s, context: e.target.value }))}
              placeholder="Contexte envoyé en system au provider…"
              rows={2}
            />
          </label>
        </div>
      )}

      <div className="chat-messages">
        {session.messages.length === 0 && (
          <p className="muted">
            Démarre la conversation : choisis un template ou écris ton premier message.
            {def?.fixture ? " (Fixture labellisée : réponses scriptées.)" : ""}
          </p>
        )}
        {session.messages.map((m: ChatMessage) => (
          <article key={m.id} className={`msg msg-${m.role}`}>
            <header>
              <strong>{m.role === "user" ? "Toi" : `${def?.icon ?? "🤖"} ${def?.name ?? "Assistant"}`}</strong>
              {m.provider && m.role === "assistant" && (
                <span className="msg-provider">
                  {m.provider} · {m.model ?? ""}
                </span>
              )}
            </header>
            <div className="msg-body">{m.content}</div>
            {m.attachments && m.attachments.length > 0 && (
              <div className="msg-atts">
                {m.attachments.map((a) => (
                  <span key={a.id} title={`${a.name} — ${a.size} o`}>
                    📎 {a.name}
                  </span>
                ))}
              </div>
            )}
            {m.usage && <footer className="msg-usage">{formatUsage(m.usage)}</footer>}
          </article>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <div className="composer-row">
          <select aria-label="Template de prompt" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">— Template… —</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.title}
              </option>
            ))}
          </select>
          <label className="btn" title="Joindre des images (2 Mo max, aperçu local)">
            📎 Joindre
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                setAttachError("");
                const files = e.target.files;
                if (!files || files.length === 0) return;
                readFilesAsAttachments(files)
                  .then((atts) => setPending((p) => [...p, ...atts].slice(0, 5)))
                  .catch((err: Error) => setAttachError(err.message));
                e.target.value = "";
              }}
            />
          </label>
          {pending.length > 0 && (
            <span className="muted" title={pending.map((a) => a.name).join(", ")}>
              {pending.length} fichier(s)
              <button type="button" className="icon-btn" aria-label="Retirer les pièces jointes" onClick={() => setPending([])}>
                ×
              </button>
            </span>
          )}
        </div>
        {attachError && (
          <p className="form-error" role="alert">
            {attachError}
          </p>
        )}
        <div className="composer-row">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Écris ton message… (Entrée = envoyer, Maj+Entrée = saut de ligne)"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div className="composer-row">
          {!streaming ? (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!draft.trim() && pending.length === 0}>
              Envoyer
            </button>
          ) : (
            <button type="button" className="btn btn-danger" onClick={onCancel}>
              ⏹ Annuler
            </button>
          )}
          <button type="button" className="btn" onClick={onRetry} disabled={streaming || !session.messages.some((m) => m.role === "user")}>
            ↻ Réessayer
          </button>
          <span className="muted">
            {session.unread > 0 ? `${session.unread} non-lu(s)` : ""} · Coût : usage UNKNOWN sauf retour provider
          </span>
        </div>
      </div>
    </section>
  );
}
