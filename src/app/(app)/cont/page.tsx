import { requireUser, ROLE_LABELS } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { PasswordForm } from "./PasswordForm";

export const metadata = { title: "Contul meu" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Contul meu" description={`${user.name} · ${user.email} · ${ROLE_LABELS[user.role]}`} />
      <div className="max-w-md">
        <Card title="Schimbă parola" subtitle="După schimbare, sesiunile deschise pe alte dispozitive se închid.">
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
