// Verifica di K1 (piano 48C §3.1–§3.2, B2, 23/11/2026): porta oraria di Roma per fonte, righe cron proposte confrontate con gli orari
// giorno per giorno (cambi dell'ora compresi), ordine delle guardie, rotte cron (fuori orario o interruttore spento = nessuna lettura del
// database), doppio richiamo negli importatori. Tutto in memoria, dati SINTETICI, nessuna rete.
// Uso: npx tsx scripts/verifica-radar-giri-programmati.ts → codice 0 se tutto passa.
import fs from "node:fs";
import path from "node:path";
import { CRON_PROPOSTI, INTERRUTTORI_CRON, MINUTI_DOPPIO_RICHIAMO, ORARI_GIRI, ROTTE_CRON, TOLLERANZA_GIRO, eDoppioRichiamo, eOraDiUnGiro, istanteDiRoma, orariPrevisti, testoOrari } from "../src/lib/radar/programmazione-calcoli";
import { portaGiroProgrammato } from "../src/lib/radar/giro-programmato";
import { descrizioneFonte } from "../src/lib/radar/fonti/tipi";
import { CRON_PVL_PROPOSTO } from "../src/lib/radar/importa-pvl-calcoli";
import { FONTI_ESECUZIONI, type FonteEsecuzione } from "../src/lib/radar/esecuzioni-calcoli";
import { eseguiImportazioneTed } from "../src/lib/radar/importa-ted";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { DbFinto } from "./lib/db-finto-motore";
import type { SupabaseClient } from "@supabase/supabase-js";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
}
// nessuna rete e nessun database vero: niente chiavi nell'ambiente di questa prova
globalThis.fetch = (async () => {
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;
for (const k of Object.keys(process.env)) if (/SUPABASE|SERVICE_ROLE|RADAR_/.test(k)) delete process.env[k];

const minuti = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

// ═════ porta oraria ═════
function provaPorta(): void {
  const casi: [FonteEsecuzione, string, string][] = [
    ["pvl", "2026-12-01", "08:05"], // inverno
    ["pvl", "2026-07-01", "13:05"], // estate
    ["pvl", "2026-03-29", "08:05"], // giorno del passaggio all'ora legale
    ["pvl", "2026-10-25", "18:05"], // giorno del ritorno all'ora solare
    ["ted", "2026-11-23", "10:15"],
    ["ted", "2026-07-15", "16:15"],
    ["sintel", "2026-03-29", "07:40"],
    ["sintel", "2026-10-25", "13:40"],
    ["sardegnacat", "2026-11-23", "17:20"],
    ["sardegnacat", "2026-11-22", "12:20"], // domenica
    ["sardegnacat", "2026-07-04", "12:20"], // sabato d'estate
  ];
  for (const [f, g, o] of casi) {
    const t = istanteDiRoma(g, o);
    const esiti = [0, -1, 24, -3, 26].map((m) => eOraDiUnGiro(f, minuti(t, m)));
    controlla(`porta ${f} ${g} ${o} (Roma): sì all'orario, 1 minuto prima e 24 dopo; no 3 minuti prima e 26 dopo`, JSON.stringify(esiti) === "[true,true,true,false,false]", esiti);
  }
  controlla("porta: l'ora UTC non è l'ora di Roma (le 08:05 UTC d'inverno sono le 09:05 a Roma: no)", !eOraDiUnGiro("pvl", new Date("2026-12-01T08:05:00Z")) && eOraDiUnGiro("pvl", new Date("2026-12-01T07:05:00Z")));
  controlla("porta: TED il sabato no; SardegnaCAT alle 08:20 della domenica no, alle 12:20 del lunedì no", !eOraDiUnGiro("ted", istanteDiRoma("2026-11-21", "10:15")) && !eOraDiUnGiro("sardegnacat", istanteDiRoma("2026-11-22", "08:20")) && !eOraDiUnGiro("sardegnacat", istanteDiRoma("2026-11-23", "12:20")));
  controlla("tolleranza del 48C §3.2: ritardo fino a 25 minuti, 2 di anticipo", TOLLERANZA_GIRO.ritardoMinuti === 25 && TOLLERANZA_GIRO.anticipoMinuti === 2);
}

// ═════ righe cron proposte = orari approvati, giorno per giorno ═════
/** Gli istanti UTC in cui una riga «m h1,h2 * * gs» scatta in un giorno UTC (solo le forme usate qui: minuto fisso, ore in elenco, giorni della settimana in elenco o intervallo). */
function scattiCron(riga: string, giornoUtc: string): Date[] {
  const [m, h, gm, mese, gs] = riga.split(" ");
  if (gm !== "*" || mese !== "*" || !/^\d+$/.test(m)) throw new Error(`riga non gestita: ${riga}`);
  const giorniOk = (d: number) => gs === "*" || gs.split(",").some((p) => (p.includes("-") ? d >= Number(p.split("-")[0]) && d <= Number(p.split("-")[1]) : d === Number(p)));
  const giorno = new Date(`${giornoUtc}T00:00:00Z`);
  if (!giorniOk(giorno.getUTCDay())) return [];
  return h.split(",").map((x) => new Date(`${giornoUtc}T${x.padStart(2, "0")}:${m.padStart(2, "0")}:00Z`));
}
function provaRigheCron(): void {
  for (const f of FONTI_ESECUZIONI) {
    const diff: string[] = [];
    let giri = 0;
    for (let g = new Date("2026-01-01T00:00:00Z"); g < new Date("2028-01-01T00:00:00Z"); g = new Date(g.getTime() + 86_400_000)) {
      const giorno = g.toISOString().slice(0, 10);
      const previsti = orariPrevisti(f, new Date(g.getTime() - 1), new Date(g.getTime() + 86_400_000 - 1)).map((d) => d.toISOString());
      const scatti = CRON_PROPOSTI[f].flatMap((r) => scattiCron(r, giorno));
      const passano = scatti.filter((d) => eOraDiUnGiro(f, d)).map((d) => d.toISOString()).sort();
      giri += previsti.length;
      if (JSON.stringify(passano) !== JSON.stringify(previsti) && diff.length < 3) diff.push(`${giorno}: previsti ${previsti.join(" ")} | passano ${passano.join(" ")}`);
    }
    controlla(`${f}: le righe cron proposte (${CRON_PROPOSTI[f].join(" ; ")}) fanno passare ESATTAMENTE i giri previsti, all'orario, ogni giorno del 2026 e del 2027 (${giri} giri, 4 cambi dell'ora)`, diff.length === 0, diff);
  }
  controlla("PVL: la riga proposta è quella di prima (CRON_PVL_PROPOSTO, mostrata in console)", CRON_PROPOSTI.pvl.length === 1 && CRON_PROPOSTI.pvl[0] === CRON_PVL_PROPOSTO);
  controlla("orari invariati rispetto a K3 (D2, D5)", ORARI_GIRI.ted.length === 2 && ORARI_GIRI.sardegnacat.length === 5);
  controlla("UNA riga cron per rotta (non si dipende da due righe sullo stesso percorso in vercel.json)", FONTI_ESECUZIONI.every((f) => CRON_PROPOSTI[f].length === 1));
  // il testo «aggiornamento» delle fonti (console e riquadro delle fonti nelle pagine dei clienti): orari da ORARI_GIRI, frase neutra
  controlla("orari in parole: PVL e SardegnaCAT", testoOrari("pvl") === "alle 08:05, 13:05 e 18:05 tutti i giorni" && testoOrari("sardegnacat") === "alle 08:20, 11:20, 14:20 e 17:20 dal lunedì al venerdì; alle 12:20 il sabato e la domenica", [testoOrari("pvl"), testoOrari("sardegnacat")]);
  for (const f of FONTI_ESECUZIONI) {
    const t = descrizioneFonte(f).aggiornamento;
    controlla(`fonte ${f}: «aggiornamento» con gli orari veri (da ORARI_GIRI), frase neutra «giri previsti», niente «non ancora attivi» né orari a mano`, t.startsWith("Giri previsti ") && t.includes(testoOrari(f)) && !/non ancora attiv|alle 8, alle 13|staging/i.test(t), t);
  }
}

// ═════ guardie 2 e 3, in ordine ═════
function provaGuardie(): void {
  const dentro = istanteDiRoma("2026-11-23", "10:15"), fuori = istanteDiRoma("2026-11-23", "11:15");
  for (const f of FONTI_ESECUZIONI) {
    const on = { [INTERRUTTORI_CRON[f]]: "attivo" };
    const dentroF = orariPrevisti(f, new Date(dentro.getTime() - 86_400_000), dentro).pop() ?? dentro;
    controlla(`${f}: interruttore spento → «giri_programmati_non_attivi» anche fuori orario (l'interruttore viene prima della porta)`, (portaGiroProgrammato(f, {}, fuori) as { motivo?: string }).motivo === "giri_programmati_non_attivi" && (portaGiroProgrammato(f, {}, dentroF) as { motivo?: string }).motivo === "giri_programmati_non_attivi");
    controlla(`${f}: interruttore acceso fuori orario → «fuori_orario»; all'orario → passa`, (portaGiroProgrammato(f, on, minuti(dentroF, 90)) as { motivo?: string }).motivo === "fuori_orario" && portaGiroProgrammato(f, on, dentroF).passa);
    controlla(`${f}: vale solo «attivo» e solo il suo interruttore`, !portaGiroProgrammato(f, { [INTERRUTTORI_CRON[f]]: "Attivo" }, dentroF).passa && !portaGiroProgrammato(f, { [INTERRUTTORI_CRON[f]]: "1" }, dentroF).passa && !portaGiroProgrammato(f, { RADAR_REGIONALI_CRON: "attivo", ...Object.fromEntries(FONTI_ESECUZIONI.filter((x) => x !== f).map((x) => [INTERRUTTORI_CRON[x], "attivo"])) }, dentroF).passa);
  }
  controlla("interruttori: RADAR_TED_CRON, RADAR_PVL_CRON, RADAR_SINTEL_CRON, RADAR_SARDEGNACAT_CRON", JSON.stringify(INTERRUTTORI_CRON) === JSON.stringify({ ted: "RADAR_TED_CRON", pvl: "RADAR_PVL_CRON", sintel: "RADAR_SINTEL_CRON", sardegnacat: "RADAR_SARDEGNACAT_CRON" }));
}

// ═════ rotte cron: testo e comportamento ═════
const leggi = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const IMPORTATORE: Record<FonteEsecuzione, string> = { ted: "eseguiImportazioneTed(createAdminClient()", pvl: "eseguiImportazionePvl(createAdminClient()", sintel: 'eseguiImportazioneRegionale(createAdminClient(), "sintel"', sardegnacat: 'eseguiImportazioneRegionale(createAdminClient(), "sardegnacat"' };
async function provaRotte(): Promise<void> {
  for (const f of FONTI_ESECUZIONI) {
    const file = `src/app${ROTTE_CRON[f]}/route.ts`;
    const t = leggi(file);
    const i = [t.indexOf('cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)'), t.indexOf(`portaGiroProgrammato("${f}", process.env, new Date())`), t.indexOf("createAdminClient()"), t.indexOf(IMPORTATORE[f])];
    // il client del database si crea UNA volta sola, dentro la chiamata all'importatore, dopo il segreto e la porta
    controlla(`rotta ${ROTTE_CRON[f]}: segreto, poi porta della SUA fonte, poi il database e l'importatore (in quest'ordine)`, i.every((x) => x > 0) && i[0] < i[1] && i[1] < i[3] && i[3] < i[2] && (t.match(/createAdminClient\(\)/g) ?? []).length === 1, i);
    controlla(`rotta ${ROTTE_CRON[f]}: nessuna «origine» (vale «programmato»), maxDuration 300`, !/origine:/.test(t) && /export const maxDuration = 300;/.test(t));

    // comportamento vero della rotta, senza chiavi del database nell'ambiente: se arrivasse al database finirebbe in «errore_imprevisto»
    const { GET } = (await import(`../${file.replace(/\.ts$/, "")}`)) as { GET: (r: unknown) => Promise<Response> };
    const richiesta = (segreto: string) => ({ headers: new Headers({ authorization: `Bearer ${segreto}` }) });
    process.env.CRON_SECRET = "segreto-sintetico-di-prova";
    const r401 = await GET(richiesta("sbagliato"));
    const spenta = await GET(richiesta("segreto-sintetico-di-prova"));
    const corpoSpenta = (await spenta.json()) as { motivo?: string };
    process.env[INTERRUTTORI_CRON[f]] = "attivo";
    const adesso = new Date();
    const accesa = (await (await GET(richiesta("segreto-sintetico-di-prova"))).json()) as { motivo?: string };
    delete process.env[INTERRUTTORI_CRON[f]];
    delete process.env.CRON_SECRET;
    controlla(`rotta ${ROTTE_CRON[f]}: segreto sbagliato → 401; interruttore spento → «giri_programmati_non_attivi» senza toccare il database`, r401.status === 401 && spenta.status === 200 && corpoSpenta.motivo === "giri_programmati_non_attivi", corpoSpenta);
    // con l'interruttore acceso: fuori orario esce prima del database; all'orario prova il database (qui assente: «errore_imprevisto»)
    const atteso = eOraDiUnGiro(f, adesso) ? "errore_imprevisto" : "fuori_orario";
    controlla(`rotta ${ROTTE_CRON[f]}: interruttore acceso, adesso → «${atteso}»`, accesa.motivo === atteso, accesa);
  }
  controlla("la vecchia rotta radar-regionali resta com'era (RADAR_REGIONALI_CRON), finché il coordinamento non cambia vercel.json", /process\.env\.RADAR_REGIONALI_CRON !== "attivo"/.test(leggi("src/app/api/cron/radar-regionali/route.ts")));
  const vercel = JSON.parse(leggi("vercel.json")) as { crons?: { path: string }[] };
  controlla("vercel.json NON cambia con K1 (sintel e sardegnacat assenti: la proposta è nel documento 51)", !(vercel.crons ?? []).some((c) => /sintel|sardegna/.test(c.path)));
}

// ═════ doppio richiamo (guardia 7) ═════
const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const T0 = new Date("2026-11-23T09:15:00Z");
function mondo(fonte: FonteEsecuzione, successoMinutiFa: number | null): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: f === fonte, ultimo_successo_il: f === fonte && successoMinutiFa !== null ? minuti(T0, -successoMinutiFa).toISOString() : null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false }));
  return db;
}
function contatore() {
  const c = { n: 0 };
  const fetchFn = (async () => {
    c.n++;
    throw new Error("fonte finta irraggiungibile");
  }) as typeof fetch;
  return { c, fetchFn };
}
async function giro(fonte: FonteEsecuzione, db: DbFinto, fetchFn: typeof fetch, origine?: "console" | "script") {
  const admin = db as unknown as SupabaseClient;
  const base = { env: STAGING, adesso: () => T0, fetchFn, ...(origine ? { origine } : {}) };
  if (fonte === "ted") return eseguiImportazioneTed(admin, { ...base, tempoMassimoMs: 1_000, pagineMassime: 1, pausaMs: 0 });
  if (fonte === "pvl") return eseguiImportazionePvl(admin, { ...base, modo: "incrementale", tempoMassimoMs: 1_000, limiti: { tentativi: 1 } });
  return eseguiImportazioneRegionale(admin, fonte, { ...base, tempoMassimoMs: 1_000, limiti: { tentativi: 1 } });
}
async function provaDoppioRichiamo(): Promise<void> {
  controlla("doppio richiamo: 45 minuti (48C §3.1 punto 7)", MINUTI_DOPPIO_RICHIAMO === 45);
  controlla("doppio richiamo, regola pura: solo giri programmati, solo un successo passato e recente", eDoppioRichiamo(undefined, minuti(T0, -20).toISOString(), T0) && eDoppioRichiamo("programmato", minuti(T0, -44).toISOString(), T0) && !eDoppioRichiamo("programmato", minuti(T0, -46).toISOString(), T0) && !eDoppioRichiamo("console", minuti(T0, -20).toISOString(), T0) && !eDoppioRichiamo("script", minuti(T0, -20).toISOString(), T0) && !eDoppioRichiamo(undefined, null, T0) && !eDoppioRichiamo(undefined, minuti(T0, 10).toISOString(), T0) && !eDoppioRichiamo(undefined, "non-una-data", T0));
  for (const f of FONTI_ESECUZIONI) {
    const db = mondo(f, 20);
    const { c, fetchFn } = contatore();
    const r = await giro(f, db, fetchFn);
    const reg = db.t("radar_esecuzioni");
    const aggiornamenti = db.richieste.filter((q) => q.tabella === "radar_fonti_stato" && q.metodo !== "select").length;
    controlla(`${f}: giro programmato 20 minuti dopo un giro riuscito → «gia_eseguito», nessuna chiamata alla fonte, nessuna scrittura dello stato, riga «gia_eseguito» nel registro`, !r.eseguita && r.motivo === "gia_eseguito" && c.n === 0 && aggiornamenti === 0 && reg.length === 1 && reg[0].esito === "gia_eseguito", { r, chiamate: c.n, aggiornamenti, reg });
    const dbC = mondo(f, 20);
    const fc = contatore();
    const rc = await giro(f, dbC, fc.fetchFn, "console");
    controlla(`${f}: dalla console lo stesso giro parte (la fonte viene chiamata)`, rc.eseguita && fc.c.n > 0, { rc, chiamate: fc.c.n });
    const db50 = mondo(f, 50);
    const f50 = contatore();
    const r50 = await giro(f, db50, f50.fetchFn);
    controlla(`${f}: 50 minuti dopo il giro programmato parte`, r50.eseguita && f50.c.n > 0, { r50, chiamate: f50.c.n });
  }
}

async function principale(): Promise<void> {
  provaPorta();
  provaRigheCron();
  provaGuardie();
  await provaRotte();
  await provaDoppioRichiamo();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica dei giri programmati (K1): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
