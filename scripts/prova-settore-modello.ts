// PROVA COL MODELLO VERO (a pagamento: pochi centesimi in tutto). NON fa parte della batteria automatica.
//
// Costruisce PDF sintetici di gare di vari generi (pulizie, ristorazione collettiva, verde, vigilanza, igiene urbana, multi-servizio, oggetto non
// chiaro), li fa leggere al modello con lo STESSO schema dell'analisi (PROPRIETA_SETTORE_ESTRAZIONE, campo obbligatorio) e controlla il settore
// scelto: l'oggetto principale decide, i servizi accessori non contano, nel dubbio «altro».
//
// Cosa NON fa: nessuna scrittura (niente file, niente database, niente costi registrati). Lo strumento è RIDOTTO a stazione appaltante + settore (lo
// strumento completo sta in src/app/actions/gara-extraction.ts e non è esportabile da un file "use server").
//
// Uso: npx tsx scripts/prova-settore-modello.ts [ripetizioni per scenario, default 3] [filtro sul nome dello scenario]
import path from "path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "../src/lib/anthropic";
import { calcolaCostoStimato } from "../src/lib/ai-pricing";
import { PROPRIETA_SETTORE_ESTRAZIONE, normalizzaSettore, proponeFoodMenu, proponePianoLavoro, type Settore } from "../src/lib/gara-settore";

process.loadEnvFile(path.join(__dirname, "..", ".env.local"));

const MODEL = "claude-sonnet-5";

type Doc = { nome: string; testo: string };
type Scenario = { nome: string; docs: Doc[]; atteso: Settore };

const intestazione = (ente: string, oggetto: string, cpv: string, importo: string) =>
  [`${ente} - Stazione appaltante`, `DISCIPLINARE DI GARA - Procedura aperta per l'affidamento del ${oggetto}`, `CIG 8123456AB1 - CPV ${cpv} - Importo a base d'asta: Euro ${importo}`].join("\n");

const CONTORNO: Doc[] = Array.from({ length: 10 }, (_, i) => ({
  nome: `allegato-${i + 1}.pdf`,
  testo: `ALLEGATO ${i + 1} - DUVRI e modulistica\nIl presente allegato contiene la modulistica per la partecipazione, le dichiarazioni sostitutive, il DUVRI e le indicazioni sulla sicurezza. Sede di riferimento ${i + 1}. Orari di apertura 8:00-18:00.`,
}));

const SCENARI: Scenario[] = [
  {
    nome: "A. pulizia degli uffici comunali",
    docs: [{ nome: "disciplinare.pdf", testo: intestazione("COMUNE DI VALLEVERDE", "servizio di pulizia degli immobili comunali (uffici, biblioteca, palestra)", "90911200-8", "480.000,00") + "\nIl servizio comprende la pulizia ordinaria giornaliera, la sanificazione dei servizi igienici e la pulizia straordinaria dei vetri. Superfici: 6.200 mq." }],
    atteso: "pulizie",
  },
  {
    nome: "B. pulizia e sanificazione ospedaliera",
    docs: [{ nome: "capitolato.pdf", testo: intestazione("AZIENDA SANITARIA PROVINCIALE", "servizio di pulizia e sanificazione dei presidi ospedalieri e territoriali", "90911200-8", "3.200.000,00") + "\nIl servizio comprende la pulizia e la disinfezione di reparti, sale operatorie, ambulatori e aree comuni, la sanificazione ambientale e la gestione dei materiali di consumo." }],
    atteso: "pulizie",
  },
  {
    nome: "C. refezione scolastica",
    docs: [{ nome: "disciplinare.pdf", testo: intestazione("COMUNE DI VALLEVERDE", "servizio di refezione scolastica per le scuole dell'infanzia e primarie", "55524000-9", "1.150.000,00") + "\nIl servizio comprende la preparazione, il confezionamento, il trasporto e la somministrazione dei pasti presso i refettori, con menu stagionali approvati dall'ASL, diete speciali e rispetto dei CAM per la ristorazione collettiva." }],
    atteso: "ristorazione_collettiva",
  },
  {
    nome: "D. mensa ospedaliera con pulizia dei locali cucina (accessorio)",
    docs: [{ nome: "capitolato.pdf", testo: intestazione("AZIENDA OSPEDALIERA", "servizio di ristorazione ospedaliera per degenti e dipendenti", "55523100-3", "2.700.000,00") + "\nIl servizio comprende la preparazione e la distribuzione dei pasti ai degenti, il servizio mensa per il personale e, come servizio accessorio, la pulizia e la sanificazione dei locali cucina e dei refettori." }],
    atteso: "ristorazione_collettiva",
  },
  {
    nome: "E. manutenzione del verde (cita la pulizia delle aree verdi)",
    docs: [{ nome: "disciplinare.pdf", testo: intestazione("COMUNE DI VALLEVERDE", "servizio di manutenzione del verde pubblico", "77310000-6", "390.000,00") + "\nIl servizio comprende lo sfalcio, la potatura, la cura delle aiuole e la pulizia delle aree verdi e dei viali dalla fogliame e dai rifiuti." }],
    atteso: "altro",
  },
  {
    nome: "F. vigilanza e portierato (cita la pulizia dei locali portineria)",
    docs: [{ nome: "disciplinare.pdf", testo: intestazione("UNIVERSITA' DEGLI STUDI", "servizio di vigilanza e portierato delle sedi universitarie", "79710000-4", "620.000,00") + "\nIl servizio comprende la vigilanza armata notturna, il portierato diurno, la gestione degli accessi e il mantenimento in ordine e pulizia dei locali di portineria." }],
    atteso: "altro",
  },
  {
    nome: "G. igiene urbana: spazzamento stradale e raccolta rifiuti",
    docs: [{ nome: "capitolato.pdf", testo: intestazione("COMUNE DI VALLEVERDE", "servizio di igiene urbana: spazzamento e pulizia delle strade e raccolta dei rifiuti urbani", "90610000-6", "5.400.000,00") + "\nIl servizio comprende lo spazzamento meccanizzato e manuale delle strade, lo svuotamento dei cestini, la raccolta differenziata porta a porta e la pulizia delle aree di mercato." }],
    atteso: "altro",
  },
  {
    nome: "H. facility management: pulizie, ristorazione e manutenzione con peso simile",
    docs: [{ nome: "disciplinare.pdf", testo: intestazione("REGIONE", "servizio integrato di facility management delle sedi regionali", "79993100-3", "9.000.000,00") + "\nLotto unico. Il servizio integrato comprende: pulizia degli uffici (Euro 3.000.000), servizio mensa e bar interno (Euro 3.000.000), manutenzione degli impianti e degli edifici (Euro 3.000.000)." }],
    atteso: "altro",
  },
  {
    nome: "I. pulizia come oggetto principale con un bar interno accessorio",
    docs: [{ nome: "disciplinare.pdf", testo: intestazione("COMUNE DI VALLEVERDE", "servizio di pulizia degli uffici giudiziari", "90911200-8", "700.000,00") + "\nIl servizio comprende la pulizia ordinaria e straordinaria di tutti gli ambienti del palazzo di giustizia (Euro 690.000). Facoltativamente l'affidatario gestisce un piccolo distributore automatico di bevande (Euro 10.000)." }],
    atteso: "pulizie",
  },
  {
    nome: "L. pasti a domicilio per anziani (ristorazione collettiva)",
    docs: [{ nome: "capitolato.pdf", testo: intestazione("AMBITO SOCIALE", "servizio di preparazione e consegna di pasti a domicilio per anziani e persone fragili", "55521000-8", "410.000,00") + "\nIl servizio comprende la preparazione dei pasti nel centro cottura, il confezionamento in contenitori monoporzione, la consegna a domicilio e le diete personalizzate." }],
    atteso: "ristorazione_collettiva",
  },
  {
    nome: "M. oggetto non chiaro (solo moduli)",
    docs: [{ nome: "modulistica.pdf", testo: "ALLEGATO B - Dichiarazione sostitutiva\nIl sottoscritto dichiara di possedere i requisiti generali di cui agli artt. 94-98 del D.Lgs. 36/2023 e di non trovarsi in alcuna delle cause di esclusione.\nFirma del legale rappresentante." }],
    atteso: "altro",
  },
  {
    nome: "N. refezione scolastica tra molti documenti di contorno",
    docs: [{ nome: "disciplinare.pdf", testo: intestazione("COMUNE DI VALLEVERDE", "servizio di ristorazione scolastica", "55524000-9", "1.800.000,00") + "\nIl servizio comprende la preparazione e la somministrazione dei pasti nelle scuole del comune, con menu stagionali e diete speciali." }, ...CONTORNO],
    atteso: "ristorazione_collettiva",
  },
  {
    nome: "O. pulizia tra molti documenti di contorno",
    docs: [{ nome: "disciplinare.pdf", testo: intestazione("COMUNE DI VALLEVERDE", "servizio di pulizia delle scuole comunali", "90919200-4", "850.000,00") + "\nIl servizio comprende la pulizia giornaliera di aule, corridoi, palestre e servizi igienici di 12 plessi scolastici." }, ...CONTORNO],
    atteso: "pulizie",
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
  const ripetizioni = Math.max(1, Number(process.argv[2] ?? 3));
  const filtro = process.argv[3] ?? "";
  const anthropic = createAnthropicClient();
  const strumento: Anthropic.Tool = {
    name: "estrai_dati_gara",
    description: "Registra i dati strutturati estratti dai documenti di una gara d'appalto.",
    input_schema: {
      type: "object" as const,
      properties: {
        stazione_appaltante: { type: "string", description: "Nome del soggetto che CONDUCE la procedura di gara. Ometti il campo se non è identificabile nei documenti." },
        ...PROPRIETA_SETTORE_ESTRAZIONE,
      },
      required: ["settore_gara"],
    },
  };

  let costoTotale = 0;
  let errori = 0;
  const riepilogo: string[] = [];
  for (const scenario of SCENARI) {
    if (filtro && !scenario.nome.includes(filtro)) continue;
    const buffers = await Promise.all(scenario.docs.map((d) => creaPdf(d.testo)));
    const blocchi: Anthropic.DocumentBlockParam[] = buffers.map((b) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b.toString("base64") } }));
    for (let k = 1; k <= ripetizioni; k++) {
      const risposta = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1000,
        thinking: { type: "disabled" },
        tools: [strumento],
        tool_choice: { type: "tool", name: "estrai_dati_gara" },
        messages: [{ role: "user", content: [...blocchi, { type: "text", text: "Questi sono i documenti di una gara d'appalto. Estrai i dati richiesti usando lo strumento fornito." }] }],
      });
      costoTotale += calcolaCostoStimato(MODEL, risposta.usage.input_tokens, risposta.usage.output_tokens) ?? 0;
      const uso = risposta.content.find((b) => b.type === "tool_use");
      if (!uso || uso.type !== "tool_use") { console.log(`FALLITO ${scenario.nome} #${k}: nessuna risposta dello strumento`); errori++; continue; }
      const grezzo = (uso.input as { settore_gara?: unknown }).settore_gara;
      const settore = normalizzaSettore(grezzo);
      const ok = settore === scenario.atteso;
      const proposta = proponePianoLavoro(settore) ? "piano di lavoro" : proponeFoodMenu(settore) ? "OMNIA FOOD MENU" : "nulla";
      console.log(`${ok ? "ok    " : "FALLITO"} ${scenario.nome} #${k}: settore=${String(grezzo)} (atteso ${scenario.atteso}) → si propone: ${proposta}`);
      if (!ok) { errori++; riepilogo.push(`${scenario.nome} #${k}: ${String(grezzo)} invece di ${scenario.atteso}`); }
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
