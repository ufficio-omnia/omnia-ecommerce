import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasActiveSubscription } from "@/lib/subscription";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import ActivateSubscriptionForm from "./activate-subscription-form";

// Avviso non bloccante ma ben visibile: il profilo azienda resta
// necessario al prodotto (contesto per l'AI in analisi/generazione), ma
// non è più un ostacolo all'acquisto (i dati di fatturazione li raccoglie
// Stripe stesso al checkout). Mostrato su ogni pagina finché il profilo
// resta vuoto — non c'è uno stato "già visto" da tracciare, deve restare
// visibile finché non è compilato, non sparire dopo una volta.
function ProfiloAziendaAvviso() {
  return (
    <div className="omnia-avviso-profilo">
      Il tuo profilo azienda è vuoto: compilalo per permettere a OMNIA AI di scrivere l&apos;offerta
      tecnica con i dati reali della tua impresa.{" "}
      <Link href="/dashboard/omnia-ai/profilo-azienda">Compila il profilo azienda →</Link>
    </div>
  );
}

// Stessa logica del banner sopra (non bloccante, sempre visibile finché
// manca), ma per un motivo diverso e più stringente: senza codice
// destinatario o PEC non possiamo trasmettere la fattura allo SDI, quindi
// non possiamo fatturare l'abbonamento. Non blocca l'uso del servizio in
// generale — solo il download dei documenti generati, gate applicato
// server-side in downloadGaraMessaggioFile (src/app/actions/download.ts),
// non solo qui: un banner ignorabile non basta a impedire il download.
function FatturazioneAvviso() {
  return (
    <div className="omnia-avviso-profilo">
      Per poterti fatturare l&apos;abbonamento dobbiamo trasmettere la fattura allo SDI: completa il
      codice destinatario o la PEC nel profilo azienda. Finché mancano entrambi non potrai scaricare
      i documenti generati.{" "}
      <Link href="/dashboard/omnia-ai/profilo-azienda">Completa i dati di fatturazione →</Link>
    </div>
  );
}

export default async function OmniaAiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const active = await hasActiveSubscription(user.id);

  if (!active) {
    const admin = createAdminClient();
    const legalDocuments = await getCurrentOmniaAiLegalDocuments(admin);

    return (
      <div className="omnia-app-shell">
        <h1 className="omnia-app-titolo">Attiva OMNIA AI</h1>
        <p className="omnia-app-sottotitolo">
          Scegli il piano più adatto al numero di gare a cui partecipi ogni mese. L&apos;abbonamento
          si rinnova automaticamente; puoi disdirlo quando vuoi dalla tua area riservata.
        </p>

        {legalDocuments ? (
          <ActivateSubscriptionForm
            condizioniVersion={legalDocuments.condizioniAbbonamento.version}
            privacyVersion={legalDocuments.privacyPolicy.version}
          />
        ) : (
          <p className="omnia-messaggio-stato errore" style={{ marginTop: 24 }}>
            Attivazione temporaneamente non disponibile. Riprova più tardi o contattaci.
          </p>
        )}
      </div>
    );
  }

  const { data: company } = await supabase
    .from("companies")
    .select("ragione_sociale, partita_iva, indirizzo, codice_sdi, pec")
    .eq("user_id", user.id)
    .maybeSingle<{
      ragione_sociale: string | null;
      partita_iva: string | null;
      indirizzo: string | null;
      codice_sdi: string | null;
      pec: string | null;
    }>();

  const profiloIncompleto =
    !company?.ragione_sociale || !company?.partita_iva || !company?.indirizzo;
  const fatturazioneIncompleta = !company?.codice_sdi && !company?.pec;

  return (
    <>
      {fatturazioneIncompleta && <FatturazioneAvviso />}
      {profiloIncompleto && <ProfiloAziendaAvviso />}
      {children}
    </>
  );
}
