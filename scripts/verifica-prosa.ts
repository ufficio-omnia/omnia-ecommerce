// Autotest della densità della prosa (R16/R21/R29): gratuito, nessun modello né
// database, gira nel livello 1 (quindi in prebuild).
//
// Verificato con il modello vero che l'espansione dei sotto-criteri portava la
// prosa dal 33-48% al 73-75% del testo (15 paragrafi lunghi, nessuna tabella in
// più): qui si prova la misura della prosa, la guardia che completa le
// evidenziazioni mancanti (grassetti sui valori, ruoli, norme) senza cambiare
// una parola, e il collegamento ai punti di produzione.
import fs from "fs";
import path from "path";
import { descriviProsa, misuraProsa, misuraVisiva, PAROLE_MASSIME_PARAGRAFO } from "../src/lib/ricchezza-visiva";
import { evidenziaProsaMancante, ruoliDaOrganigramma } from "../src/lib/evidenziazione-prosa";
import { applicaGuardiaValori } from "../src/lib/valori-impresa";
import { REGOLE_OMNIA, ISTRUZIONI_ESPANSIONE_MIRATA } from "../src/lib/prompts";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
// il testo senza evidenziazioni: deve restare identico (la guardia non cambia una parola)
const senzaMarcatori = (t: string) => t.replace(/\*\*/g, "").replace(/!!/g, "");

// --- 1. Misura della prosa ---
{
  const parole = (n: number) => Array.from({ length: n }, (_, i) => `parola${i}`).join(" ");
  const testo = [
    "## 1.1 Titolo",
    "",
    "Primo paragrafo breve senza evidenze.",
    "",
    "Secondo paragrafo con un **grassetto** dentro.",
    "",
    "| A | B |",
    "|---|---|",
    "| x | y |",
    "",
    parole(80),
    "",
    "- voce di elenco **etichetta:** testo",
    "",
    "[BOX:CAPITOLATO]Il riquadro contiene un impegno che non è prosa liscia.[/BOX]",
    "",
    "[FIGURA:1]",
    "",
    "*Valori proposti da confermare.",
    "",
    "!!Ruolo!! ultimo paragrafo di prosa.",
  ].join("\n");
  const m = misuraProsa(testo);
  atteso("misura: conta solo i paragrafi di prosa (non titolo, tabella, elenco, riquadro, figura, nota)", m.paragrafi === 4, JSON.stringify(m));
  atteso("misura: paragrafi con evidenza e paragrafi lunghi", m.conEvidenza === 2 && m.lunghi === 1 && PAROLE_MASSIME_PARAGRAFO === 70, JSON.stringify(m));
  atteso("misura: i paragrafi di prosa consecutivi si contano e la tabella li interrompe", m.maxConsecutivi === 2, JSON.stringify(m));
  const dentroFigura = misuraProsa(`Testo.\n\n[FIGURA]\n{"v":1,"didascalia":"Una frase del blocco che non è prosa"}\n[/FIGURA]\n\nAltro.`);
  atteso("misura: il contenuto di un blocco figura non è prosa", dentroFigura.paragrafi === 2, JSON.stringify(dentroFigura));
  atteso("misura: la descrizione è leggibile", /prosa 4 par\./.test(descriviProsa(m, misuraVisiva(testo).parole)));
}

// --- 2. Evidenziazione dei paragrafi lisci ---
{
  const valore = evidenziaProsaMancante("Il servizio interviene entro 30 minuti dalla chiamata e ogni 2 ore ripassa le aree.");
  atteso("valori con unità in grassetto («entro 30 minuti», «ogni 2 ore»)", valore.testo === "Il servizio interviene **entro 30 minuti** dalla chiamata e **ogni 2 ore** ripassa le aree.", valore.testo);

  const ruoli = evidenziaProsaMancante("Il Responsabile di Commessa coordina il Caposquadra, che riferisce al DEC.");
  atteso("ruoli colorati con !!…!! (al massimo due per riga, la prima occorrenza)", ruoli.testo === "Il !!Responsabile di Commessa!! coordina il !!Caposquadra!!, che riferisce al DEC.", ruoli.testo);

  const norme = evidenziaProsaMancante("La procedura è conforme alla UNI EN ISO 14001 e al D.Lgs. 36/2023, come all'art. 12 del capitolato.");
  atteso("norme e riferimenti in grassetto", /\*\*UNI EN ISO 14001\*\*/.test(norme.testo) && /\*\*D\.Lgs\. 36\/2023\*\*/.test(norme.testo) && /\*\*art\. 12\*\*/.test(norme.testo), norme.testo);

  const dinamici = evidenziaProsaMancante("L'Ispettore di Zona Nord verifica le aree.", { ruoli: ["Ispettore di Zona Nord"] });
  atteso("i ruoli dell'organigramma dichiarato si evidenziano come quelli comuni", dinamici.testo === "L'!!Ispettore di Zona Nord!! verifica le aree.", dinamici.testo);
  atteso("ruoli dall'organigramma dichiarato: denominazioni con l'iniziale maiuscola", ruoliDaOrganigramma({ figura_apicale: { denominazione: "Responsabile di Servizio" }, coordinamento: [{ denominazione: "Coordinatore Zona Sud", sottolivelli: [{ denominazione: "caposquadra" }] }] }).join("|") === "Responsabile di Servizio|Coordinatore Zona Sud");

  const elenco = evidenziaProsaMancante("- Verifica ogni 2 ore delle aree comuni\n- Registrazione a fine turno");
  atteso("voce di elenco senza evidenze: il valore si evidenzia, quella senza elementi resta com'è", elenco.testo === "- Verifica **ogni 2 ore** delle aree comuni\n- Registrazione a fine turno", elenco.testo);

  // non si tocca ciò che non è prosa o è già evidenziato
  const intatti = [
    "## 1.1 Titolo entro 30 minuti",
    "| Fase | Tempo |\n|---|---|\n| Rilevazione | entro 30 minuti |",
    "[BOX:CAPITOLATO]Il Responsabile di Commessa risponde entro 30 minuti.[/BOX]",
    "[FIGURA]\n{\"didascalia\":\"entro 30 minuti con il Caposquadra\"}\n[/FIGURA]",
    "[ORGANIGRAMMA]\n{\"v\":2}\n[/ORGANIGRAMMA]",
    "*Valori proposti entro 30 minuti da confermare.",
    "Paragrafo che ha già il suo **grassetto** e intervento entro 30 minuti del Caposquadra.",
    "[FIGURA:1]",
  ].join("\n\n");
  atteso("titoli, tabelle, riquadri, figure, organigrammi, note e paragrafi già evidenziati non si toccano", evidenziaProsaMancante(intatti).testo === intatti, evidenziaProsaMancante(intatti).testo);

  const lungo = "Il Responsabile di Commessa, entro 30 minuti, coordina il Caposquadra e applica la UNI EN ISO 14001; ogni 2 ore verifica le aree e a fine turno registra tutto. Per **tre** motivi.";
  const idempotente = evidenziaProsaMancante(evidenziaProsaMancante(lungo).testo);
  atteso("idempotente: riapplicata sul proprio risultato non cambia più nulla", idempotente.evidenziazioni === 0 && idempotente.testo === evidenziaProsaMancante(lungo).testo);

  const campione = "Il Referente riceve il rapporto entro 24 ore dalla chiusura dell'intervento (cfr. art. 9) e ogni 15 giorni la sintesi.";
  const esito = evidenziaProsaMancante(campione);
  atteso("non cambia una parola: tolti i marcatori il testo è identico", senzaMarcatori(esito.testo) === campione && esito.evidenziazioni > 0, esito.testo);

  const link = evidenziaProsaMancante("Vedi https://esempio.it/entro-30-minuti oppure il [riferimento 3 ore] del capitolato.");
  atteso("link e tag fra parentesi quadre non si toccano", link.testo === "Vedi https://esempio.it/entro-30-minuti oppure il [riferimento 3 ore] del capitolato.", link.testo);

  // R9: l'asterisco di "valore proposto" resta fuori dal grassetto e la guardia dei valori continua a riconoscerlo come marcato
  const marcato = evidenziaProsaMancante("Il Servizio interviene entro 30 minuti * dalla segnalazione.");
  atteso("valore con l'asterisco R9: grassetto sul valore, asterisco fuori", /\*\*entro 30 minuti\*\* \*/.test(marcato.testo), marcato.testo);
  const guardia = applicaGuardiaValori(marcato.testo, { dipendenti: 8, uscente: [], fatti: [], testi: [] });
  atteso("R9: la guardia dei valori non aggiunge un secondo asterisco né segnala il valore come non marcato", guardia.marcati.length === 0 && guardia.nonMarcabili.length === 0 && !/\*\* \* \*|\* \*\*/.test(guardia.testo), JSON.stringify({ m: guardia.marcati.length, t: guardia.testo }));

  const misuraDopo = misuraProsa(evidenziaProsaMancante("Il Responsabile di Commessa interviene entro 30 minuti.\n\nIl Caposquadra registra ogni 2 ore.\n\nTesto senza nulla da evidenziare qui.").testo);
  atteso("dopo la guardia i paragrafi con elementi riconoscibili hanno tutti un'evidenza", misuraDopo.conEvidenza === 2 && misuraDopo.paragrafi === 3, JSON.stringify(misuraDopo));
}

// --- 3. Collegamento ai punti di produzione e alle regole ---
{
  const rel = leggi("src/lib/relazione-tecnica.ts");
  const iIcone = rel.indexOf("const conIcone = assegnaIconeMancanti");
  const iEvid = rel.indexOf("evidenziaProsaMancante(conIcone");
  const iOrg = rel.indexOf("costruisciOrganigramma(organigrammaDichiarato");
  atteso("generaBozzaSezione: le evidenziazioni vengono dopo le icone e prima di costruire organigramma e figure", iIcone > 0 && iEvid > iIcone && iOrg > iEvid);
  const finale = rel.slice(rel.indexOf("export async function componiRelazioneFinale"));
  atteso("componiRelazioneFinale: le evidenziazioni si applicano anche alle bozze già salvate, dopo le icone", /assegnaIconeMancanti\(s\.contenuto\)/.test(finale) && finale.indexOf("evidenziaProsaMancante(esito.testo)") > finale.indexOf("assegnaIconeMancanti(s.contenuto)"));

  atteso("regole: R16 con paragrafi brevi (60 parole) e mai più di due di prosa di fila", /al massimo 60 parole/.test(REGOLE_OMNIA) && /mai più di due\s+paragrafi di prosa di fila/.test(REGOLE_OMNIA));
  atteso("regole: R21 chiede almeno due evidenziazioni per paragrafo", /\*\*R21 — Ogni paragrafo ha impatto/.test(REGOLE_OMNIA) && /Almeno due evidenziazioni per paragrafo/.test(REGOLE_OMNIA));
  atteso("regole: R29 chiede il particolare (chi, cosa, quando, con cosa, dove, come si verifica) e più colonne non più prosa", /\*\*R29 — Scrivi da analista/.test(REGOLE_OMNIA) && /COME SI VERIFICA/.test(REGOLE_OMNIA) && /più colonne, più\s+righe, più figure/.test(REGOLE_OMNIA));
  atteso("espansione: il prompt chiede struttura (colonne, tabelle, elenchi) e dichiara che la lunghezza è un massimo", /IN FORMA STRUTTURATA/.test(ISTRUZIONI_ESPANSIONE_MIRATA) && /è un MASSIMO, non un obiettivo/.test(ISTRUZIONI_ESPANSIONE_MIRATA) && !/Aggiungi circa \{N\} parole/.test(ISTRUZIONI_ESPANSIONE_MIRATA));
  const esp = leggi("src/lib/espansione-mirata.ts");
  atteso("espansione: il codice rifiuta un ampliamento fatto di prosa (crescita, paragrafi lunghi, più di due di fila)", /prosa: \{ prima: misuraProsa\(blocco\), dopo: misuraProsa\(candidato\) \}/.test(esp) && /dopo\.lunghi > prima\.lunghi/.test(esp) && /dopo\.maxConsecutivi > Math\.max\(prima\.maxConsecutivi, 2\)/.test(esp));
}

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAutotest della densità della prosa: tutti i casi ok.");
