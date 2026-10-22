"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/facturi", label: "Facturi" },
  { href: "/facturi/costuri", label: "Costuri lunare" },
  { href: "/facturi/verificare", label: "Verificare e-Factura" },
  { href: "/facturi/setari", label: "Furnizori & alocări" },
];

export function FinanceTabs() {
  const path = usePathname();
  const active = (href: string) => (href === "/facturi" ? path === href || /^\/facturi\/(\d+|nou)/.test(path) : path.startsWith(href));
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Secțiuni financiar">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${active(t.href) ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>{t.label}</Link>
      ))}
    </nav>
  );
}
