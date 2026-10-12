// Autotest dell'espansione mirata dei sotto-criteri (src/lib/espansione-mirata.ts)
// e delle garanzie sugli elementi visivi nella compressione: gratuito,
// nessuna chiamata a modelli (il modello è FINTO), gira insieme al livello 1
// (npm run verifica:livello1, quindi in prebuild).
//
// L'espansione AGGIUNGE testo: il rischio è dato d'impresa o riferimento
// inventato. Qui si prova che un ampliamento valido venga accettato e che
// ognuno dei difetti possibili — numero nuovo, riferimento nuovo, tabella o
// riquadro tolti, testo riscritto, tetto superato, crescita insufficiente —
// lo faccia rifiutare (con un secondo tentativo che riceve l'elenco dei
// problemi), che l'orchestrazione tocchi solo i blocchi giusti, e che le
// garanzie siano davvero collegate ai punti di produzione.
import fs from "fs";
import path from "path";
import {
  espandiBloccoConGaranzie,
  espandiSezioneSottoTetto,
  quotaParoleConservate,
  type FunzioneEspansione,
  type RichiestaEspansione,
} from "../src/lib/espansione-mirata";
import { calcolaBudgetSottoCriteri } from "../src/lib/sotto-criteri";
import { confrontaSubCriteri, violazioniBlocco } from "../src/lib/confronto-tagli";
import { ISTRUZIONI_ESPANSIONE_MIRATA } from "../src/lib/prompts";
import { stimaPagineContenuto } from "../src/lib/stima-pagine";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const FRASI = [
  "Il responsabile coordina le attività quotidiane presso ogni sede del servizio.",
  "Gli operatori seguono procedure scritte e aggiornate durante tutto l'anno.",
  "Ogni intervento viene registrato e riportato al referente della stazione appaltante.",
  "Le attrezzature sono controllate prima dell'avvio e sostituite se non conformi.",
  "La squadra riceve istruzioni operative chiare prima di ogni cambio di turno.",
  "Gli esiti dei controlli confluiscono in un rapporto condiviso con la committenza.",
  "I materiali di consumo sono conservati in locali dedicati e ordinati per tipologia.",
  "Le segnalazioni degli utenti vengono prese in carico e chiuse con un riscontro scritto.",
];
// Frasi tutte diverse e senza cifre: l'espansione "buona" non deve introdurre numeri.
const frasiDistinte = (n: number, seme = "x") =>
  Array.from({ length: n }, (_, i) => `${FRASI[i % FRASI.length].replace(/\.$/, "")} nel contesto ${seme}${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${"abcdefghijklmnopqrstuvwxyz"[Math.floor(i / 26) % 26]}.`);
// L'espansione "buona" aggiunge STRUTTURA (una tabella, due frasi per riga), non
// prosa: il controllo di densità rifiuta un ampliamento fatto di paragrafi.
const distinte = (n: number, seme = "x") => {
  const f = frasiDistinte(n, seme);
  const righe = ["| Attività | Controllo |", "|---|---|"];
  for (let i = 0; i < f.length; i += 2) righe.push(`| [G]${f[i]} | [G]${f[i + 1] ?? "Verifica registrata a ogni intervento."} |`);
  return righe.join("\n");
};
// Lo stesso testo, ma come paragrafi di prosa (da rifiutare).
const distinteInProsa = (n: number, seme = "x") => frasiDistinte(n, seme).join(" ");
const prosa = (n: number) => Array.from({ length: n }, (_, i) => FRASI[i % FRASI.length]).join(" ");

const FORMAT = { dimensioneCarattere: 12, interlinea: 1 };
const CHIAVE = "1.1";
const BLOCCO = [
  `## ${CHIAVE} Organigramma e qualifiche`,
  "",
  prosa(14),
  "",
  "| Ruolo | Compito |",
  "|---|---|",
  "| [G][ICONA:personale] **Responsabile** | [G]Coordina il servizio |",
  "| [G][ICONA:qualita] **Ispettore** | [G]Verifica gli interventi |",
  "",
  "[BOX:CAPITOLATO]Il responsabile garantisce il rispetto dell'art. 12 del capitolato speciale.[/BOX]",
  "",
  "- [ICONA:formazione] **Formazione** degli operatori all'ingresso in servizio.",
  "",
  "Interviene entro **30 minuti** * dalla segnalazione ricevuta.",
  "",
  "*Valori proposti da confermare con l'impresa.",
].join("\n");

const paginePartenza = stimaPagineContenuto(BLOCCO, FORMAT);
const TARGET = 1.0;
atteso("il blocco di prova parte sotto il 70% del tetto di prova", paginePartenza < TARGET * 0.7, `${paginePartenza.toFixed(2)} pagine`);

type Richieste = RichiestaEspansione[];
function modello(variante: (r: RichiestaEspansione, chiamata: number) => string | null): { espandi: FunzioneEspansione; richieste: Richieste } {
  const richieste: Richieste = [];
  return {
    richieste,
    espandi: async (r) => {
      richieste.push(r);
      return variante(r, richieste.length);
    },
  };
}
const aggiungi = (testo: string, extra: string) => `${testo}\n\n${extra}`;
const esegui = (espandi: FunzioneEspansione, blocco = BLOCCO, target = TARGET) =>
  espandiBloccoConGaranzie({
    chiave: CHIAVE,
    titoloBlocco: "1. Organizzazione",
    blocco,
    pagineTarget: target,
    sotto: { titolo: "Organigramma e qualifiche", requisito: "organigramma di commessa", punti: 10 },
    punteggioTecnico: 20,
    paroleXPagina: 450,
    formattazione: FORMAT,
    context: { userId: null, garaId: null },
    espandi,
  });

async function main() {
  // --- 1. Un ampliamento valido è accettato ---
  {
    const m = modello((r) => aggiungi(r.testo, distinte(14)));
    const e = await esegui(m.espandi);
    atteso("ampliamento valido: accettato al primo tentativo", e.esito === "espanso" && e.tentativi === 1, `${e.esito} (${e.motivo})`);
    atteso("ampliamento valido: il testo cresce e resta entro il tetto", e.pagineDopo > e.paginePrima * 1.08 && e.pagineDopo <= TARGET * 1.05, `${e.paginePrima.toFixed(2)} → ${e.pagineDopo.toFixed(2)}`);
    atteso("ampliamento valido: tabella, riquadro, icone e asterisco ancora presenti", e.testo.includes("[BOX:CAPITOLATO]") && e.testo.includes("| Ruolo | Compito |") && (e.testo.match(/\[ICONA:/g) || []).length === 3 && e.testo.includes("**30 minuti** *"));
    atteso("la richiesta al modello contiene tetto, punti e requisito", m.richieste[0].pagineTarget === TARGET && m.richieste[0].sotto?.punti === 10 && m.richieste[0].sotto?.requisito === "organigramma di commessa");
  }

  // --- 2. Ogni difetto fa rifiutare, e il secondo tentativo riceve i problemi ---
  const rifiutati: [string, (r: RichiestaEspansione) => string][] = [
    ["numero nuovo ('ogni 15 giorni')", (r) => aggiungi(r.testo, `${distinte(14)}\n\nIl controllo avviene ogni 15 giorni.`)],
    ["riferimento al capitolato nuovo", (r) => aggiungi(r.testo, `${distinte(14)}\n\nCome previsto dall'art. 99 del capitolato speciale.`)],
    ["tabella tolta", (r) => aggiungi(r.testo.replace(/\| Ruolo \| Compito \|\n\|---\|---\|\n(\|.*\|\n){2}/, ""), distinte(14))],
    ["riquadro tolto", (r) => aggiungi(r.testo.replace(/\[BOX:CAPITOLATO\].*\[\/BOX\]\n/, ""), distinte(14))],
    ["testo riscritto (poche parole di partenza conservate)", () => `## ${CHIAVE} Organigramma e qualifiche\n\n${distinte(60, "q").replace(/\b(coordina|squadra|operatori)\b/g, "altro")}`],
    ["tetto superato", (r) => aggiungi(r.testo, distinte(110))],
    ["crescita insufficiente", (r) => aggiungi(r.testo, "Una sola frase in più.")],
    // R16: l'ampliamento in prosa continua è la causa dei criteri "tutto testo" (la prosa triplicava, senza una tabella in più)
    ["ampliamento in paragrafi di prosa invece che in tabelle o elenchi", (r) => aggiungi(r.testo, distinteInProsa(14))],
    ["tre paragrafi di prosa di fila", (r) => aggiungi(r.testo, [distinteInProsa(3, "a"), distinteInProsa(3, "b"), distinteInProsa(3, "c")].join("\n\n"))],
  ];
  for (const [nome, variante] of rifiutati) {
    const m = modello((r) => variante(r));
    const e = await esegui(m.espandi);
    atteso(`rifiutato: ${nome}`, e.esito === "rifiutato" && e.testo === BLOCCO && e.tentativi === 2, `${e.esito} ${e.motivo ?? ""}`);
    atteso(`rifiutato (${nome}): il secondo tentativo riceve l'elenco dei problemi e riparte dal testo originale`, (m.richieste[1]?.correzioni?.length ?? 0) > 0 && m.richieste[1].testo === BLOCCO);
  }

  // --- 2-bis. La densità: il messaggio dice cosa fare, e tabelle ed elenchi passano ---
  {
    const prosaEsito = modello((r) => aggiungi(r.testo, distinteInProsa(14)));
    await esegui(prosaEsito.espandi);
    atteso("ampliamento in prosa: la correzione chiede tabelle, elenchi o paragrafi brevissimi", (prosaEsito.richieste[1]?.correzioni ?? []).some((c) => /tabelle|elenchi/.test(c) && /prosa/.test(c)), JSON.stringify(prosaEsito.richieste[1]?.correzioni));
    const elenco = modello((r) => aggiungi(r.testo, frasiDistinte(8, "e").map((f) => `- **Controllo:** ${f}`).join("\n")));
    const eElenco = await esegui(elenco.espandi);
    atteso("ampliamento in un elenco puntato con grassetti: accettato", eElenco.esito === "espanso", `${eElenco.esito} ${eElenco.motivo ?? ""}`);
    const breve = modello((r) => aggiungi(r.testo, `${distinte(10, "t")}\n\nIl **referente** riceve ogni **registrazione** firmata.`));
    const eBreve = await esegui(breve.espandi);
    atteso("ampliamento in tabella più un paragrafo brevissimo: accettato", eBreve.esito === "espanso", `${eBreve.esito} ${eBreve.motivo ?? ""}`);
  }

  // --- 3. Il secondo tentativo può correggere ---
  {
    const m = modello((r, n) => (n === 1 ? aggiungi(r.testo, `${distinte(14)}\n\nIl controllo avviene ogni 15 giorni.`) : aggiungi(r.testo, distinte(14))));
    const e = await esegui(m.espandi);
    atteso("primo tentativo con numero nuovo, secondo corretto: accettato", e.esito === "espanso" && e.tentativi === 2, `${e.esito} ${e.motivo ?? ""}`);
    atteso("il secondo tentativo cita il numero introdotto", (m.richieste[1].correzioni ?? []).some((c) => c.includes("15")));
  }

  // --- 4. Titolo, asterischi, modello che non risponde ---
  {
    const m = modello((r) => aggiungi(r.testo, distinte(14)).replace(`## ${CHIAVE} Organigramma e qualifiche`, `## ${CHIAVE} Titolo riscritto dal modello`));
    const e = await esegui(m.espandi);
    atteso("il titolo del sotto-criterio resta quello originale", e.esito === "espanso" && e.testo.startsWith(`## ${CHIAVE} Organigramma e qualifiche`), e.testo.split("\n")[0]);
  }
  {
    const m = modello((r) => aggiungi(r.testo, distinte(14)).replace("**30 minuti** *", "**30 minuti**"));
    const e = await esegui(m.espandi);
    atteso("l'asterisco di conferma tolto dal modello viene rimesso (ripristino dal testo di partenza)", e.esito === "espanso" && e.testo.includes("**30 minuti** *"), `${e.esito} ${e.motivo ?? ""} | ${e.testo.match(/.*30 minuti.*/)?.[0]}`);
  }
  {
    const m = modello(() => null);
    const e = await esegui(m.espandi);
    atteso("modello che non risponde: blocco invariato, non eseguito", e.esito === "non_eseguito" && e.testo === BLOCCO && m.richieste.length === 1);
  }

  // --- 5. Orchestrazione: solo i blocchi sotto l'80% del tetto, mai i tabellari ---
  {
    const CRITERI = `1. MODELLO ORGANIZZATIVO - max 20 punti
1.1 Organigramma e qualifiche - 8 punti (D)
1.2 Controlli di qualità - 8 punti (D)
1.3 Compilazione tabellare - 4 punti (T)
`;
    const budget = calcolaBudgetSottoCriteri({
      criteriValutazione: CRITERI,
      criteriRiepilogo: [{ numero: "1", titolo: "Modello organizzativo", punti_max: 20 }],
      punteggioTecnicoMax: 20,
      limitePagineTotale: 6,
      subCriteriTabellari: ["1.3"],
      formattazione: FORMAT,
    });
    atteso("orchestrazione: budget calcolato", budget !== null);
    if (budget) {
      const tetto11 = budget.sottoCriteri.find((s) => s.chiave === "1.1")!;
      const tetto12 = budget.sottoCriteri.find((s) => s.chiave === "1.2")!;
      // Blocco di prosa che occupa (secondo la stessa stima del codice) almeno `pagine`.
      const blocco = (chiave: string, titolo: string, pagine: number) => {
        let n = 1;
        let testo = "";
        do {
          testo = `## ${chiave} ${titolo}\n\n${prosa(n)}`;
          n++;
        } while (stimaPagineContenuto(testo, FORMAT) < pagine && n < 400);
        return testo;
      };
      const contenuto = [
        "# 1. Modello organizzativo",
        blocco("1.1", "Organigramma e qualifiche", tetto11.paginePreviste * 0.4),
        blocco("1.2", "Controlli di qualità", tetto12.paginePreviste * 0.9),
        "## 1.3 Compilazione tabellare\n\nCRITERIO TABELLARE - COMPILARE",
      ].join("\n");
      // una riga di tabella costa circa il doppio delle stesse parole in prosa, e porta due frasi
      const m = modello((r) => aggiungi(r.testo, distinte(Math.ceil((r.pagineTarget - r.paginePrima) * 450 / 12 / 3), "o")));
      const esito = await espandiSezioneSottoTetto({
        titoloSezione: "1. Modello organizzativo",
        contenuto,
        budget,
        criteriValutazione: CRITERI,
        punteggioTecnico: 20,
        formattazione: FORMAT,
        context: { userId: null, garaId: null },
        espandi: m.espandi,
      });
      atteso("orchestrazione: una sola chiamata, sul solo blocco sotto l'80% (1.1)", m.richieste.length >= 1 && m.richieste.every((r) => r.chiave === "1.1"), m.richieste.map((r) => r.chiave).join(","));
      atteso("orchestrazione: 1.1 espanso, 1.2 (al 90%) e il tabellare invariati", esito.esiti.length === 1 && esito.esiti[0].esito === "espanso" && esito.contenuto.includes("## 1.3 Compilazione tabellare\n\nCRITERIO TABELLARE - COMPILARE") && esito.contenuto.includes(blocco("1.2", "Controlli di qualità", tetto12.paginePreviste * 0.9)), JSON.stringify(esito.esiti.map((x) => [x.chiave, x.esito, x.motivo])));
      const limitato = modello((r) => aggiungi(r.testo, distinte(14)));
      const conTetto = await espandiSezioneSottoTetto({
        titoloSezione: "1. Modello organizzativo",
        contenuto,
        budget,
        criteriValutazione: CRITERI,
        formattazione: FORMAT,
        context: { userId: null, garaId: null },
        espandi: limitato.espandi,
        maxChiamate: 0,
      });
      atteso("orchestrazione: con il tetto alle chiamate a zero nessun blocco cambia", conTetto.contenuto === contenuto && limitato.richieste.length === 0);
    }
  }

  // --- 6. Funzioni pure ---
  atteso("parole conservate: testo identico = 100%", quotaParoleConservate(BLOCCO, BLOCCO) === 1);
  atteso("parole conservate: testo ampliato resta sopra il 90%", quotaParoleConservate(BLOCCO, aggiungi(BLOCCO, distinte(10))) >= 0.99);
  atteso("parole conservate: testo diverso sotto il 90%", quotaParoleConservate(BLOCCO, distinte(40, "z")) < 0.9);

  // --- 7. Compressione: riquadri e ultima tabella non si tolgono più ---
  {
    const prima = [{ titolo_sezione: "1", contenuto: BLOCCO }];
    const senzaBox = [{ titolo_sezione: "1", contenuto: BLOCCO.replace(/\[BOX:CAPITOLATO\].*\[\/BOX\]\n/, "") }];
    const senzaTabella = [{ titolo_sezione: "1", contenuto: BLOCCO.replace(/\| Ruolo \| Compito \|\n\|---\|---\|\n(\|.*\|\n){2}/, "") }];
    const trova = (dopo: typeof prima) => confrontaSubCriteri(prima, dopo, FORMAT, []).find((c) => c.chiave === CHIAVE)!;
    atteso("compressione: un riquadro tolto è una VIOLAZIONE (non più un avviso)", violazioniBlocco(trova(senzaBox)).violazioni.some((v) => /riquadri/.test(v)));
    atteso("compressione: l'unica tabella tolta è una VIOLAZIONE", violazioniBlocco(trova(senzaTabella)).violazioni.some((v) => /tabelle/.test(v)));
    atteso("compressione: testo identico, nessuna violazione per riquadri/tabelle", violazioniBlocco(trova(prima)).violazioni.filter((v) => /riquadri|tabelle/.test(v)).length === 0);
  }

  // --- 8. Prompt e collegamento ai punti di produzione ---
  const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
  atteso("prompt di espansione: tutti i segnaposto previsti presenti", ["{CHIAVE}", "{TITOLO}", "{REQUISITO}", "{TETTO_PAGINE}", "{TETTO_PAROLE}", "{PAGINE_ATTUALI}", "{N}", "{CORREZIONI}"].every((s) => ISTRUZIONI_ESPANSIONE_MIRATA.includes(s)));
  atteso("prompt di espansione: vieta numeri e riferimenti nuovi e chiede di conservare icone e riquadri", /nessun numero/.test(ISTRUZIONI_ESPANSIONE_MIRATA) && /nessuna citazione/.test(ISTRUZIONI_ESPANSIONE_MIRATA) && /\[ICONA/.test(ISTRUZIONI_ESPANSIONE_MIRATA) && /\[BOX/.test(ISTRUZIONI_ESPANSIONE_MIRATA));
  const chat = leggi("src/app/actions/gara-chat.ts");
  const iEspansione = chat.indexOf("espandiSezioneSottoTetto({");
  const iGenera = chat.indexOf("await generaBozzaSezione({");
  atteso("chat: l'espansione precede la generazione della bozza (quindi la verifica dati)", iEspansione > 0 && iGenera > iEspansione);
  atteso("chat: l'espansione ha un limite di tempo dall'inizio della richiesta", /LIMITE_MS_PRIMA_DELL_ESPANSIONE/.test(chat) && /inizioRichiestaMs/.test(chat));
  const relazione = leggi("src/lib/relazione-tecnica.ts");
  atteso("le icone sono assegnate dal codice in generaBozzaSezione e in componiRelazioneFinale", (relazione.match(/assegnaIconeMancanti\(/g) || []).length >= 2);
  const compressione = leggi("prompts/compressione-mirata-omnia.md");
  atteso("prompt di compressione: i riquadri non si accorciano e almeno una tabella resta", /mai il riquadro/.test(compressione) && /almeno una tabella/.test(compressione));
  const regole = leggi("prompts/regole-omnia.md");
  atteso("regole: il visivo non è più scoraggiato (R25 chiede struttura per sotto-criterio, R27 'vale il suo spazio')", /R25 — Ogni sotto-criterio ha la sua struttura visiva/.test(regole) && /R27 — Il visivo vale il suo spazio/.test(regole) && !/Non inserire un elemento visivo per decorare/.test(regole));

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} verifiche fallite`);
    process.exit(1);
  }
  console.log("\nAutotest dell'espansione mirata: tutti i casi ok.");
}

main().catch((err) => {
  console.error("Errore inatteso nell'autotest dell'espansione mirata:", err);
  process.exit(1);
});
