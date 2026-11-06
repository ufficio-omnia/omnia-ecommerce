// PROVA COL MODELLO VERO (a pagamento: da qualche decina di centesimi a pochi dollari per gara). NON fa parte della batteria automatica.
//
// Legge i documenti di una gara reale dalla cartella dell'archivio (PDF, Word, Excel, immagini…), fa girare TUTTA la pipeline del piano di
// lavoro (scelta dei documenti, lettura col modello, regole del codice per rese e frequenze, normalizzazione), costruisce l'Excel e confronta i
// dati trovati con quelli del piano fatto a mano per la stessa gara.
//
// Nessuna scrittura sul database né sullo storage: i file escono in test/diagnostica/piano-lavoro/<gara>/ (cartella fuori da git) e i
// costi si stampano a video. Il risultato del modello si salva in raw.json: con --riusa si rigioca tutto il codice a valle SENZA nuove chiamate.
//
// Uso: npx tsx scripts/prova-piano-lavoro-reale.ts <milanosport|scala|donnafugata|fs> [--solo-documenti] [--riusa]
//   --solo-documenti  elenca solo cosa si leggerebbe e cosa no (gratis, nessuna chiamata al modello)
//   --riusa           ricostruisce dati ed Excel dall'ultimo raw.json (gratis; macchinari dall'ultimo macchinari.json, se c'è)
//   --macchinari      con --riusa: rifà SOLO la fase macchinari col modello e la ricerca web sui dati salvati (pochi centesimi)
//   --senza-web       niente ricerca web dei prezzi per le dotazioni fuori catalogo
//   --cache           i documenti si rileggono dalla cache del modello (+25% sulla prima chiamata: conviene solo se si ripete entro 5 minuti)
import fs from "fs";
import path from "path";
import { createAnthropicClient } from "../src/lib/anthropic";
import { calcolaCostoStimato } from "../src/lib/ai-pricing";
import { preparaDocumenti, type DocumentoIn } from "../src/lib/piano-lavoro-documenti";
import { datiDaRaw, estraiPianoLavoro, type RawEstrazione, type UsoModello } from "../src/lib/piano-lavoro-estrazione";
import { calcolaPianoLavoro, elencoDatiMancanti } from "../src/lib/piano-lavoro-calcoli";
import { costruisciExcelPianoLavoro } from "../src/lib/piano-lavoro-excel";
import type { Macchinario, PianoLavoroDati } from "../src/lib/piano-lavoro-dati";
import { dimensionaMacchinari, type EsitoMacchinari } from "../src/lib/piano-lavoro-macchinari";
import { caricaCartella, ricalcola } from "./ricalcolo-formule";

process.loadEnvFile(path.join(__dirname, "..", ".env.local"));

const BASE = "G:/Il mio Drive/OMNIA/CONSULENZA GARE/GARE/1 - ZENITH SPA/";

type Attesi = {
  cig?: string;
  durataMesi?: number;
  monteOre?: number;
  importo?: number;
  sedi?: number;
  mqTotali?: number;
  personale?: { unita: number; oreSettimanali?: number };
  oreFte?: number;
  note?: string;
};

const GARE: Record<string, { cartella: string; attesi: Attesi }> = {
  milanosport: {
    cartella: "09 - SETTEMBRE/Milano Sport_30.09",
    attesi: { cig: "BC9264F446", durataMesi: 24, monteOre: 68627, importo: 3513201.59, sedi: 28, personale: { unita: 58, oreSettimanali: 1606.5 }, note: "mq per sede: dalle schede Excel degli impianti (alcune senza metrature nel piano a mano)" },
  },
  scala: {
    cartella: "09 - SETTEMBRE/TEATRO LA SCALA - 11.09",
    attesi: { cig: "BC7DC92875", durataMesi: 48, monteOre: 65443.56, sedi: 9, mqTotali: 111500, note: "organico 53 addetti (41 L2, 9 L3, 2 L4, 1 L5) nel piano a mano" },
  },
  donnafugata: {
    cartella: "08 - AGOSTO/CASTELLO DONNAFUGATA - 06.08 - ok",
    attesi: { durataMesi: 24, sedi: 55, mqTotali: 44163, personale: { unita: 29 }, note: "606 giornate lavorative in 24 mesi (303/anno); 28 addetti di 2° livello + 1 di 4°" },
  },
  fs: {
    cartella: "07 - LUGLIO/FERROVIE DEL SUD-EST - 28.07 -pr.10.08 - ok",
    attesi: { mqTotali: 218612.93, oreFte: 1573, note: "aree omogenee 1-4 (13.037 + 3.775 + 4.202 + 197.599 mq) su 7 siti; 43 emettitrici di biglietti" },
  },
};

function leggiDocumenti(cartella: string): DocumentoIn[] {
  const radice = path.join(BASE, cartella);
  const out: DocumentoIn[] = [];
  const file = (dir: string) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name !== "desktop.ini" && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "it"));
  // i file nella radice per primi, poi le sottocartelle (rettifiche, chiarimenti): è l'ordine di «caricamento» che la prova simula
  for (const n of file(radice)) out.push({ nome: n, buffer: fs.readFileSync(path.join(radice, n)) });
  for (const sub of fs.readdirSync(radice, { withFileTypes: true }).filter((e) => e.isDirectory() && !/BUSTA/i.test(e.name)).map((e) => e.name).sort()) {
    for (const n of file(path.join(radice, sub))) out.push({ nome: `${sub}/${n}`, buffer: fs.readFileSync(path.join(radice, sub, n)) });
  }
  return out;
}

const eur = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 2 });

function confronta(nome: string, trovato: unknown, atteso: unknown, tolleranza = 0) {
  if (atteso === undefined) return;
  let esito = "≠";
  if (typeof trovato === "number" && typeof atteso === "number") {
    const scarto = Math.abs(trovato - atteso) / Math.max(1, Math.abs(atteso));
    esito = scarto <= tolleranza ? "✓" : scarto <= 0.05 ? "≈" : "✗";
  } else if (trovato === atteso) esito = "✓";
  else if (trovato === null || trovato === undefined) esito = "✗";
  console.log(`  ${esito} ${nome}: trovato ${trovato === null || trovato === undefined ? "—" : typeof trovato === "number" ? eur(trovato) : trovato} | atteso ${typeof atteso === "number" ? eur(atteso) : atteso}`);
}

function riepilogo(dati: PianoLavoroDati, avvisi: string[], attesi: Attesi) {
  const r = calcolaPianoLavoro(dati);
  const par = (k: string) => dati.parametri.find((p) => p.chiave === k)?.valore ?? null;
  console.log("\n── DATI TROVATI ──");
  console.log(`Appalto: ${dati.appalto.titolo.slice(0, 110)} | ${dati.appalto.stazioneAppaltante} | CIG ${dati.appalto.cig ?? "—"} | importo ${dati.appalto.importoBase !== null ? eur(dati.appalto.importoBase) : "—"}`);
  console.log(`Parametri: durata ${par("durata_mesi") ?? "—"} mesi | giorni servizio ${par("giorni_servizio_anno") ?? "(365)"} | monte ore dichiarato ${par("monte_ore_dichiarato") ?? "—"} | ore/FTE ${par("ore_fte")}`);
  console.log(`Tipologie (${dati.tipologie.length}): ${dati.tipologie.map((t) => `${t.nome} [${t.lavorazioni.length}]`).join("; ").slice(0, 700)}`);
  const conMq = dati.sedi.filter((s) => Object.values(s.mq).some((v) => v !== null));
  console.log(`Sedi: ${dati.sedi.length} (con metrature ${conMq.length}, a misura ${dati.sedi.filter((s) => !s.aCanone).length}, con ore dichiarate ${dati.sedi.filter((s) => s.oreDichiarate !== null).length}, con canone ${dati.sedi.filter((s) => s.canone !== null).length})`);
  console.log(`Presìdi: ${dati.presidi.length} | personale uscente: ${dati.personaleUscente.map((p) => `${p.livello}:${p.unita}u/${p.oreSettimanali ?? "?"}h`).join(", ") || "—"} | livelli: ${dati.organico.map((l) => `${l.livello}=${((l.quota ?? 0) * 100).toFixed(0)}%`).join(", ")}`);
  console.log(`Monte ore calcolato: ${eur(r.oreTotali)} (sedi ${eur(r.oreSedi)} + presìdi ${eur(r.orePresidi)}) | calcolate da mq ${eur(r.totaliSedi.oreCalcolate)} | FTE ${r.fte.toFixed(1)} | ${r.esito}`);
  console.log(`Dati: ${r.conteggiOrigine.documento} da documenti, ${r.conteggiOrigine.ipotesi} ipotesi, ${r.conteggiOrigine.mancante} mancanti`);
  for (const m of elencoDatiMancanti(dati)) console.log(`  ! ${m}`);
  for (const a of dati.avvertenze.slice(0, 12)) console.log(`  • ${a.slice(0, 230)}`);
  for (const a of avvisi) console.log(`  (conversione) ${a}`);

  console.log("\n── CONFRONTO COL PIANO FATTO A MANO ──");
  if (attesi.note) console.log(`  (${attesi.note})`);
  confronta("CIG", dati.appalto.cig, attesi.cig);
  confronta("durata (mesi)", par("durata_mesi"), attesi.durataMesi);
  confronta("monte ore dichiarato", par("monte_ore_dichiarato"), attesi.monteOre, 0.001);
  confronta("importo a base di gara", dati.appalto.importoBase, attesi.importo, 0.001);
  confronta("n. sedi", dati.sedi.length, attesi.sedi);
  confronta("mq totali", r.totaliSedi.mq, attesi.mqTotali, 0.01);
  confronta("ore/FTE", par("ore_fte"), attesi.oreFte);
  if (attesi.personale) {
    confronta("personale (unità)", r.clausola.unita || dati.organico.length, attesi.personale.unita);
    confronta("ore settimanali personale", r.clausola.oreSettimanali, attesi.personale.oreSettimanali, 0.001);
  }
}

// Milanosport: confronto sede per sede delle metrature con il piano a mano
function confrontoSediMilanosport(dati: PianoLavoroDati) {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "piano-lavoro-milanosport.json"), "utf-8")) as {
    dati: { sedi: { nome: string; mq: Record<string, number | null> }[] };
    attesi: { mqTotali: number[] };
  };
  const chiave = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(piscina|centro|sportivo|cs|tennis|velodromo|palestra|tensostruttura|e|di|del)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  let esatte = 0;
  let trovate = 0;
  const diffs: string[] = [];
  fixture.dati.sedi.forEach((s, i) => {
    const atteso = fixture.attesi.mqTotali[i];
    const k = chiave(s.nome);
    const mia = dati.sedi.find((x) => chiave(x.nome) === k) ?? dati.sedi.find((x) => chiave(x.nome).includes(k) || k.includes(chiave(x.nome)));
    if (!mia) {
      diffs.push(`${s.nome}: sede non trovata (atteso ${eur(atteso)} mq)`);
      return;
    }
    trovate++;
    const mq = Object.values(mia.mq).reduce<number>((a, b) => a + (b ?? 0), 0);
    if (Math.abs(mq - atteso) <= Math.max(1, atteso * 0.01)) esatte++;
    else diffs.push(`${s.nome}: mq ${eur(mq)} contro ${eur(atteso)}`);
  });
  console.log(`  Sedi riconosciute ${trovate}/28; metrature coincidenti (±1%) ${esatte}/28`);
  for (const d of diffs.slice(0, 40)) console.log(`    - ${d}`);
}

async function main() {
  const nomeGara = process.argv[2];
  const soloDocumenti = process.argv.includes("--solo-documenti");
  const riusa = process.argv.includes("--riusa");
  const gara = GARE[nomeGara ?? ""];
  if (!gara) throw new Error(`Indica la gara: ${Object.keys(GARE).join(" | ")}`);
  const uscita = path.join(__dirname, "..", "test", "diagnostica", "piano-lavoro", nomeGara);
  fs.mkdirSync(uscita, { recursive: true });

  const documenti = leggiDocumenti(gara.cartella);
  console.log(`\n══ ${nomeGara}: ${documenti.length} file nella cartella ══`);
  const prep = await preparaDocumenti(documenti);
  console.log(`Da leggere: ${prep.principali.length} principali + ${prep.schede.length} schede (≈ ${Math.round(prep.tokenStimati / 1000)}k token in ingresso, ≈ ${eur((prep.tokenStimati / 1e6) * 3)} $ in ingresso)`);
  const perMotivo = new Map<string, number>();
  for (const s of prep.saltati) perMotivo.set(s.motivo.replace(/«.*?»/g, "«…»").replace(/\(\d+(\.\d+)? MB.*?\)/, ""), (perMotivo.get(s.motivo.replace(/«.*?»/g, "«…»").replace(/\(\d+(\.\d+)? MB.*?\)/, "")) ?? 0) + 1);
  console.log(`Non letti: ${prep.saltati.length}`);
  for (const [m, n] of perMotivo) console.log(`  ${n} × ${m}`);
  console.log("Principali:");
  for (const d of prep.principali) console.log(`  [${d.rilevanza}] ${d.nome} (${d.formato}${d.pagine ? `, ${d.pagine}p` : ""}, ≈${Math.round(d.tokenStimati / 1000)}k)`);
  if (prep.schede.length) console.log(`Schede: ${prep.schede.map((d) => d.nome).slice(0, 8).join(", ")}${prep.schede.length > 8 ? ", …" : ""}`);
  if (soloDocumenti) return;

  let raw: RawEstrazione;
  let esitoMacchinari: EsitoMacchinari | null = null;
  const conMacchinari = process.argv.includes("--macchinari");
  const usi: UsoModello[] = [];
  const inizio = Date.now();
  if (riusa) {
    raw = JSON.parse(fs.readFileSync(path.join(uscita, "raw.json"), "utf-8")) as RawEstrazione;
    console.log("\n(rigioco l'ultimo risultato del modello salvato: nessuna chiamata)");
  } else {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY non trovata in .env.local");
    process.env.OMNIA_AI_SCRIPT_PROVE = "1";
    const esito = await estraiPianoLavoro(documenti, {
      anthropic: createAnthropicClient(),
      usaCache: process.argv.includes("--cache"),
      cercaWeb: !process.argv.includes("--senza-web"),
      registraUso: (u) => {
        usi.push(u);
      },
      onProgresso: (m) => console.log(`  … ${m}`),
    });
    raw = esito.raw;
    esitoMacchinari = esito.macchinari;
    fs.writeFileSync(path.join(uscita, "raw.json"), JSON.stringify(raw, null, 1));
    console.log(`\nModello: ${esito.richieste} richieste in ${Math.round((Date.now() - inizio) / 1000)} s`);
    const costo = usi.reduce((s, u) => s + (calcolaCostoStimato(u.model, u.inputTokens, u.outputTokens, { creazione: u.cacheCreationTokens, lettura: u.cacheReadTokens }) ?? 0), 0);
    for (const u of usi) console.log(`  ${u.operazione}: ${u.inputTokens} in (+${u.cacheCreationTokens} scritti, ${u.cacheReadTokens} letti da cache) / ${u.outputTokens} out`);
    console.log(`COSTO STIMATO: ${costo.toFixed(2)} $`);
  }

  const lettiNomi = [...prep.principali, ...prep.schede].map((d) => d.nome);
  const fileMacchinari = path.join(uscita, "macchinari.json");
  const provvisori = datiDaRaw(raw, lettiNomi, prep.saltati);
  let macchinari: Macchinario[] = [];
  let avvisiMacchinari: string[] = [];
  if (!riusa && esitoMacchinari) {
    macchinari = esitoMacchinari.macchinari;
    avvisiMacchinari = esitoMacchinari.avvisi;
    fs.writeFileSync(fileMacchinari, JSON.stringify(esitoMacchinari, null, 1));
  } else if (conMacchinari) {
    // solo la fase macchinari col modello (e la ricerca web, salvo --senza-web), sui dati salvati: costa pochi centesimi
    process.env.OMNIA_AI_SCRIPT_PROVE = "1";
    const usiM: UsoModello[] = [];
    const esito = await dimensionaMacchinari(provvisori.dati, raw.macchinari_richiesti ?? [], {
      anthropic: createAnthropicClient(),
      cercaWeb: !process.argv.includes("--senza-web"),
      registraUso: (u) => {
        usiM.push(u);
      },
      onProgresso: (m) => console.log(`  … ${m}`),
    });
    macchinari = esito.macchinari;
    avvisiMacchinari = esito.avvisi;
    fs.writeFileSync(fileMacchinari, JSON.stringify(esito, null, 1));
    const costoM = usiM.reduce((s, u) => s + (calcolaCostoStimato(u.model, u.inputTokens, u.outputTokens) ?? 0), 0);
    console.log(`Macchinari: ${usiM.length} richieste, ${usiM.reduce((s, u) => s + (u.ricercheWeb ?? 0), 0)} ricerche web, costo stimato ${costoM.toFixed(2)} $ (le ricerche web si pagano a parte: circa 0,01 $ l'una)`);
  } else if (fs.existsSync(fileMacchinari)) {
    const salvato = JSON.parse(fs.readFileSync(fileMacchinari, "utf-8")) as { macchinari: Macchinario[]; avvisi: string[] };
    macchinari = salvato.macchinari;
    avvisiMacchinari = salvato.avvisi;
  } else {
    const calcolati = await dimensionaMacchinari(provvisori.dati, [], { anthropic: createAnthropicClient(), cercaWeb: false });
    macchinari = calcolati.macchinari;
  }
  const { dati, avvisi: avvisiDati } = datiDaRaw(raw, lettiNomi, prep.saltati, macchinari);
  const avvisi = [...avvisiDati, ...avvisiMacchinari];
  fs.writeFileSync(path.join(uscita, "dati.json"), JSON.stringify(dati, null, 1));
  console.log("\n── MACCHINARI E ATTREZZATURE ──");
  for (const m of dati.macchinari) console.log(`  ${m.categoria.slice(0, 11).padEnd(11)} ${String(m.quantita ?? "—").padStart(3)} × ${m.prezzoUnitario !== null ? eur(m.prezzoUnitario).padStart(9) : "     —   "} € | ${m.descrizione.slice(0, 58)} | ${m.origine}${m.riferimento ? ` | ${m.riferimento.slice(0, 40)}` : ""}`);
  const totaleMacchinari = dati.macchinari.reduce((s, m) => s + (m.quantita ?? 0) * (m.prezzoUnitario ?? 0), 0);
  console.log(`  TOTALE ${eur(totaleMacchinari)} € IVA esclusa${dati.budgetMacchinari !== null ? ` (budget dichiarato ${eur(dati.budgetMacchinari)} €)` : ""}`);
  for (const a of avvisiMacchinari) console.log(`  (macchinari) ${a}`);
  fs.writeFileSync(path.join(uscita, "dati.json"), JSON.stringify(dati, null, 1));
  riepilogo(dati, avvisi, gara.attesi);
  if (nomeGara === "milanosport") confrontoSediMilanosport(dati);

  const { buffer } = await costruisciExcelPianoLavoro(dati, { generatoIl: new Date() });
  const file = path.join(uscita, `Piano-di-Lavoro-${nomeGara}.xlsx`);
  fs.writeFileSync(file, buffer);
  // controllo sul file VERO: ogni formula ricalcolata da un motore indipendente deve coincidere col valore scritto dal codice
  const controllo = ricalcola(await caricaCartella(buffer));
  console.log(`\nFormule dell'Excel ricalcolate da un motore indipendente: ${controllo.controllate - controllo.differenze.length - controllo.errori.length}/${controllo.controllate} coincidono${controllo.errori.length + controllo.differenze.length > 0 ? ` — PROBLEMI: ${[...controllo.errori, ...controllo.differenze].slice(0, 5).join(" | ")}` : ""}`);
  console.log(`Excel scritto: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
