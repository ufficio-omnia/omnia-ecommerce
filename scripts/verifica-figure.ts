// Autotest delle figure schematiche (archetipi): gratuito, nessuna chiamata a
// modelli né al database, gira insieme al livello 1 (npm run verifica:livello1,
// quindi in prebuild).
//
// Le figure non sono immagini scritte dal modello ma DATI: il modello dichiara
// contenuto e relazioni, il codice decide colori, posizioni, numerazione e
// (per il cruscotto) se la figura si può disegnare. Qui si prova: la lettura
// difensiva di ciò che dichiara il modello; i controlli (cruscotto, R8, R9,
// numerazione); il layout di ogni archetipo (niente fuori dal disegno, niente
// caselle sovrapposte, solo colori ammessi, contrasto del testo, adattamento a
// testi lunghi); regole fisse del cruscotto (striscia, «Rilevato» sempre
// trattino, rosso solo nel semaforo); il disegno vero su canvas con i tre font;
// che compressione ed espansione non possano toccare le figure; il Word (immagine
// e didascalia «Figura N» numerata dal codice); e il collegamento ai punti di
// produzione.
import fs from "fs";
import path from "path";
import {
  ARCHETIPI,
  campiDiTestoFigura,
  figureInvariate,
  inserisciFigure,
  leggiBloccoFigura,
  leggiFiguraModello,
  mascheraFigure,
  ripristinaFigure,
  serializzaBloccoFigura,
  trovaSegnapostiFigura,
  type DatiFigura,
} from "../src/lib/figure-dati";
import { SCHEMA_FIGURE_STRUMENTO } from "../src/lib/figure-schema-strumento";
import { costruisciFigure, leggiFunzioniPiattaforma, motivoCruscottoNonDisegnabile, pulisciDidascalia, testoFigureNelPrompt, type FattiFigure } from "../src/lib/figure-contesto";
import { calcolaLayoutFigura, altezzaStimataFigura } from "../src/lib/figure-layout";
import { avvolgi, C, contrasto, misuraApprossimata, type LayoutFigura, type Prim } from "../src/lib/figure-base";
import { COLORE_PIENO } from "../src/lib/colori-semantici";
import { disegnaFigura } from "../src/lib/figura-disegno";
import { stimaPagineContenuto, stimaPagineFigura } from "../src/lib/stima-pagine";
import { espandiBloccoConGaranzie, type RichiestaEspansione } from "../src/lib/espansione-mirata";
import { buildDocxBuffer } from "../src/lib/docx-generator";
import { STRISCIA_ILLUSTRATIVA } from "../src/lib/figura-cruscotto-layout";
import { passoAsse } from "../src/lib/figura-cronoprogramma-layout";
import { trovaRigheConRiferimentiEconomici } from "../src/lib/riferimenti-economici";
import { assegnaIconeMancanti } from "../src/lib/densita-visiva";
import { applicaGuardiaValori } from "../src/lib/valori-impresa";
import { estraiFigureDocumento, estraiSorgenteFigure, abbinaSorgente, verificaFigure } from "./lib/immagini-relazione";
import { tuttiGliEsempiFigure, cruscottoCompleto } from "./lib/figure-esempio";
import { figureEstreme } from "./lib/figure-estreme";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require("jszip");

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggiFile = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const FATTI_CON_PIATTAFORMA: FattiFigure = { piattaforma: "Piattaforma Esempio", funzioniPiattaforma: ["Cruscotto indicatori in tempo reale", "Segnalazione non conformità"] };
const FATTI_SENZA: FattiFigure = { piattaforma: null, funzioniPiattaforma: [] };

const FLUSSO_VALIDO = {
  archetipo: "flusso",
  didascalia: "Il processo si chiude solo dopo la verifica dell'efficacia.",
  flusso: { stadi: [{ tipo: "passo", titolo: "Segnalazione" }, { tipo: "passo", titolo: "Correzione" }, { tipo: "passo", titolo: "Verifica" }], ritorno: { da: 3, a: 2, etichetta: "non efficace" } },
};

const RECT = (p: Prim): p is Extract<Prim, { t: "rect" }> => p.t === "rect";
const nomiEsempi = Object.keys(tuttiGliEsempiFigure);

// Colori ammessi nelle figure: neutri, primario e sue tinte, semantici R20,
// più il rosso (solo nel semaforo del cruscotto, controllato a parte).
const AMMESSI = new Set<string>(
  [C.bianco, C.navy, C.testoScuro, C.testoBlu, C.dettaglioBlu, C.linea, C.lineaScura, C.grigioTesto, C.bandaFill, C.bandaBordo, C.neutroFill, C.bannerFill, C.primario, C.sicurezza, C.ambiente, C.rosso].map((c) => c.toUpperCase()),
);
// Una tinta del primario sta sulla retta fra il primario e il bianco: stessa
// frazione di schiarimento su tutti e tre i canali.
function eTintaDelPrimario(hex: string): boolean {
  const canale = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  const frazioni = [0, 1, 2].map((i) => (canale(hex, i) - canale(C.primario, i)) / (255 - canale(C.primario, i)));
  return frazioni.every((f) => f >= -0.01 && f <= 1.01 && Math.abs(f - frazioni[0]) < 0.02);
}

function fuoriDalDisegno(layout: LayoutFigura): string[] {
  const fuori: string[] = [];
  for (const r of layout.prims.filter(RECT)) {
    if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > layout.larghezza + 0.5 || r.y + r.h > layout.altezza + 0.5) fuori.push(`rect ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`);
  }
  for (const p of layout.prims) {
    if (p.t === "testo") {
      const w = misuraApprossimata(p.testo, p.size, p.bold);
      const x0 = p.ancora === "centro" ? p.x - w / 2 : p.ancora === "fine" ? p.x - w : p.x;
      if (x0 < 1 || x0 + w > layout.larghezza - 1 || p.y < 0 || p.y > layout.altezza) fuori.push(`testo «${p.testo.slice(0, 25)}»`);
    }
    if (p.t === "linea") for (const [x, y] of p.punti) if (x < 0 || y < 0 || x > layout.larghezza || y > layout.altezza) fuori.push("linea fuori");
    if (p.t === "cerchio" && (p.cx - p.r < 0 || p.cy - p.r < 0 || p.cx + p.r > layout.larghezza || p.cy + p.r > layout.altezza)) fuori.push("cerchio fuori");
  }
  return fuori;
}

function caselleSovrapposte(layout: LayoutFigura): string[] {
  const caselle = layout.prims.filter(RECT).filter((r) => (r.r ?? 0) >= 5);
  const contiene = (a: (typeof caselle)[number], b: (typeof caselle)[number]) => a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.w >= b.x + b.w - 0.5 && a.y + a.h >= b.y + b.h - 0.5;
  const sovrapposte: string[] = [];
  for (let i = 0; i < caselle.length; i++) {
    for (let j = i + 1; j < caselle.length; j++) {
      const a = caselle[i];
      const b = caselle[j];
      const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (dx > 1 && dy > 1 && !contiene(a, b) && !contiene(b, a)) sovrapposte.push(`${Math.round(a.x)},${Math.round(a.y)} × ${Math.round(b.x)},${Math.round(b.y)}`);
    }
  }
  return sovrapposte;
}

// Un collegamento non deve passare DENTRO una casella: un tratto che attraversa
// l'interno di un rettangolo arrotondato (ristretto di 3 unità, perché le frecce
// finiscono sul bordo) è un errore di instradamento.
function lineeCheAttraversanoCaselle(layout: LayoutFigura): string[] {
  const caselle = layout.prims.filter(RECT).filter((r) => (r.r ?? 0) >= 6 && r.w > 40 && r.h > 20);
  const errori: string[] = [];
  for (const p of layout.prims) {
    if (p.t !== "linea") continue;
    for (let i = 0; i + 1 < p.punti.length; i++) {
      const [x1, y1] = p.punti[i];
      const [x2, y2] = p.punti[i + 1];
      for (const r of caselle) {
        const xa = r.x + 3, xb = r.x + r.w - 3, ya = r.y + 3, yb = r.y + r.h - 3;
        // tratti solo orizzontali o verticali: l'intervallo del tratto interseca l'interno?
        const orizzontale = Math.abs(y1 - y2) < 0.5;
        const verticale = Math.abs(x1 - x2) < 0.5;
        const taglia = orizzontale
          ? y1 > ya && y1 < yb && Math.max(x1, x2) > xa && Math.min(x1, x2) < xb
          : verticale
            ? x1 > xa && x1 < xb && Math.max(y1, y2) > ya && Math.min(y1, y2) < yb
            : false;
        if (taglia) errori.push(`linea (${Math.round(x1)},${Math.round(y1)})→(${Math.round(x2)},${Math.round(y2)}) dentro la casella ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`);
      }
    }
  }
  return errori;
}

// Per ogni testo, lo sfondo è l'ultimo riempimento disegnato che ne contiene il
// centro (bianco se nessuno): il contrasto con il colore del testo deve essere
// almeno 3:1 — mai chiaro su chiaro né scuro su scuro.
function contrastiInsufficienti(layout: LayoutFigura): string[] {
  const bassi: string[] = [];
  layout.prims.forEach((p, i) => {
    if (p.t !== "testo") return;
    const w = misuraApprossimata(p.testo, p.size, p.bold);
    const cx = p.ancora === "centro" ? p.x : p.ancora === "fine" ? p.x - w / 2 : p.x + w / 2;
    let fondo: string = C.bianco;
    for (let k = 0; k < i; k++) {
      const q = layout.prims[k];
      if (q.t === "rect" && q.fill && cx >= q.x && cx <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h) fondo = q.fill;
      else if (q.t === "cerchio" && q.fill && Math.hypot(cx - q.cx, p.y - q.cy) <= q.r) fondo = q.fill;
    }
    const c = contrasto(p.colore, fondo);
    if (c < 3) bassi.push(`«${p.testo.slice(0, 22)}» ${p.colore} su ${fondo} = ${c.toFixed(2)}`);
  });
  return bassi;
}

async function main() {
  // --- 1. Lettura difensiva ---
  {
    atteso("input non oggetto: nessun errore, figura scartata con avviso", (() => { const r = leggiFiguraModello("testo"); return r.figura === null && r.avvisi.length > 0; })());
    atteso("archetipo sconosciuto: scartata", leggiFiguraModello({ ...FLUSSO_VALIDO, archetipo: "torta" }).figura === null);
    atteso("senza didascalia: scartata (la didascalia dice cosa dimostra)", leggiFiguraModello({ ...FLUSSO_VALIDO, didascalia: "  " }).figura === null);
    const ok = leggiFiguraModello(FLUSSO_VALIDO);
    atteso("flusso valido: letto, ritorno convertito da 1-based a indici", ok.figura?.archetipo === "flusso" && ok.figura.flusso.ritorno?.da === 2 && ok.figura.flusso.ritorno?.a === 1, JSON.stringify(ok.figura));
    const ritornoSbagliato = leggiFiguraModello({ ...FLUSSO_VALIDO, flusso: { ...FLUSSO_VALIDO.flusso, ritorno: { da: 1, a: 3 } } });
    atteso("ritorno che va avanti invece che a monte: scartato con avviso, la figura resta", ritornoSbagliato.figura?.archetipo === "flusso" && !ritornoSbagliato.figura.flusso.ritorno && ritornoSbagliato.avvisi.some((a) => /Ritorno/.test(a)));
    atteso("flusso con un solo stadio: scartato", leggiFiguraModello({ ...FLUSSO_VALIDO, flusso: { stadi: [{ tipo: "passo", titolo: "Solo" }] } }).figura === null);
    const tanti = leggiFiguraModello({ ...FLUSSO_VALIDO, flusso: { stadi: Array.from({ length: 20 }, (_, i) => ({ tipo: "passo", titolo: `Passo ${i}` })) } });
    atteso("più di 12 stadi: i restanti non si disegnano, con avviso", tanti.figura?.archetipo === "flusso" && tanti.figura.flusso.stadi.length === 12 && tanti.avvisi.length > 0);
    const alternativeUnRamo = leggiFiguraModello({ ...FLUSSO_VALIDO, flusso: { stadi: [{ tipo: "passo", titolo: "A" }, { tipo: "alternative", rami: [{ titolo: "x" }] }, { tipo: "passo", titolo: "B" }] } });
    atteso("alternative con un solo ramo: lo stadio è scartato", alternativeUnRamo.figura?.archetipo === "flusso" && alternativeUnRamo.figura.flusso.stadi.length === 2);
    const colori = leggiFiguraModello({ ...FLUSSO_VALIDO, flusso: { stadi: [{ tipo: "passo", titolo: "A", semantico: "SICUREZZA", colore: "#FF0000" }, { tipo: "passo", titolo: "B", semantico: "ROSSO" }] } });
    atteso("un colore scritto dal modello è ignorato; un tipo semantico sconosciuto cade", colori.figura?.archetipo === "flusso" && colori.figura.flusso.stadi[0].tipo === "passo" && !JSON.stringify(colori.figura).includes("FF0000") && !JSON.stringify(colori.figura).includes("ROSSO"));

    // Forme che il modello vero ha prodotto: i campi dell'archetipo al livello della figura, o l'elenco dei livelli al posto dell'oggetto.
    const piatto = leggiFiguraModello({ archetipo: "flusso", didascalia: "d", stadi: [{ tipo: "passo", titolo: "A" }, { tipo: "passo", titolo: "B" }], ritorno: { da: 2, a: 1 }, numerato: true });
    atteso("lettura tollerante: i campi del flusso scritti accanto all'archetipo si recuperano", piatto.figura?.archetipo === "flusso" && piatto.figura.flusso.stadi.length === 2 && piatto.figura.flusso.numerato === true && piatto.figura.flusso.ritorno?.a === 0, JSON.stringify(piatto));
    const livelliElencoDiretto = leggiFiguraModello({ archetipo: "livelli", didascalia: "d", livelli: [{ titolo: "A" }, { titolo: "B" }], banda: { titolo: "Principio" } });
    atteso("lettura tollerante: «livelli» come elenco al posto dell'oggetto", livelliElencoDiretto.figura?.archetipo === "livelli" && livelliElencoDiretto.figura.livelli.livelli.length === 2 && livelliElencoDiretto.figura.livelli.banda?.titolo === "Principio", JSON.stringify(livelliElencoDiretto));
    const cronoPiatto = leggiFiguraModello({ archetipo: "cronoprogramma", didascalia: "d", unita: "giorni", righe: [{ titolo: "A", barre: [{ da: 0, a: 2 }] }] });
    const retePiatta = leggiFiguraModello({ archetipo: "rete", didascalia: "d", centro: { titolo: "C" }, nodi: [{ titolo: "A" }, { titolo: "B" }] });
    atteso("lettura tollerante: anche cronoprogramma e rete", cronoPiatto.figura?.archetipo === "cronoprogramma" && retePiatta.figura?.archetipo === "rete");
    atteso("a capo: «Operatore/Supervisore» si spezza dopo la barra, non a metà parola", (() => { const r = avvolgi("Operatore/Supervisore", 80, 12, false, misuraApprossimata, 2); return r.length === 2 && r[0] === "Operatore/" && r[1] === "Supervisore"; })());
    atteso("a capo: un numero resta unito all'unità e l'asterisco alla parola prima", (() => { const r = avvolgi("Servizi continui entro 4 h *", 130, 12, false, misuraApprossimata, 3); return r.every((riga) => !/^(h|\*|h \*)$/.test(riga)) && r.join(" ").includes("4 h *"); })());

    const liv = leggiFiguraModello({ archetipo: "livelli", didascalia: "d", livelli: { livelli: [{ titolo: "Operativo" }] } });
    atteso("livelli: servono almeno due livelli", liv.figura === null);
    const pannelloFlusso = leggiFiguraModello({ archetipo: "livelli", didascalia: "d", livelli: { livelli: [{ titolo: "L1" }, { titolo: "L2" }], pannello: { titolo: "P", forma: "flusso", flusso: FLUSSO_VALIDO.flusso } } });
    atteso("livelli con pannello a flusso: letto", pannelloFlusso.figura?.archetipo === "livelli" && pannelloFlusso.figura.livelli.pannello?.flusso?.stadi.length === 3);
    const pannelloVuoto = leggiFiguraModello({ archetipo: "livelli", didascalia: "d", livelli: { livelli: [{ titolo: "L1" }, { titolo: "L2" }], pannello: { titolo: "P", forma: "elenco", voci: [] } } });
    atteso("pannello a elenco senza voci: omesso, la figura resta", pannelloVuoto.figura?.archetipo === "livelli" && !pannelloVuoto.figura.livelli.pannello);

    const crono = leggiFiguraModello({ archetipo: "cronoprogramma", didascalia: "d", cronoprogramma: { unita: "minuti", durata: 10, righe: [{ titolo: "A", barre: [{ da: 8, a: 2 }, { da: 3, a: 15 }] }] } });
    atteso("cronoprogramma: barra invertita raddrizzata, durata allargata alla barra più lunga", crono.figura?.archetipo === "cronoprogramma" && crono.figura.cronoprogramma.durata === 15 && crono.figura.cronoprogramma.righe[0].barre[0].da === 2, JSON.stringify(crono.figura));
    atteso("cronoprogramma senza attività valide: scartato", leggiFiguraModello({ archetipo: "cronoprogramma", didascalia: "d", cronoprogramma: { unita: "giorni", righe: [{ titolo: "A", barre: [] }] } }).figura === null);
    const unitaStrana = leggiFiguraModello({ archetipo: "cronoprogramma", didascalia: "d", cronoprogramma: { unita: "lustri", durata: 4, righe: [{ titolo: "A", barre: [{ da: 0, a: 2 }] }] } });
    atteso("cronoprogramma: unità sconosciuta → settimane", unitaStrana.figura?.archetipo === "cronoprogramma" && unitaStrana.figura.cronoprogramma.unita === "settimane");

    const cr = leggiFiguraModello({ archetipo: "cruscotto", didascalia: "d", cruscotto: { profilo: "Responsabile", piattaforma: "Inventata", rilevato: "99%", indicatori: [{ etichetta: "A", obiettivo: "≥ 99 %", rilevato: "98" }], righe: [{ indicatore: "A", obiettivo: "1", stato: "scostamento", rilevato: "0,5" }, { indicatore: "B", obiettivo: "2", stato: "viola" }] } });
    const crJson = JSON.stringify(cr.figura);
    atteso("cruscotto: la piattaforma e ogni «rilevato» scritti dal modello sono ignorati", cr.figura?.archetipo === "cruscotto" && !crJson.includes("Inventata") && !/rilevato/i.test(crJson) && !crJson.includes("98") && !crJson.includes("0,5"), crJson);
    atteso("cruscotto: stato sconosciuto scartato, stato valido tenuto", cr.figura?.archetipo === "cruscotto" && cr.figura.cruscotto.righe[0].stato === "scostamento" && cr.figura.cruscotto.righe[1].stato === undefined);
    atteso("cruscotto con una sola riga: scartato", leggiFiguraModello({ archetipo: "cruscotto", didascalia: "d", cruscotto: { profilo: "P", righe: [{ indicatore: "A", obiettivo: "1" }] } }).figura === null);

    const rete = leggiFiguraModello({ archetipo: "rete", didascalia: "d", rete: { centro: { titolo: "Piattaforma" }, nodi: [{ titolo: "Sede A" }, { titolo: "Sede B" }], collegamento: "strano" } });
    atteso("rete: collegamento sconosciuto ignorato (predefinito)", rete.figura?.archetipo === "rete" && rete.figura.rete.collegamento === undefined);
    atteso("rete con un solo nodo: scartata", leggiFiguraModello({ archetipo: "rete", didascalia: "d", rete: { centro: { titolo: "P" }, nodi: [{ titolo: "A" }] } }).figura === null);

    const sporco = leggiFiguraModello({ archetipo: "flusso", didascalia: "  Una [frase]\nsu due righe  ", flusso: { stadi: [{ tipo: "passo", titolo: "  A [x]\n  " }, { tipo: "passo", titolo: "B" }] } });
    atteso("testi puliti da parentesi quadre e a capo", !!sporco.figura && campiDiTestoFigura(sporco.figura).every((c) => !/[[\]\n]/.test(c.leggi())) && campiDiTestoFigura(sporco.figura).length >= 3, JSON.stringify(sporco.figura));
  }

  // --- 2. Costruzione: cruscotto, R8, R9, numerazione, limiti ---
  {
    const cruscottoGrezzo = { archetipo: "cruscotto", didascalia: "d", cruscotto: { profilo: "Responsabile", indicatori: [], righe: [{ indicatore: "A", obiettivo: "x" }, { indicatore: "B", obiettivo: "y" }] } };
    const senza = costruisciFigure([cruscottoGrezzo], FATTI_SENZA);
    atteso("cruscotto senza piattaforma nel profilo: NON disegnato, con avviso che dice cosa compilare", senza.blocchi[0] === null && /profilo azienda/.test(senza.avvisi.join(" ")), senza.avvisi.join(" | "));
    const soloNome = costruisciFigure([cruscottoGrezzo], { piattaforma: "P", funzioniPiattaforma: [] });
    atteso("cruscotto con piattaforma ma senza funzioni dichiarate: NON disegnato", soloNome.blocchi[0] === null && /funzioni/.test(soloNome.avvisi.join(" ")));
    const funzioniEstranee = costruisciFigure([cruscottoGrezzo], { piattaforma: "P", funzioniPiattaforma: ["Gestione dei turni", "Timbratura"] });
    atteso("cruscotto con funzioni senza cruscotto/indicatori/report: NON disegnato", funzioniEstranee.blocchi[0] === null && !!motivoCruscottoNonDisegnabile({ piattaforma: "P", funzioniPiattaforma: ["Timbratura"] }));
    const con = costruisciFigure([cruscottoGrezzo], FATTI_CON_PIATTAFORMA);
    const datiCon = con.figure[0];
    atteso("cruscotto con piattaforma e funzione di cruscotto: disegnato, piattaforma scritta dal codice", datiCon?.archetipo === "cruscotto" && datiCon.cruscotto.piattaforma === "Piattaforma Esempio" && !!con.blocchi[0], con.avvisi.join(" | "));
    atteso("funzioni del profilo: una per riga, senza elenchi puntati, al massimo 12", leggiFunzioniPiattaforma("- Cruscotto\n• Report\n\n  Timbratura  ").join("|") === "Cruscotto|Report|Timbratura" && leggiFunzioniPiattaforma(Array.from({ length: 30 }, (_, i) => `f${i}`).join("\n")).length === 12 && leggiFunzioniPiattaforma(null).length === 0);

    const numerata = costruisciFigure([{ ...FLUSSO_VALIDO, didascalia: "Figura 3 — il processo si chiude dopo la verifica." }], FATTI_SENZA);
    atteso("didascalia: il numero scritto dal modello si toglie, la frase resta", numerata.figure[0]?.didascalia === "Il processo si chiude dopo la verifica.", numerata.figure[0]?.didascalia);
    atteso("pulisciDidascalia: «Fig. 2:» e «Figura 10)» tolti; senza numero invariata", pulisciDidascalia("Fig. 2: Un flusso") === "Un flusso" && pulisciDidascalia("Figura 10) ciò che dimostra") === "Ciò che dimostra" && pulisciDidascalia("Un flusso senza numero") === "Un flusso senza numero");

    const economico = costruisciFigure([{ ...FLUSSO_VALIDO, flusso: { stadi: [{ tipo: "passo", titolo: "Intervento senza oneri aggiuntivi per la stazione appaltante" }, { tipo: "passo", titolo: "Verifica" }] } }], FATTI_SENZA);
    atteso("R8: un riferimento economico in una figura la fa scartare (i dati strutturati non si riformulano)", economico.blocchi[0] === null && /economic/.test(economico.avvisi.join(" ")), economico.avvisi.join(" | "));

    const evidenzaVuota = { dipendenti: 8, uscente: [], fatti: [], testi: [] };
    const conValore = costruisciFigure([{ ...FLUSSO_VALIDO, flusso: { stadi: [{ tipo: "passo", titolo: "Presa in carico", dettaglio: "squadra di 12 addetti" }, { tipo: "passo", titolo: "Chiusura" }] } }], FATTI_SENZA, { evidenza: evidenzaVuota });
    const dettaglio = conValore.figure[0]?.archetipo === "flusso" && conValore.figure[0].flusso.stadi[0].tipo === "passo" ? conValore.figure[0].flusso.stadi[0].dettaglio : undefined;
    atteso("R9: un valore numerico senza riscontro in una figura riceve l'asterisco", /12 addetti \*/.test(dettaglio ?? ""), dettaglio);
    const conRiscontro = costruisciFigure([{ ...FLUSSO_VALIDO, flusso: { stadi: [{ tipo: "passo", titolo: "Presa in carico", dettaglio: "squadra di 12 addetti" }, { tipo: "passo", titolo: "Chiusura" }] } }], FATTI_SENZA, { evidenza: { ...evidenzaVuota, testi: ["La squadra di sostituzione è composta da 12 addetti."] } });
    const dettaglio2 = conRiscontro.figure[0]?.archetipo === "flusso" && conRiscontro.figure[0].flusso.stadi[0].tipo === "passo" ? conRiscontro.figure[0].flusso.stadi[0].dettaglio : undefined;
    atteso("R9: con riscontro nei documenti nessun asterisco", !/\*/.test(dettaglio2 ?? ""), dettaglio2);

    const troppe = costruisciFigure(Array.from({ length: 8 }, () => FLUSSO_VALIDO), FATTI_SENZA);
    atteso("al massimo 6 figure per sezione, le altre scartate con avviso", troppe.blocchi.length === 6 && troppe.avvisi.some((a) => /Oltre 6/.test(a)));
    atteso("input non array: nessuna figura, nessun errore", costruisciFigure(undefined, FATTI_SENZA).blocchi.length === 0 && costruisciFigure({ a: 1 }, FATTI_SENZA).blocchi.length === 0);
    const mista = costruisciFigure([{ archetipo: "torta" }, FLUSSO_VALIDO], FATTI_SENZA);
    atteso("una figura scartata non sposta le altre: l'indice resta quello dichiarato", mista.blocchi[0] === null && !!mista.blocchi[1] && mista.avvisi.some((a) => /^Figura 1:/.test(a)));

    const testoPrompt = testoFigureNelPrompt(FATTI_SENZA);
    atteso("prompt: dice al modello che il cruscotto non è disponibile e perché", /NON disponibile/.test(testoPrompt) && /piattaforma gestionale/.test(testoPrompt));
    atteso("prompt: con piattaforma e funzioni le elenca e limita la schermata a quelle", /«Piattaforma Esempio»/.test(testoFigureNelPrompt(FATTI_CON_PIATTAFORMA)) && /Cruscotto indicatori in tempo reale/.test(testoFigureNelPrompt(FATTI_CON_PIATTAFORMA)));
  }

  // --- 3. Segnaposti, blocchi e maschere ---
  {
    const blocchi = [serializzaBloccoFigura(tuttiGliEsempiFigure.flussoRitorno), null, serializzaBloccoFigura(tuttiGliEsempiFigure.reteStella)];
    const testo = "Intro.\n\n[FIGURA:1]\n\nUn paragrafo.\n\n[FIGURA:2]\n\n[FIGURA:3]\n\n[FIGURA:1]\n\nFine.";
    atteso("segnaposti: trovati in ordine", trovaSegnapostiFigura(testo).join() === "1,2,3,1");
    const r = inserisciFigure(testo, blocchi);
    atteso("inserimento: due figure inserite, il segnaposto senza figura e il duplicato tolti", r.inserite === 2 && r.senzaFigura.join() === "2" && !/\[FIGURA:\d+\]/.test(r.testo) && (r.testo.match(/\[FIGURA\]/g) ?? []).length === 2, JSON.stringify({ i: r.inserite, s: r.senzaFigura }));
    atteso("inserimento: una figura dichiarata e non richiamata nel testo si segnala", inserisciFigure("Solo testo.", [blocchi[0]]).nonRichiamate.join() === "1");
    const blocco = serializzaBloccoFigura(tuttiGliEsempiFigure.livelliElenco);
    atteso("blocco: riletto identico", JSON.stringify(leggiBloccoFigura(blocco.replace(/^\[FIGURA\]\n/, "").replace(/\n\[\/FIGURA\]$/, ""))) === JSON.stringify(tuttiGliEsempiFigure.livelliElenco));
    atteso("blocco con JSON rotto: illeggibile (nessun errore)", leggiBloccoFigura("{non json") === null && leggiBloccoFigura("testo") === null);
    const testoConBlocco = `## 1.1 A\n\nProsa.\n\n${blocco}\n\n[FIGURA:2]\n\nAltra prosa.`;
    const mascherato = mascheraFigure(testoConBlocco);
    atteso("maschera: il blocco esce dal testo che va al modello (nessun JSON), il segnaposto ancora da costruire resta", mascherato.blocchi.length === 1 && !mascherato.testo.includes('"v":1') && /\[FIGURA:@1\]/.test(mascherato.testo) && /\[FIGURA:2\]/.test(mascherato.testo));
    atteso("maschera: ripristino esatto, anche se il modello riordina le righe", ripristinaFigure(mascherato.testo, mascherato.blocchi) === testoConBlocco);
    atteso("figureInvariate: stesso testo → sì; blocco alterato, tolto o segnaposto cambiato → no", figureInvariate(testoConBlocco, testoConBlocco) && !figureInvariate(testoConBlocco, testoConBlocco.replace("Controllo", "Controlli")) && !figureInvariate(testoConBlocco, testoConBlocco.replace(blocco, "")) && !figureInvariate(testoConBlocco, testoConBlocco.replace("[FIGURA:2]", "[FIGURA:3]")));
    const conGuardie = assegnaIconeMancanti(`${testoConBlocco}\n\n- Verifica mensile dei dispositivi di protezione\n- Controllo giornaliero delle aree`).testo;
    atteso("guardie a valle: le icone non toccano il blocco della figura", conGuardie.includes(blocco));
    const guardiaValori = applicaGuardiaValori(testoConBlocco, { dipendenti: 5, uscente: [], fatti: [], testi: [] });
    atteso("guardia valori: il blocco della figura non viene alterato", guardiaValori.testo.includes(blocco));
    atteso("R8: le righe dentro un blocco figura non sono candidate alla riformulazione", trovaRigheConRiferimentiEconomici(`[FIGURA]\n{"t":"senza oneri aggiuntivi"}\n[/FIGURA]`).length === 0 && trovaRigheConRiferimentiEconomici("Il servizio è senza oneri aggiuntivi.").length === 1);
    atteso("campi di testo: la didascalia e i testi liberi sì, tipo e unità no", (() => {
      const campi = campiDiTestoFigura(tuttiGliEsempiFigure.cronoMinuti).map((c) => c.leggi());
      return campi.includes(tuttiGliEsempiFigure.cronoMinuti.didascalia) && !campi.includes("minuti") && !campi.includes("cronoprogramma");
    })());
  }

  // --- 4. Layout: geometria, colori, contrasto ---
  for (const nome of nomiEsempi) {
    const dati = tuttiGliEsempiFigure[nome];
    const layout = calcolaLayoutFigura(dati, { misura: misuraApprossimata });
    const fuori = fuoriDalDisegno(layout);
    atteso(`layout «${nome}»: nulla fuori dal disegno`, fuori.length === 0, fuori.slice(0, 4).join("; "));
    const sovrapposte = caselleSovrapposte(layout);
    atteso(`layout «${nome}»: nessuna casella sovrapposta a un'altra`, sovrapposte.length === 0, sovrapposte.slice(0, 3).join("; "));
    if (dati.archetipo === "flusso") {
      const attraversate = lineeCheAttraversanoCaselle(layout);
      atteso(`layout «${nome}»: nessuna linea di collegamento attraversa una casella`, attraversate.length === 0, attraversate.slice(0, 3).join("; "));
    }
    const usati = new Set<string>();
    for (const p of layout.prims) {
      if (p.t === "rect") [p.fill, p.stroke].forEach((c) => c && usati.add(c.toUpperCase()));
      if (p.t === "cerchio") [p.fill, p.stroke].forEach((c) => c && usati.add(c.toUpperCase()));
      if (p.t === "poligono") [p.fill, p.stroke].forEach((c) => c && usati.add(c.toUpperCase()));
      if (p.t === "testo") usati.add(p.colore.toUpperCase());
      if (p.t === "linea") usati.add(p.colore.toUpperCase());
    }
    const estranei = [...usati].filter((c) => !AMMESSI.has(c) && !eTintaDelPrimario(c));
    atteso(`layout «${nome}»: solo colori della palette (R20, neutri, tinte del primario)`, estranei.length === 0, estranei.join(","));
    const bassi = contrastiInsufficienti(layout);
    atteso(`layout «${nome}»: contrasto del testo ≥ 3:1 sul proprio sfondo`, bassi.length === 0, bassi.slice(0, 4).join("; "));
    const rosso = layout.prims.filter((p) => (p.t === "rect" && [p.fill, p.stroke].some((c) => c?.toUpperCase() === C.rosso)) || (p.t === "linea" && p.colore.toUpperCase() === C.rosso) || (p.t === "testo" && p.colore.toUpperCase() === C.rosso) || (p.t === "poligono" && p.fill.toUpperCase() === C.rosso));
    atteso(`layout «${nome}»: il rosso (riservato a «da compilare») non compare fuori dal semaforo del cruscotto`, rosso.length === 0);
    const pagine = stimaPagineFigura(dati);
    atteso(`layout «${nome}»: stima delle pagine plausibile (${pagine.toFixed(2)})`, pagine > 0.1 && pagine < 1.1);
  }
  {
    const arancio = (n: string) => calcolaLayoutFigura(tuttiGliEsempiFigure[n], { misura: misuraApprossimata }).prims.filter((p) => p.t === "rect" && p.fill?.toUpperCase() === `#${COLORE_PIENO.SICUREZZA}`).length;
    atteso("R20: l'arancio compare solo dove il modello ha dichiarato SICUREZZA", arancio("flussoAlternative") === 2 && arancio("flussoSerpentina") === 1 && arancio("flussoAssenze") === 0 && arancio("livelliElenco") === 0, `${arancio("flussoAlternative")} ${arancio("flussoSerpentina")} ${arancio("flussoAssenze")}`);
    const layoutLivelli = calcolaLayoutFigura(tuttiGliEsempiFigure.livelliElenco, { misura: misuraApprossimata });
    const fillLivelli = layoutLivelli.prims.filter(RECT).filter((r) => r.r === 8 && r.x < 100 && r.w > 200 && r.h > 40 && r.fill && r.fill.toUpperCase() !== C.bannerFill.toUpperCase()).sort((a, b) => a.y - b.y).map((r) => r.fill as string);
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    atteso("livelli: il livello più alto è il più scuro e si schiarisce scendendo", fillLivelli.length === 3 && lum(fillLivelli[0]) < lum(fillLivelli[1]) && lum(fillLivelli[1]) < lum(fillLivelli[2]), fillLivelli.join(","));
    const passoMinuti = passoAsse(30, 580);
    atteso("cronoprogramma: l'asse sceglie un passo regolare (5 minuti su 30; 2 settimane su 12 in 440 unità)", passoMinuti === 5 && passoAsse(12, 440) === 2 && passoAsse(100, 200) >= 25, `${passoMinuti} ${passoAsse(12, 440)} ${passoAsse(100, 200)}`);
  }

  // --- 5. Regole fisse del cruscotto ---
  {
    const layout = calcolaLayoutFigura(cruscottoCompleto, { misura: misuraApprossimata });
    const testi = layout.prims.filter((p): p is Extract<Prim, { t: "testo" }> => p.t === "testo").map((p) => p.testo);
    atteso("cruscotto: la striscia «Dati di esempio — schermata illustrativa» c'è sempre", testi.includes(STRISCIA_ILLUSTRATIVA) && STRISCIA_ILLUSTRATIVA === "Dati di esempio — schermata illustrativa");
    const senzaStato = calcolaLayoutFigura({ ...cruscottoCompleto, cruscotto: { ...(cruscottoCompleto as Extract<DatiFigura, { archetipo: "cruscotto" }>).cruscotto, laterale: undefined, indicatori: [] } } as DatiFigura, { misura: misuraApprossimata });
    atteso("cruscotto: la striscia resta anche senza tessere e senza elenco laterale", senzaStato.prims.some((p) => p.t === "testo" && p.testo === STRISCIA_ILLUSTRATIVA));
    const rilevatoInvariabile = testi.filter((t) => /^Rilevato:/.test(t)).every((t) => t === "Rilevato: —");
    const righeCruscotto = (cruscottoCompleto as Extract<DatiFigura, { archetipo: "cruscotto" }>).cruscotto.righe.length;
    atteso("cruscotto: ogni «Rilevato» è un trattino (nelle tessere e in tabella)", rilevatoInvariabile && testi.filter((t) => t === "—").length >= righeCruscotto, `${testi.filter((t) => t === "—").length} trattini`);
    const cerchiRossi = layout.prims.filter((p) => p.t === "cerchio" && p.fill?.toUpperCase() === C.rosso).length;
    const rossoAltrove = layout.prims.filter((p) => (p.t !== "cerchio" && p.t !== "linea") && JSON.stringify(p).toUpperCase().includes(C.rosso)).length;
    atteso("cruscotto: il rosso solo nel badge di scostamento (cerchio con simbolo)", cerchiRossi >= 1 && rossoAltrove === 0, `${cerchiRossi} cerchi, ${rossoAltrove} altrove`);
    const modelloScrive = leggiFiguraModello({ archetipo: "cruscotto", didascalia: "d", cruscotto: { profilo: "P", righe: [{ indicatore: "A", obiettivo: "99 %" }, { indicatore: "B", obiettivo: "98 %" }] } }).figura;
    const l2 = modelloScrive ? calcolaLayoutFigura({ ...modelloScrive, archetipo: "cruscotto", cruscotto: { ...(modelloScrive as Extract<DatiFigura, { archetipo: "cruscotto" }>).cruscotto, piattaforma: "P" } } as DatiFigura, { misura: misuraApprossimata }) : null;
    atteso("cruscotto: senza stati nessun semaforo e nessuna colonna Stato", !!l2 && !l2.prims.some((p) => p.t === "testo" && (p.testo === "Stato" || p.testo === "scostamento")));
  }

  // --- 6. Adattamento a testi lunghi e a molti elementi ---
  {
    const estremi = figureEstreme;
    for (const [nome, dati] of Object.entries(estremi)) {
      let layout: LayoutFigura | null = null;
      let errore = "";
      try {
        layout = calcolaLayoutFigura(dati, { misura: misuraApprossimata });
      } catch (e) {
        errore = String(e);
      }
      const fuori = layout ? fuoriDalDisegno(layout) : [];
      const sovrapposte = layout ? caselleSovrapposte(layout) : [];
      atteso(`adattamento «${nome}»: regge testi lunghissimi e molti elementi, resta nel foglio senza sovrapposizioni`, !!layout && errore === "" && fuori.length === 0 && sovrapposte.length === 0 && layout.altezza < 3200, `${errore} ${fuori.slice(0, 3).join("; ")} ${sovrapposte.slice(0, 2).join("; ")} h=${layout?.altezza}`);
    }
    const minimi: DatiFigura[] = [
      { v: 1, archetipo: "flusso", didascalia: "d", flusso: { stadi: [{ tipo: "passo", titolo: "A" }, { tipo: "passo", titolo: "B" }] } },
      { v: 1, archetipo: "livelli", didascalia: "d", livelli: { livelli: [{ titolo: "A" }, { titolo: "B" }] } },
      { v: 1, archetipo: "cronoprogramma", didascalia: "d", cronoprogramma: { unita: "mesi", durata: 1, righe: [{ titolo: "A", barre: [{ da: 0, a: 1 }] }] } },
      { v: 1, archetipo: "cruscotto", didascalia: "d", cruscotto: { profilo: "P", indicatori: [], righe: [{ indicatore: "A", obiettivo: "1" }, { indicatore: "B", obiettivo: "2" }] } },
      { v: 1, archetipo: "rete", didascalia: "d", rete: { centro: { titolo: "C" }, nodi: [{ titolo: "A" }, { titolo: "B" }] } },
    ];
    for (const dati of minimi) {
      let ok = true;
      try {
        const layout = calcolaLayoutFigura(dati, { misura: misuraApprossimata });
        ok = fuoriDalDisegno(layout).length === 0 && layout.altezza > 40;
      } catch {
        ok = false;
      }
      atteso(`minimo «${dati.archetipo}»: la figura più piccola possibile si disegna`, ok);
    }
  }

  // --- 7. Disegno vero su canvas, con i tre font ---
  {
    for (const nome of nomiEsempi) {
      let errore = "";
      let png: Buffer | null = null;
      let larghezzaPx = 0;
      let altezzaPx = 0;
      try {
        const r = await disegnaFigura(tuttiGliEsempiFigure[nome], {});
        png = r.buffer;
        larghezzaPx = png.readUInt32BE(16);
        altezzaPx = png.readUInt32BE(20);
        if (r.width !== 600 || Math.abs(r.height - (600 * altezzaPx) / 2400) > 1) errore = `dimensioni nel documento ${r.width}x${r.height}`;
      } catch (e) {
        errore = String(e);
      }
      const firma = png?.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
      atteso(`disegno «${nome}»: PNG valido largo 2400 px, 600 px nel documento`, errore === "" && firma && larghezzaPx === 2400 && (png?.length ?? 0) > 8000, errore || `${larghezzaPx}x${altezzaPx}`);
    }
    for (const font of ["Times New Roman", "Calibri", "Arial"]) {
      let errore = "";
      let png: Buffer | null = null;
      try {
        for (const nome of ["cronoSettimane", "reteColonne", "cruscottoCompleto", "livelliFlusso"]) png = (await disegnaFigura(tuttiGliEsempiFigure[nome], { font })).buffer;
      } catch (e) {
        errore = String(e);
      }
      atteso(`disegno con il font «${font}»: nessun errore`, errore === "" && (png?.length ?? 0) > 8000, errore);
    }
    const r = await disegnaFigura(tuttiGliEsempiFigure.flussoSerpentina, {});
    const stimaDisegno = (r.altezzaPx / 2400) * 680;
    const stimaLayout = altezzaStimataFigura(tuttiGliEsempiFigure.flussoSerpentina);
    atteso("la stima delle pagine (misura approssimata) è vicina al disegno vero (±15%)", Math.abs(stimaDisegno - stimaLayout) / stimaDisegno < 0.15, `${stimaDisegno.toFixed(0)} vs ${stimaLayout.toFixed(0)}`);
  }

  // --- 8. Stima pagine del documento ---
  {
    const dati = tuttiGliEsempiFigure.reteColonne;
    const blocco = serializzaBloccoFigura(dati);
    const conBlocco = stimaPagineContenuto(`## 1.1 Struttura\n\nTesto breve.\n\n${blocco}\n`, {});
    const senzaBlocco = stimaPagineContenuto("## 1.1 Struttura\n\nTesto breve.\n", {});
    atteso("pagine: il blocco costa quanto il suo disegno più la didascalia, non come una riga di JSON", Math.abs(conBlocco - senzaBlocco - stimaPagineFigura(dati)) < 0.02, `${(conBlocco - senzaBlocco).toFixed(3)} vs ${stimaPagineFigura(dati).toFixed(3)}`);
    const conSegnaposto = stimaPagineContenuto("## 1.1 Struttura\n\nTesto breve.\n\n[FIGURA:1]\n", {});
    atteso("pagine: un segnaposto ancora da costruire vale circa mezza pagina", Math.abs(conSegnaposto - senzaBlocco - 0.5) < 0.05, `${(conSegnaposto - senzaBlocco).toFixed(3)}`);
    atteso("pagine: una maschera [FIGURA:@1] vale come un segnaposto", Math.abs(stimaPagineContenuto("## 1.1 Struttura\n\nTesto breve.\n\n[FIGURA:@1]\n", {}) - conSegnaposto) < 0.01);
  }

  // --- 9. Compressione/espansione non toccano le figure ---
  {
    const blocco = serializzaBloccoFigura(tuttiGliEsempiFigure.livelliElenco);
    const FRASI = ["Il responsabile coordina le attività quotidiane presso ogni sede del servizio.", "Gli operatori seguono procedure scritte e aggiornate durante tutto l'anno.", "Ogni intervento viene registrato e riportato al referente.", "Le attrezzature sono controllate prima dell'avvio del turno."];
    const prosa = Array.from({ length: 6 }, (_, i) => FRASI[i % FRASI.length]).join(" ");
    const testo = `## 1.1 Controlli\n\n${prosa}\n\n${blocco}\n\n| Ruolo | Compito |\n|---|---|\n| [G]**Responsabile** | [G]Coordina il servizio |\n| [G]**Ispettore** | [G]Verifica gli interventi |`;
    const richieste: RichiestaEspansione[] = [];
    const ampia = (r: RichiestaEspansione) => `${r.testo}\n\n${Array.from({ length: 10 }, (_, i) => `${FRASI[i % FRASI.length].replace(/\.$/, "")} nel contesto ${"abcdefghij"[i]}.`).join(" ")}`;
    const espansione = await espandiBloccoConGaranzie({
      chiave: "1.1", titoloBlocco: "1. Controlli", blocco: testo, pagineTarget: 2.2, paroleXPagina: 450, formattazione: {}, context: { userId: null, garaId: null },
      espandi: async (r) => { richieste.push(r); return ampia(r); },
    });
    atteso("espansione: il modello non riceve i dati della figura, solo la maschera", richieste.length > 0 && richieste.every((r) => !r.testo.includes('"v":1')) && /\[FIGURA:@1\]/.test(richieste[0].testo));
    atteso("espansione: il blocco nel risultato è identico all'originale", espansione.esito === "espanso" && espansione.testo.includes(blocco), `${espansione.esito} ${espansione.motivo ?? ""}`);
    const senzaMaschera = await espandiBloccoConGaranzie({
      chiave: "1.1", titoloBlocco: "1. Controlli", blocco: testo, pagineTarget: 2.2, paroleXPagina: 450, formattazione: {}, context: { userId: null, garaId: null },
      espandi: async (r) => ampia(r).replace("[FIGURA:@1]", ""),
    });
    atteso("espansione: se il modello butta via la figura l'ampliamento è rifiutato", senzaMaschera.esito === "rifiutato", senzaMaschera.esito);
    const conSegnaposto = `## 1.1 Controlli\n\n${prosa}\n\n[FIGURA:1]\n\n| Ruolo | Compito |\n|---|---|\n| [G]**Responsabile** | [G]Coordina il servizio |`;
    const segnapostoPerso = await espandiBloccoConGaranzie({
      chiave: "1.1", titoloBlocco: "1. Controlli", blocco: conSegnaposto, pagineTarget: 2.2, paroleXPagina: 450, formattazione: {}, context: { userId: null, garaId: null },
      espandi: async (r) => ampia(r).replace("[FIGURA:1]", ""),
    });
    atteso("espansione: anche il segnaposto ancora da costruire non può sparire", segnapostoPerso.esito === "rifiutato", segnapostoPerso.esito);
  }

  // --- 10. Word: immagine, didascalia numerata dal codice, manifest ---
  {
    const bloccoA = serializzaBloccoFigura(tuttiGliEsempiFigure.flussoRitorno);
    const bloccoB = serializzaBloccoFigura(tuttiGliEsempiFigure.reteStella);
    const bloccoC = serializzaBloccoFigura(cruscottoCompleto);
    const markdown = `# 1. Organizzazione\n\n## 1.1 Processi\n\nTesto.\n\n${bloccoA}\n\n## 1.2 Rete\n\nAltro testo.\n\n${bloccoB}\n\n${bloccoC}\n\n[FIGURA:9]\n`;
    const buffer = await buildDocxBuffer("Relazione", markdown, { font: "Times New Roman", dimensioneCarattere: 12, interlinea: 1 });
    const zip = await JSZip.loadAsync(buffer);
    const xml: string = await zip.file("word/document.xml").async("string");
    const nomi = [...xml.matchAll(/<wp:docPr\b[^>]*name="([^"]*)"/g)].map((m) => m[1]);
    atteso("Word: tre figure schematiche con il nome «figura:<archetipo>» nel testo alternativo", nomi.filter((n) => n.startsWith("figura:")).join() === "figura:flusso,figura:rete,figura:cruscotto", nomi.join());
    const testiXml = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    const didascalie = testiXml.filter((t) => /^Figura \d+$/.test(t));
    atteso("Word: didascalie «Figura 1», «Figura 2», «Figura 3» numerate dal codice nell'ordine del documento", didascalie.join() === "Figura 1,Figura 2,Figura 3", didascalie.join());
    atteso("Word: la didascalia dice cosa dimostra (testo della figura) dopo il numero", testiXml.some((t) => t.startsWith(" — ") && t.includes(tuttiGliEsempiFigure.flussoRitorno.didascalia)));
    atteso("Word: nessun dato JSON né segnaposto residuo nel testo del documento", !testiXml.some((t) => /"archetipo"|\[FIGURA/.test(t)), testiXml.filter((t) => /"archetipo"|\[FIGURA/.test(t)).join("|").slice(0, 80));
    const figure = await estraiFigureDocumento(zip);
    const sorgente = estraiSorgenteFigure(markdown.replace("[FIGURA:9]", ""));
    abbinaSorgente(figure, sorgente);
    atteso("manifest immagini: ogni figura schematica è riconosciuta e abbinata al suo blocco sorgente", verificaFigure(figure, sorgente).length === 0 && figure.filter((f) => f.tipo === "figura").length === 3, verificaFigure(figure, sorgente).join(" | "));
    atteso("manifest immagini: un blocco non renderizzato sarebbe segnalato", verificaFigure(figure.slice(0, 2), sorgente).some((e) => /\[FIGURA\]/.test(e)));
    const senzaBlocchiValidi = await buildDocxBuffer("Relazione", `# 1. A\n\n[FIGURA]\n{"rotto":true}\n[/FIGURA]\n\nTesto.`, {});
    const xmlRotto: string = await (await JSZip.loadAsync(senzaBlocchiValidi)).file("word/document.xml").async("string");
    atteso("Word: un blocco con dati illeggibili si scarta senza produrre immagini né errori", !/figura:/.test(xmlRotto));
  }

  // --- 11. Schema dello strumento e collegamento ai punti di produzione ---
  {
    const item = SCHEMA_FIGURE_STRUMENTO.items;
    const campi = Object.keys(item.properties);
    const tutto = JSON.stringify(SCHEMA_FIGURE_STRUMENTO);
    atteso("schema: un campo per archetipo, nessun colore/coordinata/dimensione/numero di figura", campi.join() === "archetipo,didascalia,flusso,livelli,cronoprogramma,cruscotto,rete" && !/"(color|colore|x|y|width|height|numero_figura)"/i.test(tutto.replace(/"description":"[^"]*"/g, "")), campi.join());
    atteso("schema: gli archetipi enumerati sono quelli del codice", JSON.stringify(item.properties.archetipo.enum) === JSON.stringify([...ARCHETIPI]));
    atteso("schema: vieta il numero di figura, chiede una didascalia che dimostra, limita a 6 figure", /MAI il numero di una figura/.test(tutto) && /COSA DIMOSTRA/.test(tutto) && /al massimo 6/.test(tutto));
    // Le istruzioni non devono scoraggiare le figure (era la causa di criteri senza nessuna figura).
    atteso("schema: chiede una figura per OGNI processo, calendario, struttura o rete, senza frasi che le scoraggiano", /OGNI volta che il testo descrive/.test(tutto) && /Almeno una figura per ogni sotto-criterio/.test(tutto) && !/non inserirne una per fare scena/.test(tutto) && !/SOLO dove una figura fa capire più del testo/.test(tutto));
    atteso("schema: il cruscotto dichiara solo obiettivi, «Rilevato» e piattaforma sono del codice", /«Rilevato» è sempre un trattino/.test(tutto) && /Il nome della piattaforma lo mette il generatore/.test(tutto) && /Dati di esempio — schermata illustrativa/.test(tutto));
    const cruscottoSchema = JSON.stringify(item.properties.cruscotto);
    atteso("schema: nel cruscotto non esiste né il campo piattaforma né un campo rilevato", !/"piattaforma":\{/.test(cruscottoSchema) && !/"rilevat/i.test(cruscottoSchema.replace(/"description":"[^"]*"/g, "")));

    const promptStrumento = leggiFile("src/lib/gara-chat-prompt.ts");
    atteso("strumento di generazione: campo 'figure' con lo schema e istruzione del segnaposto [FIGURA:n]", /figure: SCHEMA_FIGURE_STRUMENTO/.test(promptStrumento) && /\[FIGURA:1\]/.test(promptStrumento));
    atteso("prompt di sistema: dice al modello se il cruscotto è disponibile per il profilo", /testoFigureNelPrompt\(fattiFigure\)/.test(promptStrumento));
    const chat = leggiFile("src/app/actions/gara-chat.ts");
    atteso("gara-chat: legge i fatti del profilo, passa le figure alla generazione e riferisce gli avvisi al cliente", /leggiFattiFigure/.test(chat) && /figure: input\.figure/.test(chat) && /testoAvvisiFigure\(avvisiFigure\)/.test(chat));
    const rel = leggiFile("src/lib/relazione-tecnica.ts");
    const posOrg = rel.indexOf("costruisciOrganigramma(organigrammaDichiarato");
    const posFigure = rel.indexOf("costruisciFigure(figureDichiarate");
    const posIcone = rel.indexOf("assegnaIconeMancanti(guardiaValori");
    atteso("relazione: le figure si costruiscono DOPO tutte le riscritture (icone incluse), come l'organigramma", posIcone > 0 && posFigure > posIcone && posOrg > posIcone && /inserisciFigure\(contenuto, esito\.blocchi\)/.test(rel));
    atteso("relazione: la bozza restituisce gli avvisi delle figure", /avvisiFigure\s*\}\s*;?\s*\n\}/.test(rel) || /valoriImpresa, avvisiOrganigramma, avvisiFigure/.test(rel));
    const opachi = ["valori-impresa", "ripristino-verificato", "densita-visiva", "riferimenti-economici"].map((f) => /ORGANIGRAMMA\|FIGURA/.test(leggiFile(`src/lib/${f}.ts`)));
    atteso("guardie: valori, ripristino, densità e R8 trattano il blocco [FIGURA] come opaco", opachi.every(Boolean), opachi.join());
    atteso("guardia economica: i tag [FIGURA] sono tag di formattazione da conservare", /FIGURA\(\?::@\?\\d\+\)\?\|\\\/FIGURA/.test(leggiFile("src/lib/garanzia-senza-economico.ts")));
    atteso("verifica dati: se il modello cambia i segnaposto delle figure, la verifica non si usa", /figureInvariate\(contenuto, testo\)/.test(leggiFile("src/lib/verifica-dati-aziendali.ts")));
    atteso("compressione ed espansione: maschera, ripristino e controllo di invarianza delle figure", ["compressione-mirata", "espansione-mirata"].every((f) => { const s = leggiFile(`src/lib/${f}.ts`); return /mascheraFigure/.test(s) && /ripristinaFigure/.test(s) && /figureInvariate/.test(s); }));
    atteso("confronto tagli: le figure sono contate e non possono sparire", /figure: \(testo\.match/.test(leggiFile("src/lib/confronto-tagli.ts")) && /figure schematiche passate da/.test(leggiFile("src/lib/confronto-tagli.ts")));
    const docx = leggiFile("src/lib/docx-generator.ts");
    atteso("docx: il blocco FIGURA è un segmento, con immagine e didascalia numerata dal codice", /ORGANIGRAMMA\|IMMAGINE\|BOX\|FIGURA/.test(docx) && /disegnaFigura\(datiFigura, \{ font \}\)/.test(docx) && /Figura \$\{numeroFigura\}/.test(docx));
    const migrazione = leggiFile("supabase/migrations/0072_companies_funzioni_piattaforma.sql");
    atteso("migrazione 0072: colonna facoltativa, idempotente", /add column if not exists funzioni_piattaforma text/.test(migrazione));
    const azione = leggiFile("src/app/actions/company-profile.ts");
    atteso("profilo: il salvataggio non fallisce se la migrazione 0072 non è ancora stata eseguita", /funzioni_piattaforma/.test(azione) && /error\.message/.test(azione) && /campiPiattaforma/.test(azione));
    atteso("profilo: il campo nel modulo e nella pagina", /name="funzioniPiattaforma"/.test(leggiFile("src/app/site-omnia-ai/dashboard/omnia-ai/profilo-azienda/company-profile-form.tsx")) && /funzioni_piattaforma/.test(leggiFile("src/app/site-omnia-ai/dashboard/omnia-ai/profilo-azienda/page.tsx")));
    const regole = leggiFile("prompts/regole-omnia.md");
    atteso("regole: R16 elenca le figure ammesse e vieta il numero scritto dal modello", /schermata della piattaforma/.test(regole) && /non porta mai un numero/.test(regole));
    atteso("prompt di compressione ed espansione: le righe [FIGURA] restano identiche", /\[FIGURA:@n\]/.test(leggiFile("prompts/compressione-mirata-omnia.md")) && /\[FIGURA:@n\]/.test(leggiFile("prompts/espansione-mirata-omnia.md")));
  }

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Autotest delle figure schematiche: tutti i casi ok.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
