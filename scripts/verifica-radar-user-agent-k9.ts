// Verifica di K9 (48C, L7 del piano 36, D7): User-Agent delle letture con il contatto di RADAR_CONTATTO_FONTI. Contatto SINTETICO
// dichiarato (contatto@esempio.invalid, dominio riservato che non esiste): mai un indirizzo vero. Giri veri in memoria con fonti finte che
// registrano le intestazioni; nessuna rete. Uso: npx tsx scripts/verifica-radar-user-agent-k9.ts → codice 0 se tutto passa.
import { SITO_PRODOTTO, USER_AGENT_GENERICO, contattoValido, testoContattoMancante, userAgentFonti } from "../src/lib/radar/fonti/user-agent";
import { USER_AGENT_FONTI } from "../src/lib/radar/fonti/sessione-fonte";
import { USER_AGENT_PVL } from "../src/lib/radar/fonti/pvl-calcoli";
import { USER_AGENT_TED } from "../src/lib/radar/fonti/ted-calcoli";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { eseguiImportazioneTed } from "../src/lib/radar/importa-ted";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { FONTI_ESECUZIONI, type FonteEsecuzione } from "../src/lib/radar/esecuzioni-calcoli";
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
// tutto quello che finisce nei log degli importatori, per controllare che il contatto non ci sia mai
const log: string[] = [];
const erroreOriginale = console.error.bind(console);
console.error = (...a: unknown[]) => {
  log.push(a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
};
const adessoVero = Date.now.bind(Date);
let avanti = 0;
Date.now = () => adessoVero() + avanti;

const CONTATTO = "contatto@esempio.invalid";
const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const PROD_DEPLOY = { NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production", RADAR_PVL_PRODUZIONE: "autorizzata", RADAR_SINTEL_PRODUZIONE: "autorizzata", RADAR_SARDEGNACAT_PRODUZIONE: "autorizzata" };

function provaRegole(): void {
  controlla("contatto valido: email o pagina https", contattoValido(CONTATTO) && contattoValido("https://esempio.invalid/contatti") && contattoValido("ufficio.gare+radar@esempio.invalid"));
  const cattivi = ["", "non-una-email", "a@b", "http://esempio.invalid", "javascript:alert(1)", "contatto@esempio.invalid)", "x;y@esempio.invalid", "contatto@esempio.invalid\r\nX-Altro: 1", `${"a".repeat(110)}@esempio.invalid`, "https://esempio.invalid/a b"];
  controlla("contatto NON valido: forme sbagliate, caratteri che rompono l'intestazione, troppo lungo", cattivi.every((x) => !contattoValido(x)), cattivi.filter((x) => contattoValido(x)));
  const conC = userAgentFonti({ ...STAGING, RADAR_CONTATTO_FONTI: ` ${CONTATTO} ` });
  controlla("con contatto: «OMNIA-AI-TenderIntelligence/1.0 (+sito; contatto: …)»", conC.ok && conC.conContatto && conC.valore === `OMNIA-AI-TenderIntelligence/1.0 (+${SITO_PRODOTTO}; contatto: ${CONTATTO})`, conC);
  const st = userAgentFonti(STAGING);
  controlla("staging senza contatto: User-Agent generico di prima (lo stesso delle tre fonti)", st.ok && !st.conContatto && st.valore === USER_AGENT_GENERICO && USER_AGENT_GENERICO === USER_AGENT_FONTI && USER_AGENT_FONTI === USER_AGENT_PVL && USER_AGENT_PVL === USER_AGENT_TED, st);
  const pr = userAgentFonti(PROD_DEPLOY);
  const sc = userAgentFonti({ NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co" });
  controlla("produzione o database sconosciuto senza contatto: «contatto_mancante»", !pr.ok && pr.motivo === "contatto_mancante" && !sc.ok && sc.motivo === "contatto_mancante");
  const nv = userAgentFonti({ ...STAGING, RADAR_CONTATTO_FONTI: "non-una-email" });
  controlla("contatto in forma non valida: rifiutato anche sullo staging", !nv.ok && nv.motivo === "contatto_non_valido", nv);
  controlla("testi dei motivi: dicono cosa manca, non contengono un contatto", !/@/.test(testoContattoMancante("contatto_mancante")) && !/@/.test(testoContattoMancante("contatto_non_valido")) && testoContattoMancante("contatto_mancante").includes("RADAR_CONTATTO_FONTI"));
}

// fonti finte che registrano lo User-Agent di ogni richiesta
function fintaJson(corpo: unknown, intestazioni: string[]) {
  return (async (_u: string | URL, init?: RequestInit) => {
    avanti += 3_000;
    intestazioni.push(new Headers(init?.headers).get("user-agent") ?? "");
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
function mondo(fonte: FonteEsecuzione, cursore: unknown = null): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: f === fonte, ultimo_successo_il: null, cursore: f === fonte ? cursore : null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false }));
  return db;
}
const T0 = new Date("2026-11-23T09:15:00Z");
const pvlFinito = { versione: 2, inCorso: false, ultimoGiorno: null, incrementale: null, finestra: null, recupero: { obiettivoDa: null, prossimoA: null, blocco: null, fermo: null }, buchi: [], completezza: [] };
async function giro(fonte: FonteEsecuzione, db: DbFinto, env: Record<string, string>, intestazioni: string[]) {
  const admin = db as unknown as SupabaseClient;
  if (fonte === "ted") return eseguiImportazioneTed(admin, { tempoMassimoMs: 60_000, pagineMassime: 1, env, adesso: () => T0, pausaMs: 0, origine: "script", fetchFn: fintaJson({ notices: [], totalNoticeCount: 0 }, intestazioni) });
  if (fonte === "pvl") return eseguiImportazionePvl(admin, { modo: "incrementale", tempoMassimoMs: 60_000, env, adesso: () => T0, origine: "script", fetchFn: fintaJson({ content: [], count: 0, lastPaginationToken: null }, intestazioni) });
  return eseguiImportazioneRegionale(admin, "sintel", { env, adesso: () => T0, origine: "script", fetchFn: fintaJson({ rowsUpdatedAt: 1_763_880_000 }, intestazioni) });
}

async function provaGiri(): Promise<void> {
  for (const fonte of ["ted", "pvl", "sintel"] as const) {
    // staging con contatto: ogni richiesta porta lo User-Agent col contatto
    const i1: string[] = [];
    const r1 = await giro(fonte, mondo(fonte, fonte === "pvl" ? pvlFinito : null), { ...STAGING, RADAR_CONTATTO_FONTI: CONTATTO }, i1);
    controlla(`${fonte}, staging con contatto: tutte le richieste con lo User-Agent del contatto`, r1.eseguita && i1.length > 0 && i1.every((h) => h === `OMNIA-AI-TenderIntelligence/1.0 (+${SITO_PRODOTTO}; contatto: ${CONTATTO})`), { r1: r1.eseguita, i1 });
    // staging senza contatto: generico
    const i2: string[] = [];
    await giro(fonte, mondo(fonte, fonte === "pvl" ? pvlFinito : null), STAGING, i2);
    controlla(`${fonte}, staging senza contatto: User-Agent generico`, i2.length > 0 && i2.every((h) => h === USER_AGENT_GENERICO), i2);
    // produzione autorizzata (K8) ma senza contatto: il giro NON parte, nessuna richiesta, riga «errore» senza contatto
    const i3: string[] = [];
    const db3 = mondo(fonte);
    const r3 = await giro(fonte, db3, PROD_DEPLOY, i3);
    const reg = db3.t("radar_esecuzioni")[0] as { esito?: string; errore?: string } | undefined;
    controlla(`${fonte}, produzione senza contatto: «contatto_mancante», ZERO richieste alla fonte, riga di registro «errore» che dice cosa manca`, !r3.eseguita && r3.motivo === "contatto_mancante" && i3.length === 0 && reg?.esito === "errore" && /RADAR_CONTATTO_FONTI/.test(reg.errore ?? "") && !db3.richieste.some((q) => q.tabella === "radar_fonti_stato"), { r3, reg, richieste: db3.richieste });
    // produzione con contatto: parte, col contatto
    const i4: string[] = [];
    const r4 = await giro(fonte, mondo(fonte, fonte === "pvl" ? pvlFinito : null), { ...PROD_DEPLOY, RADAR_CONTATTO_FONTI: CONTATTO }, i4);
    controlla(`${fonte}, produzione autorizzata con contatto: il giro parte, col contatto`, r4.eseguita && i4.length > 0 && i4.every((h) => h.includes(CONTATTO)), { r4: r4.eseguita, i4 });
  }
  // contatto non valido sullo staging: non parte
  const i5: string[] = [];
  const r5 = await giro("pvl", mondo("pvl", pvlFinito), { ...STAGING, RADAR_CONTATTO_FONTI: "non-una-email" }, i5);
  controlla("contatto non valido sullo staging: non parte, nessuna richiesta", !r5.eseguita && r5.motivo === "contatto_mancante" && r5.dettaglio === "contatto_non_valido" && i5.length === 0, r5);

  // il contatto non finisce MAI in log, errori o registro: giro con contatto in cui la fonte risponde con un errore
  const dbE = mondo("ted");
  const cattiva = (async () => {
    avanti += 3_000;
    return new Response("errore interno", { status: 404, headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
  const rE = await eseguiImportazioneTed(dbE as unknown as SupabaseClient, { tempoMassimoMs: 60_000, pagineMassime: 1, env: { ...STAGING, RADAR_CONTATTO_FONTI: CONTATTO }, adesso: () => T0, pausaMs: 0, origine: "script", fetchFn: cattiva });
  const tutto = JSON.stringify({ rE, registro: dbE.tabelle.radar_esecuzioni, stato: dbE.tabelle.radar_fonti_stato, log });
  controlla("il contatto non compare in risultato, registro dei giri, stato della fonte né nei log (anche dopo un errore della fonte)", rE.eseguita && !!rE.errore && log.length > 0 && !tutto.includes(CONTATTO) && !tutto.includes("esempio.invalid"), { errore: rE.eseguita ? rE.errore : null, log });
}

async function principale(): Promise<void> {
  provaRegole();
  await provaGiri();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.error = erroreOriginale;
    console.log(`Verifica dello User-Agent con contatto (K9): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
