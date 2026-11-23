// Verifica del registro dei giri delle fonti (radar_esecuzioni, 0128; pacchetto K2 del piano 48C, B2, 23/11/2026). In memoria, senza rete:
//   - la riga calcolata da ogni importatore rispetta TUTTI i vincoli della 0128 (controllo scritto qui, uno per vincolo), anche con dati ostili;
//   - il giro registrato: una riga per giro, l'identificativo del giro passato alle pagine, pulizia oltre i 90 giorni della sola fonte,
//     registro che non ferma mai il giro, NESSUNA scrittura dove la fonte non può scrivere;
//   - i tre importatori (uscite anticipate) scrivono la loro riga; i testi di rotte, console e script.
// I vincoli VERI si provano su Postgres isolato: scripts/prova-isolata/esegui-prova-esecuzioni.mjs. Uso: npx tsx scripts/verifica-radar-esecuzioni.ts
import fs from "fs";
import path from "path";
import {
  FONTI_ESECUZIONI,
  allarmiValidi,
  byteJsonb,
  datiGiroPvl,
  datiGiroRegionale,
  datiGiroTed,
  datiUscita,
  rigaEsecuzione,
  testoSicuro,
  type DatiGiro,
  type FonteEsecuzione,
  type RigaEsecuzione,
  type RisultatoPvlPerRegistro,
  type RisultatoRegionalePerRegistro,
  type RisultatoTedPerRegistro,
} from "../src/lib/radar/esecuzioni-calcoli";
import { giroRegistrato, scriviEsecuzione } from "../src/lib/radar/esecuzioni";
import { eseguiImportazioneTed } from "../src/lib/radar/importa-ted";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { DbFinto } from "./lib/db-finto-motore";
import type { SupabaseClient } from "@supabase/supabase-js";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
}
// nessuna rete: ogni fetch è un errore della prova
globalThis.fetch = (async () => {
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;

const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const PRODUZIONE = { NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" };
const T0 = new Date("2026-11-23T08:05:00Z"), T1 = new Date("2026-11-23T08:06:30Z");
const UUID = "0b8f6c2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d";

// ───────────────── i vincoli della 0128, uno per uno (supabase/migrations/0128_radar_esecuzioni.sql) ─────────────────
const nessunTestoProibito = (v: unknown): boolean => {
  if (typeof v === "string") return !/\u0000/.test(v) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v);
  if (Array.isArray(v)) return v.every(nessunTestoProibito);
  if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => nessunTestoProibito(k) && nessunTestoProibito(x));
  return true;
};
const intero = (n: unknown, max = 2_147_483_647) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
const oggetto = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
function violazioni0128(r: RigaEsecuzione): string[] {
  const v: string[] = [];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id)) v.push("id");
  if (!(FONTI_ESECUZIONI as readonly string[]).includes(r.fonte)) v.push("fonte");
  if (!["incrementale", "recupero", "finestra", "manuale"].includes(r.modo)) v.push("modo");
  if (!["ok", "errore", "sospesa", "occupata", "inerte", "gia_eseguito"].includes(r.esito)) v.push("esito");
  if (!(Date.parse(r.finito_il) >= Date.parse(r.iniziato_il))) v.push("tempi");
  if (!(Array.isArray(r.finestre) || oggetto(r.finestre)) || byteJsonb(r.finestre) > 20_000) v.push("finestre");
  for (const k of ["fonte_richieste", "fonte_ms", "db_richieste", "db_ms", "gare_nuove", "gare_unite", "gare_aggiornate", "rettifiche", "conflitti"] as const) if (!intero(r[k])) v.push(k);
  if (!intero(r.fonte_byte, Number.MAX_SAFE_INTEGER)) v.push("fonte_byte");
  if (!oggetto(r.fonte_risposte) || byteJsonb(r.fonte_risposte) > 2_000) v.push("fonte_risposte");
  if (!oggetto(r.avvisi) || byteJsonb(r.avvisi) > 20_000) v.push("avvisi");
  if (!Array.isArray(r.allarmi) || r.allarmi.length > 20 || !r.allarmi.every((a) => typeof a === "string" && /^[a-z_]{2,40}$/.test(a))) v.push("allarmi");
  if (!(r.errore === null || (typeof r.errore === "string" && Array.from(r.errore).length >= 1 && Array.from(r.errore).length <= 500))) v.push("errore_lunghezza");
  if ((r.esito === "errore") !== (r.errore !== null)) v.push("errore_esito");
  if (!nessunTestoProibito(r)) v.push("testo_proibito");
  return v;
}

// ───────────────── risultati sintetici dei tre importatori ─────────────────
const ted = (x: Partial<{ fase: "recupero" | "incrementale"; errore: string | null }> = {}): RisultatoTedPerRegistro => ({
  eseguita: true,
  fase: x.fase ?? "incrementale",
  giroFinito: true,
  errore: x.errore ?? null,
  totali: {
    pagine: 2,
    bandi: { letti: 24, esclusi: { fuori_settore: 9 }, nuove: 3, aggiornate: 2, rettifiche: 1, annullate: 0, unitePvl: 4, invariati: 15 },
    esiti: { letti: 17, applicati: 5, senzaBando: 12 },
    ted: { richieste: 2, byte: 812_345, ms: 1534.6 },
    db: { richiesteDb: 6, msDb: 210.4 },
  },
  cursore: { tipo: "esito", da: "2026-11-20", a: "2026-11-23", ultimoGiorno: "2026-11-23" },
});
const pvl = (x: Partial<{ modo: "finestra" | "incrementale"; errore: string | null; sospesa: boolean }> = {}): RisultatoPvlPerRegistro => ({
  eseguita: true,
  modo: x.modo ?? "incrementale",
  giroFinito: true,
  sospesa: x.sospesa ?? false,
  errore: x.errore ?? null,
  statistiche: {
    pvl: { richieste: 1, byte: 40_000, ms: 900, risposte: { "200": 1 }, conteggioDichiarato: 37 },
    avvisi: { letti: 37, perScheda: { P1_16: 3, P7_1_3: 4 }, bandi: 7, esiti: 13, esclusi: { indagine_o_negoziata: 4 }, sostituiti: {}, nonAttivi: 0 },
    bandi: { invariati: 2, nuoveNazionali: 2, nuoveSopraSogliaSenzaTed: 1, giaPresentiTed: 3, nuoveVersioni: 1, aggiornate: 1, rettifiche: 1, annullate: 0, conflitti: 1 },
    esiti: { letti: 13, applicati: 1, senzaGara: 12 },
    db: { richiesteDb: 6, msDb: 150 },
  },
  cursore: { da: "2026-11-22", a: "2026-11-23", pagine: 1, ultimoGiorno: "2026-11-23" },
});
const regionale = (x: Partial<{ errore: string | null; sospesa: boolean }> = {}): RisultatoRegionalePerRegistro => ({
  eseguita: true,
  invariataAllaFonte: false,
  sospesa: x.sospesa ?? false,
  errore: x.errore ?? null,
  statistiche: {
    letti: 120,
    esclusi: { fuori_settore: 90, affidamento_diretto: 5 },
    invariati: 10,
    nuove: 6,
    aggiornate: 2,
    suGaraEsistente: { procedura: 7, cig: 2, piattaforma: 1 },
    rettifiche: 1,
    annullate: 0,
    conflitti: 0,
    proposte: 1,
    ambiguita: 0,
    fonte: { richieste: 3, byte: 2_000_000, ms: 4000 },
    db: { richiesteDb: 14, msDb: 600 },
  },
});
const riga = (fonte: FonteEsecuzione, d: DatiGiro, origine: "programmato" | "console" | "script" = "programmato") => rigaEsecuzione({ id: UUID, fonte, origine, iniziato: T0, finito: T1, ...d });

function provaRighe(): void {
  const righe: RigaEsecuzione[] = [];
  // TED
  const t = riga("ted", datiGiroTed(ted())!);
  righe.push(t);
  controlla("TED ok: esito ok, modo incrementale, nessun errore", t.esito === "ok" && t.modo === "incrementale" && t.errore === null);
  controlla("TED: nuove 3, unite (a gare PVL) 4, aggiornate 2, rettifiche 1; misure intere", t.gare_nuove === 3 && t.gare_unite === 4 && t.gare_aggiornate === 2 && t.rettifiche === 1 && t.fonte_ms === 1535 && t.db_ms === 210 && t.fonte_byte === 812_345, t);
  controlla("TED: recupero → modo «recupero»", riga("ted", datiGiroTed(ted({ fase: "recupero" }))!).modo === "recupero");
  const te = riga("ted", datiGiroTed(ted({ errore: "TED 503 per mario.rossi@example.com con chiave sb_secret_abcdefghijklmnop e token " + "x".repeat(50) }))!);
  righe.push(te);
  controlla("TED in errore: testo ripulito (niente email, chiave, token)", te.esito === "errore" && !!te.errore && !/@|sb_secret|xxxxxxxxxx/.test(te.errore), te.errore);
  // PVL
  const p = riga("pvl", datiGiroPvl(pvl())!);
  righe.push(p);
  controlla("PVL ok: nuove = nazionali + sopra soglia senza TED (3), unite = già presenti da TED (3), conflitti 1", p.gare_nuove === 3 && p.gare_unite === 3 && p.conflitti === 1 && p.esito === "ok");
  controlla("PVL: finestre con dichiarati e letti (completezza), risposte per codice", (p.finestre as Record<string, unknown>).dichiarati === 37 && (p.finestre as Record<string, unknown>).letti === 37 && p.fonte_risposte["200"] === 1);
  const ps = riga("pvl", datiGiroPvl(pvl({ errore: "HTTP 429 dalla PVL: connettore sospeso", sospesa: true }))!);
  righe.push(ps);
  controlla("PVL sospesa: esito «sospesa», errore NULLO (vincolo 0128), allarme «sospesa», motivo tra gli avvisi", ps.esito === "sospesa" && ps.errore === null && ps.allarmi.join() === "sospesa" && /429/.test(String(ps.avvisi.motivo_sospensione)), ps);
  const pe = riga("pvl", datiGiroPvl(pvl({ errore: "rete non raggiungibile" }))!);
  righe.push(pe);
  controlla("PVL errore non sospeso: esito «errore» con il testo, nessun allarme «sospesa»", pe.esito === "errore" && pe.errore === "rete non raggiungibile" && pe.allarmi.length === 0);
  controlla("PVL finestra: modo «finestra»", riga("pvl", datiGiroPvl(pvl({ modo: "finestra" }))!).modo === "finestra");
  const pc = riga("pvl", datiGiroPvl(pvl({ modo: "finestra" }))!, "console");
  controlla("giro dalla console: modo «manuale» e origine nelle finestre", pc.modo === "manuale" && (pc.finestre as Record<string, unknown>).origine === "console");
  controlla("giro programmato: origine «programmato» nelle finestre", (p.finestre as Record<string, unknown>).origine === "programmato");
  // regionali
  const r = riga("sintel", datiGiroRegionale(regionale())!);
  righe.push(r);
  controlla("regionale: «unite» = per CIG e piattaforma (3), MAI la stessa procedura (7)", r.gare_unite === 3 && r.gare_nuove === 6 && r.modo === "incrementale");
  const rs = riga("sardegnacat", datiGiroRegionale(regionale({ errore: "formato del feed cambiato", sospesa: true }))!);
  righe.push(rs);
  controlla("regionale sospesa: «sospesa», errore nullo, allarme", rs.esito === "sospesa" && rs.errore === null && rs.allarmi.includes("sospesa"));
  // uscite anticipate
  controlla("uscita «ambiente_non_consentito»: NESSUNA riga", datiUscita({ eseguita: false, motivo: "ambiente_non_consentito" }, "incrementale") === null);
  controlla("uscita «schema_assente»: NESSUNA riga", datiUscita({ eseguita: false, motivo: "schema_assente" }, "incrementale") === null);
  const ui = riga("ted", datiUscita({ eseguita: false, motivo: "fonte_spenta" }, "incrementale")!);
  const uo = riga("pvl", datiUscita({ eseguita: false, motivo: "occupata" }, "incrementale")!);
  const ul = riga("sintel", datiUscita({ eseguita: false, motivo: "errore_lettura", dettaglio: "timeout" }, "incrementale")!);
  righe.push(ui, uo, ul);
  controlla("uscite: fonte spenta → «inerte», blocco preso → «occupata», lettura fallita → «errore» col dettaglio", ui.esito === "inerte" && uo.esito === "occupata" && ul.esito === "errore" && /timeout/.test(String(ul.errore)));
  // dati ostili
  const lungo = "é".repeat(499) + "😀" + "z".repeat(1500);
  const o1 = riga("ted", { modo: "incrementale", esito: "errore", errore: lungo });
  righe.push(o1);
  controlla("errore lunghissimo con un'emoji al confine: al più 500 caratteri veri, nessun surrogato spaiato", Array.from(o1.errore ?? "").length <= 500 && nessunTestoProibito(o1.errore));
  const o2 = riga("pvl", { modo: "incrementale", esito: "errore", errore: "\u0000  \u0000" });
  righe.push(o2);
  controlla("errore vuoto o di soli NUL: «errore senza descrizione»", o2.errore === "errore senza descrizione");
  const o3 = riga("ted", { modo: "incrementale", esito: "ok", errore: "resto di un errore vecchio" });
  righe.push(o3);
  controlla("esito diverso da «errore»: errore SEMPRE nullo (vincolo 0128)", o3.errore === null);
  const enorme: Record<string, number> = {};
  for (let i = 0; i < 5000; i++) enorme[`motivo_${i}_${"k".repeat(20)}`] = i;
  const o4 = rigaEsecuzione({
    id: UUID,
    fonte: "sintel",
    origine: "script",
    iniziato: T1,
    finito: T0, // orologio all'indietro
    modo: "incrementale",
    esito: "ok",
    misureFonte: { richieste: -3, byte: Number.NaN, ms: 3e12, risposte: enorme },
    db: { richieste: 2.6, ms: Infinity },
    avvisi: { letti: 10, esclusi: enorme, testo: "a\u0000b\uD800c" },
    finestre: { profondo: { a: { b: { c: { d: { e: 1 } } } } } },
    gare: { nuove: Number.NaN, unite: -1, aggiornate: 1.4 },
    allarmi: ["Sospesa", "a", "x,y", "", "giro_mancato", "giro_mancato", ...Array.from({ length: 25 }, (_, i) => `allarme_${"abcdefghijklmnopqrstuvwxyz"[i]}`)],
  });
  righe.push(o4);
  controlla("dati ostili: tempi riallineati, numeri interi non negativi e limitati", o4.finito_il === o4.iniziato_il && o4.fonte_richieste === 0 && o4.fonte_byte === 0 && o4.fonte_ms === 2_147_483_647 && o4.db_richieste === 3 && o4.db_ms === 0 && o4.gare_nuove === 0 && o4.gare_unite === 0 && o4.gare_aggiornate === 1, o4);
  controlla("dati ostili: un oggetto di 5.000 voci tiene le prime 200 e conta le altre («__altre»), entro il limite", (o4.avvisi.esclusi as Record<string, unknown>).__altre === 4800 && Object.keys(o4.avvisi.esclusi as object).length === 201 && byteJsonb(o4.avvisi) <= 19_000, { byte: byteJsonb(o4.avvisi) });
  const testiLunghi: Record<string, string> = { letti: "x" };
  for (let i = 0; i < 150; i++) testiLunghi[`campo_${i}`] = "t".repeat(300);
  const o5 = riga("pvl", { modo: "incrementale", esito: "ok", avvisi: { letti: 10, ...testiLunghi, dettaglio: { a: 1 } } });
  righe.push(o5);
  controlla("dati ostili: avvisi oltre il limite di byte → solo i campi semplici più «troncato», entro il limite", byteJsonb(o5.avvisi) <= 19_000 && (o5.avvisi.troncato === true) && !("dettaglio" in o5.avvisi), { byte: byteJsonb(o5.avvisi), chiavi: Object.keys(o5.avvisi).length });
  const o6 = riga("ted", { modo: "incrementale", esito: "ok", finestre: { piccolo: 1e-7, grande: 1e21, decimale: 1534.6789 } });
  controlla("numeri nei jsonb: arrotondati a 3 decimali ed entro 1e15 (stesso testo in JavaScript e in Postgres)", JSON.stringify(o6.finestre).includes('"piccolo":0') && JSON.stringify(o6.finestre).includes('"grande":1000000000000000') && JSON.stringify(o6.finestre).includes('"decimale":1534.679'), o6.finestre);
  controlla("dati ostili: risposte enormi → vuote; testi senza NUL né surrogati", Object.keys(o4.fonte_risposte).length === 0 && o4.avvisi.testo === "abc");
  controlla("dati ostili: allarmi solo validi, senza doppioni, al più 20", o4.allarmi.length === 20 && o4.allarmi[0] === "giro_mancato" && !o4.allarmi.includes("Sospesa") && !o4.allarmi.includes("a"), o4.allarmi);
  controlla("allarmiValidi: un nome di 41 caratteri o con una virgola non passa", allarmiValidi(["a".repeat(41), "x,y", "ok_ok"]).join() === "ok_ok");
  controlla("testoSicuro: conta i caratteri veri (un'emoji = 1)", testoSicuro("😀😀😀", 2) === "😀😀");
  // TUTTE le righe valide
  const cattive = righe.map((x) => ({ fonte: x.fonte, esito: x.esito, v: violazioni0128(x) })).filter((x) => x.v.length > 0);
  controlla(`tutte le ${righe.length} righe rispettano ogni vincolo della 0128`, cattive.length === 0 && righe.length >= 13, cattive);
  // il controllo dei vincoli non è vuoto: righe sbagliate apposta vengono rifiutate
  const sbagliate: [string, RigaEsecuzione][] = [
    ["errore con esito ok", { ...t, errore: "x" }],
    ["esito errore senza testo", { ...te, errore: null }],
    ["allarme con maiuscola", { ...t, allarmi: ["Giro"] }],
    ["numero negativo", { ...t, gare_nuove: -1 }],
    ["tempi rovesciati", { ...t, finito_il: "2026-11-23T08:00:00.000Z" }],
    ["fonte sconosciuta", { ...t, fonte: "manuale" as FonteEsecuzione }],
  ];
  controlla("il controllo dei vincoli rifiuta 6 righe sbagliate apposta", sbagliate.every(([, x]) => violazioni0128(x).length > 0), sbagliate.map(([n, x]) => [n, violazioni0128(x)]));
  // per la prova su Postgres isolato (esegui-prova-esecuzioni.mjs): le righe VERE, con un identificativo ciascuna, e i byte calcolati qui
  const file = process.env.RADAR_RIGHE_ESECUZIONI;
  if (file) {
    const esportate = righe.map((x, i) => ({ ...x, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` }));
    const sbagliateEsportate = sbagliate.map(([nome, x], i) => ({ nome, riga: { ...x, id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}` } }));
    fs.writeFileSync(file, JSON.stringify({ righe: esportate, byte: esportate.map((x) => ({ id: x.id, finestre: byteJsonb(x.finestre), avvisi: byteJsonb(x.avvisi), risposte: byteJsonb(x.fonte_risposte) })), sbagliate: sbagliateEsportate }));
  }
}

// ───────────────── il giro registrato, su un database in memoria ─────────────────
const giorni = (n: number) => new Date(T0.getTime() - n * 86_400_000).toISOString();
function mondo(): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_esecuzioni = [
    { id: "vecchia-ted", fonte: "ted", iniziato_il: giorni(100) },
    { id: "recente-ted", fonte: "ted", iniziato_il: giorni(10) },
    { id: "vecchia-pvl", fonte: "pvl", iniziato_il: giorni(100) },
    { id: "al-limite-ted", fonte: "ted", iniziato_il: giorni(89) },
  ];
  return db;
}
const comeAdmin = (db: DbFinto) => db as unknown as SupabaseClient;
const datiOk: DatiGiro = { modo: "incrementale", esito: "ok" };

async function provaGiro(): Promise<void> {
  const db = mondo();
  let idVisto = "";
  const r = await giroRegistrato(comeAdmin(db), "ted", { env: STAGING, adesso: () => T0, nuovoIdEsecuzione: () => UUID }, async (id) => {
    idVisto = id;
    return { eseguita: true as const, valore: 1 };
  }, () => datiOk);
  const scritte = db.richieste.filter((x) => x.tabella === "radar_esecuzioni");
  controlla("giro registrato: l'identificativo del giro passato al giro è quello della riga", idVisto === UUID && db.t("radar_esecuzioni").some((x) => x.id === UUID));
  controlla("giro registrato: UNA scrittura (insert) e UNA cancellazione, nient'altro sul registro", scritte.map((x) => x.metodo).join() === "insert,delete", scritte);
  controlla("pulizia: tolta SOLO la riga TED oltre i 90 giorni (restano la recente, quella a 89 giorni e la vecchia PVL)", r.esecuzione.scritta && r.esecuzione.cancellate === 1 && db.t("radar_esecuzioni").map((x) => x.id).sort().join() === ["al-limite-ted", "recente-ted", "vecchia-pvl", UUID].sort().join(), db.t("radar_esecuzioni").map((x) => x.id));
  controlla("il risultato del giro arriva intatto a chi chiama, con l'esito del registro", r.valore === 1 && r.eseguita === true);

  const g = mondo();
  g.guasti.set("radar_esecuzioni|insert", 1);
  const rg = await giroRegistrato(comeAdmin(g), "pvl", { env: STAGING, adesso: () => T0, nuovoIdEsecuzione: () => UUID }, async () => ({ fatto: true }), () => datiOk);
  controlla("registro non scritto: il giro NON si ferma, l'esito lo dice, nessuna cancellazione", rg.fatto === true && !rg.esecuzione.scritta && rg.esecuzione.motivo === "scrittura_fallita" && !g.richieste.some((x) => x.tabella === "radar_esecuzioni" && x.metodo === "delete"), rg.esecuzione);

  const c = mondo();
  c.guasti.set("radar_esecuzioni|delete", 1);
  const rc = await scriviEsecuzione(comeAdmin(c), rigaEsecuzione({ id: UUID, fonte: "ted", origine: "programmato", iniziato: T0, finito: T1, ...datiOk }), T1);
  controlla("pulizia fallita: la riga resta scritta, l'errore della cancellazione è riportato", rc.scritta === true && rc.cancellate === null && !!rc.erroreCancellazione);

  for (const [nome, env] of [["produzione (PVL)", PRODUZIONE], ["anteprima", { ...STAGING, VERCEL_ENV: "preview" }], ["database sconosciuto", { NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co" }]] as const) {
    const n = mondo();
    const rn = await giroRegistrato(comeAdmin(n), "pvl", { env, adesso: () => T0, nuovoIdEsecuzione: () => UUID }, async () => ({ eseguita: true }), () => datiOk);
    controlla(`ambiente non consentito (${nome}): NESSUNA richiesta al registro, anche se il giro dice «eseguita»`, !n.richieste.some((x) => x.tabella === "radar_esecuzioni") && !rn.esecuzione.scritta && rn.esecuzione.motivo === "ambiente_non_consentito");
  }

  const e = mondo();
  let rilanciata = false;
  try {
    await giroRegistrato(comeAdmin(e), "sintel", { env: STAGING, adesso: () => T0, nuovoIdEsecuzione: () => UUID }, async () => {
      throw new Error("eccezione di prova con token " + "y".repeat(45));
    }, () => datiOk);
  } catch {
    rilanciata = true;
  }
  const re = e.t("radar_esecuzioni").find((x) => x.id === UUID);
  controlla("eccezione imprevista: riga «errore» scritta (ripulita) e l'eccezione riparte verso chi chiama", rilanciata && re?.esito === "errore" && /eccezione imprevista/.test(String(re?.errore)) && !/yyyyyyyyyy/.test(String(re?.errore)), re);
  const ep = mondo();
  let rilanciataP = false;
  try {
    await giroRegistrato(comeAdmin(ep), "pvl", { env: PRODUZIONE }, async () => {
      throw new Error("x");
    }, () => datiOk);
  } catch {
    rilanciataP = true;
  }
  controlla("eccezione in un ambiente non consentito: nessuna riga, eccezione rilanciata", rilanciataP && !ep.richieste.some((x) => x.tabella === "radar_esecuzioni"));
  const nul = mondo();
  const rnul = await giroRegistrato(comeAdmin(nul), "ted", { env: STAGING }, async () => ({ eseguita: false }), () => null);
  controlla("dati del giro nulli (tabelle assenti): nessuna scrittura", !nul.richieste.some((x) => x.tabella === "radar_esecuzioni") && !rnul.esecuzione.scritta && rnul.esecuzione.motivo === "non_registrato");
}

// ───────────────── i tre importatori: uscite anticipate registrate ─────────────────
function fonti(db: DbFinto, x: Partial<Record<FonteEsecuzione, { attiva: boolean; blocco_fino_a?: string | null }>>): void {
  db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: x[f]?.attiva ?? false, cursore: null, blocco_fino_a: x[f]?.blocco_fino_a ?? null, conteggi: {}, nascosta_ai_clienti: f === "sardegnacat" }));
}
async function provaImportatori(): Promise<void> {
  const futuro = new Date(T0.getTime() + 3_600_000).toISOString();
  const casi: [string, FonteEsecuzione, Parameters<typeof fonti>[1], (db: DbFinto) => Promise<{ esecuzione: { scritta: boolean } } & { eseguita: boolean; motivo?: string }>, string][] = [
    ["TED spenta", "ted", {}, (db) => eseguiImportazioneTed(comeAdmin(db), { tempoMassimoMs: 1000, pagineMassime: 1, env: STAGING, adesso: () => T0 }), "inerte"],
    ["TED occupata", "ted", { ted: { attiva: true, blocco_fino_a: futuro } }, (db) => eseguiImportazioneTed(comeAdmin(db), { tempoMassimoMs: 1000, pagineMassime: 1, env: STAGING, adesso: () => T0 }), "occupata"],
    ["PVL spenta", "pvl", {}, (db) => eseguiImportazionePvl(comeAdmin(db), { modo: "incrementale", tempoMassimoMs: 1000, env: STAGING, adesso: () => T0 }), "inerte"],
    ["PVL occupata", "pvl", { pvl: { attiva: true, blocco_fino_a: futuro } }, (db) => eseguiImportazionePvl(comeAdmin(db), { modo: "incrementale", tempoMassimoMs: 1000, env: STAGING, adesso: () => T0 }), "occupata"],
    ["Sintel spenta", "sintel", {}, (db) => eseguiImportazioneRegionale(comeAdmin(db), "sintel", { env: STAGING, adesso: () => T0 }), "inerte"],
    ["SardegnaCAT occupata", "sardegnacat", { sardegnacat: { attiva: true, blocco_fino_a: futuro } }, (db) => eseguiImportazioneRegionale(comeAdmin(db), "sardegnacat", { env: STAGING, adesso: () => T0 }), "occupata"],
  ];
  for (const [nome, fonte, stato, giro, atteso] of casi) {
    const db = new DbFinto();
    fonti(db, stato);
    const r = await giro(db);
    const righe = db.t("radar_esecuzioni");
    const v = righe[0] ? violazioni0128(righe[0] as unknown as RigaEsecuzione) : ["nessuna riga"];
    controlla(`importatore, ${nome}: UNA riga «${atteso}» della sua fonte, valida per la 0128`, r.eseguita === false && r.esecuzione.scritta && righe.length === 1 && righe[0].fonte === fonte && righe[0].esito === atteso && v.length === 0, { r, righe, v });
  }
  const dbc = new DbFinto();
  fonti(dbc, {});
  await eseguiImportazionePvl(comeAdmin(dbc), { modo: "incrementale", tempoMassimoMs: 1000, env: STAGING, adesso: () => T0, origine: "console" });
  controlla("importatore dalla console: modo «manuale»", dbc.t("radar_esecuzioni")[0]?.modo === "manuale");
  for (const [nome, env] of [["PVL in produzione", PRODUZIONE], ["TED da un computer locale verso la produzione", { NEXT_PUBLIC_SUPABASE_URL: PRODUZIONE.NEXT_PUBLIC_SUPABASE_URL }]] as const) {
    const db = new DbFinto();
    fonti(db, { ted: { attiva: true }, pvl: { attiva: true } });
    const r = nome.startsWith("PVL") ? await eseguiImportazionePvl(comeAdmin(db), { modo: "incrementale", tempoMassimoMs: 1000, env }) : await eseguiImportazioneTed(comeAdmin(db), { tempoMassimoMs: 1000, pagineMassime: 1, env });
    controlla(`importatore, ${nome}: ambiente non consentito, ZERO richieste al database (registro compreso)`, r.eseguita === false && db.conta() === 0 && !r.esecuzione.scritta, { r, richieste: db.richieste });
  }
}

// ───────────────── testi: importatori, rotte, console, script ─────────────────
function provaTesti(): void {
  const leggi = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  for (const [file, fonte, dati, pagina] of [
    ["src/lib/radar/importa-ted.ts", "\"ted\"", "datiGiroTed", /await applicaPaginaBandi\(admin, pagina\.avvisi\.map\(leggiBandoTed\), modo, adesso, totali\.db, \{ classificazioni, evidenza, esecuzioneId \}\)/],
    ["src/lib/radar/importa-pvl.ts", "\"pvl\"", "datiGiroPvl", /await applicaPaginaBandiPvl\(admin, bandi, modoImportazione, adesso, db, stat, \{ classificazioni, evidenza, grezzi, esecuzioneId \}\)/],
    ["src/lib/radar/importa-regionali.ts", "fonte", "datiGiroRegionale", /await applicaPaginaBandiRegionali\(admin, bandi\.slice\(i, i \+ 200\), \{ [^}]*classificazioni, evidenza, esecuzioneId \}\)/],
  ] as const) {
    const t = leggi(file);
    controlla(`testo ${path.basename(file)}: l'importatore esportato passa SOLO da giroRegistrato con la sua fonte`, new RegExp(`return giroRegistrato\\(admin, ${fonte}, opzioni, \\(esecuzioneId\\) => giro[A-Za-z]+\\(admin, [^)]*esecuzioneId\\), ${dati}\\);`).test(t));
    controlla(`testo ${path.basename(file)}: l'identificativo del giro arriva alla scrittura delle pagine (esecuzione_id della 0123)`, pagina.test(t));
  }
  for (const rotta of ["radar-ted", "radar-pvl", "radar-regionali"]) controlla(`rotta ${rotta}: nessuna «origine» (vale «programmato»)`, !/origine:/.test(leggi(`src/app/api/cron/${rotta}/route.ts`)));
  controlla("console: i 3 pulsanti «Esegui un giro adesso» dichiarano origine «console»", (leggi("src/app/site-console/azioni/tender-intelligence.ts").match(/origine: "console"/g) ?? []).length === 3);
  for (const s of ["radar-importa-ted.ts", "radar-importa-pvl.ts", "radar-importa-regionale.ts"]) controlla(`script ${s}: origine «script»`, /origine: "script"/.test(leggi(`scripts/${s}`)));
  const reg = leggi("src/lib/radar/esecuzioni.ts");
  controlla("esecuzioni.ts: sul registro solo insert e delete (la 0128 non dà update), cancellazione per fonte e data", !/from\("radar_esecuzioni"\)\.(update|upsert)/.test(reg) && /from\("radar_esecuzioni"\)\.delete\(\)\.eq\("fonte", riga\.fonte\)\.lt\("iniziato_il", soglia\(adesso\)\)/.test(reg));
  controlla("esecuzioni.ts: il permesso dell'ambiente si controlla prima del giro e di ogni scrittura", reg.indexOf("scrittureRadarConsentite(fonte") < reg.indexOf("await giro(id)") && /if \(permesso\) await scriviEsecuzione/.test(reg) && /if \(!permesso\) return/.test(reg));
}

async function principale(): Promise<void> {
  provaRighe();
  await provaGiro();
  await provaImportatori();
  provaTesti();
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica del registro dei giri (0128, K2): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
