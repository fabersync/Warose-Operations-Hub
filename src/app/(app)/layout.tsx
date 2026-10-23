import { redirect } from "next/navigation";
import { canAccess, destroySession, getUser, ROLE_LABELS, MODULE_ACCESS } from "@/lib/auth";
import { one } from "@/lib/db";
import { Nav, type NavGroup, type NavItem } from "@/components/Nav";

type Item = NavItem & { module: keyof typeof MODULE_ACCESS };

const GROUPS: { label: string; items: Item[] }[] = [
  { label: "Prezentare", items: [
    { href: "/", label: "Dashboard", icon: "LayoutDashboard", module: "dashboard" },
    { href: "/vanzari", label: "Vânzări", icon: "TrendingUp", module: "sales" },
    { href: "/rapoarte", label: "Rapoarte", icon: "FileBarChart", module: "dashboard" },
  ] },
  { label: "Operațiuni", items: [
    { href: "/stocuri", label: "Stocuri", icon: "Boxes", module: "stock" },
    { href: "/congelator", label: "Congelator", icon: "Snowflake", module: "freezer" },
    { href: "/pierderi", label: "Pierderi", icon: "Trash2", module: "consumption" },
    { href: "/consum", label: "Consum & protocol", icon: "Coffee", module: "consumption" },
    { href: "/inventar", label: "Inventar", icon: "ClipboardCheck", module: "inventory" },
    { href: "/productie", label: "Producție & rețete", icon: "ChefHat", module: "production" },
    { href: "/comenzi", label: "Comenzi & transferuri", icon: "Truck", module: "orders" },
    { href: "/aprovizionare", label: "Comenzi furnizori", icon: "ShoppingCart", module: "purchasing" },
    { href: "/dospire", label: "Plan dospire", icon: "Timer", module: "proofing" },
  ] },
  { label: "Financiar", items: [
    { href: "/facturi", label: "Facturi & costuri", icon: "FileText", module: "invoices" },
    { href: "/profitabilitate", label: "Profitabilitate", icon: "PieChart", module: "profitability" },
  ] },
  { label: "Date", items: [
    { href: "/importuri", label: "Importuri & sincronizare", icon: "UploadCloud", module: "imports" },
    { href: "/produse", label: "Produse & coduri", icon: "Tag", module: "products" },
  ] },
  { label: "Administrare", items: [
    { href: "/setari", label: "Setări", icon: "Settings", module: "settings" },
    { href: "/audit", label: "Jurnal audit", icon: "ScrollText", module: "audit" },
  ] },
];

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const groups: NavGroup[] = GROUPS
    .map((g) => ({ label: g.label, items: g.items.filter((i) => canAccess(user, i.module)).map(({ module: _m, ...i }) => i) }))
    .filter((g) => g.items.length);
  const unread = (await one<{ n: number }>("SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL", [user.id]))?.n ?? 0;
  return (
    <div className="min-h-dvh">
      <Nav groups={groups} user={{ name: user.name, role: ROLE_LABELS[user.role] }} logout={logout} unread={unread} />
      <main className="lg:pl-64 print:pl-0">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8 sm:py-9">{children}</div>
      </main>
    </div>
  );
}
