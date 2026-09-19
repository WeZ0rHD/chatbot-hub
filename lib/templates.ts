// Chatbot Hub — modèles de prompts (templates).

export interface PromptTemplate {
  id: string;
  title: string;
  icon: string;
  body: string;
}

export const TEMPLATES: PromptTemplate[] = [
  {
    id: "resume",
    title: "Résumé",
    icon: "📝",
    body: "Résume le point suivant en 5 puces maximum, en français :\n\n",
  },
  {
    id: "plan",
    title: "Plan d'action",
    icon: "✅",
    body: "Transforme cette idée en plan d'action concret avec étapes, priorités et livrables :\n\n",
  },
  {
    id: "debug",
    title: "Debug",
    icon: "🐞",
    body: "Voici un bug à diagnostiquer. Donne : 1) hypothèses classées, 2) comment vérifier chacune, 3) correctif proposé.\n\nSymptômes :\n",
  },
  {
    id: "traduction",
    title: "Traduction FR",
    icon: "🇫🇷",
    body: "Traduis en français naturel, sans déformer le sens :\n\n",
  },
  {
    id: "spec",
    title: "Idée → spec",
    icon: "📐",
    body: "Transforme cette idée brute en mini-spec : objectif, périmètre, hors-périmètre, critères d'acceptation.\n\nIdée :\n",
  },
  {
    id: "questions",
    title: "Questions",
    icon: "❓",
    body: "Pose-moi les 5 questions les plus importantes pour clarifier ce sujet avant d'agir :\n\n",
  },
];

export function getTemplate(id: string | null | undefined): PromptTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
