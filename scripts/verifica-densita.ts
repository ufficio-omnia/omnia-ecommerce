// Autotest della densità visiva (icone assegnate dal codice, misura di
// riquadri e tabelle): gratuito, nessuna chiamata a modelli, gira insieme al
// livello 1 (npm run verifica:livello1, quindi in prebuild).
//
// Verificato con il modello vero che il comportamento del modello sulle
// icone cambia nel tempo (lo stesso prompt che nell'11/09 ne produceva
// 20-36 per criterio, rigiocato oggi ne dà 0-2): il minimo lo garantisce il
// codice. Qui si prova che l'assegnazione sia pertinente, che non cambi mai
// il contenuto (tolti i tag icona il testo è identico all'originale), che sia
// idempotente, che salti ciò che non deve toccare (intestazioni, tabelle di
// soli dati, organigrammi, testi che le icone le hanno già) e che usi solo
// icone che il renderer conosce.
import fs from "fs";
import path from "path";
import { ICONE_MINIME_PER_1000_PAROLE, analizzaDensita, assegnaIconeMancanti, sceltaIcona } from "../src/lib/densita-visiva";
import { misuraVisiva } from "../src/lib/ricchezza-visiva";
import { NOMI_ICONE } from "../src/lib/icons";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const senzaIcone = (t: string) => t.replace(/\[ICONA:[a-zA-Z]+\] ?/g, "");

// --- 1. Scelta dell'icona ---
const SCELTE: [string, string | null][] = [
  ["Detergenti multiuso e sgrassanti", "pulizia"],
  ["Raccolta differenziata dei rifiuti", "ambiente"],
  ["Formazione annuale degli operatori", "formazione"],
  ["Verifica DPI mensile", "sicurezza"],
  ["Certificazione ISO 14001", "certificazione"],
  ["Lavasciuga e aspirapolvere professionali", "attrezzature"],
  ["Reperibilità H24 per le emergenze", "tempistiche"],
  ["Orari di apertura e frequenze di intervento", "tempistiche"],
  ["Schede tecniche e manuali d'uso", "documentazione"],
  ["Riga senza alcuna parola riconoscibile qui", null],
  ["Qualità del servizio e autoverifica", "qualita"],
];
for (const [etichetta, previsto] of SCELTE) {
  const nome = sceltaIcona(etichetta);
  atteso(`icona per "${etichetta}": ${previsto ?? "nessuna"}`, nome === previsto, `ottenuta ${nome}`);
}
atteso("il solo contesto della riga non basta a scegliere un'icona", sceltaIcona("Riga qualunque", "detergenti pulizia sanitari") === null);
atteso("le sigle corte valgono solo come parola intera ('cam' non in 'campionamento')", sceltaIcona("Campionamento casuale dei locali") !== "ambiente");

// --- 2. Assegnazione su un testo realistico ---
const TESTO = [
  "## 3.1 Prodotti di pulizia",
  "",
  "MARIO ROSSI si impegna a utilizzare prodotti conformi ai criteri ambientali minimi in tutte le sedi del servizio, con verifica periodica della conformità delle schede tecniche aggiornate.",
  "",
  "[TABELLA:AMBIENTE]",
  "| Categoria di prodotto | Quota | Note |",
  "|---|---|---|",
  "| [G]**Detergenti multiuso e sgrassanti** | [C]**70%\\*** | [G]Schede tecniche |",
  "| [G]**Servizi igienici e sanitari** | [C]65% | [G]Ecolabel |",
  "| [RIGA:AMBIENTE][C]Raccolta differenziata dei rifiuti | [C]100% | [G]Piano rifiuti |",
  "",
  "- **Formazione annuale** degli operatori sulle corrette diluizioni dei prodotti.",
  "- **Dosaggio centralizzato:** stazioni di diluizione automatica.",
  "  - Sottovoce non toccata zzz yyy qqq.",
  "",
  "| Anno | Valore |",
  "|---|---|",
  "| 2024 | 12 |",
  "| 2025 | 14 |",
  "",
  "[ORGANIGRAMMA]",
  "Responsabile di Commessa {LIVELLO:Governo}",
  "  - Caposquadra Polo Centro",
  "[/ORGANIGRAMMA]",
].join("\n");

const r = assegnaIconeMancanti(TESTO);
atteso("il testo senza icone viene completato", r.aggiunte >= 4 && !r.saltato, `aggiunte ${r.aggiunte}`);
atteso("tolti i tag icona il testo è IDENTICO all'originale (contenuto mai alterato)", senzaIcone(r.testo) === TESTO, "il contenuto è cambiato");
const righe = r.testo.split("\n");
const riga = (inizio: string) => righe.find((x) => x.includes(inizio)) ?? "";
atteso("l'intestazione della tabella non riceve icona", !riga("Categoria di prodotto").includes("[ICONA:"));
atteso("riga di tabella: icona dopo i tag di allineamento", riga("Detergenti multiuso").includes("[G][ICONA:pulizia] **Detergenti"), riga("Detergenti multiuso"));
atteso("riga di tabella con tag di riga: icona dopo [RIGA][C]", riga("Raccolta differenziata").includes("[RIGA:AMBIENTE][C][ICONA:ambiente] Raccolta"), riga("Raccolta differenziata"));
atteso("voce di elenco: icona dopo il trattino", riga("Formazione annuale").startsWith("- [ICONA:formazione] **Formazione annuale**"), riga("Formazione annuale"));
atteso("la tabella di soli dati non riceve icone", !riga("| 2024").includes("[ICONA:") && !riga("| 2025").includes("[ICONA:"));
atteso("l'organigramma non riceve icone", !riga("Caposquadra Polo Centro").includes("[ICONA:") && !riga("Responsabile di Commessa").includes("[ICONA:"));
atteso("una voce senza radice riconoscibile resta senza icona", !riga("Sottovoce non toccata").includes("[ICONA:"));
atteso("gli asterischi di conferma restano com'erano", riga("Detergenti multiuso").includes("[C]**70%\\***"));
const nomiUsati = [...r.testo.matchAll(/\[ICONA:([a-zA-Z]+)\]/g)].map((m) => m[1]);
atteso("solo icone che il renderer conosce", nomiUsati.length > 0 && nomiUsati.every((n) => NOMI_ICONE.includes(n)), nomiUsati.join(","));

// --- 3. Idempotenza e soglia ---
const secondo = assegnaIconeMancanti(r.testo);
atteso("riapplicare non cambia più nulla (idempotente)", secondo.testo === r.testo);
const GIA_RICCO = ["## 3.2 Riduzione consumi", "", "Testo breve di prova con alcune parole.", "", "- [ICONA:ambiente] **Macchinari a basso consumo** per l'esecuzione.", "- [ICONA:formazione] **Formazione annuale** degli operatori.", "- Voce senza icona sulla verifica mensile dei consumi."].join("\n");
const ricco = assegnaIconeMancanti(GIA_RICCO);
atteso("un testo che le icone le ha già non viene toccato", ricco.saltato && ricco.testo === GIA_RICCO, `densità ${(misuraVisiva(GIA_RICCO).icone / misuraVisiva(GIA_RICCO).parole) * 1000}`);
atteso("testo vuoto: nessun errore", assegnaIconeMancanti("").aggiunte === 0);

// --- 4. Misura e analisi per sotto-criterio ---
const lungo = (n: number) => Array.from({ length: n }, () => "parola").join(" ");
const DUE_BLOCCHI = [
  "# 3. Gestione CAM",
  "## 3.1 Prodotti",
  lungo(150),
  "",
  "[BOX:AMBIENTE]Impegno chiave del sotto-criterio.[/BOX]",
  "",
  "| A | B |",
  "|---|---|",
  "| x | y |",
  "## 3.2 Consumi",
  lungo(150),
  "## 3.3 Solo dicitura",
  "CRITERIO TABELLARE - COMPILARE",
].join("\n");
const d = analizzaDensita(DUE_BLOCCHI);
atteso("analisi: 2 sotto-criteri discorsivi (la dicitura tabellare è esclusa)", d.blocchi.length === 2, String(d.blocchi.length));
atteso("analisi: 3.1 ha riquadro e tabella, 3.2 no", !d.blocchi[0].mancaRiquadro && !d.blocchi[0].mancaTabella && d.blocchi[1].mancaRiquadro && d.blocchi[1].mancaTabella);
atteso("analisi: senza icone la densità è sotto soglia", d.sottoSogliaIcone && d.icone1000 === 0);
const m = misuraVisiva(DUE_BLOCCHI);
atteso("misura: parole leggibili senza tag né separatori", m.parole > 300 && m.parole < 330, String(m.parole));
atteso("misura: riquadri, tabelle, righe di tabella", m.riquadri === 1 && m.tabelle === 1 && m.righeTabella === 2, JSON.stringify(m));

// --- 5. Sul riferimento anonimizzato (se presente) ---
const percorsoFixture = path.join(__dirname, "..", "test", "fixtures", "relazione-riferimento.json");
if (fs.existsSync(percorsoFixture)) {
  const fixture = JSON.parse(fs.readFileSync(percorsoFixture, "utf-8")) as { sezioni: { titolo_sezione: string; contenuto: string }[] };
  let aggiunteTotali = 0;
  let tuttoPreservato = true;
  let idempotente = true;
  for (const s of fixture.sezioni) {
    const esito = assegnaIconeMancanti(s.contenuto);
    aggiunteTotali += esito.aggiunte;
    if (senzaIcone(esito.testo) !== senzaIcone(s.contenuto)) tuttoPreservato = false;
    if (assegnaIconeMancanti(esito.testo).testo !== esito.testo) idempotente = false;
  }
  atteso(`riferimento anonimizzato: contenuto sempre preservato (${aggiunteTotali} icone aggiunte in ${fixture.sezioni.length} sezioni)`, tuttoPreservato);
  atteso("riferimento anonimizzato: idempotente", idempotente);
} else {
  console.log("(riferimento anonimizzato assente: caso saltato)");
}

atteso(`soglia documentata: ${ICONE_MINIME_PER_1000_PAROLE} icone ogni 1000 parole`, ICONE_MINIME_PER_1000_PAROLE > 0 && ICONE_MINIME_PER_1000_PAROLE < 17);

if (fallimenti.length > 0) {
  console.log(`\n${fallimenti.length} verifiche fallite`);
  process.exit(1);
}
console.log("\nAutotest della densità visiva: tutti i casi ok.");
