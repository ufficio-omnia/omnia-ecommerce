// Verifica di K11 (48E, D4-bis, B2, 23/11/2026): SardegnaCAT VISIBILE ai clienti senza parere. Lo script dello staging su un database IN
// MEMORIA, senza rete, e la regola unica delle pagine con la riga «sardegnacat» assente, visibile e nascosta.
// Uso: npx tsx scripts/verifica-sardegnacat-visibile.ts → codice 0 se tutto passa.
import fs from "fs";
import path from "path";
import { applica, rendiSardegnacatVisibile } from "./sardegnacat-visibile/sardegnacat-visibile-staging";
import { FermoCollaudo } from "./collaudo-z8/collaudo-motore-z8";
import { DbFinto } from "./lib/db-finto-motore";
import type { ClientDb } from "../src/lib/radar/notifiche/motore";
import { FONTI_NASCOSTE_PREDEFINITE, fontiNascosteDa, garaVisibileAiClienti, riepilogoFonti, type AvvisoLetto } from "../src/lib/radar/fonti-gara-calcoli";
import { FONTI_RADAR as DESCRIZIONI_FONTI } from "../src/lib/radar/fonti/tipi";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 400)}`}`);
}
const chiamate: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  chiamate.push(String(input instanceof URL ? input.href : typeof input === "string" ? input : input.url));
  return new Response(JSON.stringify({ code: "XX000", message: "finto" }), { status: 500, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const ORA = new Date("2026-11-23T16:00:00Z");
// lo staging dopo il 48B: PVL visibile, SardegnaCAT nascosta (0120), TED e Sintel visibili
function mondo(righe = [
  { fonte: "pvl", attiva: true, nascosta_ai_clienti: false, cursore: { giorno: "2026-11-17" }, aggiornata_il: "2026-11-23T11:28:40Z" },
  { fonte: "sardegnacat", attiva: false, nascosta_ai_clienti: true, cursore: null, aggiornata_il: "2026-11-17T14:00:00Z" },
  { fonte: "sintel", attiva: false, nascosta_ai_clienti: false, cursore: null, aggiornata_il: "2026-11-17T14:00:00Z" },
  { fonte: "ted", attiva: true, nascosta_ai_clienti: false, cursore: { giorno: "2026-11-17" }, aggiornata_il: "2026-11-17T13:00:00Z" },
]) {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = righe.map((r) => ({ ...r }));
  return db;
}
const altre = (db: DbFinto) => JSON.stringify(db.t("radar_fonti_stato").filter((r) => r.fonte !== "sardegnacat"));
const nascosteDa = (db: DbFinto) => fontiNascosteDa(db.t("radar_fonti_stato") as { fonte: string; nascosta_ai_clienti: boolean | null }[]);

async function principale(): Promise<void> {
  // ── la regola (fonti-gara-calcoli.ts) e i testi della fonte ──
  controlla("regola: nessuna fonte nascosta di base (48A PVL, 48E SardegnaCAT)", FONTI_NASCOSTE_PREDEFINITE.length === 0 && fontiNascosteDa([]).length === 0);
  const sarda = DESCRIZIONI_FONTI.find((f) => f.id === "sardegnacat");
  controlla("testi della fonte SardegnaCAT: nessun «non ancora mostrata» né «in attesa di parere»", !!sarda && !JSON.stringify(sarda).match(/Non ancora mostrata|in attesa di parere|serve il parere/), sarda);
  const commento = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "radar", "fonti", "aflink-calcoli.ts"), "utf8").slice(0, 1500);
  controlla("aflink-calcoli.ts: la regola della licenza dice «visibili senza aspettare il parere» (48E)", /visibili ai clienti senza\s*\/\/\s*aspettare il parere legale/.test(commento) && !/ai clienti solo dopo il parere legale/.test(commento));

  // ── lo script dello staging ──
  const db = mondo();
  controlla("prima: per la regola unica è nascosta SOLO SardegnaCAT", JSON.stringify(nascosteDa(db)) === JSON.stringify(["sardegnacat"]));
  const prima = altre(db);
  const e = await rendiSardegnacatVisibile(db as unknown as ClientDb, ORA);
  const riga = db.t("radar_fonti_stato").find((r) => r.fonte === "sardegnacat")!;
  controlla("SardegnaCAT da nascosta a visibile, UNA riga cambiata", e.cambiate === 1 && e.primaNascosta === true && e.dopoNascosta === false && riga.nascosta_ai_clienti === false);
  controlla("della riga cambiano SOLO nascosta_ai_clienti e aggiornata_il (attiva, cursore intatti)", riga.attiva === false && riga.cursore === null && riga.aggiornata_il === ORA.toISOString() && Object.keys(riga).length === 5);
  controlla("le altre fonti IDENTICHE (PVL, Sintel, TED)", altre(db) === prima);
  controlla("dopo: nessuna fonte nascosta", nascosteDa(db).length === 0);
  controlla("3 richieste (lettura, scrittura condizionata, rilettura), UNA scrittura", db.conta() === 3 && db.richieste.filter((r) => r.metodo === "update").length === 1);
  const fotografia = JSON.stringify(db.t("radar_fonti_stato"));
  const e2 = await rendiSardegnacatVisibile(db as unknown as ClientDb, new Date("2026-11-24T12:00:00Z"));
  controlla("ripetuto: non cambia NULLA (idempotente, nemmeno aggiornata_il)", e2.cambiate === 0 && e2.primaNascosta === false && JSON.stringify(db.t("radar_fonti_stato")) === fotografia);
  let fermo = false;
  const senza = mondo([{ fonte: "ted", attiva: true, nascosta_ai_clienti: false, cursore: null, aggiornata_il: "x" }]);
  try {
    await rendiSardegnacatVisibile(senza as unknown as ClientDb, ORA);
  } catch (x) {
    fermo = x instanceof FermoCollaudo && /riga «sardegnacat»/.test(x.message);
  }
  controlla("senza la riga «sardegnacat» si ferma con il suo motivo e non scrive", fermo && !senza.richieste.some((r) => r.metodo === "update"));
  const catena = (risultato: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) c[m] = () => c;
    c.then = (ok: (x: unknown) => unknown, ko?: (x: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
    return c;
  };
  const sordo = { from: () => ({ select: () => catena({ data: [{ fonte: "sardegnacat", nascosta_ai_clienti: true }], error: null }), update: () => catena({ data: [], error: null }) }) };
  let fermoDopo = false;
  try {
    await rendiSardegnacatVisibile(sordo as unknown as ClientDb, ORA);
  } catch (x) {
    fermoDopo = x instanceof FermoCollaudo && /ancora nascosta/.test(x.message);
  }
  controlla("se dopo la scrittura risulta ancora nascosta si ferma con il suo motivo", fermoDopo);
  const ambiente = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_finto_per_la_prova", VERCEL_ENV: undefined as string | undefined };
  const porta = { controllaPorta: () => undefined };
  const rifiuta = async (nome: string, f: () => Promise<unknown>) => {
    const n = chiamate.length;
    let errore = false;
    try {
      await f();
    } catch {
      errore = true;
    }
    controlla(`${nome} → rifiutato senza nessuna richiesta`, errore && chiamate.length === n);
  };
  await rifiuta("senza autorizzazione registrata", () => applica(ambiente, { controllaPorta: () => { throw new Error("negata"); } }));
  await rifiuta("database di produzione", () => applica({ ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co" }, porta));
  await rifiuta("un altro progetto (né staging né produzione)", () => applica({ ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://altroprogettosintetico.supabase.co" }, porta));
  await rifiuta("su Vercel", () => applica({ ...ambiente, VERCEL_ENV: "preview" }, porta));
  await rifiuta("un valore della produzione in un'altra variabile", () => applica({ ...ambiente, SUPABASE_SERVICE_ROLE_KEY: "chiave-bihfrzspqxsrzlbqqvqa" }, porta));
  const n = chiamate.length;
  let fermato = false;
  try {
    await applica(ambiente, porta);
  } catch {
    fermato = true;
  }
  controlla("guardie superate: un errore della prima lettura ferma tutto, solo verso lo staging", fermato && chiamate.slice(n).length === 1 && chiamate.slice(n).every((u) => u.startsWith("https://ryawdldqiumqsskrnyps.supabase.co/rest/v1/radar_fonti_stato?select=")));
  const testo = fs.readFileSync(path.join(__dirname, "sardegnacat-visibile", "sardegnacat-visibile-staging.ts"), "utf8");
  controlla("testo: scrittura condizionata a fonte = sardegnacat E nascosta = true, mette solo false", /\.update\(\{ nascosta_ai_clienti: false, aggiornata_il: adesso\.toISOString\(\) \}\)\s*\.eq\("fonte", "sardegnacat"\)\s*\.eq\("nascosta_ai_clienti", true\)/.test(testo) && !/"pvl"/.test(testo));
  controlla("testo: autorizzazione prima dell'osservatore e del client, col nome del file", testo.indexOf("controllaPorta({ script") < testo.indexOf("installaOsservatore(url") && testo.indexOf("installaOsservatore(url") < testo.indexOf("createClient(url") && /controllaPorta\(\{ script: "sardegnacat-visibile-staging\.ts" \}\)/.test(testo));

  // ── pagine: una gara solo SardegnaCAT con la riga assente, visibile e nascosta ──
  const sola = { chiave: "sardegnacat:SCAT-1", fonti: ["sardegnacat"] };
  const unita = { chiave: "sintel:SINT-1", fonti: ["sintel", "sardegnacat"] };
  const avvisi: AvvisoLetto[] = [{ fonte: "sardegnacat", id_fonte: "SCAT-1", url: "https://esempio.invalid/scat/1", pubblicato_il: "2026-11-20", tipo_avviso: null, rilevato_il: "2026-11-20T08:00:00Z" }];
  for (const [nome, righe] of [["assente (produzione dopo il passo di rilascio)", []], ["visibile (staging dopo la richiesta)", [{ fonte: "sardegnacat", nascosta_ai_clienti: false }]]] as const) {
    const nascoste = new Set<string>(fontiNascosteDa(righe));
    controlla(`pagine, riga ${nome}: la gara solo SardegnaCAT si vede, con il suo avviso`, garaVisibileAiClienti(sola, nascoste) && riepilogoFonti(avvisi.filter((a) => !nascoste.has(a.fonte)), {}).length === 1);
  }
  const nascosta = new Set<string>(fontiNascosteDa([{ fonte: "sardegnacat", nascosta_ai_clienti: true }]));
  controlla("pagine, riga nascosta (dalla console, o lo staging di oggi): la sola SardegnaCAT no, l'unita con Sintel sì", !garaVisibileAiClienti(sola, nascosta) && garaVisibileAiClienti(unita, nascosta));
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica K11 (SardegnaCAT visibile senza parere, 48E): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
