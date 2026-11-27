// Verifica dello script di accensione delle fonti regionali per il C8 (documento 52, passo A0; B2, 23/11/2026): su un database IN MEMORIA,
// senza rete. Una riga sola, solo da spenta ad accesa, idempotente, mai una fonte sospesa, mai altri campi, guardie dello staging.
// Uso: npx tsx scripts/verifica-c8-accensione.ts → codice 0 se tutto passa.
import { FONTI_ACCENDIBILI, accendiFonteRegionale, applica } from "./c8/accendi-regionale-staging";
import { FermoCollaudo } from "./collaudo-z8/collaudo-motore-z8";
import { DbFinto } from "./lib/db-finto-motore";
import type { ClientDb } from "../src/lib/radar/notifiche/motore";

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

const ORA = new Date("2026-11-24T08:00:00Z");
const SEMAFORO = "2099-01-01T00:00:00+00:00";
// lo staging di oggi (letto il 23/11 con 52_controlli_c8.mjs stato): Sintel e SardegnaCAT spente, semaforo chiuso su tutte
function mondo(righe = [
  { fonte: "pvl", attiva: true, nascosta_ai_clienti: false, blocco_fino_a: SEMAFORO, cursore: { versione: 1 }, conteggi: {}, aggiornata_il: "2026-11-23T11:28:40Z" },
  { fonte: "sardegnacat", attiva: false, nascosta_ai_clienti: true, blocco_fino_a: SEMAFORO, cursore: null, conteggi: {}, aggiornata_il: "2026-11-17T14:00:00Z" },
  { fonte: "sintel", attiva: false, nascosta_ai_clienti: false, blocco_fino_a: SEMAFORO, cursore: null, conteggi: {}, aggiornata_il: "2026-11-17T14:00:00Z" },
  { fonte: "ted", attiva: true, nascosta_ai_clienti: false, blocco_fino_a: SEMAFORO, cursore: { versione: 1 }, conteggi: {}, aggiornata_il: "2026-11-17T13:00:00Z" },
  // Fase 2: la riga di SATER come la crea la 0134 (spenta, nascosta ai clienti, semaforo chiuso)
  { fonte: "sater", attiva: false, nascosta_ai_clienti: true, blocco_fino_a: SEMAFORO, cursore: null, conteggi: {}, aggiornata_il: "2026-11-27T10:00:00Z" },
  // Fase 2: la riga di TuttoGare come la crea la 0135 proposta (spenta, nascosta ai clienti, semaforo chiuso)
  { fonte: "tuttogare", attiva: false, nascosta_ai_clienti: true, blocco_fino_a: SEMAFORO, cursore: null, conteggi: {}, aggiornata_il: "2026-11-27T10:00:00Z" },
  // Fase 2: la riga di START come la crea la 0137 proposta (spenta, nascosta ai clienti, semaforo chiuso)
  { fonte: "start", attiva: false, nascosta_ai_clienti: true, blocco_fino_a: SEMAFORO, cursore: null, conteggi: {}, aggiornata_il: "2026-11-27T10:00:00Z" },
  // Fase 2: le righe di EmPULIA e SIAPS come le creano la 0138 e la 0139 proposte (spente, nascoste ai clienti, semaforo chiuso)
  { fonte: "empulia", attiva: false, nascosta_ai_clienti: true, blocco_fino_a: SEMAFORO, cursore: null, conteggi: {}, aggiornata_il: "2026-11-27T10:00:00Z" },
  { fonte: "siaps", attiva: false, nascosta_ai_clienti: true, blocco_fino_a: SEMAFORO, cursore: null, conteggi: {}, aggiornata_il: "2026-11-27T10:00:00Z" },
]) {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = righe.map((r) => ({ ...r }));
  return db;
}
const tranne = (db: DbFinto, f: string) => JSON.stringify(db.t("radar_fonti_stato").filter((r) => r.fonte !== f));

async function principale(): Promise<void> {
  controlla("fonti accendibili: solo Sintel, SardegnaCAT, SATER, TuttoGare, START, EmPULIA e SIAPS (Fase 2, collaudo sullo staging)", JSON.stringify(FONTI_ACCENDIBILI) === '["sintel","sardegnacat","sater","tuttogare","start","empulia","siaps"]');
  for (const fonte of FONTI_ACCENDIBILI) {
    const db = mondo();
    const prima = tranne(db, fonte);
    const e = await accendiFonteRegionale(db as unknown as ClientDb, fonte, ORA);
    const riga = db.t("radar_fonti_stato").find((r) => r.fonte === fonte)!;
    controlla(`${fonte}: da spenta ad accesa, UNA riga cambiata`, e.cambiate === 1 && !e.primaAttiva && e.dopoAttiva && riga.attiva === true, e);
    controlla(`${fonte}: cambiano SOLO attiva e aggiornata_il (blocco del semaforo, visibilità, cursore intatti)`, riga.blocco_fino_a === SEMAFORO && riga.cursore === null && riga.aggiornata_il === ORA.toISOString() && riga.nascosta_ai_clienti === (fonte === "sardegnacat" || fonte === "sater" || fonte === "tuttogare" || fonte === "start" || fonte === "empulia" || fonte === "siaps"), riga);
    controlla(`${fonte}: le altre fonti IDENTICHE`, tranne(db, fonte) === prima);
    controlla(`${fonte}: 3 richieste (lettura, scrittura condizionata, rilettura), UNA scrittura`, db.conta() === 3 && db.richieste.filter((r) => r.metodo === "update").length === 1);
    const foto = JSON.stringify(db.t("radar_fonti_stato"));
    const e2 = await accendiFonteRegionale(db as unknown as ClientDb, fonte, new Date("2026-11-25T08:00:00Z"));
    controlla(`${fonte}: ripetuto non cambia NULLA (idempotente, nemmeno aggiornata_il)`, e2.cambiate === 0 && e2.primaAttiva && JSON.stringify(db.t("radar_fonti_stato")) === foto);
  }
  // una fonte sospesa dal connettore non si riaccende da qui
  const sospesa = mondo();
  sospesa.t("radar_fonti_stato").find((r) => r.fonte === "sintel")!.conteggi = { sospensione: { il: "2026-11-20T08:00:00Z", motivo: "HTTP 429" } };
  let fermoSosp = false;
  try {
    await accendiFonteRegionale(sospesa as unknown as ClientDb, "sintel", ORA);
  } catch (x) {
    fermoSosp = x instanceof FermoCollaudo && /SOSPESA/.test(x.message);
  }
  controlla("fonte SOSPESA: si ferma (si riaccende solo dalla console), nessuna scrittura", fermoSosp && !sospesa.richieste.some((r) => r.metodo === "update"));
  // fonti non ammesse e riga mancante
  let fermoTed = false;
  const dbT = mondo();
  try {
    await accendiFonteRegionale(dbT as unknown as ClientDb, "ted" as "sintel", ORA);
  } catch (x) {
    fermoTed = x instanceof FermoCollaudo && /non ammessa/.test(x.message);
  }
  controlla("TED o PVL: rifiutate, nessuna richiesta al database", fermoTed && dbT.conta() === 0);
  const senza = mondo([{ fonte: "ted", attiva: true, nascosta_ai_clienti: false, blocco_fino_a: SEMAFORO, cursore: null, conteggi: {}, aggiornata_il: "x" }]);
  let fermoRiga = false;
  try {
    await accendiFonteRegionale(senza as unknown as ClientDb, "sintel", ORA);
  } catch (x) {
    fermoRiga = x instanceof FermoCollaudo && /riga «sintel»/.test(x.message);
  }
  controlla("senza la riga della fonte si ferma con il suo motivo e non scrive", fermoRiga && !senza.richieste.some((r) => r.metodo === "update"));

  // guardie del lancio vero
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
  await rifiuta("senza autorizzazione registrata", () => applica(ambiente, "sintel", { controllaPorta: () => { throw new Error("negata"); } }));
  await rifiuta("database di produzione", () => applica({ ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co" }, "sintel", porta));
  await rifiuta("un altro progetto", () => applica({ ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://altroprogettosintetico.supabase.co" }, "sintel", porta));
  await rifiuta("su Vercel", () => applica({ ...ambiente, VERCEL_ENV: "preview" }, "sintel", porta));
  await rifiuta("un valore della produzione in un'altra variabile", () => applica({ ...ambiente, SUPABASE_SERVICE_ROLE_KEY: "chiave-bihfrzspqxsrzlbqqvqa" }, "sintel", porta));
  const n = chiamate.length;
  let fermato = false;
  try {
    await applica(ambiente, "sardegnacat", porta);
  } catch {
    fermato = true;
  }
  controlla("guardie superate: un errore della prima lettura ferma tutto, solo verso lo staging", fermato && chiamate.slice(n).length === 1 && chiamate.slice(n).every((u) => u.startsWith("https://ryawdldqiumqsskrnyps.supabase.co/rest/v1/radar_fonti_stato?select")), chiamate.slice(n));
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica dell'accensione delle fonti regionali per il C8: ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
