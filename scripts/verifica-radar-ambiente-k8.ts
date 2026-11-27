// Verifica di K8 (48C §3.7, L6 del piano 36): la regola unica fonteAutorizzata con le variabili RADAR_<FONTE>_PRODUZIONE. Matrice completa
// fonte × uso × ambiente × variabili; giri veri (PVL e Sintel) in produzione con e senza variabile; notifiche e console che passano dalla
// stessa regola. Dati SINTETICI, database in memoria, nessuna rete. Uso: npx tsx scripts/verifica-radar-ambiente-k8.ts → codice 0 se passa.
import fs from "node:fs";
import path from "node:path";
import { FONTI_RADAR, VARIABILI_PRODUZIONE, fonteAutorizzata, scrittureRadarConsentite } from "../src/lib/radar/ambiente";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { FONTI_ESECUZIONI } from "../src/lib/radar/esecuzioni-calcoli";
import { DbFinto } from "./lib/db-finto-motore";
import type { SupabaseClient } from "@supabase/supabase-js";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
}
globalThis.fetch = (async () => {
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;

const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const PROD = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
const AMBIENTI: [string, Record<string, string | undefined>][] = [
  ["staging locale", { NEXT_PUBLIC_SUPABASE_URL: STAGING }],
  ["staging, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: STAGING, VERCEL_ENV: "production" }],
  ["staging, anteprima", { NEXT_PUBLIC_SUPABASE_URL: STAGING, VERCEL_ENV: "preview" }],
  ["produzione, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production" }],
  ["produzione, computer locale", { NEXT_PUBLIC_SUPABASE_URL: PROD }],
  ["produzione, anteprima", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "preview" }],
  ["produzione, deploy «development»", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "development" }],
  ["database sconosciuto, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co", VERCEL_ENV: "production" }],
  ["database sconosciuto, locale", { NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co" }],
  ["nessun database, deploy di produzione", { VERCEL_ENV: "production" }],
];
const tutte = Object.fromEntries(Object.values(VARIABILI_PRODUZIONE).map((v) => [v, "autorizzata"]));
const VARIABILI: [string, (fonte: string) => Record<string, string>][] = [
  ["senza variabili", () => ({})],
  ["tutte autorizzate", () => tutte],
  ["la sua con un altro valore", (f) => (VARIABILI_PRODUZIONE[f as "pvl"] ? { [VARIABILI_PRODUZIONE[f as "pvl"]!]: "si" } : {})],
  ["solo quelle delle ALTRE fonti", (f) => Object.fromEntries(Object.entries(VARIABILI_PRODUZIONE).filter(([k]) => k !== f).map(([, v]) => [v, "autorizzata"]))],
  ["la sua con spazi e maiuscole", (f) => (VARIABILI_PRODUZIONE[f as "pvl"] ? { [VARIABILI_PRODUZIONE[f as "pvl"]!]: " Autorizzata " } : {})],
];
function atteso(fonte: string, ambiente: string, env: Record<string, string | undefined>): boolean {
  if (!(FONTI_RADAR as readonly string[]).includes(fonte) || ambiente.includes("anteprima")) return false;
  if (ambiente.startsWith("staging")) return true;
  if (ambiente !== "produzione, deploy di produzione") return false;
  if (fonte === "ted") return true;
  return env[VARIABILI_PRODUZIONE[fonte as "pvl"]!] === "autorizzata";
}

function provaMatrice(): void {
  // Fase 2 (26/11, SATER e TuttoGare in produzione): più RADAR_SATER_PRODUZIONE e RADAR_TUTTOGARE_PRODUZIONE
  controlla("tabella delle variabili: PVL, Sintel, SardegnaCAT, SATER, TuttoGare, EmPULIA e SIAPS; TED e START no", JSON.stringify(VARIABILI_PRODUZIONE) === JSON.stringify({ pvl: "RADAR_PVL_PRODUZIONE", sintel: "RADAR_SINTEL_PRODUZIONE", sardegnacat: "RADAR_SARDEGNACAT_PRODUZIONE", sater: "RADAR_SATER_PRODUZIONE", tuttogare: "RADAR_TUTTOGARE_PRODUZIONE", empulia: "RADAR_EMPULIA_PRODUZIONE", siaps: "RADAR_SIAPS_PRODUZIONE" }));
  let celle = 0;
  const sbagliate: unknown[] = [];
  for (const fonte of [...FONTI_RADAR, "manuale", "ted2", ""]) {
    for (const [nomeAmb, amb] of AMBIENTI) {
      for (const [nomeVar, vars] of VARIABILI) {
        const env = { ...amb, ...vars(fonte) };
        for (const uso of ["importazione", "notifiche"] as const) {
          celle++;
          const p = fonteAutorizzata(fonte, uso, env);
          if (p.ok !== atteso(fonte, nomeAmb, env) || (!p.ok && p.motivo.length < 10)) sbagliate.push({ fonte, nomeAmb, nomeVar, uso, p });
        }
        if ((FONTI_RADAR as readonly string[]).includes(fonte)) {
          const f = fonte as (typeof FONTI_RADAR)[number];
          if (JSON.stringify(scrittureRadarConsentite(f, env)) !== JSON.stringify(fonteAutorizzata(f, "importazione", env))) sbagliate.push({ fonte, nomeAmb, nomeVar, scrittureRadarConsentite: true });
        }
      }
    }
  }
  // Fase 2: le fonti del Radar più le 3 sconosciute («manuale», «ted2», vuota); con SATER e TuttoGare sono 9
  const nFonti = FONTI_RADAR.length + 3;
  controlla(`matrice completa (${nFonti} fonti × ${AMBIENTI.length} ambienti × ${VARIABILI.length} combinazioni di variabili × 2 usi = ${celle} celle): ogni cella come la regola del 48C §3.7`, sbagliate.length === 0 && celle === nFonti * AMBIENTI.length * VARIABILI.length * 2, sbagliate.slice(0, 4));
  const senza = fonteAutorizzata("pvl", "importazione", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production" });
  controlla("deploy di produzione senza la variabile: il motivo dice ESATTAMENTE quale variabile manca", !senza.ok && senza.motivo.includes("RADAR_PVL_PRODUZIONE=autorizzata") && senza.motivo.includes("nessuna scrittura"), senza);
  const notifiche = fonteAutorizzata("sintel", "notifiche", { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production" });
  controlla("notifiche: stesso motivo, con «nessuna notifica»", !notifiche.ok && notifiche.motivo.includes("RADAR_SINTEL_PRODUZIONE") && notifiche.motivo.includes("nessuna notifica"), notifiche);
  const locale = fonteAutorizzata("pvl", "importazione", { NEXT_PUBLIC_SUPABASE_URL: PROD, ...tutte });
  controlla("computer locale verso la produzione, anche con la variabile: NO", !locale.ok, locale);
}

// ═════ giri veri: con la variabile il giro passa la guardia e arriva al database; senza, zero accessi ═════
async function provaGiri(): Promise<void> {
  const mondo = () => {
    const db = new DbFinto();
    db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: false, ultimo_successo_il: null, cursore: null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false }));
    return db;
  };
  const PROD_DEPLOY = { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production" };
  const a = mondo();
  const ra = await eseguiImportazionePvl(a as unknown as SupabaseClient, { modo: "incrementale", tempoMassimoMs: 1000, env: PROD_DEPLOY });
  controlla("PVL in produzione SENZA variabile: «ambiente_non_consentito», zero accessi al database (registro compreso)", !ra.eseguita && ra.motivo === "ambiente_non_consentito" && a.richieste.length === 0, { ra, richieste: a.richieste });
  const b = mondo();
  const rb = await eseguiImportazionePvl(b as unknown as SupabaseClient, { modo: "incrementale", tempoMassimoMs: 1000, env: { ...PROD_DEPLOY, RADAR_PVL_PRODUZIONE: "autorizzata", RADAR_CONTATTO_FONTI: "contatto@esempio.invalid" } });
  controlla("PVL in produzione CON la variabile: passa la guardia, legge lo stato, la fonte è spenta → «fonte_spenta» registrato", !rb.eseguita && rb.motivo === "fonte_spenta" && b.richieste.some((q) => q.tabella === "radar_fonti_stato") && b.t("radar_esecuzioni")[0]?.esito === "inerte", { rb, richieste: b.richieste });
  const c = mondo();
  const rc = await eseguiImportazioneRegionale(c as unknown as SupabaseClient, "sintel", { env: { ...PROD_DEPLOY, RADAR_PVL_PRODUZIONE: "autorizzata", RADAR_CONTATTO_FONTI: "contatto@esempio.invalid" } });
  controlla("Sintel in produzione con la variabile della PVL (non la sua): «ambiente_non_consentito», zero accessi", !rc.eseguita && rc.motivo === "ambiente_non_consentito" && c.richieste.length === 0, rc);
}

// ═════ notifiche e console: la stessa regola ═════
function provaTesti(): void {
  const leggi = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const eventi = leggi("src/lib/radar/notifiche/eventi-calcoli.ts");
  controlla("notifiche (48B §5): rettifiche per fonte e riepilogo delle gare passano da fonteAutorizzata(…, «notifiche», …)", (eventi.match(/fonteAutorizzata\([^)]*"notifiche", x\.env\)/g) ?? []).length === 2, eventi.match(/fonteAutorizzata\([^)]*\)/g));
  const azioni = leggi("src/app/site-console/azioni/tender-intelligence.ts");
  controlla("console: l'accensione di PVL e fonti regionali passa da scrittureRadarConsentite (= fonteAutorizzata per l'importazione)", /scrittureRadarConsentite\("pvl", process\.env\)/.test(azioni) && /scrittureRadarConsentite\(fonte, process\.env\)/.test(azioni));
  const amb = leggi("src/lib/radar/ambiente.ts");
  controlla("ambiente.ts: scrittureRadarConsentite resta fonteAutorizzata per l'importazione", /return fonteAutorizzata\(fonte, "importazione", env\)/.test(amb));
}

async function principale(): Promise<void> {
  provaMatrice();
  await provaGiri();
  provaTesti();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica delle guardie di produzione per fonte (K8): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
