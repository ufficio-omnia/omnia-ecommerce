import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import PageShell from "@/components/omnia-ai/page-shell";
import { hasActiveSubscription } from "@/lib/subscription";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import { PIANI, formatEuroCifra, type PianoSlug } from "@/lib/omnia-ai-plans";
import AbbonatiPianoForm from "./abbonati-piano-form";

function isPianoSlug(value: string): value is PianoSlug {
  return value in PIANI;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ piano: string }>;
}): Promise<Metadata> {
  const { piano } = await params;
  const p = isPianoSlug(piano) ? PIANI[piano] : null;
  return {
    title: p ? `Abbonati — Piano ${p.nome} — OMNIA AI` : "Piano non trovato — OMNIA AI",
  };
}

// Indirizzo pensato per essere condiviso direttamente con un cliente
// (es. in una conversazione di vendita): piano già scelto in evidenza,
// nessuna scheda concorrente, un collegamento discreto per cambiare
// idea. Percorso di acquisto diretto, senza obbligo di registrazione
// preventiva — l'account si crea (o si aggancia, se l'email corrisponde
// a uno già esistente) dal webhook dopo il pagamento, si veda
// startOmniaAiSubscriptionCheckout.
export default async function AbbonatiPianoPage({
  params,
}: {
  params: Promise<{ piano: string }>;
}) {
  const { piano } = await params;
  if (!isPianoSlug(piano)) notFound();
  const p = PIANI[piano];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Chi è già abbonato non ha motivo di vedere una pagina di acquisto:
  // il controllo server nell'azione lo bloccherebbe comunque, ma
  // reindirizzarlo subito evita di fargli compilare un modulo per
  // niente.
  if (user && (await hasActiveSubscription(user.id))) {
    redirect("/dashboard/omnia-ai");
  }

  const admin = createAdminClient();
  const legalDocuments = await getCurrentOmniaAiLegalDocuments(admin);

  return (
    <PageShell>
      <section className="omnia-pagina-hero">
        <h1>Abbonati al piano {p.nome}</h1>
        <p className="omnia-sotto" style={{ margin: "24px auto 0" }}>
          {formatEuroCifra(p.prezzoCentesimi)}€ al mese, IVA inclusa — {p.gareIncluse} gare incluse
          ogni mese. Rinnovo automatico, disdici quando vuoi.
        </p>
        <p className="micro" style={{ marginTop: 12 }}>
          <Link href="/piani">← Cambia piano</Link>
        </p>
      </section>

      <section className="omnia-pagina-corpo">
        {legalDocuments ? (
          <AbbonatiPianoForm
            piano={piano}
            emailUtente={user?.email ?? null}
            condizioniVersion={legalDocuments.condizioniAbbonamento.version}
            privacyVersion={legalDocuments.privacyPolicy.version}
          />
        ) : (
          <p className="omnia-messaggio-stato errore">
            Attivazione temporaneamente non disponibile. Riprova più tardi o contattaci.
          </p>
        )}
      </section>
    </PageShell>
  );
}
