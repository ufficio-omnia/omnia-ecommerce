import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import OmniaAiLoginForm from "@/components/omnia-ai/login-form";

export const metadata: Metadata = {
  title: "Accedi — OMNIA AI",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Accedi</h1>
      </section>

      <section className="omnia-pagina-corpo">
        <OmniaAiLoginForm />
      </section>
    </PageShell>
  );
}
