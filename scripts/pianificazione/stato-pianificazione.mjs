// «Stato» della pianificazione dello STAGING, in SOLA LETTURA (documento 54 §6), da lanciare una volta al giorno prima e durante la serie:
//   node stato-pianificazione.mjs            (meglio da una COPIA in una cartella propria, come gli altri strumenti)
// Per ogni fonte: stato e cursore (in sintesi), giri delle ultime 24 ore contro quelli previsti da ORARI_GIRI, esiti, allarmi del giro,
// autorizzazione della pianificazione (usi, ore rimaste), esecuzioni aperte o semaforo aperto da troppo, righe del registro locale del
// lanciatore. Nessuna scrittura, nessuna richiesta alle fonti. Codice 0 se la lettura riesce (le anomalie sono righe «ATTENZIONE»), 1 se no.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// copia di ORARI_GIRI (src/lib/radar/programmazione-calcoli.ts): la prova del livello 1 controlla che siano identici
export const ORARI_ATTESI = {
  pvl: [{ ora: "08:05", giorni: "tutti" }, { ora: "13:05", giorni: "tutti" }, { ora: "18:05", giorni: "tutti" }],
  ted: [{ ora: "10:15", giorni: "feriali" }, { ora: "16:15", giorni: "feriali" }],
  sintel: [{ ora: "07:40", giorni: "tutti" }, { ora: "13:40", giorni: "tutti" }],
  sardegnacat: [{ ora: "08:20", giorni: "feriali" }, { ora: "11:20", giorni: "feriali" }, { ora: "14:20", giorni: "feriali" }, { ora: "17:20", giorni: "feriali" }, { ora: "12:20", giorni: "fine_settimana" }],
};

const FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
const parti = (d) => Object.fromEntries(FMT.formatToParts(d).map((p) => [p.type, p.value]));
/** L'istante UTC di «giorno ora» a Roma (cambio dell'ora compreso). */
export function istanteRoma(giorno, ora) {
  const ipotesi = Date.parse(`${giorno}T${ora}:00Z`);
  for (const scarto of [1, 2]) {
    const t = ipotesi - scarto * 3_600_000;
    const p = parti(new Date(t));
    if (`${p.year}-${p.month}-${p.day}` === giorno && `${p.hour}:${p.minute}` === ora) return t;
  }
  return null;
}
/** Quanti giri previsti di una fonte cadono in [da, a] (istanti in millisecondi). */
export function giriAttesi(fonte, da, a) {
  const orari = ORARI_ATTESI[fonte] ?? [];
  // i giorni di Roma toccati dall'intervallo, ognuno UNA volta: a passi di 12 ore un giorno di 23 o 25 ore (cambio dell'ora) non si perde,
  // e le ripetizioni si tolgono con l'insieme
  const giorni = new Map();
  for (let t = da - 86_400_000; t <= a + 86_400_000; t += 12 * 3_600_000) {
    const p = parti(new Date(t));
    giorni.set(`${p.year}-${p.month}-${p.day}`, p.weekday === "Sat" || p.weekday === "Sun");
  }
  let n = 0;
  for (const [giorno, fineSettimana] of giorni) {
    for (const o of orari) {
      if ((o.giorni === "feriali" && fineSettimana) || (o.giorni === "fine_settimana" && !fineSettimana)) continue;
      const i = istanteRoma(giorno, o.ora);
      if (i !== null && i >= da && i <= a) n++;
    }
  }
  return n;
}

/** Sintesi del cursore: chiavi semplici così come sono, liste come numero di elementi, oggetti come chiavi (mai valori lunghi). */
export function sintesiCursore(c) {
  if (!c || typeof c !== "object") return c ?? null;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Array.isArray(v) ? `${v.length} elementi` : v && typeof v === "object" ? `{${Object.keys(v).join(",")}}` : typeof v === "string" && v.length > 40 ? `${v.length} caratteri` : v]));
}

const SQL = `select json_build_object(
 'fonti', (select json_agg(json_build_object('fonte', fonte, 'attiva', attiva, 'nascosta', nascosta_ai_clienti, 'blocco', blocco_fino_a, 'successo', ultimo_successo_il, 'errore_il', ultimo_errore_il, 'cursore', cursore, 'sospensione', conteggi->'sospensione') order by fonte) from public.radar_fonti_stato),
 'giri', (select coalesce(json_agg(json_build_object('fonte', fonte, 'iniziato_il', iniziato_il, 'esito', esito, 'modo', modo, 'origine', finestre->>'origine', 'richieste', fonte_richieste, 'gare_nuove', gare_nuove, 'allarmi', allarmi) order by iniziato_il), '[]'::json) from public.radar_esecuzioni where iniziato_il > now() - interval '72 hours'),
 'adesso', now()
) as esito`;

async function principale() {
  // guardia: copia durevole del coordinamento (24/11, documento 54, D3); la CLI supabase resta nella cartella temporanea (solo lettura)
  const GUARDIA = "file:///C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/autorizzazioni/guardia-staging.mjs";
  const CLI = "C:/Users/Dell/AppData/Local/Temp/claude/abcfdf0028fd8393/e334def8-d832-4558-942a-9241c500a45d/scratchpad/staging/node_modules/supabase/dist/supabase.js";
  const AUTORIZZAZIONI = "C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/autorizzazioni";
  const CARTELLA_LOG = "C:/Users/Dell/Desktop/OMNIA-PROGETTO1/TENDER_INTELLIGENCE_FASE0/pianificazione/log";
  const { caricaStaging, oscura } = await import(GUARDIA);
  const v = caricaStaging();
  if (v.STAGING_PROJECT_REF !== "ryawdldqiumqsskrnyps" || !v.STAGING_DB_URL.includes("ryawdldqiumqsskrnyps")) { console.log("STOP: non è lo staging"); return 1; }
  const lavoro = fs.mkdtempSync(path.join(os.tmpdir(), "ti-54-"));
  fs.mkdirSync(path.join(lavoro, "supabase"), { recursive: true });
  let e;
  try {
    const r = spawnSync(process.execPath, [CLI, "db", "query", "--read-only", `--remote=${v.STAGING_DB_URL}`, "--workdir", lavoro, SQL, "--output-format", "json"], { encoding: "utf8", timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
    if (r.status !== 0) { console.log(`lettura: codice ${r.status}: ${oscura(`${r.stdout ?? ""} ${r.stderr ?? ""}`, v).slice(0, 600)}`); return 1; }
    const out = oscura(`${r.stdout ?? ""}`, v);
    const d = JSON.parse(out.slice(Math.min(...["[", "{"].map((c) => out.indexOf(c)).filter((n) => n >= 0))));
    const r0 = Array.isArray(d) ? d[0] : (d.rows?.[0] ?? d);
    e = typeof r0.esito === "string" ? JSON.parse(r0.esito) : r0.esito;
  } finally { fs.rmSync(lavoro, { recursive: true, force: true }); }

  const registro = await import(new URL(`file:///${AUTORIZZAZIONI}/registro.mjs`).href);
  const eventi = registro.leggiRegistro();
  const { scegliAutorizzazione, COMANDI_PIANIFICATI, SESSIONE_PIANIFICAZIONE, CARTELLA_PIANIFICAZIONE, eCartellaPianificazione } = await import(new URL("./pianificazione-calcoli.mjs", import.meta.url).href);
  const adesso = Date.parse(e.adesso);
  const giorno = new Date(adesso).toISOString().slice(0, 10);
  const log = [giorno, new Date(adesso - 86_400_000).toISOString().slice(0, 10)].flatMap((g) => {
    const f = path.join(CARTELLA_LOG, `${g}.jsonl`);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  }).filter((x) => Date.parse(x.inizio) > adesso - 86_400_000);
  const attenzione = [];
  console.log(`STATO DELLA PIANIFICAZIONE DELLO STAGING — ${new Date(adesso).toISOString()} (ultime 24 ore)`);
  for (const fonte of Object.keys(ORARI_ATTESI)) {
    const s = (e.fonti ?? []).find((x) => x.fonte === fonte) ?? {};
    const giri = (e.giri ?? []).filter((g) => g.fonte === fonte && Date.parse(g.iniziato_il) > adesso - 86_400_000);
    const attesi = giriAttesi(fonte, adesso - 86_400_000, adesso);
    const esiti = giri.reduce((m, g) => ({ ...m, [g.esito]: (m[g.esito] ?? 0) + 1 }), {});
    const ultimo = giri[giri.length - 1];
    // l'autorizzazione: quella della cartella dichiarata nel registro (si prende dall'ultimo rilascio della fonte con il comando esatto)
    const rilasci = eventi.filter((x) => x.evento === "rilascio" && x.tipo === "importazione" && x.sessione === SESSIONE_PIANIFICAZIONE && eCartellaPianificazione(x.cartella) && JSON.stringify(x.comandi) === JSON.stringify([COMANDI_PIANIFICATI[fonte]]));
    const ultimoRilascio = rilasci[rilasci.length - 1];
    const scelta = ultimoRilascio ? scegliAutorizzazione(eventi, { fonte, cartella: CARTELLA_PIANIFICAZIONE, adesso: new Date(adesso) }) : { motivo: "nessuna_autorizzazione" };
    const st = ultimoRilascio ? registro.stato(ultimoRilascio.id, eventi) : null;
    const lanci = log.filter((x) => x.fonte === fonte);
    console.log(`\n${fonte.toUpperCase()}: attiva ${s.attiva}, nascosta ${s.nascosta}, ultimo successo ${s.successo ?? "—"}, ultimo errore ${s.errore_il ?? "—"}${s.sospensione ? (Date.parse(s.sospensione.il ?? "") > Date.parse(s.successo ?? "") || !s.successo ? `, SOSPESA dal ${s.sospensione.il}` : `, sospensione vecchia del ${s.sospensione.il} (prima dell'ultimo successo)`) : ""}`);
    console.log(`  cursore: ${JSON.stringify(sintesiCursore(s.cursore))}`);
    console.log(`  giri: ${giri.length} nel registro dei giri (previsti ${attesi}); esiti ${JSON.stringify(esiti)}; ultimo ${ultimo ? `${ultimo.iniziato_il} ${ultimo.esito} ${ultimo.modo}, richieste ${ultimo.richieste}, gare nuove ${ultimo.gare_nuove}, allarmi ${JSON.stringify(ultimo.allarmi ?? [])}` : "—"}`);
    console.log(`  autorizzazione: ${ultimoRilascio ? `${ultimoRilascio.id}, usi ${st?.usi ?? 0}/${ultimoRilascio.usi_max}, scade ${ultimoRilascio.scade_il} (${((Date.parse(ultimoRilascio.scade_il) - adesso) / 3_600_000).toFixed(1)} ore)` : "nessuna"}; per il prossimo giro: ${scelta.aut ? "VALIDA" : scelta.motivo}`);
    console.log(`  lanciatore: ${lanci.length} avvii; motivi ${JSON.stringify(lanci.reduce((m, x) => ({ ...m, [x.motivo ?? x.motivo_giro ?? (x.codice === 0 ? "ok" : `codice_${x.codice}`)]: (m[x.motivo ?? x.motivo_giro ?? (x.codice === 0 ? "ok" : `codice_${x.codice}`)] ?? 0) + 1 }), {}))}`);
    if (scelta.aut && giri.length < attesi) attenzione.push(`${fonte}: ${giri.length} giri su ${attesi} previsti nelle ultime 24 ore`);
    if ((esiti.errore ?? 0) + (esiti.sospesa ?? 0) > 0) attenzione.push(`${fonte}: giri in errore o sospesi nelle ultime 24 ore`);
    for (const a of st?.aperti ?? []) if (adesso - Date.parse(a.il ?? e.adesso) > 60 * 60_000) attenzione.push(`${fonte}: esecuzione ${a.uso} aperta da più di un'ora (processo caduto?): blocca TUTTE le scritture autorizzate finché il coordinamento non la chiude`);
    if (s.blocco && Date.parse(s.blocco) < Date.parse("2099-01-01T00:00:00Z") && Date.parse(s.blocco) > adesso && !(st?.aperti ?? []).length) attenzione.push(`${fonte}: semaforo o blocco aperto fino a ${s.blocco} senza un'esecuzione autorizzata in corso`);
    if (ultimoRilascio && Date.parse(ultimoRilascio.scade_il) > adesso && Date.parse(ultimoRilascio.scade_il) - adesso < 12 * 3_600_000) attenzione.push(`${fonte}: l'autorizzazione scade fra meno di 12 ore (rinnovo solo esplicito)`);
  }
  console.log(attenzione.length ? `\nATTENZIONE:\n - ${attenzione.join("\n - ")}` : "\nNessuna anomalia.");
  return 0;
}

if (process.argv[1] && /stato-pianificazione\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) principale().then((codice) => process.exit(codice));
