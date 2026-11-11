"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { generaCopertinaGara, scaricaCopertinaGara, type CopertinaState } from "@/app/actions/gara-copertina";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import ThinkingIndicator from "./thinking-indicator";
import AcquistoCopertina from "./copertina-acquisto";
import { ETICHETTA_STILE, type Stile } from "@/lib/copertina-relazione-calcoli";
import { prezzoCopertina, type MotivoNegato } from "@/lib/copertina-diritto-calcoli";
import { TESTI_COPERTINA, type OffertaCopertina, type RitornoPagamentoCopertina } from "@/lib/copertina-acquisto-calcoli";

const statoIniziale: CopertinaState = {};

export type CopertinaVista = {
  marca: string;
  stile: Stile;
  nomePng: string;
  nomePdf: string | null;
  // quando è stata generata (ISO), per mostrarla al cliente
  generataIl: string | null;
  // link temporaneo per mostrare l'immagine: solo per le più recenti (le altre si scaricano e basta)
  anteprimaUrl: string | null;
};

export type DocumentoScelta = { id: string; nome_file: string };

// Per ogni stile: quante generazioni ha già fatto su questa gara, il massimo, e se può farne un'altra (con il perché, se no). Lo decide il server.
export type StatoStile = { stile: Stile; fatte: number; massime: number; consentito: boolean; motivo: MotivoNegato | null; messaggio: string | null };

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

// Riquadro «Copertina relazione tecnica» dentro la gara: due pulsanti (stile stilizzato e stile realistico) leggono il disciplinare o il capitolato scelto
// (titolo, CIG e ciò che il documento dice della gara) e creano una copertina in formato A4, con il logo della stazione appaltante in alto a sinistra e
// quello del cliente in basso a destra. Il cliente può generarle in entrambi gli stili e poi scegliere: ogni generazione si aggiunge alle precedenti
// (si possono confrontare e scaricare in PNG o PDF). Chi può generare lo decide il server: qui si mostra soltanto.
export default function CopertinaPanel({
  garaId,
  stazioneAppaltante,
  logoStazione,
  logoCliente,
  documenti,
  documentoPredefinito,
  stili,
  righeGratis,
  offerta,
  ritorno,
  privacyVersione,
  acquistata,
  copertine,
}: {
  garaId: string;
  stazioneAppaltante: string | null;
  logoStazione: boolean;
  logoCliente: boolean;
  // solo PDF: è il formato che si legge
  documenti: DocumentoScelta[];
  documentoPredefinito: string | null;
  stili: StatoStile[];
  // ciò che resta del periodo gratuito (vuote se il servizio non è gratuito per questo cliente)
  righeGratis: string[];
  // servizio «a pagamento» per questo cliente: se la gara si può comprare adesso, e da chi (il titolare; l'Ufficio Gare vede che serve il titolare)
  offerta: OffertaCopertina;
  // l'esito del pagamento, dal parametro con cui Stripe riporta il cliente alla gara
  ritorno: RitornoPagamentoCopertina;
  privacyVersione: number | null;
  // questa gara ha un acquisto pagato
  acquistata: boolean;
  copertine: CopertinaVista[];
}) {
  const [state, formAction, pending] = useActionState(generaCopertinaGara, statoIniziale);
  // quale dei due pulsanti è stato premuto, per scrivere «Generazione in corso...» su quello giusto
  const [stileInCorso, setStileInCorso] = useState<Stile | null>(null);
  const idSelezione = "copertina-documento";
  // la più recente di ciascuno stile è «Ultima copertina»
  const primaPerStile = new Map<Stile, string>();
  for (const c of copertine) if (!primaPerStile.has(c.stile)) primaPerStile.set(c.stile, c.marca);
  // Se il motivo per cui non si può generare non riguarda un singolo stile (servizio spento, periodo finito, a pagamento) lo si dice una volta sola, sopra
  // i pulsanti; il «massimo raggiunto» sta sotto il pulsante dello stile che l'ha raggiunto.
  const inConferma = ritorno === "pagato" && !acquistata;
  const motivoGenerale = inConferma ? null : (stili.find((s) => !s.consentito && s.motivo !== "limite_stile")?.messaggio ?? null);
  const puoGenerare = stili.some((s) => s.consentito);

  return (
    <section className="omnia-riquadro" style={{ marginTop: 24 }} aria-labelledby="copertina-titolo">
      <form action={formAction}>
        <input type="hidden" name="garaId" value={garaId} />
        <div className="omnia-app-intestazione">
          <span className="omnia-eyebrow" id="copertina-titolo">
            Copertina relazione tecnica
          </span>
        </div>

        <p className="omnia-riquadro-nota" style={{ marginTop: 4 }}>
          Una copertina in formato A4 per la tua relazione tecnica, costruita sulla gara: legge il disciplinare o il capitolato che scegli qui sotto e ne ricava il titolo, il CIG e lo sfondo (luoghi, attività e territorio della gara). Al centro <strong>RELAZIONE TECNICA</strong> e sotto il titolo con il CIG,
          in alto a sinistra il logo della stazione appaltante, in basso a destra il tuo logo. Scegli lo stile: <strong>stilizzato</strong> (sfondo grafico illustrato) o <strong>realistico</strong> (sfondo fotografico). Puoi generarle in tutti e due gli stili e poi decidere; ogni generazione è diversa e si
          aggiunge alle precedenti. Per ogni gara puoi fare fino a <strong>3 generazioni per stile</strong> (3 stilizzate e 3 realistiche).
        </p>

        <div style={{ marginTop: 14, maxWidth: 560 }}>
          <label className="omnia-etichetta" htmlFor={idSelezione}>
            Documento da cui leggere titolo e CIG (il disciplinare o il capitolato)
          </label>
          {documenti.length > 0 ? (
            <select id={idSelezione} name="documentoId" className="omnia-select" defaultValue={documentoPredefinito ?? documenti[0].id} disabled={pending}>
              {documenti.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome_file}
                </option>
              ))}
            </select>
          ) : (
            <p className="omnia-riquadro-nota" style={{ margin: 0 }}>
              Nella gara non c&apos;è nessun documento in formato PDF: carica il disciplinare o il capitolato in PDF per generare la copertina.
            </p>
          )}
        </div>

        {/* Ciò che resta del periodo gratuito, e perché non si può generare (servizio non attivo, periodo finito, a pagamento): lo dice il server, qui si mostra */}
        {righeGratis.length > 0 && (
          <p className="omnia-riquadro-nota" style={{ marginTop: 14, marginBottom: 0 }}>
            {righeGratis.join(" ")}
          </p>
        )}
        {motivoGenerale && (
          <div className="omnia-messaggio-stato avviso" style={{ marginTop: 14 }}>
            <p style={{ margin: 0 }}>{motivoGenerale}</p>
          </div>
        )}

        {/* I due stili sono due pulsanti dello stesso modulo: il valore di quello premuto arriva all'azione (name="stile"). Ognuno dice quante generazioni
            ha già fatto su questa gara (massimo 3) e si spegne quando non se ne possono fare altre. */}
        <div style={{ marginTop: 16, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          {stili.map((s) => (
            <div key={s.stile} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
              <button
                type="submit"
                name="stile"
                value={s.stile}
                disabled={pending || documenti.length === 0 || !s.consentito}
                onClick={() => setStileInCorso(s.stile)}
                className={s.stile === "stilizzato" ? "omnia-btn omnia-btn-p omnia-btn-piccolo" : "omnia-btn omnia-btn-s omnia-btn-piccolo"}
              >
                {pending && stileInCorso === s.stile ? "Generazione in corso..." : `Genera copertina relazione tecnica — ${ETICHETTA_STILE[s.stile].toLowerCase()}`}
              </button>
              <span className="omnia-riquadro-nota" style={{ margin: 0 }}>
                {ETICHETTA_STILE[s.stile]}: {s.fatte} di {s.massime} generazioni fatte
                {s.motivo === "limite_stile" ? " — hai raggiunto il massimo per questa gara" : ""}
              </span>
            </div>
          ))}
        </div>
      </form>

      {/* L'acquisto sta FUORI dal modulo di generazione (un modulo dentro l'altro non è valido): servizio «a pagamento», gara non ancora pagata */}
      {acquistata && ritorno !== "pagato" && <p className="omnia-riquadro-nota" style={{ marginTop: 12 }}>Hai acquistato la copertina di questa gara: fino a 3 generazioni per stile.</p>}
      {ritorno === "annullato" && !acquistata && <p className="omnia-messaggio-stato avviso">{TESTI_COPERTINA.pagamentoAnnullato}</p>}
      {ritorno === "pagato" && !acquistata && <p className="omnia-messaggio-stato avviso">{TESTI_COPERTINA.pagamentoRicevuto}</p>}
      {ritorno === "pagato" && acquistata && puoGenerare && <p className="omnia-messaggio-stato successo">{TESTI_COPERTINA.pagamentoConfermato}</p>}
      {/* appena pagato, finché il webhook non conferma, il modulo di acquisto non si offre di nuovo (si rischierebbe un secondo pagamento) */}
      {offerta.stato === "acquistabile" && !inConferma && <AcquistoCopertina garaId={garaId} prezzoCentesimi={offerta.prezzoCentesimi} privacyVersione={privacyVersione} />}
      {offerta.stato === "solo_titolare" && (
        <p className="omnia-messaggio-stato avviso" style={{ marginTop: 12 }}>
          {TESTI_COPERTINA.soloTitolare(prezzoCopertina(offerta.prezzoCentesimi))}
        </p>
      )}

      <ul style={{ margin: "14px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
        <li>
          Logo in alto a sinistra{stazioneAppaltante ? ` (${stazioneAppaltante})` : ""}:{" "}
          {logoStazione ? (
            <span className="omnia-badge verde">caricato</span>
          ) : (
            <>
              <span className="omnia-badge ambra">non caricato</span> <span className="omnia-riquadro-nota">— caricalo dalla sezione «Documenti» qui sopra, altrimenti resterà vuoto</span>
            </>
          )}
        </li>
        <li>
          Il tuo logo in basso a destra:{" "}
          {logoCliente ? (
            <span className="omnia-badge verde">caricato</span>
          ) : (
            <>
              <span className="omnia-badge ambra">non caricato</span>{" "}
              <span className="omnia-riquadro-nota">
                — caricalo nel <Link href="/dashboard/omnia-ai/profilo-azienda">profilo azienda</Link>, altrimenti resterà vuoto
              </span>
            </>
          )}
        </li>
      </ul>
      <p className="omnia-riquadro-nota" style={{ marginTop: 8 }}>
        Controlla sempre i testi e i loghi sulla copertina prima di usarla: è un&apos;immagine creata da un modello di intelligenza artificiale e può contenere imprecisioni.
      </p>

      {pending && (
        <div className="omnia-messaggio-stato avviso">
          <ThinkingIndicator />
          <p style={{ margin: "8px 0 0" }}>Sto leggendo il documento e creando la copertina: richiede circa un minuto. Non chiudere la pagina.</p>
        </div>
      )}

      {state.error && !pending && (
        <div className="omnia-messaggio-stato errore">
          <p style={{ margin: 0 }}>{state.error}</p>
        </div>
      )}

      {state.ok && !pending && (
        <div className="omnia-messaggio-stato successo">
          <p style={{ margin: 0 }}>
            <strong>Copertina creata{state.stile ? ` (${ETICHETTA_STILE[state.stile].toLowerCase()})` : ""}.</strong> Letto da «{state.documento}»: titolo <strong>{state.titolo}</strong>
            {state.cig ? (
              <>
                , CIG <strong>{state.cig}</strong>
              </>
            ) : (
              ", nessun CIG"
            )}
            .
          </p>
          {state.avvisi && state.avvisi.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.55 }}>
              {state.avvisi.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {copertine.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 20 }}>
          {copertine.map((c) => {
            const ultima = primaPerStile.get(c.stile) === c.marca;
            return (
            <div key={`${c.marca}-${c.stile}`} style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              {c.anteprimaUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.anteprimaUrl}
                  alt={`${ETICHETTA_STILE[c.stile]}, generata il ${quando(c.generataIl)}`}
                  loading="lazy"
                  style={{ width: ultima ? 240 : 130, height: "auto", aspectRatio: "210 / 297", border: "1px solid var(--bordo)", borderRadius: 4 }}
                />
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span>
                  <strong>{ETICHETTA_STILE[c.stile]}</strong>
                  {ultima ? " — la più recente" : ""}
                  {c.generataIl ? ` — generata il ${quando(c.generataIl)}` : ""}
                </span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {c.nomePdf && (
                    <OpenInNewTabButton
                      action={scaricaCopertinaGara}
                      hiddenFields={{ garaId, nomeFile: c.nomePdf }}
                      label="Scarica il PDF (A4)"
                      pendingLabel="Preparo il file..."
                      className={ultima ? "omnia-btn omnia-btn-p omnia-btn-piccolo" : "omnia-btn omnia-btn-s omnia-btn-piccolo"}
                    />
                  )}
                  <OpenInNewTabButton
                    action={scaricaCopertinaGara}
                    hiddenFields={{ garaId, nomeFile: c.nomePng }}
                    label="Scarica l'immagine (PNG)"
                    pendingLabel="Preparo il file..."
                    className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                  />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
