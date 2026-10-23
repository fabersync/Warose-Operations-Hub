"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, TrendingUp, Boxes, Snowflake, ClipboardCheck, ChefHat, Truck, Timer,
  FileText, PieChart, UploadCloud, Tag, Settings, ScrollText, Menu, X, LogOut, FileBarChart, Bell, ShoppingCart, Trash2, Coffee, Sheet,
} from "lucide-react";
import { Logo } from "./Logo";

const ICONS = { LayoutDashboard, TrendingUp, Boxes, Snowflake, ClipboardCheck, ChefHat, Truck, Timer, FileText, PieChart, UploadCloud, Tag, Settings, ScrollText, FileBarChart, ShoppingCart, Trash2, Coffee, Sheet };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; stage?: string };
export type NavGroup = { label: string; items: NavItem[] };

export function Nav({ groups, user, logout, unread }: { groups: NavGroup[]; user: { name: string; role: string }; logout: () => Promise<void>; unread: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const initials = user.name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const bell = (
    <Link href="/notificari" onClick={() => setOpen(false)} className="relative rounded-lg p-2 text-ink-2 hover:bg-canvas hover:text-ink" aria-label={unread ? `Notificări: ${unread} necitite` : "Notificări"}>
      <Bell className="size-5" strokeWidth={1.75} />
      {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-6 pt-5"><Logo /><span className="hidden lg:block">{bell}</span></div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const Icon = ICONS[it.icon];
                const active = isActive(it.href);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      onClick={() => setOpen(false)}
                      className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors ${
                        active ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas hover:text-ink"
                      }`}
                    >
                      <Icon className={`size-[17px] ${active ? "text-[#e9c79f]" : "text-muted group-hover:text-ink-2"}`} strokeWidth={1.75} />
                      <span className="flex-1">{it.label}</span>
                      {it.stage && <span className={`text-[10px] font-medium ${active ? "text-white/50" : "text-faint"}`}>{it.stage}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-lg px-2.5 py-2">
          <div className="grid size-8 place-items-center rounded-full bg-crust-soft text-xs font-semibold text-crust">{initials}</div>
          <Link href="/cont" onClick={() => setOpen(false)} className="min-w-0 flex-1 rounded-md hover:bg-canvas" title="Contul meu · schimbă parola">
            <div className="truncate text-[13px] font-medium text-ink">{user.name}</div>
            <div className="truncate text-[11px] text-muted">{user.role}</div>
          </Link>
          <form action={logout}>
            <button className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink" title="Deconectare" aria-label="Deconectare">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block print:hidden">{content}</aside>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <Logo />
        <span className="ml-auto">{bell}</span>
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-2 hover:bg-canvas" aria-label="Deschide meniul"><Menu className="size-5" /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-lg p-2 text-muted hover:bg-canvas" aria-label="Închide meniul"><X className="size-5" /></button>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
