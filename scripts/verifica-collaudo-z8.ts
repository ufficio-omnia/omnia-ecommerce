// Verifica del COLLAUDO Z8 (documento 46, B2, 23/11/2026): lo script del giro e le sue guardie, su un database IN MEMORIA, senza rete
// (fetch sostituito da uno finto che conta e risponde «errore»). Dati SINTETICI propri (non la replica dello staging): due imprese con le
// stesse persone di prova e le stesse preferenze del collaudo Z3, una gara TED a 10 giorni e una gara SOLO PVL a 5 giorni nella lista.
// Uso: npx tsx scripts/verifica-collaudo-z8.ts → codice 0 se tutto passa.
import fs from "fs";
import os from "os";
import path from "path";
import { FermoCollaudo, PERSONE, ProviderSuCartella, TETTI, giro, installaOsservatore, istanteRoma, prova, type EsitoCollaudo } from "./collaudo-z8/collaudo-motore-z8";
import { aggiungiGiorni, giornoRoma } from "../src/lib/radar/notifiche/calendario";
import type { Riga } from "./lib/db-finto-motore";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
}

// rete: qualunque chiamata vera fa fallire la verifica (le prove dell'osservatore mettono un fetch finto apposta)
globalThis.fetch = (async () => {
  throw new Error("RETE VIETATA nella verifica del collaudo Z8");
}) as typeof fetch;

const ADESSO = new Date("2026-11-24T10:00:00Z");
const OGGI = giornoRoma(ADESSO);
const A = "aaaaaaaa-0000-4000-8000-000000000001", UA = "aaaaaaaa-0000-4000-8000-000000000002", B = "bbbbbbbb-0000-4000-8000-000000000001";
const STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";

function gara(id: string, chiave: string, fonti: string[], giorni: number): Riga {
  const giorno = aggiungiGiorni(OGGI, giorni);
  return {
    id, chiave, oggetto: `Gara sintetica ${chiave} (dato di prova)`, sa_denominazione: "ENTE SINTETICO", luogo_regioni: ["lombardia"], tipo_opportunita: "bando", tipo_procedura: "aperta",
    valore_stimato: 150000, data_pubblicazione: aggiungiGiorni(OGGI, -20), scadenza_giorno: giorno, scadenza_offerte: istanteRoma(giorno, "12:00"), scadenza_ora_indicata: true,
    stato: "aperta", unita_a: null, url_avviso: "https://esempio.invalid/avviso", url_documenti: null, prima_rilevazione_il: "2026-11-01T08:00:00Z", ultima_rilevazione_il: "2026-11-02T08:00:00Z", fonti,
  };
}

function replica(cambi: (t: Record<string, Riga[]>) => void = () => undefined): Record<string, Riga[]> {
  const prima = istanteRoma(aggiungiGiorni(OGGI, -5), "08:00");
  const t: Record<string, Riga[]> = {
    auth_users: [
      { id: A, email: `${PERSONE.titolareA}@prova.test`, email_confermata_il: "2026-11-01T00:00:00Z", banned_until: null, deleted_at: null },
      { id: UA, email: `${PERSONE.ufficioA}@prova.test`, email_confermata_il: "2026-11-01T00:00:00Z", banned_until: null, deleted_at: null },
      { id: B, email: `${PERSONE.titolareB}@prova.test`, email_confermata_il: "2026-11-01T00:00:00Z", banned_until: null, deleted_at: null },
    ],
    omnia_ai_membri: [{ membro_id: UA, titolare_id: A, attivo: true }],
    omnia_ai_radar_impostazioni: [{ user_id: A, attivo: true }, { user_id: B, attivo: true }],
    omnia_ai_radar_notifiche_impresa: [{ impresa_id: A, email_attive: true }, { impresa_id: B, email_attive: true }],
    omnia_ai_radar_notifiche_persone: [
      { impresa_id: A, user_id: A, nuove_opportunita: false, scadenze: true, rettifiche: true, email_bloccata_il: null, motivo_blocco: null },
      { impresa_id: A, user_id: UA, nuove_opportunita: false, scadenze: true, rettifiche: false, email_bloccata_il: null, motivo_blocco: null },
      { impresa_id: B, user_id: B, nuove_opportunita: true, scadenze: false, rettifiche: true, email_bloccata_il: null, motivo_blocco: null },
    ],
    subscriptions: [A, B].map((u) => ({ user_id: u, status: "attivo", current_period_end: "2026-12-31T00:00:00Z", created_at: "2026-11-01T00:00:00Z" })),
    omnia_ai_gare_gratuite: [],
    omnia_ai_radar_profili: [{ user_id: B, posizione: 1, settori: ["pulizia"], sottocategorie: {}, regioni: ["lombardia"], tipi_procedura: [], importo_min: null, importo_max: null, vedere_correlate: true, aggiornato_il: "2026-11-01T00:00:00Z" }],
    radar_procedure: [gara("cccccccc-0000-4000-8000-000000000010", "ted:Z8-10", ["ted"], 10), gara("cccccccc-0000-4000-8000-000000000005", "pvl:Z8-05", ["pvl"], 5)],
    radar_lotti: [],
    omnia_ai_radar_salvate: [
      { user_id: A, procedura_id: "cccccccc-0000-4000-8000-000000000010", aggiunta_id: null, monitorata: true, creata_il: prima },
      { user_id: A, procedura_id: "cccccccc-0000-4000-8000-000000000005", aggiunta_id: null, monitorata: false, creata_il: prima },
    ],
    omnia_ai_radar_gare_aggiunte: [],
    radar_fonti_stato: [{ fonte: "pvl", nascosta_ai_clienti: false }, { fonte: "sardegnacat", nascosta_ai_clienti: true }, { fonte: "ted", nascosta_ai_clienti: false }],
    radar_classificazioni_stato: [],
    radar_classificazioni: [],
    radar_aggiornamenti: [],
    omnia_ai_radar_eventi: [],
    omnia_ai_radar_email_consegne: [],
    radar_notifiche_giri: [],
  };
  cambi(t);
  return t;
}
const cartella = (n: string) => fs.mkdtempSync(path.join(os.tmpdir(), `z8-${n}-`));
const tutti = (e: EsitoCollaudo) => e.controlli.every(([, x]) => x);

async function principale(): Promise<void> {
  // ───── 1. il collaudo completo, come sarà sullo staging ─────
  const c1 = cartella("base");
  const e = await prova(replica(), { adesso: ADESSO, cartella: c1 });
  controlla("base: nessun fermo, tutti i controlli interni superati", !e.fermo && tutti(e), { fermo: e.fermo, falliti: e.controlli.filter(([, x]) => !x) });
  controlla("base: eventi attesi (A: due a 10 giorni, uno a 5 per la gara PVL, uno a 1 giorno; B: uno a 5 giorni)", JSON.stringify(Object.entries(e.eventi).sort()) === JSON.stringify(Object.entries({
    [`${PERSONE.titolareA}|scadenza_10`]: 2, [`${PERSONE.titolareA}|scadenza_5`]: 1, [`${PERSONE.titolareA}|scadenza_1`]: 1, [`${PERSONE.titolareB}|scadenza_5`]: 1 }).sort()), e.eventi);
  controlla("base: consegne SOLO a titolare e Ufficio Gare dell'impresa A (scadenze accese); il titolare B ha le scadenze spente: nessuna", JSON.stringify(Object.entries(e.consegne).sort()) === JSON.stringify(Object.entries({
    [`${PERSONE.titolareA}|scadenza_10|inviata`]: 2, [`${PERSONE.ufficioA}|scadenza_10|inviata`]: 2, [`${PERSONE.titolareA}|scadenza_5|inviata`]: 1, [`${PERSONE.ufficioA}|scadenza_5|inviata`]: 1,
    [`${PERSONE.titolareA}|scadenza_1|inviata`]: 1, [`${PERSONE.ufficioA}|scadenza_1|inviata`]: 1 }).sort()), e.consegne);
  controlla("base: la gara SOLO PVL a 5 giorni dà il suo promemoria come le altre (direttiva 48A: PVL visibile)", e.eventi[`${PERSONE.titolareA}|scadenza_5`] === 1);
  controlla("base: 8 email scritte nella cartella, testo e HTML, solo @prova.test", e.email.length === 8 && e.email.every((m) => /@prova\.test$/.test(m.a)) && fs.readdirSync(path.join(c1, "email")).length === 16);
  controlla("base: secondo passaggio dello stesso giorno = 1 richiesta (O2), 0 righe nuove", e.richieste.passaggio2 === 1 && JSON.stringify(e.dopo1) === JSON.stringify(e.dopo2));
  controlla("base: dati sintetici = 2 richieste (gare aggiunte e salvate in blocco)", e.richieste.dati === 2);
  const totale = Object.values(e.richieste).reduce((a, b) => a + b, 0);
  controlla("base: richieste del giro intero contate (≤ 80)", totale > 0 && totale <= 80, e.richieste);
  console.log(`  richieste del collaudo sintetico: ${JSON.stringify(e.richieste)} = ${totale}`);

  // ───── 2. una fonte nascosta in più (solo nella prova): la gara solo PVL sparirebbe, il resto identico ─────
  const e2 = await prova(replica(), { adesso: ADESSO, cartella: cartella("pvl"), fontiNascoste: ["pvl"] });
  controlla("PVL nascosta (solo prova, campo facoltativo): la gara solo PVL non dà eventi né consegne, il resto invariato",
    !(`${PERSONE.titolareA}|scadenza_5` in e2.eventi) && e2.eventi[`${PERSONE.titolareA}|scadenza_10`] === 2 && e2.eventi[`${PERSONE.titolareB}|scadenza_5`] === 1 && e2.email.length === 6, e2.eventi);
  // la PVL nascosta dal DATABASE (com'è la riga dello staging oggi, fino alla 48B): stesso effetto, senza il campo
  const e2b = await prova(replica((t) => { t.radar_fonti_stato.find((r) => r.fonte === "pvl")!.nascosta_ai_clienti = true; }), { adesso: ADESSO, cartella: cartella("pvldb") });
  controlla("PVL nascosta dal database (staging oggi): la gara solo PVL non dà eventi; dopo la 48B tornerà come il caso base", !(`${PERSONE.titolareA}|scadenza_5` in e2b.eventi) && e2b.email.length === 6, e2b.eventi);

  // ───── 3. arresti PRIMA di scrivere ─────
  const e3 = await prova(replica((t) => { t.auth_users[1].email = "ufficio@esempio.it"; }), { adesso: ADESSO, cartella: cartella("nonprova") });
  controlla("arresto: un destinatario non @prova.test ferma il collaudo PRIMA di scrivere", e3.fermo === "destinatario_non_di_prova" && e3.passaggio1 === null && e3.richieste.dati === 0);
  const e4 = await prova(replica((t) => { t.radar_notifiche_giri.push({ id: "g", giorno_roma: OGGI, fase: "invio", esito: "riuscito" }); }), { adesso: ADESSO, cartella: cartella("pieno") });
  controlla("arresto: tabelle del motore non vuote → fermo prima di scrivere", e4.fermo === "prerequisiti_non_soddisfatti" && e4.passaggio1 === null && e4.richieste.dati === 0);
  const e5 = await prova(replica((t) => { t.omnia_ai_radar_gare_aggiunte.push({ id: "x", user_id: A, oggetto: "SINTETICA — Z8 promemoria a 10 giorni (dato di prova)" }); }), { adesso: ADESSO, cartella: cartella("ripetuto") });
  controlla("arresto: gare sintetiche Z8 già presenti (collaudo ripetuto) → fermo prima di scrivere", e5.fermo === "prerequisiti_non_soddisfatti" && e5.passaggio1 === null && e5.richieste.dati === 0);
  const e6 = await prova(replica((t) => { t.omnia_ai_membri = []; }), { adesso: ADESSO, cartella: cartella("senzaufficio") });
  controlla("arresto: imprese del collaudo diverse da quelle attese (Ufficio Gare assente) → fermo prima di scrivere", e6.fermo === "imprese_del_collaudo_assenti" && e6.richieste.dati === 0);

  // ───── 4. tetti: oltre, nessun secondo passaggio ─────
  const e7 = await prova(replica((t) => {
    for (let i = 0; i < 12; i++) {
      const id = `dddddddd-0000-4000-8000-${String(i).padStart(12, "0")}`;
      t.radar_procedure.push(gara(id, `ted:Z8-T${i}`, ["ted"], 10));
      t.omnia_ai_radar_salvate.push({ user_id: A, procedura_id: id, aggiunta_id: null, monitorata: true, creata_il: istanteRoma(aggiungiGiorni(OGGI, -5), "08:00") });
    }
  }), { adesso: ADESSO, cartella: cartella("tetti") });
  controlla(`tetti: oltre ${TETTI.eventi} eventi il collaudo si ferma PRIMA del secondo passaggio`, e7.fermo === "tetti_o_controlli_superati" && e7.passaggio2 === null && e7.controlli.some(([n, x]) => n.startsWith("tetto: eventi") && !x));

  // ───── 5. il provider: mai un indirizzo non di prova ─────
  const c8 = cartella("provider");
  const fermo8 = { motivo: null as string | null };
  const p = new ProviderSuCartella(path.join(c8, "email"), fermo8);
  const r = await p.invia({ a: "persona@esempio.it", oggetto: "x", html: "<p>x</p>", testo: "x", chiaveIdempotenza: "omnia-radar/x", tags: [] });
  controlla("provider: un indirizzo non @prova.test è rifiutato («configurazione»: la fase si ferma), nessun file", r.esito === "fallita" && "configurazione" in r && r.configurazione === true && fermo8.motivo === "destinatario_non_di_prova" && !fs.existsSync(path.join(c8, "email")));
  const r2 = await p.invia({ a: "titolare-benchmark@prova.test", oggetto: "y", html: "<p>y</p>", testo: "y", chiaveIdempotenza: "omnia-radar/y", tags: [{ name: "tipo", value: "scadenza_1" }] });
  controlla("provider: un indirizzo di prova è «inviato» dal finto e scritto in testo e HTML", r2.esito === "inviata" && fs.readdirSync(path.join(c8, "email")).length === 2 && p.nome === "finto");

  // ───── 6. l'osservatore di rete ─────
  const chiamate: string[] = [];
  const finto = (async (input: RequestInfo | URL) => {
    chiamate.push(String(input instanceof URL ? input.href : typeof input === "string" ? input : input.url));
    return new Response(JSON.stringify({ code: "XX000", message: "finto" }), { status: 500, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  globalThis.fetch = finto;
  const fermo9 = { motivo: null as string | null };
  const oss = installaOsservatore(STAGING, fermo9);
  await fetch(`${STAGING}/rest/v1/radar_notifiche_giri?select=id`);
  let bloccata = false;
  try {
    await fetch("https://api.resend.com/emails", { method: "POST" });
  } catch (x) {
    bloccata = x instanceof FermoCollaudo;
  }
  oss.ripristina();
  controlla("osservatore: lo staging passa ed è contato; un altro host (Resend) FERMA il collaudo e non parte", oss.richieste === 1 && bloccata && fermo9.motivo === "rete_fuori_dallo_staging:api.resend.com" && chiamate.length === 1);
  controlla("osservatore: ripristina il fetch di prima", globalThis.fetch === finto);

  // ───── 7. le guardie del giro, PRIMA di qualunque richiesta ─────
  const ambiente = { NEXT_PUBLIC_SUPABASE_URL: STAGING, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_finto_per_la_prova", RADAR_NOTIFICHE_EMAIL: "attivo", RADAR_EMAIL_ORIGINE: "http://localhost:3000", VERCEL_ENV: undefined as string | undefined };
  const porta = { controllaPorta: () => undefined };
  const rifiuta = async (nome: string, f: () => Promise<unknown>) => {
    const prima = chiamate.length;
    let errore = false;
    try {
      await f();
    } catch {
      errore = true;
    }
    controlla(`giro: ${nome} → rifiutato senza nessuna richiesta`, errore && chiamate.length === prima);
  };
  globalThis.fetch = finto;
  await rifiuta("senza autorizzazione registrata", () => giro({ cartella: cartella("g1"), ambiente, registro: { controllaPorta: () => { throw new Error("negata"); } } }));
  await rifiuta("interruttore non «attivo» nell'ambiente del lancio", () => giro({ cartella: cartella("g2"), ambiente: { ...ambiente, RADAR_NOTIFICHE_EMAIL: "1" }, registro: porta }));
  await rifiuta("su Vercel (VERCEL_ENV presente)", () => giro({ cartella: cartella("g3"), ambiente: { ...ambiente, VERCEL_ENV: "preview" }, registro: porta }));
  await rifiuta("database di produzione", () => giro({ cartella: cartella("g4"), ambiente: { ...ambiente, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co" }, registro: porta }));
  await rifiuta("un valore della produzione in un'altra variabile", () => giro({ cartella: cartella("g5"), ambiente: { ...ambiente, RADAR_EMAIL_ORIGINE: "https://bihfrzspqxsrzlbqqvqa.supabase.co" }, registro: porta }));
  // con tutte le guardie superate, la prima lettura (risposta finta «errore») ferma il giro: solo richieste allo staging
  const prima = chiamate.length;
  let fermato = false;
  try {
    await giro({ cartella: cartella("g6"), ambiente, registro: porta });
  } catch (x) {
    fermato = x instanceof FermoCollaudo;
  }
  const nuove = chiamate.slice(prima);
  controlla("giro: guardie superate, un errore di lettura ferma il giro alla prima richiesta, SOLO verso lo staging", fermato && nuove.length >= 1 && nuove.every((u) => u.startsWith(STAGING)), nuove);
  controlla("giro: nessuna scrittura tentata (solo letture GET prima del fermo)", nuove.every((u) => !/gare_aggiunte|salvate/.test(u) || /select=/.test(u)));

  // ───── 8. testo dello script ─────
  const testo = fs.readFileSync(path.join(__dirname, "collaudo-z8", "collaudo-motore-z8.ts"), "utf8");
  const corpoGiro = testo.slice(testo.indexOf("export async function giro("), testo.indexOf("export function installaOsservatore("));
  controlla("testo: nel giro l'autorizzazione si controlla PRIMA dell'osservatore e del client", corpoGiro.indexOf("controllaPorta(") > 0 && corpoGiro.indexOf("controllaPorta(") < corpoGiro.indexOf("installaOsservatore(") && corpoGiro.indexOf("installaOsservatore(") < corpoGiro.indexOf("createClient("));
  controlla("testo: il giro NON nasconde fonti in più (direttiva 48A: decide solo il database)", /fontiNascosteAggiunte: c\.modo === "giro" \? undefined : c\.fontiNascoste,/.test(testo) && !/FONTI_NASCOSTE_COLLAUDO/.test(testo));
  controlla("testo: nessun uso di Resend né di src/lib/email.ts", !/provider-resend|creaProviderResend|lib\/email["']/.test(testo));
  controlla("testo: righe con LF", !testo.includes("\r\n"));
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`))
  .finally(() => {
    console.log(`Verifica del collaudo Z8: ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
