# Chatbot Hub v2 — tous tes chatbots en onglets

Hub Next.js 14 + React 18 : tableau de bord + barre d'onglets façon navigateur,
chaque bot affiché en iframe. État persisté en `localStorage`
(clé `chatbot-hub:state:v2`, migration auto depuis l'ancienne `chatbot-hub:tabs:v1`).

## Démarrage

```bash
cd F:/_dev-apps/chatbot-hub
npm install   # déjà fait
npm run dev   # http://127.0.0.1:8790
```

## Fonctionnalités

- **Accueil / tableau de bord** : cartes par bot (icône, couleur, description,
  badge Local/Externe, statut En ligne / Hors ligne / Site web), section ★ Favoris.
- **Barre d'onglets** : Accueil + bots ouverts, fermeture par onglet,
  raccourcis `Ctrl+1..9` et `Ctrl+T` (accueil).
- **Recherche** globale (nom, URL, description) dans la barre du haut.
- **Ajouter / Modifier / Supprimer** un bot via le modal (nom, URL, icône,
  couleur, type, description, case « Afficher intégré » + validation d'URL).
- **Anti-page-blanche** : les sites externes ne s'affichent PAS en iframe par
  défaut (ils bloquent via X-Frame-Options / CSP et ne rendraient qu'un blanc).
  À la place : bel écran de lancement (icône, nom, description, URL) avec
  bouton « Ouvrir ↗ » + option « Essayer quand même en intégré ».
  Les apps locales (Mindmap...) s'affichent en iframe normalement.
- **Favoris** (★) par carte.
- **Thème sombre / clair** (☀️/🌙, persisté).
- **Ping des bots locaux** : `fetch no-cors` toutes les 60 s avec cache ;
  si un bot local ne répond pas, écran « ne répond pas » avec hint + boutons
  Réessayer / Ouvrir quand même.
- **Sites anti-iframe** (ChatGPT, Claude, Gemini...) : la plupart envoient
  `X-Frame-Options: DENY` ou `CSP frame-ancestors` → bouton « Ouvrir ↗ ».
- **Barre de statut** en bas : compteurs + réinitialisation.

## Onglets par défaut

| Bot             | URL                   | Type     | Note                                        |
| --------------- | --------------------- | -------- | ------------------------------------------- |
| Mindmap Chatbot | http://127.0.0.1:8767 | local    | `npm run dev` dans `2026-08-26_mindmap-chatbot-final` |
| Reverse Prompt  | (à configurer)        | local    | Servez `START.html` de `2026-06-06-reverse-engineering-chatbot` |
| ChatGPT         | https://chatgpt.com   | externe  | Anti-iframe probable → Ouvrir ↗             |
| Claude          | https://claude.ai     | externe  | Anti-iframe probable → Ouvrir ↗             |
| Gemini          | https://gemini.google.com | externe | Anti-iframe probable → Ouvrir ↗           |
| Le Chat         | https://chat.mistral.ai | externe | Anti-iframe probable → Ouvrir ↗             |

## Cas particuliers

- `2026-06-03_browser-ai-agent-multi-provider` = **extension Chrome** :
  pas affichable en iframe, à utiliser directement dans Chrome.
- `2026-06-06-reverse-engineering-chatbot` = page `START.html` statique :
  servez-la (ex. `npx serve`) puis collez son URL via ✎ Modifier.

## Structure

```
app/
  layout.tsx      coquille html fr + data-theme
  page.tsx        -> <Hub />
  globals.css     design system complet (dark/light, responsive)
components/
  Hub.tsx         état global, raccourcis, ping locaux, viewer iframe
  TabStrip.tsx    barre d'onglets
  Dashboard.tsx   accueil + cartes + favoris + recherche
  BotModal.tsx    ajout/édition/suppression + validation URL
  StatusBar.tsx   compteurs + réinitialisation
lib/
  tabs.ts         modèle ChatbotEntry/HubState, persistance, migration v1
```

## Historique

- **v1 (2026-09-11)** : sidebar + liste, build prod OK mais UI jugée trop basique.
- **v2 (2026-09-12)** : reconstruction complète façon navigateur
  (dashboard, onglets, recherche, favoris, statuts, thèmes, modal, raccourcis).
  Typecheck `tsc --noEmit` OK, zéro erreur.
- **v2.1 (2026-09-12)** : fix « tout est blanc ».
  Cause : Mindmap local éteint + sites externes anti-iframe (blanc silencieux).
  Correctif : Mindmap relancé (:8767) + écran de lancement pour les externes
  (`allowEmbed` opt-in, `canEmbed()`), plus jamais de page blanche.
- **v3 (2026-09-19)** : conversations unifiées 💬 Chats (bouton dans la barre du haut).
  L'onglet Bots (iframe) est inchangé ; Chats ajoute la coquille demandée :
  sessions multi-providers, sélecteur de modèle, projet/contexte associés,
  templates, pièces jointes (aperçu local), streaming + annuler/réessayer,
  usage UNKNOWN si le provider ne le renvoie pas, historique/export/import,
  corbeille avec restauration, recherche, split view (2 conversations côte à côte),
  statuts par onglet + badges non-lus.

## Conversations unifiées (v3)

```
lib/
  providers.ts   registre OpenAI/Anthropic/Ollama/Axon/Local/Mock-fixture,
                 builders de payloads (purs, sans secret), streaming par mots
  chat-store.ts  sessions, statuts, non-lus, export/import, corbeille, recherche
  templates.ts   modèles de prompts (Résumé, Plan, Debug, Traduction, Spec…)
app/api/chat/route.ts
  GET  → disponibilités (présence uniquement, jamais de clés)
  POST → passerelle streaming NDJSON vers OpenAI/Anthropic/Ollama/Axon
components/ChatShell.tsx  coquille : onglets, split, composer, pièces jointes
tests/chat-hub.test.ts    17 tests node:test (registre, payloads, streaming/cancel, store)
```

Adapters réellement disponibles sans clé ni réseau : **Local** (hors-ligne,
déterministe) + **Test Fixture (mock)** (scriptée, labellisée — pas un vrai
provider). OpenAI / Anthropic / Ollama / Axon sont du vrai code HTTP vers les
vrais endpoints ; sans clé/daemon/URL ils répondent `indisponible` (503 typé),
jamais de fausse réponse.

## Sécurité

- Clés lues uniquement côté serveur (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  optionnel `AXON_API_KEY`), jamais envoyées au client, jamais loggées
  (logs = provider/modèle/compteurs uniquement).
- `OLLAMA_HOST` (défaut `127.0.0.1:11434`), `AXON_CHAT_URL` (endpoint
  compatible OpenAI) configurables en variables d'environnement.
- Pièces jointes : images ≤ 2 Mo, lues en local (dataURL), jamais uploadées
  ailleurs que vers le provider choisi.

## Preuve

```bash
cd F:/_dev-apps/chatbot-hub
npm test        # 17 tests (streaming/cancel/restart, adapters, store)
npm run typecheck
npm run build
npm run dev     # http://127.0.0.1:8790 → onglet 💬 Chats
```
