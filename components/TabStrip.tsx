"use client";

import type { ChatbotEntry } from "../lib/tabs";

interface TabStripProps {
  openBots: ChatbotEntry[];
  activeId: string | "home";
  onSelect: (id: string | "home") => void;
  onClose: (id: string) => void;
}

export default function TabStrip({
  openBots,
  activeId,
  onSelect,
  onClose,
}: TabStripProps) {
  return (
    <div className="tabstrip" role="tablist" aria-label="Onglets ouverts">
      <button
        type="button"
        role="tab"
        aria-selected={activeId === "home"}
        className={`tabstrip-tab ${activeId === "home" ? "tabstrip-active" : ""}`}
        onClick={() => onSelect("home")}
        title="Accueil — tableau de bord"
      >
        <span aria-hidden="true">🏠</span>
        <span>Accueil</span>
      </button>
      {openBots.map((bot) => {
        const isActive = activeId === bot.id;
        return (
          <div
            key={bot.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            className={`tabstrip-tab ${isActive ? "tabstrip-active" : ""}`}
            style={{ "--tab-color": bot.color } as React.CSSProperties}
            onClick={() => onSelect(bot.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(bot.id);
              }
            }}
            title={bot.url || bot.name}
          >
            <span aria-hidden="true">{bot.icon}</span>
            <span className="tabstrip-name">{bot.name}</span>
            <button
              type="button"
              className="tabstrip-close"
              aria-label={`Fermer ${bot.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(bot.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
