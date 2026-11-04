"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { inviaRichiestaDemo } from "@/app/actions/omnia-ai-demo";
import TurnstileCampo from "@/components/turnstile-campo";
import LinkDemo from "@/components/omnia-ai/link-demo";
import { LINK_PRENOTA_DEMO } from "@/lib/omnia-ai-demo-link";
import { TESTI_MODULO_DEMO } from "@/lib/demo-consensi-calcoli";
import {
  CHIAVE_ATTRIBUZIONE,
  CHIAVE_CONSENSO_COOKIE,
  NOME_CAMPO_CHIAVE,
  NOME_CAMPO_TRAPPOLA,
  NOME_CAMPO_VERSIONE_CONSENSI,
  SETTORI_DEMO,
  VERSIONE_CONSENSI_DEMO,
  cookiePubblicitariAccettati,
  leggiAttribuzioneSalvata,
  valoreCookie,
  validaModuloDemo,
  type CampoModulo,
} from "@/lib/demo-lead-calcoli";

// Modulo della demo: l'unica porta d'ingresso. Dopo l'invio (validato qui e sul server, salvato come richiesta «pending» con la prova
// dei consensi) si apre il calendario Google dove il visitatore sceglie giorno e ora. L'invio del modulo NON è una conversione: conta
// solo la prenotazione vista sul calendario (sincronizzazione sul server).
//
// Il calendario si apre in una scheda aperta SUBITO, nel gesto del clic (il browser blocca un'apertura fatta dopo l'attesa della
// risposta del server), e riempita quando il server ha risposto. Se il server NON ha salvato la richiesta (sistema attivo), la scheda
// si chiude, il calendario non si apre e si mostra un errore da cui si può riprovare: la CHIAVE di idempotenza resta la stessa, così un
// secondo invio dopo una risposta persa non crea una richiesta doppia. Se il browser blocca comunque la scheda, la pagina mostra un
// pulsante «Apri il calendario». Gli eventi di Google Analytics partono solo se il tag è già stato caricato dal banner dei cookie
// (cioè con il consenso): niente consenso, nessun evento. I testi dei consensi vengono da demo-consensi-calcoli.ts (la stessa fonte
// da cui il server calcola l'impronta registrata come prova).

function nuovaChiaveInvio(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // contesto non sicuro: si ripiega sotto
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

type GtagFn = (...argomenti: unknown[]) => void;
function inviaEventoGa(nome: string, parametri: Record<string, string | number>) {
  try {
    const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
    if (typeof gtag === "function") gtag("event", nome, parametri);
  } catch {
    // nessun tag caricato: nessun evento
  }
}

const ERRORI_VUOTI: Partial<Record<CampoModulo, string>> = {};

export default function DemoForm() {
  const [errori, setErrori] = useState<Partial<Record<CampoModulo, string>>>(ERRORI_VUOTI);
  const [errore, setErrore] = useState<string | null>(null);
  const [ricarica, setRicarica] = useState(false);
  const [inviando, setInviando] = useState(false);
  const [inviato, setInviato] = useState(false);
  const [chiaveVerifica, setChiaveVerifica] = useState(0);
  const iniziata = useRef(false);
  // chiave di idempotenza di QUESTO invio logico: nasce al primo invio e resta uguale nei tentativi successivi
  const chiaveInvio = useRef<string | null>(null);

  // «prenotazione iniziata»: la prima volta che la persona tocca un campo (evento secondario di Analytics)
  function alPrimoCampo() {
    if (iniziata.current) return;
    iniziata.current = true;
    inviaEventoGa("demo_booking_start", { form: "demo" });
  }

  async function alInvio(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (inviando) return;
    const modulo = evento.currentTarget;
    const dati = new FormData(modulo);

    const esito = validaModuloDemo(Object.fromEntries(dati.entries()));
    if (!esito.ok) {
      setErrori(esito.errori);
      setErrore(null);
      const primo = (Object.keys(esito.errori) as CampoModulo[])[0];
      modulo.querySelector<HTMLElement>(`[name="${primo}"]`)?.focus();
      return;
    }
    setErrori(ERRORI_VUOTI);
    setErrore(null);
    setRicarica(false);
    setInviando(true);

    // scheda del calendario aperta ora, nel gesto dell'utente; «opener» tolto: è un sito esterno
    const scheda = window.open("about:blank", "_blank");
    if (scheda) scheda.opener = null;

    // prova dei consensi: la versione dei testi mostrati e la chiave di questo invio
    chiaveInvio.current ??= nuovaChiaveInvio();
    dati.set(NOME_CAMPO_CHIAVE, chiaveInvio.current);
    dati.set(NOME_CAMPO_VERSIONE_CONSENSI, VERSIONE_CONSENSI_DEMO);

    // attribuzione pubblicitaria e identificativi di Analytics: solo con i cookie pubblicitari accettati
    try {
      const consenso = cookiePubblicitariAccettati(localStorage.getItem(CHIAVE_CONSENSO_COOKIE));
      dati.set("cookie_ok", consenso ? "1" : "0");
      if (consenso) {
        const salvata = leggiAttribuzioneSalvata(localStorage.getItem(CHIAVE_ATTRIBUZIONE), Date.now());
        if (salvata) dati.set("attribuzione", JSON.stringify(salvata));
        const cookie = document.cookie;
        dati.set("ga_cookie", valoreCookie(cookie, "_ga") ?? "");
        dati.set("ga_sessione", valoreCookie(cookie, "_ga_W551SWPNE4") ?? "");
        dati.set("percorso", window.location.pathname);
      }
    } catch {
      dati.set("cookie_ok", "0");
    }

    try {
      const risposta = await inviaRichiestaDemo(dati);
      if (!risposta.ok) {
        // il calendario NON si apre: la richiesta non è registrata (o i dati non sono validi)
        scheda?.close();
        setErrori(risposta.errori ?? ERRORI_VUOTI);
        setErrore(risposta.errore);
        setRicarica(risposta.ricarica === true);
        setChiaveVerifica((k) => k + 1);
        return;
      }
      inviaEventoGa("demo_lead_submitted", { form: "demo" });
      if (scheda) scheda.location.href = LINK_PRENOTA_DEMO;
      setInviato(true);
    } catch {
      // risposta persa (rete, timeout): la richiesta potrebbe essere stata registrata. Riprovare è sicuro: la chiave resta la stessa.
      scheda?.close();
      setErrore("Non siamo riusciti a inviare la richiesta, il calendario non è stato aperto. Riprova tra un istante: i dati che hai scritto sono ancora qui.");
      setChiaveVerifica((k) => k + 1);
    } finally {
      setInviando(false);
    }
  }

  if (inviato) {
    return (
      <div className="omnia-esito successo">
        <p style={{ margin: 0 }}>
          Richiesta ricevuta. Si è aperto il calendario Google: scegli giorno e ora per la tua demo. La demo è confermata solo quando
          prenoti l&apos;orario.
        </p>
        <p style={{ margin: "14px 0 0" }}>
          Se il calendario non si è aperto, premi qui:
        </p>
        <div className="omnia-azioni" style={{ marginTop: 14, justifyContent: "flex-start" }}>
          <LinkDemo className="omnia-btn omnia-btn-p" testo="Apri il calendario e scegli l'orario" />
        </div>
      </div>
    );
  }

  const errore_campo = (campo: CampoModulo) =>
    errori[campo] ? (
      <p className="omnia-esito errore" role="alert" style={{ margin: "6px 0 0" }}>
        {errori[campo]}
      </p>
    ) : null;

  return (
    <form onSubmit={alInvio} onFocusCapture={alPrimoCampo} className="omnia-modulo" noValidate>
      <div className="omnia-campo-riga">
        <div>
          <label className="omnia-etichetta" htmlFor="nome">
            Nome e cognome
          </label>
          <input className="omnia-input" id="nome" name="nome" type="text" required autoComplete="name" maxLength={120} />
          {errore_campo("nome")}
        </div>
        <div>
          <label className="omnia-etichetta" htmlFor="azienda">
            Nome azienda
          </label>
          <input className="omnia-input" id="azienda" name="azienda" type="text" required autoComplete="organization" maxLength={160} />
          {errore_campo("azienda")}
        </div>
      </div>

      <div className="omnia-campo-riga">
        <div>
          <label className="omnia-etichetta" htmlFor="email">
            Email aziendale
          </label>
          <input className="omnia-input" id="email" name="email" type="email" required autoComplete="email" maxLength={254} />
          {errore_campo("email")}
        </div>
        <div>
          <label className="omnia-etichetta" htmlFor="telefono">
            Telefono
          </label>
          <input className="omnia-input" id="telefono" name="telefono" type="tel" required autoComplete="tel" maxLength={30} />
          {errore_campo("telefono")}
        </div>
      </div>

      <div>
        <label className="omnia-etichetta" htmlFor="settore">
          Settore di attività
        </label>
        <select className="omnia-select" id="settore" name="settore" defaultValue="" required>
          <option value="" disabled>
            Scegli il settore
          </option>
          {SETTORI_DEMO.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {errore_campo("settore")}
      </div>

      {/* campo trappola: nascosto alle persone, un robot lo compila */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor={NOME_CAMPO_TRAPPOLA}>Non compilare questo campo</label>
        <input id={NOME_CAMPO_TRAPPOLA} name={NOME_CAMPO_TRAPPOLA} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--fioco)", margin: "4px 0 0" }}>
        {TESTI_MODULO_DEMO.informativaPrima}
        <Link href="/privacy" target="_blank" style={{ color: "var(--verde)" }}>
          {TESTI_MODULO_DEMO.informativaLink}
        </Link>
        {TESTI_MODULO_DEMO.informativaDopo}
      </p>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "var(--testo)", lineHeight: 1.5 }}>
        <input type="checkbox" name="privacy" required style={{ marginTop: 4 }} />
        <span>{TESTI_MODULO_DEMO.privacy}</span>
      </label>
      {errore_campo("privacy")}

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "var(--fioco)", lineHeight: 1.5 }}>
        <input type="checkbox" name="adsConsenso" style={{ marginTop: 4 }} />
        <span>{TESTI_MODULO_DEMO.ads}</span>
      </label>

      <TurnstileCampo resetKey={chiaveVerifica} tema="dark" />

      {errore && (
        <div className="omnia-esito errore" role="alert">
          <p style={{ margin: 0 }}>{errore}</p>
          {ricarica && (
            <div className="omnia-azioni" style={{ marginTop: 12, justifyContent: "flex-start" }}>
              <button type="button" className="omnia-btn omnia-btn-p" onClick={() => window.location.reload()}>
                Ricarica la pagina
              </button>
            </div>
          )}
        </div>
      )}

      <button type="submit" className="omnia-btn omnia-btn-p" disabled={inviando}>
        {inviando ? "Invio in corso…" : "CONTINUA E PRENOTA LA DEMO"}
      </button>
    </form>
  );
}
