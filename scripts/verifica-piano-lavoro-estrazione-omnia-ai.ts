// Autotest della LETTURA dei documenti di gara per il piano di lavoro di OMNIA AI (senza rete e senza modello vero):
//   - quali formati si leggono e come: Word con le tabelle riga per riga, Excel/CSV senza celle vuote e con un tetto,
//     immagini, PDF; i formati non letti (vecchi .doc, .odt, .rtf, .xml) finiscono nell'elenco dei non letti col motivo;
//   - la scelta dei documenti: moduli amministrativi fuori, copie identiche una sola volta (si tiene l'originale),
//     versione rettificata al posto della precedente, planimetrie a una pagina fuori, tetto sui documenti poco pertinenti;
//   - le rese di riferimento (sempre dentro l'intervallo) e la conversione delle frequenze;
//   - le regole del codice che trasformano la risposta del modello nei dati del piano (rese dalla tabella, frequenze,
//     quote dell'organico, tipologie citate solo nelle sedi, fonti, avvertenze);
//   - l'orchestrazione con un modello FINTO: richieste per documenti principali e per schede, nomi già trovati passati alle
//     successive, risposta troncata che dà errore, costi registrati, nessuna cache fuori dalle prove.
// Gratuito: gira nel livello 1, quindi in prebuild.
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import type Anthropic from "@anthropic-ai/sdk";
import { LIMITI_DOCUMENTI, chiaveBaseDocumento, creaLotti, docxATesto, formatoDocumento, preparaDocumenti, rilevanzaDocumento, tabellaATesto, type DocumentoIn } from "../src/lib/piano-lavoro-documenti";
import { CATEGORIE_RESA, frequenzaDaTipo, resaDaCategoria } from "../src/lib/piano-lavoro-rese";
import { costruisciDatiGrezzi, datiDaRaw, estraiPianoLavoro, risolviRiferimenti, tipologieNote, unisciEstrazioni, type RawEstrazione, type UsoModello } from "../src/lib/piano-lavoro-estrazione";
import { calcolaPianoLavoro, elencoAnomalie, elencoDatiMancanti } from "../src/lib/piano-lavoro-calcoli";
import { costruisciExcelPianoLavoro } from "../src/lib/piano-lavoro-excel";
import { normalizzaPianoLavoro } from "../src/lib/piano-lavoro-dati";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}

async function pdf(titolo: string, pagine: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.setTitle(titolo);
  for (let i = 0; i < pagine; i++) d.addPage();
  return Buffer.from(await d.save());
}
function xlsx(righe: unknown[][], nomeFoglio = "Foglio1"): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(righe), nomeFoglio);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function main() {
  // ═════ 1. formati e pertinenza ═════
  uguale(
    "formati letti: pdf, docx, xlsx/xls/csv, immagini, txt; il resto no",
    ["a.pdf", "a.DOCX", "a.xlsx", "a.xls", "a.csv", "a.png", "a.JPG", "a.jpeg", "a.webp", "a.txt", "a.doc", "a.odt", "a.rtf", "a.xml", "a"].map(formatoDocumento),
    ["pdf", "word", "tabella", "tabella", "tabella", "immagine", "immagine", "immagine", "immagine", "testo", "non_supportato", "non_supportato", "non_supportato", "non_supportato", "non_supportato"],
  );
  uguale(
    "pertinenza: moduli amministrativi esclusi, capitolati e elenchi del personale alti, schede nella media",
    [
      "Allegato 6 - Modello antimafia_Pulizie.docx",
      "Allegato_1_-_Domanda_di_partecipazione.docx",
      "Allegato_6_-_Informativa_Privacy.pdf",
      "Allegato_8_-_Sistema_segnalazioni_Whistleblowing.pdf",
      "Allegato_e-DGUE-Creazione_manuale_2_4_1_Response.pdf",
      "Allegato_14_-_Dichiarazione_CAM_Macchine.docx",
      "Allegato 4 - DUVRI.pdf",
      "Capitolato_Speciale_Servizio_di_pulizia_REP_117_2026.pdf",
      "Allegato_18_-_Elenco_personale_appaltatore_uscente.pdf",
      "ALLEGATO F CSA DEF.pdf",
      "Allegato_arioli.xlsx",
      "All. A.1 Capitolato Generale per Appalti.pdf",
    ].map(rilevanzaDocumento),
    ["esclusa", "esclusa", "esclusa", "esclusa", "esclusa", "bassa", "bassa", "alta", "alta", "alta", "media", "bassa"],
  );
  atteso(
    "stesso documento in due versioni: la chiave coincide (originale/«_REV», cartella, «- Copia»); documenti diversi no",
    chiaveBaseDocumento("ACQ.007.2026 Disciplinare di Gara.pdf") === chiaveBaseDocumento("DOC. RETTIFICATA/ACQ.007.2026 Disciplinare di Gara_REV.pdf") &&
      chiaveBaseDocumento("Allegato_Cambini_Fossati - Copia.xlsx") === chiaveBaseDocumento("Allegato_Cambini_Fossati.xlsx") &&
      chiaveBaseDocumento("Allegato 1 - Modello istanza di partecipazione.docx") !== chiaveBaseDocumento("Allegato 1 CSA - Cadenze attività.pdf") &&
      chiaveBaseDocumento("Allegato_arioli.xlsx") !== chiaveBaseDocumento("Allegato_bacone.xlsx"),
  );

  // ═════ 2. lettura dei formati ═════
  {
    const docx = Buffer.from(
      await Packer.toBuffer(
        new Document({
          sections: [
            {
              children: [
                new Paragraph("Art. 2 - Superfici"),
                new Table({
                  rows: [
                    new TableRow({ children: ["Sede", "Mq", "Frequenza"].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
                    new TableRow({ children: ["Teatro", "27000", "giornaliera"].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
                    new TableRow({ children: ["Museo", "800", "settimanale"].map((t) => new TableCell({ children: [new Paragraph(t)] })) }),
                  ],
                }),
              ],
            },
          ],
        }),
      ),
    );
    const testo = await docxATesto(docx);
    atteso("Word: le tabelle restano righe («cella | cella | cella»), non celle sparse", /Sede \| Mq \| Frequenza/.test(testo) && /Teatro \| 27000 \| giornaliera/.test(testo) && /Art\. 2 - Superfici/.test(testo), testo);

    const t = tabellaATesto(
      "scheda.xlsx",
      xlsx([
        ["Impianto Arioli", "", ""],
        [],
        ["Ufficio", 12.123456789, ""],
        ["Ufficio", 12.123456789, ""],
        ["", "", ""],
        ["Totale", 1679.43, "mq"],
      ]),
    );
    atteso("Excel: righe vuote tolte, righe uguali di fila una volta, decimali ridotti, niente celle vuote in coda", t.testo.includes('--- Foglio "Foglio1" ---') && t.testo.includes("Ufficio | 12.1235") && t.testo.split("Ufficio |").length === 2 && t.testo.includes("Totale | 1679.43 | mq") && !/\| *$/m.test(t.testo.replace(/--- .*/g, "")), t.testo);
    const grande = tabellaATesto("grande.xlsx", xlsx(Array.from({ length: 5000 }, (_, i) => [`riga ${i}`, i, "x".repeat(40)])), 5000);
    atteso("Excel: un foglio enorme si tronca al tetto e lo dichiara", grande.troncato && grande.testo.length < 6000);
    uguale("CSV: si legge com'è", tabellaATesto("d.csv", Buffer.from("a;b\n1;2")).testo, "a;b\n1;2");
  }

  // ═════ 3. scelta dei documenti ═════
  {
    const docs: DocumentoIn[] = [
      { nome: "Capitolato.pdf", buffer: await pdf("capitolato v1", 10) },
      { nome: "DOC. RETTIFICATA/Capitolato_REV.pdf", buffer: await pdf("capitolato v2", 11) },
      { nome: "Allegato F - Copia.pdf", buffer: await pdf("allegato F", 1) },
      { nome: "Allegato F.pdf", buffer: await pdf("allegato F", 1) },
      { nome: "Allegato 6 - Modello antimafia.pdf", buffer: await pdf("antimafia", 2) },
      { nome: "Pianta piano terra.pdf", buffer: await pdf("pianta", 1) },
      { nome: "Elenco planimetrie.pdf", buffer: await pdf("elenco planimetrie", 2) },
      { nome: "Modulo.doc", buffer: Buffer.from("vecchio formato") },
      { nome: "Relazione.odt", buffer: Buffer.from("odt") },
      { nome: "screen shot chiarimento.png", buffer: PNG_1X1 },
      { nome: "foto-enorme.jpg", buffer: Buffer.alloc(LIMITI_DOCUMENTI.byteImmagine + 1) },
      { nome: "vuoto.xlsx", buffer: xlsx([[""]]) },
      { nome: "DUVRI pesante.pdf", buffer: await pdf("duvri", 60) },
      { nome: "Allegato 5 - Schema di contratto.pdf", buffer: await pdf("schema contratto", 8) },
    ];
    const p = await preparaDocumenti(docs);
    const motivo = (nome: string) => p.saltati.find((s) => s.nome === nome)?.motivo ?? "";
    const letti = [...p.principali, ...p.schede].map((d) => d.nome);
    uguale("scelta: si leggono capitolato rettificato, allegato F (l'originale, non la copia), elenco planimetrie (2 pagine), l'immagine, lo schema di contratto", letti.sort(), ["Allegato 5 - Schema di contratto.pdf", "Allegato F.pdf", "DOC. RETTIFICATA/Capitolato_REV.pdf", "Elenco planimetrie.pdf", "screen shot chiarimento.png"].sort());
    atteso("scelta: la versione precedente è «sostituita», la copia è «identica» all'originale", /sostituito dalla versione successiva/.test(motivo("Capitolato.pdf")) && /copia identica di «Allegato F\.pdf»/.test(motivo("Allegato F - Copia.pdf")), JSON.stringify(p.saltati));
    atteso("scelta: il modulo amministrativo, la pianta a una pagina, i formati non letti, l'immagine enorme e il file vuoto sono fuori, ognuno col suo motivo", /amministrativo/.test(motivo("Allegato 6 - Modello antimafia.pdf")) && /planimetria o disegno/.test(motivo("Pianta piano terra.pdf")) && /formato non letto/.test(motivo("Modulo.doc")) && /formato non letto/.test(motivo("Relazione.odt")) && /troppo grande/.test(motivo("foto-enorme.jpg")) && /nessun testo/.test(motivo("vuoto.xlsx")), JSON.stringify(p.saltati));
    atteso("scelta: il DUVRI da 60 pagine (poco pertinente, pesante) non si legge, lo schema di contratto leggero sì", /generico o poco pertinente/.test(motivo("DUVRI pesante.pdf")) && letti.includes("Allegato 5 - Schema di contratto.pdf"));
    atteso("ogni documento non letto compare nell'elenco (nessuno scartato in silenzio)", p.saltati.length + letti.length === docs.length, `${p.saltati.length} + ${letti.length} contro ${docs.length}`);
    const img = p.principali.find((d) => d.formato === "immagine");
    atteso("l'immagine diventa un blocco immagine con il suo tipo", img?.contenuto.tipo === "immagine" && img.contenuto.mediaType === "image/png");

    // più fogli Excel = schede per sede
    const fogli: DocumentoIn[] = [1, 2, 3].map((n) => ({ nome: `Allegato_sede${n}.xlsx`, buffer: xlsx([["Sede", n], ["Ufficio", 10 * n]]) }));
    const conSchede = await preparaDocumenti(fogli);
    atteso("tre o più Excel diventano schede (si leggono a gruppi)", conSchede.schede.length === 3 && conSchede.principali.length === 0);
    const dueFogli = await preparaDocumenti(fogli.slice(0, 2));
    atteso("uno o due Excel restano documenti principali", dueFogli.principali.length === 2 && dueFogli.schede.length === 0);

    // gruppi per richiesta
    const lotti = creaLotti(conSchede.schede, { token: 1e9, pagine: 1e9, byte: 1e9, documenti: 2 });
    uguale("i gruppi rispettano il numero massimo di documenti, nell'ordine", lotti.map((l) => l.map((d) => d.nome)), [["Allegato_sede1.xlsx", "Allegato_sede2.xlsx"], ["Allegato_sede3.xlsx"]]);
  }

  // ═════ 4. rese e frequenze ═════
  {
    atteso("rese: ogni categoria ha minima ≤ tipica ≤ massima e una fonte", CATEGORIE_RESA.every((c) => c.minima <= c.tipica && c.tipica <= c.massima && c.provenienzaInterna.length > 3), "");
    uguale("resa dalla categoria: tipica, e mai fuori intervallo (proposta troppo alta → massima, troppo bassa → minima)", [resaDaCategoria("uffici_ripasso"), resaDaCategoria("uffici_ripasso", 5000), resaDaCategoria("uffici_ripasso", 10), resaDaCategoria("uffici_ripasso", 250)], [300, 380, 220, 250]);
    uguale("resa: categoria sconosciuta → nessuna resa (cella gialla), mai un valore inventato", [resaDaCategoria("boh"), resaDaCategoria(null)], [null, null]);
    const ctx = { parametroGiorni: "giorni_anno", settimane: 52 };
    uguale(
      "frequenze: giornaliera → parametro; 3/settimana → 156; mensile 1 → 12; semestrale → 2; a richiesta senza stima → mancante (ipotesi)",
      [frequenzaDaTipo("giornaliera", null, ctx).valore, frequenzaDaTipo("n_per_settimana", 3, ctx).valore, frequenzaDaTipo("n_per_mese", 1, ctx).valore, frequenzaDaTipo("n_per_anno", 2, ctx).valore, frequenzaDaTipo("a_richiesta", null, ctx)],
      [{ param: "giorni_anno" }, 156, 12, 2, { valore: null, nota: "a richiesta", ipotesi: true }],
    );
    uguale("frequenze: tipo sconosciuto o n mancante → nessun valore", [frequenzaDaTipo("boh", 3, ctx).valore, frequenzaDaTipo("n_per_settimana", null, ctx).valore, frequenzaDaTipo("n_per_settimana", -2, ctx).valore], [null, null, null]);
  }

  // ═════ 5. dalla risposta del modello ai dati del piano ═════
  const rispostaA: RawEstrazione = {
    appalto: { titolo: "Servizio di pulizia", stazione_appaltante: "Ente", cig: "ABC", importo_base_gara: 1_000_000 },
    parametri: [
      { chiave: "durata_mesi", valore: 24, fonte: "Bando" },
      { chiave: "giorni_servizio_anno", valore: 303, fonte: "Capitolato art. 10" },
      { chiave: "monte_ore_annuo_dichiarato", valore: 50000, fonte: "Relazione" },
    ],
    tipologie: [
      {
        nome: "Uffici",
        lavorazioni: [
          { nome: "Ripasso", frequenza_tipo: "giornaliera", categoria_rese: "uffici_ripasso", fonte: "Art. 5", esclusa_da_mq: true },
          { nome: "Fondo", frequenza_tipo: "n_per_mese", frequenza_n: 1, categoria_rese: "uffici_fondo", resa_dichiarata: 110 },
        ],
      },
      { nome: "Emettitrici", lavorazioni: [{ nome: "Sanificazione", frequenza_tipo: "n_per_settimana", frequenza_n: 2, categoria_rese: "apparecchiature_unita" }] },
      { nome: "Magazzini", lavorazioni: [{ nome: "Passaggio", frequenza_tipo: "a_richiesta", categoria_rese: "magazzini_depositi" }, { nome: "Senza categoria", frequenza_tipo: "n_per_anno", frequenza_n: 4, categoria_rese: "inventata" }] },
    ],
    sedi: [
      { nome: "Sede A", superfici: [{ tipologia: "uffici", mq: 100 }, { tipologia: "Magazzino", mq: 50, origine: "dedotto" }, { tipologia: "Terrazza", mq: 30 }], canone_importo: 1000, ore_annue_dichiarate: 900 },
      { nome: "Sede B", a_canone: false },
    ],
    presidi: [{ gruppo: "Teatro", descrizione: "Capocantiere", n_addetti: 2, ore_per_turno: 8, frequenza_tipo: "giornaliera" }],
    personale_uscente: [
      { livello: "2°", unita: 8, ore_settimanali_totali: 240 },
      { livello: "4°", unita: 2, ore_settimanali_totali: 80 },
    ],
    macchinari_richiesti: [{ descrizione: "Lavasciuga", quantita: 2, fonte: "Art. 11" }],
    avvertenze: ["Superfici del magazzino attribuite alla tipologia prevalente."],
  };
  {
    const { dati, avvisi } = datiDaRaw(rispostaA, ["capitolato.pdf"], [{ nome: "modulo.pdf", motivo: "amministrativo" }]);
    const uff = dati.tipologie.find((t) => t.nome === "Uffici")!;
    uguale("rese: assegnate dal codice dalla categoria (300 tipica), ipotesi; quella dichiarata dal documento resta (110, documento)", [uff.lavorazioni[0].resa, uff.lavorazioni[0].origineResa, uff.lavorazioni[1].resa, uff.lavorazioni[1].origineResa], [300, "ipotesi", 110, "documento"]);
    uguale("frequenze: «giornaliera» rimanda ai giorni di servizio del capitolato (303); 1 volta al mese → 12", [uff.lavorazioni[0].frequenza, uff.lavorazioni[1].frequenza], [{ param: "giorni_servizio_anno" }, 12]);
    uguale("«coperta dai presìdi» indicata dal modello arriva ai dati (solo dove è true)", [uff.lavorazioni[0].esclusaDaMq, uff.lavorazioni[1].esclusaDaMq], [true, false]);
    atteso("parametri: durata, giorni di servizio e monte ore dichiarato dai documenti", dati.parametri.find((p) => p.chiave === "durata_mesi")?.valore === 24 && dati.parametri.find((p) => p.chiave === "giorni_servizio_anno")?.valore === 303 && dati.parametri.find((p) => p.chiave === "monte_ore_dichiarato")?.valore === 50000);
    const em = dati.tipologie.find((t) => t.nome === "Emettitrici")!;
    atteso("una categoria in unità/h porta la tipologia a «unità» (4 unità/h)", em.unita === "unità" && em.lavorazioni[0].resa === 4 && em.lavorazioni[0].frequenza === 104);
    // una lavorazione in unità/h dentro una tipologia in mq (caso FS Sud-Est: emettitrici nell'Area 1) va in una tipologia a parte
    const mista = datiDaRaw(
      {
        tipologie: [
          {
            nome: "Area 1",
            lavorazioni: [
              { nome: "Pulizia giornaliera", frequenza_tipo: "giornaliera", categoria_rese: "uffici_ripasso" },
              { nome: "Sanificazione emettitrici", frequenza_tipo: "n_per_anno", frequenza_n: 365, categoria_rese: "apparecchiature_unita" },
              { nome: "Lampadari", frequenza_tipo: "giornaliera", categoria_rese: "periodiche_miste", esclusa_da_mq: true, motivo_esclusione: "parte_limitata" },
              { nome: "Ripasso del presidio", frequenza_tipo: "giornaliera", categoria_rese: "uffici_ripasso", esclusa_da_mq: true },
            ],
          },
        ],
        sedi: [{ nome: "Stazione", superfici: [{ tipologia: "Area 1", mq: 1000 }, { tipologia: "Area 1 – apparecchiature (unità)", mq: 43 }] }],
      },
      [],
      [],
    );
    uguale("lavorazione in unità dentro una tipologia in mq: tipologia a parte in unità, la prima resta in mq", [mista.dati.tipologie.map((t) => [t.nome, t.unita, t.lavorazioni.length])], [[["Area 1", "mq", 3], ["Area 1 – apparecchiature (unità)", "unità", 1]]]);
    atteso("…e lo si segnala, e i 43 apparecchi della sede vanno nella tipologia in unità", mista.avvisi.some((a) => /misurate in unità/.test(a)) && mista.dati.sedi[0].mq[mista.dati.tipologie[1].id] === 43, mista.avvisi.join(" | "));
    uguale("motivo dell'esclusione dal calcolo da mq: «parte_limitata», «presidio» (anche se non indicato), nessuno se non esclusa", mista.dati.tipologie[0].lavorazioni.map((l) => l.motivoEsclusione), ["", "parte_limitata", "presidio"]);
    atteso("le lavorazioni su parti limitate sono segnalate da completare a forfait; le tipologie in mq con coefficiente assurdo come anomalie, quelle in unità no", elencoDatiMancanti(mista.dati).some((m) => /parti limitate/.test(m)) && elencoAnomalie(normalizzaPianoLavoro({ tipologie: [{ nome: "X", lavorazioni: [{ nome: "y", resa: 10, frequenza: 365 }] }, { nome: "Apparecchi", unita: "unità", lavorazioni: [{ nome: "z", resa: 4, frequenza: 365 }] }] }).dati).length === 1);
    // presìdi → tipologie servite: le pulizie ordinarie (giornaliere, o almeno 3 volte a settimana) non si contano dalle metrature
    const servita = datiDaRaw(
      {
        tipologie: [
          {
            id: "T1",
            nome: "Teatro",
            lavorazioni: [
              { nome: "Ripasso giornaliero", frequenza_tipo: "giornaliera", categoria_rese: "monumentale_pregio" },
              { nome: "Quattro volte a settimana", frequenza_tipo: "n_per_settimana", frequenza_n: 4, categoria_rese: "periodiche_miste" },
              { nome: "Due volte a settimana", frequenza_tipo: "n_per_settimana", frequenza_n: 2, categoria_rese: "periodiche_miste" },
              { nome: "Trimestrale a fondo", frequenza_tipo: "n_per_anno", frequenza_n: 4, categoria_rese: "periodiche_miste" },
            ],
          },
          { id: "T2", nome: "Magazzini", lavorazioni: [{ nome: "Ripasso giornaliero", frequenza_tipo: "giornaliera", categoria_rese: "magazzini_depositi" }] },
        ],
        presidi: [{ descrizione: "Addetti Teatro", n_addetti: 2, ore_per_turno: 8, frequenza_tipo: "giornaliera", tipologie_servite: ["T1"] }],
      },
      [],
      [],
    );
    const tt = servita.dati.tipologie;
    uguale(
      "presìdi: le lavorazioni ordinarie (giornaliera, 4/settimana) di una tipologia servita sono escluse col motivo «presidio»; 2/settimana, trimestrale e le altre tipologie no",
      [tt[0].lavorazioni.map((l) => l.esclusaDaMq), tt[0].lavorazioni.map((l) => l.motivoEsclusione), tt[1].lavorazioni[0].esclusaDaMq],
      [[true, true, false, false], ["presidio", "presidio", "", ""], false],
    );

    // più lavorazioni con la stessa frequenza nella stessa tipologia = una sola (le ore non si contano due volte)
    const doppie = datiDaRaw(
      {
        tipologie: [
          {
            nome: "Uffici",
            lavorazioni: [
              { nome: "Spazzatura e lavaggio pavimenti", frequenza_tipo: "giornaliera", categoria_rese: "uffici_ripasso" },
              { nome: "Raccolta rifiuti e spolveratura", frequenza_tipo: "giornaliera", categoria_rese: "uffici_ripasso" },
              { nome: "Servizi igienici", frequenza_tipo: "giornaliera", categoria_rese: "servizi_igienici" },
              { nome: "Vetri", frequenza_tipo: "n_per_settimana", frequenza_n: 1, categoria_rese: "uffici_fondo" },
            ],
          },
        ],
      },
      [],
      [],
    );
    uguale("lavorazioni con la stessa frequenza: una sola, con il nome della prima e il numero delle unite; la resa è quella della prima", [doppie.dati.tipologie[0].lavorazioni.map((l) => l.nome), doppie.dati.tipologie[0].lavorazioni.map((l) => l.resa)], [["Spazzatura e lavaggio pavimenti (e altre 2 operazioni di pari frequenza)", "Vetri"], [300, 120]]);
    atteso("…e il coefficiente della tipologia non raddoppia (giornaliera 365/300 + settimanale 52/120)", Math.abs(calcolaPianoLavoro(doppie.dati).coefficientiTipologia[0] - (365 / 300 + 52 / 120)) < 1e-9 && doppie.avvisi.some((a) => /non vengono contate due volte/.test(a)));

    // il monte ore e il budget devono essere SCRITTI nei documenti, non dedotti dal modello
    const dedotto = datiDaRaw({ parametri: [{ chiave: "monte_ore_annuo_dichiarato", valore: 44523, fonte: "Quadro economico (valore DEDOTTO da 29 addetti × 3 ore × 303 giorni)" }, { chiave: "budget_macchinari", valore: 7000, fonte: "Quadro economico: prodotti per la pulizia a corpo" }] }, [], []);
    atteso("un monte ore «dedotto» dal modello e un budget che riguarda i prodotti vengono scartati, con un avviso", dedotto.dati.parametri.find((p) => p.chiave === "monte_ore_dichiarato")?.valore === null && dedotto.dati.budgetMacchinari === null && dedotto.avvisi.some((a) => /non è dichiarato esplicitamente/.test(a)), JSON.stringify(dedotto.dati.parametri.map((p) => [p.chiave, p.valore])));
    const letto = datiDaRaw({ parametri: [{ chiave: "monte_ore_annuo_dichiarato", valore: 65443.56, fonte: "Allegato 1 - Documento di stima economica, pag. 2" }, { chiave: "budget_macchinari", valore: 156000, fonte: "Disciplinare art. 4: dotazione di macchinari e attrezzature" }] }, [], []);
    atteso("un monte ore scritto in un documento (anche «stima economica») e un budget per macchinari restano", letto.dati.parametri.find((p) => p.chiave === "monte_ore_dichiarato")?.valore === 65443.56 && letto.dati.budgetMacchinari === 156000);

    // il personale lo conta e lo somma il codice: un numero per addetto
    const personale = datiDaRaw({ personale_uscente: [{ livello: "2°", ore_settimanali_per_addetto: [30, 30, 36.5] }, { livello: "3°", ore_settimanali_per_addetto: [40] }, { livello: "4°", unita: 2, ore_settimanali_totali: 60 }] }, [], []);
    uguale("personale uscente: unità e ore settimanali sono contate e sommate dal codice (3 addetti, 96,5 ore); senza elenco valgono i totali dati", personale.dati.personaleUscente.map((p) => [p.livello, p.unita, p.oreSettimanali]), [["2°", 3, 96.5], ["3°", 1, 40], ["4°", 2, 60]]);
    // il modello ha contato 5 addetti ma ne ha elencati 4: valgono i 5 contati, e le ore si stimano sulla media (con la nota)
    const incompleto = datiDaRaw({ personale_uscente: [{ livello: "2°", unita: 5, ore_settimanali_per_addetto: [30, 30, 36, 40] }] }, [], []);
    atteso("elenco incompleto (5 contati, 4 elencati): 5 addetti, ore sulla media (136 ÷ 4 × 5 = 170) e lo dice nella nota", incompleto.dati.personaleUscente[0].unita === 5 && incompleto.dati.personaleUscente[0].oreSettimanali === 170 && /stimate sulla media di 4 addetti elencati su 5/.test(incompleto.dati.personaleUscente[0].nota), JSON.stringify(incompleto.dati.personaleUscente));
    // riservatezza: dagli elenchi del personale non passano codici fiscali, matricole né nominativi etichettati, né campi non previsti
    {
      const sporco = { personale_uscente: [{ livello: "2° RSSMRA80A01H501U", ore_settimanali_per_addetto: [30, 36], note: "matr. 12345; Sig.ra Bianchi Anna; part-time", nome: "Mario Rossi", codice_fiscale: "BNCNNA85M41H501Z" }, { livello: "3°", unita: 2, ore_settimanali_totali: 60, note: "BNCNNA85M41H501Z" }, "Mario Rossi"] } as unknown as RawEstrazione;
      const consumata = risolviRiferimenti(sporco, []);
      const testo = JSON.stringify(consumata.personale_uscente);
      atteso("personale uscente: via codici fiscali, matricole, nominativi etichettati e campi non previsti già dalla lettura della risposta", !/RSSMRA|BNCNNA|12345|Bianchi|Mario|codice_fiscale|"nome"/.test(testo) && /part-time/.test(testo), testo);
      const finale = datiDaRaw(sporco, [], []).dati;
      atteso("…e nei dati del piano (Excel e database) restano livello, unità e ore, con le note ripulite", !/RSSMRA|BNCNNA|12345|Bianchi|Mario/.test(JSON.stringify(finale)) && finale.personaleUscente.length === 2 && finale.personaleUscente[0].unita === 2 && finale.personaleUscente[0].oreSettimanali === 66 && finale.personaleUscente[0].livello.trim() === "2°" && finale.personaleUscente[1].oreSettimanali === 60, JSON.stringify(finale.personaleUscente));
    }
    const mag = dati.tipologie.find((t) => t.nome === "Magazzini")!;
    atteso("a richiesta senza stima = frequenza mancante; categoria inventata = resa mancante (celle gialle), mai valori inventati", mag.lavorazioni[0].frequenza === null && mag.lavorazioni[0].origineFrequenza === "mancante" && mag.lavorazioni[1].resa === null && mag.lavorazioni[1].origineResa === "mancante");
    atteso("le fonti dicono da dove viene la resa («Resa di riferimento OMNIA AI») e dove il documento", /Resa di riferimento OMNIA AI/.test(uff.lavorazioni[0].fonte) && /Art\. 5/.test(uff.lavorazioni[0].fonte) && !/Resa di riferimento/.test(uff.lavorazioni[1].fonte));
    const a = dati.sedi[0];
    const idUff = dati.tipologie.find((t) => t.nome === "Uffici")!.id;
    const idMag = dati.tipologie.find((t) => t.nome === "Magazzini")!.id;
    const idTerr = dati.tipologie.find((t) => t.nome === "Terrazza")!.id;
    uguale("sedi: i mq si abbinano per nome (anche con maiuscole/singolare), una tipologia citata solo nelle sedi si aggiunge", [a.mq[idUff], a.mq[idMag], a.mq[idTerr]], [100, 50, 30]);
    atteso("sedi: una superficie «dedotta» rende l'origine delle metrature un'ipotesi; canone e ore dichiarate si riportano; la sede senza dati è «mancante» e a misura", a.origineMq === "ipotesi" && a.canone === 1000 && a.oreDichiarate === 900 && dati.sedi[1].origineMq === "mancante" && dati.sedi[1].aCanone === false);
    atteso("la tipologia comparsa solo nelle sedi è segnalata", avvisi.some((x) => /Terrazza/.test(x)), avvisi.join(" | "));
    uguale("personale uscente: il piano lo riporta; la ripartizione per livello è dalle ore settimanali (240/320 = 75%, 25%)", [dati.personaleUscente.map((p) => p.unita), dati.organico.map((l) => l.quota)], [[8, 2], [0.75, 0.25]]);
    atteso("i presìdi arrivano con i turni «giornalieri» legati ai giorni di servizio", dati.presidi.length === 1 && JSON.stringify(dati.presidi[0].periodi) === JSON.stringify({ param: "giorni_servizio_anno" }));
    atteso("le dotazioni richieste dal capitolato finiscono nelle avvertenze (in attesa del dimensionamento)", dati.avvertenze.some((x) => /Lavasciuga \(2\)/.test(x)) && dati.avvertenze.some((x) => /Superfici del magazzino/.test(x)));
    uguale("i documenti letti e non letti arrivano al piano", [dati.documenti.letti, dati.documenti.nonLetti], [["capitolato.pdf"], [{ nome: "modulo.pdf", motivo: "amministrativo" }]]);

    // organico: l'organico previsto dai documenti ha la precedenza sul personale uscente
    const conPrevisti = costruisciDatiGrezzi({ ...rispostaA, livelli_previsti: [{ livello: "2°", n_addetti: 41 }, { livello: "3°", n_addetti: 9 }] }, { letti: [], nonLetti: [] });
    const organico = normalizzaPianoLavoro(conPrevisti.grezzo).dati.organico;
    atteso("organico: i livelli previsti dai documenti (41 e 9 addetti) hanno la precedenza sul personale uscente", organico.length === 2 && Math.abs((organico[0].quota ?? 0) - 41 / 50) < 1e-9);
    // personale senza ore: si ripartisce per unità
    const senzaOre = normalizzaPianoLavoro(costruisciDatiGrezzi({ personale_uscente: [{ livello: "2°", unita: 3 }, { livello: "3°", unita: 1 }] }, { letti: [], nonLetti: [] }).grezzo).dati.organico;
    atteso("organico: senza ore settimanali si ripartisce per numero di addetti", senzaOre.length === 2 && Math.abs((senzaOre[0].quota ?? 0) - 0.75) < 1e-9);
    // un risultato vuoto o sporco non rompe nulla
    const vuoto = datiDaRaw({}, [], []);
    atteso("un risultato vuoto dà comunque un piano valido (tutto da compilare)", vuoto.dati.tipologie.length === 1 && vuoto.dati.organico.length === 1);
    const sporco = datiDaRaw({ tipologie: [{ nome: "X", lavorazioni: [{ nome: "y", frequenza_tipo: "n_per_settimana", frequenza_n: Number.NaN }] }], sedi: [{ nome: "S", superfici: [{ tipologia: "X", mq: -5 }] }] } as unknown as RawEstrazione, [], []);
    atteso("numeri impossibili (NaN, negativi) diventano dati mancanti", sporco.dati.tipologie[0].lavorazioni[0].frequenza === null && sporco.dati.sedi[0].origineMq === "mancante");

    // fino all'Excel
    const r = calcolaPianoLavoro(dati);
    const { buffer } = await costruisciExcelPianoLavoro(dati, { generatoIl: new Date("2026-11-02T10:00:00Z") });
    atteso("dal risultato del modello si arriva a un Excel valido con i calcoli del piano", buffer.length > 5000 && r.oreTotali > 0);
  }

  // ═════ 6. unione di più risposte ═════
  {
    const b: RawEstrazione = {
      appalto: { titolo: "ALTRO", cig: "ZZZ", criterio_aggiudicazione: "OEPV" },
      parametri: [{ chiave: "durata_mesi", valore: 36 }, { chiave: "ore_annue_per_addetto", valore: 1600 }],
      tipologie: [{ nome: "UFFICI", lavorazioni: [{ nome: "ripasso", frequenza_tipo: "giornaliera" }, { nome: "Vetri", frequenza_tipo: "n_per_anno", frequenza_n: 4 }] }, { nome: "Scale", lavorazioni: [] }],
      sedi: [{ nome: "sede a", superfici: [{ tipologia: "Scale", mq: 40 }, { tipologia: "Uffici", mq: 999 }], indirizzo: "Via Roma" }, { nome: "Sede C" }],
      personale_uscente: [{ livello: "2°", unita: 3 }],
      avvertenze: ["Superfici del magazzino attribuite alla tipologia prevalente.", "Nuova avvertenza."],
    };
    const u = unisciEstrazioni(rispostaA, b);
    atteso("unione: i dati della prima risposta prevalgono (titolo, CIG, durata); i campi mancanti si completano", u.appalto?.titolo === "Servizio di pulizia" && u.appalto?.cig === "ABC" && u.appalto?.criterio_aggiudicazione === "OEPV" && u.parametri?.find((p) => p.chiave === "durata_mesi")?.valore === 24 && u.parametri?.some((p) => p.chiave === "ore_annue_per_addetto"));
    atteso("unione: tipologie per nome (maiuscole ignorate) con lavorazioni unite senza doppioni", u.tipologie?.length === 4 && u.tipologie.find((t) => t.nome === "Uffici")?.lavorazioni?.length === 3, JSON.stringify(u.tipologie?.map((t) => [t.nome, t.lavorazioni?.length])));
    const sa = u.sedi?.find((s) => s.nome === "Sede A");
    atteso("unione: le sedi si riconoscono per nome; le superfici si sommano per tipologia nuova senza sovrascrivere quelle già note; indirizzo completato", u.sedi?.length === 3 && sa?.indirizzo === "Via Roma" && sa?.superfici?.length === 4 && sa.superfici.find((x) => x.tipologia === "uffici")?.mq === 100);
    atteso("unione: personale uscente dalla risposta con più unità; avvertenze senza doppioni", u.personale_uscente?.length === 2 && u.avvertenze?.length === 2);
    atteso("l'unione non modifica gli ingressi", rispostaA.tipologie?.length === 3 && rispostaA.sedi?.length === 2);
  }

  // ═════ 6b. riferimenti alle tipologie per id ═════
  {
    const raw: RawEstrazione = {
      tipologie: [
        { id: "T1", nome: "Teatro - aree monumentali", lavorazioni: [] },
        { id: "T2", nome: "Magazzini Pero", lavorazioni: [] },
      ],
      sedi: [{ nome: "Teatro", superfici: [{ tipologia: "T1", mq: 27000 }, { tipologia: "t2", mq: 5 }, { tipologia: "Altro nome", mq: 1 }] }],
    };
    const r = risolviRiferimenti(raw, [{ id: "T9", nome: "Nota da prima" }]);
    uguale("gli id (anche in minuscolo) diventano nomi; un nome già scritto resta com'è; gli id spariscono dalle tipologie", [r.sedi?.[0].superfici?.map((s) => s.tipologia), r.tipologie?.map((t) => t.id)], [["Teatro - aree monumentali", "Magazzini Pero", "Altro nome"], [undefined, undefined]]);
    uguale("un id delle tipologie già note (di una richiesta precedente) si risolve col loro elenco", risolviRiferimenti({ sedi: [{ nome: "X", superfici: [{ tipologia: "T9", mq: 3 }] }] }, [{ id: "T9", nome: "Nota da prima" }]).sedi?.[0].superfici?.[0].tipologia, "Nota da prima");
    uguale("gli id delle tipologie note si numerano nell'ordine", tipologieNote({ tipologie: [{ nome: "A" }, { nome: "B" }] }), [{ id: "T1", nome: "A" }, { id: "T2", nome: "B" }]);
    atteso("la risoluzione non modifica la risposta originale", raw.tipologie?.[0].id === "T1" && raw.sedi?.[0].superfici?.[0].tipologia === "T1");
  }

  // ═════ 7. orchestrazione con un modello finto ═════
  {
    const chiamate: { messages: Anthropic.Messages.MessageParam[]; params: Record<string, unknown> }[] = [];
    const chiamateMacchinari: Record<string, unknown>[] = [];
    let risposte: { input: unknown; stop?: string }[] = [];
    const finto = {
      messages: {
        stream: (params: Record<string, unknown>) => {
          // la scelta dei macchinari (dati già estratti, niente documenti) ha le sue richieste: non conta tra quelle dell'estrazione
          if ((params.tool_choice as { name?: string } | undefined)?.name === "scegli_dotazioni") {
            chiamateMacchinari.push(params);
            return { finalMessage: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "scegli_dotazioni", input: {} }], usage: { input_tokens: 1000, output_tokens: 200 } }) };
          }
          chiamate.push({ messages: params.messages as Anthropic.Messages.MessageParam[], params });
          const r = risposte.shift() ?? { input: {} };
          return {
            finalMessage: async () => ({ stop_reason: r.stop ?? "tool_use", content: [{ type: "tool_use", name: "estrai_dati_piano_lavoro", input: r.input }], usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
          };
        },
      },
    } as unknown as Anthropic;
    const usi: UsoModello[] = [];
    const testoDi = (m: Anthropic.Messages.MessageParam) => (typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join("\n"));

    const principale = { nome: "Capitolato.pdf", buffer: await pdf("capitolato", 5) };
    const schede: DocumentoIn[] = Array.from({ length: 20 }, (_, i) => ({ nome: `Allegato_sede${i + 1}.xlsx`, buffer: xlsx([["Sede", `S${i + 1}`], ["Ufficio", 10 + i]]) }));

    // senza schede: una sola richiesta
    risposte = [{ input: rispostaA }];
    const solo = await estraiPianoLavoro([principale], { anthropic: finto, registraUso: (u) => void usi.push(u) });
    const c0 = chiamate[0];
    atteso("una gara senza schede: una sola richiesta, strumento obbligato, ragionamento spento, il PDF come documento col suo titolo", solo.richieste === 1 && chiamate.length === 1 && JSON.stringify(c0.params.tool_choice) === JSON.stringify({ type: "tool", name: "estrai_dati_piano_lavoro" }) && JSON.stringify(c0.params.thinking) === JSON.stringify({ type: "disabled" }) && JSON.stringify(c0.messages[0]).includes('"type":"document"') && JSON.stringify(c0.messages[0]).includes('"title":"Capitolato.pdf"'));
    atteso("senza prove di sviluppo nessun punto di cache sui documenti; le istruzioni vengono dopo i documenti", !JSON.stringify(c0.messages).includes("cache_control") && testoDi(c0.messages[0]).lastIndexOf("REGOLE") > testoDi(c0.messages[0]).indexOf("=== DOCUMENTO 1"));
    uguale("il costo di ogni richiesta viene registrato (operazione, modello, token), compresa la scelta dei macchinari sui requisiti trovati", usi.map((u) => [u.operazione, u.model, u.inputTokens, u.outputTokens]), [["piano_lavoro_estrazione", "claude-sonnet-5", 1000, 200], ["piano_lavoro_macchinari", "claude-sonnet-5", 1000, 200]]);
    atteso("i macchinari arrivano ai dati del piano, dal catalogo (quantità dalle regole, prezzo con fonte), e la richiesta di scelta non contiene documenti", solo.dati.macchinari.length > 5 && solo.dati.macchinari.every((m) => m.origine === "catalogo") && chiamateMacchinari.length === 1 && !JSON.stringify(chiamateMacchinari[0].messages).includes('"type":"document"') && solo.macchinari.macchinari.length === solo.dati.macchinari.length);
    atteso("il risultato arriva ai dati del piano", solo.dati.parametri.find((p) => p.chiave === "durata_mesi")?.valore === 24 && solo.letti.length === 1);

    // con la cache (prove di sviluppo)
    chiamate.length = 0;
    risposte = [{ input: rispostaA }];
    await estraiPianoLavoro([principale], { anthropic: finto, usaCache: true });
    atteso("nelle prove (usaCache) l'ultimo documento è il punto di cache", JSON.stringify(chiamate[0].messages).includes('"cache_control":{"type":"ephemeral"}'));

    // con 20 schede: 1 richiesta principale + 2 gruppi di schede (14 + 6), con i nomi già trovati
    chiamate.length = 0;
    usi.length = 0;
    risposte = [{ input: rispostaA }, { input: { sedi: [{ nome: "Sede A", superfici: [{ tipologia: "T1", mq: 77 }] }, { nome: "Sede Nuova", superfici: [{ tipologia: "T3", mq: 12 }] }] } }, { input: { sedi: [{ nome: "Sede C" }] } }];
    const con = await estraiPianoLavoro([principale, ...schede], { anthropic: finto, registraUso: (u) => void usi.push(u) });
    atteso("20 schede: una richiesta per i principali e due per le schede (14 + 6)", con.richieste === 3 && chiamate.length === 3);
    const richiestaSchede = testoDi(chiamate[1].messages[0]);
    atteso("le richieste per le schede ricevono tipologie e sedi già trovate (nomi esatti) e chiedono SOLO le sedi", /TIPOLOGIE GIÀ DEFINITE/.test(richiestaSchede) && /- T1: Uffici/.test(richiestaSchede) && /- T3: Magazzini/.test(richiestaSchede) && /SEDI GIÀ NOTE/.test(richiestaSchede) && /- Sede A/.test(richiestaSchede) && /SOLO le sedi/.test(richiestaSchede));
    atteso("le sedi delle schede si uniscono a quelle dei principali (per nome): Sede A completata, Sede Nuova e Sede C aggiunte", con.dati.sedi.length === 4 && con.raw.sedi?.find((s) => s.nome === "Sede A")?.superfici?.find((x) => x.tipologia === "uffici")?.mq === 100, JSON.stringify(con.dati.sedi.map((s) => s.nome)));
    uguale("gli id delle tipologie nelle risposte delle schede (T3) tornano ai nomi (Magazzini); nessun id resta nei dati", [con.raw.sedi?.find((s) => s.nome === "Sede Nuova")?.superfici?.[0]?.tipologia, con.raw.tipologie?.some((t) => t.id !== undefined)], ["Magazzini", false]);
    uguale("i costi delle tre richieste (più la scelta dei macchinari) sono registrati con la loro operazione", usi.map((u) => u.operazione), ["piano_lavoro_estrazione", "piano_lavoro_schede", "piano_lavoro_schede", "piano_lavoro_macchinari"]);

    // senza tipologie note e più gruppi: il primo le definisce, gli altri le ricevono
    chiamate.length = 0;
    risposte = [{ input: { tipologie: [{ nome: "Ambienti", lavorazioni: [] }], sedi: [{ nome: "S1" }] } }, { input: { sedi: [{ nome: "S2" }] } }];
    await estraiPianoLavoro(schede, { anthropic: finto });
    atteso("solo schede e nessuna tipologia nota: il primo gruppo parte da solo, il secondo riceve le tipologie trovate", chiamate.length === 2 && !/TIPOLOGIE GIÀ DEFINITE/.test(testoDi(chiamate[0].messages[0])) && /TIPOLOGIE GIÀ DEFINITE[\s\S]*- T1: Ambienti/.test(testoDi(chiamate[1].messages[0])));

    // risposta troncata
    risposte = [{ input: {}, stop: "max_tokens" }];
    let errore = "";
    try {
      await estraiPianoLavoro([principale], { anthropic: finto });
    } catch (e) {
      errore = (e as Error).message;
    }
    atteso("una risposta troncata dal limite di token dà un errore chiaro, non dati a metà", /troncata/.test(errore), errore);
  }

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
