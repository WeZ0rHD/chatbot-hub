"use client";

import type { ChatbotEntry } from "../lib/tabs";
import type { BotStatus } from "./Dashboard";

interface StatusBarProps {
  bots: ChatbotEntry[];
  statusMap: Record<string, BotStatus>;
  onReset: () => void;
}

export default function StatusBar({ bots, statusMap, onReset }: StatusBarProps) {
  const online = bots.filter((b) => statusMap[b.id] === "online").length;
  const local = bots.filter((b) => b.kind === "local").length;
  const external = bots.length - local;

  return (
    <footer className="statusbar">
      <span>
        {bots.length} bot{bots.length > 1 ? "s" : ""} · {local} local
        {local > 1 ? "aux" : ""} · {external} externe{external > 1 ? "s" : ""} ·{" "}
        {online} en ligne
      </span>
      <button
        type="button"
        className="statusbar-reset"
        onClick={() => {
          if (window.confirm("Réinitialiser le hub (onglets par défaut) ?")) {
            onReset();
          }
        }}
        title="Réinitialiser le hub"
      >
        Réinitialiser
      </button>
    </footer>
  );
}
