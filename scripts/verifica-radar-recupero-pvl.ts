// Verifica di riprendiRecuperoPvl (richiesta del coordinamento del 23/11, dopo K6): la ripresa del recupero PVL fermo per la pagina «Fonti»
// della console. Scrittura condizionata (stato invariato dopo la lettura, nessun giro col blocco), nessuna richiesta alla PVL. Dati SINTETICI,
// database in memoria, nessuna rete. Uso: npx tsx scripts/verifica-radar-recupero-pvl.ts → codice 0 se tutto passa.
import { riprendiRecuperoPvl } from "../src/lib/radar/recupero-pvl";
import { cursorePvlNuovo, cursorePvlV2Valido, type CursorePvlV2 } from "../src/lib/radar/importa-pvl-cursore";
import { FONTI_ESECUZIONI } from "../src/lib/radar/esecuzioni-calcoli";
import { DbFinto } from "./lib/db-finto-motore";
import type { SupabaseClient } from "@supabase/supabase-js";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 700)}`}`);
}
let chiamateRete = 0;
globalThis.fetch = (async () => {
  chiamateRete++;
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;

const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const PRODUZIONE = { NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" };
const ADESSO = new Date("2026-11-23T10:00:00Z");
const PRIMA = "2026-11-23T08:06:00.000Z";
const ADMIN = "amministratore-sintetico@prova.test";

function cursoreFermo(): CursorePvlV2 {
  const c = cursorePvlNuovo("2026-11-23", "2026-11-23");
  return {
    ...c,
    buchi: [{ da: "2026-11-15", a: "2026-11-21", motivo: "blocco_incompleto", rilevato_il: "2026-11-23T07:05:30.000Z" }],
    recupero: { ...c.recupero, prossimoA: "2026-11-14", fermo: { il: "2026-11-23T07:05:30.000Z", da: "2026-11-15", a: "2026-11-21" } },
  };
}
function mondo(x: { cursore?: unknown; blocco?: string | null; aggiornata?: string | null } = {}): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: f === "pvl", cursore: f === "pvl" ? (x.cursore === undefined ? cursoreFermo() : x.cursore) : null, blocco_fino_a: x.blocco ?? null, aggiornata_il: x.aggiornata === undefined ? PRIMA : x.aggiornata, conteggi: { ultimo_giro: { iniziato_il: "2026-11-23T07:05:00.000Z" } } }));
  return db;
}
const pvl = (db: DbFinto) => db.t("radar_fonti_stato").find((r) => r.fonte === "pvl")!;
const scritture = (db: DbFinto) => db.richieste.filter((q) => q.metodo !== "select");

async function principale(): Promise<void> {
  // ripresa riuscita
  const db = mondo();
  const r = await riprendiRecuperoPvl(db as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  const c = cursorePvlV2Valido(pvl(db).cursore);
  controlla("ripresa: ok, col blocco che era fermo", r.ok && r.blocco.da === "2026-11-15" && r.blocco.a === "2026-11-21", r);
  controlla("ripresa: cursore v2 valido, recupero non più fermo, buchi e obiettivo intatti (il blocco si ritenta dai buchi)", !!c && c.recupero.fermo === null && c.buchi.length === 1 && c.buchi[0].da === "2026-11-15" && c.recupero.prossimoA === "2026-11-14" && c.ultimoGiorno === "2026-11-23", c);
  const cont = pvl(db).conteggi as Record<string, unknown>;
  controlla("ripresa: traccia in conteggi (quando, chi, quale blocco), il resto dei conteggi conservato", JSON.stringify(cont.ultima_ripresa_recupero) === JSON.stringify({ il: ADESSO.toISOString(), autore: ADMIN, blocco: { da: "2026-11-15", a: "2026-11-21" } }) && !!cont.ultimo_giro && pvl(db).aggiornata_il === ADESSO.toISOString(), cont);
  controlla("ripresa: UNA lettura e UNA scrittura condizionata, nessun'altra tabella", db.richieste.length === 2 && db.richieste.every((q) => q.tabella === "radar_fonti_stato") && scritture(db).length === 1, db.richieste);

  // niente da fare
  const nonFermo = mondo({ cursore: cursorePvlNuovo("2026-11-23") });
  const rn = await riprendiRecuperoPvl(nonFermo as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  controlla("recupero non fermo: «non_fermo», nessuna scrittura", !rn.ok && rn.motivo === "non_fermo" && scritture(nonFermo).length === 0, rn);
  const v1 = mondo({ cursore: { versione: 1, modo: "incrementale", inCorso: false, da: "2026-11-22", a: "2026-11-23", token: null, pagine: 1, ultimoGiorno: "2026-11-23" } });
  const rv1 = await riprendiRecuperoPvl(v1 as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  controlla("cursore v1 (non ancora convertito da un giro): «non_fermo», nessuna scrittura", !rv1.ok && rv1.motivo === "non_fermo" && scritture(v1).length === 0);

  // un giro tiene il blocco
  const inGiro = mondo({ blocco: "2026-11-23T10:04:00.000Z" });
  const rg = await riprendiRecuperoPvl(inGiro as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  controlla("giro in corso (blocco preso): «giro_in_corso», nessuna scrittura, cursore invariato", !rg.ok && rg.motivo === "giro_in_corso" && scritture(inGiro).length === 0 && cursorePvlV2Valido(pvl(inGiro).cursore)?.recupero.fermo !== null, rg);
  const scaduto = mondo({ blocco: "2026-11-23T09:00:00.000Z" });
  const rs = await riprendiRecuperoPvl(scaduto as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  controlla("blocco scaduto (giro caduto): la ripresa passa", rs.ok, rs);

  // stato cambiato tra la lettura e la scrittura (un giro ha salvato il cursore o preso il blocco nel frattempo)
  const corsa = mondo();
  const conCorsa = {
    from: (t: string) => {
      const q = corsa.from(t);
      if (t === "radar_fonti_stato" && corsa.richieste.length === 1) pvl(corsa).aggiornata_il = "2026-11-23T09:59:59.000Z"; // il giro scrive dopo la nostra lettura
      return q;
    },
  };
  const rc = await riprendiRecuperoPvl(conCorsa as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  controlla("stato cambiato dopo la lettura: «cambiato_nel_frattempo», cursore NON toccato", !rc.ok && rc.motivo === "cambiato_nel_frattempo" && cursorePvlV2Valido(pvl(corsa).cursore)?.recupero.fermo !== null, rc);
  const bloccoNelFrattempo = mondo();
  const conBlocco = {
    from: (t: string) => {
      const q = bloccoNelFrattempo.from(t);
      if (t === "radar_fonti_stato" && bloccoNelFrattempo.richieste.length === 1) pvl(bloccoNelFrattempo).blocco_fino_a = "2026-11-23T10:05:00.000Z";
      return q;
    },
  };
  const rb = await riprendiRecuperoPvl(conBlocco as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  controlla("blocco preso dopo la lettura (stessa aggiornata_il): la condizione sul blocco ferma la scrittura", !rb.ok && rb.motivo === "cambiato_nel_frattempo" && cursorePvlV2Valido(pvl(bloccoNelFrattempo).cursore)?.recupero.fermo !== null, rb);
  const senzaData = mondo({ aggiornata: null });
  const rd = await riprendiRecuperoPvl(senzaData as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  controlla("aggiornata_il assente: la condizione usa «è nullo», la ripresa passa", rd.ok, rd);

  // guardie
  const prod = mondo();
  const rp = await riprendiRecuperoPvl(prod as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: PRODUZIONE });
  controlla("ambiente non consentito: nessun accesso al database", !rp.ok && rp.motivo === "ambiente_non_consentito" && prod.richieste.length === 0, rp);
  const vuoto = mondo();
  const ra = await riprendiRecuperoPvl(vuoto as unknown as SupabaseClient, "   ", { adesso: ADESSO, env: STAGING });
  controlla("autore mancante: nessun accesso al database", !ra.ok && vuoto.richieste.length === 0, ra);
  const lungo = mondo();
  await riprendiRecuperoPvl(lungo as unknown as SupabaseClient, `${"x".repeat(150)}`, { adesso: ADESSO, env: STAGING });
  controlla("autore: al più 100 caratteri", ((pvl(lungo).conteggi as { ultima_ripresa_recupero?: { autore?: string } }).ultima_ripresa_recupero?.autore ?? "").length === 100);
  const guasto = mondo();
  guasto.guasti.set("radar_fonti_stato|select", 1);
  const re = await riprendiRecuperoPvl(guasto as unknown as SupabaseClient, ADMIN, { adesso: ADESSO, env: STAGING });
  controlla("lettura non riuscita: errore detto, nessuna scrittura", !re.ok && re.motivo === "errore_lettura" && scritture(guasto).length === 0, re);
  controlla("nessuna richiesta alla PVL in tutta la verifica", chiamateRete === 0, chiamateRete);
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica della ripresa del recupero PVL (console): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
