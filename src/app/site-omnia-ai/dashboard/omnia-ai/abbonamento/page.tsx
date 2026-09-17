import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { getCurrentOmniaAiLegalDocuments } from "@/lib/omnia-ai-legal";
import { PIANI, PACCHETTI_CREDITI, formatEuro, type PianoSlug } from "@/lib/omnia-ai-plans";
import { getConsumoPeriodoCorrente } from "@/lib/omnia-ai-consumo-periodo";
import ActivateSubscriptionForm from "../activate-subscription-form";
import AcquistaCreditiForm from "./acquista-crediti-form";
import DisdiciAbbonamentoButton from "./disdici-abbonamento-button";
import GestisciPagamentoButton from "./gestisci-pagamento-button";
import CambiaPianoForm from "./cambia-piano-form";
import AnnullaCambioPianoButton from "./annulla-cambio-piano-button";

type ConsumoRow = {
  gara_id: string | null;
  gara_titolo: string | null;
  tipo: "piano" | "credito";
  created_at: string;
};

type AcquistoCreditiRow = {
  id: string;
  pacchetto: string;
  crediti: number;
  importo_centesimi: number;
  created_at: string;
};

// Raggiungibile sia da chi è attivo sia da chi è in sola lettura (il
// layout blocca del tutto l'accesso solo oltre i 30 giorni, mostrando la
// schermata di vendita): per la sola lettura questa pagina è proprio la
// destinazione del pulsante "Riattiva abbonamento" del banner, quindi
// mostra il modulo di attivazione invece della gestione (che presuppone
// un abbonamento attivo da leggere).
export default async function AbbonamentoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const stato = await getOmniaAiAccessState(user.id, supabase);

  if (stato.stato !== "attivo") {
    const admin = createAdminClient();
    const legalDocuments = await getCurrentOmniaAiLegalDocuments(admin);

    return (
      <div className="omnia-app-shell">
        <h1 className="omnia-app-titolo">Riattiva OMNIA AI</h1>
        <p className="omnia-app-sottotitolo">
          Scegli un piano per riattivare l&apos;abbonamento. I crediti aggiuntivi eventualmente
          residui dell&apos;abbonamento precedente non sono più disponibili: si sono estinti con la
          cessazione.
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

  const consumoPeriodo = await getConsumoPeriodoCorrente(user.id, supabase);

  if (!consumoPeriodo) return null;

  const { subscription, piano, gareIncluse, gareResidue, saldoCrediti } = consumoPeriodo;
  const inizioPeriodo = subscription.current_period_start ?? subscription.created_at;

  const { data: consumi } = await supabase
    .from("gara_consumi")
    .select("gara_id, gara_titolo, tipo, created_at")
    .eq("user_id", user.id)
    .gte("created_at", inizioPeriodo)
    .order("created_at", { ascending: false })
    .returns<ConsumoRow[]>();

  const { data: acquisti } = await supabase
    .from("omnia_ai_credit_purchases")
    .select("id, pacchetto, crediti, importo_centesimi, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .returns<AcquistoCreditiRow[]>();

  const dataRinnovo = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString("it-IT")
    : null;

  // In evidenza quando restano zero o una gara: è il momento in cui un
  // upgrade ha più senso di un credito singolo, non va nascosto in
  // fondo alla pagina insieme al resto.
  const gareQuasiEsaurite = gareResidue <= 1;
  const pianoRiconosciuto = (piano?.slug ?? null) as PianoSlug | null;

  return (
    <div className="omnia-app-shell">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← Torna alla dashboard
      </Link>

      <h1 className="omnia-app-titolo">Il tuo abbonamento</h1>
      <p className="omnia-app-sottotitolo">
        Piano {piano?.nome ?? subscription.plan}: consumo del periodo, crediti aggiuntivi e
        pagamento.
      </p>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Piano e rinnovo</span>
        <div className="omnia-dati-griglia">
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Piano corrente</div>
            <div className="omnia-dato-valore">{piano?.nome ?? subscription.plan}</div>
          </div>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Prossimo rinnovo</div>
            <div className="omnia-dato-valore">{dataRinnovo ?? "—"}</div>
          </div>
          <div className={`omnia-dato${gareQuasiEsaurite ? " ambra" : ""}`}>
            <div className="omnia-dato-etichetta">Gare incluse residue</div>
            <div className="omnia-dato-valore">
              {gareResidue} / {gareIncluse}
            </div>
          </div>
          <div className="omnia-dato">
            <div className="omnia-dato-etichetta">Crediti aggiuntivi</div>
            <div className="omnia-dato-valore">{saldoCrediti}</div>
          </div>
        </div>
        {dataRinnovo && (
          <p className="omnia-riquadro-nota">
            Il {dataRinnovo} le gare incluse nel piano si azzerano e riparte un nuovo periodo di
            fatturazione, salvo disdetta. I crediti aggiuntivi non hanno scadenza mensile: restano
            disponibili fino all&apos;utilizzo, e comunque fino alla cessazione dell&apos;abbonamento.
          </p>
        )}
        {gareQuasiEsaurite && pianoRiconosciuto && pianoRiconosciuto !== "enterprise" && (
          <p className="omnia-messaggio-stato avviso" style={{ marginTop: 16 }}>
            Le gare incluse in questo periodo sono quasi esaurite: valuta un passaggio a un piano
            superiore qui sotto, oltre ai crediti aggiuntivi.
          </p>
        )}
      </section>

      {pianoRiconosciuto && (
        <section className="omnia-riquadro">
          <span className="omnia-eyebrow">Cambia piano</span>

          {subscription.piano_programmato ? (
            <>
              <p className="omnia-messaggio-stato avviso" style={{ marginTop: 12 }}>
                Cambio a <strong>{PIANI[subscription.piano_programmato as PianoSlug]?.nome ?? subscription.piano_programmato}</strong>{" "}
                programmato dal{" "}
                {subscription.piano_programmato_da
                  ? new Date(subscription.piano_programmato_da).toLocaleDateString("it-IT")
                  : "prossimo rinnovo"}
                . Fino ad allora resti su {piano?.nome ?? subscription.plan}, con le sue gare
                residue.
              </p>
              <div style={{ marginTop: 12 }}>
                <AnnullaCambioPianoButton />
              </div>
            </>
          ) : (
            <>
              <p className="omnia-riquadro-nota">
                Un passaggio a un piano superiore è immediato, con conguaglio addebitato subito. Un
                passaggio a un piano inferiore decorre dal prossimo rinnovo, mai a metà di un
                periodo già pagato.
              </p>
              <div style={{ marginTop: 12 }}>
                <CambiaPianoForm pianoAttuale={pianoRiconosciuto} />
              </div>
            </>
          )}
        </section>
      )}

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Acquista crediti aggiuntivi</span>
        <p className="omnia-riquadro-nota">
          Si consumano solo dopo l&apos;esaurimento delle gare incluse nel piano.
        </p>
        <AcquistaCreditiForm />

        {acquisti && acquisti.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {acquisti.map((a) => {
              const pacchetto =
                PACCHETTI_CREDITI[a.pacchetto as keyof typeof PACCHETTI_CREDITI];
              return (
                <div key={a.id} className="omnia-doc">
                  <span className="nome">
                    {pacchetto?.nome ?? a.pacchetto} ({a.crediti} {a.crediti === 1 ? "gara" : "gare"}
                    ) — {formatEuro(a.importo_centesimi)}
                  </span>
                  <span className="omnia-doc-azioni">
                    <span style={{ fontSize: 12, color: "var(--fioco)" }}>
                      {new Date(a.created_at).toLocaleDateString("it-IT")}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Gare consumate in questo periodo</span>
        {consumi && consumi.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            {consumi.map((c, i) => (
              <div key={i} className="omnia-doc">
                <span className="nome">
                  {c.gara_id ? (
                    <Link href={`/dashboard/omnia-ai/gare/${c.gara_id}`}>
                      {c.gara_titolo ?? "Gara senza titolo"}
                    </Link>
                  ) : (
                    <>
                      {c.gara_titolo ?? "Gara senza titolo"}{" "}
                      <span className="omnia-badge rosso">Cancellata</span>
                    </>
                  )}
                </span>
                <span className="omnia-doc-azioni">
                  <span className={`omnia-badge ${c.tipo === "piano" ? "verde" : "ambra"}`}>
                    {c.tipo === "piano" ? "Piano" : "Credito"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--fioco)" }}>
                    {new Date(c.created_at).toLocaleDateString("it-IT")}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="omnia-elenco-vuoto" style={{ marginTop: 12 }}>
            Nessuna gara consumata in questo periodo.
          </p>
        )}
      </section>

      <section className="omnia-riquadro">
        <span className="omnia-eyebrow">Pagamento e disdetta</span>
        <p className="omnia-riquadro-nota">
          Cambia il metodo di pagamento senza disdire, o gestisci la disdetta.
        </p>

        <div style={{ marginTop: 16 }}>
          <GestisciPagamentoButton />
        </div>

        {subscription.cancel_at_period_end ? (
          <p className="omnia-messaggio-stato avviso" style={{ marginTop: 16 }}>
            Disdetta già richiesta: l&apos;abbonamento resta attivo fino al{" "}
            {dataRinnovo ?? "termine del periodo corrente"}, poi non si rinnova più.
          </p>
        ) : (
          <div style={{ marginTop: 16 }}>
            <DisdiciAbbonamentoButton dataRinnovo={dataRinnovo} />
          </div>
        )}
      </section>
    </div>
  );
}
