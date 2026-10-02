// Prova GRATUITA (nessuna chiamata al modello, nessun DB) del budget di pagine
// per sotto-criterio (src/lib/sotto-criteri.ts): lettura dei sotto-criteri dal
// testo del disciplinare e ripartizione delle pagine.
//
// Il testo qui sotto è SINTETICO ma ha la stessa struttura di un disciplinare
// reale che ha messo in luce due difetti: i punti sono assegnati solo al
// criterio (i sotto-criteri sono un elenco senza punti, salvo il criterio 4,
// che usa la dicitura "max N punti"), e tre criteri su sette — il 35% dei
// punti — sono interamente tabellari. Con quel testo il budget per
// sotto-criterio non si attivava affatto e le pagine dei criteri tabellari
// venivano riservate e non usate: una relazione con limite 50 si fermava a
// 23 pagine generate criterio per criterio.
import { calcolaBudgetSottoCriteri, formattaBudgetPerPrompt, parseSottoCriteri } from "../src/lib/sotto-criteri";
import { estraiRequisitiDaCriteri } from "../src/lib/confronto-tagli";

const CRITERI_SENZA_PUNTI_PER_SOTTO_CRITERIO = `CRITERI DI VALUTAZIONE OFFERTA TECNICA (max 80 punti). Metodo: D=discrezionale, T=tabellare.

1. ORGANIZZAZIONE DEL SERVIZIO - max 30 punti (D)
1.1 Modalità di organizzazione del servizio
1.2 Metodologia di svolgimento del servizio presso le aree critiche (con schede tecniche dei prodotti utilizzati)
1.3 Metodologia di svolgimento del servizio presso l'area di emergenza
1.4 Modalità di erogazione del servizio in caso di trasferimento
1.5 Struttura logistica
1.6 Sistema informativo per pianificazione e gestione delle attività

2. VERIFICHE E CONTROLLI - max 8 punti (D)
2.1 Procedure di auto verifica, azioni correttive e/o preventive
2.2 Controllo di risultato
2.5 volte il valore atteso per ciascuna fascia, come da nota

3. FORMAZIONE DEL PERSONALE - max 4 punti (D)
3.1 Programma formativo

4. MACCHINARI E ATTREZZATURE - max 10 punti totali
4.1 Macchinari e attrezzature - max 6 punti (D) - con schede tecniche da produrre nel campo dedicato
4.2 Consumi energetici - max 4 punti (T) - Il punteggio dipende dalla percentuale di macchine dotate di sistemi di controllo. Fasce: a) X < 50%; b) X ≥ 50% (SI/NO per ciascuna fascia). Da produrre schede tecniche.

5. MISURE AMBIENTALI - max 9 punti totali (T)
5.1 Registrazione ambientale - Possesso della registrazione (SI/NO). Da produrre copia con dichiarazione di autenticità.
5.2 Imballaggi in plastica - Punteggio in base ai detergenti con imballaggi riciclati. Fasce: X<30%; 30%≤X<50%; X>80% (SI/NO per ciascuna fascia).
5.3 Elementi tessili - Uso esclusivo di elementi in microfibra con marchio ambientale (SI/NO).

6. CERTIFICAZIONI - max 6 punti totali (T)
6.1 Salute e sicurezza - Possesso certificazione (SI/NO).
6.2 Responsabilità sociale - Possesso certificato (SI/NO).
6.3 Qualità del servizio - Possesso certificato (SI/NO).

7. CLAUSOLA SOCIALE - max 13 punti totali (T)
7.1 Stabilità occupazionale - Punteggio attribuito in base alla percentuale di reimpiego. Fasce: X≤80%; 80<X≤85; X=100. Non si applica la riparametrazione, 2.5 volte il valore base.
7.2 Parità di genere - Possesso certificazione (SI/NO).

Documenti da presentare con l'offerta tecnica: Relazione tecnica (max 50 facciate).
`;

const RIEPILOGO = [
  { numero: "1", titolo: "Organizzazione del servizio", punti_max: 30 },
  { numero: "2", titolo: "Verifiche e controlli", punti_max: 8 },
  { numero: "3", titolo: "Formazione del personale", punti_max: 4 },
  { numero: "4", titolo: "Macchinari e attrezzature", punti_max: 10 },
  { numero: "5", titolo: "Misure ambientali", punti_max: 9 },
  { numero: "6", titolo: "Certificazioni", punti_max: 6 },
  { numero: "7", titolo: "Clausola sociale", punti_max: 13 },
];
const TABELLARI = ["4.2", "5.1", "5.2", "5.3", "6.1", "6.2", "6.3", "7.1", "7.2"];
const FORMATTAZIONE = { dimensioneCarattere: 11, interlinea: 1.5 };

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

// 1. Lettura dei sotto-criteri
const letti = parseSottoCriteri(CRITERI_SENZA_PUNTI_PER_SOTTO_CRITERIO, TABELLARI);
const chiavi = letti.map((s) => s.chiave);
atteso("lettura: tutti i 19 sotto-criteri del disciplinare riconosciuti", letti.length === 19, `trovati ${letti.length}: ${chiavi.join(", ")}`);
const s41 = letti.find((s) => s.chiave === "4.1");
const s42 = letti.find((s) => s.chiave === "4.2");
atteso("lettura: 'max 6 punti' riconosciuto come punti espliciti (4.1)", !!s41 && s41.puntiEspliciti && s41.punti === 6, JSON.stringify(s41));
atteso("lettura: 'max 4 punti (T)' riconosciuto, tabellare (4.2)", !!s42 && s42.puntiEspliciti && s42.punti === 4 && s42.tabellare, JSON.stringify(s42));
const s11 = letti.find((s) => s.chiave === "1.1");
atteso("lettura: sotto-criterio senza punti propri riconosciuto (1.1)", !!s11 && !s11.puntiEspliciti && s11.titolo === "Modalità di organizzazione del servizio", JSON.stringify(s11));
atteso("lettura: i sotto-criteri della lista tabellare sono marcati tabellari", ["5.1", "5.2", "5.3", "6.1", "6.2", "6.3", "7.1", "7.2"].every((c) => letti.find((s) => s.chiave === c)?.tabellare), "");
atteso("lettura: nessun sotto-criterio non tabellare marcato tabellare per errore", letti.filter((s) => s.tabellare).length === 9, `tabellari: ${letti.filter((s) => s.tabellare).map((s) => s.chiave).join(", ")}`);
const s12 = letti.find((s) => s.chiave === "1.2");
atteso("lettura: il titolo non include la parentesi descrittiva (1.2)", s12?.titolo === "Metodologia di svolgimento del servizio presso le aree critiche" && /schede tecniche/.test(s12.requisito), JSON.stringify(s12));
atteso("lettura: '2.5 volte il valore' dentro una descrizione non è un sotto-criterio", !chiavi.includes("2.5"), chiavi.join(", "));

// 2. Ripartizione
const budget = calcolaBudgetSottoCriteri({
  criteriValutazione: CRITERI_SENZA_PUNTI_PER_SOTTO_CRITERIO,
  criteriRiepilogo: RIEPILOGO,
  punteggioTecnicoMax: 80,
  limitePagineTotale: 50,
  subCriteriTabellari: TABELLARI,
  formattazione: FORMATTAZIONE,
});
atteso("budget: calcolato (non null) con questa struttura di disciplinare", budget !== null, "");
if (!budget) {
  console.log(`\n${fallimenti.length} verifiche fallite`);
  process.exit(1);
}
const pagineCriterio = (n: string) => budget.pagineCriterio.get(n) ?? 0;
const totale = [...budget.pagineCriterio.values()].reduce((t, p) => t + p, 0);
atteso("budget: la somma delle pagine dei criteri coincide con il limite con margine (nessuna pagina persa)", Math.abs(totale - budget.limiteConMargine) < 0.05, `somma ${totale.toFixed(2)} vs ${budget.limiteConMargine.toFixed(2)}`);
const quotaNominaleCriterio1 = (30 / 80) * budget.limiteConMargine;
atteso("budget: il criterio 1 (30 punti, tutto prosa) riceve molto più della quota nominale", pagineCriterio("1") > quotaNominaleCriterio1 * 1.4, `criterio 1: ${pagineCriterio("1").toFixed(1)} pagine, quota nominale ${quotaNominaleCriterio1.toFixed(1)}`);
atteso("budget: i criteri interamente tabellari (5, 6, 7) restano sotto 1,5 pagine ciascuno", ["5", "6", "7"].every((n) => pagineCriterio(n) < 1.5), `5: ${pagineCriterio("5").toFixed(2)}, 6: ${pagineCriterio("6").toFixed(2)}, 7: ${pagineCriterio("7").toFixed(2)}`);
const pagine1x = budget.sottoCriteri.filter((s) => s.criterio === "1").map((s) => s.paginePreviste);
atteso("budget: i sotto-criteri senza punti propri dividono il criterio in parti uguali (1.1-1.6)", pagine1x.length === 6 && Math.max(...pagine1x) - Math.min(...pagine1x) < 0.001, pagine1x.map((p) => p.toFixed(2)).join(", "));
const p41 = budget.sottoCriteri.find((s) => s.chiave === "4.1")!;
const p11 = budget.sottoCriteri.find((s) => s.chiave === "1.1")!;
atteso("budget: i punti espliciti pesano come tali (4.1 con 6 punti vs 1.1 con 5)", Math.abs(p41.paginePreviste / p11.paginePreviste - 6 / 5) < 0.01, `${p41.paginePreviste.toFixed(2)} / ${p11.paginePreviste.toFixed(2)}`);
atteso("budget: i sotto-criteri tabellari costano solo il loro ingombro (< 0,5 pagine)", budget.sottoCriteri.filter((s) => s.tabellare).every((s) => s.paginePreviste < 0.5), "");
const prosaTotale = budget.sottoCriteri.filter((s) => !s.tabellare).reduce((t, s) => t + s.paginePreviste, 0);
atteso("budget: la prosa usa quasi tutto il limite (almeno il 90%)", prosaTotale > budget.limiteConMargine * 0.9, `${prosaTotale.toFixed(1)} su ${budget.limiteConMargine.toFixed(1)}`);

const prompt = formattaBudgetPerPrompt(budget, new Map(RIEPILOGO.map((c) => [c.numero, c.titolo])));
atteso("prompt: nessun NaN/undefined e avviso sui punti ripartiti", !/NaN|undefined/.test(prompt) && /non ai singoli sotto-criteri/.test(prompt), "");

// 3. Formato storico ("- N punti" su ogni sotto-criterio): invariato
const STORICO = `1. MODELLO - max 20 punti
1.1 Organigramma e qualifiche (adeguatezza struttura) - 10 punti (D)
1.2 Reperibilità - 5 punti (D)
2. ALTRO - max 5 punti
2.1 Controlli - 5 punti (D)
`;
const budgetStorico = calcolaBudgetSottoCriteri({
  criteriValutazione: STORICO,
  criteriRiepilogo: [{ numero: "1", titolo: "Modello", punti_max: 20 }, { numero: "2", titolo: "Altro", punti_max: 5 }],
  punteggioTecnicoMax: 25,
  limitePagineTotale: 20,
  subCriteriTabellari: null,
  formattazione: {},
});
const s10 = budgetStorico?.sottoCriteri.find((s) => s.chiave === "1.1");
const s15 = budgetStorico?.sottoCriteri.find((s) => s.chiave === "1.2");
atteso("formato storico: '- N punti' ancora letto e ripartito in proporzione ai punti", !!s10 && !!s15 && s10.puntiEspliciti && Math.abs(s10.paginePreviste / s15.paginePreviste - 2) < 0.01, JSON.stringify([s10?.paginePreviste, s15?.paginePreviste]));
atteso("formato storico: 'fino a N punti' riconosciuto come 'max N punti'", parseSottoCriteri("1.1 Titolo - fino a 7 punti (D)")[0]?.punti === 7, "");

// 4. Un criterio del riepilogo senza nessun sotto-criterio conserva la sua quota
const budgetConBuco = calcolaBudgetSottoCriteri({
  criteriValutazione: STORICO,
  criteriRiepilogo: [
    { numero: "1", titolo: "Modello", punti_max: 20 },
    { numero: "2", titolo: "Altro", punti_max: 5 },
    { numero: "3", titolo: "Senza elenco", punti_max: 25 },
  ],
  punteggioTecnicoMax: 50,
  limitePagineTotale: 20,
  subCriteriTabellari: null,
  formattazione: {},
});
const totaleConBuco = budgetConBuco ? [...budgetConBuco.pagineCriterio.values()].reduce((t, p) => t + p, 0) : 0;
atteso(
  "criterio senza sotto-criteri riconosciuti: riceve la quota nominale e il totale resta il limite",
  !!budgetConBuco && Math.abs((budgetConBuco.pagineCriterio.get("3") ?? 0) - (25 / 50) * budgetConBuco.limiteConMargine) < 0.01 && Math.abs(totaleConBuco - budgetConBuco.limiteConMargine) < 0.05,
  `criterio 3: ${budgetConBuco?.pagineCriterio.get("3")?.toFixed(2)}, totale ${totaleConBuco.toFixed(2)}`,
);

// 5. Un "N.N" che non appartiene a nessun criterio del riepilogo è scartato
const conRumore = calcolaBudgetSottoCriteri({
  criteriValutazione: `${STORICO}9.9 Qualcosa che sembra un sotto-criterio\n`,
  criteriRiepilogo: [{ numero: "1", titolo: "Modello", punti_max: 20 }, { numero: "2", titolo: "Altro", punti_max: 5 }],
  punteggioTecnicoMax: 25,
  limitePagineTotale: 20,
  subCriteriTabellari: null,
  formattazione: {},
});
atteso("rumore: un 'N.N' di un criterio inesistente non entra nel budget", !!conRumore && !conRumore.sottoCriteri.some((s) => s.chiave === "9.9"), "");

// 6. Nessun sotto-criterio riconoscibile: null, come prima
atteso("testo senza sotto-criteri: nessun budget (ricade sul budget per criterio)", calcolaBudgetSottoCriteri({ criteriValutazione: "Qualità del servizio, organizzazione.", criteriRiepilogo: RIEPILOGO, punteggioTecnicoMax: 80, limitePagineTotale: 50, subCriteriTabellari: null }) === null, "");

// 7. Requisiti per i controlli sul taglio: anche con "max" e senza punti propri
const requisiti = estraiRequisitiDaCriteri(CRITERI_SENZA_PUNTI_PER_SOTTO_CRITERIO);
const chiaviRequisiti = requisiti.map((r) => r.chiave);
atteso("requisiti: riconosciuti sia i sotto-criteri senza punti sia quelli con 'max N punti'", ["1.1", "1.6", "2.2", "3.1", "4.1", "4.2"].every((c) => chiaviRequisiti.includes(c)), chiaviRequisiti.join(", "));
atteso("requisiti: un '2.5 volte' in una descrizione non diventa un requisito", !chiaviRequisiti.includes("2.5"), chiaviRequisiti.join(", "));

if (fallimenti.length > 0) {
  console.log(`\n${fallimenti.length} verifiche fallite`);
  process.exit(1);
}
console.log("\nAutotest del budget per sotto-criterio: tutti i casi ok.");
