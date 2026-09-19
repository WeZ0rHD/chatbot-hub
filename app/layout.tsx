import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chatbot Hub — tous tes chatbots en onglets",
  description:
    "Tableau de bord + onglets pour regrouper tes chatbots locaux et externes au même endroit.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
