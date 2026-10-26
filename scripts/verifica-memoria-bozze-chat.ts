// Autotest della memoria della chat di gara (OMNIA AI): cosa vede il modello del lavoro già fatto e delle richieste precedenti.
//
// Difetto reale (segnalazione di un cliente il 26/10/2026, confermata dai dati): ogni «ampliamento» o «assemblaggio» di un
// criterio era una riscrittura da zero. Del lavoro già salvato il modello vedeva solo l'elenco dei titoli (mai il testo); della
// conversazione vedeva solo gli ultimi 12 messaggi; il totale delle «pagine già scritte» sommava tutte le versioni di ogni
// criterio (14 del solo 2.1 in un giorno); la ricerca degli estratti partiva dalla sola frase del cliente; e l'organigramma
// del criterio 1 compariva dentro il 2.1. Qui si controlla, con testi sintetici (nessun dato di clienti, nessun modello):
//   - il raggruppamento delle versioni per criterio e l'elenco per il prompt (ultima versione in evidenza);
//   - il totale «già scritto» conta una volta sola l'ultima versione di ogni criterio;
//   - la bozza mostrata al modello contiene tutto il testo e nessun dato strutturato grezzo;
//   - il confronto con la bozza di partenza (titoli, figure, organigramma, tabelle, parole conservate);
//   - la regola «leggi prima di riscrivere» (anche: letto nella stessa risposta = non letto);
//   - le richieste più vecchie del cliente restano nel prompt;
//   - la ricerca degli estratti si ancora al criterio citato, senza scambiare «10.950» per un criterio;
//   - il collegamento in gara-chat.ts e nel prompt (controlli sul sorgente).
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  PAROLE_PER_PAGINA_STIMATE,
  arricchisciQueryRicerca,
  avvisoOrganigrammaInAltroCriterio,
  chiaveCriterio,
  confrontaConBozzaBase,
  controllaLetturaPrimaDiGenerare,
  criteriCitati,
  haPerdutoContenuto,
  leggiBozzeRichieste,
  MAX_BOZZE_PER_LETTURA,
  memoriaRichiesteCliente,
  presentaBozzaAlModello,
  raggruppaSezioni,
  testoConfrontoPerModello,
  testoElencoBozze,
  testoGenerazioneRifiutata,
  totaleUltimeVersioni,
  type SezioneSalvata,
} from "../src/lib/gara-bozze-contesto";
import { buildSystemPrompt, LEGGI_BOZZA_TOOL, buildGeneraBozzaTool, type GaraContesto } from "../src/lib/gara-chat-prompt";
import { serializzaBlocco } from "../src/lib/organigramma-dati";
import { serializzaBloccoFigura } from "../src/lib/figure-dati";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const ISO = (ora: string) => `2026-10-26T${ora}:00Z`;
const parole = (n: number) => Array.from({ length: n }, (_, i) => `parola${i}`).join(" ");
const sez = (ordine: number, titolo: string, contenuto: string, ora = "08:00"): SezioneSalvata => ({ ordine, titolo_sezione: titolo, contenuto, created_at: ISO(ora) });

const FIGURA = serializzaBloccoFigura({ v: 1, didascalia: "Flusso operativo del turno", archetipo: "flusso", flusso: { passi: [{ titolo: "Inizio turno" }] } } as never);
const ORGANIGRAMMA = serializzaBlocco({ v: 2, imprese: [{ denominazione: "SMAC" }], figuraApicale: { denominazione: "Direzione" }, coordinamento: [{ nome: "Area A" }] } as never);

const CRITERI = `CRITERI DI VALUTAZIONE OFFERTA TECNICA (max 70 punti). Metodo: D=discrezionale, T=tabellare.

1. COORDINAMENTO DEI SERVIZI - max 9 punti (D)
1.1 Organigramma e qualifiche (adeguatezza struttura organizzativa e gruppo di lavoro) - 5 punti (D)
1.2 Reperibilità e gestione delle emergenze - 4 punti (D)

2. DESCRIZIONE E ORGANIZZAZIONE DEI SERVIZI - max 40 punti (D)
2.1 Servizio di pulizie e sanificazione ambientale - Modalità organizzative - 20 punti (D)
2.2 Integrazione del monte ore mensile - 20 punti (D)
`;

async function main() {
  console.log("--- La chiave del criterio ---");
  {
    const casi: [string, string][] = [
      ["2.1 Servizio di pulizie e sanificazione - Modalità organizzative", "2.1"],
      ["CRITERIO 2 - Descrizione e Organizzazione dei Servizi", "2"],
      ["2. Descrizione e Organizzazione dei Servizi", "2"],
      ["Criterio 1 - Coordinamento", "1"],
      ["A.1 Qualità del servizio", "A.1"],
      ["  2.2 Integrazione", "2.2"],
    ];
    for (const [titolo, chiave] of casi) atteso(`«${titolo.trim().slice(0, 40)}» → ${chiave}`, chiaveCriterio(titolo) === chiave, chiaveCriterio(titolo));
    atteso("un titolo senza numerazione ha una chiave propria (non ne eredita una a caso)", chiaveCriterio("Coordinamento dei Servizi").startsWith("t:") && chiaveCriterio("Coordinamento dei Servizi") !== chiaveCriterio("Altro titolo"));
  }

  console.log("--- Raggruppamento delle versioni e elenco per il prompt ---");
  const versioni21: SezioneSalvata[] = Array.from({ length: 14 }, (_, i) => sez(10 + i, "2.1 Servizio di pulizie e sanificazione ambientale - Modalità organizzative", parole(1000 + i * 50), `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`));
  const tutte: SezioneSalvata[] = [
    sez(1, "CRITERIO 1 - Coordinamento dei Servizi in Appalto", parole(900) + `\n${ORGANIGRAMMA}\n`),
    sez(2, "CRITERIO 1 - Coordinamento dei Servizi in Appalto", parole(1000) + `\n${ORGANIGRAMMA}\n`),
    sez(3, "Coordinamento dei Servizi in Appalto", parole(1050) + `\n${ORGANIGRAMMA}\n`),
    ...versioni21,
    sez(30, "2.2 Integrazione del monte ore mensile", parole(800)),
  ];
  const gruppi = raggruppaSezioni(tutte);
  {
    atteso("tre criteri distinti, non uno per versione", gruppi.length === 3, gruppi.map((g) => g.chiave).join(","));
    const g1 = gruppi.find((g) => g.chiave === "1");
    atteso("la bozza salvata senza «CRITERIO 1» entra nello stesso gruppo del criterio 1", g1?.versioni.length === 3, JSON.stringify(g1?.versioni.map((v) => v.ordine)));
    const g21 = gruppi.find((g) => g.chiave === "2.1");
    atteso("14 versioni del 2.1 in un solo gruppo, la più recente per prima", g21?.versioni.length === 14 && g21.versioni[0].ordine === 23 && g21.versioni[13].ordine === 10, JSON.stringify(g21?.versioni.map((v) => v.ordine)));
    atteso("i gruppi sono nell'ordine in cui sono comparsi", gruppi.map((g) => g.chiave).join(",") === "1,2.1,2.2", gruppi.map((g) => g.chiave).join(","));

    const elenco = testoElencoBozze(gruppi);
    atteso("l'elenco indica l'ULTIMA versione di ogni criterio con il suo numero d'ordine", /2\.1 Servizio.*ULTIMA versione: \[ordine 23\]/.test(elenco) && /Coordinamento dei Servizi in Appalto.*ULTIMA versione: \[ordine 3\]/.test(elenco), elenco);
    atteso("le versioni precedenti sono limitate a tre, poi «e altre N»", /versioni precedenti: \[ordine 22\].*\[ordine 21\].*\[ordine 20\].* e altre 10/.test(elenco), elenco);
    atteso("una riga per criterio (non una per versione)", elenco.split("\n").length === 3, String(elenco.split("\n").length));
    atteso("l'elenco non contiene il testo delle bozze", !elenco.includes("parola5"));
  }

  console.log("--- Il totale «già scritto» conta una volta sola ogni criterio ---");
  {
    const totale = totaleUltimeVersioni(gruppi);
    const attesaParole = 1050 + (1000 + 13 * 50) + 800;
    atteso("somma solo l'ultima versione di ogni criterio", totale.parole === attesaParole, `${totale.parole} invece di ${attesaParole}`);
    const sommaDiTutte = tutte.reduce((t, s) => t + s.contenuto.split(/\s+/).filter(Boolean).length, 0);
    atteso("è molto meno della somma di tutte le versioni (che gonfiava il totale)", sommaDiTutte > totale.parole * 3, `${sommaDiTutte} vs ${totale.parole}`);
    atteso("le pagine sono parole / 450", totale.pagine === Math.round(attesaParole / PAROLE_PER_PAGINA_STIMATE) && PAROLE_PER_PAGINA_STIMATE === 450, String(totale.pagine));
  }

  console.log("--- La bozza come la legge il modello ---");
  {
    const testoOriginale = `## 2.1 Titolo\n\nParagrafo con **dati** e numeri 10.950 ore.\n\n| A | B |\n|---|---|\n| x | y |\n\n${FIGURA}\n\n${ORGANIGRAMMA}\n\n## Piano di lavoro per sede\n\nAltro testo.`;
    const p = presentaBozzaAlModello(sez(7, "2.1 Servizio", testoOriginale, "10:20"));
    atteso("contiene tutto il testo della bozza (titoli, paragrafi, tabella, numeri)", ["## 2.1 Titolo", "Paragrafo con **dati** e numeri 10.950 ore.", "| A | B |", "|---|---|", "## Piano di lavoro per sede", "Altro testo."].every((t) => p.testo.includes(t)), p.testo);
    atteso("dice quale bozza è (ordine e titolo) e che è già del cliente", p.testo.includes("[ordine 7]") && p.testo.includes("«2.1 Servizio»") && p.testo.includes("Questo è il testo che il cliente ha GIÀ."), p.testo.slice(0, 200));
    atteso("i dati strutturati di figure e organigramma NON arrivano al modello come JSON", !p.testo.includes('"archetipo"') && !p.testo.includes('"coordinamento"') && !p.testo.includes('"v":') && !/\[FIGURA\]\s*\{/.test(p.testo) && !/\[ORGANIGRAMMA\]\s*\{/.test(p.testo), p.testo);
    atteso("al loro posto c'è una riga che dice cosa c'era (figura con didascalia, organigramma)", p.testo.includes("«Flusso operativo del turno»") && p.testo.includes("[ORGANIGRAMMA GIÀ PRESENTE"), p.testo);
    atteso("conta una figura e un organigramma", p.figure === 1 && p.organigrammi === 1);
    const lunga = presentaBozzaAlModello(sez(8, "Lunga", "x".repeat(200_000)));
    atteso("un testo enorme viene troncato e lo dice", lunga.testo.length < 160_000 && lunga.testo.includes("Testo troncato"));
    const senzaBlocchi = presentaBozzaAlModello(sez(9, "Semplice", "Solo testo."));
    atteso("senza figure non aggiunge note sui blocchi", !senzaBlocchi.testo.includes("figure e organigramma disegnati"));
  }

  console.log("--- Il confronto con la bozza di partenza ---");
  {
    const base = `## 2.1 Servizio\n\nTesto di base con molti dettagli.\n\n## Piano di lavoro per sede\n\n| A | B |\n|---|---|\n| x | y |\n\n## Turnistica e fasce orarie\n\n${FIGURA}\n\n## Logistica di cantiere\n\nAltro.`;
    const uguale = confrontaConBozzaBase(base, base);
    atteso("una bozza identica non perde nulla", !haPerdutoContenuto(uguale) && uguale.titoliMancanti.length === 0 && uguale.paroleConservate === 1);
    atteso("il testo per il modello dice «conservati»", testoConfrontoPerModello(uguale, 7).includes("conservati tutti i titoli"));

    const ampliata = confrontaConBozzaBase(base, `${base}\n\n## Prodotti Ecolabel\n\nNuovo contenuto aggiunto.`);
    atteso("un ampliamento (solo aggiunte) non perde nulla", !haPerdutoContenuto(ampliata));

    const rinominati = confrontaConBozzaBase(base, base.replace("Piano di lavoro per sede", "Piani di lavoro per le sedi").replace("Turnistica e fasce orarie", "Turnistica e fascia oraria"));
    atteso("titoli leggermente riformulati (singolare/plurale) NON contano come persi", rinominati.titoliMancanti.length === 0, JSON.stringify(rinominati.titoliMancanti));

    const persa = confrontaConBozzaBase(base, `## 2.1 Servizio\n\nTesto di base con molti dettagli.\n\n## Piano di lavoro per sede\n\nSolo testo, senza tabella.`);
    atteso("titoli tolti, figura tolta e tabella tolta vengono rilevati", persa.titoliMancanti.length === 2 && persa.figure.prima === 1 && persa.figure.dopo === 0 && persa.tabelle.dopo < persa.tabelle.prima && haPerdutoContenuto(persa), JSON.stringify(persa));
    const testoPersa = testoConfrontoPerModello(persa, 7);
    atteso("il testo per il modello elenca cosa manca e gli vieta di dire che ha mantenuto tutto", testoPersa.includes("ATTENZIONE") && testoPersa.includes("«Turnistica e fasce orarie»") && testoPersa.includes("figure 1 → 0") && /NON scrivere che hai mantenuto tutto/.test(testoPersa), testoPersa);

    // Una bozza vera ha molto testo sotto i titoli: se lo stesso schema di titoli viene riempito di parole diverse, è una riscrittura da zero.
    const corpo = (prefisso: string, n: number) => Array.from({ length: n }, (_, i) => `${prefisso}${i}`).join(" ");
    const baseLunga = `## 2.1 Servizio\n\n${corpo("antico", 120)}\n\n## Piano di lavoro per sede\n\n${corpo("tabella", 80)}\n\n| A | B |\n|---|---|\n| x | y |\n\n## Turnistica e fasce orarie\n\n${FIGURA}\n\n${corpo("turno", 100)}\n\n## Logistica di cantiere\n\n${corpo("cantiere", 90)}`;
    const riscritta = confrontaConBozzaBase(baseLunga, `## 2.1 Servizio\n\n${corpo("nuovo", 120)}\n\n## Piano di lavoro per sede\n\n${corpo("altro", 80)}\n\n| A | B |\n|---|---|\n| x | y |\n\n## Turnistica e fasce orarie\n\n${FIGURA}\n\n${corpo("diverso", 100)}\n\n## Logistica di cantiere\n\n${corpo("differente", 90)}`);
    atteso("stessi titoli ma testo riscritto da zero: poche parole conservate, lo segnala", riscritta.titoliMancanti.length === 0 && riscritta.paroleConservate < 0.7 && haPerdutoContenuto(riscritta) && /delle parole di prima è ancora presente/.test(testoConfrontoPerModello(riscritta, 7)), String(riscritta.paroleConservate));
    const ampliataLunga = confrontaConBozzaBase(baseLunga, `${baseLunga}\n\n## Prodotti Ecolabel\n\n${corpo("ecolabel", 150)}`);
    atteso("una bozza lunga ampliata conserva il 100% delle parole di prima", ampliataLunga.paroleConservate === 1 && !haPerdutoContenuto(ampliataLunga), String(ampliataLunga.paroleConservate));

    // Ogni tipo di perdita, da solo, basta a segnalare la bozza: gli altri indicatori restano a posto.
    const soloFiguraTolta = confrontaConBozzaBase(baseLunga, baseLunga.replace(FIGURA, ""));
    atteso("solo la figura tolta: è una perdita (titoli, tabelle e parole invariati)", soloFiguraTolta.titoliMancanti.length === 0 && soloFiguraTolta.tabelle.prima === soloFiguraTolta.tabelle.dopo && soloFiguraTolta.paroleConservate === 1 && soloFiguraTolta.figure.prima === 1 && soloFiguraTolta.figure.dopo === 0 && haPerdutoContenuto(soloFiguraTolta));
    const soloTabellaTolta = confrontaConBozzaBase(baseLunga, baseLunga.replace("| A | B |\n|---|---|\n| x | y |\n", "x y"));
    atteso("solo la tabella tolta: è una perdita (titoli, figure e parole quasi invariati)", soloTabellaTolta.titoliMancanti.length === 0 && soloTabellaTolta.figure.prima === soloTabellaTolta.figure.dopo && soloTabellaTolta.tabelle.prima === 1 && soloTabellaTolta.tabelle.dopo === 0 && soloTabellaTolta.paroleConservate > 0.9 && haPerdutoContenuto(soloTabellaTolta), JSON.stringify(soloTabellaTolta.tabelle));
    const soloTitoloTolto = confrontaConBozzaBase(baseLunga, baseLunga.replace("## Logistica di cantiere\n\n", ""));
    atteso("solo un titolo tolto: è una perdita", soloTitoloTolto.titoliMancanti.length === 1 && soloTitoloTolto.figure.prima === soloTitoloTolto.figure.dopo && soloTitoloTolto.tabelle.prima === soloTitoloTolto.tabelle.dopo && haPerdutoContenuto(soloTitoloTolto), JSON.stringify(soloTitoloTolto.titoliMancanti));
    // parole conservate: a metà è una perdita, all'85% no (la soglia è il 70%)
    const corpoBase = Array.from({ length: 400 }, (_, i) => `termine${i}`);
    const conCorpo = (parole_: string[]) => `## A titolo uno\n\n${parole_.join(" ")}\n\n## B titolo due\n\ntesto breve`;
    const meta = confrontaConBozzaBase(conCorpo(corpoBase), conCorpo(corpoBase.map((p, i) => (i % 2 === 0 ? p : `nuovo${i}`))));
    atteso("metà delle parole sostituite (≈50% conservate): è una perdita", meta.paroleConservate > 0.45 && meta.paroleConservate < 0.6 && meta.titoliMancanti.length === 0 && haPerdutoContenuto(meta), String(meta.paroleConservate));
    const quasi = confrontaConBozzaBase(conCorpo(corpoBase), conCorpo(corpoBase.map((p, i) => (i % 7 === 0 ? `nuovo${i}` : p))));
    atteso("circa l'85% delle parole conservate: NON è una perdita", quasi.paroleConservate > 0.8 && quasi.paroleConservate < 0.9 && !haPerdutoContenuto(quasi), String(quasi.paroleConservate));

    const conSegnaposto = confrontaConBozzaBase(base, base.replace(FIGURA, "[FIGURA:1]"));
    atteso("il testo scritto dal modello (con [FIGURA:1]) conta come figura presente", conSegnaposto.figure.dopo === 1 && !haPerdutoContenuto(conSegnaposto));
    atteso("i dati JSON di figure e organigramma del salvato non contano come parole perse", conSegnaposto.paroleConservate === 1 && conSegnaposto.parole.prima === conSegnaposto.parole.dopo, JSON.stringify(conSegnaposto.parole));
    const organigrammaTolto = confrontaConBozzaBase(`## A\n\n${ORGANIGRAMMA}\n\nTesto.`, `## A\n\nTesto.`);
    atteso("l'organigramma tolto viene rilevato", organigrammaTolto.organigrammi.prima === 1 && organigrammaTolto.organigrammi.dopo === 0 && /organigramma tolto/.test(testoConfrontoPerModello(organigrammaTolto, 3)));
  }

  console.log("--- Leggere prima di riscrivere ---");
  {
    const lette = (...o: number[]) => new Set(o);
    const senzaLettura = controllaLetturaPrimaDiGenerare("2.1 Servizio di pulizie - Modalità", gruppi, lette());
    atteso("per un criterio con bozze, senza lettura la generazione è RIFIUTATA", !senzaLettura.ok && senzaLettura.ordineUltima === 23 && senzaLettura.precedenti.length === 13);
    if (!senzaLettura.ok) {
      const t = testoGenerazioneRifiutata(senzaLettura);
      atteso("il rifiuto dice quale bozza leggere (l'ultima) e che non è stato creato nessun file", t.includes("ordine 23") && t.includes("nessun file creato") && t.includes("leggi_bozza_sezione"), t);
    }
    const letturaDellaVecchia = controllaLetturaPrimaDiGenerare("2.1 Servizio", gruppi, lette(21));
    atteso("letta anche solo una versione di quel criterio, la generazione passa e parte da quella", letturaDellaVecchia.ok && letturaDellaVecchia.ordineBase === 21);
    const duePiuRecente = controllaLetturaPrimaDiGenerare("2.1 Servizio", gruppi, lette(15, 22, 11));
    atteso("con più versioni lette la bozza di partenza è la più recente", duePiuRecente.ok && duePiuRecente.ordineBase === 22);
    const altroCriterio = controllaLetturaPrimaDiGenerare("2.1 Servizio", gruppi, lette(1, 2, 3, 30));
    atteso("aver letto bozze di ALTRI criteri non basta", !altroCriterio.ok);
    const nuovo = controllaLetturaPrimaDiGenerare("2.3 Contenimento degli impatti ambientali", gruppi, lette());
    atteso("un criterio mai trattato passa senza lettura e senza bozza di partenza", nuovo.ok && nuovo.ordineBase === null && nuovo.gruppo === undefined);
    const titoloNumerato = controllaLetturaPrimaDiGenerare("CRITERIO 1 - Coordinamento", gruppi, lette());
    atteso("«CRITERIO 1 - …» è lo stesso criterio di «1» e di «Coordinamento dei Servizi in Appalto»", !titoloNumerato.ok && titoloNumerato.ordineUltima === 3);
  }

  console.log("--- Lo strumento di lettura (più bozze in una chiamata) ---");
  {
    const a = leggiBozzeRichieste({ ordini: [23, 22] }, tutte);
    atteso("due bozze in una chiamata: entrambi i testi, separati", a.trovate.map((s) => s.ordine).join() === "23,22" && a.testo.includes("[ordine 23]") && a.testo.includes("[ordine 22]") && a.testo.includes("====="), a.testo.slice(0, 120));
    const b = leggiBozzeRichieste({ ordini: [23, 999] }, tutte);
    atteso("un numero inesistente non impedisce di leggere gli altri e dice quali esistono", b.trovate.length === 1 && b.inesistenti.join() === "999" && b.testo.includes("Non esistono bozze con ordine 999") && b.testo.includes("Ordini disponibili:"), b.testo.slice(-200));
    const c = leggiBozzeRichieste({ ordini: [998, 999] }, tutte);
    atteso("tutti inesistenti: nessuna bozza letta (il chiamante risponde con errore)", c.trovate.length === 0 && c.inesistenti.length === 2);
    const d = leggiBozzeRichieste({ ordine: 3 }, tutte);
    atteso("accetta anche il vecchio campo singolo «ordine»", d.trovate.length === 1 && d.trovate[0].ordine === 3);
    const e = leggiBozzeRichieste({ ordini: [10, 11, 12, 13, 14, 15] }, tutte);
    atteso("oltre 4 bozze per chiamata se ne leggono solo 4", e.trovate.length === 4 && e.trovate.map((s) => s.ordine).join() === "10,11,12,13");
    const rip = leggiBozzeRichieste({ ordini: [23, 23, 23] }, tutte);
    atteso("lo stesso numero ripetuto si legge una volta sola", rip.trovate.length === 1);
    const g = leggiBozzeRichieste({ ordini: ["abc", null, 2.5] }, tutte);
    atteso("valori non validi: nessuna lettura e il messaggio dice cosa passare", g.trovate.length === 0 && g.testo.includes("Nessun numero d'ordine valido"));
    atteso("senza il campo: messaggio chiaro", leggiBozzeRichieste({}, tutte).testo.includes("Nessun numero d'ordine valido"));
    atteso("i numeri arrivati come testo («22») sono accettati", leggiBozzeRichieste({ ordini: ["22"] }, tutte).trovate.length === 1);
  }

  console.log("--- L'organigramma già in un altro criterio ---");
  {
    const avviso = avvisoOrganigrammaInAltroCriterio(`## 2.1\n\nTesto\n\n[ORGANIGRAMMA][/ORGANIGRAMMA]`, tutte, gruppi, "2.1");
    atteso("se un altro criterio ha già l'organigramma (nella sua ultima versione), lo dice e indica quale", avviso.includes("ATTENZIONE") && avviso.includes("[ordine 3]") && avviso.includes("Coordinamento dei Servizi in Appalto"), avviso);
    const vecchiaConOrganigramma = [sez(1, "CRITERIO 1 - Coordinamento", `x\n${ORGANIGRAMMA}`), sez(2, "CRITERIO 1 - Coordinamento", "x senza organigramma"), sez(3, "2.1 Servizio", "y")];
    atteso("conta solo l'ULTIMA versione dell'altro criterio (una versione vecchia con organigramma non basta)", avvisoOrganigrammaInAltroCriterio("[ORGANIGRAMMA][/ORGANIGRAMMA]", vecchiaConOrganigramma, raggruppaSezioni(vecchiaConOrganigramma), "2.1") === "");
    atteso("nessun avviso se la nuova bozza non ha organigramma", avvisoOrganigrammaInAltroCriterio("## 2.1\n\nSolo testo", tutte, gruppi, "2.1") === "");
    atteso("nessun avviso per il criterio che ha già il proprio organigramma (stessa chiave)", avvisoOrganigrammaInAltroCriterio(`[ORGANIGRAMMA][/ORGANIGRAMMA]`, tutte, gruppi, "1") === "");
    atteso("nessun avviso se nessun altro criterio ha l'organigramma", avvisoOrganigrammaInAltroCriterio(`[ORGANIGRAMMA][/ORGANIGRAMMA]`, versioni21, raggruppaSezioni(versioni21), "2.1") === "");
  }

  console.log("--- Le richieste più vecchie del cliente ---");
  {
    const msg = (ruolo: string, contenuto: string, ora: string) => ({ ruolo, contenuto, created_at: ISO(ora) });
    const conversazione = [
      msg("utente", "Nei criteri 2.1 - 2.3 tieni conto delle informazioni dell'Articolo 6 del Capitolato", "07:00"),
      msg("assistente", "Risposta lunga dell'assistente che non deve comparire nel promemoria", "07:05"),
      msg("utente", "ok", "07:10"),
      msg("utente", "Non parlare mai di certificazioni che non abbiamo", "07:20"),
      msg("utente", "si", "07:21"),
      ...Array.from({ length: 12 }, (_, i) => msg(i % 2 === 0 ? "utente" : "assistente", `messaggio recente ${i}`, `09:${String(10 + i)}`)),
    ];
    const memoria = memoriaRichiesteCliente(conversazione, 12);
    atteso("riporta le richieste del cliente più vecchie degli ultimi 12 messaggi", memoria.includes("Articolo 6 del Capitolato") && memoria.includes("certificazioni che non abbiamo"), memoria);
    atteso("non riporta le risposte dell'assistente", !memoria.includes("Risposta lunga"));
    atteso("non riporta i messaggi banali («ok», «si»)", !/- [^:]*: ok\b/.test(memoria) && !/: si$/m.test(memoria));
    atteso("non riporta i messaggi recenti (il modello li vede già per intero)", !memoria.includes("messaggio recente"));
    atteso("dalla più vecchia alla più recente, con l'orario", memoria.indexOf("Articolo 6") < memoria.indexOf("certificazioni") && /\d{2}:\d{2}/.test(memoria));
    atteso("senza nulla di più vecchio, nessun promemoria", memoriaRichiesteCliente(conversazione.slice(5), 12) === "" && memoriaRichiesteCliente([], 12) === "");

    const lunga = [msg("utente", `Istruzione importante ${"x".repeat(900)}`, "06:00"), msg("assistente", "ok", "06:01")];
    atteso("una richiesta lunga si accorcia a 450 caratteri", memoriaRichiesteCliente(lunga, 0).length < 520);
    const molte = Array.from({ length: 80 }, (_, i) => msg("utente", `Richiesta numero ${i} ${"y".repeat(400)}`, "06:00"));
    const memoriaMolte = memoriaRichiesteCliente(molte, 0);
    atteso("oltre il limite si tengono le più RECENTI e lo si dice", memoriaMolte.length < 6600 && memoriaMolte.includes("Richiesta numero 79") && !memoriaMolte.includes("Richiesta numero 0 ") && /richieste ancora più vecchie non sono riportate/.test(memoriaMolte), memoriaMolte.slice(0, 120));
  }

  console.log("--- La ricerca degli estratti ancorata al criterio ---");
  {
    atteso("«amplia il 2.2» cita il 2.2", JSON.stringify(criteriCitati("ok amplia il 2.2 con i tuoi suggerimenti")) === '["2.2"]');
    atteso("«criterio 2» cita il 2", JSON.stringify(criteriCitati("rigenera il criterio 2 per intero")) === '["2"]');
    atteso("«2.1 - 2.3» e «2.4» sono tre riferimenti", JSON.stringify(criteriCitati("nei criteri 2.1 - 2.3 tieni conto dell'art. 6 e nel 2.4 dell'art. 15").sort()) === '["2.1","2.3","2.4"]', JSON.stringify(criteriCitati("nei criteri 2.1 - 2.3 tieni conto dell'art. 6 e nel 2.4 dell'art. 15")));
    atteso("«10.950 ore annue» e «30 ore giornaliere» non sono criteri", criteriCitati("richiedono 30 ore giornaliere per un totale di 10.950 ore annue (art. 6 c)").length === 0);
    atteso("il numero a fine frase («…il 2.2.») è riconosciuto", JSON.stringify(criteriCitati("Procedi con il 2.2.")) === '["2.2"]');
    atteso("«1.234,50 euro» non è un criterio", criteriCitati("importo 1.234,50 euro").length === 0);

    const gara = { criteri_valutazione: CRITERI, criteri_riepilogo: [{ numero: "1", titolo: "Coordinamento dei Servizi" }, { numero: "2", titolo: "Descrizione e Organizzazione dei Servizi" }], sub_criteri_tabellari: null };
    const q = arricchisciQueryRicerca("ok amplia il 2.2", gara);
    atteso("la query contiene il messaggio e il titolo del sotto-criterio citato", q.startsWith("ok amplia il 2.2") && q.includes("Integrazione del monte ore mensile"), q);
    atteso("non contiene i titoli degli altri sotto-criteri (non porta estratti di altri criteri)", !q.includes("Organigramma e qualifiche") && !q.includes("Modalità organizzative"), q);
    atteso("«criterio 2» porta il titolo del criterio", arricchisciQueryRicerca("rigenera il criterio 2", gara).includes("Descrizione e Organizzazione dei Servizi"));
    atteso("senza riferimenti al criterio la query è il messaggio, identica", arricchisciQueryRicerca("grazie mille", gara) === "grazie mille" && arricchisciQueryRicerca("ok 10.950 ore", gara) === "ok 10.950 ore");
    atteso("un riferimento che il disciplinare non ha (7.9) lascia il messaggio com'è", arricchisciQueryRicerca("vedi il 7.9", gara) === "vedi il 7.9");
    atteso("senza criteri estratti dalla gara non fallisce", arricchisciQueryRicerca("amplia il 2.2", { criteri_valutazione: null, criteri_riepilogo: null, sub_criteri_tabellari: null }) === "amplia il 2.2");
  }

  console.log("--- Il prompt di sistema e gli strumenti ---");
  {
    const gara: GaraContesto = {
      titolo: "Gara di prova", scadenza: null, importo: null, criteri_valutazione: CRITERI, requisiti: null, limiti_formattazione: null,
      limite_pagine_totale: null, punteggio_tecnico_max: 70, criteri_riepilogo: [{ numero: "1", titolo: "Coordinamento", punti_max: 9 }], relazione_dimensione_carattere: null,
      relazione_interlinea: null, sub_criteri_tabellari: null, sedi: null, personale_uscente: null,
    };
    const elenco = testoElencoBozze(gruppi);
    const senza = buildSystemPrompt(gara, null, "", "", "", "", elenco);
    const con = buildSystemPrompt(gara, null, "", "", "", "", elenco, null, "- 26/10, 08:54: Nei criteri 2.1 - 2.3 tieni conto dell'Articolo 6");
    atteso("il prompt contiene la regola «leggi prima di riscrivere» con lo strumento", senza.includes("REGOLA PERMANENTE — RISCRIVERE, AMPLIARE, CORREGGERE O ASSEMBLARE") && senza.includes("leggi_bozza_sezione") && senza.includes("RIFIUTA la generazione"));
    atteso("il prompt non dice più «non tentare di modificare quella vecchia» (il modello deve partire da quella)", !/non tentare di modificare quella vecchia/i.test(senza) && !/non tentare di modificare quella vecchia/i.test(leggi("src/lib/gara-chat-prompt.ts")));
    atteso("il prompt contiene la separazione dei criteri (organigramma e coordinamento restano nel loro criterio)", senza.includes("SEPARAZIONE DEI CRITERI") && /organigramma di commessa/.test(senza));
    atteso("il prompt mostra l'elenco con l'ULTIMA versione", senza.includes("ULTIMA versione: [ordine 23]"));
    atteso("senza richieste precedenti non compare il blocco del promemoria", !senza.includes("RICHIESTE E ISTRUZIONI CHE IL CLIENTE HA DATO PRIMA"));
    atteso("con richieste precedenti il blocco compare con le richieste e la regola «vale la più recente»", con.includes("RICHIESTE E ISTRUZIONI CHE IL CLIENTE HA DATO PRIMA") && con.includes("tieni conto dell'Articolo 6") && con.includes("vale la più recente"));
    atteso("il prompt elenca lo strumento di lettura tra gli strumenti", /- Leggi bozza sezione \(leggi_bozza_sezione\)/.test(senza));
    const schemaLettura = LEGGI_BOZZA_TOOL.input_schema as { required?: string[]; properties?: { ordini?: { type?: string; items?: { type?: string }; minItems?: number; maxItems?: number } } };
    atteso("lo strumento di lettura chiede da 1 a 4 numeri d'ordine interi in una sola chiamata", LEGGI_BOZZA_TOOL.name === "leggi_bozza_sezione" && schemaLettura.required?.join() === "ordini" && schemaLettura.properties?.ordini?.type === "array" && schemaLettura.properties.ordini.items?.type === "integer" && schemaLettura.properties.ordini.minItems === 1 && schemaLettura.properties.ordini.maxItems === MAX_BOZZE_PER_LETTURA && MAX_BOZZE_PER_LETTURA === 4);
    atteso("lo strumento di lettura dice di passare tutte le versioni in UNA chiamata", (LEGGI_BOZZA_TOOL.description ?? "").includes("UNA sola chiamata") && senza.includes("fino a 4 numeri in UNA sola chiamata"));
    atteso("lo strumento di generazione dice di leggere prima l'ultima bozza", (buildGeneraBozzaTool(gara).description ?? "").includes("PRIMA leggi l'ultima bozza con 'leggi_bozza_sezione'"));
  }

  console.log("--- Il collegamento in gara-chat.ts (controlli sul sorgente) ---");
  {
    const chat = leggi("src/app/actions/gara-chat.ts");
    atteso("lo strumento di lettura è offerto solo se ci sono bozze da leggere", /\.\.\.\(sezioniSalvate\.length > 0 \? \[LEGGI_BOZZA_TOOL\] : \[\]\)/.test(chat));
    atteso("il ciclo riconosce leggi_bozza_sezione tra gli strumenti da eseguire", /block\.name === "leggi_bozza_sezione"/.test(chat));
    atteso("la lettura risponde con i testi richiesti (fino a 4) e non toglie gli strumenti", /leggiBozzeRichieste\(\(toolUse\.input as/.test(chat) && /content: lettura\.testo/.test(chat) && !/leggi_bozza_sezione[\s\S]{0,900}strumentiDisponibili = \[\]/.test(chat.slice(chat.indexOf('toolUse.name === "leggi_bozza_sezione"'), chat.indexOf('toolUse.name === "componi_relazione_finale"'))));
    const gestoreLettura = chat.slice(chat.indexOf('toolUse.name === "leggi_bozza_sezione"'), chat.indexOf('toolUse.name === "componi_relazione_finale"'));
    atteso("il gestore della lettura non registra la bozza come letta subito (leggere e generare nella stessa risposta non vale)", gestoreLettura.length > 100 && !gestoreLettura.includes("bozzeLette.set") && /for \(const s of lettura\.trovate\) lettureDiQuestoPassaggio\.push\(s\);/.test(gestoreLettura));
    atteso("la lettura vale per la generazione solo dal passaggio successivo (registrata a fine ciclo)", chat.includes("for (const letta of lettureDiQuestoPassaggio) bozzeLette.set(letta.ordine, letta);") && chat.indexOf("lettureDiQuestoPassaggio.push(s)") < chat.indexOf("for (const letta of lettureDiQuestoPassaggio)"));
    atteso("la generazione è rifiutata (e il ciclo continua) se la bozza esistente non è stata letta", /controllaLetturaPrimaDiGenerare\(input\.titolo_sezione \?\? "", gruppiSezioni, new Set\(bozzeLette\.keys\(\)\)\)/.test(chat) && /if \(!controlloLettura\.ok\) \{[\s\S]{0,400}is_error: true, content: testoGenerazioneRifiutata\(controlloLettura\) \}\);\s*continue;/.test(chat));
    atteso("il rifiuto avviene PRIMA di qualunque elaborazione della bozza (correzioni, modello, file)", chat.indexOf("controllaLetturaPrimaDiGenerare(input.titolo_sezione") < chat.indexOf("applicaSostituzioniAnonimizzazione(input.contenuto") && chat.indexOf("controllaLetturaPrimaDiGenerare(input.titolo_sezione") < chat.indexOf("await generaBozzaSezione("));
    atteso("dopo la generazione il modello riceve il confronto con la bozza di partenza e l'avviso sull'organigramma", /testoConfrontoPerModello\(confrontaConBozzaBase\(bozzaBase\.contenuto, contenutoFinale\), bozzaBase\.ordine\)/.test(chat) && /avvisoOrganigrammaInAltroCriterio\(contenutoFinale, sezioniSalvate, gruppiSezioni, chiaveNuova\)/.test(chat) && /content: `\$\{testoConfrontoBase\}\$\{testoOrganigrammaAltroCriterio\}/.test(chat));
    atteso("i passaggi del ciclo sono 6 (leggi → genera → risposta, anche dopo un rifiuto)", /const MAX_TOOL_ROUNDS = 6;/.test(chat));
    atteso("la ricerca degli estratti parte dal messaggio ancorato al criterio", /embedQuery\(arricchisciQueryRicerca\(messaggio, gara\), \{/.test(chat));
    atteso("la memoria delle richieste è letta dalla cronologia e passata al prompt", /storicoCompleto\.slice\(-MAX_HISTORY\)/.test(chat) && /memoriaRichiesteCliente\(storicoCompleto, MAX_HISTORY\)/.test(chat) && /fattiFigure,\s*memoriaRichieste,\s*\);/.test(chat));
    atteso("la conversazione vista per intero dal modello resta di 12 messaggi", /const MAX_HISTORY = 12;/.test(chat));
    atteso("il totale «già scritto» non somma più tutte le versioni", chat.includes("totaleUltimeVersioni(gruppiSezioni)") && !chat.includes("paroleStimate"));
    // Il prompt di sistema (~45.000 token) è rimandato a ogni passaggio del ciclo: in cache costa un decimo.
    atteso(
      "il prompt di sistema va al modello come blocco con cache (ciclo e chiusura)",
      /const sistemaPerModello: Anthropic\.TextBlockParam\[\] = \[\{ type: "text", text: systemPrompt, cache_control: \{ type: "ephemeral" \} \}\];/.test(chat) &&
        /system: sistemaPerModello,\s*tools: \[WEB_SEARCH_TOOL/.test(chat) &&
        /max_tokens: 3000,\s*system: sistemaPerModello,/.test(chat) &&
        !/system: systemPrompt,/.test(chat),
    );
    atteso(
      "i token di cache entrano nel registro dei costi (ciclo e chiusura), altrimenti il costo risulterebbe sottostimato",
      (chat.match(/cacheCreationTokens: (?:response|wrapUp)\.usage\.cache_creation_input_tokens \?\? null,\s*cacheReadTokens: (?:response|wrapUp)\.usage\.cache_read_input_tokens \?\? null,/g) ?? []).length === 2,
    );
    // Il ciclo può finire con i risultati degli strumenti e nessuna risposta (passaggi esauriti): serve la chiusura anche se c'è già del testo.
    atteso(
      "il ciclo segna quando finisce con strumenti ancora da chiudere",
      /let chiusoDaStrumenti = false;\s*for \(let round = 0; round < MAX_TOOL_ROUNDS; round\+\+\) \{\s*chiusoDaStrumenti = false;/.test(chat) &&
        /messages\.push\(\{ role: "user", content: toolResults \}\);\s*chiusoDaStrumenti = true;/.test(chat),
    );
    atteso(
      "la chiusura con risposta finale parte anche quando c'è già del testo dei passaggi precedenti",
      chat.includes("if (!rispostaFinale.trim() || chiusoDaStrumenti) {") && chat.includes("rispostaFinale = rispostaFinale.trim() && testoChiusura ?"),
    );
  }

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
