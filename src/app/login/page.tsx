import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Autentificare" };

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "22px 22px" }} />
        <div className="relative text-sm font-medium tracking-wide text-[#e9c79f]">WAROSE BAKERY</div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Toate operațiunile, într-un singur loc.</h1>
          <p className="mt-4 text-base leading-relaxed text-white/60">
            Vânzări din Publine, stocuri, congelator, producție și costuri pentru Sibiu, Alba Iulia și BRUTĂRIE — sincronizate automat și verificabile.
          </p>
        </div>
        <div className="relative grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-sm text-white/50">
          <div><div className="font-medium text-white/85">Fără dubluri</div>Fiecare import verificat</div>
          <div><div className="font-medium text-white/85">Reconciliat</div>Totaluri egale cu sursa</div>
          <div><div className="font-medium text-white/85">Istoric complet</div>Cine, ce și când</div>
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-10" />
          <h2 className="text-2xl font-semibold tracking-tight">Bine ați revenit</h2>
          <p className="mb-8 mt-1.5 text-sm text-muted">Autentificați-vă cu contul primit de la administrator.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
