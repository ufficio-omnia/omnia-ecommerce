// Autotest del costo per GARA di un cliente nella console (Costi e margini, scheda del cliente).
//
// Richiesta dell'utente (28/10/2026): cliccando un cliente vedere il costo consumato per ogni sua gara. Si controlla, con dati
// sintetici (nessun database, nessuna rete), che:
//   - il costo si aggreghi per gara, con il costo del PERIODO e quello TOTALE dall'inizio, e il periodo sia «inizio compreso,
//     fine esclusa» come le funzioni SQL della console;
//   - le operazioni di prova siano escluse come nelle funzioni SQL (parità verificata sul testo della migrazione 0077);
//   - i costi senza gara (gare cancellate, assistente) stiano in una riga a parte, sempre in fondo;
//   - il totale per gara quadri con il «Costo dei modelli» e la pagina lo dica se non quadra;
//   - la lettura sia per UN cliente, a pagine, con un tetto, e un errore NON rompa il resto della scheda;
//   - il pannello compaia solo per i clienti (non per i costi senza cliente) e dentro le pagine riservate agli admin.
import fs from "fs";
import path from "path";
import {
  TITOLO_GARA_CANCELLATA,
  TITOLO_SENZA_GARA,
  aggregaCostiPerGara,
  eOperazioneDiProva,
  etichettaConsumo,
  quadraConIlTotale,
  type ConsumoGara,
  type GaraInfo,
  type OperazioneGrezza,
} from "../src/lib/console/costi-per-gara-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function vicino(nome: string, ottenuto: number, previsto: number, tolleranza = 1e-9) {
  atteso(nome, Math.abs(ottenuto - previsto) <= tolleranza, `ottenuto ${ottenuto}, previsto ${previsto}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const PERIODO = { daIso: "2026-09-30T22:00:00.000Z", aIso: "2026-10-31T23:00:00.000Z" }; // ottobre 2026 a Roma
const op = (gara: string | null, operazione: string, costo: number | null, quando: string): OperazioneGrezza => ({ gara_id: gara, operazione, costo_stimato: costo, created_at: quando });
const GARE: GaraInfo[] = [
  { id: "g1", titolo: "Istituto San Michele", created_at: "2026-10-16T10:02:48Z" },
  { id: "g2", titolo: "  Comune di Aosta  ", created_at: "2026-09-20T08:00:00Z" },
  { id: "g3", titolo: null, created_at: "2026-08-01T08:00:00Z" },
];
const CONSUMI: ConsumoGara[] = [
  { gara_id: "g1", tipo: "gratuita", created_at: "2026-10-16T10:09:45Z" },
  { gara_id: "g2", tipo: "piano", created_at: "2026-09-20T09:00:00Z" },
  { gara_id: "g2", tipo: "credito", created_at: "2026-10-05T09:00:00Z" },
  { gara_id: null, tipo: "piano", created_at: "2026-10-01T09:00:00Z" },
];

async function main() {
  console.log("--- Aggregazione per gara ---");
  const OPERAZIONI: OperazioneGrezza[] = [
    op("g1", "estrazione_gara", 1.5, "2026-10-16T10:10:00Z"),
    op("g1", "chat_gara", 0.25, "2026-10-26T08:00:00Z"),
    op("g1", "verifica_dati_aziendali", null, "2026-10-26T08:01:00Z"),
    op("g2", "chat_gara", 4, "2026-09-25T08:00:00Z"), // fuori periodo (settembre)
    op("g2", "chat_gara", 1, "2026-10-10T08:00:00Z"),
    op("g3", "chat_gara", 0.1, "2026-10-12T08:00:00Z"),
    op(null, "chat_assistenza", 9, "2026-10-12T09:00:00Z"), // la più costosa, ma senza gara
    op("g1", "prova:qualcosa", 100, "2026-10-17T08:00:00Z"), // esclusa
    op("g1", "prova-leggero:altro", 100, "2026-10-17T08:00:00Z"), // esclusa
    op("g4", "chat_gara", 2, "2026-10-13T08:00:00Z"), // gara che non esiste più nell'anagrafica
  ];
  const r = aggregaCostiPerGara(OPERAZIONI, GARE, CONSUMI, PERIODO);
  const per = (id: string | null) => r.righe.find((x) => x.garaId === id);

  atteso("una riga per gara con operazioni, più la riga senza gara (5 righe)", r.righe.length === 5, r.righe.map((x) => x.garaId).join());
  atteso("le gare senza operazioni non compaiono", !r.righe.some((x) => x.garaId === "g99"));
  vicino("g1: costo del periodo = somma delle operazioni con costo (le senza costo non contano)", per("g1")!.costoPeriodoUsd, 1.75);
  atteso("g1: le operazioni senza costo si contano a parte", per("g1")!.senzaCostoPeriodo === 1 && per("g1")!.senzaCostoTotali === 1 && per("g1")!.operazioniPeriodo === 3);
  vicino("g2: il costo del periodo conta solo ottobre", per("g2")!.costoPeriodoUsd, 1);
  vicino("g2: il costo totale conta anche settembre", per("g2")!.costoTotaleUsd, 5);
  atteso("g2: operazioni nel periodo 1, in totale 2", per("g2")!.operazioniPeriodo === 1 && per("g2")!.operazioniTotali === 2);
  atteso("il titolo è pulito dagli spazi", per("g2")!.titolo === "Comune di Aosta");
  atteso("una gara senza titolo ha il titolo di riserva", per("g3")!.titolo === TITOLO_GARA_CANCELLATA);
  atteso("una gara che non è più in anagrafica ha il titolo di riserva e nessuna data di creazione", per("g4")!.titolo === TITOLO_GARA_CANCELLATA && per("g4")!.creataIl === null);
  atteso("la data di creazione della gara è riportata", per("g1")!.creataIl === "2026-10-16T10:02:48Z");
  vicino("le operazioni di prova sono escluse (g1 non include i 200 dollari di prova)", per("g1")!.costoTotaleUsd, 1.75);
  atteso("la prima e l'ultima attività sono le date delle operazioni (prove escluse)", per("g1")!.primaAttivita === "2026-10-16T10:10:00Z" && per("g1")!.ultimaAttivita === "2026-10-26T08:01:00Z", `${per("g1")!.primaAttivita} / ${per("g1")!.ultimaAttivita}`);

  console.log("--- La riga senza gara ---");
  const senza = per(null)!;
  atteso("esiste, con il suo titolo", Boolean(senza) && senza.titolo === TITOLO_SENZA_GARA);
  atteso("sta sempre in fondo anche se è la più costosa", r.righe[r.righe.length - 1].garaId === null && senza.costoPeriodoUsd === 9);
  atteso("non ha un tipo di consumo né una data di creazione", senza.consumo === null && senza.creataIl === null);

  console.log("--- Ordine e totali ---");
  atteso("ordine: la più costosa nel periodo per prima (g1 1,75; g4 2 → prima g4)", r.righe.slice(0, 4).map((x) => x.garaId).join() === "g4,g1,g2,g3", r.righe.map((x) => x.garaId).join());
  vicino("totale del periodo = somma dei costi del periodo di tutte le righe", r.totalePeriodoUsd, 1.75 + 1 + 0.1 + 9 + 2);
  vicino("totale dall'inizio = somma dei costi totali di tutte le righe", r.totaleUsd, 1.75 + 5 + 0.1 + 9 + 2);
  const parita = aggregaCostiPerGara([op("a", "x", 1, "2026-10-05T08:00:00Z"), op("b", "x", 1, "2026-10-04T08:00:00Z"), op("b", "x", 5, "2026-08-04T08:00:00Z")], [], [], PERIODO);
  atteso("a parità di costo nel periodo vince quella con il costo totale maggiore", parita.righe.map((x) => x.garaId).join() === "b,a", parita.righe.map((x) => x.garaId).join());

  console.log("--- Il periodo: inizio compreso, fine esclusa ---");
  const bordi = aggregaCostiPerGara(
    [op("g1", "x", 1, "2026-09-30T22:00:00.000Z"), op("g1", "x", 10, "2026-10-31T23:00:00.000Z"), op("g1", "x", 100, "2026-09-30T21:59:59.999Z"), op("g1", "x", 1000, "2026-10-31T22:59:59.999Z")],
    GARE,
    [],
    PERIODO,
  );
  vicino("la mezzanotte di inizio è dentro, la mezzanotte di fine è fuori", bordi.righe[0].costoPeriodoUsd, 1001);
  vicino("il costo totale conta tutto", bordi.righe[0].costoTotaleUsd, 1111);

  console.log("--- Come è stata pagata la gara ---");
  atteso("gara gratuita", per("g1")!.consumo === "gratuita");
  atteso("con più consumi conta il primo in ordine di tempo (piano, non il credito di ottobre)", per("g2")!.consumo === "piano");
  atteso("senza consumo registrato: nessun tipo", per("g3")!.consumo === null);
  atteso("un consumo con gara cancellata (gara_id nullo) non si attribuisce a nessuna gara", !r.righe.some((x) => x.garaId !== null && x.consumo === "piano" && x.garaId === "g3"));
  const strano = aggregaCostiPerGara([op("g1", "x", 1, "2026-10-05T08:00:00Z")], GARE, [{ gara_id: "g1", tipo: "regalo", created_at: "2026-10-01T00:00:00Z" }], PERIODO);
  atteso("un tipo di consumo sconosciuto è «altro», non un errore", strano.righe[0].consumo === "altro");
  atteso("le etichette", etichettaConsumo("piano") === "piano" && etichettaConsumo("credito") === "crediti" && etichettaConsumo("gratuita") === "gara gratuita" && etichettaConsumo(null) === "nessun consumo registrato" && etichettaConsumo("altro") === "altro");

  console.log("--- Valori strani e casi vuoti ---");
  atteso("nessuna operazione: nessuna riga e totali a zero", (() => { const v = aggregaCostiPerGara([], GARE, CONSUMI, PERIODO); return v.righe.length === 0 && v.totalePeriodoUsd === 0 && v.totaleUsd === 0; })());
  const nan = aggregaCostiPerGara([op("g1", "x", Number.NaN, "2026-10-05T08:00:00Z"), op("g1", "x", 2, "2026-10-06T08:00:00Z")], GARE, [], PERIODO);
  vicino("un costo non numerico vale zero e non rovina il totale", nan.righe[0].costoPeriodoUsd, 2);
  atteso("solo operazioni di prova: nessuna riga", aggregaCostiPerGara([op("g1", "prova:x", 5, "2026-10-05T08:00:00Z")], GARE, [], PERIODO).righe.length === 0);
  atteso("eOperazioneDiProva riconosce i due prefissi e nient'altro", eOperazioneDiProva("prova:x") && eOperazioneDiProva("prova-leggero:y") && !eOperazioneDiProva("chat_gara") && !eOperazioneDiProva("estrazione_gara") && !eOperazioneDiProva("una prova:x"));

  console.log("--- Parità con le funzioni SQL della console (migrazione 0077) ---");
  {
    const sql = leggi("supabase/migrations/0077_console_costi_clienti.sql");
    const blocco = sql.slice(sql.indexOf("create or replace function public.console_costi_per_operazione"), sql.indexOf("create or replace function public.console_gare_consumate"));
    atteso("la funzione SQL per operazione esclude gli stessi due prefissi di prova", blocco.includes("not starts_with(o.operazione, 'prova:')") && blocco.includes("not starts_with(o.operazione, 'prova-leggero:')"));
    atteso("la funzione SQL conta le operazioni del periodo con inizio compreso e fine esclusa", blocco.includes("o.created_at >= p_da and o.created_at < p_a"));
    atteso("la funzione SQL somma costo_stimato (le operazioni senza costo non contano)", blocco.includes("coalesce(sum(o.costo_stimato), 0)"));
  }

  console.log("--- Quadratura con il costo dei modelli ---");
  atteso("tolleranza di un centesimo di dollaro", quadraConIlTotale(10, 10.009) && quadraConIlTotale(10, 9.991) && !quadraConIlTotale(10, 10.02) && !quadraConIlTotale(10, 9.98));

  console.log("--- La lettura (controlli sul sorgente) ---");
  {
    const lib = leggi("src/lib/console/costi.ts");
    atteso("legge le operazioni di UN solo cliente", /\.from\("ai_operazioni"\)[\s\S]{0,200}\.eq\("user_id", userId\)/.test(lib));
    atteso("legge a pagine di 1000 con ordine stabile (data e id) e un tetto di 20.000", lib.includes("const OPERAZIONI_PER_PAGINA = 1000;") && lib.includes("const MAX_OPERAZIONI_LETTE = 20_000;") && /\.order\("created_at", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)\s*\.range\(da, da \+ OPERAZIONI_PER_PAGINA - 1\)/.test(lib));
    atteso("oltre il tetto lo dice (troncato)", /return \{ righe, troncato: true \};/.test(lib));
    atteso("i consumi sono quelli del cliente", /\.from\("gara_consumi"\)\.select\("gara_id, tipo, created_at"\)\.eq\("user_id", userId\)/.test(lib));
    atteso("un errore nel costo per gara non rompe la scheda (try/catch, resto della pagina com'era)", /let perGaraErrore = false;\s*if \(userId\) \{\s*try \{\s*perGara = await leggiCostiPerGaraCliente\(userId, periodo\);\s*\} catch \(e\) \{[\s\S]{0,200}perGaraErrore = true;/.test(lib));
    atteso("per i costi senza cliente (userId nullo) non si legge nulla", /if \(userId\) \{\s*try \{\s*perGara = await leggiCostiPerGaraCliente/.test(lib));
    atteso("il dettaglio restituisce perGara e perGaraErrore", /perGara,\s*perGaraErrore,/.test(lib));
    const calcoli = leggi("src/lib/console/costi-per-gara-calcoli.ts");
    atteso("il modulo di calcolo è puro (nessun database, nessun import di rete)", !/from "@\/lib\/supabase|createAdminClient|fetch\(/.test(calcoli));
  }

  console.log("--- La scheda del cliente (controlli sul sorgente) ---");
  {
    const vista = leggi("src/app/site-console/_componenti/costi-dettaglio-vista.tsx");
    atteso("il pannello «Costo per gara» c'è, solo per i clienti (non per i costi senza cliente)", /\{!piattaforma && \(\s*<div className="cn-sezione">\s*<Pannello titolo="Costo per gara">/.test(vista));
    atteso("le colonne: gara, pagata con, operazioni nel periodo, costo nel periodo, costo totale dall'inizio, ultima attività", ["<th>Gara</th>", "<th>Pagata con</th>", "Operazioni nel periodo", "Costo nel periodo", "Costo totale dall&apos;inizio", "Ultima attività"].every((t) => vista.includes(t)));
    atteso("il costo è mostrato in euro (cambio impostato) e in dollari", vista.includes("euro(g.costoPeriodoUsd)") && vista.includes("formattaUsd(g.costoPeriodoUsd, 2)") && vista.includes("euro(g.costoTotaleUsd)"));
    atteso("la riga di totale c'è", vista.includes("euro(dettaglio.perGara.costi.totalePeriodoUsd)") && vista.includes("euro(dettaglio.perGara.costi.totaleUsd)"));
    atteso("se la lettura è fallita lo dice senza toccare il resto della scheda", vista.includes("dettaglio.perGaraErrore || !dettaglio.perGara") && vista.includes("Non sono riuscito a leggere il costo per gara"));
    atteso("se la somma non quadra col costo dei modelli lo dice", vista.includes("!quadraConIlTotale(dettaglio.perGara.costi.totalePeriodoUsd, costoTotaleUsd)"));
    atteso("se la lettura è stata troncata lo dice", vista.includes("dettaglio.perGara.troncato"));
    atteso("spiega che anche il lavoro dell'Ufficio Gare è sotto il titolare e che le gare cancellate finiscono nell'ultima riga", vista.includes("Ufficio Gare") && vista.includes("Le gare cancellate non hanno più il legame"));
    atteso("l'etichetta «nessun consumo registrato» non è un errore (badge neutro)", vista.includes('tono={g.consumo === "piano" || g.consumo === null ? "neutro" : "avviso"}'));
    const pagina = leggi("src/app/site-console/(app)/costi/[utente]/page.tsx");
    atteso("la pagina è riservata agli admin e li verifica prima di leggere i dati", pagina.indexOf("await richiediAdminPagina()") > -1 && pagina.indexOf("await richiediAdminPagina()") < pagina.indexOf("await leggiDettaglioCliente("));
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
