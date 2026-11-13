"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { generaCopertinaGara, type CopertinaState } from "@/app/actions/gara-copertina";
import ThinkingIndicator from "./thinking-indicator";
import AcquistoCopertina from "./copertina-acquisto";
import ServizioRichiudibile from "./servizio-richiudibile";
import CopertinaChat from "./copertina-chat";
import CopertineGalleria from "./copertine-galleria";
import { CIG_CAMPO_MASSIMO, ETICHETTA_STILE, SOTTOTITOLO_MASSIMO, TITOLO_PRINCIPALE_MASSIMO, TITOLO_PRINCIPALE_PREDEFINITO, type Stile } from "@/lib/copertina-relazione-calcoli";
import { prezzoCopertina, type MotivoNegato } from "@/lib/copertina-diritto-calcoli";
import { TESTI_COPERTINA, type OffertaCopertina, type RitornoPagamentoCopertina } from "@/lib/copertina-acquisto-calcoli";

const statoIniziale: CopertinaState = {};

export type CopertinaVista = {
  // il nome dei file senza estensione (lo usa la chat per indicare la copertina scelta)
  id: string;
  // «COPERTINA N.x»: in ordine di creazione, comprese quelle modificate in chat
  numero: number;
  marca: string;
  stile: Stile;
  // nata da una modifica in chat
  modifica: boolean;
  nomePng: string;
  nomePdf: string | null;
  // quando è stata generata (ISO), per mostrarla al cliente
  generataIl: string | null;
  // link temporaneo per mostrare l'immagine piccola (la miniatura, o il PNG intero se la copertina non ha la miniatura)
  anteprimaUrl: string | null;
  // link temporaneo al PNG intero, per l'anteprima grande in sovraimpressione
  grandeUrl: string | null;
  // si può modificare in chat (ha la pagina senza loghi e la scheda)
  modificabile: boolean;
};

// La chat per modificare una copertina, come la prepara la pagina (stato e messaggi; le copertine consegnate sono già pronte da mostrare)
export type MessaggioChatVista = {
  id: string;
  ruolo: "cliente" | "assistente";
  testo: string;
  quando: string;
  // per il cliente: il numero della copertina scelta
  numeroScelta: number | null;
  allegato: boolean;
  // per l'assistente: copertina in preparazione, preparazione interrotta, o copertina consegnata
  inPreparazione: boolean;
  interrotta: boolean;
  copertina: CopertinaVista | null;
};
export type ChatVista = {
  stato: { aperta: boolean; modificheFatte: number; modificheRimaste: number; puoScrivere: boolean; motivo: string | null };
  messaggi: MessaggioChatVista[];
  // le copertine che si possono scegliere con il flag
  scelte: CopertinaVista[];
  // la scelta si fa una volta (col primo messaggio): poi la chat lavora sempre sull'ultima versione di quella copertina
  sceltaFatta: boolean;
  lavoro: CopertinaVista | null;
  numeroSceltaIniziale: number | null;
};

export type DocumentoScelta = { id: string; nome_file: string };

// Per ogni stile: quante generazioni ha già fatto su questa gara, il massimo, e se può farne un'altra (con il perché, se no). Lo decide il server.
export type StatoStile = { stile: Stile; fatte: number; massime: number; consentito: boolean; motivo: MotivoNegato | null; messaggio: string | null };

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
  chat,
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
  // la chat delle modifiche (dopo le 6 generazioni; null se non c'è ancora)
  chat: ChatVista | null;
}) {
  const [state, formAction, pending] = useActionState(generaCopertinaGara, statoIniziale);
  // quale dei due pulsanti è stato premuto, per scrivere «Generazione in corso...» su quello giusto
  const [stileInCorso, setStileInCorso] = useState<Stile | null>(null);
  // I testi che il cliente può scrivere al posto di quelli letti dal documento: campi CONTROLLATI, così restano scritti dopo ogni generazione (un modulo che si
  // svuota a ogni invio costringerebbe a riscriverli per ognuna delle sei copertine possibili).
  const [titoloPrincipale, setTitoloPrincipale] = useState("");
  const [sottotitolo, setSottotitolo] = useState("");
  const [cig, setCig] = useState("");
  const idSelezione = "copertina-documento";
  // Se il motivo per cui non si può generare non riguarda un singolo stile (servizio spento, periodo finito, a pagamento) lo si dice una volta sola, sopra
  // i pulsanti; il «massimo raggiunto» sta sotto il pulsante dello stile che l'ha raggiunto.
  const inConferma = ritorno === "pagato" && !acquistata;
  const motivoGenerale = inConferma ? null : (stili.find((s) => !s.consentito && s.motivo !== "limite_stile")?.messaggio ?? null);
  const puoGenerare = stili.some((s) => s.consentito);
  // la frase che resta accanto al titolo quando la sezione è ridotta
  const riepilogo = pending
    ? "generazione in corso…"
    : copertine.length > 0
      ? `${copertine.length} ${copertine.length === 1 ? "copertina generata" : "copertine generate"}`
      : acquistata
        ? "acquistata, nessuna copertina ancora"
        : "nessuna copertina ancora";

  return (
    // dopo il ritorno da Stripe la sezione si vede aperta anche se il cliente l'aveva ridotta: deve leggere l'esito del pagamento
    <ServizioRichiudibile id="copertina" titoloId="copertina-titolo" titolo="Copertina relazione tecnica" riepilogo={riepilogo} forzaApertura={ritorno !== null}>
      <form action={formAction}>
        <input type="hidden" name="garaId" value={garaId} />

        <p className="omnia-riquadro-nota" style={{ marginTop: 4 }}>
          Una copertina in formato A4 per la tua relazione tecnica, costruita sulla gara: legge il disciplinare o il capitolato che scegli qui sotto e ne ricava lo sfondo (luoghi, attività e territorio della gara) e, se non scrivi tu il testo, il titolo e il CIG. Al centro <strong>RELAZIONE TECNICA</strong> e sotto il titolo con il CIG,
          in alto a sinistra il logo della stazione appaltante, in basso a destra il tuo logo. Scegli lo stile: <strong>stilizzato</strong> (sfondo grafico illustrato) o <strong>realistico</strong> (sfondo fotografico). Puoi generarle in tutti e due gli stili e poi decidere; ogni generazione è diversa e si
          aggiunge alle precedenti. Per ogni gara puoi fare fino a <strong>3 generazioni per stile</strong> (3 stilizzate e 3 realistiche).
        </p>

        {/* Ben visibile (richiesta dell'utente, 13/11/2026): dopo le 6 generazioni si apre la chat delle modifiche sulla copertina migliore */}
        <div className="omnia-copertina-avviso-chat">
          <span className="icona" aria-hidden="true">
            💬
          </span>
          <p style={{ margin: 0 }}>
            <strong>Al termine delle 6 generazioni potrai fare le tue modifiche in chat.</strong> Si aprirà una chat sulla copertina che ritieni migliore: chiedi
            cosa cambiare (sfondo, colori, testi, posizione dei loghi, anche un logo nuovo) e ricevi fino a <strong>3 nuove copertine</strong>, in PNG e PDF.
            {chat && (
              <>
                {" "}
                <a href="#copertina-chat">Vai alla chat ↓</a>
              </>
            )}
          </p>
        </div>

        <div style={{ marginTop: 14, maxWidth: 560 }}>
          <label className="omnia-etichetta" htmlFor={idSelezione}>
            Documento da leggere (il disciplinare o il capitolato): ne ricavo lo sfondo e, se non scrivi tu il testo, il titolo e il CIG
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

        {/* Testo scelto dal cliente (facoltativo): PREVALE su titolo e CIG letti dal documento, campo per campo; il documento resta usato per lo sfondo */}
        <fieldset style={{ marginTop: 18, maxWidth: 560, border: 0, padding: 0, minWidth: 0 }}>
          <legend className="omnia-etichetta" style={{ padding: 0, marginBottom: 4 }}>
            <strong>Testo della copertina</strong> (facoltativo)
          </legend>
          <p className="omnia-riquadro-nota" style={{ marginTop: 0, marginBottom: 10 }}>
            Di base titolo e CIG li leggo dal documento. Se preferisci un testo diverso, scrivilo qui sotto: quello che inserisci ha la precedenza su quello letto dal documento (un campo lasciato vuoto resta quello letto). Il documento resta comunque usato per lo sfondo della copertina.
          </p>
          <div>
            <label className="omnia-etichetta" htmlFor="copertina-titolo-principale">
              Titolo principale
            </label>
            <input
              id="copertina-titolo-principale"
              name="testoTitoloPrincipale"
              type="text"
              className="omnia-input"
              value={titoloPrincipale}
              onChange={(e) => setTitoloPrincipale(e.target.value)}
              maxLength={TITOLO_PRINCIPALE_MASSIMO}
              placeholder={TITOLO_PRINCIPALE_PREDEFINITO}
              autoComplete="off"
              disabled={pending}
            />
            <span className="omnia-riquadro-nota" style={{ display: "block", marginTop: 4 }}>
              Per esempio: RELAZIONE TECNICA - OFFERTA TECNICA. Vuoto: {TITOLO_PRINCIPALE_PREDEFINITO}.
            </span>
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="omnia-etichetta" htmlFor="copertina-sottotitolo">
              Sottotitolo centrale
            </label>
            <input
              id="copertina-sottotitolo"
              name="testoSottotitolo"
              type="text"
              className="omnia-input"
              value={sottotitolo}
              onChange={(e) => setSottotitolo(e.target.value)}
              maxLength={SOTTOTITOLO_MASSIMO}
              placeholder="Vuoto: il titolo letto dal documento"
              autoComplete="off"
              disabled={pending}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="omnia-etichetta" htmlFor="copertina-cig">
              CIG
            </label>
            <input
              id="copertina-cig"
              name="testoCig"
              type="text"
              className="omnia-input"
              value={cig}
              onChange={(e) => setCig(e.target.value)}
              maxLength={CIG_CAMPO_MASSIMO}
              placeholder="Vuoto: il CIG letto dal documento"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={pending}
            />
          </div>
        </fieldset>

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
        I loghi vengono applicati così come sono, senza sfondo, direttamente sull&apos;immagine: per il risultato migliore caricali in PNG con sfondo trasparente (uno sfondo bianco lo togliamo noi).
      </p>
      <p className="omnia-riquadro-nota" style={{ marginTop: 4 }}>
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
            <strong>Copertina creata{state.stile ? ` (${ETICHETTA_STILE[state.stile].toLowerCase()})` : ""}.</strong> Lo sfondo è ricavato da «{state.documento}». Testi sulla pagina:
          </p>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.55 }}>
            <li>
              Titolo principale: <strong>{state.titoloPrincipale ?? TITOLO_PRINCIPALE_PREDEFINITO}</strong>
              {state.daCliente?.titoloPrincipale ? " (scritto da te)" : ""}
            </li>
            <li>
              Sottotitolo: <strong>{state.titolo}</strong> ({state.daCliente?.sottotitolo ? "scritto da te" : "dal documento"})
            </li>
            <li>
              {state.cig ? (
                <>
                  CIG: <strong>{state.cig}</strong> ({state.daCliente?.cig ? "scritto da te" : "dal documento"})
                </>
              ) : (
                "Nessun CIG"
              )}
            </li>
          </ul>
          {state.avvisi && state.avvisi.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.55 }}>
              {state.avvisi.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* tutte le copertine affiancate in una griglia; un clic apre l'anteprima grande (copertine-galleria.tsx) */}
      <CopertineGalleria garaId={garaId} copertine={copertine} />
      {/* la chat per modificare una copertina: dopo le 6 generazioni (decide la pagina) */}
      {chat && <CopertinaChat garaId={garaId} chat={chat} />}
    </ServizioRichiudibile>
  );
}
