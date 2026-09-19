"use client";

import type { ChatbotEntry } from "../lib/tabs";

export type BotStatus = "online" | "offline" | "web";

interface DashboardProps {
  bots: ChatbotEntry[];
  query: string;
  statusMap: Record<string, BotStatus>;
  onOpen: (id: string) => void;
  onToggleFav: (id: string) => void;
  onEdit: (bot: ChatbotEntry) => void;
  onAdd: () => void;
}

const STATUS_LABEL: Record<BotStatus, string> = {
  online: "En ligne",
  offline: "Hors ligne",
  web: "Site web",
};

function matches(bot: ChatbotEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [bot.name, bot.url, bot.description ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function BotCard({
  bot,
  status,
  onOpen,
  onToggleFav,
  onEdit,
}: {
  bot: ChatbotEntry;
  status: BotStatus;
  onOpen: () => void;
  onToggleFav: () => void;
  onEdit: () => void;
}) {
  return (
    <article className="card" style={{ "--card-color": bot.color } as React.CSSProperties}>
      <div className="card-top">
        <span className="card-icon" aria-hidden="true">
          {bot.icon}
        </span>
        <div className="card-titles">
          <h3>{bot.name}</h3>
          <p className="card-url">{bot.url || "URL à configurer"}</p>
        </div>
        <button
          type="button"
          className={`icon-btn ${bot.favorite ? "fav-on" : ""}`}
          aria-label={bot.favorite ? `Retirer ${bot.name} des favoris` : `Ajouter ${bot.name} aux favoris`}
          aria-pressed={!!bot.favorite}
          onClick={onToggleFav}
          title="Favori"
        >
          {bot.favorite ? "★" : "☆"}
        </button>
      </div>
      {bot.description && <p className="card-desc">{bot.description}</p>}
      <div className="card-meta">
        <span className={`status status-${status}`}>
          <span className="dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
        <span className="kind-badge">
          {bot.kind === "local" ? "Local" : "Externe"}
        </span>
      </div>
      <div className="card-actions">
        <button type="button" className="btn btn-primary" onClick={onOpen}>
          Ouvrir
        </button>
        {bot.url && (
          <button
            type="button"
            className="btn"
            onClick={() => window.open(bot.url, "_blank", "noopener")}
            title={`Ouvrir ${bot.name} dans un nouvel onglet`}
          >
            Ouvrir ↗
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onEdit}
          title={`Modifier ${bot.name}`}
        >
          ✎
        </button>
      </div>
      {bot.hint && <p className="card-hint">{bot.hint}</p>}
    </article>
  );
}

export default function Dashboard({
  bots,
  query,
  statusMap,
  onOpen,
  onToggleFav,
  onEdit,
  onAdd,
}: DashboardProps) {
  const filtered = bots.filter((bot) => matches(bot, query));
  const favorites = query.trim()
    ? []
    : filtered.filter((bot) => bot.favorite);
  const rest = query.trim()
    ? filtered
    : filtered.filter((bot) => !bot.favorite);

  return (
    <div className="dashboard">
      <div className="dash-hero">
        <div>
          <h2>Tableau de bord</h2>
          <p>
            {bots.length} chatbot{bots.length > 1 ? "s" : ""} configuré
            {bots.length > 1 ? "s" : ""} — clique sur « Ouvrir » pour charger
            un bot dans un onglet.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onAdd}>
          + Ajouter un chatbot
        </button>
      </div>

      {filtered.length === 0 && (
        <div className="empty">
          <p>Aucun chatbot ne correspond à « {query} ».</p>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            Ajouter un chatbot
          </button>
        </div>
      )}

      {favorites.length > 0 && (
        <section aria-label="Favoris">
          <h3 className="section-title">★ Favoris</h3>
          <div className="card-grid">
            {favorites.map((bot) => (
              <BotCard
                key={bot.id}
                bot={bot}
                status={statusMap[bot.id] ?? "web"}
                onOpen={() => onOpen(bot.id)}
                onToggleFav={() => onToggleFav(bot.id)}
                onEdit={() => onEdit(bot)}
              />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section aria-label={favorites.length > 0 ? "Autres chatbots" : "Chatbots"}>
          {favorites.length > 0 && (
            <h3 className="section-title">Tous les chatbots</h3>
          )}
          <div className="card-grid">
            {rest.map((bot) => (
              <BotCard
                key={bot.id}
                bot={bot}
                status={statusMap[bot.id] ?? "web"}
                onOpen={() => onOpen(bot.id)}
                onToggleFav={() => onToggleFav(bot.id)}
                onEdit={() => onEdit(bot)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
