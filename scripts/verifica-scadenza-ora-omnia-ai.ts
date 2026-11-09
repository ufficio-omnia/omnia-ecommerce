// Autotest dell'ORA della scadenza delle gare di OMNIA AI (richiesta dell'utente, 09/11/2026): quando i documenti non riportano l'ora
// della scadenza, né quella del bando né quella della proroga, il cliente deve poterla scrivere; e NESSUN'ora si presume, si deduce o si
// intende (nemmeno le 23:59): niente ora ereditata dal bando per una data prorogata, niente campo pre-compilato, niente prezzo della
// revisione umana calcolato su un orario inventato.
//
// Nessuna rete, nessun database: regole pure, controlli sul codice (azione, moduli, scheda, revisione), migrazione 0102.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  MESSAGGIO_ORA_CON_MODULO_PROROGA,
  MESSAGGIO_ORA_NON_MODIFICABILE,
  MESSAGGIO_ORA_SENZA_DATA,
  PROPRIETA_SCADENZA_ESTRAZIONE,
  TESTO_ORA_INSERITA_DAL_CLIENTE,
  TESTO_ORA_MANCANTE_BANDO,
  TESTO_ORA_MANCANTE_PROROGA,
  TESTO_ORA_MANUALE,
  TESTO_ORA_NON_INDICATA,
  TESTO_ORA_SENZA_PRESUNZIONI,
  contestoOra,
  decidiScadenza,
  puoInserireOra,
  statoOraScadenza,
  testoOraMancante,
  validaOraManuale,
  valutaInserimentoOra,
} from "../src/lib/gara-proroga";
import { unisciEsitiProroga } from "../src/lib/gara-proroga-passaggio";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, ottenuto: unknown, previsto: unknown) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const elenca = (dir: string): string[] => {
  const uscita: string[] = [];
  for (const v of fs.readdirSync(path.join(radice, dir), { withFileTypes: true })) {
    const f = `${dir}/${v.name}`;
    if (v.isDirectory()) uscita.push(...elenca(f));
    else if (/\.(ts|tsx)$/.test(v.name)) uscita.push(f);
  }
  return uscita;
};

function main() {
  // ───────────────────────── 1. Stato dell'ora ─────────────────────────
  console.log("--- Stato dell'ora: mancante, dai documenti, a mano ---");
  const stato = (scadenza: string | null, ora: string | null, manuale?: boolean) => statoOraScadenza({ scadenza, scadenza_ora: ora, scadenza_ora_manuale: manuale });
  uguale("senza data non c'è niente da chiedere", [stato(null, null), stato(null, "12:00"), stato("", "12:00"), stato("domani", "12:00")], ["nessuna_data", "nessuna_data", "nessuna_data", "nessuna_data"]);
  uguale("data senza ora: «mancante» (anche con ore vuote, non valide o solo spazi)", [stato("2026-11-20", null), stato("2026-11-20", ""), stato("2026-11-20", "  "), stato("2026-11-20", "24:00"), stato("2026-11-20", "boh")], ["mancante", "mancante", "mancante", "mancante", "mancante"]);
  uguale("data con ora scritta nei documenti: «dai_documenti» (anche dalla colonna time, HH:MM:SS)", [stato("2026-11-20", "12:00"), stato("2026-11-20", "12:00:00"), stato("2026-11-20", "9:30", false)], ["dai_documenti", "dai_documenti", "dai_documenti"]);
  uguale("data con ora scritta dal cliente: «manuale»", stato("2026-11-20", "12:00", true), "manuale");
  uguale("un segno «a mano» senza ora non inventa un'ora: resta «mancante»", stato("2026-11-20", null, true), "mancante");
  uguale("la data può arrivare con l'ora attaccata (colonna timestamp): si legge come data", stato("2026-11-20T00:00:00+00:00", "12:00"), "dai_documenti");

  // ───────────────────────── 2. Quando il cliente può scrivere l'ora ─────────────────────────
  console.log("\n--- Chi può scrivere l'ora, e quando ---");
  const puo = (scadenza: string | null, ora: string | null, manuale: boolean | undefined, prorogaStato: unknown) => puoInserireOra({ scadenza, scadenza_ora: ora, scadenza_ora_manuale: manuale, proroga_stato: prorogaStato });
  uguale("ora mancante, nessuna proroga (o gara mai analizzata con la proroga): sì", [puo("2026-11-20", null, false, "nessuna"), puo("2026-11-20", null, false, null), puo("2026-11-20", null, undefined, undefined)], [true, true, true]);
  uguale("ora mancante, proroga CON nuova data (la proroga non scrive l'ora): sì", puo("2026-11-25", null, false, "con_nuova_data"), true);
  uguale("ora mancante, proroga SENZA nuova data: no, lì data e ora si scrivono insieme (modulo della proroga)", puo("2026-10-30", null, false, "senza_nuova_data"), false);
  uguale("ora già scritta dal cliente: sì, si può correggere", puo("2026-11-20", "12:00", true, "nessuna"), true);
  uguale("ora scritta nei documenti: NO, non si cambia a mano (come la data: vale quello che dicono i documenti)", [puo("2026-11-20", "12:00", false, "nessuna"), puo("2026-11-25", "10:00", false, "con_nuova_data")], [false, false]);
  uguale("senza data: no", [puo(null, null, false, "nessuna"), puo(null, "12:00", true, "con_nuova_data")], [false, false]);

  // ───────────────────────── 3. Regole dell'inserimento (le applica l'azione sul server) ─────────────────────────
  console.log("\n--- Inserimento dell'ora: tutte le regole ---");
  const val = (scadenza: string | null, ora: string | null, manuale: boolean, prorogaStato: unknown, input: unknown) => valutaInserimentoOra({ scadenza, scadenza_ora: ora, scadenza_ora_manuale: manuale, proroga_stato: prorogaStato, ora: input });
  uguale("ora mancante e ora valida: ok (normalizzata)", [val("2026-11-20", null, false, "nessuna", "12:00"), val("2026-11-20", null, false, "con_nuova_data", "9:30"), val("2026-11-20", null, false, null, "09:30:00")], [{ ok: true, ora: "12:00" }, { ok: true, ora: "09:30" }, { ok: true, ora: "09:30" }]);
  uguale("correzione di un'ora a mano: ok", val("2026-11-20", "12:00", true, "nessuna", "13:15"), { ok: true, ora: "13:15" });
  uguale("ora dei documenti: rifiutata con il suo messaggio (mai sovrascritta, nemmeno chiamando l'azione a mano)", val("2026-11-20", "12:00", false, "nessuna", "13:15"), { ok: false, errore: MESSAGGIO_ORA_NON_MODIFICABILE });
  uguale("proroga senza nuova data: rifiutata, si usa il modulo con la data", val("2026-10-30", null, false, "senza_nuova_data", "12:00"), { ok: false, errore: MESSAGGIO_ORA_CON_MODULO_PROROGA });
  uguale("senza data di scadenza: rifiutata", val(null, null, false, "nessuna", "12:00"), { ok: false, errore: MESSAGGIO_ORA_SENZA_DATA });
  uguale("il controllo dello stato viene PRIMA di quello dell'ora scritta (nessun'ora né valida né sbagliata cambia l'esito)", [val("2026-11-20", "12:00", false, "nessuna", ""), val(null, null, false, "nessuna", "boh")].map((x) => (x.ok ? "ok" : x.errore)), [MESSAGGIO_ORA_NON_MODIFICABILE, MESSAGGIO_ORA_SENZA_DATA]);
  const invalide = ["", " ", "24:00", "12:60", "25:00", "mezzogiorno", "12", "12:5", "1200", undefined, null, 12, {}];
  atteso("ora vuota, non valida o non testuale: rifiutata, con un messaggio che dice il formato; «non lo so» = non inserire niente", invalide.every((v) => { const x = valutaInserimentoOra({ scadenza: "2026-11-20", scadenza_ora: null, proroga_stato: "nessuna", ora: v }); return !x.ok && /ore:minuti/.test(x.errore); }));
  atteso("validaOraManuale: formati validi", [["00:00", "00:00"], ["23:59", "23:59"], ["9:05", "09:05"], [" 18:30 ", "18:30"], ["07:15:00", "07:15"]].every(([i, o]) => { const x = validaOraManuale(i); return x.ok && x.ora === o; }));

  // ───────────────────────── 4. Dopo una rianalisi dei documenti ─────────────────────────
  console.log("\n--- Rianalisi: l'ora a mano si conserva solo per la STESSA scadenza; mai l'ora di un'altra data ---");
  const esistente = (scadenza: string | null, ora: string | null, manuale: boolean, oraManuale?: boolean) => ({ scadenza, scadenza_ora: ora, scadenza_manuale: manuale, scadenza_ora_manuale: oraManuale });
  const d = (ris: Parameters<typeof decidiScadenza>[0], es: ReturnType<typeof esistente> | null) => decidiScadenza(ris, es);
  const a = d({ scadenza: "2026-11-20", scadenza_ora: "12:00", proroga_termini: "nessuna" }, esistente("2026-11-20", "15:00", false, true));
  atteso("l'ora che scrivono i documenti vale più di quella a mano, e l'ora a mano si spegne", a.scadenza_ora === "12:00" && !a.scadenza_ora_manuale, JSON.stringify(a));
  const b = d({ scadenza: "2026-11-20", proroga_termini: "nessuna" }, esistente("2026-11-20", "15:00", false, true));
  atteso("i documenti non scrivono l'ora e la data è la stessa: l'ora a mano resta, segnata «a mano»", b.scadenza_ora === "15:00" && b.scadenza_ora_manuale === true && b.scadenza === "2026-11-20", JSON.stringify(b));
  const b2 = d({ scadenza: "2026-11-20", proroga_termini: "nessuna" }, esistente("2026-11-20T00:00:00+00:00", "15:00:00", false, true));
  atteso("… anche se la data e l'ora arrivano dal database in un altro formato", b2.scadenza_ora === "15:00" && b2.scadenza_ora_manuale === true, JSON.stringify(b2));
  const c = d({ scadenza: "2026-11-25", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-11-20" }, esistente("2026-11-20", "15:00", false, true));
  atteso("una proroga sposta la data e non scrive l'ora: l'ora a mano di PRIMA non vale per la nuova data, torna «mancante»", c.scadenza === "2026-11-25" && c.scadenza_ora === null && !c.scadenza_ora_manuale, JSON.stringify(c));
  const dd = d({ scadenza: "2026-11-20", proroga_termini: "nessuna" }, esistente("2026-11-20", "12:00", false, false));
  atteso("un'ora trovata in passato dai documenti NON si conserva se la nuova analisi non la trova più (non è a mano: nessuna ora «ricordata»)", dd.scadenza_ora === null && !dd.scadenza_ora_manuale, JSON.stringify(dd));
  const e = d({ scadenza: "2026-11-20", proroga_termini: "nessuna" }, esistente("2026-11-20", "12:00", false));
  atteso("senza il segno «a mano» (colonna assente o valore mancante) nessuna ora si conserva", e.scadenza_ora === null && !e.scadenza_ora_manuale, JSON.stringify(e));
  const f = d({ proroga_termini: "nessuna" }, esistente("2026-11-20", "15:00", false, true));
  atteso("la nuova analisi non trova più nemmeno la data: niente data e niente ora (l'ora non sopravvive senza la sua data)", f.scadenza === null && f.scadenza_ora === null && !f.scadenza_ora_manuale, JSON.stringify(f));
  const g = d({ scadenza: "2026-11-20", scadenza_ora: "boh", proroga_termini: "nessuna" }, esistente("2026-11-20", "15:00", false, true));
  atteso("un'ora illeggibile dei documenti vale come «non scritta»: resta quella a mano della stessa data", g.scadenza_ora === "15:00" && g.scadenza_ora_manuale === true, JSON.stringify(g));
  const h = d({ scadenza: "2026-11-20", proroga_termini: "nessuna" }, null);
  atteso("gara senza stato precedente: ora mancante, nessun segno", h.scadenza === "2026-11-20" && h.scadenza_ora === null && h.scadenza_ora_manuale === false, JSON.stringify(h));
  const i1 = d({ scadenza: "2026-10-30", scadenza_ora: "18:00", proroga_termini: "senza_nuova_data" }, esistente("2026-11-24", "10:00:00", true, true));
  atteso("proroga senza data con data e ora scritte a mano: si conservano entrambe, l'ora segnata «a mano» (e la data a mano)", i1.scadenza === "2026-11-24" && i1.scadenza_ora === "10:00" && i1.scadenza_manuale && i1.scadenza_ora_manuale, JSON.stringify(i1));
  const i2 = d({ scadenza: "2026-10-30", scadenza_ora: "18:00", proroga_termini: "senza_nuova_data" }, esistente("2026-11-24", null, true, false));
  atteso("… con la data a mano e SENZA ora a mano resta senza ora: non si riprende quella del bando (18:00)", i2.scadenza === "2026-11-24" && i2.scadenza_ora === null && !i2.scadenza_ora_manuale, JSON.stringify(i2));
  const j = d({ scadenza: "2026-11-24", scadenza_ora: "10:00", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-10-30" }, esistente("2026-11-24", "08:00", true, true));
  atteso("i documenti ora riportano la data E l'ora della proroga: vale quello che dicono (data a mano e ora a mano si spengono)", j.scadenza === "2026-11-24" && j.scadenza_ora === "10:00" && !j.scadenza_manuale && !j.scadenza_ora_manuale, JSON.stringify(j));
  const k = d({ scadenza: "2026-11-24", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-10-30" }, esistente("2026-11-24", "08:00", true, true));
  atteso("i documenti riportano la data della proroga ma non l'ora, e la data è quella messa a mano dal cliente: l'ora a mano di quella data resta", k.scadenza === "2026-11-24" && k.scadenza_ora === "08:00" && k.scadenza_ora_manuale === true && !k.scadenza_manuale, JSON.stringify(k));

  // ───────────────────────── 5. L'ora del bando NON passa alla proroga ─────────────────────────
  console.log("\n--- L'ora del bando non passa alla data prorogata ---");
  const bando = { scadenza: "2026-10-30", scadenza_ora: "12:00", proroga_termini: "nessuna" };
  const unito = unisciEsitiProroga(bando, { proroga_termini: "con_nuova_data", scadenza: "2026-11-24" });
  const dopo = decidiScadenza(unito, null);
  atteso("bando con le 12:00, il passaggio mirato trova la proroga con la sola data: la gara ha la data nuova e NESSUN'ora (non le 12:00 del bando)", dopo.scadenza === "2026-11-24" && dopo.scadenza_ora === null && dopo.proroga_stato === "con_nuova_data", JSON.stringify(dopo));
  uguale("… e a quel punto il cliente può scrivere l'ora della proroga", puoInserireOra({ scadenza: dopo.scadenza, scadenza_ora: dopo.scadenza_ora, scadenza_ora_manuale: dopo.scadenza_ora_manuale, proroga_stato: dopo.proroga_stato }), true);
  const conOra = decidiScadenza(unisciEsitiProroga(bando, { proroga_termini: "con_nuova_data", scadenza: "2026-11-24", scadenza_ora: "09:30" }), null);
  atteso("se invece la proroga scrive l'ora, vale quella (e non è «a mano»)", conOra.scadenza_ora === "09:30" && !conOra.scadenza_ora_manuale, JSON.stringify(conOra));
  const piuProroghe = unisciEsitiProroga({ scadenza: "2026-11-24", scadenza_ora: "10:00", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-10-30" }, { proroga_termini: "con_nuova_data", scadenza: "2026-12-03" });
  atteso("due proroghe, la seconda senza ora: nemmeno l'ora della prima passa alla seconda", piuProroghe.scadenza === "2026-12-03" && piuProroghe.scadenza_ora === undefined, JSON.stringify(piuProroghe));
  const prima = unisciEsitiProroga({ scadenza: "2026-11-24", scadenza_ora: "10:00", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-10-30" }, { proroga_termini: "con_nuova_data", scadenza: "2026-11-20" });
  atteso("la proroga del mirato è più vicina di quella già nota: resta l'analisi generale con la SUA ora (la data è la sua)", prima.scadenza === "2026-11-24" && prima.scadenza_ora === "10:00");

  // ───────────────────────── 6. Istruzioni al modello e testi ─────────────────────────
  console.log("\n--- Istruzioni al modello e testi ---");
  const ora = PROPRIETA_SCADENZA_ESTRAZIONE.scadenza_ora.description;
  atteso("lo schema dice di omettere l'ora se non è scritta, di non dedurla né presumerla, di non scrivere 23:59/mezzanotte/fine giornata e di non riprendere l'ora del bando per una data prorogata", /Ometti il campo se l'ora non è scritta/.test(ora) && /non dedurla, non presumerla/.test(ora) && /23:59 \(né mezzanotte, né fine giornata\)/.test(ora) && /NON riprendere quella del bando/.test(ora) && /OMETTI l'ora/.test(ora));
  atteso("… e anche con frasi come «restano invariate le altre condizioni» l'ora non si ricava", /restano invariate le altre condizioni/.test(ora));
  atteso("… e degli orari di altri documenti (sedute, sopralluoghi, chiarimenti) non si fa l'ora di scadenza", /sedute di gara, sopralluoghi, chiarimenti/.test(ora));
  atteso("i testi della scheda non presumono niente: «non la presume», nessun «23:59», «si intendono», «di default»", [TESTO_ORA_MANCANTE_BANDO, TESTO_ORA_MANCANTE_PROROGA, TESTO_ORA_MANUALE, TESTO_ORA_NON_INDICATA, TESTO_ORA_INSERITA_DAL_CLIENTE, TESTO_ORA_SENZA_PRESUNZIONI].every((t) => !/23:59|si intend|di default|predefinit/i.test(t)) && /non la presume/.test(TESTO_ORA_MANCANTE_BANDO) && /non la presume e non riprende quella del bando/.test(TESTO_ORA_MANCANTE_PROROGA));
  uguale("testo e contesto: «proroga» solo con la nuova data, altrimenti il bando", [contestoOra("con_nuova_data"), contestoOra("nessuna"), contestoOra(null), contestoOra("senza_nuova_data"), testoOraMancante("proroga"), testoOraMancante("bando")], ["proroga", "bando", "bando", "bando", TESTO_ORA_MANCANTE_PROROGA, TESTO_ORA_MANCANTE_BANDO]);

  // ───────────────────────── 7. Migrazione 0102 ─────────────────────────
  console.log("\n--- Migrazione 0102 ---");
  const sql = leggi("supabase/migrations/0102_gare_scadenza_ora_manuale.sql");
  const sqlCodice = sql.replace(/--[^\n]*/g, "");
  atteso("aggiunge una colonna booleana «scadenza_ora_manuale», non nulla, falsa per le gare che c'erano, una volta sola (if not exists)", /alter table public\.gare\s+add column if not exists scadenza_ora_manuale boolean not null default false;/.test(sqlCodice));
  atteso("ricarica lo schema dell'API e non tocca dati né altre tabelle", /notify pgrst, 'reload schema';/.test(sqlCodice) && !/\b(delete|truncate|drop|update)\b/i.test(sqlCodice) && (sqlCodice.match(/alter table/gi) ?? []).length === 1);
  atteso("la migrazione spiega che il codice funziona anche prima di eseguirla e che l'ora a mano allora non si salva", /funzionano come sempre/.test(sql) && /non si può salvare/.test(sql));

  // ───────────────────────── 8. Il codice: azione, analisi, moduli, scheda, revisione ─────────────────────────
  console.log("\n--- Codice ---");
  const estr = leggi("src/app/actions/gara-extraction.ts");
  const inizioAzione = estr.indexOf("export async function impostaOraScadenzaGara(");
  const azione = inizioAzione < 0 ? "" : estr.slice(inizioAzione);
  atteso("l'azione impostaOraScadenzaGara esiste", azione.length > 500);
  atteso("parte dalla guardia dell'account e dal controllo dell'accesso, come l'altra azione della scadenza", azione.indexOf("await richiediAccountAzione()") > 0 && azione.indexOf("accessoNegatoPerAccount(") > azione.indexOf("richiediAccountAzione"));
  atteso("la gara è un uuid valido e si legge con la sessione del cliente (regole di accesso), mai con il service role", /\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(garaId\)/.test(azione) && /from\("gare"\)\.select\("id, scadenza"\)/.test(azione) && !azione.includes("createAdminClient"));
  atteso("lo stato della proroga, l'ora e il segno «a mano» si leggono dal DATABASE, mai dal modulo: dal browser arriva solo l'ora", /select\("proroga_stato"\)/.test(azione) && /select\("scadenza_ora"\)/.test(azione) && /select\("scadenza_ora_manuale"\)/.test(azione) && !/formData\.get\("(proroga|scadenza|stato|manuale)/.test(azione) && (azione.match(/formData\.get\(/g) ?? []).length === 2);
  atteso("tutte le regole stanno in valutaInserimentoOra e si applicano PRIMA di ogni scrittura", azione.indexOf("valutaInserimentoOra(") > 0 && azione.indexOf("valutaInserimentoOra(") < azione.indexOf(".update("));
  atteso("senza la migrazione 0102 l'ora a mano NON si salva (messaggio al cliente) invece di salvarla senza il segno: la lettura della colonna lo controlla PRIMA, e anche la scrittura", /erroreManuale\)\s*\{\s*if \(schemaAssente\(erroreManuale\)\) return \{ error: "Questa funzione non è ancora attiva/.test(azione) && /if \(schemaAssente\(erroreScrittura\)\) return \{ error: "Questa funzione non è ancora attiva/.test(azione));
  atteso("ora e segno «a mano» si scrivono nello STESSO aggiornamento (o insieme o niente), una volta sola", /\.update\(\{ scadenza_ora: esito\.ora, scadenza_ora_manuale: true \}\)/.test(azione) && (azione.match(/\.update\(/g) ?? []).length === 1);
  atteso("dopo il salvataggio si aggiornano scheda, pagina della revisione, elenco e panoramica", /revalidaPaginePerScadenza\(garaId\)/.test(azione));

  const principale = estr.slice(estr.indexOf(".update({\n        stazione_appaltante"), estr.indexOf("estrazione_aggiornata_il: estrazioneAggiornataIl,"));
  atteso("nell'analisi il segno «a mano» NON sta nell'aggiornamento principale né in quello della proroga (senza la 0102 l'analisi e la proroga funzionano come prima)", principale.length > 100 && !/scadenza_ora_manuale/.test(principale) && !/scadenza_originaria: decisioneScadenza\.scadenza_originaria, scadenza_manuale: decisioneScadenza\.scadenza_manuale[^}]*scadenza_ora_manuale/.test(estr));
  atteso("… si legge a parte (colonna assente → nessun segno) e si scrive a parte, tollerando la colonna mancante", /select\("scadenza_ora_manuale"\)\.eq\("id", garaId\)\.maybeSingle<\{ scadenza_ora_manuale: boolean \| null \}>\(\);\s*if \(scadenzaEsistente\) scadenzaEsistente\.scadenza_ora_manuale = Boolean\(oraManualeRiga\?\.scadenza_ora_manuale\)/.test(estr) && /update\(\{ scadenza_ora_manuale: decisioneScadenza\.scadenza_ora_manuale \}\)[\s\S]{0,200}schemaAssente\(erroreOraManuale\)/.test(estr));
  atteso("la scadenza a mano (data + ora) segna l'ora «a mano» solo se c'è, e non presume nulla se manca", /update\(\{ scadenza_ora_manuale: esito\.ora !== null \}\)/.test(estr) && !/23:59|si intendono/.test(estr.replace(/\/\/.*$/gm, "")));

  const formOra = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/scadenza-ora-form.tsx");
  atteso("il modulo dell'ora usa l'azione, un campo ora obbligatorio e parte VUOTO se l'ora non l'ha scritta il cliente (mai con l'ora del bando)", /useActionState\(impostaOraScadenzaGara/.test(formOra) && /type="time" name="ora" required/.test(formOra) && /defaultValue=\{manuale \? \(ora \?\? ""\) : ""\}/.test(formOra));
  atteso("il modulo dell'ora non presume niente e non contiene orari scritti", !/23:59|si intend|predefinit|default"/i.test(senzaCommenti(formOra)) && !/\d{1,2}:\d{2}/.test(senzaCommenti(formOra)));
  const formProroga = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/scadenza-proroga-form.tsx");
  atteso("il modulo della proroga senza data parte VUOTO (data e ora del bando non si propongono come nuova scadenza); si precompila solo ciò che ha già scritto il cliente", /name="scadenza" required defaultValue=\{manuale \? \(scadenza \?\? ""\) : ""\}/.test(formProroga) && /name="ora" defaultValue=\{manuale \? \(ora \?\? ""\) : ""\}/.test(formProroga) && /Ora \(se la conosci\)/.test(formProroga) && /TESTO_ORA_SENZA_PRESUNZIONI/.test(formProroga) && !/Ora \(facoltativa\)/.test(formProroga));
  const scheda = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/extraction-section.tsx");
  atteso("la scheda mostra «ora non indicata» / «ora inserita da te» e il modulo dell'ora solo quando serve (puoInserireOra); la proroga senza data resta col suo modulo", /statoOra === "mancante"/.test(scheda) && /statoOra === "manuale"/.test(scheda) && /\{inserisciOra && \(\s*<ScadenzaOraForm/.test(scheda) && /puoInserireOra\(\{ \.\.\.datiOra, proroga_stato: proroga\?\.proroga_stato \?\? null \}\)/.test(scheda) && /\{puoModificareScadenza\(proroga\?\.proroga_stato\) && \(\s*<ScadenzaProrogaForm/.test(scheda) && /contesto=\{contestoOra\(proroga\?\.proroga_stato\)\}/.test(scheda));
  atteso("la scheda dice che la scadenza mostrata con la proroga senza data è quella originaria del bando", /scadenza originaria del bando: la proroga non riporta la nuova data/.test(scheda));
  const paginaGara = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
  atteso("la pagina della gara legge il segno «a mano» a parte (colonna assente → nessun segno) e lo passa alla scheda", /select\("scadenza_ora_manuale"\)\.eq\("id", id\)\.maybeSingle/.test(paginaGara) && /scadenza_ora_manuale: Boolean\(oraManualeRaw\?\.scadenza_ora_manuale\)/.test(paginaGara));
  const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/revisione-panel.tsx");
  const paginaRevisione = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/revisione/page.tsx");
  atteso("sul riquadro e sulla pagina della revisione, senza l'ora compare il modulo per scriverla (solo per quel motivo), con la spiegazione già scritta sopra", /esito\.motivo === "ora_scadenza_mancante" && <ScadenzaOraForm garaId=\{garaId\} ora=\{null\} manuale=\{false\} contesto="bando" spiegazione=\{false\} \/>/.test(pannello) && /esito\.motivo === "ora_scadenza_mancante" && <ScadenzaOraForm garaId=\{id\} ora=\{null\} manuale=\{false\} contesto="bando" spiegazione=\{false\} \/>/.test(paginaRevisione));

  // ───────────────────────── 9. Nessun'ora presunta rimasta nel codice ─────────────────────────
  console.log("\n--- Nessun'ora presunta rimasta ---");
  const sorgenti = [...elenca("src"), ...elenca("scripts").filter((f) => !/verifica-scadenza-ora-omnia-ai\.ts$/.test(f))];
  const conCostante = sorgenti.filter((f) => /ORA_SCADENZA_PREDEFINITA|fineGiornoRoma/.test(senzaCommenti(leggi(f))));
  atteso("la costante dell'ora di ripiego e la «fine del giorno» non esistono più, né nel codice né nei test", conCostante.length === 0, conCostante.join(", "));
  const con2359 = elenca("src").filter((f) => /23:59/.test(senzaCommenti(leggi(f))));
  atteso("nel codice dell'applicazione «23:59» compare solo nell'istruzione al modello che lo vieta (gara-proroga.ts)", JSON.stringify(con2359) === JSON.stringify(["src/lib/gara-proroga.ts"]), con2359.join(", "));
  const calcoli = leggi("src/lib/omnia-ai-revisione-calcoli.ts");
  atteso("senza ora non c'è un istante: istanteScadenza restituisce null se manca l'ora e non ha un'ora di ripiego", /if \(!oraNormale\) return null;/.test(calcoli) && !/\[23, 59, 59\]/.test(calcoli));
  atteso("il calcolo del prezzo chiede l'ora prima di tutto il resto quando c'è la data (e un giorno già finito è «scaduta» senza chiedere l'ora)", /dataScadenza && !normalizzaOraScadenza\(i\.scadenzaOra\)/.test(calcoli) && /dataScadenza < dataDiOggiARoma\(i\.adesso\)/.test(calcoli) && calcoli.indexOf('motivo: "ora_scadenza_mancante"') < calcoli.indexOf("const ore = oreAllaScadenza("));
  const condizioni = leggi("src/lib/omnia-ai-revisione-condizioni.ts");
  atteso("le condizioni della revisione sono alla versione 2 e non parlano più di 23:59 presunte; la versione 1 delle richieste già pagate resta nel registro con la sua impronta", /VERSIONE_CONDIZIONI_REVISIONE = 2;/.test(condizioni) && !/le 23:59 di quel giorno/.test(condizioni));

  atteso("il test è nella catena verifica:livello1 (prima di quello del passaggio mirato sulla proroga)", /tsx scripts\/verifica-documenti-proroga-omnia-ai\.ts && tsx scripts\/verifica-scadenza-ora-omnia-ai\.ts && tsx scripts\/verifica-proroga-secondo-passaggio-omnia-ai\.ts/.test(leggi("package.json")));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main();
