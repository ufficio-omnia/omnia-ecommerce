import type { Metadata } from "next";
import PageShell from "@/components/omnia-ai/page-shell";
import RegistratiForm from "./registrati-form";

export const metadata: Metadata = {
  title: "Registrati — OMNIA AI",
};

export default function OmniaAiRegistratiPage() {
  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Crea il tuo account OMNIA AI</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          Inserisci la tua email: ti invieremo un link per attivare l&apos;account e impostare la
          password. Potrai scegliere e attivare un piano in qualsiasi momento dalla tua area
          riservata.
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        <RegistratiForm />
      </section>
    </PageShell>
  );
}
