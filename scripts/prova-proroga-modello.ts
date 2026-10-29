// PROVA COL MODELLO VERO (a pagamento: pochi centesimi in tutto). NON fa parte della batteria automatica.
//
// Costruisce PDF sintetici di gare (un bando, a volte avvisi di proroga o altri avvisi), li dà al modello con lo stesso schema
// della scadenza/proroga del codice vero (PROPRIETA_SCADENZA_ESTRAZIONE), lo stesso elenco cronologico e la stessa richiesta,
// e controlla che la decisione finale (decidiScadenza) sia quella attesa: soprattutto che la «proroga tecnica» o il rinvio della
// seduta NON siano scambiati per una proroga dei termini di presentazione (il modulo a mano non deve comparire per errore) e
// che «la nuova data sarà sul portale» faccia comparire il modulo.
//
// Cosa NON fa: nessuna scrittura (niente file, niente database, niente costi registrati). Lo strumento è RIDOTTO alle voci di
// scadenza e proroga (lo strumento completo sta in src/app/actions/gara-extraction.ts e non è esportabile da un file "use
// server"): il comportamento sul resto dei campi si controlla con la prova nel browser, che passa dall'analisi vera.
//
// Uso: npx tsx scripts/prova-proroga-modello.ts [numero di ripetizioni per scenario, default 2]
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "../src/lib/anthropic";
import { calcolaCostoStimato } from "../src/lib/ai-pricing";
import { PROPRIETA_SCADENZA_ESTRAZIONE, decidiScadenza, puoModificareScadenza, type StatoProroga } from "../src/lib/gara-proroga";
import { testoElencoCronologicoPerEstrazione } from "../src/lib/gara-documenti-elenco";

process.loadEnvFile(path.join(__dirname, "..", ".env.local"));

const MODEL = "claude-sonnet-5";

type DocSintetico = { nome: string; caricato: string; testo: string };
type Scenario = { nome: string; docs: DocSintetico[]; atteso: { stato: StatoProroga; scadenza: string | null; ora?: string | null; originaria?: string | null } };

const BANDO: DocSintetico = {
  nome: "disciplinare-di-gara.pdf",
  caricato: "2026-10-01T08:00:00Z",
  testo: [
    "COMUNE DI VALLEVERDE - Stazione appaltante",
    "DISCIPLINARE DI GARA - Procedura aperta per l'affidamento del servizio di pulizia degli immobili comunali",
    "CIG 8123456AB1 - Importo a base d'asta: Euro 480.000,00",
    "Art. 12 - Termine di presentazione delle offerte",
    "Le offerte devono pervenire, a pena di esclusione, entro le ore 12:00 del giorno 10/11/2026 tramite la piattaforma telematica.",
    "Art. 13 - Apertura delle buste: la prima seduta pubblica si terra' il giorno 12/11/2026 alle ore 10:00.",
    "Art. 14 - Chiarimenti: le richieste di chiarimenti devono pervenire entro il 30/10/2026.",
    "Art. 15 - Sopralluogo: obbligatorio, da effettuare entro il 28/10/2026.",
    "Durata del contratto: 24 mesi.",
  ].join("\n"),
};

const SCENARI: Scenario[] = [
  {
    nome: "A. solo il bando",
    docs: [BANDO],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "B. proroga CON la nuova data",
    docs: [
      BANDO,
      {
        nome: "avviso-proroga.pdf",
        caricato: "2026-10-20T14:35:00Z",
        testo: ["COMUNE DI VALLEVERDE", "AVVISO DI PROROGA DEI TERMINI", "Si comunica che il termine per la presentazione delle offerte, originariamente fissato alle ore 12:00 del 10/11/2026, e' prorogato alle ore 10:00 del giorno 24/11/2026. Resta ferma ogni altra disposizione del disciplinare."].join("\n"),
      },
    ],
    atteso: { stato: "con_nuova_data", scadenza: "2026-11-24", ora: "10:00", originaria: "2026-11-10" },
  },
  {
    nome: "C. proroga SENZA la nuova data (rimanda al portale)",
    docs: [
      BANDO,
      {
        nome: "avviso-proroga-portale.pdf",
        caricato: "2026-10-20T14:35:00Z",
        testo: ["COMUNE DI VALLEVERDE", "AVVISO", "Si informa che il termine di presentazione delle offerte e' prorogato. La nuova data di scadenza e le nuove modalita' sono pubblicate sul portale telematico della stazione appaltante, sezione Gare e Appalti."].join("\n"),
      },
    ],
    atteso: { stato: "senza_nuova_data", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "D. «proroga tecnica» del contratto in corso (NON è una proroga dei termini)",
    docs: [
      {
        ...BANDO,
        testo: BANDO.testo + "\nArt. 20 - Il contratto in essere con l'attuale gestore e' prorogato in via tecnica per il tempo strettamente necessario alla conclusione della procedura, ai sensi dell'art. 106, comma 11, del D.Lgs. 50/2016 (proroga tecnica).",
      },
    ],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "E. rinvio della seduta di gara (NON è una proroga dei termini di presentazione)",
    docs: [
      BANDO,
      {
        nome: "avviso-rinvio-seduta.pdf",
        caricato: "2026-11-05T09:00:00Z",
        testo: ["COMUNE DI VALLEVERDE", "AVVISO DI RINVIO", "La prima seduta pubblica per l'apertura delle buste, prevista per il giorno 12/11/2026 alle ore 10:00, e' rinviata al giorno 16/11/2026 alle ore 15:00. Il termine di presentazione delle offerte resta invariato."].join("\n"),
      },
    ],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "F. due proroghe: vale l'ultima",
    docs: [
      BANDO,
      {
        nome: "avviso-proroga-1.pdf",
        caricato: "2026-10-20T14:35:00Z",
        testo: ["AVVISO DI PROROGA N. 1", "Il termine di presentazione delle offerte e' prorogato dalle ore 12:00 del 10/11/2026 alle ore 12:00 del 24/11/2026."].join("\n"),
      },
      {
        nome: "avviso-proroga-2.pdf",
        caricato: "2026-11-12T09:00:00Z",
        testo: ["AVVISO DI PROROGA N. 2", "Il termine di presentazione delle offerte, gia' prorogato al 24/11/2026, e' ulteriormente prorogato alle ore 12:00 del giorno 03/12/2026."].join("\n"),
      },
    ],
    atteso: { stato: "con_nuova_data", scadenza: "2026-12-03", ora: "12:00", originaria: "2026-11-10" },
  },
  {
    nome: "G. proroga del solo termine per i chiarimenti (NON è la presentazione)",
    docs: [
      BANDO,
      {
        nome: "avviso-chiarimenti.pdf",
        caricato: "2026-10-27T09:00:00Z",
        testo: ["AVVISO", "Il termine per la presentazione delle richieste di chiarimenti, fissato al 30/10/2026, e' prorogato al 03/11/2026. Il termine di presentazione delle offerte non subisce modifiche."].join("\n"),
      },
    ],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "H. proroga senza data e il bando non riporta la scadenza",
    docs: [
      {
        nome: "disciplinare-senza-data.pdf",
        caricato: "2026-10-01T08:00:00Z",
        testo: ["COMUNE DI VALLEVERDE - Stazione appaltante", "DISCIPLINARE DI GARA - servizio di pulizia", "Art. 12 - Il termine di presentazione delle offerte e' indicato sulla piattaforma telematica."].join("\n"),
      },
      {
        nome: "avviso-proroga-generico.pdf",
        caricato: "2026-10-22T09:00:00Z",
        testo: ["AVVISO", "Il termine di presentazione delle offerte e' differito. Si invitano gli operatori economici a consultare il portale per la nuova data."].join("\n"),
      },
    ],
    atteso: { stato: "senza_nuova_data", scadenza: null },
  },
];

async function creaPdf(testo: string): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let pagina = pdf.addPage([595, 842]);
  let y = 790;
  for (const riga of testo.split("\n")) {
    const parole = riga.split(" ");
    let corrente = "";
    const scrivi = (t: string) => {
      if (y < 60) { pagina = pdf.addPage([595, 842]); y = 790; }
      pagina.drawText(t, { x: 50, y, size: 10.5, font });
      y -= 16;
    };
    for (const p of parole) {
      const prova = corrente ? `${corrente} ${p}` : p;
      if (font.widthOfTextAtSize(prova, 10.5) > 495) { scrivi(corrente); corrente = p; } else corrente = prova;
    }
    scrivi(corrente);
    y -= 6;
  }
  return Buffer.from(await pdf.save()).toString("base64");
}

async function main() {
  const ripetizioni = Math.max(1, Number(process.argv[2] ?? 2));
  const anthropic = createAnthropicClient();
  const strumento: Anthropic.Tool = {
    name: "estrai_dati_gara",
    description: "Registra i dati strutturati estratti dai documenti di una gara d'appalto.",
    input_schema: {
      type: "object" as const,
      properties: {
        stazione_appaltante: { type: "string", description: "Nome del soggetto che CONDUCE la procedura di gara." },
        ...PROPRIETA_SCADENZA_ESTRAZIONE,
      },
      required: ["stazione_appaltante"],
    },
  };

  let costoTotale = 0;
  let errori = 0;
  const riepilogo: string[] = [];
  for (const scenario of SCENARI) {
    const blocchi: Anthropic.DocumentBlockParam[] = [];
    for (const d of scenario.docs) {
      blocchi.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: await creaPdf(d.testo) } });
    }
    const elenco = testoElencoCronologicoPerEstrazione(scenario.docs.map((d, i) => ({ id: String(i), nome_file: d.nome, created_at: d.caricato })));
    // i PDF vanno nello stesso ordine dell'elenco (cronologico), come nel codice vero
    const ordine = [...scenario.docs.keys()].sort((a, b) => new Date(scenario.docs[a].caricato).getTime() - new Date(scenario.docs[b].caricato).getTime());
    const blocchiOrdinati = ordine.map((i) => blocchi[i]);

    for (let k = 1; k <= ripetizioni; k++) {
      const risposta = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "disabled" },
        tools: [strumento],
        tool_choice: { type: "tool", name: "estrai_dati_gara" },
        messages: [{ role: "user", content: [...blocchiOrdinati, { type: "text", text: `Questi sono i documenti di una gara d'appalto per servizi di pulizia. Estrai i dati richiesti usando lo strumento fornito.\n\n${elenco}` }] }],
      });
      costoTotale += calcolaCostoStimato(MODEL, risposta.usage.input_tokens, risposta.usage.output_tokens) ?? 0;
      const uso = risposta.content.find((b) => b.type === "tool_use");
      if (!uso || uso.type !== "tool_use") { console.log(`FALLITO ${scenario.nome} #${k}: nessuna risposta dello strumento`); errori++; continue; }
      const grezzo = uso.input as Record<string, unknown>;
      const d = decidiScadenza(grezzo, null);
      const a = scenario.atteso;
      const problemi: string[] = [];
      if (d.proroga_stato !== a.stato) problemi.push(`stato ${d.proroga_stato} (atteso ${a.stato})`);
      if (d.scadenza !== a.scadenza) problemi.push(`scadenza ${d.scadenza} (attesa ${a.scadenza})`);
      if (a.ora !== undefined && d.scadenza_ora !== a.ora) problemi.push(`ora ${d.scadenza_ora} (attesa ${a.ora})`);
      if (a.originaria !== undefined && d.scadenza_originaria !== a.originaria) problemi.push(`originaria ${d.scadenza_originaria} (attesa ${a.originaria})`);
      const modulo = puoModificareScadenza(d.proroga_stato) ? "modulo SI" : "modulo no";
      const riga = `${problemi.length ? "FALLITO" : "ok    "} ${scenario.nome} #${k}: stato=${d.proroga_stato} scadenza=${d.scadenza} ora=${d.scadenza_ora} originaria=${d.scadenza_originaria} [${modulo}]${problemi.length ? " — " + problemi.join("; ") : ""}`;
      console.log(riga);
      if (problemi.length) { errori++; riepilogo.push(`${scenario.nome} #${k}: ${problemi.join("; ")} | grezzo: ${JSON.stringify(grezzo)}`); }
    }
  }
  console.log(`\nCosto stimato: ${costoTotale.toFixed(3)} USD`);
  if (errori > 0) {
    console.log(`\n${errori} risposte diverse dall'atteso:\n- ${riepilogo.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Tutte le risposte sono come atteso.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
