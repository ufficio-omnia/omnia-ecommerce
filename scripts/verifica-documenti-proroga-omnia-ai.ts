// Autotest delle due integrazioni sulle gare di OMNIA AI (richiesta dell'utente, 29/10/2026):
//   1. l'elenco dei documenti di una gara mostra la data di caricamento di ognuno ed è in ordine cronologico (anche per i documenti
//      già caricati: la data c'è da sempre in gara_documenti.created_at, nessuna migrazione serve per questo);
//   2. se i documenti contengono una PROROGA dei termini di presentazione, la scadenza della gara è quella della proroga; se la
//      proroga c'è ma i documenti non riportano la nuova data, e SOLO allora, il cliente può cambiare la data a mano.
// Dati sintetici: nessun database, nessuna rete, nessun modello (la prova col modello vero è scripts/prova-proroga-modello.ts).
import fs from "fs";
import path from "path";
import {
  documentiDopoUltimaAnalisi,
  ordinaPerCaricamento,
  testoDataCaricamento,
  testoElencoCronologicoPerEstrazione,
  type DocumentoElenco,
} from "../src/lib/gara-documenti-elenco";
import {
  GIORNI_FUTURO_AMMESSI,
  GIORNI_PASSATO_AMMESSI,
  MESSAGGIO_MODIFICA_NON_CONSENTITA,
  PROPRIETA_SCADENZA_ESTRAZIONE,
  STATI_PROROGA,
  TESTO_PROROGA_CON_DATA,
  TESTO_PROROGA_SENZA_DATA,
  dataValida,
  decidiScadenza,
  normalizzaProroga,
  oggiARoma,
  puoModificareScadenza,
  validaScadenzaManuale,
} from "../src/lib/gara-proroga";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const doc = (id: string, nome: string, quando: string): DocumentoElenco => ({ id, nome_file: nome, created_at: quando });

function corpoFunzione(sorgente: string, nome: string): string {
  const inizio = sorgente.indexOf(`export async function ${nome}(`);
  if (inizio < 0) return "";
  const dopo = sorgente.indexOf("\nexport ", inizio + 10);
  return sorgente.slice(inizio, dopo < 0 ? undefined : dopo);
}

function main() {
  // ───────────────────────── 1. Elenco documenti ─────────────────────────
  console.log("--- Documenti: ordine cronologico e data di caricamento ---");
  const d1 = doc("a", "bando.pdf", "2026-10-01T08:00:00Z");
  const d2 = doc("b", "disciplinare.pdf", "2026-10-01T08:00:05Z");
  const d3 = doc("c", "avviso-proroga.pdf", "2026-10-20T14:35:00Z");
  const mescolati = [d3, d1, d2];
  const copia = JSON.stringify(mescolati);
  const ordinati = ordinaPerCaricamento(mescolati);
  atteso("dal più vecchio al più recente", ordinati.map((d) => d.id).join("") === "abc", ordinati.map((d) => d.id).join(","));
  atteso("l'elenco di partenza non viene modificato", JSON.stringify(mescolati) === copia);
  atteso("lo stesso ordine anche se l'elenco arriva dal più recente (come prima della modifica)", ordinaPerCaricamento([d3, d2, d1]).map((d) => d.id).join("") === "abc");
  atteso("un elenco vuoto resta vuoto", ordinaPerCaricamento([]).length === 0);

  const stessoIstante = "2026-10-05T10:00:00Z";
  const pari = ordinaPerCaricamento([doc("z", "b.pdf", stessoIstante), doc("y", "a.pdf", stessoIstante), doc("x", "a.pdf", stessoIstante)]);
  atteso("a parità di istante decide il nome, poi l'id (ordine sempre uguale)", pari.map((d) => d.id).join("") === "xyz", pari.map((d) => d.id).join(","));
  atteso("una data non leggibile non rompe l'ordine", ordinaPerCaricamento([doc("1", "x.pdf", "non-una-data"), d1]).length === 2);

  atteso("data in ora di Roma (inverno: UTC+1)", testoDataCaricamento("2026-10-26T13:35:00Z") === "26/10/2026, 14:35", testoDataCaricamento("2026-10-26T13:35:00Z"));
  atteso("data in ora di Roma (estate: UTC+2)", testoDataCaricamento("2026-07-15T10:00:00Z") === "15/07/2026, 12:00", testoDataCaricamento("2026-07-15T10:00:00Z"));
  atteso("a cavallo della mezzanotte vale il giorno di Roma", testoDataCaricamento("2026-10-29T23:30:00Z") === "30/10/2026, 00:30", testoDataCaricamento("2026-10-29T23:30:00Z"));
  atteso("una data non leggibile dà stringa vuota, non «Invalid Date»", testoDataCaricamento("boh") === "");

  const ultimaAnalisi = "2026-10-10T09:00:00Z";
  atteso("documenti caricati DOPO l'ultima analisi", uguali(documentiDopoUltimaAnalisi(ordinati, ultimaAnalisi).map((d) => d.id), ["c"]));
  atteso("senza analisi fatta non si segnala nulla", documentiDopoUltimaAnalisi(ordinati, null).length === 0);
  atteso("data dell'analisi illeggibile: non si segnala nulla", documentiDopoUltimaAnalisi(ordinati, "boh").length === 0);
  atteso("un documento caricato nell'istante esatto dell'analisi non è «dopo»", documentiDopoUltimaAnalisi([doc("e", "x.pdf", ultimaAnalisi)], ultimaAnalisi).length === 0);

  const testoElenco = testoElencoCronologicoPerEstrazione([d3, d1, d2]);
  const posizioni = ["bando.pdf", "disciplinare.pdf", "avviso-proroga.pdf"].map((n) => testoElenco.indexOf(n));
  atteso("l'elenco per il modello è numerato e in ordine cronologico", posizioni.every((p) => p > 0) && posizioni[0] < posizioni[1] && posizioni[1] < posizioni[2] && testoElenco.includes("1. bando.pdf") && testoElenco.includes("3. avviso-proroga.pdf"), testoElenco);
  atteso("l'elenco per il modello riporta la data di caricamento di ogni documento", testoElenco.includes("avviso-proroga.pdf — caricato il 20/10/2026, 16:35"), testoElenco);
  atteso("l'elenco per il modello dice che la data scritta nel documento conta di più", /conta soprattutto la data scritta nel documento/.test(testoElenco));

  // ───────────────────────── 2. Proroga: stati e date ─────────────────────────
  console.log("\n--- Proroga: stati e date ---");
  atteso("gli stati ammessi sono tre", uguali([...STATI_PROROGA], ["nessuna", "con_nuova_data", "senza_nuova_data"]));
  atteso("normalizzaProroga riconosce i tre stati (anche con spazi)", normalizzaProroga("nessuna") === "nessuna" && normalizzaProroga(" con_nuova_data ") === "con_nuova_data" && normalizzaProroga("senza_nuova_data") === "senza_nuova_data");
  atteso("normalizzaProroga: tutto il resto è null", [null, undefined, "", "boh", "NESSUNA", 3, {}, true].every((v) => normalizzaProroga(v) === null));

  atteso("dataValida: una data vera passa", dataValida("2026-11-30") === "2026-11-30" && dataValida(" 2026-11-30 ") === "2026-11-30");
  atteso("dataValida: il 29 febbraio di un anno bisestile passa", dataValida("2028-02-29") === "2028-02-29");
  atteso("dataValida: il 30 febbraio, il mese 13, il giorno 0 e il 29/2 non bisestile no", ["2026-02-30", "2026-13-01", "2026-11-00", "2026-02-29"].every((v) => dataValida(v) === null));
  atteso("dataValida: altre forme e anni assurdi no", ["30/11/2026", "2026-1-5", "1999-12-31", "2101-01-01", "", "domani"].every((v) => dataValida(v) === null));
  atteso("dataValida: non stringhe no", [null, undefined, 20261130, {}, []].every((v) => dataValida(v) === null));

  // ───────────────────────── 3. Proroga: quale scadenza si salva ─────────────────────────
  console.log("\n--- Proroga: quale scadenza si salva dopo l'analisi ---");
  const nessunaEsistente = null;
  const nessuna = decidiScadenza({ scadenza: "2026-11-10", scadenza_ora: "12:00", proroga_termini: "nessuna", scadenza_originaria: "2026-11-01" }, nessunaEsistente);
  atteso("nessuna proroga: vale la data del bando, con la sua ora", nessuna.scadenza === "2026-11-10" && nessuna.scadenza_ora === "12:00" && nessuna.proroga_stato === "nessuna" && !nessuna.scadenza_manuale, JSON.stringify(nessuna));
  atteso("nessuna proroga: la «scadenza originaria» eventualmente scritta dal modello non si salva", nessuna.scadenza_originaria === null);

  const conData = decidiScadenza({ scadenza: "2026-11-25", scadenza_ora: "9:30", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-11-10" }, nessunaEsistente);
  atteso("proroga con nuova data: la scadenza è quella della proroga", conData.scadenza === "2026-11-25" && conData.proroga_stato === "con_nuova_data", JSON.stringify(conData));
  atteso("proroga con nuova data: la scadenza originaria si conserva e l'ora si normalizza", conData.scadenza_originaria === "2026-11-10" && conData.scadenza_ora === "09:30" && !conData.scadenza_manuale, JSON.stringify(conData));
  atteso("proroga con nuova data uguale all'originaria (modello confuso): nessuna «originaria» inventata", decidiScadenza({ scadenza: "2026-11-25", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-11-25" }, null).scadenza_originaria === null);

  const senzaData = decidiScadenza({ scadenza: "2026-11-10", scadenza_ora: "12:00", proroga_termini: "senza_nuova_data" }, null);
  atteso("proroga senza nuova data: resta la data del bando (se c'è) e lo stato è registrato", senzaData.scadenza === "2026-11-10" && senzaData.proroga_stato === "senza_nuova_data" && !senzaData.scadenza_manuale, JSON.stringify(senzaData));
  const senzaDataNeppureBando = decidiScadenza({ proroga_termini: "senza_nuova_data" }, null);
  atteso("proroga senza nuova data e senza data del bando: nessuna data, e senza data nessuna ora", senzaDataNeppureBando.scadenza === null && senzaDataNeppureBando.scadenza_ora === null && senzaDataNeppureBando.proroga_stato === "senza_nuova_data");
  atteso("l'ora senza una data non si salva", decidiScadenza({ scadenza_ora: "12:00", proroga_termini: "nessuna" }, null).scadenza_ora === null);

  const mano = { scadenza: "2026-11-20", scadenza_ora: "11:00:00", scadenza_manuale: true };
  const conservata = decidiScadenza({ scadenza: "2026-11-10", scadenza_ora: "12:00", proroga_termini: "senza_nuova_data", scadenza_originaria: "2026-11-10" }, mano);
  atteso("data inserita a mano + proroga ANCORA senza data: la nuova analisi la conserva (data e ora)", conservata.scadenza === "2026-11-20" && conservata.scadenza_ora === "11:00" && conservata.scadenza_manuale && conservata.proroga_stato === "senza_nuova_data", JSON.stringify(conservata));
  atteso("… e la data del bando diventa la «scadenza originaria»", conservata.scadenza_originaria === "2026-11-10", JSON.stringify(conservata));

  const rimpiazzata = decidiScadenza({ scadenza: "2026-11-25", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-11-10" }, mano);
  atteso("data a mano + ora i documenti riportano la nuova data: vale quella dei documenti", rimpiazzata.scadenza === "2026-11-25" && !rimpiazzata.scadenza_manuale && rimpiazzata.scadenza_ora === null, JSON.stringify(rimpiazzata));
  const nonPiuProroga = decidiScadenza({ scadenza: "2026-11-10", proroga_termini: "nessuna" }, mano);
  atteso("data a mano + non si trova più nessuna proroga: vale la data dei documenti", nonPiuProroga.scadenza === "2026-11-10" && !nonPiuProroga.scadenza_manuale && nonPiuProroga.scadenza_originaria === null, JSON.stringify(nonPiuProroga));
  const nonPiuProrogaNeppureData = decidiScadenza({ proroga_termini: "nessuna" }, mano);
  atteso("data a mano + nessuna proroga e nessuna data nei documenti: nessuna data (non si resuscita quella a mano)", nonPiuProrogaNeppureData.scadenza === null && !nonPiuProrogaNeppureData.scadenza_manuale);
  const statoAssente = decidiScadenza({ scadenza: "2026-11-10" }, mano);
  atteso("data a mano + il modello non risponde sulla proroga: non si conserva a mano (non c'è la prova della proroga)", statoAssente.scadenza === "2026-11-10" && !statoAssente.scadenza_manuale && statoAssente.proroga_stato === null, JSON.stringify(statoAssente));
  const manualeInvalida = decidiScadenza({ scadenza: "2026-11-10", proroga_termini: "senza_nuova_data" }, { scadenza: "boh", scadenza_ora: null, scadenza_manuale: true });
  atteso("data a mano illeggibile nel database: si torna alla data dei documenti", manualeInvalida.scadenza === "2026-11-10" && !manualeInvalida.scadenza_manuale);
  const nonManuale = decidiScadenza({ scadenza: "2026-11-10", proroga_termini: "senza_nuova_data" }, { scadenza: "2026-11-30", scadenza_ora: null, scadenza_manuale: false });
  atteso("una data NON inserita a mano non si conserva: la nuova analisi la sostituisce", nonManuale.scadenza === "2026-11-10" && !nonManuale.scadenza_manuale);

  const sbagliata = decidiScadenza({ scadenza: "2026-02-30", proroga_termini: "con_nuova_data" }, null);
  atteso("una data che non esiste detta dal modello non si salva", sbagliata.scadenza === null && sbagliata.scadenza_ora === null);
  atteso("un valore di proroga inventato dal modello è come «nessuna risposta»", decidiScadenza({ scadenza: "2026-11-10", proroga_termini: "forse" }, null).proroga_stato === null);

  // Il giro completo, passo per passo, come lo vive il cliente.
  console.log("\n--- Il giro completo (bando → proroga senza data → data a mano → documento con la data) ---");
  let stato = decidiScadenza({ scadenza: "2026-11-10", scadenza_ora: "12:00", proroga_termini: "nessuna" }, null);
  atteso("1. prima analisi, nessuna proroga: 10/11 ore 12:00, nessun modulo", stato.scadenza === "2026-11-10" && !puoModificareScadenza(stato.proroga_stato));
  stato = decidiScadenza({ scadenza: "2026-11-10", scadenza_ora: "12:00", proroga_termini: "senza_nuova_data", scadenza_originaria: "2026-11-10" }, { scadenza: stato.scadenza, scadenza_ora: stato.scadenza_ora, scadenza_manuale: stato.scadenza_manuale });
  atteso("2. caricato un avviso che proroga senza dire la data: ora il modulo c'è, la data è ancora quella del bando", stato.scadenza === "2026-11-10" && puoModificareScadenza(stato.proroga_stato));
  const aMano = validaScadenzaManuale({ data: "2026-11-24", ora: "10:00" }, new Date("2026-10-29T10:00:00Z"));
  atteso("3. il cliente scrive 24/11 ore 10:00", aMano.ok && aMano.scadenza === "2026-11-24" && aMano.ora === "10:00");
  if (aMano.ok) stato = { ...stato, scadenza: aMano.scadenza, scadenza_ora: aMano.ora, scadenza_manuale: true };
  stato = decidiScadenza({ scadenza: "2026-11-10", scadenza_ora: "12:00", proroga_termini: "senza_nuova_data" }, { scadenza: stato.scadenza, scadenza_ora: stato.scadenza_ora, scadenza_manuale: stato.scadenza_manuale });
  atteso("4. rianalisi (ancora senza data nei documenti): la data a mano resta", stato.scadenza === "2026-11-24" && stato.scadenza_ora === "10:00" && stato.scadenza_manuale && puoModificareScadenza(stato.proroga_stato));
  stato = decidiScadenza({ scadenza: "2026-11-26", scadenza_ora: "09:00", proroga_termini: "con_nuova_data", scadenza_originaria: "2026-11-10" }, { scadenza: stato.scadenza, scadenza_ora: stato.scadenza_ora, scadenza_manuale: stato.scadenza_manuale });
  atteso("5. caricato l'avviso con la data: vale 26/11 ore 09:00, la data a mano non c'è più, il modulo sparisce", stato.scadenza === "2026-11-26" && stato.scadenza_ora === "09:00" && !stato.scadenza_manuale && stato.scadenza_originaria === "2026-11-10" && !puoModificareScadenza(stato.proroga_stato), JSON.stringify(stato));

  // ───────────────────────── 4. Quando si può cambiare a mano ─────────────────────────
  console.log("\n--- La data si cambia a mano SOLO con una proroga senza nuova data ---");
  atteso("senza_nuova_data: si può", puoModificareScadenza("senza_nuova_data"));
  atteso("nessuna, con_nuova_data, vuoto, sconosciuto: NON si può", ["nessuna", "con_nuova_data", null, undefined, "", "boh", true].every((v) => !puoModificareScadenza(v)));
  atteso("il messaggio di rifiuto spiega la regola", /solo quando i documenti indicano una proroga/.test(MESSAGGIO_MODIFICA_NON_CONSENTITA));

  const adesso = new Date("2026-10-29T10:00:00Z"); // 29/10/2026 11:00 a Roma
  atteso("oggiARoma dà il giorno di Roma", oggiARoma(adesso) === "2026-10-29");
  atteso("oggiARoma a cavallo della mezzanotte: già il giorno dopo a Roma", oggiARoma(new Date("2026-10-29T23:30:00Z")) === "2026-10-30");
  const ok1 = validaScadenzaManuale({ data: "2026-11-24", ora: "10:00" }, adesso);
  atteso("data e ora valide", ok1.ok && ok1.scadenza === "2026-11-24" && ok1.ora === "10:00");
  const ok2 = validaScadenzaManuale({ data: "2026-11-24", ora: "" }, adesso);
  atteso("l'ora è facoltativa (vuota → nessuna ora, si intendono le 23:59)", ok2.ok && ok2.ora === null);
  atteso("ora «9:30» → «09:30»", (() => { const r = validaScadenzaManuale({ data: "2026-11-24", ora: "9:30" }, adesso); return r.ok && r.ora === "09:30"; })());
  atteso("ora «25:00» o «12:75» o «mezzogiorno»: rifiutata", ["25:00", "12:75", "mezzogiorno"].every((o) => { const r = validaScadenzaManuale({ data: "2026-11-24", ora: o }, adesso); return !r.ok && /ora non è valida/.test(r.errore); }));
  atteso("data mancante, illeggibile o inesistente: rifiutata", [null, undefined, "", "24/11/2026", "2026-02-30", {}].every((d) => { const r = validaScadenzaManuale({ data: d, ora: "" }, adesso); return !r.ok && /data valida/.test(r.errore); }));
  atteso(`fino a ${GIORNI_PASSATO_AMMESSI} giorni fa va bene (una gara appena scaduta si può correggere)`, validaScadenzaManuale({ data: "2026-09-29", ora: "" }, adesso).ok);
  atteso(`oltre ${GIORNI_PASSATO_AMMESSI} giorni fa no (errore di battitura sull'anno)`, !validaScadenzaManuale({ data: "2026-09-28", ora: "" }, adesso).ok);
  atteso("l'anno scorso no", !validaScadenzaManuale({ data: "2025-11-24", ora: "" }, adesso).ok);
  atteso(`fino a ${GIORNI_FUTURO_AMMESSI} giorni avanti va bene`, validaScadenzaManuale({ data: "2028-10-28", ora: "" }, adesso).ok);
  atteso(`oltre ${GIORNI_FUTURO_AMMESSI} giorni avanti no`, !validaScadenzaManuale({ data: "2028-10-30", ora: "" }, adesso).ok);
  atteso("oggi stesso va bene, anche a cavallo della mezzanotte di Roma", validaScadenzaManuale({ data: "2026-10-30", ora: "" }, new Date("2026-10-29T23:30:00Z")).ok);
  atteso("i testi della scheda dicono la regola giusta", /documenti indicano una proroga/.test(TESTO_PROROGA_CON_DATA) && /non riportano la nuova data/.test(TESTO_PROROGA_SENZA_DATA) && /inseriscila tu/.test(TESTO_PROROGA_SENZA_DATA));

  // ───────────────────────── 5. Schema dello strumento di estrazione ─────────────────────────
  console.log("\n--- Schema dell'analisi (la parte che il modello legge) ---");
  const P = PROPRIETA_SCADENZA_ESTRAZIONE;
  atteso("le quattro voci: scadenza, scadenza_ora, proroga_termini, scadenza_originaria", uguali(Object.keys(P), ["scadenza", "scadenza_ora", "proroga_termini", "scadenza_originaria"]));
  atteso("proroga_termini è un elenco chiuso dei tre stati", uguali(P.proroga_termini.enum, ["nessuna", "con_nuova_data", "senza_nuova_data"]));
  atteso("la descrizione di «scadenza» comincia come prima della modifica (testo identico in testa)", P.scadenza.description.startsWith("Data di scadenza per la presentazione dell'offerta, formato YYYY-MM-DD. Ometti il campo se non è indicata nei documenti."));
  atteso("la descrizione di «scadenza_ora» comincia come prima della modifica (testo identico in testa)", P.scadenza_ora.description.startsWith("Ora di scadenza per la presentazione dell'offerta, formato HH:MM (24 ore, ora italiana), SOLO se i documenti la indicano insieme alla data (es. 'entro le ore 12:00' → '12:00'). Ometti il campo se non è indicata un'ora: non dedurla e non scrivere 23:59 al posto di un'ora mancante."));
  const dp = P.proroga_termini.description;
  atteso("il modello è istruito a NON scambiare la proroga tecnica/del contratto per una proroga dei termini", /proroga tecnica/.test(dp) && /CONTRATTO/.test(dp) && /art\. 106/.test(dp));
  atteso("… né il rinvio della seduta, né i termini diversi dalla presentazione (chiarimenti, sopralluogo)", /seduta di gara/.test(dp) && /chiarimenti/.test(dp) && /sopralluogo/.test(dp));
  atteso("… e nel dubbio risponde «nessuna» (il modulo a mano non compare per errore)", /non sei sicuro[^.]*rispondi 'nessuna'/.test(dp));
  atteso("il caso «rimanda al portale» è descritto per senza_nuova_data", /portale/.test(dp) && /senza_nuova_data/.test(dp));
  atteso("con più proroghe vale la più recente", /più recente/.test(P.scadenza.description));

  // ───────────────────────── 6. Controlli sul codice ─────────────────────────
  console.log("\n--- Codice: l'analisi, l'azione a mano, la scheda ---");
  const estrazione = leggi("src/app/actions/gara-extraction.ts");
  atteso("lo strumento di estrazione usa le voci della proroga", /\.\.\.PROPRIETA_SCADENZA_ESTRAZIONE/.test(estrazione));
  atteso("i documenti si ordinano per caricamento PRIMA di scegliere i PDF", /const pdfDocs = ordinaPerCaricamento\(documenti \?\? \[\]\)\.filter\(/.test(estrazione));
  atteso("i PDF vanno al modello nell'ordine dell'elenco (map sull'array ordinato) e l'elenco è nel testo", /pdfDocs\.map\(async/.test(estrazione) && /testoElencoCronologicoPerEstrazione\(pdfDocs\)/.test(estrazione));
  atteso("la scadenza salvata è quella decisa da decidiScadenza", /const decisioneScadenza = decidiScadenza\(result, scadenzaEsistente\)/.test(estrazione) && /scadenza: decisioneScadenza\.scadenza,/.test(estrazione));
  const principale = estrazione.slice(estrazione.indexOf(".update({\n        stazione_appaltante"), estrazione.indexOf("estrazione_aggiornata_il: estrazioneAggiornataIl,"));
  atteso("le colonne nuove NON stanno nell'aggiornamento principale (senza migrazione l'analisi funziona come prima)", principale.length > 100 && !/proroga_stato|scadenza_originaria|scadenza_manuale/.test(principale));
  atteso("proroga e data a mano si salvano a parte e tollerano la colonna mancante", /\.update\(\{ proroga_stato: decisioneScadenza\.proroga_stato, scadenza_originaria: decisioneScadenza\.scadenza_originaria, scadenza_manuale: decisioneScadenza\.scadenza_manuale \}\)[\s\S]{0,200}schemaAssente\(erroreProroga\)/.test(estrazione));
  atteso("la lettura della data a mano esistente tollera la colonna mancante (errore → nessuna data a mano)", /erroreScadenzaEsistente \|\| !scadenzaEsistenteRiga\s*\?\s*null/.test(estrazione));

  const azione = corpoFunzione(estrazione, "impostaScadenzaGara");
  atteso("impostaScadenzaGara esiste", azione.length > 200);
  atteso("impostaScadenzaGara parte dalla guardia dell'account e dal controllo dell'accesso", azione.indexOf("await richiediAccountAzione()") > 0 && azione.indexOf("accessoNegatoPerAccount(") > azione.indexOf("richiediAccountAzione"));
  atteso("impostaScadenzaGara non legge la sessione per conto suo", !azione.includes("auth.getUser()"));
  atteso("lo stato della proroga si legge dal DATABASE, mai dal modulo (il cliente non può dichiararlo)", /\.select\("id, proroga_stato"\)/.test(azione) && !/formData\.get\("proroga/.test(azione));
  atteso("il rifiuto per «non c'è la proroga senza data» viene PRIMA di ogni scrittura", azione.indexOf("puoModificareScadenza(gara.proroga_stato)") > 0 && azione.indexOf("puoModificareScadenza(gara.proroga_stato)") < azione.indexOf(".update("));
  atteso("la validazione della data viene PRIMA di ogni scrittura", azione.indexOf("validaScadenzaManuale(") > 0 && azione.indexOf("validaScadenzaManuale(") < azione.indexOf(".update("));
  atteso("la scrittura segna la scadenza come inserita a mano", /\.update\(\{ scadenza: esito\.scadenza, scadenza_manuale: true \}\)/.test(azione));
  atteso("la scheda della gara, l'elenco gare e la panoramica si aggiornano", (azione.match(/revalidatePath\(/g) ?? []).length === 3 && azione.includes("/dashboard/omnia-ai/gare/${garaId}") && azione.includes('"/dashboard/omnia-ai/gare"') && azione.includes('"/dashboard/omnia-ai"'));
  atteso("la scrittura passa dal client con le regole di accesso (non dal service role)", !azione.includes("createAdminClient"));

  const sezione = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/extraction-section.tsx");
  atteso("il modulo della data compare SOLO se puoModificareScadenza(proroga_stato)", /\{puoModificareScadenza\(proroga\?\.proroga_stato\) && \(\s*<ScadenzaProrogaForm/.test(sezione));
  atteso("la scheda dice «prorogata» e la scadenza originaria solo con la nuova data", /normalizzaProroga\(proroga\?\.proroga_stato\) === "con_nuova_data"[\s\S]{0,400}prorogata/.test(sezione));

  const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
  atteso("pagina gara: i documenti si leggono dal più vecchio e si ordinano con la funzione comune", /\.from\("gara_documenti"\)[\s\S]{0,200}\.order\("created_at", \{ ascending: true \}\)/.test(pagina) && /ordinaPerCaricamento\(documenti \?\? \[\]\)/.test(pagina));
  atteso("pagina gara: ogni documento mostra «Caricato il …»", /Caricato il \{testoDataCaricamento\(d\.created_at\)\}/.test(pagina));
  atteso("pagina gara: l'elenco mostrato è quello ordinato (non quello grezzo)", /documentiOrdinati\.map\(\(d\) =>/.test(pagina) && !/documenti\.map\(\(d\) =>/.test(pagina));
  atteso("pagina gara: avviso per i documenti caricati dopo l'ultima analisi", /documentiDopoUltimaAnalisi\(documentiOrdinati/.test(pagina) && /Rianalizza documenti/.test(pagina));
  atteso("pagina gara: l'avviso c'è solo se l'ultima analisi è completata (altrimenti il pulsante non è «Rianalizza»)", /documentiDopoUltimaAnalisi\(documentiOrdinati, gara\.estrazione_stato === "completata" \? gara\.estrazione_aggiornata_il : null\)/.test(pagina));
  atteso("pagina gara: lo stato della proroga si legge tollerando le colonne mancanti e arriva alla sezione", /\.select\("proroga_stato, scadenza_originaria, scadenza_manuale"\)/.test(pagina) && /proroga=\{prorogaRaw \?\? null\}/.test(pagina));

  const modulo = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/scadenza-proroga-form.tsx");
  atteso("il modulo ha data obbligatoria e ora facoltativa", /name="scadenza" required/.test(modulo) && /name="ora"/.test(modulo) && !/name="ora"[^>]*required/.test(modulo));

  const migrazione = leggi("supabase/migrations/0095_gare_proroga_scadenza.sql");
  atteso("migrazione 0095: tre colonne, tutte «if not exists» (si può rieseguire)", /add column if not exists proroga_stato text/.test(migrazione) && /add column if not exists scadenza_originaria date/.test(migrazione) && /add column if not exists scadenza_manuale boolean not null default false/.test(migrazione));
  atteso("migrazione 0095: additiva, non cancella né riscrive dati", !/\bdrop\b|\bdelete\b|\btruncate\b|\bupdate\s+public\./i.test(migrazione.replace(/--.*$/gm, "")));
  const valori = /proroga_stato in \(([^)]*)\)/.exec(migrazione)?.[1].split(",").map((v) => v.trim().replace(/'/g, "")) ?? [];
  atteso("migrazione 0095: i valori ammessi sono gli stessi del codice", uguali(valori, [...STATI_PROROGA]), valori.join("|"));
  atteso("migrazione 0095: ricarica lo schema di PostgREST", /notify pgrst, 'reload schema'/.test(migrazione));

  const registro = leggi("scripts/verifica-ufficio-gare-lavoro-omnia-ai.ts");
  atteso("impostaScadenzaGara è nel registro delle azioni dell'account (titolare e Ufficio Gare)", /"gara-extraction\.ts": \["extractGaraData", "impostaScadenzaGara"\]/.test(registro));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sono andati a buon fine.");
}

main();
