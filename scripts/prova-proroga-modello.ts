// PROVA COL MODELLO VERO (a pagamento: pochi centesimi in tutto). NON fa parte della batteria automatica.
//
// Costruisce PDF sintetici di gare (un bando, a volte avvisi, determine o un disciplinare con una clausola generale), li fa passare
// da TUTTA la pipeline di riconoscimento della proroga con il codice vero:
//   1. analisi generale (modello, schema PROPRIETA_SCADENZA_ESTRAZIONE, elenco cronologico) — con uno strumento ridotto alle voci
//      di scadenza e proroga;
//   2. secondo passaggio mirato (leggiDocumento → selezionaPassaggi → valutaSecondoPassaggio): solo le pagine che parlano di
//      proroga, valutate dal modello;
//   3. unione dei due esiti (unisciEsitiProroga) e decisione finale (decidiScadenza).
// e controlla che l'ESITO FINALE sia quello atteso: soprattutto che la «proroga tecnica», il rinvio della seduta e la clausola
// GENERALE sul malfunzionamento della piattaforma NON siano scambiati per una proroga dei termini di presentazione, e che una
// proroga scritta nel dispositivo di una determina (anche senza data) venga riconosciuta.
//
// Cosa NON fa: nessuna scrittura (niente file, niente database, niente costi registrati). Lo strumento dell'analisi generale è
// RIDOTTO (lo strumento completo sta in src/app/actions/gara-extraction.ts e non è esportabile da un file "use server"): il
// comportamento sul resto dei campi si controlla con la prova nel browser, che passa dall'analisi vera.
//
// Uso: npx tsx scripts/prova-proroga-modello.ts [ripetizioni per scenario, default 2] [filtro sul nome dello scenario]
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "../src/lib/anthropic";
import { calcolaCostoStimato } from "../src/lib/ai-pricing";
import { PROPRIETA_SCADENZA_ESTRAZIONE, decidiScadenza, puoModificareScadenza, type RisultatoScadenza, type StatoProroga } from "../src/lib/gara-proroga";
import { testoElencoCronologicoPerEstrazione } from "../src/lib/gara-documenti-elenco";
import { selezionaPassaggi, selezioneVuota, unisciEsitiProroga } from "../src/lib/gara-proroga-passaggio";
import { leggiDocumento, valutaSecondoPassaggio, type DocumentoLetto } from "../src/lib/gara-proroga-secondo-passaggio";

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

const CLAUSOLA_MALFUNZIONAMENTO =
  "Art. 16 - Malfunzionamento della piattaforma: in caso di malfunzionamento della piattaforma telematica la stazione appaltante puo' disporre la sospensione del termine per la presentazione delle offerte e la proroga dello stesso per un massimo di 48 ore, dandone comunicazione sul portale e sul sito istituzionale.";

// documenti di contorno (planimetrie e simili) per rendere l'insieme più realistico e più lungo
const CONTORNO: DocSintetico[] = Array.from({ length: 10 }, (_, i) => ({
  nome: `planimetria-${i + 1}.pdf`,
  caricato: "2026-10-02T09:00:00Z",
  testo: `PLANIMETRIA SEDE ${i + 1}\nSuperficie calpestabile: ${200 + i * 15} mq. Locali: uffici, servizi igienici, corridoi. Frequenza di pulizia: giornaliera. Orari di apertura: 8:00-18:00.`,
}));

const SCENARI: Scenario[] = [
  { nome: "A. solo il bando", docs: [BANDO], atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null } },
  {
    nome: "B. proroga CON la nuova data (avviso)",
    docs: [
      BANDO,
      { nome: "avviso-proroga.pdf", caricato: "2026-10-20T14:35:00Z", testo: ["COMUNE DI VALLEVERDE", "AVVISO DI PROROGA DEI TERMINI", "Si comunica che il termine per la presentazione delle offerte, originariamente fissato alle ore 12:00 del 10/11/2026, e' prorogato alle ore 10:00 del giorno 24/11/2026. Resta ferma ogni altra disposizione del disciplinare."].join("\n") },
    ],
    atteso: { stato: "con_nuova_data", scadenza: "2026-11-24", ora: "10:00", originaria: "2026-11-10" },
  },
  {
    nome: "C. proroga SENZA la nuova data (rimanda al portale)",
    docs: [
      BANDO,
      { nome: "avviso-proroga-portale.pdf", caricato: "2026-10-20T14:35:00Z", testo: ["COMUNE DI VALLEVERDE", "AVVISO", "Si informa che il termine di presentazione delle offerte e' prorogato. La nuova data di scadenza e le nuove modalita' sono pubblicate sul portale telematico della stazione appaltante, sezione Gare e Appalti."].join("\n") },
    ],
    atteso: { stato: "senza_nuova_data", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "D. «proroga tecnica» del contratto in corso (NON è una proroga dei termini)",
    docs: [{ ...BANDO, testo: BANDO.testo + "\nArt. 20 - Il contratto in essere con l'attuale gestore e' prorogato in via tecnica per il tempo strettamente necessario alla conclusione della procedura, ai sensi dell'art. 106, comma 11, del D.Lgs. 50/2016 (proroga tecnica)." }],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "E. rinvio della seduta di gara (NON è una proroga dei termini di presentazione)",
    docs: [
      BANDO,
      { nome: "avviso-rinvio-seduta.pdf", caricato: "2026-11-05T09:00:00Z", testo: ["COMUNE DI VALLEVERDE", "AVVISO DI RINVIO", "La prima seduta pubblica per l'apertura delle buste, prevista per il giorno 12/11/2026 alle ore 10:00, e' rinviata al giorno 16/11/2026 alle ore 15:00. Il termine di presentazione delle offerte resta invariato."].join("\n") },
    ],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "F. due proroghe: vale l'ultima",
    docs: [
      BANDO,
      { nome: "avviso-proroga-1.pdf", caricato: "2026-10-20T14:35:00Z", testo: ["AVVISO DI PROROGA N. 1", "Il termine di presentazione delle offerte e' prorogato dalle ore 12:00 del 10/11/2026 alle ore 12:00 del 24/11/2026."].join("\n") },
      { nome: "avviso-proroga-2.pdf", caricato: "2026-11-12T09:00:00Z", testo: ["AVVISO DI PROROGA N. 2", "Il termine di presentazione delle offerte, gia' prorogato al 24/11/2026, e' ulteriormente prorogato alle ore 12:00 del giorno 03/12/2026."].join("\n") },
    ],
    atteso: { stato: "con_nuova_data", scadenza: "2026-12-03", ora: "12:00", originaria: "2026-11-10" },
  },
  {
    nome: "G. proroga del solo termine per i chiarimenti (NON è la presentazione)",
    docs: [
      BANDO,
      { nome: "avviso-chiarimenti.pdf", caricato: "2026-10-27T09:00:00Z", testo: ["AVVISO", "Il termine per la presentazione delle richieste di chiarimenti, fissato al 30/10/2026, e' prorogato al 03/11/2026. Il termine di presentazione delle offerte non subisce modifiche."].join("\n") },
    ],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "H. proroga senza data e il bando non riporta la scadenza",
    docs: [
      { nome: "disciplinare-senza-data.pdf", caricato: "2026-10-01T08:00:00Z", testo: ["COMUNE DI VALLEVERDE - Stazione appaltante", "DISCIPLINARE DI GARA - servizio di pulizia", "Art. 12 - Il termine di presentazione delle offerte e' indicato sulla piattaforma telematica."].join("\n") },
      { nome: "avviso-proroga-generico.pdf", caricato: "2026-10-22T09:00:00Z", testo: ["AVVISO", "Il termine di presentazione delle offerte e' differito. Si invitano gli operatori economici a consultare il portale per la nuova data."].join("\n") },
    ],
    atteso: { stato: "senza_nuova_data", scadenza: null },
  },
  {
    nome: "I. DETERMINA con la proroga nel dispositivo, SENZA data, tra molti documenti (il caso SMAC)",
    docs: [
      { ...BANDO, testo: BANDO.testo + "\n" + CLAUSOLA_MALFUNZIONAMENTO },
      ...CONTORNO,
      { nome: "DeterminaDirigenziale_Originale_471_2026.pdf", caricato: "2026-10-20T11:00:00Z", testo: ["COMUNE DI VALLEVERDE - DETERMINA DIRIGENZIALE N. 471 DEL 20/10/2026", "Oggetto: rettifica del costo della manodopera nella procedura aperta per il servizio di pulizia.", "Premesso che con determina n. 181/2026 e' stata indetta la procedura; rilevato che il costo della manodopera indicato negli atti di gara va rettificato;", "DETERMINA", "1) di rettificare il costo della manodopera come da tabella allegata;", "2) di approvare la modifica degli atti di gara;", "3) di dare atto che l'importo a base d'asta non subisce variazioni;", "4) di pubblicare la rettifica sulla piattaforma e sul sito istituzionale;", "5) di dare atto che non vi sono oneri aggiuntivi a carico dell'ente;", "6) di disporre la proroga del termine per la presentazione delle offerte, la cui nuova scadenza sara' individuata e resa pubblica mediante gli adempimenti di rettifica del bando;", "7) di trasmettere il presente atto alla BDNCP."].join("\n") },
    ],
    atteso: { stato: "senza_nuova_data", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "J. solo la clausola GENERALE sul malfunzionamento (NON è una proroga)",
    docs: [{ ...BANDO, testo: BANDO.testo + "\n" + CLAUSOLA_MALFUNZIONAMENTO }, ...CONTORNO.slice(0, 3)],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
  {
    nome: "K. DETERMINA con la proroga e la NUOVA data",
    docs: [
      { ...BANDO, testo: BANDO.testo + "\n" + CLAUSOLA_MALFUNZIONAMENTO },
      ...CONTORNO.slice(0, 5),
      { nome: "DeterminaDirigenziale_Originale_502_2026.pdf", caricato: "2026-10-22T11:00:00Z", testo: ["COMUNE DI VALLEVERDE - DETERMINA DIRIGENZIALE N. 502 DEL 22/10/2026", "Oggetto: chiarimenti e proroga dei termini.", "DETERMINA", "1) di prendere atto dei chiarimenti pubblicati;", "2) di prorogare il termine per la presentazione delle offerte alle ore 12:00 del giorno 27/11/2026;", "3) di pubblicare il presente atto sulla piattaforma."].join("\n") },
    ],
    atteso: { stato: "con_nuova_data", scadenza: "2026-11-27", ora: "12:00", originaria: "2026-11-10" },
  },
  {
    nome: "L. DETERMINA di proroga tecnica del contratto (NON è una proroga dei termini)",
    docs: [
      BANDO,
      { nome: "DeterminaDirigenziale_Originale_388_2026.pdf", caricato: "2026-10-15T11:00:00Z", testo: ["COMUNE DI VALLEVERDE - DETERMINA DIRIGENZIALE N. 388 DEL 15/10/2026", "Oggetto: proroga tecnica del contratto di pulizia in essere.", "DETERMINA", "1) di prorogare in via tecnica il contratto in essere con l'attuale gestore fino alla conclusione della procedura di gara in corso, ai sensi dell'art. 106, comma 11, del D.Lgs. 50/2016;", "2) di impegnare la spesa necessaria."].join("\n") },
    ],
    atteso: { stato: "nessuna", scadenza: "2026-11-10", ora: "12:00", originaria: null },
  },
];

async function creaPdf(testo: string): Promise<Buffer> {
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
  return Buffer.from(await pdf.save());
}

async function main() {
  const ripetizioni = Math.max(1, Number(process.argv[2] ?? 2));
  const filtro = process.argv[3] ?? "";
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
    if (filtro && !scenario.nome.includes(filtro)) continue;
    // in ordine cronologico di caricamento, come nel codice vero
    const ordinati = [...scenario.docs].sort((a, b) => new Date(a.caricato).getTime() - new Date(b.caricato).getTime());
    const buffers = await Promise.all(ordinati.map((d) => creaPdf(d.testo)));
    const blocchi: Anthropic.DocumentBlockParam[] = buffers.map((b) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b.toString("base64") } }));
    const elenco = testoElencoCronologicoPerEstrazione(ordinati.map((d, i) => ({ id: String(i), nome_file: d.nome, created_at: d.caricato })));
    const letti: DocumentoLetto[] = await Promise.all(ordinati.map((d, i) => leggiDocumento(i + 1, d.nome, d.caricato, buffers[i])));
    const selezione = selezionaPassaggi(letti.map((l) => l.doc));

    for (let k = 1; k <= ripetizioni; k++) {
      const risposta = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "disabled" },
        tools: [strumento],
        tool_choice: { type: "tool", name: "estrai_dati_gara" },
        messages: [{ role: "user", content: [...blocchi, { type: "text", text: `Questi sono i documenti di una gara d'appalto per servizi di pulizia. Estrai i dati richiesti usando lo strumento fornito.\n\n${elenco}` }] }],
      });
      costoTotale += calcolaCostoStimato(MODEL, risposta.usage.input_tokens, risposta.usage.output_tokens) ?? 0;
      const uso = risposta.content.find((b) => b.type === "tool_use");
      if (!uso || uso.type !== "tool_use") { console.log(`FALLITO ${scenario.nome} #${k}: nessuna risposta dello strumento`); errori++; continue; }
      const generale = uso.input as RisultatoScadenza;

      let mirato: RisultatoScadenza | null = null;
      if (!selezioneVuota(selezione)) {
        const v = await valutaSecondoPassaggio({ anthropic, selezione, documenti: letti });
        costoTotale += calcolaCostoStimato(MODEL, v.inputTokens, v.outputTokens) ?? 0;
        mirato = v.esito;
      }
      const d = decidiScadenza(unisciEsitiProroga(generale, mirato), null);
      const dSoloGenerale = decidiScadenza(generale, null);
      const a = scenario.atteso;
      const problemi: string[] = [];
      if (d.proroga_stato !== a.stato) problemi.push(`stato ${d.proroga_stato} (atteso ${a.stato})`);
      if (d.scadenza !== a.scadenza) problemi.push(`scadenza ${d.scadenza} (attesa ${a.scadenza})`);
      if (a.ora !== undefined && d.scadenza_ora !== a.ora) problemi.push(`ora ${d.scadenza_ora} (attesa ${a.ora})`);
      if (a.originaria !== undefined && d.scadenza_originaria !== a.originaria) problemi.push(`originaria ${d.scadenza_originaria} (attesa ${a.originaria})`);
      const modulo = puoModificareScadenza(d.proroga_stato) ? "modulo SI" : "modulo no";
      const statoMirato = selezioneVuota(selezione) ? "— (nessuna pagina pertinente, nessuna chiamata)" : String(mirato?.proroga_termini ?? "?");
      const riga = `${problemi.length ? "FALLITO" : "ok    "} ${scenario.nome} #${k}: FINALE stato=${d.proroga_stato} scadenza=${d.scadenza} ora=${d.scadenza_ora} originaria=${d.scadenza_originaria} [${modulo}] | generale=${dSoloGenerale.proroga_stato} mirato=${statoMirato} (pagine mirate: ${selezione.passaggi.length}, PDF interi: ${selezione.pdfInteri.length})${problemi.length ? " — " + problemi.join("; ") : ""}`;
      console.log(riga);
      if (problemi.length) { errori++; riepilogo.push(`${scenario.nome} #${k}: ${problemi.join("; ")} | generale: ${JSON.stringify(generale)} | mirato: ${JSON.stringify(mirato)}`); }
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
