// Verifica di K5 (piano 48C §3.3, D3): TED con recupero iniziale di 90 giorni (parametro, al più 365) e sospensione SOLO su 401 e 403
// (API ufficiale: per gli altri errori nessuna sospensione nuova, li segnala l'allarme «errori_ripetuti»). Giri TED veri in memoria con
// una TED finta (risposte sintetiche), nessuna rete. Uso: npx tsx scripts/verifica-radar-ted-k5.ts → codice 0 se tutto passa.
import { GIORNI_RECUPERO, cursoreAllAvvio, cursoreIniziale, giorniRecuperoValidi } from "../src/lib/radar/importa-ted-calcoli";
import { eseguiImportazioneTed } from "../src/lib/radar/importa-ted";
import { FONTI_ESECUZIONI } from "../src/lib/radar/esecuzioni-calcoli";
import { DbFinto } from "./lib/db-finto-motore";
import type { SupabaseClient } from "@supabase/supabase-js";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 700)}`}`);
}
globalThis.fetch = (async () => {
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;

const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const T0 = new Date("2026-11-23T09:15:00Z");

function provaRegole(): void {
  controlla("recupero di base: 90 giorni (D3)", GIORNI_RECUPERO === 90 && cursoreIniziale("2026-11-23").da === "2026-08-25");
  controlla("parametro: 30 giorni; fuori da 1–365 → 90", cursoreIniziale("2026-11-23", 30).da === "2026-10-24" && giorniRecuperoValidi(0) === 90 && giorniRecuperoValidi(400) === 90 && giorniRecuperoValidi(2.5) === 90 && giorniRecuperoValidi(365) === 365);
  controlla("cursore illeggibile: si riparte dal recupero col parametro dato", cursoreAllAvvio({ x: 1 }, "2026-11-23", 30).da === "2026-10-24" && cursoreAllAvvio(null, "2026-11-23").da === "2026-08-25");
}

// TED finta: legge il corpo della richiesta (finestra e tipo) e risponde senza avvisi, oppure con lo stato HTTP chiesto
type Richiesta = { da: string; a: string; tipo: string };
function tedFinta(stato = 200) {
  const richieste: Richiesta[] = [];
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    const corpo = String(init?.body ?? "");
    // le date della finestra stanno nella condizione «publication-date>=AAAAMMGG … publication-date<=AAAAMMGG» (fonti/ted-calcoli.ts)
    const da = corpo.match(/publication-date>=(\d{8})/)?.[1];
    const a = corpo.match(/publication-date<=(\d{8})/)?.[1];
    const g = (x?: string) => (x ? `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}` : "?");
    richieste.push({ da: g(da), a: g(a), tipo: /notice-type IN \(can-/.test(corpo) ? "esito" : "bando" });
    if (stato !== 200) return new Response(JSON.stringify({ message: "negato" }), { status: stato, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ notices: [], totalNoticeCount: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { richieste, fetchFn };
}
function mondo(cursore: unknown = null): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: f === "ted", ultimo_successo_il: null, cursore: f === "ted" ? cursore : null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false }));
  return db;
}
const stato = (db: DbFinto) => db.t("radar_fonti_stato").find((r) => r.fonte === "ted")!;
const giro = (db: DbFinto, fetchFn: typeof fetch, extra: { pagineMassime?: number; giorniRecupero?: number } = {}) =>
  eseguiImportazioneTed(db as unknown as SupabaseClient, { tempoMassimoMs: 600_000, pagineMassime: extra.pagineMassime ?? 40, env: STAGING, adesso: () => T0, fetchFn, pausaMs: 0, origine: "script", ...(extra.giorniRecupero ? { giorniRecupero: extra.giorniRecupero } : {}) });

async function provaGiri(): Promise<void> {
  // recupero di 90 giorni da zero: 3 finestre di 31 giorni per i bandi e 3 per gli esiti, poi recupero completato
  const db = mondo();
  const f = tedFinta();
  const r = await giro(db, f.fetchFn);
  const c = stato(db).cursore as { fase?: string; ultimoGiorno?: string; recuperoCompletatoIl?: string; inCorso?: boolean };
  const attese = ["2026-08-25/2026-09-24", "2026-09-25/2026-10-25", "2026-10-26/2026-11-23"];
  controlla("recupero di 90 giorni da zero: 6 richieste, le 3 finestre di 31 giorni dal 25/08 a oggi, prima per i bandi poi per gli esiti", JSON.stringify(f.richieste.map((x) => `${x.da}/${x.a}`)) === JSON.stringify([...attese, ...attese]) && f.richieste.map((x) => x.tipo).join() === "bando,bando,bando,esito,esito,esito" && r.eseguita && r.giroFinito && !r.errore, { richieste: f.richieste, r });
  controlla("dopo il recupero: completato oggi, ultimo giorno = oggi, si passa alla sincronizzazione", c.recuperoCompletatoIl === "2026-11-23" && c.ultimoGiorno === "2026-11-23" && c.inCorso === false && c.fase === "incrementale", c);
  // ripresa: tetto di 2 pagine per giro → il recupero riprende dal punto salvato
  const dbR = mondo();
  const f1 = tedFinta();
  const r1 = await giro(dbR, f1.fetchFn, { pagineMassime: 2 });
  const f2 = tedFinta();
  const r2 = await giro(dbR, f2.fetchFn, { pagineMassime: 2 });
  const f3 = tedFinta();
  const r3 = await giro(dbR, f3.fetchFn, { pagineMassime: 2 });
  controlla("ripresa: tre giri da 2 pagine fanno le stesse 6 richieste del giro unico, senza ripetizioni, e l'ultimo chiude il recupero", f1.richieste.length + f2.richieste.length + f3.richieste.length === 6 && r1.eseguita && !r1.giroFinito && r2.eseguita && !r2.giroFinito && r3.eseguita && r3.giroFinito, { r1: r1.eseguita && r1.giroFinito, r2: r2.eseguita && r2.giroFinito, r3: r3.eseguita && r3.giroFinito });
  const finestre = [...f1.richieste, ...f2.richieste, ...f3.richieste].map((x) => `${x.da}/${x.a}`);
  controlla("ripresa: le finestre lette sono quelle del giro unico, nello stesso ordine", JSON.stringify(finestre) === JSON.stringify(f.richieste.map((x) => `${x.da}/${x.a}`)), { finestre, unico: f.richieste });
  // parametro passato da chi lancia il giro
  const db30 = mondo();
  const f30 = tedFinta();
  await giro(db30, f30.fetchFn, { giorniRecupero: 30 });
  controlla("parametro 30 giorni: una finestra di bandi e una di esiti", f30.richieste.length === 2, f30.richieste);

  // sospensione solo su 401 e 403
  for (const [codice, sospende] of [[401, true], [403, true], [429, false], [500, false], [404, false]] as const) {
    const dbs = mondo({ versione: 1, fase: "incrementale", inCorso: false, da: "2026-11-19", a: "2026-11-22", tipo: "bando", finestraDa: "2026-11-19", pagina: 1, ultimoGiorno: "2026-11-22", recuperoCompletatoIl: "2026-10-01" });
    const fs = tedFinta(codice);
    const rs = await giro(dbs, fs.fetchFn);
    const st = stato(dbs);
    const reg = dbs.t("radar_esecuzioni")[0] as { esito?: string; allarmi?: string[]; avvisi?: Record<string, unknown> } | undefined;
    const atteso = sospende
      ? rs.eseguita && rs.sospesa && st.attiva === false && !!(st.conteggi as { sospensione?: unknown }).sospensione && reg?.esito === "sospesa" && (reg.allarmi ?? []).includes("sospesa")
      : rs.eseguita && !rs.sospesa && !!rs.errore && st.attiva === true && !(st.conteggi as { sospensione?: unknown }).sospensione && reg?.esito === "errore";
    controlla(`TED risponde ${codice}: ${sospende ? "fonte SOSPESA (spenta, nota di sospensione, esito «sospesa» con allarme)" : "solo errore, la fonte resta accesa"}`, !!atteso, { rs, attiva: st.attiva, conteggi: st.conteggi, reg });
  }
}

async function principale(): Promise<void> {
  provaRegole();
  await provaGiri();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica di TED (K5): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
