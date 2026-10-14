import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import { formatEuro } from "@/lib/omnia-ai-plans";
import { REVISIONE, calcolaPrezzoRevisione, fineGiornoRoma } from "@/lib/omnia-ai-revisione-calcoli";
import { leggiContestoRevisione, leggiRichiestaRevisione } from "@/lib/omnia-ai-revisione";
import RevisioneForm from "./revisione-form";

// Pagina di acquisto della revisione umana: spiega, calcola il prezzo con le regole del server, raccoglie il
// referente e le accettazioni e porta al pagamento. Anche la pagina di ritorno da Stripe: dice com'è andata,
// ma la richiesta diventa «pagata» solo dal webhook.
export default async function RevisionePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ richiesta?: string }>;
}) {
  const { id } = await params;
  const { richiesta: richiestaId } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) redirect("/login");

  const admin = createAdminClient();
  const contesto = await leggiContestoRevisione({ supabase, admin, userId: user.id, garaId: id });
  if (!contesto) notFound();

  const tornaAllaGara = (
    <Link href={`/dashboard/omnia-ai/gare/${id}`} className="omnia-torna">
      ← Torna alla gara
    </Link>
  );

  // Ritorno dal pagamento
  if (richiestaId) {
    const richiesta = await leggiRichiestaRevisione(admin, user.id, richiestaId);
    return (
      <div className="omnia-app-shell">
        {tornaAllaGara}
        <div className="omnia-app-intestazione" style={{ marginTop: 16 }}>
          <div>
            <h1 className="omnia-app-titolo">Revisione umana</h1>
            <p className="omnia-app-sottotitolo">{contesto.gara.titolo}</p>
          </div>
        </div>
        {richiesta?.stato === "pagata" ? (
          <section className="omnia-riquadro">
            <div className="omnia-messaggio-stato successo">
              <p style={{ margin: 0 }}>
                <strong>Richiesta inviata. Grazie!</strong> Abbiamo ricevuto il pagamento di {formatEuro(richiesta.importo_pagato_centesimi ?? richiesta.prezzo_totale_centesimi)}.
              </p>
            </div>
            <ul style={{ margin: "14px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
              <li>
                Entro <strong>{REVISIONE.oreContattoLavorative} ore lavorative</strong> un consulente umano contatterà {richiesta.referente_nome} ({richiesta.referente_email}, {richiesta.referente_cellulare}).
              </li>
              <li>
                Entro <strong>{REVISIONE.oreConsegnaLavorative} ore lavorative</strong> dall&apos;invio riceverai la relazione tecnica revisionata, con intestazione, piè di pagina e copertina grafica personalizzata.
              </li>
              <li>Ti abbiamo mandato una email di conferma. Tieni a portata di mano le informazioni utili alla revisione.</li>
            </ul>
          </section>
        ) : (
          <section className="omnia-riquadro">
            <div className="omnia-messaggio-stato avviso">
              <p style={{ margin: 0 }}>
                {richiesta
                  ? "Stiamo confermando il pagamento: di solito bastano pochi secondi. Ricarica la pagina tra poco."
                  : "Non trovo questa richiesta. Se hai pagato, scrivici dalla pagina Supporto e ti aiutiamo."}
              </p>
            </div>
            <p style={{ marginTop: 14 }}>
              <Link href={`/dashboard/omnia-ai/gare/${id}/revisione?richiesta=${richiestaId}`} className="omnia-btn omnia-btn-s">
                Ricarica
              </Link>
            </p>
          </section>
        )}
      </div>
    );
  }

  const stato = await getOmniaAiAccessState(user.id, supabase);

  let corpo: React.ReactNode;
  if (stato.stato !== "attivo" && stato.stato !== "prova") {
    corpo = (
      <section className="omnia-riquadro">
        <div className="omnia-messaggio-stato avviso">
          <p style={{ margin: 0 }}>Il tuo abbonamento non è attivo: la revisione umana si può richiedere solo con un abbonamento attivo.</p>
        </div>
        <p style={{ marginTop: 14 }}>
          <Link href="/dashboard/omnia-ai/abbonamento" className="omnia-btn omnia-btn-p">
            Vai ad Abbonamento
          </Link>
        </p>
      </section>
    );
  } else if (!contesto.relazione) {
    corpo = (
      <section className="omnia-riquadro">
        <div className="omnia-messaggio-stato avviso">
          <p style={{ margin: 0 }}>La revisione umana si richiede dopo aver elaborato la relazione tecnica finale, con tutti i criteri: chiedilo a OMNIA AI nella chat della gara («elabora la relazione finale»).</p>
        </div>
      </section>
    );
  } else if (contesto.pagata) {
    corpo = (
      <section className="omnia-riquadro">
        <div className="omnia-messaggio-stato successo">
          <p style={{ margin: 0 }}>
            <strong>Revisione umana già richiesta</strong> il {new Date(contesto.pagata.pagata_il ?? contesto.pagata.creata_il).toLocaleDateString("it-IT", { timeZone: "Europe/Rome" })} per questa relazione tecnica.
          </p>
        </div>
        <p className="omnia-riquadro-nota">
          Un consulente contatta {contesto.pagata.referente_nome} entro {REVISIONE.oreContattoLavorative} ore lavorative e la relazione revisionata arriva entro {REVISIONE.oreConsegnaLavorative} ore lavorative dall&apos;invio.
        </p>
      </section>
    );
  } else {
    const esito = calcolaPrezzoRevisione({
      scadenza: contesto.gara.scadenza,
      limitePagineDisciplinare: contesto.gara.limite_pagine_totale,
      pagineStimateRelazione: contesto.relazione.pagineStimate,
      adesso: new Date(),
    });
    if (!esito.ok) {
      corpo = (
        <section className="omnia-riquadro">
          <div className="omnia-messaggio-stato avviso">
            <p style={{ margin: 0 }}>{esito.messaggio}</p>
          </div>
        </section>
      );
    } else {
      const documenti = await getCurrentOmniaAiLegalDocuments(admin);
      const fine = fineGiornoRoma(esito.prezzo.scadenza);
      corpo = (
        <RevisioneForm
          garaId={id}
          emailAccount={user.email}
          privacyVersion={documenti?.privacyPolicy.version ?? null}
          prezzo={{
            pagine: esito.prezzo.pagine,
            fonte: esito.prezzo.fonte,
            baseCentesimi: esito.prezzo.baseCentesimi,
            maggiorazionePercentuale: esito.prezzo.maggiorazionePercentuale,
            totaleCentesimi: esito.prezzo.totaleCentesimi,
            scadenzaTesto: fine ? fine.toLocaleDateString("it-IT", { timeZone: "Europe/Rome" }) : null,
          }}
        />
      );
    }
  }

  return (
    <div className="omnia-app-shell">
      {tornaAllaGara}
      <div className="omnia-app-intestazione" style={{ marginTop: 16 }}>
        <div>
          <h1 className="omnia-app-titolo">Richiedi la revisione umana</h1>
          <p className="omnia-app-sottotitolo">{contesto.gara.titolo}</p>
        </div>
      </div>
      {corpo}
    </div>
  );
}
