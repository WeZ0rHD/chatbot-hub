"use client";

import { useEffect, useState } from "react";
import {
  BOT_COLORS,
  canEmbed,
  type BotKind,
  type ChatbotEntry,
} from "../lib/tabs";

export interface BotFormValues {
  name: string;
  url: string;
  icon: string;
  color: string;
  kind: BotKind;
  description: string;
  allowEmbed: boolean;
}

interface BotModalProps {
  initial: ChatbotEntry | null;
  onClose: () => void;
  onSave: (values: BotFormValues) => void;
  onDelete?: () => void;
}

function toForm(bot: ChatbotEntry | null): BotFormValues {
  return {
    name: bot?.name ?? "",
    url: bot?.url ?? "",
    icon: bot?.icon ?? "💬",
    color: bot?.color ?? BOT_COLORS[0],
    kind: bot?.kind ?? "external",
    description: bot?.description ?? "",
    allowEmbed: bot ? canEmbed(bot) : false,
  };
}

export default function BotModal({
  initial,
  onClose,
  onSave,
  onDelete,
}: BotModalProps) {
  const [form, setForm] = useState<BotFormValues>(() => toForm(initial));
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(toForm(initial));
    setError("");
  }, [initial]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const name = form.name.trim();
    const url = form.url.trim();
    if (!name) {
      setError("Donne un nom à ce chatbot.");
      return;
    }
    if (url) {
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          setError("L'URL doit commencer par http:// ou https://");
          return;
        }
      } catch {
        setError("Cette URL ne ressemble pas à une URL valide.");
        return;
      }
    }
    onSave({ ...form, name, url });
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? `Modifier ${initial.name}` : "Ajouter un chatbot"}
      >
        <div className="modal-header">
          <h2>{initial ? "Modifier le chatbot" : "Ajouter un chatbot"}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <label>
            Nom *
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Ex. Mon assistant local"
              autoFocus
            />
          </label>
          <label>
            URL (vide = fiche informative)
            <input
              value={form.url}
              onChange={(event) => setForm({ ...form, url: event.target.value })}
              placeholder="https://… ou http://127.0.0.1:port"
              inputMode="url"
            />
          </label>
          <label>
            Description
            <input
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              placeholder="À quoi sert ce chatbot ?"
            />
          </label>
          <div className="form-row">
            <label>
              Icône
              <input
                value={form.icon}
                onChange={(event) =>
                  setForm({ ...form, icon: event.target.value })
                }
                maxLength={4}
              />
            </label>
            <label>
              Type
              <select
                value={form.kind}
                onChange={(event) =>
                  setForm({ ...form, kind: event.target.value as BotKind })
                }
              >
                <option value="external">Externe</option>
                <option value="local">Local</option>
              </select>
            </label>
          </div>
          <fieldset className="color-picker">
            <legend>Couleur</legend>
            <div className="color-row">
              {BOT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-dot ${form.color === color ? "color-selected" : ""}`}
                  style={{ background: color }}
                  aria-label={`Couleur ${color}`}
                  aria-pressed={form.color === color}
                  onClick={() => setForm({ ...form, color })}
                />
              ))}
            </div>
          </fieldset>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.allowEmbed}
              onChange={(event) => {
                const checked = event.target.checked;
                setForm((prev) => ({
                  ...prev,
                  allowEmbed: checked,
                  kind: checked ? prev.kind : "external",
                }));
              }}
            />
            <span>
              Afficher intégré dans le hub (iframe)
              <small>
                À n&apos;activer que si le site l&apos;autorise — sinon page
                blanche, le hub bascule sur « Ouvrir ↗ ».
              </small>
            </span>
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="modal-footer">
          {initial && onDelete && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={onDelete}
            >
              Supprimer
            </button>
          )}
          <div className="modal-footer-right">
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
            <button type="button" className="btn btn-primary" onClick={submit}>
              {initial ? "Enregistrer" : "Ajouter"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
