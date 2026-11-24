// Correzione dei dati del giro di prova PVL del 24/11/2026 sullo STAGING (AUT-20261124-04, USO-3a3518880a5a): l'unione copiava il gruppo
// «luogo» della PVL per intero, così la sede dell'ente (sa_comune, sa_provincia, sa_regione) ha preso il luogo di esecuzione del primo lotto
// e in 3 gare regione e regioni sono state svuotate. Il codice è corretto dal commit 1d94297 (unione-calcoli.ts).
//   PARTE A (26 gare del giro): il valore che il motore CORRETTO avrebbe scritto in quel giro (piano-ripristino-ente-luogo.json, calcolato con
//     unisciVersione dalla fotografia del coordinamento di prima del giro e dai valori del giro) e la provenienza della sede alla fonte che la
//     indica (TED o Sintel). Le 15 gare «solo provenienza» hanno già i valori giusti.
//   PARTE B (7 gare unite alla PVL prima del 17/11, SENZA regioni del luogo di esecuzione): SOLO luogo_regioni, calcolate AL LANCIO dallo
//     stato attuale, in modo deterministico: TED → regioneDaNuts(codice_nuts) (la funzione dell'importatore TED), solo se il codice_nuts
//     viene da TED; Sintel → ["lombardia"], la regione che l'importatore Sintel assegna di suo a ogni bando. La sede non si tocca.
// Modi:
//   prima   → solo letture: gara per gara il valore ATTUALE, quello ripristinato e il motivo; si ferma se lo stato non è quello atteso;
//   applica → per ogni gara UNA scrittura condizionata su radar_procedure (where id = X and aggiornata_il = <letto>), poi una traccia
//             «correzione_dati» non notificabile in radar_aggiornamenti (una per gara, mai doppia); idempotente. Solo con
//             esegui-autorizzato.mjs e un'autorizzazione «correzione_dati» (porta del registro);
//   dopo    → solo letture: ogni gara ha il valore ripristinato e la sua provenienza, e una sola traccia; nessuna traccia su altre gare.
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
export type Piano = { gara: string; parte: "A" | "B"; prima: Sede; dopo: Sede; colonne: (keyof Sede)[]; provenienza: Record<string, Provenienza>; aggiornataIl: string; giaAPosto: boolean; motivo: string };
export type EsitoRipristino = { piani: Piano[]; cambiate: number; giaAPosto: number; tracce: number };

export const ID_TRACCIA = "ripristino-ente-luogo-20261124";
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
  return { gara: g.id, parte: "A", prima: sede(letta), dopo: sede(g.atteso), colonne: COLONNE_SEDE, provenienza: { ...prov, luogo: g.provenienza.luogo, luogo_regioni: g.provenienza.luogo_regioni }, aggiornataIl: letta.aggiornata_il, giaAPosto, motivo: motivoParteA(g) };
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
    motivo = `regioni vuote → regione del NUTS TED ${letta.codice_nuts} (regioneDaNuts, come l'importatore TED); sede non toccata`;
  } else {
    provenienza = prov._versione?.f === "sintel" ? prov._versione : Object.keys(prov).sort().map((k) => prov[k]).find((p) => p?.f === "sintel");
    if (!provenienza) throw new FermoCollaudo(`gara ${g.id} (parte B): nessuna provenienza Sintel nella gara`);
    regioni = [...REGIONI_SINTEL];
    motivo = "regioni vuote → lombardia, la regione che l'importatore Sintel assegna di suo; sede non toccata";
  }
  const dopo = { ...sede(letta), luogo_regioni: regioni };
  const giaAPosto = uguali(letta, dopo) && stessaProvenienza(prov.luogo_regioni, provenienza);
  if (!giaAPosto && letta.luogo_regioni.length > 0) throw new FermoCollaudo(`gara ${g.id} (parte B): le regioni non sono più vuote (${letta.luogo_regioni.join(",")})`);
  return { gara: g.id, parte: "B", prima: sede(letta), dopo, colonne: ["luogo_regioni"], provenienza: { ...prov, luogo_regioni: provenienza }, aggiornataIl: letta.aggiornata_il, giaAPosto, motivo };
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

/** Le scritture: solo dopo che il piano è passato per TUTTE le gare. */
export async function ripristinaEnteLuogo(admin: ClientDb, adesso: Date, gare: readonly GaraDelPiano[]): Promise<EsitoRipristino> {
  const piani = await pianoRipristino(admin, gare);
  let cambiate = 0;
  let tracce = 0;
  for (const p of piani) {
    if (!p.giaAPosto) {
      const valori: Record<string, unknown> = Object.fromEntries(p.colonne.map((c) => [c, p.dopo[c]]));
      const r = await admin.from("radar_procedure").update({ ...valori, provenienza_campi: p.provenienza }).eq("id", p.gara).eq("aggiornata_il", p.aggiornataIl).select("id");
      if (r.error) throw new FermoCollaudo(`scrittura della gara ${p.gara}: ${r.error.message ?? ""}`);
      const n = ((r.data ?? []) as unknown[]).length;
      if (n !== 1) throw new FermoCollaudo(`gara ${p.gara}: cambiate ${n} righe invece di una (gara riscritta nel frattempo?)`);
      cambiate++;
    }
    // la traccia: una per gara, mai notificabile, mai doppia (indice unico procedura_id, tipo, campo, id_fonte)
    const t = await admin
      .from("radar_aggiornamenti")
      .upsert(
        [{ procedura_id: p.gara, tipo: "correzione_dati", campo: "ente_luogo", valore_precedente: JSON.stringify(p.prima), valore_nuovo: JSON.stringify(p.dopo), fonte: "manuale", id_fonte: ID_TRACCIA, nota: `Ripristino dopo il giro di prova PVL del 24/11/2026 (parte ${p.parte}): ${p.motivo}`.slice(0, 1000), notificabile: false, rilevato_il: adesso.toISOString() }],
        { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
      )
      .select("procedura_id");
    if (t.error) throw new FermoCollaudo(`traccia della gara ${p.gara}: ${t.error.message ?? ""}`);
    tracce += ((t.data ?? []) as unknown[]).length;
  }
  const dopo = await pianoRipristino(admin, gare);
  if (dopo.some((p) => !p.giaAPosto)) throw new FermoCollaudo("dopo la scrittura qualche gara non ha ancora il valore corretto");
  return { piani, cambiate, giaAPosto: piani.filter((p) => p.giaAPosto).length, tracce };
}

/** «dopo»: solo letture. Ogni gara del piano ripristinata (valori e provenienza), una sola traccia per gara, nessuna traccia su altre gare. */
export async function verificaDopo(admin: ClientDb, gare: readonly GaraDelPiano[]): Promise<{ piani: Piano[]; tracce: number }> {
  const piani = await pianoRipristino(admin, gare);
  const non = piani.filter((p) => !p.giaAPosto).map((p) => p.gara);
  if (non.length > 0) throw new FermoCollaudo(`dopo: ${non.length} gare non ripristinate (${non.join(", ")})`);
  const t = await admin.from("radar_aggiornamenti").select("procedura_id, tipo, campo, notificabile").eq("id_fonte", ID_TRACCIA);
  if (t.error) throw new FermoCollaudo(`lettura delle tracce: ${t.error.message ?? ""}`);
  const righe = (t.data ?? []) as { procedura_id: string; tipo: string; campo: string; notificabile: boolean }[];
  const ids = new Set(gare.map((g) => g.id));
  const perGara = new Map<string, number>();
  for (const x of righe) perGara.set(x.procedura_id, (perGara.get(x.procedura_id) ?? 0) + 1);
  if (righe.some((x) => !ids.has(x.procedura_id))) throw new FermoCollaudo("dopo: tracce del ripristino su gare fuori dal piano");
  if (gare.some((g) => perGara.get(g.id) !== 1)) throw new FermoCollaudo("dopo: non tutte le gare hanno una e una sola traccia del ripristino");
  if (righe.some((x) => x.tipo !== "correzione_dati" || x.campo !== "ente_luogo" || x.notificabile !== false)) throw new FermoCollaudo("dopo: una traccia del ripristino non è «correzione_dati» non notificabile");
  return { piani, tracce: righe.length };
}

export type Modo = "prima" | "applica" | "dopo";
export async function lancia(modo: Modo, ambiente: Record<string, string | undefined>, registro: { controllaPorta: (x: { script: string }) => unknown } | null, gare: readonly GaraDelPiano[]): Promise<EsitoRipristino> {
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
    if (modo === "applica") esito = await ripristinaEnteLuogo(client, new Date(), gare);
    else if (modo === "dopo") {
      const d = await verificaDopo(client, gare);
      esito = { piani: d.piani, cambiate: 0, giaAPosto: d.piani.length, tracce: d.tracce };
    } else esito = { piani: await pianoRipristino(client, gare), cambiate: 0, giaAPosto: 0, tracce: 0 };
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
  const e = await lancia(modo, { NEXT_PUBLIC_SUPABASE_URL: v.STAGING_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: v.STAGING_SECRET_KEY, VERCEL_ENV: process.env.VERCEL_ENV }, registro, piano.gare);
  const testo = (s: Sede) => `${s.sa_comune ?? "–"} (${s.sa_provincia ?? "–"}) ${s.sa_regione ?? "–"} [${s.luogo_regioni.join(",")}]`;
  for (const p of e.piani) console.log(`${p.gara.slice(0, 8)} ${p.parte}: ${p.giaAPosto ? `già a posto: ${testo(p.dopo)}` : `${testo(p.prima)} → ${testo(p.dopo)} — ${p.motivo}`}`);
  const a = e.piani.filter((p) => p.parte === "A").length;
  if (modo === "applica") console.log(`Ripristino ente/luogo: gare cambiate ${e.cambiate}, già a posto ${e.giaAPosto}, tracce nuove ${e.tracce}`);
  else if (modo === "dopo") console.log(`DOPO: tutte le ${e.piani.length} gare ripristinate (parte A ${a}, parte B ${e.piani.length - a}), ${e.tracce} tracce, nessuna fuori dal piano`);
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
