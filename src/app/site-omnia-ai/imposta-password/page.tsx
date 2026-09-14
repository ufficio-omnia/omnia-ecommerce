import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PageShell from "@/components/omnia-ai/page-shell";
import SetPasswordForm from "./set-password-form";

export const metadata: Metadata = {
  title: "Imposta password — OMNIA AI",
  robots: { index: false, follow: false },
};

export default async function OmniaAiImpostaPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Imposta la tua password</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Account attivato per {user.email}. Scegli ora una password per accedere in futuro.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <SetPasswordForm />
      </section>
    </PageShell>
  );
}
