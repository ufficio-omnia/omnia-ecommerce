// Autotest delle sezioni dei servizi aggiuntivi della gara che si possono ridurre a una riga (richiesta dell'utente, 11/11/2026): piano di lavoro, copertina
// della relazione tecnica, revisione umana, OMNIA FOOD MENU. Controlla, senza browser né rete:
//   - le regole (src/lib/servizi-richiudibili.ts): di base APERTE; la scelta di ridurre si ricorda sul dispositivo, riaprendo la chiave si toglie; un
//     valore strano nel browser lascia la sezione aperta; il browser che blocca i dati non fa errori; l'apertura forzata (ritorno da Stripe) vale per la
//     visita senza cancellare la preferenza, e un clic fatto in quella visita vince;
//   - la struttura: tutti e quattro i pannelli usano il riquadro richiudibile con il titolo giusto, il contenuto resta nella pagina (nascosto, non tolto:
//     una generazione in corso continua), il pulsante «Genera» del piano sta solo a sezione aperta, e i due pannelli con pagamento si riaprono al ritorno;
//   - lo stile: solo variabili del tema, niente colori scritti a mano.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  EVENTO_SERVIZI,
  PREFISSO_CHIAVE_SERVIZIO,
  SERVIZI_RICHIUDIBILI,
  chiaveServizio,
  leggiRidotto,
  salvaRidotto,
  sezioneRidotta,
} from "../src/lib/servizi-richiudibili";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

// un localStorage finto
function memoria(iniziale: Record<string, string> = {}) {
  const dati = new Map(Object.entries(iniziale));
  return {
    dati,
    getItem: (k: string) => (dati.has(k) ? (dati.get(k) as string) : null),
    setItem: (k: string, v: string) => void dati.set(k, v),
    removeItem: (k: string) => void dati.delete(k),
  };
}
const bloccata = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

function main() {
  console.log("--- Le regole ---");
  {
    atteso("i servizi richiudibili sono quattro: piano di lavoro, copertina, revisione umana, food menu", SERVIZI_RICHIUDIBILI.join() === "piano_lavoro,copertina,revisione_umana,food_menu");
    atteso("ogni servizio ha la sua chiave, con un prefisso solo del sito", SERVIZI_RICHIUDIBILI.every((s) => chiaveServizio(s) === `${PREFISSO_CHIAVE_SERVIZIO}${s}`) && new Set(SERVIZI_RICHIUDIBILI.map(chiaveServizio)).size === 4 && PREFISSO_CHIAVE_SERVIZIO.startsWith("omnia-ai:"));

    const vuota = memoria();
    atteso("di base le sezioni sono APERTE (nessuna preferenza salvata)", SERVIZI_RICHIUDIBILI.every((s) => !leggiRidotto(vuota, s)) && !leggiRidotto(null, "copertina"));

    const m = memoria();
    atteso("ridurre una sezione la salva, solo per quel servizio", salvaRidotto(m, "copertina", true) && leggiRidotto(m, "copertina") && !leggiRidotto(m, "piano_lavoro") && m.dati.size === 1);
    atteso("riaprirla toglie la chiave: nel browser resta soltanto ciò che l'utente ha ridotto", salvaRidotto(m, "copertina", false) && !leggiRidotto(m, "copertina") && m.dati.size === 0);
    atteso("più servizi ridotti insieme restano indipendenti", (() => { const x = memoria(); salvaRidotto(x, "copertina", true); salvaRidotto(x, "piano_lavoro", true); salvaRidotto(x, "copertina", false); return leggiRidotto(x, "piano_lavoro") && !leggiRidotto(x, "copertina"); })());
    atteso(
      "un valore strano, vuoto o di un'altra versione NON riduce la sezione (solo «1» vale)",
      ["", "0", "true", "chiuso", "ridotto", " 1", "2"].every((v) => !leggiRidotto(memoria({ [chiaveServizio("copertina")]: v }), "copertina")),
    );
    atteso("il browser che blocca i dati del sito: nessun errore, sezione aperta, e si dice che non si è salvato", !leggiRidotto(bloccata, "copertina") && salvaRidotto(bloccata, "copertina", true) === false && salvaRidotto(bloccata, "copertina", false) === false && salvaRidotto(null, "copertina", true) === false);
    atteso("l'evento che avvisa le altre sezioni e le altre schede ha un nome proprio", /^omnia-ai:/.test(EVENTO_SERVIZI) && !EVENTO_SERVIZI.startsWith(PREFISSO_CHIAVE_SERVIZIO));
  }

  console.log("--- Com'è la sezione adesso ---");
  {
    const v = (salvato: boolean, scelta: boolean | null, forza: boolean) => sezioneRidotta({ salvato, sceltaInQuestaVisita: scelta, forzaApertura: forza });
    atteso("senza preferenza e senza clic: aperta; con preferenza «ridotta»: ridotta", v(false, null, false) === false && v(true, null, false) === true);
    atteso("apertura forzata (ritorno da Stripe): aperta anche se la preferenza è «ridotta», e la preferenza non si tocca", v(true, null, true) === false && v(false, null, true) === false);
    atteso("un clic fatto in questa visita vince sempre: anche sull'apertura forzata (si può richiudere subito) e sulla preferenza (si può riaprire)", v(true, false, false) === false && v(false, true, false) === true && v(true, true, true) === true && v(true, false, true) === false);
    // tutte le 8 combinazioni, contro la regola scritta a parole
    const attese = [false, true].flatMap((salvato) => [null, false, true].flatMap((scelta) => [false, true].map((forza) => ({ salvato, scelta, forza }))));
    atteso(
      "tutte le combinazioni seguono la regola: prima il clic, poi l'apertura forzata, poi la preferenza",
      attese.every(({ salvato, scelta, forza }) => v(salvato, scelta, forza) === (scelta !== null ? scelta : forza ? false : salvato)),
    );
  }

  console.log("--- La struttura dei pannelli ---");
  {
    const cartella = "src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]";
    const riquadro = leggi(`${cartella}/servizio-richiudibile.tsx`);
    const copertina = leggi(`${cartella}/copertina-panel.tsx`);
    const piano = leggi(`${cartella}/piano-lavoro-panel.tsx`);
    const revisione = leggi(`${cartella}/revisione-panel.tsx`);
    const food = leggi(`${cartella}/food-menu-panel.tsx`);
    const pagina = leggi(`${cartella}/page.tsx`);

    atteso("il riquadro è un componente client e usa le regole di src/lib/servizi-richiudibili.ts", /^"use client";/.test(riquadro) && /from "@\/lib\/servizi-richiudibili"/.test(riquadro) && /sezioneRidotta\(\{ salvato, sceltaInQuestaVisita, forzaApertura \}\)/.test(riquadro));
    atteso("il titolo è un pulsante accessibile: aria-expanded, aria-controls, apri/riduci a parole", /aria-expanded=\{!ridotta\}/.test(riquadro) && /aria-controls=\{idCorpo\}/.test(riquadro) && /type="button"/.test(riquadro) && /Apri la sezione/.test(riquadro) && /Riduci la sezione/.test(riquadro) && /aria-labelledby=\{titoloId\}/.test(riquadro));
    atteso("il contenuto resta nella pagina, solo nascosto (hidden): una generazione in corso continua e i campi non si perdono", /className="omnia-servizio-corpo" hidden=\{ridotta\}/.test(riquadro) && !/\{!ridotta && children\}|ridotta \? null : children/.test(riquadro));
    atteso("la scelta si salva SOLO dopo un clic (nessuna scrittura al caricamento) e avvisa le altre sezioni", /function alterna\(\)[\s\S]*salvaRidotto\([\s\S]*dispatchEvent\(new Event\(EVENTO_SERVIZI\)\)/.test(riquadro) && !/useEffect/.test(riquadro));
    atteso("il server non conosce il browser: l'HTML iniziale è «aperta» (useSyncExternalStore con snapshot del server = false)", /useSyncExternalStore\(\s*iscriviti,[\s\S]*\(\) => false,\s*\)/.test(riquadro));
    atteso("a sezione ridotta si vede il riepilogo, e i pulsanti della testata si nascondono", /ridotta && riepilogo/.test(riquadro) && /\{!ridotta && azioni\}/.test(riquadro));

    atteso("i quattro pannelli usano il riquadro richiudibile (e non più la sezione scritta a mano)", [copertina, piano, revisione, food].every((s) => /import ServizioRichiudibile from "\.\/servizio-richiudibile"/.test(s) && /<ServizioRichiudibile\b/.test(s) && !/<section className="omnia-riquadro"/.test(s)));
    atteso(
      "ognuno con il suo servizio, il suo titolo e lo stesso id del titolo di prima (aria-labelledby)",
      /id="copertina" titoloId="copertina-titolo" titolo="Copertina relazione tecnica"/.test(copertina) &&
        /id="piano_lavoro" titoloId="piano-lavoro-titolo" titolo="Piano di lavoro"/.test(piano) &&
        /id="revisione_umana" titoloId="revisione-umana-titolo" titolo="Revisione umana"/.test(revisione) &&
        /id="food_menu" titoloId="food-menu-titolo"/.test(food),
    );
    atteso("ogni id di servizio usato esiste nell'elenco delle regole", [copertina, piano, revisione, food].every((s) => SERVIZI_RICHIUDIBILI.some((id) => new RegExp(`<ServizioRichiudibile id="${id}"`).test(s))));
    atteso("tutti i pannelli chiudono il riquadro nuovo (apertura e chiusura in pari)", [copertina, piano, revisione, food].every((s) => (s.match(/<ServizioRichiudibile\b/g) ?? []).length === 1 && (s.match(/<\/ServizioRichiudibile>/g) ?? []).length === 1));

    atteso("il piano di lavoro: il pulsante «Genera» passa come azione della testata (si vede solo a sezione aperta), con la frase di stato per la sezione ridotta", /azioni=\{azioni\}/.test(piano) && /const azioni = puoGenerare \?/.test(piano) && /generazione in corso…/.test(piano) && /nessun piano ancora/.test(piano) && /piani pronti/.test(piano));
    atteso("la copertina: frase di stato (in corso, N generate, acquistata, nessuna ancora) e un solo modulo di generazione dentro il riquadro", /generazione in corso…/.test(copertina) && /copertine generate/.test(copertina) && /acquistata, nessuna copertina ancora/.test(copertina) && /nessuna copertina ancora/.test(copertina) && (copertina.match(/<form action=\{formAction\}>/g) ?? []).length === 1);
    atteso("la revisione umana: frase di stato, e l'Ufficio Gare non vede il prezzo nemmeno da ridotta", /revisione già richiesta/.test(revisione) && /prezzo && !ufficioGare \?/.test(revisione) && /non ancora richiesta/.test(revisione));
    atteso("dopo il ritorno da Stripe piano di lavoro e copertina restano aperti anche se ridotti (il cliente deve leggere l'esito del pagamento)", /forzaApertura=\{ritorno !== null\}/.test(copertina) && /forzaApertura=\{ritorno !== null\}/.test(piano));
    atteso("la pagina della gara non cambia: passa ai pannelli gli stessi dati di prima (nessun ritocco ai diritti o ai prezzi)", /<PianoLavoroPanel garaId=\{gara\.id\} piani=\{pianiLavoro\} diritto=\{dirittoPianoLavoro\}/.test(pagina) && /<CopertinaPanel garaId=\{gara\.id\} \{\.\.\.copertinaPannello\}/.test(pagina) && /<RevisionePanel garaId=\{gara\.id\} esito=\{esitoRevisione\}/.test(pagina) && /<FoodMenuPanel \/>/.test(pagina));
    atteso("la chat e il resto della gara NON sono richiudibili (solo i servizi aggiuntivi)", !/ServizioRichiudibile/.test(leggi(`${cartella}/chat-section.tsx`)) && !/ServizioRichiudibile/.test(leggi(`${cartella}/extraction-section.tsx`)) && !/ServizioRichiudibile/.test(pagina));
  }

  console.log("--- Lo stile ---");
  {
    const css = leggi("src/app/site-omnia-ai/omnia-ai.css");
    const inizio = css.indexOf(".omnia-servizio-titolo {");
    const fine = css.indexOf("@media (prefers-reduced-motion: reduce)", inizio);
    const blocco = inizio >= 0 && fine > inizio ? css.slice(inizio, fine + 120) : "";
    atteso("lo stile del riquadro richiudibile esiste", blocco.length > 0 && /\.omnia-servizio\.ridotto/.test(blocco) && /\.omnia-servizio-corpo\[hidden\]/.test(blocco) && /\.omnia-servizio-riepilogo/.test(blocco));
    atteso("solo variabili del tema: nessun colore scritto a mano (tema chiaro e scuro restano coerenti)", !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(blocco) && /var\(--fioco\)/.test(blocco) && /var\(--testo\)/.test(blocco));
    atteso("chi preferisce meno animazioni non vede la freccia ruotare piano", /prefers-reduced-motion: reduce[\s\S]*transition: none/.test(css.slice(fine, fine + 200)));
    atteso("un contenuto nascosto non occupa spazio nemmeno se un altro stile gli dà un display", /\.omnia-servizio-corpo\[hidden\] \{\s*display: none;/.test(blocco));
  }

  if (fallimenti.length) {
    console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sulle sezioni richiudibili sono superati.");
}

main();
