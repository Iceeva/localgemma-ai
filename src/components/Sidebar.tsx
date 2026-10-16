"use client";

import { Cpu, Home, Library, MessageSquarePlus, Pencil, Plug, Server, Settings, Sparkles, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CONVERSATIONS_CHANGED, deleteConversation, getConversation, listConversations, saveConversation, type Conversation } from "@/lib/client/conversations";
import { useApp } from "./AppProvider";

const NAV = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/setup", label: "Configuration locale", icon: Wrench },
  { href: "/models", label: "Bibliothèque de modèles", icon: Library },
  { href: "/servers", label: "Gestionnaire de serveurs", icon: Server },
  { href: "/settings", label: "Paramètres", icon: Settings },
];

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, statusError } = useApp();
  const [convs, setConvs] = useState<Conversation[]>([]);

  const reload = useCallback(() => {
    listConversations()
      .then(setConvs)
      .catch(() => setConvs([]));
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener(CONVERSATIONS_CHANGED, reload);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, reload);
  }, [reload]);

  const connected = status?.state === "running" && status.healthy;
  const label = statusError
    ? "Application injoignable"
    : status?.state === "running"
      ? status.healthy
        ? "llama.cpp connecté"
        : "Serveur ne répond pas"
      : status?.state === "starting"
        ? "Chargement du modèle…"
        : status?.state === "error"
          ? "Erreur du serveur"
          : "llama.cpp arrêté";

  async function rename(c: Conversation) {
    const title = window.prompt("Nouveau titre :", c.title)?.trim();
    if (!title) return;
    const fresh = await getConversation(c.id);
    if (fresh) await saveConversation({ ...fresh, title });
  }
  async function remove(c: Conversation) {
    if (!window.confirm(`Supprimer « ${c.title} » ?`)) return;
    await deleteConversation(c.id);
    if (pathname === `/chat/${c.id}`) router.push("/");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent-soft">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="text-lg font-semibold tracking-tight">LocalGemma AI</span>
      </div>
      <div className="px-3">
        <button
          onClick={() => {
            router.push(`/chat/${crypto.randomUUID()}`);
            onNavigate();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-soft"
        >
          <MessageSquarePlus className="h-4 w-4" /> Nouvelle conversation
        </button>
      </div>
      <nav className="mt-3 space-y-0.5 px-2">
        {NAV.map(({ href, label: l, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} onClick={onNavigate} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`}>
              <Icon className="h-4 w-4" /> {l}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Conversations</div>
      <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {convs.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">Aucune conversation pour l'instant.</p>}
        {convs.map((c) => (
          <div key={c.id} className={`group flex items-center rounded-lg ${pathname === `/chat/${c.id}` ? "bg-white/10" : "hover:bg-white/5"}`}>
            <Link href={`/chat/${c.id}`} onClick={onNavigate} className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-slate-200" title={c.title}>
              {c.title}
            </Link>
            <button onClick={() => void rename(c)} aria-label="Renommer" className="hidden p-1.5 text-slate-400 hover:text-white group-hover:block">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => void remove(c)} aria-label="Supprimer" className="hidden p-1.5 text-slate-400 hover:text-red-400 group-hover:block">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-surface-border p-3 text-xs">
        <div className="flex items-center gap-2" title="Modèle actif">
          <Cpu className="h-3.5 w-3.5 text-slate-400" />
          <span className="truncate text-slate-200">{status?.state === "running" || status?.state === "starting" ? (status.modelName ?? "Modèle") : "Aucun modèle actif"}</span>
        </div>
        <div className="flex items-center gap-2" title="Connexion à llama.cpp">
          <Plug className="h-3.5 w-3.5 text-slate-400" />
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : status?.state === "starting" ? "animate-pulse bg-amber-400" : "bg-slate-500"}`} />
          <span className="text-slate-300">{label}</span>
        </div>
      </div>
    </div>
  );
}
