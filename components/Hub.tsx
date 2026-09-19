"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BOT_COLORS,
  canEmbed,
  defaultState,
  loadState,
  resetState,
  saveState,
  type ChatbotEntry,
  type HubState,
} from "../lib/tabs";
import TabStrip from "./TabStrip";
import Dashboard, { type BotStatus } from "./Dashboard";
import BotModal, { type BotFormValues } from "./BotModal";
import StatusBar from "./StatusBar";
import ChatShell from "./ChatShell";

const VIEW_KEY = "chatbot-hub:view:v1";
type HubView = "bots" | "chats";

const STATUS_TTL_MS = 60_000;

export default function Hub() {
  const [state, setState] = useState<HubState>(() => defaultState());
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<
    | { mode: "closed" }
    | { mode: "add" }
    | { mode: "edit"; bot: ChatbotEntry }
  >({ mode: "closed" });
  const [frameNonce, setFrameNonce] = useState(0);
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});
  const [statusMap, setStatusMap] = useState<Record<string, BotStatus>>({});
  const [view, setView] = useState<HubView>("bots");
  const statusCache = useRef<Record<string, { at: number; ok: boolean }>>({});

  useEffect(() => {
    setState(loadState());
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "chats" || v === "bots") setView(v);
    } catch {
      // persistance vue indisponible
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveState(state);
  }, [state, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // persistance vue indisponible
    }
  }, [view, hydrated]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  const botsById = useMemo(
    () => new Map(state.bots.map((bot) => [bot.id, bot])),
    [state.bots],
  );

  const openBots = useMemo(
    () =>
      state.openIds
        .map((id) => botsById.get(id))
        .filter((bot): bot is ChatbotEntry => !!bot),
    [state.openIds, botsById],
  );

  const activeBot =
    state.activeId === "home" ? null : (botsById.get(state.activeId) ?? null);

  // Ping des bots locaux (même origine interdite aux externes à cause de CORS :
  // on considère un bot externe comme "web" sans ping, un local sans réponse
  // comme "offline").
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const next: Record<string, BotStatus> = {};
      await Promise.all(
        state.bots.map(async (bot) => {
          if (bot.kind !== "local" || !bot.url) {
            next[bot.id] = bot.url ? "web" : "offline";
            return;
          }
          const cached = statusCache.current[bot.id];
          if (cached && Date.now() - cached.at < STATUS_TTL_MS) {
            next[bot.id] = cached.ok ? "online" : "offline";
            return;
          }
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);
            await fetch(bot.url, { mode: "no-cors", signal: controller.signal });
            clearTimeout(timer);
            statusCache.current[bot.id] = { at: Date.now(), ok: true };
            next[bot.id] = "online";
          } catch {
            statusCache.current[bot.id] = { at: Date.now(), ok: false };
            next[bot.id] = "offline";
          }
        }),
      );
      if (!cancelled) setStatusMap(next);
    };
    check();
    const interval = setInterval(check, STATUS_TTL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state.bots]);

  // Raccourcis clavier : Ctrl/Cmd+1..9 = onglets, Ctrl/Cmd+T = accueil.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setState((s) => ({ ...s, activeId: "home" }));
        return;
      }
      const n = parseInt(event.key, 10);
      if (n >= 1 && n <= 9) {
        const ids: Array<string | "home"> = ["home", ...state.openIds];
        const target = ids[n - 1];
        if (target) {
          event.preventDefault();
          setState((s) => ({ ...s, activeId: target }));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.openIds]);

  const openBot = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      openIds: s.openIds.includes(id) ? s.openIds : [...s.openIds, id],
      activeId: id,
    }));
    setBlocked((prev) => ({ ...prev, [id]: false }));
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((s) => {
      const openIds = s.openIds.filter((openId) => openId !== id);
      const activeId =
        s.activeId === id ? "home" : (s.activeId as string | "home");
      return { ...s, openIds, activeId };
    });
  }, []);

  const toggleFav = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      bots: s.bots.map((bot) =>
        bot.id === id ? { ...bot, favorite: !bot.favorite } : bot,
      ),
    }));
  }, []);

  const saveBot = useCallback(
    (values: BotFormValues) => {
      if (modal.mode === "edit") {
        const id = modal.bot.id;
        setState((s) => ({
          ...s,
          bots: s.bots.map((bot) =>
            bot.id === id
              ? {
                  ...bot,
                  name: values.name,
                  url: values.url,
                  icon: values.icon || "💬",
                  color: values.color,
                  kind: values.kind,
                  description: values.description,
                  allowEmbed: values.allowEmbed,
                }
              : bot,
          ),
        }));
      } else {
        const id = `custom-${Date.now()}`;
        const entry: ChatbotEntry = {
          id,
          name: values.name,
          url: values.url,
          icon: values.icon || "💬",
          color: values.color || BOT_COLORS[0],
          kind: values.kind,
          description: values.description,
          allowEmbed: values.allowEmbed,
        };
        setState((s) => ({
          ...s,
          bots: [...s.bots, entry],
          openIds: values.url ? [...s.openIds, id] : s.openIds,
          activeId: values.url ? id : s.activeId,
        }));
      }
      setModal({ mode: "closed" });
      setFrameNonce((n) => n + 1);
    },
    [modal],
  );

  const deleteBot = useCallback(() => {
    if (modal.mode !== "edit") return;
    const id = modal.bot.id;
    setState((s) => ({
      ...s,
      bots: s.bots.filter((bot) => bot.id !== id),
      openIds: s.openIds.filter((openId) => openId !== id),
      activeId: s.activeId === id ? "home" : s.activeId,
    }));
    setModal({ mode: "closed" });
  }, [modal]);

  const handleReset = useCallback(() => {
    setState(resetState());
    setBlocked({});
    setQuery("");
  }, []);

  const toggleTheme = useCallback(() => {
    setState((s) => ({
      ...s,
      theme: s.theme === "dark" ? "light" : "dark",
    }));
  }, []);

  if (!hydrated) {
    return (
      <div className="boot">
        <p>Chargement du hub…</p>
      </div>
    );
  }

  return (
    <div className="hub">
      <header className="topbar">
        <div className="brand">
          <span aria-hidden="true">💬</span> Chatbot Hub
        </div>
        <div className="search-wrap">
          <span aria-hidden="true">🔎</span>
          <input
            className="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un chatbot… (nom, url, description)"
            aria-label="Rechercher un chatbot"
          />
          {query && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Effacer la recherche"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className={`btn ${view === "bots" ? "btn-primary" : ""}`}
            onClick={() => setView("bots")}
            title="Onglets iframe (bots locaux / externes)"
            aria-pressed={view === "bots"}
          >
            🤖 Bots
          </button>
          <button
            type="button"
            className={`btn ${view === "chats" ? "btn-primary" : ""}`}
            onClick={() => setView("chats")}
            title="Conversations unifiées (providers + streaming)"
            aria-pressed={view === "chats"}
          >
            💬 Chats
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setState((s) => ({ ...s, activeId: "home" }))}
            title="Accueil (Ctrl+T)"
          >
            🏠
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setModal({ mode: "add" })}
          >
            + Ajouter
          </button>
          <button
            type="button"
            className="btn"
            onClick={toggleTheme}
            title={state.theme === "dark" ? "Passer en clair" : "Passer en sombre"}
          >
            {state.theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <TabStrip
        openBots={openBots}
        activeId={state.activeId}
        onSelect={(id) => setState((s) => ({ ...s, activeId: id }))}
        onClose={closeTab}
      />

      <main className="content">
        {view === "chats" ? (
          <ChatShell />
        ) : state.activeId === "home" || !activeBot ? (
          <Dashboard
            bots={state.bots}
            query={query}
            statusMap={statusMap}
            onOpen={openBot}
            onToggleFav={toggleFav}
            onEdit={(bot) => setModal({ mode: "edit", bot })}
            onAdd={() => setModal({ mode: "add" })}
          />
        ) : (
          <section className="viewer" aria-label={activeBot.name}>
            <div className="viewer-header">
              <div className="viewer-title">
                <span aria-hidden="true">{activeBot.icon}</span>
                <div>
                  <h2>{activeBot.name}</h2>
                  <p className="url">
                    {activeBot.url || "Aucune URL configurée"}
                    {activeBot.url && (
                      <span
                        className={`status status-${statusMap[activeBot.id] ?? "web"} status-inline`}
                      >
                        <span className="dot" aria-hidden="true" />
                        {activeBot.kind === "local"
                          ? statusMap[activeBot.id] === "online"
                            ? "En ligne"
                            : "Hors ligne"
                          : "Site web"}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="header-actions">
                {activeBot.url && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        window.open(activeBot.url, "_blank", "noopener")
                      }
                    >
                      Ouvrir ↗
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setBlocked((prev) => ({
                          ...prev,
                          [activeBot.id]: false,
                        }));
                        setFrameNonce((n) => n + 1);
                      }}
                    >
                      ↻ Recharger
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setModal({ mode: "edit", bot: activeBot })}
                >
                  ✎ Modifier
                </button>
              </div>
            </div>

            <div className="frame-wrap">
              {!activeBot.url ? (
                <div className="empty">
                  <p>
                    Aucune URL pour cet onglet.
                    {activeBot.hint ? ` ${activeBot.hint}` : ""}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setModal({ mode: "edit", bot: activeBot })}
                  >
                    Configurer l&apos;URL
                  </button>
                </div>
              ) : activeBot.kind === "local" &&
                statusMap[activeBot.id] === "offline" &&
                !blocked[activeBot.id] ? (
                <div className="empty">
                  <p>
                    <strong>{activeBot.name}</strong> ne répond pas sur{" "}
                    <code>{activeBot.url}</code>.
                  </p>
                  {activeBot.hint && <p>{activeBot.hint}</p>}
                  <div className="empty-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setFrameNonce((n) => n + 1)}
                    >
                      Réessayer
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        window.open(activeBot.url, "_blank", "noopener")
                      }
                    >
                      Ouvrir quand même ↗
                    </button>
                  </div>
                </div>
              ) : blocked[activeBot.id] ? (
                <div className="empty">
                  <p>
                    Ce site refuse l&apos;affichage intégré (protection
                    anti-iframe : X-Frame-Options / CSP frame-ancestors).
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      window.open(activeBot.url, "_blank", "noopener")
                    }
                  >
                    Ouvrir {activeBot.name} dans un nouvel onglet ↗
                  </button>
                </div>
              ) : !canEmbed(activeBot) ? (
                <div className="launch">
                  <div className="launch-card">
                    <span className="launch-icon" aria-hidden="true">
                      {activeBot.icon}
                    </span>
                    <h3>{activeBot.name}</h3>
                    {activeBot.description && (
                      <p className="launch-desc">{activeBot.description}</p>
                    )}
                    <p className="launch-url">{activeBot.url}</p>
                    <p className="launch-note">
                      Ce site bloque l&apos;affichage intégré (anti-iframe) :
                      il s&apos;ouvre dans un nouvel onglet, pas dans le hub.
                    </p>
                    <div className="empty-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          window.open(activeBot.url, "_blank", "noopener")
                        }
                      >
                        Ouvrir {activeBot.name} ↗
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setState((s) => ({
                            ...s,
                            bots: s.bots.map((bot) =>
                              bot.id === activeBot.id
                                ? { ...bot, allowEmbed: true }
                                : bot,
                            ),
                          }));
                          setFrameNonce((n) => n + 1);
                        }}
                      >
                        Essayer quand même en intégré
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <iframe
                  key={`${activeBot.id}-${activeBot.url}-${frameNonce}`}
                  src={activeBot.url}
                  title={activeBot.name}
                  className="frame"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                  allow="clipboard-read; clipboard-write; microphone; camera"
                  onError={() =>
                    setBlocked((prev) => ({ ...prev, [activeBot.id]: true }))
                  }
                />
              )}
            </div>
          </section>
        )}
      </main>

      <StatusBar bots={state.bots} statusMap={statusMap} onReset={handleReset} />

      {modal.mode !== "closed" && (
        <BotModal
          initial={modal.mode === "edit" ? modal.bot : null}
          onClose={() => setModal({ mode: "closed" })}
          onSave={saveBot}
          onDelete={modal.mode === "edit" ? deleteBot : undefined}
        />
      )}
    </div>
  );
}
