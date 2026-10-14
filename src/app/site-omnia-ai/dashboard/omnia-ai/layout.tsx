import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import { testoAvvisoProva, type GareGratuite } from "@/lib/omnia-ai-gare-gratuite";
import { getCatalogoPiani } from "@/lib/omnia-ai-catalogo";
import { PIANI_ORDINE } from "@/lib/omnia-ai-plans";
import { leggiOffertaPilotAperta, leggiPilotAcquistato } from "@/lib/omnia-ai-pilot";
import { applicaPilotAlCatalogo, promemoriaPilot, testoPromemoriaPilot, type PromemoriaPilot } from "@/lib/omnia-ai-pilot-calcoli";
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

// Cliente in prova (gare gratuite assegnate dalla console, nessun abbonamento mai avuto). In
// cima a ogni pagina, sopra gli altri avvisi: a gare finite è la cosa più importante da
// sapere, e il pulsante porta alla pagina Abbonamento, dove i piani sono spiegati.
// Ultimi 15 giorni del prezzo pilot: quando scade e a quanto torna l'abbonamento. Non c'è se il pilot non ha
// scadenza (mesi = 0) o non è nella finestra. Sta in cima a ogni pagina finché dura la finestra.
function PilotAvviso({ promemoria, prezzoPieno }: { promemoria: PromemoriaPilot; prezzoPieno: number }) {
  return (
    <div className="omnia-avviso-profilo">
      {testoPromemoriaPilot(promemoria, prezzoPieno)} <Link href="/dashboard/omnia-ai/abbonamento">Vai all&apos;abbonamento →</Link>
    </div>
  );
}

function ProvaAvviso({ gare }: { gare: GareGratuite }) {
  const { esaurite, testo } = testoAvvisoProva(gare);
  return (
    <div className="omnia-avviso-profilo">
      {testo}{" "}
      <Link href="/dashboard/omnia-ai/abbonamento">{esaurite ? "Scegli un abbonamento →" : "Scopri i piani →"}</Link>
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
    const [catalogo, offertaPilot] = await Promise.all([getCatalogoPiani(), leggiOffertaPilotAperta(user.id)]);
    // se c'è un'offerta riservata a questo cliente, il suo piano mostra il prezzo pilot
    const vista = applicaPilotAlCatalogo(PIANI_ORDINE.map((slug) => catalogo[slug]), offertaPilot);

    return (
      <div className="omnia-app-shell">
        {/* In questa pagina non c'è né la barra laterale né il menu del profilo: senza questo
            pulsante un cliente senza abbonamento non avrebbe modo di uscire. */}
        <form action={signOut} style={{ textAlign: "right" }}>
          <button type="submit" className="omnia-btn omnia-btn-s omnia-btn-esci">
            Esci ({user.email})
          </button>
        </form>
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
            piani={vista.piani}
            pianoPredefinito={vista.pianoPredefinito}
            condizioniVersion={legalDocuments.condizioniAbbonamento.version}
            privacyVersion={legalDocuments.privacyPolicy.version}
            allegatoVersion={legalDocuments.allegatoA?.version ?? null}
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

  // Offerta pilot acquistata: negli ultimi 15 giorni un promemoria sempre visibile.
  const pilot = stato.stato === "attivo" ? await leggiPilotAcquistato(user.id) : null;
  const promemoriaDelPilot = pilot ? promemoriaPilot(pilot, new Date()) : null;

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
          {pilot && promemoriaDelPilot && pilot.prezzoPienoCentesimi !== null && <PilotAvviso promemoria={promemoriaDelPilot} prezzoPieno={pilot.prezzoPienoCentesimi} />}
          {stato.stato === "prova" && <ProvaAvviso gare={stato.gare} />}
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
