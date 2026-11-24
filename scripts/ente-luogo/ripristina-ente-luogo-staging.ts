// Correzione dei dati del giro di prova PVL del 24/11/2026 sullo STAGING (AUT-20261124-04, USO-3a3518880a5a): l'unione copiava il gruppo
// «luogo» della PVL per intero, così la sede dell'ente (sa_comune, sa_provincia, sa_regione) ha preso il luogo di esecuzione del primo lotto
// e in 3 gare regione e regioni sono state svuotate. Il codice è corretto dal commit 1d94297 (unione-calcoli.ts).
//   PARTE A (26 gare del giro): il valore che il motore CORRETTO avrebbe scritto in quel giro (piano-ripristino-ente-luogo.json, calcolato con
//     unisciVersione dalla fotografia del coordinamento di prima del giro e dai valori del giro) e la provenienza della sede alla fonte che la
//     indica (TED o Sintel). Le 15 gare «solo provenienza» hanno già i valori giusti.
//   PARTE B (7 gare unite alla PVL prima del 17/11, SENZA regioni del luogo di esecuzione): SOLO luogo_regioni, calcolate AL LANCIO dallo
//     stato attuale, in modo deterministico: TED → regioneDaNuts del codice_nuts registrato (primo NUTS della procedura o dell'ente):
//     approssimazione deterministica, una sola regione; solo se il codice_nuts viene da TED. Sintel → ["lombardia"], esattamente la regione
//     che l'importatore Sintel assegna di suo a ogni bando. La sede non si tocca.
// Modi:
//   prima   → solo letture: gara per gara il valore ATTUALE, quello ripristinato e il motivo; si ferma se lo stato non è quello atteso;
//   applica → per ogni gara UNA scrittura condizionata su radar_procedure (where id = X and aggiornata_il = <letto>); idempotente. NESSUNA
//             riga in radar_aggiornamenti (rilievo 1 di B2: i clienti la vedrebbero nella cronologia; come il 52A): l'esito, gara per gara
//             (valori prima e dopo, provenienza, ora), va in un file JSON in TENDER_INTELLIGENCE_FASE0/allegati/ente-luogo/, riscritto a ogni
//             passo, anche se si ferma a metà. Solo dati pubblici delle gare. Solo con esegui-autorizzato.mjs e un'autorizzazione
//             «correzione_dati» (porta del registro);
//   dopo    → solo letture: ogni gara ha il valore ripristinato e la sua provenienza; nessuna riga «ente_luogo» nel registro dei cambiamenti.
// Stato atteso al lancio, per ogni gara (altrimenti FERMO, nessuna scrittura per nessuna gara):
//   parte A: sede, regioni e provenienza della sede ESATTAMENTE come le ha lasciate il giro (o già ripristinate);
//   parte B: regioni vuote (o già ripristinate), la fonte presente nella gara, il NUTS di TED riconosciuto. Non tocca aggiornata_il.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { ClientDb } from "../../src/lib/radar/notifiche/motore";
import type { ProvenienzaCampo } from "../../src/lib/radar/unione-calcoli";
import { regioneDaNuts } from "../../src/lib/radar/territorio";
import { FermoCollaudo, PRODUZIONE_REF, STAGING_REF, installaOsservatore } from "../collaudo-z8/collaudo-motore-z8";

type Sede = { sa_comune: string | null; sa_provincia: string | null; sa_regione: string | null; luogo_regioni: string[] };
type Provenienza = ProvenienzaCampo;
// prima = valori della fotografia di prima del giro (solo per la prova che ricalcola il piano); giro = valori e provenienza della sede lasciati
// dal giro (quelli che lo script si aspetta di trovare); atteso = valori da scrivere; provenienza = sede e regioni da scrivere
export type GaraParteA = { id: string; parte: "A"; valori: boolean; prima: Sede; giro: Sede & { luogo: Provenienza }; atteso: Sede; provenienza: { luogo: Provenienza; luogo_regioni: Provenienza } };
export type GaraParteB = { id: string; parte: "B"; fonte: "ted" | "sintel" };
export type GaraDelPiano = GaraParteA | GaraParteB;
export type PianoFile = { conteggi: { gare: number; parte_a: number; con_valori: number; solo_provenienza: number; parte_b: number }; gare: GaraDelPiano[] };
type Letta = Sede & { id: string; codice_nuts: string | null; fonti: string[] | null; provenienza_campi: Record<string, Provenienza> | null; aggiornata_il: string };
export type Piano = { gara: string; parte: "A" | "B"; prima: Sede; dopo: Sede; colonne: (keyof Sede)[]; provenienza: Record<string, Provenienza>; provenienzaPrima: Record<string, Provenienza | null>; provenienzaScritta: Record<string, Provenienza>; aggiornataIl: string; giaAPosto: boolean; motivo: string };
export type EsitoRipristino = { piani: Piano[]; cambiate: number; giaAPosto: number };
// Il file dell'esito di «applica»: una riga per gara, solo dati pubblici delle gare (identificativo, sede, regioni, provenienza della fonte).
export type RigaEsito = { id: string; parte: "A" | "B"; motivo: string; prima: Sede; dopo: Sede; provenienza_prima: Record<string, Provenienza | null>; provenienza_scritta: Record<string, Provenienza>; esito: "da scrivere" | "scritta" | "già a posto"; ora: string | null };
export type FileEsito = { documento: string; script: string; avviato_il: string; aggiornato_il: string; stato: "in corso" | "completato" | "fermato"; motivo_fermo: string | null; conteggi: { gare: number; scritte: number; gia_a_posto: number }; gare: RigaEsito[] };
export type Diario = (e: FileEsito) => void;

export const CARTELLA_ESITO = "C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/allegati/ente-luogo";
// La regione che l'importatore Sintel assegna a OGNI bando (sintel-calcoli.ts, «regioni: ["lombardia"]»; la prova lo confronta col lettore vero)
export const REGIONI_SINTEL: readonly string[] = ["lombardia"];
const COLONNE_SEDE: (keyof Sede)[] = ["sa_comune", "sa_provincia", "sa_regione", "luogo_regioni"];
const NOMI: Record<string, string> = { ted: "TED", sintel: "Sintel", pvl: "PVL", sardegnacat: "SardegnaCAT" };

// il piano si legge dalla cartella del progetto (da lì si lanciano lo script e le prove)
export function leggiPiano(file = path.join(process.cwd(), "scripts/ente-luogo/piano-ripristino-ente-luogo.json")): PianoFile {
  const p = JSON.parse(fs.readFileSync(file, "utf8")) as PianoFile;
  const a = p.gare.filter((g) => g.parte === "A");
  if (!Array.isArray(p.gare) || p.gare.length !== p.conteggi.gare || a.length !== p.conteggi.parte_a || p.gare.length - a.length !== p.conteggi.parte_b || new Set(p.gare.map((g) => g.id)).size !== p.gare.length) {
    throw new FermoCollaudo("piano: elenco delle gare non coerente");
  }
  return p;
}

const sede = (r: Partial<Sede>): Sede => ({ sa_comune: r.sa_comune ?? null, sa_provincia: r.sa_provincia ?? null, sa_regione: r.sa_regione ?? null, luogo_regioni: [...(r.luogo_regioni ?? [])] });
const uguali = (a: Sede, b: Sede) => JSON.stringify(sede(a)) === JSON.stringify(sede(b));
const stessaProvenienza = (a: Provenienza | undefined, b: { f: string; id: string } | null | undefined) => !!a && !!b && a.f === b.f && a.id === b.id;

function motivoParteA(g: GaraParteA): string {
  const f = NOMI[g.provenienza.luogo.f] ?? g.provenienza.luogo.f;
  if (!g.valori) return `valori già giusti; provenienza della sede PVL → ${f} (un altro giro PVL non deve riprenderla)`;
  const m: string[] = [];
  if (g.giro.sa_comune !== g.atteso.sa_comune) m.push(`sede presa dal luogo di esecuzione PVL → sede ${f}`);
  if (!g.giro.sa_regione && g.atteso.sa_regione) m.push("regione svuotata dal giro");
  else if (g.giro.sa_regione !== g.atteso.sa_regione) m.push("regione del luogo di esecuzione");
  if (g.giro.sa_provincia && !g.atteso.sa_provincia) m.push("provincia di un altro comune tolta (mai indovinata)");
  else if (g.giro.sa_provincia !== g.atteso.sa_provincia) m.push("provincia della sede");
  if (g.giro.luogo_regioni.length === 0 && g.atteso.luogo_regioni.length > 0) m.push(`regioni svuotate dal giro → regioni ${f}`);
  return m.join("; ");
}

function pianoParteA(g: GaraParteA, letta: Letta): Piano {
  const prov = { ...(letta.provenienza_campi ?? {}) };
  const giaAPosto = uguali(letta, g.atteso) && stessaProvenienza(prov.luogo, g.provenienza.luogo) && stessaProvenienza(prov.luogo_regioni, g.provenienza.luogo_regioni);
  if (!giaAPosto && !(uguali(letta, g.giro) && stessaProvenienza(prov.luogo, g.giro.luogo))) {
    throw new FermoCollaudo(`gara ${g.id} (parte A): sede, regioni o provenienza non sono quelle lasciate dal giro PVL (${JSON.stringify({ ...sede(letta), luogo: prov.luogo ? { f: prov.luogo.f, id: prov.luogo.id } : null })})`);
  }
  return {
    gara: g.id,
    parte: "A",
    prima: sede(letta),
    dopo: sede(g.atteso),
    colonne: COLONNE_SEDE,
    provenienza: { ...prov, luogo: g.provenienza.luogo, luogo_regioni: g.provenienza.luogo_regioni },
    provenienzaPrima: { luogo: prov.luogo ?? null, luogo_regioni: prov.luogo_regioni ?? null },
    provenienzaScritta: { luogo: g.provenienza.luogo, luogo_regioni: g.provenienza.luogo_regioni },
    aggiornataIl: letta.aggiornata_il,
    giaAPosto,
    motivo: motivoParteA(g),
  };
}

function pianoParteB(g: GaraParteB, letta: Letta): Piano {
  const prov = { ...(letta.provenienza_campi ?? {}) };
  const fonti = letta.fonti ?? [];
  if (!fonti.includes(g.fonte)) throw new FermoCollaudo(`gara ${g.id} (parte B): la fonte ${g.fonte} non è tra le fonti della gara (${fonti.join(",")})`);
  let regioni: string[];
  let provenienza: Provenienza | undefined;
  let motivo: string;
  if (g.fonte === "ted") {
    const regione = regioneDaNuts(letta.codice_nuts);
    provenienza = prov.codice_nuts;
    if (!provenienza || provenienza.f !== "ted") throw new FermoCollaudo(`gara ${g.id} (parte B): il codice NUTS non viene da TED (${provenienza?.f ?? "nessuna provenienza"})`);
    if (!regione) throw new FermoCollaudo(`gara ${g.id} (parte B): codice NUTS ${letta.codice_nuts ?? "vuoto"} non riconosciuto`);
    regioni = [regione];
    motivo = `regioni vuote → regioneDaNuts del codice_nuts registrato ${letta.codice_nuts} (primo NUTS della procedura o dell'ente): approssimazione deterministica, una sola regione; sede non toccata`;
  } else {
    provenienza = prov._versione?.f === "sintel" ? prov._versione : Object.keys(prov).sort().map((k) => prov[k]).find((p) => p?.f === "sintel");
    if (!provenienza) throw new FermoCollaudo(`gara ${g.id} (parte B): nessuna provenienza Sintel nella gara`);
    regioni = [...REGIONI_SINTEL];
    motivo = "regioni vuote → lombardia, la regione che l'importatore Sintel assegna di suo; sede non toccata";
  }
  const dopo = { ...sede(letta), luogo_regioni: regioni };
  const giaAPosto = uguali(letta, dopo) && stessaProvenienza(prov.luogo_regioni, provenienza);
  if (!giaAPosto && letta.luogo_regioni.length > 0) throw new FermoCollaudo(`gara ${g.id} (parte B): le regioni non sono più vuote (${letta.luogo_regioni.join(",")})`);
  return {
    gara: g.id,
    parte: "B",
    prima: sede(letta),
    dopo,
    colonne: ["luogo_regioni"],
    provenienza: { ...prov, luogo_regioni: provenienza },
    provenienzaPrima: { luogo_regioni: prov.luogo_regioni ?? null },
    provenienzaScritta: { luogo_regioni: provenienza },
    aggiornataIl: letta.aggiornata_il,
    giaAPosto,
    motivo,
  };
}

/** Le letture e i controlli sullo stato ATTUALE: il piano per ogni gara, oppure FERMO senza scrivere nulla. */
export async function pianoRipristino(admin: ClientDb, gare: readonly GaraDelPiano[]): Promise<Piano[]> {
  const piani: Piano[] = [];
  for (const g of gare) {
    const r = await admin.from("radar_procedure").select("id, sa_comune, sa_provincia, sa_regione, luogo_regioni, codice_nuts, fonti, provenienza_campi, aggiornata_il").eq("id", g.id);
    if (r.error) throw new FermoCollaudo(`lettura della gara ${g.id}: ${r.error.message ?? ""}`);
    const letta = ((r.data ?? []) as Letta[])[0];
    if (!letta) throw new FermoCollaudo(`gara ${g.id} non trovata`);
    piani.push(g.parte === "A" ? pianoParteA(g, letta) : pianoParteB(g, letta));
  }
  return piani;
}

/**
 * Le scritture: solo dopo che il piano è passato per TUTTE le gare. Nessuna riga nel registro dei cambiamenti: l'esito va al «diario» (il
 * file JSON), chiamato col piano prima della prima scrittura, dopo ogni gara scritta e alla fine («completato» o «fermato»).
 */
export async function ripristinaEnteLuogo(admin: ClientDb, orologio: () => Date, gare: readonly GaraDelPiano[], diario: Diario = () => undefined): Promise<EsitoRipristino> {
  const piani = await pianoRipristino(admin, gare);
  const avviato = orologio().toISOString();
  const righe: RigaEsito[] = piani.map((p) => ({ id: p.gara, parte: p.parte, motivo: p.motivo, prima: p.prima, dopo: p.dopo, provenienza_prima: p.provenienzaPrima, provenienza_scritta: p.provenienzaScritta, esito: p.giaAPosto ? "già a posto" : "da scrivere", ora: null }));
  const scrivi = (stato: FileEsito["stato"], motivo: string | null) =>
    diario({
      documento: "Esito del ripristino ente/luogo dopo il giro di prova PVL del 24/11/2026 (solo dati pubblici delle gare)",
      script: "scripts/ente-luogo/ripristina-ente-luogo-staging.ts applica",
      avviato_il: avviato,
      aggiornato_il: orologio().toISOString(),
      stato,
      motivo_fermo: motivo,
      conteggi: { gare: righe.length, scritte: righe.filter((r) => r.esito === "scritta").length, gia_a_posto: righe.filter((r) => r.esito === "già a posto").length },
      gare: righe.map((r) => ({ ...r })),
    });
  scrivi("in corso", null);
  let cambiate = 0;
  try {
    for (const [i, p] of piani.entries()) {
      if (p.giaAPosto) continue;
      const valori: Record<string, unknown> = Object.fromEntries(p.colonne.map((c) => [c, p.dopo[c]]));
      const r = await admin.from("radar_procedure").update({ ...valori, provenienza_campi: p.provenienza }).eq("id", p.gara).eq("aggiornata_il", p.aggiornataIl).select("id");
      if (r.error) throw new FermoCollaudo(`scrittura della gara ${p.gara}: ${r.error.message ?? ""}`);
      const n = ((r.data ?? []) as unknown[]).length;
      if (n !== 1) throw new FermoCollaudo(`gara ${p.gara}: cambiate ${n} righe invece di una (gara riscritta nel frattempo?)`);
      cambiate++;
      righe[i] = { ...righe[i], esito: "scritta", ora: orologio().toISOString() };
      scrivi("in corso", null);
    }
    const dopo = await pianoRipristino(admin, gare);
    if (dopo.some((p) => !p.giaAPosto)) throw new FermoCollaudo("dopo la scrittura qualche gara non ha ancora il valore corretto");
  } catch (e) {
    scrivi("fermato", e instanceof Error ? e.message : String(e));
    throw e;
  }
  scrivi("completato", null);
  return { piani, cambiate, giaAPosto: piani.filter((p) => p.giaAPosto).length };
}

/** Il diario vero: il file JSON dell'esito nella cartella degli allegati, riscritto a ogni passo (stesso nome per tutto il lancio). */
// La cartella si crea solo alla prima scrittura del diario (cioè dopo porta, guardie e piano superati).
export function diarioSuFile(cartella: string, adesso: Date): { diario: Diario; file: string } {
  const file = path.join(cartella, `esito-ripristino-ente-luogo-${adesso.toISOString().replace(/[-:.]/g, "")}.json`);
  return {
    file,
    diario: (e) => {
      fs.mkdirSync(cartella, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(e, null, 1)}\n`);
    },
  };
}

/** «dopo»: solo letture. Ogni gara del piano ripristinata (valori e provenienza); nessuna riga «ente_luogo» nel registro dei cambiamenti. */
export async function verificaDopo(admin: ClientDb, gare: readonly GaraDelPiano[]): Promise<{ piani: Piano[] }> {
  const piani = await pianoRipristino(admin, gare);
  const non = piani.filter((p) => !p.giaAPosto).map((p) => p.gara);
  if (non.length > 0) throw new FermoCollaudo(`dopo: ${non.length} gare non ripristinate (${non.join(", ")})`);
  const t = await admin.from("radar_aggiornamenti").select("procedura_id").eq("campo", "ente_luogo").in("procedura_id", gare.map((g) => g.id));
  if (t.error) throw new FermoCollaudo(`lettura del registro dei cambiamenti: ${t.error.message ?? ""}`);
  if (((t.data ?? []) as unknown[]).length > 0) throw new FermoCollaudo("dopo: righe «ente_luogo» nel registro dei cambiamenti (i clienti le vedrebbero nella cronologia)");
  return { piani };
}

export type Modo = "prima" | "applica" | "dopo";
export async function lancia(modo: Modo, ambiente: Record<string, string | undefined>, registro: { controllaPorta: (x: { script: string }) => unknown } | null, gare: readonly GaraDelPiano[], diario: Diario = () => undefined): Promise<EsitoRipristino> {
  if (modo === "applica") {
    if (!registro) throw new FermoCollaudo("applica: solo con esegui-autorizzato.mjs e un'autorizzazione registrata");
    registro.controllaPorta({ script: "ripristina-ente-luogo-staging.ts" });
  }
  const url = String(ambiente.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (url !== `https://${STAGING_REF}.supabase.co` || Object.values(ambiente).some((v) => typeof v === "string" && v.includes(PRODUZIONE_REF))) throw new FermoCollaudo("non è lo staging");
  if (ambiente.VERCEL_ENV) throw new FermoCollaudo("VERCEL_ENV presente: lo script non gira su Vercel");
  const fermo = { motivo: null as string | null };
  const osservatore = installaOsservatore(url, fermo);
  try {
    const client = createClient(url, String(ambiente.SUPABASE_SERVICE_ROLE_KEY ?? ""), { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as ClientDb;
    let esito: EsitoRipristino;
    if (modo === "applica") esito = await ripristinaEnteLuogo(client, () => new Date(), gare, diario);
    else if (modo === "dopo") {
      const d = await verificaDopo(client, gare);
      esito = { piani: d.piani, cambiate: 0, giaAPosto: d.piani.length };
    } else esito = { piani: await pianoRipristino(client, gare), cambiate: 0, giaAPosto: 0 };
    if (fermo.motivo) throw new FermoCollaudo(fermo.motivo);
    return esito;
  } finally {
    osservatore.ripristina();
  }
}

async function principale(): Promise<number> {
  const modo = process.argv[2];
  if (modo !== "prima" && modo !== "applica" && modo !== "dopo") {
    console.error("uso: npx tsx scripts/ente-luogo/ripristina-ente-luogo-staging.ts prima | dopo   (solo letture)\n     (solo con esegui-autorizzato.mjs) npx tsx scripts/ente-luogo/ripristina-ente-luogo-staging.ts applica");
    return 2;
  }
  let registro: { controllaPorta: (x: { script: string }) => unknown } | null = null;
  if (modo === "applica") {
    const cartellaRegistro = process.env.TI_REGISTRO;
    if (!cartellaRegistro) {
      console.error("STOP: scrive sullo staging: solo con esegui-autorizzato.mjs e un'autorizzazione registrata");
      return 2;
    }
    registro = (await import(new URL(`file:///${cartellaRegistro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href)) as { controllaPorta: (x: { script: string }) => unknown };
  }
  const piano = leggiPiano();
  const GUARDIA = "file:///C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/autorizzazioni/guardia-staging.mjs";
  const { caricaStaging } = (await import(GUARDIA)) as { caricaStaging: () => Record<string, string> };
  const v = caricaStaging();
  if (v.STAGING_PROJECT_REF !== STAGING_REF) throw new FermoCollaudo("guardia: non è lo staging");
  const esitoSuFile = modo === "applica" ? diarioSuFile(CARTELLA_ESITO, new Date()) : null;
  if (esitoSuFile) console.log(`esito di applica: ${esitoSuFile.file}`);
  const e = await lancia(modo, { NEXT_PUBLIC_SUPABASE_URL: v.STAGING_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: v.STAGING_SECRET_KEY, VERCEL_ENV: process.env.VERCEL_ENV }, registro, piano.gare, esitoSuFile?.diario);
  const testo = (s: Sede) => `${s.sa_comune ?? "–"} (${s.sa_provincia ?? "–"}) ${s.sa_regione ?? "–"} [${s.luogo_regioni.join(",")}]`;
  for (const p of e.piani) console.log(`${p.gara.slice(0, 8)} ${p.parte}: ${p.giaAPosto ? `già a posto: ${testo(p.dopo)}` : `${testo(p.prima)} → ${testo(p.dopo)} — ${p.motivo}`}`);
  const a = e.piani.filter((p) => p.parte === "A").length;
  if (modo === "applica") console.log(`Ripristino ente/luogo: gare cambiate ${e.cambiate}, già a posto ${e.giaAPosto}; nessuna riga nel registro dei cambiamenti; esito in ${esitoSuFile?.file}`);
  else if (modo === "dopo") console.log(`DOPO: tutte le ${e.piani.length} gare ripristinate (parte A ${a}, parte B ${e.piani.length - a}); nessuna riga «ente_luogo» nel registro dei cambiamenti`);
  else console.log(`PRIMA: nessuna scrittura; ${e.piani.length} gare (parte A ${a}: ${piano.conteggi.con_valori} con valori e ${piano.conteggi.solo_provenienza} solo provenienza; parte B ${e.piani.length - a}), da scrivere ${e.piani.filter((p) => !p.giaAPosto).length}`);
  return 0;
}

if (process.argv[1] && /ripristina-ente-luogo-staging\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  principale()
    .then((c) => process.exit(c))
    .catch((e) => {
      console.error(`FERMATO: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(e instanceof FermoCollaudo ? 3 : 1);
    });
}
