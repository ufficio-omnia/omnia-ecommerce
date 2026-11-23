// Verifica del 48B (direttiva 48A, B2, 23/11/2026): lo script che rende di nuovo VISIBILE la PVL sullo staging, su un database IN MEMORIA,
// senza rete. Uso: npx tsx scripts/verifica-pvl-visibile.ts → codice 0 se tutto passa.
import fs from "fs";
import path from "path";
import { applica, rendiPvlVisibile } from "./pvl-visibile/pvl-visibile-staging";
import { FermoCollaudo } from "./collaudo-z8/collaudo-motore-z8";
import { DbFinto } from "./lib/db-finto-motore";
import type { ClientDb } from "../src/lib/radar/notifiche/motore";
import { aggiornamentoPerCliente, etichettaFonti, fontiDellaGara, fontiNascosteDa, fonteDelDato, garaVisibileAiClienti, riepilogoFonti, type AvvisoLetto } from "../src/lib/radar/fonti-gara-calcoli";
import type { ProvenienzaCampi } from "../src/lib/radar/unione-calcoli";

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

const ORA = new Date("2026-11-23T15:00:00Z");
// lo stato dello staging dopo la L5a (47B): PVL e SardegnaCAT nascoste, TED e Sintel visibili
function mondo(righe = [
  { fonte: "pvl", attiva: true, nascosta_ai_clienti: true, cursore: { giorno: "2026-11-17" }, aggiornata_il: "2026-11-23T10:00:00Z" },
  { fonte: "sardegnacat", attiva: false, nascosta_ai_clienti: true, cursore: null, aggiornata_il: "2026-11-17T14:00:00Z" },
  { fonte: "sintel", attiva: false, nascosta_ai_clienti: false, cursore: null, aggiornata_il: "2026-11-17T14:00:00Z" },
  { fonte: "ted", attiva: true, nascosta_ai_clienti: false, cursore: { giorno: "2026-11-17" }, aggiornata_il: "2026-11-17T13:00:00Z" },
]) {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = righe.map((r) => ({ ...r }));
  return db;
}
const copia = (db: DbFinto) => JSON.stringify(db.t("radar_fonti_stato").filter((r) => r.fonte !== "pvl"));
const nascosteDa = (db: DbFinto) => fontiNascosteDa(db.t("radar_fonti_stato") as { fonte: string; nascosta_ai_clienti: boolean | null }[]);

async function principale(): Promise<void> {
  const db = mondo();
  controlla("48B: prima, per la regola unica, nascoste PVL e SardegnaCAT", JSON.stringify(nascosteDa(db)) === JSON.stringify(["pvl", "sardegnacat"]), nascosteDa(db));
  const altre = copia(db);
  const e = await rendiPvlVisibile(db as unknown as ClientDb, ORA);
  const pvl = db.t("radar_fonti_stato").find((r) => r.fonte === "pvl")!;
  controlla("48B: la PVL da nascosta a visibile, UNA riga cambiata", e.cambiate === 1 && e.primaNascosta === true && e.dopoNascosta === false && pvl.nascosta_ai_clienti === false);
  controlla("48B: della riga pvl cambiano SOLO nascosta_ai_clienti e aggiornata_il (cursore, attiva intatti)", pvl.attiva === true && JSON.stringify(pvl.cursore) === JSON.stringify({ giorno: "2026-11-17" }) && pvl.aggiornata_il === ORA.toISOString() && Object.keys(pvl).length === 5);
  controlla("48B: le altre fonti IDENTICHE (SardegnaCAT resta nascosta, TED e Sintel visibili)", copia(db) === altre);
  controlla("48B: dopo, per la regola unica, nascosta SOLO SardegnaCAT", JSON.stringify(nascosteDa(db)) === JSON.stringify(["sardegnacat"]), nascosteDa(db));
  controlla("48B: 3 richieste (lettura, scrittura condizionata, rilettura)", db.conta() === 3, db.conta());
  const scritture = db.richieste.filter((r) => r.metodo === "update");
  controlla("48B: UNA sola scrittura, sulla tabella radar_fonti_stato", scritture.length === 1 && scritture.every((r) => r.tabella === "radar_fonti_stato"), scritture);
  const prima2 = JSON.stringify(db.t("radar_fonti_stato"));
  const e2 = await rendiPvlVisibile(db as unknown as ClientDb, new Date("2026-11-24T12:00:00Z"));
  controlla("48B: ripetuto, non cambia NULLA (idempotente: già visibile, nemmeno aggiornata_il)", e2.cambiate === 0 && e2.primaNascosta === false && JSON.stringify(db.t("radar_fonti_stato")) === prima2);
  let fermo = false;
  const senzaPvl = mondo([{ fonte: "ted", attiva: true, nascosta_ai_clienti: false, cursore: null, aggiornata_il: "x" }]);
  try {
    await rendiPvlVisibile(senzaPvl as unknown as ClientDb, ORA);
  } catch (x) {
    fermo = x instanceof FermoCollaudo && /riga «pvl»/.test(x.message);
  }
  controlla("48B: senza la riga «pvl» si ferma con il suo motivo (non un errore qualsiasi) e non scrive", fermo && !senzaPvl.richieste.some((r) => r.metodo === "update"));
  // una scrittura senza effetto (per esempio la riga rimessa a «nascosta» da altri nel frattempo): la rilettura la scopre e si ferma
  const catena = (risultato: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) c[m] = () => c;
    c.then = (ok: (x: unknown) => unknown, ko?: (x: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
    return c;
  };
  const sordo = { from: () => ({ select: () => catena({ data: [{ fonte: "pvl", nascosta_ai_clienti: true }], error: null }), update: () => catena({ data: [], error: null }) }) };
  let fermoDopo = false;
  try {
    await rendiPvlVisibile(sordo as unknown as ClientDb, ORA);
  } catch (x) {
    fermoDopo = x instanceof FermoCollaudo && /ancora nascosta/.test(x.message);
  }
  controlla("48B: se dopo la scrittura la PVL risulta ancora nascosta si ferma con il suo motivo", fermoDopo);
  // guardie del lancio: nessuna richiesta prima dei controlli
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
    controlla(`48B: ${nome} → rifiutato senza nessuna richiesta`, errore && chiamate.length === n);
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
  controlla("48B: guardie superate, un errore della prima lettura ferma tutto (nessuna scrittura), solo verso lo staging", fermato && chiamate.slice(n).length === 1 && chiamate.slice(n).every((u) => u.startsWith("https://ryawdldqiumqsskrnyps.supabase.co/rest/v1/radar_fonti_stato?select=")));
  const testo = fs.readFileSync(path.join(__dirname, "pvl-visibile", "pvl-visibile-staging.ts"), "utf8");
  controlla("testo: la scrittura è condizionata a fonte = pvl E nascosta_ai_clienti = true, e mette solo false", /\.update\(\{ nascosta_ai_clienti: false, aggiornata_il: adesso\.toISOString\(\) \}\)\s*\.eq\("fonte", "pvl"\)\s*\.eq\("nascosta_ai_clienti", true\)/.test(testo));
  controlla("testo: l'autorizzazione si controlla prima dell'osservatore e del client", testo.indexOf("controllaPorta({ script") < testo.indexOf("installaOsservatore(url") && testo.indexOf("installaOsservatore(url") < testo.indexOf("createClient(url"));
  controlla("testo: il nome dello script nella porta è quello del file", /controllaPorta\(\{ script: "pvl-visibile-staging\.ts" \}\)/.test(testo));
  pagine();
}

// Le pagine del cliente con la PVL visibile (direttiva 48A): una gara UNITA TED+PVL e una SOLO PVL, con le stesse regole pure che usano
// gara.ts (scheda), la ricerca e la lista; tre stati della riga «pvl»: visibile (staging dopo la 48B), assente (produzione), nascosta (oggi).
function pagine(): void {
  const pv = (f: string, id: string): ProvenienzaCampi[string] => ({ f, id, g: "2026-11-10", t: "2026-11-10T08:00:00Z", ted: null }) as unknown as ProvenienzaCampi[string];
  const unita = { chiave: "ted:700001-2026", fonti: ["ted", "pvl"], provenienza: { oggetto: pv("ted", "700001-2026"), scadenza: pv("pvl", "pvl-sint-1"), importo: pv("ted", "700001-2026") } as ProvenienzaCampi };
  const soloPvl = { chiave: "pvl:pvl-sint-2", fonti: ["pvl"], provenienza: { oggetto: pv("pvl", "pvl-sint-2") } as ProvenienzaCampi };
  const avvisi: AvvisoLetto[] = [
    { fonte: "ted", id_fonte: "700001-2026", url: "https://esempio.invalid/ted/700001-2026", pubblicato_il: "2026-11-09", tipo_avviso: "cn-standard", rilevato_il: "2026-11-09T08:00:00Z" },
    { fonte: "pvl", id_fonte: "pvl-sint-1", url: "https://esempio.invalid/pvl/1", pubblicato_il: "2026-11-10", tipo_avviso: "P1_10", rilevato_il: "2026-11-10T08:00:00Z" },
  ];
  const registro = [
    { campo: "scadenza_offerte", fonte: "pvl" },
    { campo: "scadenza_offerte", fonte: "ted" },
    { campo: "collegamento_proposto", fonte: "pvl" },
  ];
  const stati = {
    visibile: new Set<string>(fontiNascosteDa([{ fonte: "pvl", nascosta_ai_clienti: false }, { fonte: "sardegnacat", nascosta_ai_clienti: true }])),
    assente: new Set<string>(fontiNascosteDa([])),
    nascosta: new Set<string>(fontiNascosteDa([{ fonte: "pvl", nascosta_ai_clienti: true }, { fonte: "sardegnacat", nascosta_ai_clienti: true }])),
  };
  for (const [nome, nascoste] of [["visibile", stati.visibile], ["assente", stati.assente]] as const) {
    controlla(`pagine (PVL ${nome}): la gara unita TED+PVL e quella solo PVL si vedono`, garaVisibileAiClienti(unita, nascoste) && garaVisibileAiClienti(soloPvl, nascoste));
    // scheda della gara: provenienze filtrate come in gara.ts, poi il riquadro «Fonti»
    const fonti = riepilogoFonti(avvisi.filter((a) => !nascoste.has(a.fonte)), {});
    controlla(`pagine (PVL ${nome}): nella scheda della gara unita compaiono TED e PVL, ciascuna col suo avviso`, JSON.stringify(fonti.map((f) => [f.fonte, f.url])) === JSON.stringify([["ted", "https://esempio.invalid/ted/700001-2026"], ["pvl", "https://esempio.invalid/pvl/1"]]), fonti);
    controlla(`pagine (PVL ${nome}): il registro mostra la rettifica PVL e quella TED (mai le righe interne)`, JSON.stringify(registro.filter((a) => aggiornamentoPerCliente(a, nascoste)).map((a) => a.fonte)) === JSON.stringify(["pvl", "ted"]));
  }
  controlla("pagine: le fonti della gara unita sono «TED e PVL ANAC»; il dato della scadenza viene dalla PVL", etichettaFonti(fontiDellaGara(unita.chiave, unita.provenienza)) === "TED e PVL ANAC" && fonteDelDato(unita.provenienza, "scadenza", unita.chiave) === "pvl");
  controlla("pagine: la gara solo PVL ha come fonte la PVL", JSON.stringify(fontiDellaGara(soloPvl.chiave, soloPvl.provenienza)) === JSON.stringify(["pvl"]));
  // e com'è oggi lo staging (PVL nascosta): l'unita resta per TED senza l'avviso PVL, la sola PVL sparisce
  const n = stati.nascosta;
  controlla("pagine (PVL nascosta, lo staging di oggi): l'unita resta visibile per TED, la sola PVL no", garaVisibileAiClienti(unita, n) && !garaVisibileAiClienti(soloPvl, n));
  controlla("pagine (PVL nascosta): nella scheda solo TED, e nel registro solo la rettifica TED", JSON.stringify(riepilogoFonti(avvisi.filter((a) => !n.has(a.fonte)), {}).map((f) => f.fonte)) === JSON.stringify(["ted"]) && JSON.stringify(registro.filter((a) => aggiornamentoPerCliente(a, n)).map((a) => a.fonte)) === JSON.stringify(["ted"]));
  // la scheda (gara.ts) applica davvero queste regole, con le fonti lette dalla regola unica
  const scheda = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "radar", "gara.ts"), "utf8");
  controlla("testo: gara.ts filtra provenienze e registro con le fonti nascoste della regola unica",
    /const nascoste = new Set\(await fontiNascosteAiClienti\(\)\);/.test(scheda) && /if \(!gara\.unita_a && !garaVisibileAiClienti\(gara, nascoste\)\) return null;/.test(scheda) && /\.filter\(\(p\) => !nascoste\.has\(p\.fonte\)\)/.test(scheda) && /\.filter\(\(a\) => aggiornamentoPerCliente\(a, nascoste\)\)/.test(scheda));
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica 48B (PVL di nuovo visibile sullo staging): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
