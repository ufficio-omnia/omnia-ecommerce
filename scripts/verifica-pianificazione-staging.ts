// Verifica della pianificazione dello staging (decisione dell'utente del 23/11, documento 54A; documento 54): lanciatore dei giri
// pianificati (logica pura), definizioni delle attività di Windows (da ORARI_GIRI, spente), strumento «stato» (giri previsti, ora di Roma),
// usi delle quattro autorizzazioni da 72 ore. Nessuna rete, nessun database, nessuna attività creata. Uso: npx tsx scripts/verifica-pianificazione-staging.ts
import fs from "fs";
import path from "path";
import { ORARI_GIRI } from "../src/lib/radar/programmazione-calcoli";
import {
  CARTELLA_PIANIFICAZIONE, COMANDI_PIANIFICATI, FONTI_PIANIFICATE, SCRIPT_DELLA_FONTE, SESSIONE_PIANIFICAZIONE,
  ambienteDelGiro, controlliCartella, eCartellaPianificazione, esitoDaUscita, rigaLog, scegliAutorizzazione, variabileVietata,
} from "./pianificazione/pianificazione-calcoli.mjs";
import { comandiSchtasks, xmlAttivita } from "./pianificazione/genera-attivita";
import { ORARI_ATTESI, giriAttesi, istanteRoma } from "./pianificazione/stato-pianificazione.mjs";

const falliti: string[] = [];
let ok = 0;
const atteso = (nome: string, cond: boolean, dettaglio?: unknown) => {
  if (cond) ok++;
  else {
    falliti.push(nome);
    console.log(`FALLITO ${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
  }
};
const uguale = (nome: string, reale: unknown, previsto: unknown) => atteso(nome, JSON.stringify(reale) === JSON.stringify(previsto), { previsto, reale });
const RADICE = path.resolve(__dirname, "..");
const ADESSO = new Date("2026-11-24T09:00:00Z");
const COMMIT = "a".repeat(40), SHA = "b".repeat(64);

// ───── 1. quale autorizzazione usa un giro ─────
type Ev = Record<string, unknown>;
const rilascio = (id: string, p: Partial<Ev> = {}): Ev => ({
  evento: "rilascio", id, sessione: SESSIONE_PIANIFICAZIONE, tipo: "importazione", progetto: "ryawdldqiumqsskrnyps", comandi: [COMANDI_PIANIFICATI.pvl], cartella: CARTELLA_PIANIFICAZIONE,
  semaforo: ["pvl"], usi_max: 11, scade_il: "2026-11-26T08:00:00Z", ambiente: { RADAR_STAGING_REF: "ryawdldqiumqsskrnyps", PIANIFICAZIONE_COMMIT: COMMIT, PIANIFICAZIONE_SCRIPT_SHA256: SHA }, ...p,
});
const usi = (id: string, n: number, aperto = false): Ev[] => Array.from({ length: n }, (_, i) => [{ evento: "ricevuta", id, uso: `USO-${id}-${i}` }, ...(aperto && i === n - 1 ? [] : [{ evento: "esito", id, uso: `USO-${id}-${i}` }])]).flat();
const scegli = (eventi: Ev[], p: Partial<{ fonte: string; cartella: string }> = {}) => {
  const r = scegliAutorizzazione(eventi, { fonte: p.fonte ?? "pvl", cartella: p.cartella ?? CARTELLA_PIANIFICAZIONE, adesso: ADESSO });
  return r.aut ? `aut:${r.aut.id}` : r.motivo;
};
uguale("autorizzazione: quella valida della fonte, della sessione e della cartella della pianificazione, con il comando esatto", scegli([rilascio("AUT-20261124-01"), ...usi("AUT-20261124-01", 3)]), "aut:AUT-20261124-01");
uguale("autorizzazione: la cartella si confronta senza badare a barre e maiuscole", scegli([rilascio("AUT-20261124-01")], { cartella: `${CARTELLA_PIANIFICAZIONE.replace(/\//g, "\\").toUpperCase()}\\` }), "aut:AUT-20261124-01");
uguale("blocco automatico alla scadenza: «scaduta»", scegli([rilascio("AUT-20261124-01", { scade_il: "2026-11-24T08:59:59Z" })]), "scaduta");
uguale("usi finiti: «esaurita»", scegli([rilascio("AUT-20261124-01"), ...usi("AUT-20261124-01", 11)]), "esaurita");
uguale("revocata dal coordinatore: «revocata»", scegli([rilascio("AUT-20261124-01"), { evento: "revoca", id: "AUT-20261124-01" }]), "revocata");
uguale("un giro ancora aperto (processo caduto o in corso): «esecuzione_aperta»", scegli([rilascio("AUT-20261124-01"), ...usi("AUT-20261124-01", 2, true)]), "esecuzione_aperta");
uguale("senza commit o impronta dello script nell'autorizzazione: «senza_commit»", [scegli([rilascio("AUT-20261124-01", { ambiente: { PIANIFICAZIONE_COMMIT: COMMIT } })]), scegli([rilascio("AUT-20261124-01", { ambiente: { PIANIFICAZIONE_SCRIPT_SHA256: SHA } })]), scegli([rilascio("AUT-20261124-01", { ambiente: { PIANIFICAZIONE_COMMIT: "abc1234", PIANIFICAZIONE_SCRIPT_SHA256: SHA } })])], ["senza_commit", "senza_commit", "senza_commit"]);
uguale("autorizzazioni di altre cartelle, sessioni, comandi, fonti del semaforo, tipi: non contano",
  [scegli([rilascio("AUT-20261124-01", { cartella: "C:/Users/Dell/Desktop/OMNIA-PROGETTO1/.claude/worktrees/tender-intelligence-b2" })]), scegli([rilascio("AUT-20261124-01", { sessione: "local_111a987d-5f2c-4ab4-b9f8-67988c64940d" })]),
    scegli([rilascio("AUT-20261124-01", { comandi: [["npx", "tsx", "scripts/radar-importa-pvl.ts", "finestra", "2026-11-01", "2026-11-02"]] })]), scegli([rilascio("AUT-20261124-01", { semaforo: ["pvl", "ted"] })]),
    scegli([rilascio("AUT-20261124-01", { tipo: "correzione_dati" })]), scegli([rilascio("AUT-20261124-01")], { fonte: "ted" })],
  ["nessuna_autorizzazione", "nessuna_autorizzazione", "nessuna_autorizzazione", "nessuna_autorizzazione", "nessuna_autorizzazione", "nessuna_autorizzazione"]);
uguale("due autorizzazioni valide della stessa fonte: il giro NON parte («piu_autorizzazioni»)", scegli([rilascio("AUT-20261124-01"), rilascio("AUT-20261124-02")]), "piu_autorizzazioni");
uguale("la vecchia scaduta e il rinnovo valido: vale il rinnovo (mai automatico: lo rilascia il coordinatore)", scegli([rilascio("AUT-20261121-01", { scade_il: "2026-11-24T08:00:00Z" }), rilascio("AUT-20261124-03")]), "aut:AUT-20261124-03");
uguale("fonte sconosciuta", scegli([], { fonte: "anac" }), "fonte_sconosciuta");
atteso("la cartella della pianificazione è dedicata: il ramo di lavoro di B2 non lo è", eCartellaPianificazione(CARTELLA_PIANIFICAZIONE) && !eCartellaPianificazione("C:/Users/Dell/Desktop/OMNIA-PROGETTO1/.claude/worktrees/tender-intelligence-b2"));

// ───── 2. commit, albero, impronta ─────
const aut = rilascio("AUT-20261124-01") as { ambiente: Record<string, string> };
uguale("cartella: commit dell'autorizzazione, albero pulito (la cartella della CLI non conta, nemmeno con CRLF), impronta dello script",
  [controlliCartella({ head: COMMIT, porcelain: "?? supabase/.temp/\r\n", impronta: SHA, aut }), controlliCartella({ head: "c".repeat(40), porcelain: "", impronta: SHA, aut }),
    controlliCartella({ head: COMMIT, porcelain: " M src/lib/radar/importa-pvl.ts\n", impronta: SHA, aut }), controlliCartella({ head: COMMIT, porcelain: "", impronta: "d".repeat(64), aut })],
  [null, "commit_diverso", "albero_non_pulito", "impronta_diversa"]);

// ───── 3. ambiente del giro ─────
const STG = { STAGING_PROJECT_REF: "ryawdldqiumqsskrnyps", STAGING_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co", STAGING_SECRET_KEY: "chiave-sintetica" };
const base = {
  PATH: "p", RADAR_CONTATTO_FONTI: "x@prova.test", RADAR_NOTIFICHE_EMAIL: "attivo", RADAR_REGISTRO_EVIDENZA: "no", VERCEL: "1", VERCEL_ENV: "production", RADAR_PVL_PRODUZIONE: "autorizzata",
  RADAR_TED_CRON: "attivo", RADAR_QUALUNQUE: "x", TI_REGISTRO: "x", TI_AUTORIZZAZIONE: "x", TI_USO: "x", RADAR_CLASSIFICAZIONI: "spente", NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "altra", ALTRO: "valore con bihfrzspqxsrzlbqqvqa",
};
const env = ambienteDelGiro(base, STG) as Record<string, string>;
uguale("ambiente: tolte le variabili vietate e ogni valore della produzione; staging SOLO dalla guardia; classificazioni ed evidenza ACCESE (C12); npx senza rete",
  Object.entries(env).sort(), [["NEXT_PUBLIC_SUPABASE_URL", STG.STAGING_SUPABASE_URL], ["PATH", "p"], ["RADAR_CLASSIFICAZIONI", "attive"], ["RADAR_REGISTRO_EVIDENZA", "attivo"], ["RADAR_STAGING_REF", "ryawdldqiumqsskrnyps"], ["SUPABASE_SERVICE_ROLE_KEY", "chiave-sintetica"], ["npm_config_offline", "true"]]);
atteso("ambiente: email e contatto MAI (anche se presenti), evidenza no tra le vietate", variabileVietata("RADAR_NOTIFICHE_EMAIL") && variabileVietata("RADAR_CONTATTO_FONTI") && !variabileVietata("RADAR_REGISTRO_EVIDENZA") && !("RADAR_NOTIFICHE_EMAIL" in env) && !("RADAR_CONTATTO_FONTI" in env));
let fermato = "";
try { ambienteDelGiro({}, { ...STG, STAGING_PROJECT_REF: "bihfrzspqxsrzlbqqvqa" }); } catch (e) { fermato = (e as Error).message; }
atteso("ambiente: una guardia che non punta allo staging ferma il giro", /non è lo staging/.test(fermato), fermato);

// ───── 4. registro locale: solo numeri e motivi ─────
const uscita = `Autorizzazione AUT-20261124-01 verificata e registrata (ricevuta USO-0123456789ab). Tipo: importazione. Motivo: testo\nSemaforo pvl: aperto per questa esecuzione.\n{\n "eseguita": true,\n "fonte": "pvl",\n "errore": "Errore di rete verso https://esempio.invalid: testo libero",\n "statistiche": { "pvl": { "richieste": 3 }, "avvisi": { "letti": 120 } }\n}\nSemaforo pvl: richiuso.\n`;
const esito = esitoDaUscita(uscita);
uguale("esito del giro: l'ultimo oggetto JSON stampato dallo script", [esito?.eseguita, esito?.statistiche?.pvl?.richieste], [true, 3]);
uguale("esito assente: nessun oggetto", esitoDaUscita("nessun json qui"), null);
const riga = (rigaLog as unknown as (x: Record<string, unknown>) => unknown)({ inizio: "2026-11-24T07:05:00.000Z", fine: "2026-11-24T07:06:30.000Z", fonte: "pvl", aut: "AUT-20261124-01", uso: "USO-0123456789ab", codice: 0, esito, motivo: "Testo Libero con spazi" });
uguale("riga del registro locale: numeri, booleani e motivi in parole fisse; il testo dell'errore NON c'è (solo «con_errore»)",
  riga, { inizio: "2026-11-24T07:05:00.000Z", durata_s: 90, fonte: "pvl", aut: "AUT-20261124-01", uso: "USO-0123456789ab", codice: 0, motivo: null, eseguita: true, motivo_giro: null, con_errore: true, sospesa: null, richieste_fonte: 3, letti: 120, gare_nuove: null });
atteso("riga del registro locale: nessun testo libero dell'uscita", !JSON.stringify(riga).includes("esempio.invalid") && !JSON.stringify(riga).includes("Testo Libero"));

// ───── 5. comandi delle quattro fonti ─────
uguale("cinque fonti (Fase 2: con SATER), ognuna col suo comando esatto (argomenti semplici, come vuole il registro) e uno script che esiste",
  FONTI_PIANIFICATE.map((f: string) => [f, (COMANDI_PIANIFICATI as Record<string, string[]>)[f].every((x) => /^[A-Za-z0-9_./:=,@+-]+$/.test(x)), fs.existsSync(path.join(RADICE, (SCRIPT_DELLA_FONTE as Record<string, string>)[f])), (COMANDI_PIANIFICATI as Record<string, string[]>)[f].includes((SCRIPT_DELLA_FONTE as Record<string, string>)[f])]),
  [["ted", true, true, true], ["pvl", true, true, true], ["sintel", true, true, true], ["sardegnacat", true, true, true], ["sater", true, true, true]]);
uguale("comandi: gli stessi dei giri a mano già autorizzati (A1, A2) per le regionali; PVL incrementale; TED con i limiti predefiniti",
  [COMANDI_PIANIFICATI.sintel, COMANDI_PIANIFICATI.sardegnacat, COMANDI_PIANIFICATI.pvl, COMANDI_PIANIFICATI.ted],
  [["npx", "tsx", "scripts/radar-importa-regionale.ts", "sintel"], ["npx", "tsx", "scripts/radar-importa-regionale.ts", "sardegnacat"], ["npx", "tsx", "scripts/radar-importa-pvl.ts", "incrementale"], ["npx", "tsx", "scripts/radar-importa-ted.ts"]]);

// ───── 6. attività di Windows: da ORARI_GIRI, spente, mai «appena possibile», mai doppie, mai chiuse a forza ─────
const giorniDa = (xml: string) => [...xml.matchAll(/<CalendarTrigger><StartBoundary>2026-11-24T(\d{2}:\d{2}):00<\/StartBoundary><Enabled>true<\/Enabled>(?:<ScheduleByDay><DaysInterval>1<\/DaysInterval><\/ScheduleByDay>|<ScheduleByWeek><WeeksInterval>1<\/WeeksInterval><DaysOfWeek>(.*?)<\/DaysOfWeek><\/ScheduleByWeek>)<\/CalendarTrigger>/g)]
  .map((m) => ({ ora: m[1], giorni: !m[2] ? "tutti" : m[2] === "<Monday /><Tuesday /><Wednesday /><Thursday /><Friday />" ? "feriali" : m[2] === "<Saturday /><Sunday />" ? "fine_settimana" : `?${m[2]}` }));
for (const f of FONTI_PIANIFICATE) {
  const xml = xmlAttivita(f, { cartella: CARTELLA_PIANIFICAZIONE, giorno: "2026-11-24" });
  uguale(`attività ${f}: un innesco per ogni orario di ORARI_GIRI, con i giorni giusti`, giorniDa(xml), (ORARI_GIRI as Record<string, unknown>)[f]);
  const regole = ["<Enabled>false</Enabled>", "<StartWhenAvailable>false</StartWhenAvailable>", "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>", "<AllowHardTerminate>false</AllowHardTerminate>", "<WakeToRun>false</WakeToRun>", "<ExecutionTimeLimit>PT1H</ExecutionTimeLimit>", "<LogonType>InteractiveToken</LogonType>"];
  uguale(`attività ${f}: nasce SPENTA; niente «esegui appena possibile», niente istanze doppie, niente chiusura forzata, niente risveglio; nessun riavvio dopo un errore`,
    [regole.filter((r) => !xml.includes(r)), /RestartOnFailure/.test(xml)], [[], false]);
  atteso(`attività ${f}: lancia il lanciatore della pianificazione per la sua fonte, dalla cartella dedicata`, xml.includes(`scripts\\pianificazione\\lancia-giro-pianificato.mjs&quot; ${f}</Arguments>`) && xml.includes(`<WorkingDirectory>${CARTELLA_PIANIFICAZIONE.replace(/\//g, "\\")}</WorkingDirectory>`));
}
const comandi = comandiSchtasks("C:/cartella");
atteso("istruzioni: creare spente, accendere, spegnere, togliere e controllare, per ogni fonte", FONTI_PIANIFICATE.every((f: string) => [`/Create /TN "\\OMNIA\\Radar staging ${f}"`, `/TN "\\OMNIA\\Radar staging ${f}" /ENABLE`, `/TN "\\OMNIA\\Radar staging ${f}" /DISABLE`, `/Delete /TN "\\OMNIA\\Radar staging ${f}" /F`].every((x) => comandi.includes(x))));

// ───── 7. strumento «stato»: orari e giri previsti in ora di Roma ─────
uguale("strumento «stato»: la sua copia degli orari è identica a ORARI_GIRI", ORARI_ATTESI, ORARI_GIRI);
uguale("ora di Roma: inverno +1, estate +2", [new Date(istanteRoma("2026-11-24", "08:05")!).toISOString(), new Date(istanteRoma("2026-07-01", "08:05")!).toISOString()], ["2026-11-24T07:05:00.000Z", "2026-07-01T06:05:00.000Z"]);
const giorno = (g: string) => [Date.parse(`${g}T00:00:00+01:00`), Date.parse(`${g}T23:59:59+01:00`)] as const;
uguale("giri previsti in un giorno feriale (martedì 24/11): PVL 3, TED 2, Sintel 2, SardegnaCAT 4, SATER 3", FONTI_PIANIFICATE.map((f: string) => giriAttesi(f, ...giorno("2026-11-24"))), [2, 3, 2, 4, 3]);
uguale("giri previsti di domenica (29/11): PVL 3, TED 0, Sintel 2, SardegnaCAT 1, SATER 1", FONTI_PIANIFICATE.map((f: string) => giriAttesi(f, ...giorno("2026-11-29"))), [0, 3, 2, 1, 1]);
uguale("giri previsti nel giorno del cambio dell'ora (domenica 25/10/2026, 25 ore): PVL 3, Sintel 2", [giriAttesi("pvl", Date.parse("2026-10-25T00:00:00+02:00"), Date.parse("2026-10-25T23:59:59+01:00")), giriAttesi("sintel", Date.parse("2026-10-25T00:00:00+02:00"), Date.parse("2026-10-25T23:59:59+01:00"))], [3, 2]);

// ───── 8. usi delle quattro autorizzazioni da 72 ore: giri del periodo più 2 di margine, dentro i 20 del registro ─────
const massimo72 = (f: string) => {
  let m = 0;
  for (let t = Date.parse("2026-11-23T00:00:00Z"); t < Date.parse("2026-12-07T00:00:00Z"); t += 15 * 60_000) m = Math.max(m, giriAttesi(f, t, t + 72 * 3_600_000 - 1));
  return m;
};
// Fase 2 (26/11): SATER 9 giri al più in 72 ore → 11 usi
const USI_PROPOSTI: Record<string, number> = { ted: 8, pvl: 11, sintel: 8, sardegnacat: 14, sater: 11 };
uguale("massimo dei giri previsti in 72 ore (qualunque partenza, due settimane): TED 6, PVL 9, Sintel 6, SardegnaCAT 12, SATER 9", FONTI_PIANIFICATE.map(massimo72), [6, 9, 6, 12, 9]);
atteso("usi proposti = massimo in 72 ore + 2 di margine, e dentro il limite di 20 del registro", FONTI_PIANIFICATE.every((f: string) => USI_PROPOSTI[f] === massimo72(f) + 2 && USI_PROPOSTI[f] <= 20), USI_PROPOSTI);

// ───── 9. il lanciatore: ordine dei controlli e nessun nuovo tentativo ─────
const sorgente = fs.readFileSync(path.join(RADICE, "scripts/pianificazione/lancia-giro-pianificato.mjs"), "utf8");
const pos = (s: string) => sorgente.indexOf(s);
atteso("lanciatore: cartella dedicata → autorizzazione → commit/albero/impronta → guardia → lanciatore registrato, in quest'ordine",
  [pos("eCartellaPianificazione(CARTELLA)"), pos("scegliAutorizzazione(eventi"), pos("controlliCartella({"), pos("caricaStaging()"), pos("esegui-autorizzato.mjs`")].every((p, i, a) => p > 0 && (i === 0 || p > a[i - 1])));
atteso("lanciatore: UN solo avvio del giro (nessun ciclo di nuovi tentativi) e tempo massimo sotto quello dell'attività (45 contro 60 minuti)",
  (sorgente.match(/spawnSync\(process\.execPath/g) ?? []).length === 1 && !/for \(|while \(/.test(sorgente) && /timeout: 45 \* 60_000/.test(sorgente));

console.log(`Verifica della pianificazione dello staging (documento 54): ${ok} ok, ${falliti.length} falliti`);
process.exit(falliti.length ? 1 : 0);
