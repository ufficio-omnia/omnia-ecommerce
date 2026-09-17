import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import DashboardShell from "@/components/omnia-ai/dashboard-shell";
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

// In cima a ogni pagina, sopra gli altri avvisi (è il più urgente: quelli
// sopra riguardano dati mancanti, questo la perdita imminente e
// irreversibile dei contenuti). Il "sono già estinti" è deliberatamente
// sempre presente, non condizionato a un saldo residuo noto: è la cosa
// che un cliente meno si aspetta, meglio dirla qui che fargliela scoprire
// riattivando.
function SolaLetturaAvviso({ dataCancellazione }: { dataCancellazione: Date }) {
  return (
    <div className="omnia-avviso-profilo">
      Il tuo abbonamento non è più attivo: l&apos;area è in sola lettura. Puoi consultare le tue
      gare, aprire le chat esistenti e scaricare i documenti già generati, ma non puoi crearne di
      nuove, avviare analisi o generare contenuti. I crediti aggiuntivi eventualmente residui si
      sono già estinti con la cessazione. Se non riattivi l&apos;abbonamento, tutti i contenuti
      verranno cancellati in modo irreversibile il{" "}
      <strong>{dataCancellazione.toLocaleDateString("it-IT")}</strong>.{" "}
      <Link href="/dashboard/omnia-ai/abbonamento">Riattiva abbonamento →</Link>
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

  const stato = await getOmniaAiAccessState(user.id, supabase);

  if (stato.stato === "cessato") {
    const admin = createAdminClient();
    const legalDocuments = await getCurrentOmniaAiLegalDocuments(admin);

    return (
      <div className="omnia-app-shell">
        <h1 className="omnia-app-titolo">
          {stato.avevaAbbonamento ? "Riattiva OMNIA AI" : "Attiva OMNIA AI"}
        </h1>
        <p className="omnia-app-sottotitolo">
          {stato.avevaAbbonamento
            ? "Il tuo precedente abbonamento è cessato e i contenuti sono stati cancellati. Scegli un piano per ricominciare."
            : "Scegli il piano più adatto al numero di gare a cui partecipi ogni mese. L'abbonamento si rinnova automaticamente; puoi disdirlo quando vuoi dalla tua area riservata."}
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
    <DashboardShell
      nomeSaluto={company?.ragione_sociale || user.email || ""}
      email={user.email ?? ""}
      nomeAzienda={company?.ragione_sociale ?? null}
      avvisi={
        <>
          {stato.stato === "sola_lettura" && (
            <SolaLetturaAvviso dataCancellazione={stato.dataCancellazioneContenuti} />
          )}
          {fatturazioneIncompleta && <FatturazioneAvviso />}
          {profiloIncompleto && <ProfiloAziendaAvviso />}
        </>
      }
    >
      {children}
    </DashboardShell>
  );
}
