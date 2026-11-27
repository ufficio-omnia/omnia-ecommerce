// Autotest delle FONDAMENTA di Tender Intelligence (fase A, 16/11/2026). Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
//   - la mappa CPV → settore coincide con il file approvato (dati/cpv-settori-omnia.csv), unica fonte, codice per codice;
//   - classificazione delle gare: corrispondenza ESATTA dei CPV, ausiliariato solo da parole, esclusioni dei casi reali dello spike;
//   - soglie UE e allegato XIV (servizi per CPV, non per settore: la vigilanza di edifici NON è allegato XIV);
//   - interruttori fail-closed, costi a zero per difetto, limiti per organizzazione, apertura di sviluppo mai in produzione;
//   - coda dei lavori: attese crescenti, blocco a tempo, errori senza dati sensibili;
//   - registro delle fonti: copertura, aggiornamento e limiti per ogni fonte, nessuna fonte «attiva» prima della fase B;
//   - migrazioni 0109–0111: solo additive, RLS attiva su ogni tabella, nessuna regola per i ruoli utente, revoca ad anon e authenticated,
//     ditte individuali anonime imposte dal database, parametri iniziali che non sovrascrivono;
//   - console: voce e pagina presenti, guardia come prima operazione; nessun componente client usa la chiave di servizio.
import fs from "fs";
import path from "path";
import { leggiCsvCpvSettori } from "./lib/cpv-radar-csv";
import { CPV_SETTORI_OMNIA } from "../src/lib/radar/settori-dati";
import { SETTORI_RADAR, classificaGara, cpvDelSettore, normalizzaCpv, settoreDaNomeFile, settoriDaParole, testoPerConfronto } from "../src/lib/radar/settori";
import { SOGLIA_ALLEGATO_XIV, allegatoXIV, confrontaConSoglia, periodoSoglie, sogliaApplicabile } from "../src/lib/radar/soglie-ue";
import {
  AZIONI_RADAR,
  LIMITI_PREDEFINITI,
  aperturaSviluppoRadar,
  creditiPerAzione,
  dirittoRadar,
  impostazioniClienteDaRiga,
  inizioFinestra,
  limiteEffettivo,
  parametriDaRighe,
  verificaLimite,
} from "../src/lib/radar/diritto-calcoli";
import { MINUTI_BLOCCO, attesaDopoErrore, bloccoFinoA, dopoErrore, erroreDaConservare, prendibile } from "../src/lib/radar/lavori-calcoli";
import { FONTI_RADAR } from "../src/lib/radar/fonti/tipi";
import { riepilogaUtilizzi } from "../src/lib/console/tender-intelligence";

const RADICE = path.join(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(RADICE, relativo), "utf-8").replace(/\r\n/g, "\n");

// ───── 1. mappa CPV: il file approvato è l'unica fonte ─────
const csv = leggiCsvCpvSettori(path.join(RADICE, "src/lib/radar/dati/cpv-settori-omnia.csv"));
uguale("il file approvato contiene 56 codici (50 dell'11/11 più i 6 di bar e ristoranti approvati dall'utente il 17/11)", csv.length, 56);
uguale("settori-dati.ts coincide con il CSV, codice per codice (rigenerarlo con scripts/genera-cpv-radar.ts)", CPV_SETTORI_OMNIA.map((r) => ({ ...r })), csv);
uguale("nessun codice ripetuto", new Set(csv.map((r) => r.cpv)).size, csv.length);
uguale("ogni settore del file è un settore noto", csv.filter((r) => !settoreDaNomeFile(r.settore)).map((r) => r.settore), []);
uguale("i sei settori: cinque dal file più l'ausiliariato (solo parole)", SETTORI_RADAR.map((s) => s.id), ["pulizia", "ristorazione", "vigilanza_portierato", "facchinaggio", "multiservizi", "ausiliariato"]);
uguale("l'ausiliariato non ha CPV", cpvDelSettore("ausiliariato"), []);
uguale("conteggi per settore come nel file", SETTORI_RADAR.map((s) => cpvDelSettore(s.id).length), [17, 21, 9, 7, 2, 0]);

// ───── 2. normalizzazione e classificazione ─────
uguale("CPV con cifra di controllo", normalizzaCpv("90910000-9"), "90910000");
uguale("CPV senza cifra di controllo", normalizzaCpv(" 90910000 "), "90910000");
uguale("CPV «non disponibile» = nessun CPV", normalizzaCpv("99999999"), null);
uguale("CPV malformato", normalizzaCpv("9091"), null);
uguale("testo senza accenti e minuscolo", testoPerConfronto("Sanificazióne  degli UFFICI"), "sanificazione degli uffici");

const pulizia = classificaGara({ cpvPrincipale: "90919200-4", cpvTutti: ["90919200-4"], testo: "Servizio di pulizia degli uffici giudiziari" });
uguale("CPV del file → settore e motivo spiegato", [pulizia.settori, pulizia.metodo, pulizia.motivi], [["pulizia"], "cpv", ["CPV 90919200 Servizi di pulizia di uffici"]]);
const figlio = classificaGara({ cpvPrincipale: "90918000", testo: "Servizio di pulizia di cassonetti" });
uguale("CPV di famiglia ma NON nel file (cassonetti) e parola esclusa → nessun settore", [figlio.settori, figlio.metodo], [[], null]);
const multi = classificaGara({ cpvPrincipale: "98341140", cpvTutti: ["98341140", "90910000"], testo: "Vigilanza e pulizia" });
uguale("più CPV del file → più settori, principale dal CPV principale", [multi.settori, multi.settorePrincipale], [["vigilanza_portierato", "pulizia"], "vigilanza_portierato"]);
const aus = classificaGara({ cpvPrincipale: "85140000", testo: "Affidamento triennale del servizio di ausiliariato specializzato" });
uguale("ausiliariato solo dalle parole", [aus.settori, aus.metodo], [["ausiliariato"], "parole_chiave"]);
const ausConCpv = classificaGara({ cpvPrincipale: "90910000", testo: "Servizio di pulizia e servizi ausiliari" });
uguale("CPV di pulizia + parole di ausiliariato → entrambi i settori", ausConCpv.settori, ["pulizia", "ausiliariato"]);
const nonDisp = classificaGara({ cpvPrincipale: "99999999", testo: "Servizio di ristorazione scolastica" });
uguale("CPV non disponibile → riconoscimento per parole", [nonDisp.settori, nonDisp.metodo], [["ristorazione"], "parole_chiave"]);
const casi: [string, string[]][] = [
  ["Servizio di pulizia caditoie stradali e spurgo pozzetti", []],
  ["Servizio di pulizia delle reti fognarie", []],
  ["Fornitura di prodotti per la pulizia", []],
  // decisione dell'utente del 18/11 (D2): la «fornitura di buoni pasto» è un servizio sostitutivo di mensa (B, regole di settori.ts); resta
  // fuori dalle parole chiave e dai settori solo il caso C, materiali o stampa senza il servizio
  ["Stampa di buoni pasto cartacei per i dipendenti", []],
  ["Fornitura di attrezzature per mense", []],
  ["Manutenzione impianti di videosorveglianza", []],
  ["Servizio di trasporto scolastico e vigilanza sullo scuolabus", []],
  ["Servizio di vigilanza armata e portierato", ["vigilanza_portierato"]],
  ["Servizio di reception presso la sede", ["vigilanza_portierato"]],
  ["Servizio di refezione scolastica", ["ristorazione"]],
  ["Servizi di facchinaggio e trasloco uffici", ["facchinaggio"]],
  ["Movimentazione terra per lavori stradali", []],
  ["Global service immobili comunali", ["multiservizi"]],
  ["Custodia del canile comunale", []],
];
for (const [testo, attesi] of casi) uguale(`parole: «${testo}»`, settoriDaParole(testo), attesi);
uguale("buoni pasto senza il servizio (solo stampa): nessun settore anche nella classificazione (D2, caso C)", classificaGara({ testo: "Stampa di buoni pasto cartacei per i dipendenti" }).settori, []);

// ───── 3. soglie UE e allegato XIV ─────
uguale("vigilanza di edifici 98341140: NON allegato XIV", allegatoXIV("98341140-8"), "no");
uguale("portineria 98341120: NON allegato XIV", allegatoXIV("98341120"), "no");
uguale("accoglienza 79992000: NON allegato XIV", allegatoXIV("79992000"), "no");
uguale("servizi di mensa e catering 55500000 (codice padre): NON allegato XIV", allegatoXIV("55500000"), "no");
uguale("servizi di guardia 79713000: allegato XIV", allegatoXIV("79713000"), "si");
uguale("ristorazione scolastica 55524000: allegato XIV", allegatoXIV("55524000"), "si");
uguale("ristorazione 55300000 (intervallo 55100000–55410000): allegato XIV", allegatoXIV("55300000"), "si");
uguale("pulizia 90910000: NON allegato XIV", allegatoXIV("90910000"), "no");
uguale("CPV fuori dal file e fuori dagli elenchi verificati: non determinato", allegatoXIV("85140000"), "non_determinato");
const data26 = "2026-11-16";
const vig = sogliaApplicabile({ natura: "servizi", tipoEnte: "sub_centrale", cpvPrincipale: "98341140", dataPubblicazione: data26 });
uguale("vigilanza di edifici, ente sub-centrale → 216.000 €", vig.determinata ? vig.importo : null, 216_000);
const guardia = sogliaApplicabile({ natura: "servizi", tipoEnte: "sub_centrale", cpvPrincipale: "79713000", dataPubblicazione: data26 });
uguale("servizi di guardia → 750.000 € (allegato XIV)", guardia.determinata ? guardia.importo : null, SOGLIA_ALLEGATO_XIV);
const guardiaSpeciali = sogliaApplicabile({ natura: "servizi", tipoEnte: "settori_speciali", cpvPrincipale: "79713000", dataPubblicazione: data26 });
uguale("allegato XVII nei settori speciali: soglia non verificata → non determinata", guardiaSpeciali.determinata, false);
const centrale = sogliaApplicabile({ natura: "servizi", tipoEnte: "centrale", cpvPrincipale: "90910000", dataPubblicazione: data26 });
uguale("pulizia, autorità centrale → 140.000 €", centrale.determinata ? centrale.importo : null, 140_000);
const speciali = sogliaApplicabile({ natura: "servizi", tipoEnte: "settori_speciali", cpvPrincipale: "90910000", dataPubblicazione: data26 });
uguale("pulizia, settori speciali → 432.000 €", speciali.determinata ? speciali.importo : null, 432_000);
const lavori = sogliaApplicabile({ natura: "lavori", tipoEnte: "sub_centrale", cpvPrincipale: null, dataPubblicazione: data26 });
uguale("lavori → 5.404.000 €", lavori.determinata ? lavori.importo : null, 5_404_000);
uguale("data fuori dai periodi noti → nessuna soglia", periodoSoglie("2025-06-01"), null);
uguale("confronto sotto soglia", confrontaConSoglia(180_000, vig).esito, "sotto");
uguale("confronto sopra soglia", confrontaConSoglia(1_200_000, vig).esito, "sopra");
uguale("valore mancante → non determinabile", confrontaConSoglia(null, vig).esito, "non_determinabile");
atteso("la frase dichiara la soglia come stima", confrontaConSoglia(1_200_000, vig).frase.includes("(stima)"));

// ───── 4. interruttori, costi, limiti ─────
const vuoto = parametriDaRighe([]);
atteso("senza parametri il modulo è spento", vuoto.attivo === false);
atteso("lettura fallita = spento", parametriDaRighe(null).attivo === false);
uguale("costi a zero per difetto", AZIONI_RADAR.map((a) => creditiPerAzione(vuoto, a)), AZIONI_RADAR.map(() => 0));
uguale("limiti predefiniti", vuoto.limiti, LIMITI_PREDEFINITI);
const acceso = parametriDaRighe([{ chiave: "radar_attivo", valore: "1" }]);
atteso("acceso solo con «1»", acceso.attivo && !parametriDaRighe([{ chiave: "radar_attivo", valore: "si" }]).attivo && !parametriDaRighe([{ chiave: "radar_attivo", valore: " 1" }]).attivo);
const strani = parametriDaRighe([
  { chiave: "radar_costo_sintesi", valore: "-3" },
  { chiave: "radar_costo_ricerca", valore: "2" },
  { chiave: "radar_costo_intelligence", valore: "99999" },
  { chiave: "radar_limite_sintesi_giorno", valore: "abc" },
  { chiave: "radar_limite_analisi_requisiti_giorno", valore: "40" },
]);
uguale("costi negativi, enormi o non numerici → zero", [strani.costi.sintesi, strani.costi.ricerca, strani.costi.intelligence], [0, 2, 0]);
uguale("limiti non numerici → predefinito; validi → valore", [strani.limiti.sintesi_giorno, strani.limiti.analisi_requisiti_giorno], [200, 40]);
const cliente = impostazioniClienteDaRiga({ attivo: true, limiti: { analisi_requisiti_giorno: 5, inventato: 3, sintesi_giorno: -1 } });
uguale("limiti dedicati: solo nomi noti e valori validi", cliente?.limiti, { analisi_requisiti_giorno: 5 });
uguale("limite effettivo: prima quello del cliente", [limiteEffettivo(strani, cliente, "analisi_requisiti_giorno"), limiteEffettivo(strani, cliente, "sintesi_giorno")], [5, 200]);
uguale("riga cliente assente → nessuna impostazione", impostazioniClienteDaRiga(null), null);

const d = (attivo: boolean, clienteAttivo: boolean | null, stato: "attivo" | "prova" | "sola_lettura" | "cessato", sviluppo = false) =>
  dirittoRadar({ parametri: parametriDaRighe([{ chiave: "radar_attivo", valore: attivo ? "1" : "0" }]), cliente: clienteAttivo === null ? null : { attivo: clienteAttivo, limiti: {} }, statoAccesso: stato, aperturaSviluppo: sviluppo });
uguale("generale spento → invisibile", [d(false, true, "attivo").visibile, d(false, true, "attivo").motivo], [false, "spento"]);
uguale("generale acceso, cliente non abilitato → invisibile", [d(true, false, "attivo").visibile, d(true, null, "attivo").motivo], [false, "cliente_non_abilitato"]);
uguale("entrambi accesi, abbonamento attivo → operativo", [d(true, true, "attivo").visibile, d(true, true, "attivo").operativo], [true, true]);
uguale("in prova → operativo", d(true, true, "prova").operativo, true);
uguale("sola lettura → visibile ma non operativo", [d(true, true, "sola_lettura").visibile, d(true, true, "sola_lettura").operativo], [true, false]);
uguale("apertura di sviluppo → visibile anche spento", [d(false, null, "attivo", true).visibile, d(false, null, "attivo", true).motivo], [true, "sviluppo"]);
atteso("apertura di sviluppo solo in locale", aperturaSviluppoRadar({ OMNIA_AI_RADAR_APERTO: "1", NODE_ENV: "development" }));
atteso("mai in produzione", !aperturaSviluppoRadar({ OMNIA_AI_RADAR_APERTO: "1", NODE_ENV: "production" }));
atteso("mai su Vercel", !aperturaSviluppoRadar({ OMNIA_AI_RADAR_APERTO: "1", NODE_ENV: "development", VERCEL: "1" }));
atteso("senza la variabile: chiusa", !aperturaSviluppoRadar({ NODE_ENV: "development" }));
uguale("limite: ancora disponibile", verificaLimite(4, 5), { consentito: true, usate: 4, limite: 5, rimanenti: 1 });
uguale("limite: raggiunto", verificaLimite(5, 5).consentito, false);
uguale("limite zero = azione chiusa", verificaLimite(0, 0).consentito, false);
const mezzogiorno = new Date("2026-11-16T11:30:00Z"); // 12:30 a Roma
uguale("finestra del giorno: mezzanotte di Roma", inizioFinestra("sintesi_giorno", mezzogiorno)?.toISOString(), "2026-11-15T23:00:00.000Z");
uguale("finestra del minuto", inizioFinestra("ricerche_minuto", mezzogiorno)?.toISOString(), "2026-11-16T11:29:00.000Z");
uguale("il limite dei progetti non ha finestra", inizioFinestra("progetti_senza_analisi", mezzogiorno), null);

// ───── 5. coda ─────
uguale("attese crescenti: 1, 2, 4, 8 minuti, poi al massimo 60", [1, 2, 3, 4, 8, 20].map((n) => attesaDopoErrore(n) / 60_000), [1, 2, 4, 8, 60, 60]);
const ora = new Date("2026-11-16T10:00:00Z");
const base = { id: "x", tentativi: 0, max_tentativi: 3, prossimo_tentativo_il: "2026-11-16T09:59:00Z", bloccato_fino_a: null };
atteso("in coda e arrivato il turno → prendibile", prendibile({ ...base, stato: "in_coda" }, ora));
atteso("in coda ma non ancora il turno → no", !prendibile({ ...base, stato: "in_coda", prossimo_tentativo_il: "2026-11-16T10:05:00Z" }, ora));
atteso("in corso con blocco valido → no", !prendibile({ ...base, stato: "in_corso", tentativi: 1, bloccato_fino_a: "2026-11-16T10:10:00Z" }, ora));
atteso("in corso con blocco scaduto (esecutore interrotto) → di nuovo prendibile", prendibile({ ...base, stato: "in_corso", tentativi: 1, bloccato_fino_a: "2026-11-16T09:50:00Z" }, ora));
atteso("in corso, blocco scaduto ma tentativi finiti → no", !prendibile({ ...base, stato: "in_corso", tentativi: 3, bloccato_fino_a: "2026-11-16T09:50:00Z" }, ora));
atteso("completato o fallito → mai", !prendibile({ ...base, stato: "completato" }, ora) && !prendibile({ ...base, stato: "fallito" }, ora));
uguale("errore con tentativi residui → di nuovo in coda dopo l'attesa", dopoErrore({ tentativi: 2, max_tentativi: 3 }, ora), { stato: "in_coda", prossimo_tentativo_il: "2026-11-16T10:02:00.000Z" });
uguale("errore all'ultimo tentativo → fallito", dopoErrore({ tentativi: 3, max_tentativi: 3 }, ora).stato, "fallito");
uguale("blocco di 15 minuti", bloccoFinoA(ora), new Date(ora.getTime() + MINUTI_BLOCCO * 60_000).toISOString());
const errore = erroreDaConservare(new Error("rifiutato per mario.rossi@esempio.it con chiave sb_secret_abcdefghijkl1234 e token " + "x".repeat(50)));
atteso("errori conservati senza email, chiavi e token", !errore.includes("mario.rossi") && !errore.includes("sb_secret_abc") && !errore.includes("x".repeat(50)), errore);

// ───── 6. fonti ─────
atteso("ogni fonte dichiara copertura, aggiornamento, limiti e licenza", FONTI_RADAR.every((f) => f.copertura && f.aggiornamento && f.limiti.length > 0 && f.licenza));
uguale("nessuna fonte attiva prima della fase B (TED e PVL restano «in costruzione»)", FONTI_RADAR.filter((f) => f.stato === "attiva").map((f) => f.id), []);
atteso("la fornitura ANAC è prevista, non attiva (istanza inviata)", FONTI_RADAR.find((f) => f.id === "anac_fornitura")?.stato === "prevista");
const sorgentiRadar = fs.readdirSync(path.join(RADICE, "src/lib/radar"), { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
const testoRadar = sorgentiRadar.map((f) => leggi(`src/lib/radar/${f.replace(/\\/g, "/")}`)).join("\n");
// D5 aggiornata dal titolare il 16/11/2026 (fase B1-bis): l'interfaccia della PVL si usa SOLO sullo staging. L'indirizzo compare in un
// solo file (il connettore) e il giro passa dalla guardia che rifiuta ogni database diverso dallo staging.
const conIndirizzoPvl = sorgentiRadar.filter((f) => /pubblicitalegale\.anticorruzione\.it\/api/.test(leggi(`src/lib/radar/${f.replace(/\\/g, "/")}`))).map((f) => f.replace(/\\/g, "/"));
uguale("l'interfaccia della PVL compare solo nel connettore (decisione D5 aggiornata: solo staging)", conIndirizzoPvl, ["fonti/pvl-calcoli.ts"]);
atteso("il giro PVL passa dalla guardia «solo staging» prima di leggere o scrivere", /scrittureRadarConsentite\("pvl"/.test(leggi("src/lib/radar/importa-pvl.ts")));

// ───── 7. migrazioni ─────
const migrazioni = ["0109_radar_archivio_pubblico.sql", "0110_radar_aggiudicazioni.sql", "0111_radar_coda_impostazioni.sql"];
const precedenti = fs.readdirSync(path.join(RADICE, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
const inizioRadar = precedenti.indexOf("0109_radar_archivio_pubblico.sql");
uguale("le migrazioni della fase A partono da 0109, subito dopo la 0108 (chat delle copertine)", [precedenti[inizioRadar - 1], ...precedenti.slice(inizioRadar, inizioRadar + 3)], ["0108_copertine_chat.sql", ...migrazioni]);
// Rilascio (piano 55, F3 passo 9): master ha due migrazioni sue nello stesso intervallo, già eseguite in produzione (0130 copertina in
// vendita, 0131 gare omaggio). Sono ammesse per nome; nessun'altra migrazione estranea al radar.
// 0136 (26/11): fino a 3 Uffici Gare per titolare, migrazione del sito estranea al radar.
// 0141 e 0142 (27/11): newsletter Tender Weekly (console e iscrizioni pubbliche), migrazioni del sito estranee al radar.
const MIGRAZIONI_DEL_SITO = ["0130_copertina_vendita_pacchetti.sql", "0131_omnia_ai_gare_omaggio.sql", "0136_omnia_ai_uffici_gare_tre.sql", "0141_newsletter_tender_weekly.sql", "0142_newsletter_iscrizioni_pubbliche.sql"];
atteso(
  "dopo la 0109 ci sono solo migrazioni di Tender Intelligence (più le due del sito già in produzione: 0130 e 0131)",
  precedenti.slice(inizioRadar).every((m) => /^01\d\d_radar_/.test(m) || MIGRAZIONI_DEL_SITO.includes(m)),
);
for (const m of migrazioni) {
  const sql = leggi(`supabase/migrations/${m}`).replace(/--[^\n]*/g, "");
  const tabelle = [...sql.matchAll(/create table if not exists public\.([a-z_0-9]+)/g)].map((x) => x[1]);
  atteso(`${m}: crea almeno una tabella`, tabelle.length > 0);
  atteso(`${m}: nessuna istruzione distruttiva`, !/\b(drop\s+(table|column|policy|function|index)|truncate|delete\s+from|alter\s+table\s+public\.(?!radar_|omnia_ai_radar_)[a-z_]+)/i.test(sql), "trovata un'istruzione distruttiva o la modifica di una tabella esistente");
  atteso(`${m}: nessuna regola per i ruoli utente`, !/create\s+policy/i.test(sql));
  for (const t of tabelle) {
    atteso(`${m}: ${t} con RLS attiva`, new RegExp(`alter table public\\.${t} enable row level security`).test(sql));
    atteso(`${m}: ${t} revocata ad anon e authenticated`, new RegExp(`revoke all on public\\.${t} from anon, authenticated`).test(sql));
    atteso(`${m}: ${t} concessa alla service role`, new RegExp(`grant [a-z, ]+ on public\\.${t} to service_role`).test(sql));
    atteso(`${m}: ${t} creata solo se manca`, new RegExp(`create table if not exists public\\.${t}`).test(sql));
  }
}
const sql110 = leggi("supabase/migrations/0110_radar_aggiudicazioni.sql");
atteso("0110: le persone fisiche sono anonime per vincolo del database (D6)", /check \(not persona_fisica or \(codice_fiscale is null and denominazione = 'Ditta individuale'\)\)/.test(sql110));
const sql111 = leggi("supabase/migrations/0111_radar_coda_impostazioni.sql");
atteso("0111: interruttore generale spento all'inizio", /\('radar_attivo', '0'\)/.test(sql111));
atteso("0111: i parametri iniziali non sovrascrivono quelli esistenti", /on conflict \(chiave\) do nothing/.test(sql111));
uguale("0111: ogni azione ha il suo costo iniziale a zero", AZIONI_RADAR.filter((a) => !new RegExp(`\\('radar_costo_${a}', '0'\\)`).test(sql111)), []);
uguale(
  "0111: limiti iniziali uguali ai predefiniti del codice",
  (Object.keys(LIMITI_PREDEFINITI) as (keyof typeof LIMITI_PREDEFINITI)[]).filter((n) => !new RegExp(`\\('radar_limite_${n}', '${LIMITI_PREDEFINITI[n]}'\\)`).test(sql111)),
  [],
);
atteso("0111: il registro degli utilizzi non ha chiave esterna sul membro (colonna di registro)", /membro_id uuid,\n/.test(leggi("supabase/migrations/0111_radar_coda_impostazioni.sql")));
atteso("0111: nessuna modifica a gara_consumi o credits", !/gara_consumi|public\.credits/.test(sql111.replace(/--[^\n]*/g, "")));

// ───── 8. console ─────
atteso("voce della console presente nel gruppo «Sistema»", /href: "\/tender-intelligence", etichetta: "Tender Intelligence", pronto: true/.test(leggi("src/app/site-console/_componenti/navigazione.ts")));
const pagina = leggi("src/app/site-console/(app)/tender-intelligence/page.tsx");
atteso("pagina della console: la guardia admin è la prima operazione", pagina.indexOf("await richiediAdminPagina()") >= 0 && pagina.indexOf("await richiediAdminPagina()") < pagina.indexOf("await leggiDatiTenderIntelligence()"));
uguale(
  "riepilogo degli utilizzi per azione",
  riepilogaUtilizzi([
    { azione: "sintesi", crediti: 0, costo_ai_stimato: "0.0021" },
    { azione: "sintesi", crediti: 0, costo_ai_stimato: 0.0019 },
    { azione: "ricerca", crediti: null, costo_ai_stimato: null },
  ]).filter((u) => u.numero > 0),
  [
    { azione: "ricerca", numero: 1, crediti: 0, costoAi: 0 },
    { azione: "sintesi", numero: 2, crediti: 0, costoAi: 0.004 },
  ],
);
for (const f of sorgentiRadar) {
  const t = leggi(`src/lib/radar/${f.replace(/\\/g, "/")}`);
  atteso(`${f}: nessun componente client nel motore del Radar`, !/^["']use client["']/m.test(t));
}

if (fallimenti.length) {
  console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nTutti i controlli sulle fondamenta di Tender Intelligence sono superati.");
