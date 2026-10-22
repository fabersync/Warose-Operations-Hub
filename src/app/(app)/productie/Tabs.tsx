"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/productie", label: "Plan & documente" },
  { href: "/productie/retete", label: "Rețete & costuri" },
  { href: "/productie/saga", label: "Comparație SAGA" },
];

export function ProductionTabs() {
  const path = usePathname();
  const active = (href: string) => (href === "/productie" ? path === href || /^\/productie\/(\d+|nou)/.test(path) : path.startsWith(href));
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Secțiuni producție">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${active(t.href) ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
