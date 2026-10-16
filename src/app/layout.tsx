import type { Metadata } from "next";
import type { ReactNode } from "react";
import "highlight.js/styles/github-dark.css";
import "./globals.css";
import { AppProvider } from "@/components/AppProvider";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "LocalGemma AI",
  description: "Discutez avec des modèles d'IA locaux (GGUF) via llama.cpp, sans cloud.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
