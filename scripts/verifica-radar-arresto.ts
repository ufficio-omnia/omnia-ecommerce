// Verifica di K7 (piano 48C §3.6, B2, 23/11/2026): una fonte spenta dalla console A METÀ GIRO ferma il giro alla pagina dopo, senza
// richieste in più; il punto di ripresa resta coerente (quello dell'ultima pagina salvata); il registro dei giri ha esito «ok» e l'allarme
// «fermata_dalla_console». Giri TED e PVL veri, su un database in memoria e una fonte FINTA (risposte sintetiche, nessuna rete).
// Uso: npx tsx scripts/verifica-radar-arresto.ts → codice 0 se tutto passa.
import fs from "node:fs";
import path from "node:path";
import { eseguiImportazioneTed } from "../src/lib/radar/importa-ted";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { FONTI_ESECUZIONI } from "../src/lib/radar/esecuzioni-calcoli";
import { DbFinto } from "./lib/db-finto-motore";
import type { SupabaseClient } from "@supabase/supabase-js";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
}
// nessuna rete: la sola fonte è quella finta passata con fetchFn
globalThis.fetch = (async () => {
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;

const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const T0 = new Date("2026-11-23T09:15:00Z");
const comeAdmin = (db: DbFinto) => db as unknown as SupabaseClient;
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

function mondo(fonte: "ted" | "pvl"): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: f === fonte, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false }));
  return db;
}
const riga = (db: DbFinto, f: string) => db.t("radar_fonti_stato").find((r) => r.fonte === f)!;
const copia = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));
/** La console spegne la fonte mentre la fonte risponde alla richiesta numero `n` (cioè tra il salvataggio n−1 e il salvataggio n). */
function fonteFinta(db: DbFinto, fonte: string, spegniAllaRichiesta: number | null, risposta: (n: number) => Response) {
  const stato = { richieste: 0, cursorePrimaDelloSpegnimento: undefined as unknown };
  const fetchFn = (async () => {
    stato.richieste++;
    if (stato.richieste === spegniAllaRichiesta) {
      stato.cursorePrimaDelloSpegnimento = copia(riga(db, fonte).cursore);
      riga(db, fonte).attiva = false; // l'azione «Spegni la fonte» della console
    }
    return risposta(stato.richieste);
  }) as typeof fetch;
  return { stato, fetchFn };
}

// ═════ TED: pagine vuote del recupero (una richiesta per pagina) ═════
async function provaTed(): Promise<void> {
  const ted = () => json({ notices: [], totalNoticeCount: 0 });
  const giro = (db: DbFinto, fetchFn: typeof fetch, pagineMassime: number) => eseguiImportazioneTed(comeAdmin(db), { tempoMassimoMs: 600_000, pagineMassime, env: STAGING, adesso: () => T0, fetchFn, pausaMs: 0 });

  // controllo: nessuno spegne, il giro va fino al tetto delle pagine
  const dbc = mondo("ted");
  const fc = fonteFinta(dbc, "ted", null, ted);
  const rc = await giro(dbc, fc.fetchFn, 6);
  controlla("TED, controllo: senza spegnimento il giro legge 6 pagine e non è «fermata»", rc.eseguita && fc.stato.richieste === 6 && !rc.fermata && (dbc.t("radar_esecuzioni")[0]?.allarmi as string[] | undefined)?.length === 0, { rc, richieste: fc.stato.richieste });

  // spenta durante la pagina 2: la pagina 2 si scrive, il suo salvataggio non passa, il giro si ferma (nessuna pagina 3)
  const db = mondo("ted");
  const f = fonteFinta(db, "ted", 2, ted);
  const r = await giro(db, f.fetchFn, 6);
  controlla("TED, spenta tra due pagine: si ferma alla pagina dopo (2 richieste alla fonte invece di 6)", f.stato.richieste === 2 && r.eseguita && r.fermata === true && r.errore === null, { r, richieste: f.stato.richieste });
  const cursoreDb = copia(riga(db, "ted").cursore);
  controlla("TED, punto di ripresa coerente: nel database resta quello della pagina 1 (la pagina 2 si rilegge alla riaccensione)", cursoreDb !== null && JSON.stringify(cursoreDb) === JSON.stringify(f.stato.cursorePrimaDelloSpegnimento), { cursoreDb, prima: f.stato.cursorePrimaDelloSpegnimento });
  controlla("TED, il risultato riporta lo stesso punto del database e «giro non finito»", r.eseguita && JSON.stringify(copia(r.cursore)) === JSON.stringify(cursoreDb) && r.giroFinito === false);
  const reg = db.t("radar_esecuzioni");
  controlla("TED, registro: UNA riga, esito «ok» con l'allarme «fermata_dalla_console»", reg.length === 1 && reg[0].esito === "ok" && JSON.stringify(reg[0].allarmi) === '["fermata_dalla_console"]', reg);
  const st = riga(db, "ted");
  controlla("TED, fine giro: blocco tolto, fonte RESTA spenta (nessuna riaccensione), giro segnato in conteggi", st.blocco_fino_a === null && st.attiva === false && (st.conteggi as { ultimo_giro?: { fermata_dalla_console?: boolean } }).ultimo_giro?.fermata_dalla_console === true, st);

  // nessuna richiesta in più al database: lo stesso numero di un giro normale di 2 pagine
  const db2 = mondo("ted");
  const f2 = fonteFinta(db2, "ted", null, ted);
  await giro(db2, f2.fetchFn, 2);
  controlla("TED, nessuna richiesta in più al database rispetto a un giro normale di 2 pagine", db.richieste.length === db2.richieste.length, { fermata: db.richieste, normale: db2.richieste });

  // spenta durante la prima pagina: nessun punto salvato, il database resta com'era
  const db1 = mondo("ted");
  const f1 = fonteFinta(db1, "ted", 1, ted);
  const r1 = await giro(db1, f1.fetchFn, 6);
  controlla("TED, spenta durante la prima pagina: una richiesta, punto di ripresa intatto (nullo), fermata", f1.stato.richieste === 1 && r1.eseguita && r1.fermata && riga(db1, "ted").cursore === null, { r1, cursore: riga(db1, "ted").cursore });
}

// ═════ PVL: pagine piene con il token della pagina dopo; l'ultima corta ═════
async function provaPvl(): Promise<void> {
  // avvisi sintetici senza i campi di un avviso vero: letti ed esclusi («avviso_malformato»), nessuna scrittura di gare
  const pagina = (n: number) => (n < 3 ? json({ content: Array.from({ length: 10 }, (_, i) => ({ idAvviso: `prova-${n}-${i}` })), count: null, lastPaginationToken: `token-${n}` }) : json({ content: [{ idAvviso: `prova-${n}-0` }], count: null, lastPaginationToken: null }));
  const giro = (db: DbFinto, fetchFn: typeof fetch) => eseguiImportazionePvl(comeAdmin(db), { modo: "incrementale", tempoMassimoMs: 600_000, env: STAGING, adesso: () => T0, fetchFn, limiti: { avvisiPerPagina: 10, pausaMs: 2_000 } });
  // cursore v2 (K4) con il recupero dei 90 giorni già finito: qui si prova solo l'incrementale (il recupero ha la sua verifica)
  const mondoPvl = () => {
    const db = mondo("pvl");
    riga(db, "pvl").cursore = { versione: 2, inCorso: false, ultimoGiorno: null, incrementale: null, finestra: null, recupero: { obiettivoDa: null, prossimoA: null, blocco: null, fermo: null }, buchi: [], completezza: [] };
    return db;
  };

  const dbc = mondoPvl();
  const fc = fonteFinta(dbc, "pvl", null, pagina);
  const rc = await giro(dbc, fc.fetchFn);
  controlla("PVL, controllo: senza spegnimento il giro legge le 3 pagine e finisce", rc.eseguita && fc.stato.richieste === 3 && rc.giroFinito && !rc.fermata && !rc.errore, { rc, richieste: fc.stato.richieste });

  const db = mondoPvl();
  const f = fonteFinta(db, "pvl", 2, pagina);
  const r = await giro(db, f.fetchFn);
  controlla("PVL, spenta tra due pagine: si ferma alla pagina dopo (2 richieste invece di 3)", f.stato.richieste === 2 && r.eseguita && r.fermata === true && r.errore === null && !r.sospesa, { r, richieste: f.stato.richieste });
  const cursoreDb = copia(riga(db, "pvl").cursore);
  controlla("PVL, punto di ripresa coerente: resta quello della pagina 1 (token della pagina 2), anche nel risultato", (cursoreDb as { incrementale?: { token?: string } } | null)?.incrementale?.token === "token-1" && JSON.stringify(cursoreDb) === JSON.stringify(f.stato.cursorePrimaDelloSpegnimento) && r.eseguita && JSON.stringify(copia(r.cursore)) === JSON.stringify(cursoreDb) && !r.giroFinito, { cursoreDb, r: r.eseguita ? r.cursore : null });
  const reg = db.t("radar_esecuzioni");
  controlla("PVL, registro: UNA riga, esito «ok» con l'allarme «fermata_dalla_console» (non «sospesa»)", reg.length === 1 && reg[0].esito === "ok" && JSON.stringify(reg[0].allarmi) === '["fermata_dalla_console"]', reg);
  const st = riga(db, "pvl");
  controlla("PVL, fine giro: blocco tolto, fonte resta spenta, nessuna nota di sospensione", st.blocco_fino_a === null && st.attiva === false && !(st.conteggi as Record<string, unknown>).sospensione, st);
}

// ═════ testi: Sintel e SardegnaCAT non hanno pagine con un punto di ripresa (una lettura della fonte per giro) ═════
function provaTesti(): void {
  const leggi = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  for (const [f, fonte] of [["src/lib/radar/importa-ted.ts", "ted"], ["src/lib/radar/importa-pvl.ts", "pvl"]] as const) {
    const t = leggi(f);
    const salvataggi = t.match(/update\(\{ cursore: prossimo[^\n]*/g) ?? [];
    controlla(`${fonte}: UN solo salvataggio del punto di ripresa nel giro, condizionato alla fonte accesa`, salvataggi.length === 1 && salvataggi[0].includes(`.eq("fonte", "${fonte}").eq("attiva", true).select("fonte")`), salvataggi);
  }
}

async function principale(): Promise<void> {
  await provaTed();
  await provaPvl();
  provaTesti();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica dell'arresto a metà giro dalla console (K7): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
