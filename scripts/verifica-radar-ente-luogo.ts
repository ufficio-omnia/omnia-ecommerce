// Verifica della regola «ente e luogo» dell'unione multifonte (difetto del giro di prova PVL del 24/11/2026 sullo staging, documento 54):
// la PVL scriveva come sede dell'ente il luogo di esecuzione del primo lotto e l'unione copiava il gruppo «luogo» per intero, anche vuoto.
// Casi presi dalle gare vere dello staging e resi ANONIMI (enti e codici fiscali sintetici; restano solo i comuni e le regioni, che sono
// il difetto). Nessuna rete, nessun database vero: logica pura e l'importatore PVL vero su un database in memoria.
// Uso: npx tsx scripts/verifica-radar-ente-luogo.ts
import fs from "fs";
import path from "path";
import { databaseInMemoria, type RigaMem } from "./lib/db-in-memoria";
import { leggiAvvisoPvl, type BandoPvl } from "../src/lib/radar/fonti/pvl-calcoli";
import { rigaDaBandoPvl, statistichePvlVuote } from "../src/lib/radar/importa-pvl-calcoli";
import { applicaPaginaBandiPvl } from "../src/lib/radar/importa-pvl-pagina";
import type { RigaProcedura } from "../src/lib/radar/importa-calcoli";
import { GRUPPI_CAMPI, SEDE_DELL_ENTE, completaSede, indicaLaSede, unisciVersione, type ProvenienzaCampi, type VersioneFonte } from "../src/lib/radar/unione-calcoli";

const fallimenti: string[] = [];
let ok = 0;
function atteso(nome: string, condizione: boolean, dettaglio = "") {
  if (condizione) ok++;
  else fallimenti.push(`${nome}${dettaglio ? ` — ${dettaglio}` : ""}`);
}
function uguale(nome: string, reale: unknown, previsto: unknown) {
  const a = JSON.stringify(reale);
  const b = JSON.stringify(previsto);
  atteso(nome, a === b, `atteso ${b}, ottenuto ${a}`);
}
const leggi = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

const ADESSO = new Date("2026-11-24T14:32:00Z");
const ISO = ADESSO.toISOString();
const campione = JSON.parse(leggi("scripts/dati/radar-pvl-campione.json")) as { avvisi: Record<string, unknown>[] };
const venezia = leggiAvvisoPvl(campione.avvisi[1]) as BandoPvl;
const BASE = rigaDaBandoPvl(venezia, ADESSO);

type Sede = { comune: string | null; provincia: string | null; regione: string | null; regioni: string[] };
const conSede = (r: RigaProcedura, s: Sede, ente?: { cf: string | null; nome: string | null }): RigaProcedura => ({
  ...r,
  sa_comune: s.comune,
  sa_provincia: s.provincia,
  sa_regione: s.regione,
  luogo_regioni: s.regioni,
  ...(ente ? { sa_codice_fiscale: ente.cf, sa_denominazione: ente.nome } : {}),
});
const sedeDi = (r: RigaProcedura) => [r.sa_comune, r.sa_provincia, r.sa_regione, r.luogo_regioni];
const fonte = (p: ProvenienzaCampi, g: string) => p[g]?.f ?? null;

const vTed: VersioneFonte = { fonte: "ted", id: "800100-2026", giorno: "2026-11-17", istante: null, ted: "800100-2026" };
const vPvl: VersioneFonte = { fonte: "pvl", id: "avviso-sintetico-1", giorno: "2026-11-18", istante: "2026-11-18T07:00:00.000Z", ted: "800100-2026" };
const vPvl2: VersioneFonte = { fonte: "pvl", id: "avviso-sintetico-2", giorno: "2026-11-20", istante: "2026-11-20T07:00:00.000Z", ted: null };
const vTed2: VersioneFonte = { fonte: "ted", id: "800200-2026", giorno: "2026-11-22", istante: null, ted: "800200-2026" };
const vSintel: VersioneFonte = { fonte: "sintel", id: "900001", giorno: "2026-11-18", istante: null, ted: null };
type Ente = { cf: string | null; nome: string | null };
const ted = (s: Sede, ente: Ente = { cf: "00000000001", nome: "Ente sintetico - Ufficio acquisti" }) => conSede({ ...BASE, chiave: "ted:proc-sintetica", ultima_versione_id: vTed.id, ultima_versione_il: vTed.giorno }, s, ente);
const pvl = (s: Sede, ente: Ente = { cf: "00000000001", nome: "ENTE SINTETICO" }) => conSede(BASE, s, ente);
const sintel = (s: Sede) => conSede({ ...BASE, chiave: "sintel:900001" }, s, { cf: "00000000001", nome: "Comune sintetico" });
/** Prima una fonte (gara nuova, provenienza esplicita), poi l'altra. */
function unite(r1: RigaProcedura, v1: VersioneFonte, r2: RigaProcedura, v2: VersioneFonte) {
  const a = unisciVersione(null, null, r1, v1, ISO);
  return { prima: a, dopo: unisciVersione(a.riga, a.provenienza, r2, v2, ISO) };
}

async function principale() {
  // ───── 1. la regola, fonte per fonte ─────
  uguale("sede dell'ente: TED, Sintel e SardegnaCAT sì, la PVL no (luogo di esecuzione)", SEDE_DELL_ENTE, { ted: true, sintel: true, sardegnacat: true, pvl: false });
  uguale("una fonte sconosciuta vale come sede (regole di sempre)", [indicaLaSede("ted"), indicaLaSede("pvl"), indicaLaSede("altra")], [true, false, true]);
  uguale("gruppi: la sede (3 campi) e le regioni del luogo di esecuzione sono separate", GRUPPI_CAMPI.filter((g) => g.nome === "luogo" || g.nome === "luogo_regioni").map((g) => [g.nome, g.colonne]), [["luogo", ["sa_comune", "sa_provincia", "sa_regione"]], ["luogo_regioni", ["luogo_regioni"]]]);

  // ───── 2. casi delle gare dello staging (anonimi) ─────
  {
    // 63e0b112, a092afc1, a0c6c4b0: sede a Roma (TED), esecuzione a Trieste (PVL) → la sede resta Roma
    const { dopo } = unite(ted({ comune: "Roma", provincia: "RM", regione: "lazio", regioni: ["friuli_venezia_giulia"] }), vTed, pvl({ comune: "Trieste", provincia: "TS", regione: "friuli_venezia_giulia", regioni: ["friuli_venezia_giulia"] }), vPvl);
    uguale("sede TED a Roma, esecuzione PVL a Trieste: la sede resta Roma (RM, Lazio), le regioni restano Friuli", sedeDi(dopo.riga), ["Roma", "RM", "lazio", ["friuli_venezia_giulia"]]);
    uguale("… provenienza della sede: TED; il nome dell'ente resta della PVL (precedenza)", [fonte(dopo.provenienza, "luogo"), dopo.riga.sa_denominazione, fonte(dopo.provenienza, "ente")], ["ted", "ENTE SINTETICO", "pvl"]);
  }
  {
    // aa7b73ba, d1e67ebf: la PVL ha il comune ma non riconosce la provincia (luogo_nuts «ITALIA») → regione e regioni NON si svuotano
    const { dopo } = unite(ted({ comune: "Verbania", provincia: null, regione: "piemonte", regioni: ["piemonte"] }), vTed, pvl({ comune: "Baveno", provincia: null, regione: null, regioni: [] }), vPvl);
    uguale("PVL senza regione (comune di esecuzione diverso): sede e regioni TED intatte", sedeDi(dopo.riga), ["Verbania", null, "piemonte", ["piemonte"]]);
    const { dopo: stesso } = unite(ted({ comune: "Roma", provincia: null, regione: "lazio", regioni: ["lazio"] }), vTed, pvl({ comune: "Roma", provincia: null, regione: null, regioni: [] }), vPvl);
    uguale("PVL senza regione, stesso comune: regione e regioni TED intatte", sedeDi(stesso.riga), ["Roma", null, "lazio", ["lazio"]]);
  }
  {
    // 56a35499: Sintel (sede Cassano Magnago, Lombardia) unita alla PVL (esecuzione a Taino, regione non riconosciuta)
    const { dopo } = unite(sintel({ comune: "Cassano Magnago", provincia: null, regione: "lombardia", regioni: ["lombardia"] }), vSintel, pvl({ comune: "Taino", provincia: null, regione: null, regioni: [] }), vPvl);
    uguale("Sintel + PVL: la sede Sintel e la Lombardia restano", [...sedeDi(dopo.riga), fonte(dopo.provenienza, "luogo"), fonte(dopo.provenienza, "luogo_regioni")], ["Cassano Magnago", null, "lombardia", ["lombardia"], "sintel", "sintel"]);
  }
  {
    // 39d1677f, eece0a2e, f1dfce83…: stesso comune → la PVL riempie la provincia mancante (riempimento utile che resta)
    const { dopo } = unite(ted({ comune: "Milano", provincia: null, regione: "lombardia", regioni: ["lombardia"] }), vTed, pvl({ comune: "MILANO", provincia: "MI", regione: "lombardia", regioni: ["lombardia"] }), vPvl);
    uguale("stesso comune (anche scritto diverso): la provincia mancante si riempie dalla PVL", [...sedeDi(dopo.riga), fonte(dopo.provenienza, "luogo"), dopo.campiPresi.includes("luogo")], ["Milano", "MI", "lombardia", ["lombardia"], "ted", true]);
    // b67246d0: TED con il comune ma senza regione
    const { dopo: napoli } = unite(ted({ comune: "Napoli", provincia: null, regione: null, regioni: ["campania"] }), vTed, pvl({ comune: "Napoli", provincia: "NA", regione: "campania", regioni: ["campania"] }), vPvl);
    uguale("stesso comune: anche la regione mancante si riempie", sedeDi(napoli.riga), ["Napoli", "NA", "campania", ["campania"]]);
  }
  {
    // dc2b688a, e5425e6a, a8f5c7db: comune di esecuzione diverso → la provincia della PVL NON si attacca alla sede (mai indovinata)
    const { dopo } = unite(ted({ comune: "Casarano", provincia: null, regione: "puglia", regioni: ["puglia"] }), vTed, pvl({ comune: "Taviano", provincia: "LE", regione: "puglia", regioni: ["puglia"] }), vPvl);
    uguale("comune diverso: la sede TED resta senza provincia (quella della PVL è di un altro comune)", sedeDi(dopo.riga), ["Casarano", null, "puglia", ["puglia"]]);
    const { dopo: bo } = unite(ted({ comune: "Bologna", provincia: null, regione: "emilia_romagna", regioni: ["emilia_romagna"] }), vTed, pvl({ comune: "Ravenna", provincia: "RA", regione: "emilia_romagna", regioni: ["emilia_romagna", "veneto"] }), vPvl);
    uguale("comune diverso: sede TED senza provincia; le regioni di esecuzione della PVL valgono (precedenza)", sedeDi(bo.riga), ["Bologna", null, "emilia_romagna", ["emilia_romagna", "veneto"]]);
  }

  // ───── 3. le due direzioni e le gare scritte prima del 24/11 ─────
  {
    // gare nate dalla PVL (063a078f…): arriva TED con la sede → la sede TED sostituisce il luogo di esecuzione
    const { dopo } = unite(pvl({ comune: "Pisa", provincia: "PI", regione: "toscana", regioni: ["toscana"] }), vPvl, ted({ comune: "Lucca", provincia: "LU", regione: "toscana", regioni: ["toscana"] }), vTed);
    uguale("prima la PVL, poi TED: la sede TED sostituisce il luogo di esecuzione PVL", [...sedeDi(dopo.riga), fonte(dopo.provenienza, "luogo"), fonte(dopo.provenienza, "luogo_regioni")], ["Lucca", "LU", "toscana", ["toscana"], "ted", "pvl"]);
    const poi = unisciVersione(dopo.riga, dopo.provenienza, pvl({ comune: "Pisa", provincia: "PI", regione: "toscana", regioni: ["toscana"] }), vPvl2, ISO);
    uguale("… e una versione PVL più recente non la riporta al luogo di esecuzione", sedeDi(poi.riga), ["Lucca", "LU", "toscana", ["toscana"]]);
  }
  {
    // 5f6adcdd, 865c1977: gara della PVL scritta prima del 24/11 (provenienza «luogo» unica) senza regioni, poi Sintel
    const legacy = pvl({ comune: "Magnago", provincia: null, regione: null, regioni: [] });
    const pvVecchia = { f: "pvl" as const, id: "avviso-vecchio", g: "2026-11-16", t: "2026-11-16T07:00:00.000Z", ted: null };
    const provVecchia: ProvenienzaCampi = { _versione: pvVecchia, luogo: pvVecchia, ente: pvVecchia, oggetto: pvVecchia };
    const u = unisciVersione(legacy, provVecchia, sintel({ comune: "Magnago", provincia: null, regione: "lombardia", regioni: ["lombardia"] }), vSintel, ISO);
    uguale("gara PVL di prima del 24/11 senza regioni, poi Sintel: sede Sintel e Lombardia", [...sedeDi(u.riga), fonte(u.provenienza, "luogo"), fonte(u.provenienza, "luogo_regioni")], ["Magnago", null, "lombardia", ["lombardia"], "sintel", "sintel"]);
    // gara scritta prima del 24/11 con regioni PVL: le regioni ereditano la provenienza PVL (precedenza), la sede passa a TED
    const legacy2 = pvl({ comune: "Padova", provincia: "PD", regione: "veneto", regioni: ["veneto"] });
    const u2 = unisciVersione(legacy2, provVecchia, ted({ comune: "Venezia", provincia: "VE", regione: "veneto", regioni: ["lazio"] }), vTed, ISO);
    uguale("gara PVL di prima del 24/11 con regioni, poi TED: sede TED, regioni PVL (provenienza ereditata, resa esplicita)", [...sedeDi(u2.riga), fonte(u2.provenienza, "luogo"), fonte(u2.provenienza, "luogo_regioni")], ["Venezia", "VE", "veneto", ["veneto"], "ted", "pvl"]);
    // gara TED unita alla PVL prima del 24/11 (regioni PVL sotto la provenienza «luogo», ultima versione TED): una rettifica TED più
    // recente con altre regioni non le sostituisce (la PVL ha la precedenza sulle regioni di esecuzione; senza l'eredità TED le prenderebbe)
    const pvTed = { f: "ted" as const, id: vTed.id, g: vTed.giorno, t: null, ted: vTed.id };
    const legacy3 = ted({ comune: "Venezia", provincia: "VE", regione: "veneto", regioni: ["veneto"] });
    const u5 = unisciVersione(legacy3, { _versione: pvTed, luogo: pvVecchia, ente: pvTed, scadenza: pvTed }, ted({ comune: "Venezia", provincia: "VE", regione: "veneto", regioni: ["lazio"] }), vTed2, ISO);
    uguale("gara TED unita alla PVL prima del 24/11: una rettifica TED non sostituisce le regioni PVL (provenienza ereditata)", [u5.riga.luogo_regioni, fonte(u5.provenienza, "luogo_regioni")], [["veneto"], "pvl"]);
    // gara TED importata prima della 0115 (provenienza vuota), poi la PVL: la sede resta TED e la sua provenienza diventa esplicita
    const u3 = unisciVersione(ted({ comune: "Roma", provincia: "RM", regione: "lazio", regioni: ["lazio"] }), null, pvl({ comune: "Firenze", provincia: "FI", regione: "toscana", regioni: ["toscana"] }), vPvl, ISO);
    uguale("gara TED senza provenienza, poi la PVL: sede TED con provenienza esplicita TED (non cambia con l'ultima versione)", [...sedeDi(u3.riga), fonte(u3.provenienza, "luogo"), u3.riga.ultima_versione_id.startsWith("pvl:")], ["Roma", "RM", "lazio", ["toscana"], "ted", true]);
    const u4 = unisciVersione(u3.riga, u3.provenienza, pvl({ comune: "Firenze", provincia: "FI", regione: "toscana", regioni: ["toscana"] }), vPvl2, ISO);
    uguale("… e la versione PVL successiva non la tocca", sedeDi(u4.riga).slice(0, 3), ["Roma", "RM", "lazio"]);
  }

  // ───── 4. una sola fonte: nulla di presente si svuota; il resto come prima ─────
  {
    const a = unisciVersione(null, null, pvl({ comune: "Roma", provincia: "RM", regione: "lazio", regioni: ["lazio"] }), vPvl, ISO);
    const b = unisciVersione(a.riga, a.provenienza, pvl({ comune: "Roma", provincia: null, regione: null, regioni: [] }), vPvl2, ISO);
    uguale("sola PVL, versione più recente senza provincia riconosciuta: sede e regioni restano", sedeDi(b.riga), ["Roma", "RM", "lazio", ["lazio"]]);
    const c = unisciVersione(a.riga, a.provenienza, pvl({ comune: "Firenze", provincia: "FI", regione: "toscana", regioni: ["toscana"] }), vPvl2, ISO);
    uguale("sola PVL, versione più recente con un altro luogo completo: lo sostituisce (come prima)", sedeDi(c.riga), ["Firenze", "FI", "toscana", ["toscana"]]);
    const d = unisciVersione(a.riga, a.provenienza, pvl({ comune: "Firenze", provincia: null, regione: null, regioni: [] }), vPvl2, ISO);
    uguale("sola PVL, versione più recente con un altro comune senza provincia: nessuna provincia di un altro comune", sedeDi(d.riga), ["Firenze", null, null, ["lazio"]]);
    const t = unisciVersione(null, null, ted({ comune: "Torino", provincia: "TO", regione: "piemonte", regioni: ["piemonte"] }), vTed, ISO);
    const t2 = unisciVersione(t.riga, t.provenienza, { ...ted({ comune: null, provincia: null, regione: null, regioni: [] }, { cf: null, nome: null }), valore_stimato: null, codice_nuts: null, ultima_versione_id: vTed2.id }, vTed2, ISO);
    uguale("sola TED, versione più recente senza città, ente e NUTS: nulla si svuota", [...sedeDi(t2.riga), t2.riga.sa_codice_fiscale, t2.riga.sa_denominazione, t2.riga.codice_nuts === t.riga.codice_nuts], ["Torino", "TO", "piemonte", ["piemonte"], "00000000001", "Ente sintetico - Ufficio acquisti", true]);
    uguale("… gli altri dati di una sola fonte restano come prima (il valore tolto si toglie e si registra)", [t2.riga.valore_stimato, t2.cambiamenti.map((x) => `${x.tipo}:${x.campo}`)], [null, ["rettifica:valore_stimato"]]);
  }

  // ───── 5. ente: un codice fiscale o un nome non si perdono mai ─────
  {
    const { dopo } = unite(ted({ comune: "Torino", provincia: "TO", regione: "piemonte", regioni: ["piemonte"] }, { cf: "00000000002", nome: "Ente sintetico" }), vTed, pvl({ comune: "Torino", provincia: "TO", regione: "piemonte", regioni: ["piemonte"] }, { cf: null, nome: "ENTE SINTETICO" }), vPvl);
    uguale("la PVL senza codice fiscale: il nome è della PVL, il codice fiscale TED resta", [dopo.riga.sa_denominazione, dopo.riga.sa_codice_fiscale], ["ENTE SINTETICO", "00000000002"]);
    const { dopo: inverso } = unite(pvl({ comune: "Torino", provincia: "TO", regione: "piemonte", regioni: ["piemonte"] }, { cf: null, nome: "ENTE SINTETICO" }), vPvl, ted({ comune: "Torino", provincia: "TO", regione: "piemonte", regioni: ["piemonte"] }, { cf: "00000000002", nome: "Ente sintetico" }), vTed);
    uguale("prima la PVL senza codice fiscale, poi TED: il codice fiscale si riempie, il nome resta della PVL", [inverso.riga.sa_denominazione, inverso.riga.sa_codice_fiscale, inverso.campiPresi.includes("ente"), fonte(inverso.provenienza, "ente")], ["ENTE SINTETICO", "00000000002", true, "pvl"]);
  }

  // ───── 6. due fonti che danno la sede (Sintel e TED) ─────
  {
    const { dopo } = unite(ted({ comune: "Varese", provincia: "VA", regione: "lombardia", regioni: ["lombardia"] }), vTed, sintel({ comune: null, provincia: null, regione: "lombardia", regioni: ["lombardia"] }), vSintel);
    uguale("Sintel senza comune (centrale di committenza) su TED: precedenza a Sintel, campi vuoti riempiti da TED (stessa regione)", [...sedeDi(dopo.riga), fonte(dopo.provenienza, "luogo")], ["Varese", "VA", "lombardia", ["lombardia"], "sintel"]);
    const { dopo: altra } = unite(ted({ comune: "Novara", provincia: "NO", regione: "piemonte", regioni: ["piemonte"] }), vTed, sintel({ comune: null, provincia: null, regione: "lombardia", regioni: ["lombardia"] }), vSintel);
    uguale("… con una regione diversa nessun riempimento", sedeDi(altra.riga).slice(0, 3), [null, null, "lombardia"]);
  }
  {
    const s = (comune: string | null, provincia: string | null, regione: string | null) => ({ sa_comune: comune, sa_provincia: provincia, sa_regione: regione });
    const r1 = s("Forlì", null, null);
    uguale("completaSede: stesso comune senza accenti e maiuscole", [completaSede(r1, s("FORLI", "FC", "emilia_romagna"), false), r1], [true, s("Forlì", "FC", "emilia_romagna")]);
    const r2 = s("Forlì", null, null);
    uguale("completaSede: luogo di esecuzione di un altro comune → nulla", [completaSede(r2, s("Cesena", "FC", "emilia_romagna"), false), r2], [false, s("Forlì", null, null)]);
    const r3 = s(null, null, "lombardia");
    uguale("completaSede: comune mancante, il luogo di esecuzione (PVL) non diventa la sede", [completaSede(r3, s("Milano", "MI", "lombardia"), false), r3], [false, s(null, null, "lombardia")]);
    const r4 = s("Milano", "MI", "lombardia");
    uguale("completaSede: nulla da riempire → false", completaSede(r4, s("Milano", "MI", "lombardia"), true), false);
  }

  // ───── 7. l'importatore PVL vero, su un database in memoria (il caso del giro del 24/11) ─────
  const caso = async (nome: string, sedeTed: Sede, luogoPvl: { nuts: string; istat: string }, attesi: unknown[]) => {
    const gara: RigaMem = { ...ted(sedeTed), chiave: "ted:proc-venezia", ultima_versione_id: "787530-2026", ultima_versione_il: "2026-11-12", data_pubblicazione: "2026-11-12", id: "g-ted", provenienza_campi: {}, unita_a: null, unita_il: null, unita_motivo: null, unita_esclusa_con: [], fonti: ["ted"], codice_nuts: "ITH35" };
    const mem = databaseInMemoria({
      radar_procedure: [gara],
      radar_procedure_fonti: [{ procedura_id: "g-ted", fonte: "ted", id_fonte: "787530-2026", id_procedura_fonte: "proc-venezia", rif_ted: null, impronta: "t" }],
      radar_lotti: [{ procedura_id: "g-ted", numero_lotto: "LOT-0001", cig: null, oggetto: "lotto TED", cpv_principale: null, cpv_tutti: [], valore_stimato: 334750, durata_mesi: 36, scadenza_giorno: "2026-12-14", scadenza_offerte: "2026-12-14T12:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null }],
      radar_aggiornamenti: [],
      omnia_ai_radar_salvate: [],
      omnia_ai_radar_gare_aggiunte: [],
    });
    const avviso = structuredClone(campione.avvisi[1]) as Record<string, unknown>;
    const tpl = (avviso.templates as Record<string, unknown>[])[0].template as Record<string, unknown>;
    for (const it of ((tpl.sections as Record<string, unknown>[])[2].items as Record<string, unknown>[])) Object.assign(it, { luogo_nuts: luogoPvl.nuts, luogo_istat: luogoPvl.istat });
    const stat = statistichePvlVuote();
    await applicaPaginaBandiPvl(mem.client, [leggiAvvisoPvl(avviso) as BandoPvl], "incrementale", ADESSO, { richiesteDb: 0, msDb: 0 }, stat);
    const g = mem.tabelle.radar_procedure.find((r) => r.id === "g-ted") as Record<string, unknown>;
    const prov = g.provenienza_campi as ProvenienzaCampi;
    uguale(`importatore PVL: ${nome}`, [stat.bandi.conflitti, mem.tabelle.radar_procedure.length, g.sa_comune, g.sa_provincia, g.sa_regione, g.luogo_regioni, prov.luogo?.f, g.sa_denominazione], attesi);
    atteso(`importatore PVL: ${nome} — nessun cambiamento registrato per ente e luogo`, !mem.tabelle.radar_aggiornamenti.some((a) => /^sa_|luogo/.test(String(a.campo ?? ""))));
  };
  await caso("PVL con luogo «ITALIA» (regione non riconosciuta) su una gara TED in Piemonte: sede e regioni restano", { comune: "Verbania", provincia: null, regione: "piemonte", regioni: ["piemonte"] }, { nuts: "ITALIA", istat: "BAVENO" }, [0, 1, "Verbania", null, "piemonte", ["piemonte"], "ted", "VENETO STRADE S.P.A."]);
  await caso("esecuzione a Trieste, sede TED a Roma: la sede resta Roma", { comune: "Roma", provincia: "RM", regione: "lazio", regioni: ["friuli_venezia_giulia"] }, { nuts: "Trieste", istat: "TRIESTE" }, [0, 1, "Roma", "RM", "lazio", ["friuli_venezia_giulia"], "ted", "VENETO STRADE S.P.A."]);
  await caso("stesso comune: la provincia mancante si riempie dalla PVL", { comune: "Venezia", provincia: null, regione: "veneto", regioni: ["veneto"] }, { nuts: "Venezia", istat: "VENEZIA" }, [0, 1, "Venezia", "VE", "veneto", ["veneto"], "ted", "VENETO STRADE S.P.A."]);

  // ───── 8. il codice ─────
  const unione = leggi("src/lib/radar/unione-calcoli.ts");
  atteso("la PVL dichiara nel suo lettore che il comune è il luogo di esecuzione (motivo della regola)", /la PVL non indica la sede dell'ente/.test(leggi("src/lib/radar/fonti/pvl-calcoli.ts")));
  atteso("unione: nessuna rete, database o orologio", !/fetch\(|createClient|new Date\(\)|Date\.now\(/.test(unione));

  console.log(`Verifica ente e luogo dell'unione (24/11): ${ok} ok, ${fallimenti.length} falliti`);
  for (const f of fallimenti) console.log(`  FALLITO: ${f}`);
  process.exit(fallimenti.length ? 1 : 0);
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
