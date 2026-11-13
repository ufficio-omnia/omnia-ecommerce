"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { inviaRichiestaCopertina, scaricaCopertinaGara, type ChatCopertinaState } from "@/app/actions/gara-copertina";
import OpenInNewTabButton from "@/components/open-in-new-tab-button";
import BrandMark from "@/components/omnia-ai/brand-mark";
import ThinkingIndicator from "./thinking-indicator";
import { ETICHETTA_STILE, etichettaNumero } from "@/lib/copertina-relazione-calcoli";
import { MODIFICHE_MASSIME, RICHIESTA_MASSIMA } from "@/lib/copertina-chat-calcoli";
import type { ChatVista, CopertinaVista } from "./copertina-panel";

const statoIniziale: ChatCopertinaState = {};
const ora = (iso: string) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// La miniatura di una copertina con il suo numero
function Miniatura({ c, larghezza }: { c: CopertinaVista; larghezza: number }) {
  return c.anteprimaUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.anteprimaUrl} alt={`${etichettaNumero(c.numero)}, ${ETICHETTA_STILE[c.stile].toLowerCase()}`} loading="lazy" style={{ width: larghezza, height: "auto", aspectRatio: "210 / 297", border: "1px solid var(--bordo)", borderRadius: 4, display: "block", flex: "none" }} />
  ) : null;
}

// La chat per modificare una copertina (richiesta dell'utente, 13/11/2026), con lo stesso aspetto della «Chat con OMNIA AI» della gara. Compare dopo le
// 6 generazioni. Il cliente sceglie UNA VOLTA la copertina che ritiene migliore (col primo messaggio): da lì la chat lavora solo su quella, e ogni
// richiesta riparte dall'ultima versione consegnata. Ogni copertina nuova arriva nella chat in PNG e PDF e continua la numerazione; al massimo 3, poi la
// chat si chiude. Cosa si può fare lo decide il server (copertina-chat-calcoli.ts e l'azione): qui si mostra soltanto.
export default function CopertinaChat({ garaId, chat }: { garaId: string; chat: ChatVista }) {
  const [testo, setTesto] = useState("");
  // la copertina scelta prima del primo messaggio (nessuna di base: la scelta vale per tutta la chat, va fatta apposta)
  const [scelta, setScelta] = useState("");
  // il logo allegato con la graffetta: tenuto qui (non nel campo del modulo, che React svuota a ogni invio) e aggiunto alla richiesta al momento dell'invio
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPer, setLogoPer] = useState<"cliente" | "stazione">("cliente");
  const logoRef = useRef<File | null>(null);
  const campoFile = useRef<HTMLInputElement>(null);
  const modulo = useRef<HTMLFormElement>(null);
  const corpo = useRef<HTMLDivElement>(null);

  function scegliLogo(file: File | null) {
    logoRef.current = file;
    setLogo(file);
    if (!file && campoFile.current) campoFile.current.value = "";
  }

  const [state, formAction, pending] = useActionState(async (prima: ChatCopertinaState, dati: FormData) => {
    if (logoRef.current) dati.set("allegato", logoRef.current);
    const esito = await inviaRichiestaCopertina(prima, dati);
    // testo e logo restano se la richiesta non è andata a buon fine, per correggerla senza riscriverla
    if (esito.ok) {
      setTesto("");
      scegliLogo(null);
    }
    return esito;
  }, statoIniziale);

  const { stato, sceltaFatta, lavoro } = chat;
  // la copertina su cui si lavora: quella scelta col primo messaggio, poi sempre l'ultima versione consegnata (la decide il server)
  const copertinaInUso = sceltaFatta ? lavoro : (chat.scelte.find((c) => c.id === scelta) ?? null);
  // dopo il primo messaggio la copertina di lavoro deve esserci ancora e avere i file per essere modificata
  const lavoroPerso = sceltaFatta && (!lavoro || !lavoro.modificabile);
  const nessunaScelta = !sceltaFatta && chat.scelte.length === 0;
  const scrivibile = stato.puoScrivere && !lavoroPerso && !nessunaScelta;
  const puoInviare = scrivibile && !pending && copertinaInUso !== null && testo.trim().length > 0;

  // si resta in fondo alla conversazione, come in ogni chat
  useEffect(() => {
    if (corpo.current) corpo.current.scrollTop = corpo.current.scrollHeight;
  }, [chat.messaggi.length, pending]);

  function tasto(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (puoInviare) modulo.current?.requestSubmit();
    }
  }

  const rimaste = stato.modificheRimaste;

  return (
    <section id="copertina-chat" className="omnia-chat" style={{ marginTop: 28 }} aria-labelledby="copertina-chat-titolo">
      <div className="omnia-chat-intestazione" style={{ flexWrap: "wrap" }}>
        <BrandMark stato={pending ? "elaborazione" : "riposo"} width={28} height={28} />
        <div style={{ minWidth: 0, flex: "1 1 180px" }}>
          <h2 id="copertina-chat-titolo">Modifica la copertina in chat</h2>
          <p>Chiedi le modifiche che vuoi: ogni copertina nuova arriva qui, in PNG e PDF. Le domande non consumano copertine.</p>
        </div>
        <span className={`omnia-badge ${rimaste > 0 ? "verde" : "ambra"}`} style={{ marginLeft: "auto" }}>
          {rimaste === 1 ? "1 copertina nuova rimasta" : `${rimaste} copertine nuove rimaste`} su {MODIFICHE_MASSIME}
        </span>
      </div>

      {/* Prima del primo messaggio: si sceglie la copertina migliore. Dopo: si vede su quale si sta lavorando. */}
      {!sceltaFatta && scrivibile && (
        <div className="omnia-chat-nota">
          <strong>1. Scegli la copertina che ritieni migliore.</strong> La chat lavorerà solo su quella e ogni modifica ripartirà dall&apos;ultima versione: dopo il primo messaggio non potrai più cambiarla.
          <div className="omnia-copertina-scelte" role="radiogroup" aria-label="Copertina da modificare">
            {chat.scelte.map((c) => (
              <label key={c.id} className={`omnia-copertina-scelta${scelta === c.id ? " scelta" : ""}`}>
                <Miniatura c={c} larghezza={88} />
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="radio" name="sceltaCopertina" value={c.id} checked={scelta === c.id} onChange={() => setScelta(c.id)} disabled={pending} />
                  {etichettaNumero(c.numero).replace("COPERTINA ", "")}
                </span>
              </label>
            ))}
          </div>
          {copertinaInUso && (
            <p style={{ margin: "10px 0 0" }}>
              <strong>2. Scrivi qui sotto cosa vuoi cambiare</strong> nella {etichettaNumero(copertinaInUso.numero)}.
            </p>
          )}
        </div>
      )}
      {sceltaFatta && lavoro && !lavoroPerso && (
        <div className="omnia-chat-nota omnia-copertina-lavoro">
          <Miniatura c={lavoro} larghezza={46} />
          <span>
            Stai modificando la <strong>{etichettaNumero(lavoro.numero)}</strong>
            {chat.numeroSceltaIniziale !== null && chat.numeroSceltaIniziale !== lavoro.numero ? `, l'ultima versione della ${etichettaNumero(chat.numeroSceltaIniziale)}` : ""}. Ogni richiesta riparte da questa.
          </span>
        </div>
      )}

      <div ref={corpo} className="omnia-chat-corpo" style={{ minHeight: "9rem" }} aria-live="polite">
        {chat.messaggi.length === 0 && !pending && (
          <div className="omnia-chat-vuota" style={{ minHeight: "7rem" }}>
            <p style={{ maxWidth: "46ch" }}>
              Per esempio: «metti il mio logo in alto a destra e più grande», «usa toni blu più scuri nello sfondo», «cambia il sottotitolo in …». Con la graffetta 📎 puoi allegare un logo nuovo.
            </p>
          </div>
        )}
        {chat.messaggi.map((m) => (
          <div key={m.id} className={`omnia-msg-riga ${m.ruolo === "cliente" ? "utente" : "assistente"}`}>
            <div className={`omnia-msg ${m.ruolo === "cliente" ? "utente" : "assistente"}`}>
              {m.ruolo === "cliente" && m.numeroScelta !== null && (
                <p className="omnia-riquadro-nota" style={{ margin: "0 0 4px" }}>
                  Su {etichettaNumero(m.numeroScelta)}
                  {m.allegato ? " · con un logo allegato" : ""}
                </p>
              )}
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.testo}</p>
              {m.inPreparazione && (
                <div style={{ marginTop: 8 }}>
                  <ThinkingIndicator />
                  <p className="omnia-riquadro-nota" style={{ margin: "6px 0 0" }}>
                    Sto preparando la copertina: può richiedere circa un minuto.
                  </p>
                </div>
              )}
              {m.interrotta && (
                <p className="omnia-riquadro-nota" style={{ margin: "6px 0 0" }}>
                  La preparazione si è interrotta e non è stata conteggiata: puoi riprovare.
                </p>
              )}
              {m.copertina && (
                <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <Miniatura c={m.copertina} larghezza={150} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <strong>{etichettaNumero(m.copertina.numero)}</strong>
                    {m.copertina.nomePdf && (
                      <OpenInNewTabButton
                        action={scaricaCopertinaGara}
                        hiddenFields={{ garaId, nomeFile: m.copertina.nomePdf }}
                        label="Scarica il PDF (A4)"
                        pendingLabel="Preparo il file..."
                        className="omnia-btn omnia-btn-verde omnia-btn-piccolo"
                      />
                    )}
                    <OpenInNewTabButton
                      action={scaricaCopertinaGara}
                      hiddenFields={{ garaId, nomeFile: m.copertina.nomePng }}
                      label="Scarica l'immagine (PNG)"
                      pendingLabel="Preparo il file..."
                      className="omnia-btn omnia-btn-s omnia-btn-piccolo"
                    />
                  </div>
                </div>
              )}
              <p className="omnia-msg-ora">{ora(m.quando)}</p>
            </div>
          </div>
        ))}
        {/* mentre si aspetta: il messaggio appena inviato e OMNIA AI che lavora */}
        {pending && (
          <>
            {testo.trim() && (
              <div className="omnia-msg-riga utente">
                <div className="omnia-msg utente">
                  {copertinaInUso && (
                    <p className="omnia-riquadro-nota" style={{ margin: "0 0 4px" }}>
                      Su {etichettaNumero(copertinaInUso.numero)}
                      {logo ? " · con un logo allegato" : ""}
                    </p>
                  )}
                  <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{testo.trim()}</p>
                </div>
              </div>
            )}
            <div className="omnia-msg-riga assistente">
              <div>
                <ThinkingIndicator />
                <p className="omnia-riquadro-nota" style={{ margin: "6px 0 0" }}>
                  Leggo la richiesta e, se serve, preparo la copertina modificata: può richiedere circa un minuto. Non chiudere la pagina.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* chat chiusa o ferma: si dice perché, al posto della barra di scrittura */}
      {!scrivibile && (
        <div className="omnia-chat-input">
          <p className="omnia-messaggio-stato avviso" style={{ margin: 0 }}>
            {!stato.puoScrivere && stato.motivo
              ? stato.motivo
              : lavoroPerso
                ? "La copertina su cui stavi lavorando non si trova più, quindi le modifiche non possono continuare."
                : "Nessuna copertina di questa gara si può modificare: quelle fatte prima che le modifiche in chat fossero disponibili non hanno i file necessari."}
          </p>
        </div>
      )}

      {scrivibile && (
        <form ref={modulo} action={formAction} className="omnia-chat-input">
          <input type="hidden" name="garaId" value={garaId} />
          <input type="hidden" name="copertina" value={copertinaInUso?.id ?? ""} />
          {/* il campo vero del logo è nascosto: lo apre la graffetta */}
          <input
            ref={campoFile}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => scegliLogo(e.target.files?.[0] ?? null)}
            disabled={pending}
            aria-label="Logo nuovo da allegare"
          />
          {logo && (
            <div className="omnia-chat-selezionati" style={{ alignItems: "center" }}>
              <span className="omnia-chat-selezionato">
                🖼️ <span className="nome">{logo.name}</span>
                <button type="button" onClick={() => scegliLogo(null)} disabled={pending} aria-label={`Togli ${logo.name}`}>
                  ✕
                </button>
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                È il logo
                <select name="allegatoPer" className="omnia-select" style={{ width: "auto", padding: "4px 8px", fontSize: 12.5 }} value={logoPer} onChange={(e) => setLogoPer(e.target.value === "stazione" ? "stazione" : "cliente")} disabled={pending}>
                  <option value="cliente">della mia azienda</option>
                  <option value="stazione">della stazione appaltante</option>
                </select>
              </label>
              <span className="omnia-riquadro-nota" style={{ margin: 0, flexBasis: "100%" }}>
                Meglio un PNG con sfondo trasparente (uno sfondo bianco lo togliamo noi).
              </span>
            </div>
          )}
          <div className="omnia-chat-riga">
            <button type="button" onClick={() => campoFile.current?.click()} disabled={pending} title="Allega un logo nuovo (PNG, JPG o WebP)" aria-label="Allega un logo nuovo" className="omnia-chat-allegabutton">
              📎
            </button>
            <textarea
              name="richiesta"
              rows={2}
              value={testo}
              onChange={(e) => setTesto(e.target.value)}
              onKeyDown={tasto}
              maxLength={RICHIESTA_MASSIMA}
              disabled={pending}
              placeholder={
                copertinaInUso
                  ? `Scrivi cosa vuoi cambiare nella ${etichettaNumero(copertinaInUso.numero)}... (Invio per inviare, Maiusc+Invio per andare a capo)`
                  : "Prima scegli qui sopra la copertina migliore, poi scrivi cosa vuoi cambiare..."
              }
              aria-label="Cosa vuoi cambiare nella copertina"
              className="omnia-input"
            />
            <button type="submit" disabled={!puoInviare} className="omnia-btn omnia-btn-p">
              {pending ? "Inviato ✓" : "Invia"}
            </button>
          </div>
          {state.error && !pending && <p className="omnia-messaggio-stato errore">{state.error}</p>}
        </form>
      )}
    </section>
  );
}
