"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { acquistaPianoLavoro, generaPianoLavoroGara, scaricaPianoLavoroGara, type AcquistoPianoLavoroState, type PianoLavoroState } from "@/app/actions/gara-piano-lavoro";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import ThinkingIndicator from "./thinking-indicator";
import ServizioRichiudibile from "./servizio-richiudibile";
import type { EsitoDirittoPiano, FonteDiritto, PianoRiga } from "@/lib/piano-lavoro-gara-calcoli";
import { CLAUSOLE_PIANO_LAVORO, CLAUSOLE_SPECIFICHE_PIANO_LAVORO, VERSIONE_CONDIZIONI_PIANO_LAVORO, type OffertaAcquisto, type RitornoPagamento } from "@/lib/piano-lavoro-acquisto-calcoli";
import { TESTI_PACCHETTI, formattaEuro, testoUnita, type PacchettoNellaGara } from "@/lib/pacchetti-servizi-calcoli";
import { ACQUISTO_SINGOLO_DETTAGLIO, ETICHETTA_LINK_CONDIZIONI, NOTA_FONTE_DIRITTO, PERCORSO_CONDIZIONI_PIANO_LAVORO, RIQUADRO_PIANO_PARTI, TITOLO_AVVERTENZE_ACQUISTO, testoApprovazioneSpecifica } from "@/lib/piano-lavoro-testi";

const statoIniziale: PianoLavoroState = {};
const statoInizialeAcquisto: AcquistoPianoLavoroState = {};

// Da dove viene il diritto a generare, detto al cliente (nessuna nota per le prove in locale): i testi stanno in piano-lavoro-testi.ts
const NOTA_FONTE: Partial<Record<FonteDiritto, string>> = NOTA_FONTE_DIRITTO;

const numero = (n: number, cifre = 0) => n.toLocaleString("it-IT", { minimumFractionDigits: cifre, maximumFractionDigits: cifre });
const euro = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
// il prezzo dell'acquisto: senza decimali se è un importo tondo
const prezzoEuro = (centesimi: number) => (centesimi / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: centesimi % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" }) : "");

// Acquisto singolo del piano di lavoro di questa gara: avvertenze (versionate) da accettare, poi il pagamento su Stripe. Il prezzo che si vede
// viene rimandato al server solo per accorgersi se nel frattempo è cambiato: il server lo rilegge sempre.
function AcquistoPianoLavoro({ garaId, prezzoCentesimi, privacyVersione }: { garaId: string; prezzoCentesimi: number; privacyVersione: number | null }) {
  const [stato, formAction, inCorso] = useActionState(acquistaPianoLavoro, statoInizialeAcquisto);
  const [accetta, setAccetta] = useState(false);
  const [approva, setApprova] = useState(false);
  const prezzo = stato.prezzoAggiornatoCentesimi ?? prezzoCentesimi;
  const aggiornato = stato.prezzoAggiornatoCentesimi !== undefined && stato.prezzoAggiornatoCentesimi !== prezzoCentesimi;
  const numeriSpecifiche = CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.numero);

  return (
    <form action={formAction} style={{ marginTop: 16 }}>
      <input type="hidden" name="garaId" value={garaId} />
      <input type="hidden" name="prezzoMostratoCentesimi" value={prezzo} />
      <p style={{ margin: 0 }}>
        <strong>Piano di lavoro di questa gara: {prezzoEuro(prezzo)} (IVA inclusa).</strong>
        {ACQUISTO_SINGOLO_DETTAGLIO}
      </p>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer" }}>
          {TITOLO_AVVERTENZE_ACQUISTO} (versione {VERSIONE_CONDIZIONI_PIANO_LAVORO})
        </summary>
        <div style={{ marginTop: 10, maxHeight: 240, overflowY: "auto", paddingRight: 8, fontSize: 14, lineHeight: 1.55 }}>
          {CLAUSOLE_PIANO_LAVORO.map((c) => (
            <p key={c.numero} style={{ margin: "0 0 10px" }}>
              <strong>
                {c.numero}. {c.titolo}.
              </strong>{" "}
              {c.testo}
            </p>
          ))}
          <p style={{ margin: 0 }}>
            <a href={PERCORSO_CONDIZIONI_PIANO_LAVORO} target="_blank" rel="noopener noreferrer">
              {ETICHETTA_LINK_CONDIZIONI}
            </a>
          </p>
        </div>
      </details>

      <div className="omnia-check-riga">
        <input id="accettaAvvertenze" name="accettaAvvertenze" type="checkbox" checked={accetta} onChange={(e) => setAccetta(e.target.checked)} required />
        <label htmlFor="accettaAvvertenze">
          Dichiaro di aver letto e accettato le avvertenze sul piano di lavoro (versione {VERSIONE_CONDIZIONI_PIANO_LAVORO}) e di aver preso visione della{" "}
          {privacyVersione ? (
            <a href={`/documenti-legali/privacy-policy/${privacyVersione}`} target="_blank" rel="noopener noreferrer">
              Privacy policy (versione {privacyVersione})
            </a>
          ) : (
            "Privacy policy"
          )}
          .
        </label>
      </div>
      <div className="omnia-check-riga">
        <input id="accettaClausole" name="accettaClausole" type="checkbox" checked={approva} onChange={(e) => setApprova(e.target.checked)} required />
        <label htmlFor="accettaClausole">
          {testoApprovazioneSpecifica(numeriSpecifiche, CLAUSOLE_SPECIFICHE_PIANO_LAVORO.map((c) => c.titolo.toLowerCase()))}
        </label>
      </div>

      {stato.error && !inCorso && (
        <p className="omnia-messaggio-stato errore" style={{ marginTop: 12 }}>
          {stato.error}
          {aggiornato ? ` Nuovo importo: ${prezzoEuro(prezzo)}.` : ""}
        </p>
      )}

      <p style={{ marginTop: 14 }}>
        <button type="submit" className="omnia-btn omnia-btn-p" disabled={!accetta || !approva || inCorso}>
          {inCorso ? "Apertura del pagamento…" : `Acquista il piano di lavoro — ${prezzoEuro(prezzo)}`}
        </button>
      </p>
    </form>
  );
}

// Riquadro «Piano di lavoro» dentro la gara: l'Excel con formule attive costruito dai documenti di gara. Compare dopo l'analisi dei documenti:
// spiega che cosa si ottiene (e che è un dimensionamento di partenza, non un preventivo), genera il file, mostra il riepilogo e lo fa scaricare.
// Chi può generare, e quante volte, lo decide il server (azione e regole in piano-lavoro-gara-calcoli.ts): qui si mostra soltanto. Senza diritto,
// se la vendita è accesa, propone l'acquisto singolo (solo il titolare compra: l'Ufficio Gare vede che serve il titolare).
export default function PianoLavoroPanel({
  garaId,
  piani,
  diritto,
  offerta,
  pacchetto,
  ritorno,
  privacyVersione,
}: {
  garaId: string;
  piani: PianoRiga[];
  diritto: EsitoDirittoPiano;
  offerta: OffertaAcquisto;
  pacchetto: PacchettoNellaGara;
  ritorno: RitornoPagamento;
  privacyVersione: number | null;
}) {
  const [state, formAction, pending] = useActionState(generaPianoLavoroGara, statoIniziale);

  const pronti = piani.filter((p) => p.stato === "pronto");
  const ultimoPronto = pronti[pronti.length - 1] ?? null;
  const inCorso = piani.find((p) => p.stato === "in_corso") ?? null;
  const ultimoErrore = piani.filter((p) => p.stato === "errore").pop() ?? null;
  const riepilogo = ultimoPronto?.riepilogo ?? null;
  const puoGenerare = diritto.ok;
  const seconda = diritto.ok && diritto.versione === 2;
  // Il diritto viene da un'unità del pacchetto che questa gara NON ha ancora usato: generare ne consuma una (il cliente lo conferma)
  const consumaUnita = diritto.ok && diritto.fonte === "pacchetto" && diritto.consumaUnita;

  // il pulsante «Genera» sta nella testata e si vede solo a sezione aperta (ridotta, resta una riga con il titolo e lo stato)
  const azioni = puoGenerare ? (
    <form action={formAction}>
      <input type="hidden" name="garaId" value={garaId} />
      {consumaUnita && <input type="hidden" name="usaPacchetto" value="1" />}
      <button
        type="submit"
        disabled={pending}
        className="omnia-btn omnia-btn-p omnia-btn-piccolo"
        onClick={(e) => {
          if (consumaUnita && !window.confirm(`${TESTI_PACCHETTI.confermaUsoUnita} ${TESTI_PACCHETTI.usaUnitaNota(pacchetto.saldo)}`)) {
            e.preventDefault();
            return;
          }
          if (seconda && !window.confirm("Generare la seconda versione del piano di lavoro (per la proroga dei termini)? È l'ultima possibile per questa gara.")) e.preventDefault();
        }}
      >
        {pending ? "Generazione in corso..." : seconda ? "Genera la seconda versione (proroga)" : ultimoErrore && !ultimoPronto ? "Riprova a generare il piano" : consumaUnita ? `Genera — usa 1 dei tuoi ${pacchetto.saldo}` : "Genera il piano di lavoro"}
      </button>
    </form>
  ) : null;
  // la frase che resta accanto al titolo quando la sezione è ridotta
  const statoRidotto = pending || inCorso ? "generazione in corso…" : pronti.length > 0 ? `${pronti.length} ${pronti.length === 1 ? "piano pronto" : "piani pronti"}` : "nessun piano ancora";

  return (
    // dopo il ritorno da Stripe la sezione si vede aperta anche se il cliente l'aveva ridotta: deve leggere l'esito del pagamento
    <ServizioRichiudibile id="piano_lavoro" titoloId="piano-lavoro-titolo" titolo="Piano di lavoro" riepilogo={statoRidotto} azioni={azioni} forzaApertura={ritorno !== null}>
      <p className="omnia-riquadro-nota" style={{ marginTop: 4 }}>
        {RIQUADRO_PIANO_PARTI[0]}
        <strong>{RIQUADRO_PIANO_PARTI[1]}</strong>
        {RIQUADRO_PIANO_PARTI[2]}
      </p>

      {pending && (
        <div className="omnia-messaggio-stato avviso">
          <ThinkingIndicator />
          <p style={{ margin: "8px 0 0" }}>Sto leggendo i documenti e costruendo il piano: può richiedere alcuni minuti. Non chiudere la pagina.</p>
        </div>
      )}

      {state.error && !pending && (
        <div className="omnia-messaggio-stato errore">
          <p style={{ margin: 0 }}>{state.error}</p>
        </div>
      )}

      {!state.error && !pending && ultimoErrore && !ultimoPronto && !inCorso && (
        <p className="omnia-messaggio-stato errore">L&apos;ultima generazione non è andata a buon fine. Riprova: non è stata conteggiata.</p>
      )}

      {inCorso && !pending && (
        <p className="omnia-messaggio-stato avviso">Una generazione è in corso per questa gara (può richiedere alcuni minuti). Aggiorna la pagina tra poco.</p>
      )}

      {!diritto.ok && !inCorso && !pending && !(diritto.motivo === "non_attivo" && offerta.stato !== "nessuna") && (
        <p className="omnia-messaggio-stato avviso" style={{ marginTop: 12 }}>
          {diritto.messaggio}
        </p>
      )}

      {diritto.ok && NOTA_FONTE[diritto.fonte] && !inCorso && !pending && !consumaUnita && <p className="omnia-riquadro-nota">{NOTA_FONTE[diritto.fonte]}</p>}
      {consumaUnita && !inCorso && !pending && (
        <p className="omnia-riquadro-nota">
          Dal tuo pacchetto: ti restano {testoUnita(pacchetto.saldo, "piano_lavoro")}. {TESTI_PACCHETTI.usaUnitaNota(pacchetto.saldo)}
        </p>
      )}

      {ritorno === "annullato" && !diritto.ok && <p className="omnia-messaggio-stato avviso">Pagamento annullato: non è stato addebitato nulla.</p>}
      {ritorno === "pagato" && !diritto.ok && offerta.stato !== "nessuna" && (
        <p className="omnia-messaggio-stato avviso">Pagamento ricevuto: lo sto confermando. Aggiorna la pagina tra qualche istante e potrai generare il piano di lavoro.</p>
      )}
      {ritorno === "pagato" && diritto.ok && <p className="omnia-messaggio-stato successo">Pagamento confermato: puoi generare il piano di lavoro di questa gara.</p>}

      {offerta.stato === "acquistabile" && !inCorso && !pending && <AcquistoPianoLavoro garaId={garaId} prezzoCentesimi={offerta.prezzoCentesimi} privacyVersione={privacyVersione} />}
      {offerta.stato === "acquistabile" && pacchetto.proposta && !inCorso && !pending && (
        <p className="omnia-messaggio-stato avviso" style={{ marginTop: 14 }}>
          <strong>
            {pacchetto.proposta.offertaId ? `${TESTI_PACCHETTI.offertaDedicata}: ` : "Lavori su più gare di pulizie? Con un pacchetto: "}
            {testoUnita(pacchetto.proposta.quantita, "piano_lavoro")} a {formattaEuro(pacchetto.proposta.prezzoCentesimi)} (IVA inclusa), {formattaEuro(pacchetto.proposta.perUnitaCentesimi)} l&apos;uno.
          </strong>{" "}
          {TESTI_PACCHETTI.dettaglioPacchetto}{" "}
          <Link href={pacchetto.proposta.offertaId ? `/dashboard/omnia-ai/servizi?servizio=piano_lavoro&offerta=${pacchetto.proposta.offertaId}` : "/dashboard/omnia-ai/servizi?servizio=piano_lavoro"}>
            {pacchetto.proposta.offertaId ? "Vedi l'offerta" : "Vedi i pacchetti"}
          </Link>
        </p>
      )}
      {offerta.stato === "solo_titolare" && !inCorso && !pending && (
        <p className="omnia-messaggio-stato avviso" style={{ marginTop: 12 }}>
          Il piano di lavoro di questa gara costa {prezzoEuro(offerta.prezzoCentesimi)} (IVA inclusa) e lo acquista il titolare dell&apos;account dalla pagina della gara. Una volta acquistato potrai generarlo anche tu.
        </p>
      )}

      {ultimoPronto && riepilogo && (
        <div style={{ marginTop: 16 }}>
          <div className="omnia-messaggio-stato successo">
            <p style={{ margin: 0 }}>
              <strong>Piano di lavoro pronto</strong>
              {ultimoPronto.versione === 2 ? " (seconda versione)" : ""}
              {ultimoPronto.completata_il ? ` — generato il ${data(ultimoPronto.completata_il)}` : ""}.
            </p>
          </div>

          <div className="omnia-dati-griglia" style={{ marginTop: 12 }}>
            <div className="omnia-dato">
              <div className="omnia-dato-etichetta">Monte ore annuo</div>
              <div className="omnia-dato-valore">{numero(riepilogo.oreTotali)}</div>
              <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
                {numero(riepilogo.fte, 1)} addetti equivalenti
              </div>
            </div>
            <div className={`omnia-dato${riepilogo.scostamentoPct !== null && Math.abs(riepilogo.scostamentoPct) > 0.05 ? " ambra" : ""}`}>
              <div className="omnia-dato-etichetta">Quadratura</div>
              <div className="omnia-dato-valore">{riepilogo.scostamentoPct === null ? "Monte ore non dichiarato" : `${riepilogo.scostamentoPct >= 0 ? "+" : ""}${numero(riepilogo.scostamentoPct * 100, 1)}%`}</div>
              <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
                {riepilogo.esito}
              </div>
            </div>
            <div className="omnia-dato">
              <div className="omnia-dato-etichetta">Macchinari e attrezzature</div>
              <div className="omnia-dato-valore">{euro(riepilogo.macchinariTotale)}</div>
              <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
                {riepilogo.macchinariVoci} voci, IVA esclusa, prezzi standard
              </div>
            </div>
            <div className="omnia-dato">
              <div className="omnia-dato-etichetta">Sedi e tipologie</div>
              <div className="omnia-dato-valore">
                {riepilogo.sedi} sedi · {riepilogo.tipologie} tipologie
              </div>
              <div className="omnia-riquadro-nota" style={{ margin: "4px 0 0" }}>
                {riepilogo.documentiLetti} documenti letti{riepilogo.documentiNonLetti > 0 ? `, ${riepilogo.documentiNonLetti} non letti (elenco nel file)` : ""}
              </div>
            </div>
          </div>

          <p className="omnia-riquadro-nota" style={{ marginTop: 12 }}>
            Dati nel file: <span className="omnia-badge verde">{riepilogo.datiDaDocumenti} dai documenti</span> <span className="omnia-badge ambra">{riepilogo.datiIpotesi} ipotesi da validare</span>{" "}
            <span className="omnia-badge rosso">{riepilogo.datiMancanti} mancanti da inserire</span>
          </p>

          {riepilogo.daVerificare.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <span className="omnia-eyebrow">Da completare o verificare</span>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.55 }}>
                {riepilogo.daVerificare.slice(0, 6).map((voce, i) => (
                  <li key={i}>{voce}</li>
                ))}
              </ul>
              {riepilogo.daVerificare.length > 6 && <p className="omnia-riquadro-nota">…e altre note nella copertina del file.</p>}
            </div>
          )}

          <div style={{ margin: "16px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
            {[...pronti].reverse().map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <OpenInNewTabButton
                  action={scaricaPianoLavoroGara}
                  hiddenFields={{ pianoId: p.id }}
                  label={pronti.length > 1 ? `Scarica la versione ${p.versione}` : "Scarica l'Excel"}
                  pendingLabel="Preparo il file..."
                  className={p.id === ultimoPronto.id ? "omnia-btn omnia-btn-p" : "omnia-btn omnia-btn-s"}
                />
                {pronti.length > 1 && <span className="omnia-riquadro-nota">{p.versione === 2 ? "con la proroga dei termini" : "prima versione"} · {data(p.completata_il)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </ServizioRichiudibile>
  );
}
