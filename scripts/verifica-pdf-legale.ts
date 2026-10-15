// Autotest dei PDF dei documenti legali di OMNIA AI e della sezione «Documenti contrattuali»:
//   - per ogni documento si genera il PDF e se ne rilegge il testo: ogni parola del
//     documento di partenza deve ritrovarsi nel PDF (nulla perso nell'impaginazione), con
//     intestazioni, tabella, numerazione delle pagine e impronta al loro posto;
//   - i dati del cliente si uniscono al testo solo al momento del download;
//   - raggruppamento delle accettazioni per abbonamento, versione e orario;
//   - dati mancanti per compilare l'Allegato A;
//   - collegamenti nel codice (percorso del PDF, controllo dell'impronta, area riservata).
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import "pdf-parse/worker";
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PDFParse } from "pdf-parse";
import { dataOraRoma, dataRoma } from "../src/lib/data-it";
import { impronta, leggiMarkdownLegale, nomeFilePdf, TIPO_DB_PER_SLUG } from "../src/lib/legal-documenti";
import { compilaSegnaposto, interpretaMarkdown, segnapostoRimasti, testoSemplice, type Blocco } from "../src/lib/legal-markdown";
import { datiAllegatoMancanti, raggruppaAccettazioni, valoriSegnaposto } from "../src/lib/omnia-ai-documenti-contrattuali";
import { dividiInParole, generaPdfLegale, impaginaRighe } from "../src/lib/pdf-documento-legale";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");

// Tutto il testo visibile di un documento interpretato (titoli, paragrafi, voci, celle).
function testoDocumento(blocchi: Blocco[]): string {
  return blocchi
    .map((b) => {
      if (b.tipo === "elenco") return b.voci.map((v) => testoSemplice(v)).join(" ");
      if (b.tipo === "tabella") return [...b.intestazione, ...b.righe.flat()].map((c) => testoSemplice(c)).join(" ");
      return testoSemplice(b.inline);
    })
    .join(" ");
}

const parole = (testo: string) => testo.split(/\s+/).filter(Boolean);

// Parole del documento che NON si ritrovano nel PDF (come insieme con conteggio).
function paroleMancanti(sorgente: string, pdf: string): string[] {
  const conteggio = new Map<string, number>();
  for (const p of parole(pdf)) conteggio.set(p, (conteggio.get(p) ?? 0) + 1);
  const mancanti: string[] = [];
  for (const p of parole(sorgente)) {
    const n = conteggio.get(p) ?? 0;
    if (n === 0) mancanti.push(p);
    else conteggio.set(p, n - 1);
  }
  return mancanti;
}

async function leggiPdf(bytes: Uint8Array): Promise<{ text: string; pagine: number }> {
  const parser = new PDFParse({ data: Buffer.from(bytes) });
  const t = await parser.getText({ pageJoiner: "\n\n" });
  await parser.destroy();
  return { text: t.text, pagine: t.total };
}

async function main() {
  console.log("--- Parole e righe ---");
  {
    const parole1 = dividiInParole([{ tipo: "grassetto", testo: "[X]" }, { tipo: "testo", testo: ", P.IVA  1" }]);
    uguale("la virgola dopo un grassetto resta attaccata («[X], P.IVA 1»)", parole1.map((p) => [p.testo, p.spazioPrima]), [["[X]", false], [",", false], ["P.IVA", true], ["1", true]]);
    uguale("grassetto e corsivo si ricordano per parola", dividiInParole([{ tipo: "corsivo", testo: "ai sensi" }]).map((p) => p.corsivo), [true, true]);
    uguale("i segmenti vuoti o di soli spazi non producono parole", dividiInParole([{ tipo: "testo", testo: "   " }]), []);

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const cartella = path.join(radice, "src", "assets", "fonts");
    const f = { regolare: await pdf.embedFont(fs.readFileSync(path.join(cartella, "LiberationSans-Regular.ttf"))), grassetto: await pdf.embedFont(fs.readFileSync(path.join(cartella, "LiberationSans-Bold.ttf"))) };
    const frase = dividiInParole([{ tipo: "testo", testo: "Il Responsabile notifica al Titolare, senza ingiustificato ritardo e comunque entro quarantotto ore dalla conoscenza, ogni violazione dei dati personali." }]);
    const righe = impaginaRighe(frase, 200, 10, f);
    atteso("il testo va a capo e nessuna riga supera la larghezza", righe.length > 1 && righe.every((r) => r.reduce((s, p, i) => s + (i > 0 && p.spazioPrima ? f.regolare.widthOfTextAtSize(" ", 10) : 0) + f.regolare.widthOfTextAtSize(p.testo, 10), 0) <= 200.01));
    uguale("a capo senza perdere parole", righe.flat().map((p) => p.testo), frase.map((p) => p.testo));
    const lunga = impaginaRighe(dividiInParole([{ tipo: "testo", testo: "a".repeat(120) }]), 100, 10, f);
    atteso("una parola più larga della riga si spezza invece di uscire dalla pagina", lunga.length > 1 && lunga.flat().map((p) => p.testo).join("") === "a".repeat(120));
  }

  console.log("--- PDF dei documenti: nulla si perde ---");
  const documenti = [
    { nome: "Allegato A", file: "allegato-a-nomina-responsabile-v1.md", titolo: "Allegato A — Atto di nomina a responsabile del trattamento", versione: 1 },
    { nome: "Condizioni v2", file: "condizioni-abbonamento-v2.md", titolo: "Condizioni di abbonamento", versione: 2 },
    { nome: "Condizioni v1", file: "condizioni-abbonamento-v1.md", titolo: "Condizioni di abbonamento", versione: 1 },
    { nome: "Privacy policy", file: "privacy-policy-omnia-ai-v1.md", titolo: "Privacy policy", versione: 1 },
    { nome: "Cookie policy", file: "cookie-policy-omnia-ai-v1.md", titolo: "Cookie policy", versione: 1 },
  ];
  const completi = { data: "14 ottobre 2026", ragioneSociale: "Pulizie Rossi S.r.l.", partitaIva: "01234567890", sede: "Via Giuseppe Garibaldi 12, 90100 Palermo (PA)" };
  for (const d of documenti) {
    const md = leggiMarkdownLegale(d.file);
    const doc = interpretaMarkdown(compilaSegnaposto(md, completi, "linea"));
    atteso(`${d.nome}: l'interprete non scarta nulla (nessun avviso)`, doc.avvisi.length === 0, doc.avvisi.join("; "));
    const bytes = await generaPdfLegale(doc, { titolo: d.titolo, versione: d.versione, impronta: impronta(md), accettatoIl: null, generatoIl: "14 ottobre 2026" });
    const { text, pagine } = await leggiPdf(bytes);
    atteso(`${d.nome}: è un PDF (${pagine} pagine)`, Buffer.from(bytes).subarray(0, 5).toString() === "%PDF-" && pagine >= 1);
    const mancanti = paroleMancanti(testoDocumento(doc.blocchi), text);
    atteso(`${d.nome}: ogni parola del documento è nel PDF`, mancanti.length === 0, `mancano ${mancanti.length}: ${mancanti.slice(0, 8).join(" ")}`);
    atteso(`${d.nome}: piè di pagina «Pagina 1 di ${pagine}» e «Pagina ${pagine} di ${pagine}»`, text.includes(`Pagina 1 di ${pagine}`) && text.includes(`Pagina ${pagine} di ${pagine}`));
    atteso(`${d.nome}: titolo e versione nel piè di pagina; impronta SHA-256 in fondo`, text.includes(`${d.titolo} — versione ${d.versione}`) && text.includes(impronta(md)));
    atteso(`${d.nome}: lettere accentate e punteggiatura tipografica intatte`, /[àèéìòù]/.test(text) && !/[�□]/.test(text) && !/undefined|\[object/.test(text));
  }

  console.log("--- Allegato A: dati del cliente solo al download ---");
  {
    const md = leggiMarkdownLegale("allegato-a-nomina-responsabile-v1.md");
    const genera = async (dati: Parameters<typeof compilaSegnaposto>[1], accettato: string | null) => {
      const testo = compilaSegnaposto(md, dati, "linea");
      const bytes = await generaPdfLegale(interpretaMarkdown(testo), { titolo: "Allegato A", versione: 1, impronta: impronta(md), accettatoIl: accettato, generatoIl: "14 ottobre 2026" });
      return { ...(await leggiPdf(bytes)), testo };
    };
    const pieno = await genera(completi, "14 ottobre 2026 alle 10:32:15");
    atteso("compilato: ragione sociale, partita IVA, sede e data nel PDF; nessun segnaposto rimasto", ["Pulizie Rossi S.r.l.", "P.IVA 01234567890", "Via Giuseppe Garibaldi 12", "in vigore dal 14 ottobre 2026"].every((s) => pieno.text.includes(s)) && !/\[[A-Z ]+\]/.test(pieno.text));
    atteso("compilato: la riga sull'accettazione compare con data e ora al secondo", pieno.text.includes("Versione accettata dal Titolare il 14 ottobre 2026 alle 10:32:15 (ora di Roma)"));
    const vuoto = await genera({ data: "14 ottobre 2026" }, null);
    atteso("senza dati del cliente: tre righe da compilare (ragione sociale, partita IVA, sede), la data resta", (vuoto.text.match(/__________________/g) ?? []).length === 3 && vuoto.text.includes("in vigore dal 14 ottobre 2026"));
    atteso("senza accettazione: nessuna riga «Versione accettata»", !vuoto.text.includes("Versione accettata dal Titolare"));
    const professionista = await genera({ data: "14 ottobre 2026", ragioneSociale: "Mario Rossi", codiceFiscale: "RSSMRA80A01H501U", sede: "Roma" }, null);
    atteso("un professionista senza partita IVA: «C.F.» al posto di «P.IVA»", professionista.text.includes("C.F. RSSMRA80A01H501U") && !professionista.text.includes("P.IVA [PARTITA IVA CLIENTE]"));
    uguale("il testo versionato non cambia: l'impronta in fondo è quella del file, con o senza dati", [pieno.text.includes(impronta(md)), vuoto.text.includes(impronta(md))], [true, true]);
    uguale("il file non contiene dati di nessun cliente (solo segnaposto)", segnapostoRimasti(md).length, 4);
    atteso("la tabella dei sottoresponsabili è nel PDF con i sei fornitori", ["Supabase", "Anthropic", "Voyage AI", "Vercel", "Resend", "Stripe"].every((s) => pieno.text.includes(s)) && pieno.text.includes("Fornitore"));
    atteso("tutti i 12 articoli", Array.from({ length: 12 }, (_, i) => `Art. ${i + 1} —`).every((s) => pieno.text.includes(s)));
  }

  console.log("--- Date e ore a Roma ---");
  uguale("estate (CEST): 08:32:15 UTC → 10:32:15", dataOraRoma("2026-10-14T08:32:15Z"), "14 ottobre 2026 alle 10:32:15");
  uguale("inverno (CET): 08:32:15 UTC → 09:32:15", dataOraRoma("2026-12-14T08:32:15Z"), "14 dicembre 2026 alle 09:32:15");
  uguale("poco prima di mezzanotte UTC il giorno di Roma è già quello dopo", dataRoma("2026-10-14T22:30:00Z"), "15 ottobre 2026");
  uguale("mezzanotte e primo secondo", dataOraRoma("2026-10-14T22:00:01Z"), "15 ottobre 2026 alle 00:00:01");

  console.log("--- Documenti contrattuali dell'area riservata ---");
  {
    const documentiDb = [
      { id: "cond1", document_type: "omnia_ai_condizioni_abbonamento", version: 1, effective_date: "2026-09-11" },
      { id: "cond2", document_type: "omnia_ai_condizioni_abbonamento", version: 2, effective_date: "2026-10-14" },
      { id: "priv1", document_type: "omnia_ai_privacy_policy", version: 1, effective_date: "2026-09-11" },
      { id: "all1", document_type: "omnia_ai_allegato_a", version: 1, effective_date: "2026-10-14" },
      { id: "cook1", document_type: "omnia_ai_cookie_policy", version: 1, effective_date: "2026-09-11" },
      { id: "cook2", document_type: "omnia_ai_cookie_policy", version: 2, effective_date: "2026-12-01" },
    ];
    const abbonamenti = [
      { id: "sub-nuovo", plan: "Professional", created_at: "2026-10-20T09:00:00Z", stripe_subscription_id: "sub_1" },
      { id: "sub-vecchio", plan: "starter", created_at: "2026-09-15T09:00:00Z", stripe_subscription_id: "sub_0" },
      { id: "sub-manuale", plan: "enterprise", created_at: "2026-09-01T09:00:00Z", stripe_subscription_id: null },
    ];
    const accettazioni = [
      // nuovo abbonamento: condizioni v2, privacy, allegato (due righe ciascuno, orari leggermente diversi)
      { subscription_id: "sub-nuovo", acceptance_type: "condizioni_e_privacy", accepted_at: "2026-10-20T09:00:02Z", legal_document_id: "all1" },
      { subscription_id: "sub-nuovo", acceptance_type: "clausole_specifiche", accepted_at: "2026-10-20T09:00:01Z", legal_document_id: "all1" },
      { subscription_id: "sub-nuovo", acceptance_type: "condizioni_e_privacy", accepted_at: "2026-10-20T09:00:01Z", legal_document_id: "cond2" },
      { subscription_id: "sub-nuovo", acceptance_type: "clausole_specifiche", accepted_at: "2026-10-20T09:00:01Z", legal_document_id: "cond2" },
      { subscription_id: "sub-nuovo", acceptance_type: "condizioni_e_privacy", accepted_at: "2026-10-20T09:00:01Z", legal_document_id: "priv1" },
      // vecchio abbonamento: v1
      { subscription_id: "sub-vecchio", acceptance_type: "condizioni_e_privacy", accepted_at: "2026-09-15T09:00:00Z", legal_document_id: "cond1" },
      { subscription_id: "sub-vecchio", acceptance_type: "condizioni_e_privacy", accepted_at: "2026-09-15T09:00:00Z", legal_document_id: "priv1" },
      { subscription_id: "sub-vecchio", acceptance_type: "clausole_specifiche", accepted_at: "2026-09-15T09:00:00Z", legal_document_id: "cond1" },
      // un'accettazione che rimanda a un documento sconosciuto non rompe nulla
      { subscription_id: "sub-vecchio", acceptance_type: "condizioni_e_privacy", accepted_at: "2026-09-15T09:00:00Z", legal_document_id: "sconosciuto" },
    ];
    const gruppi = raggruppaAccettazioni(accettazioni, documentiDb, abbonamenti);
    uguale("tre abbonamenti, dal più recente: nuovo, vecchio, manuale", gruppi.map((g) => g.abbonamentoId), ["sub-nuovo", "sub-vecchio", "sub-manuale"]);
    uguale("piano normalizzato («Professional» → professional)", gruppi.map((g) => g.piano), ["professional", "starter", "enterprise"]);
    uguale("nuovo: condizioni v2, Allegato A v1, privacy v1 (in questo ordine)", gruppi[0].documenti.map((d) => `${d.slug} v${d.versione}`), ["condizioni-abbonamento v2", "allegato-a v1", "privacy-policy v1"]);
    uguale("per ogni documento si mostra la PRIMA accettazione registrata (09:00:01, non 09:00:02)", gruppi[0].documenti.find((d) => d.slug === "allegato-a")?.accettatoIl, "2026-10-20T09:00:01Z");
    uguale("vecchio: ancora le condizioni v1 e la privacy (sono le versioni che ha accettato, non quelle di oggi)", gruppi[1].documenti.map((d) => `${d.slug} v${d.versione}`), ["condizioni-abbonamento v1", "privacy-policy v1"]);
    uguale("cookie policy: la versione IN VIGORE all'attivazione (la v2 dal 1° dicembre non c'entra)", [gruppi[0].cookie?.versione, gruppi[1].cookie?.versione], [1, 1]);
    uguale("l'abbonamento a mano non ha accettazioni, è segnalato come manuale e non ha cookie policy", [gruppi[2].documenti.length, gruppi[2].manuale, gruppi[2].cookie], [0, true, null]);
    uguale("quello con Stripe non è manuale", [gruppi[0].manuale, gruppi[1].manuale], [false, false]);
    uguale("nessuna accettazione e nessun abbonamento: nessun gruppo", raggruppaAccettazioni([], documentiDb, []), []);
    uguale("accettazione di un abbonamento che il cliente non vede (riga assente): il gruppo compare comunque", raggruppaAccettazioni([{ subscription_id: "x", acceptance_type: "condizioni_e_privacy", accepted_at: "2026-10-01T10:00:00Z", legal_document_id: "cond1" }], documentiDb, []).length, 1);
  }
  {
    uguale("profilo assente: mancano tutti e tre i dati", datiAllegatoMancanti(null), ["ragione sociale", "partita IVA o codice fiscale", "sede (indirizzo)"]);
    uguale("profilo completo", datiAllegatoMancanti({ ragione_sociale: "X", partita_iva: "1", codice_fiscale: null, indirizzo: "Roma" }), []);
    uguale("basta il codice fiscale (professionista)", datiAllegatoMancanti({ ragione_sociale: "X", partita_iva: null, codice_fiscale: "RSSMRA80A01H501U", indirizzo: "Roma" }), []);
    uguale("spazi e stringhe vuote valgono come assenti", datiAllegatoMancanti({ ragione_sociale: "  ", partita_iva: "", codice_fiscale: " ", indirizzo: null }), ["ragione sociale", "partita IVA o codice fiscale", "sede (indirizzo)"]);
    uguale("valori per i segnaposto dal profilo", valoriSegnaposto({ ragione_sociale: "X", partita_iva: "1", codice_fiscale: null, indirizzo: "Roma" }, "14 ottobre 2026"), { data: "14 ottobre 2026", ragioneSociale: "X", partitaIva: "1", codiceFiscale: null, sede: "Roma" });
  }

  console.log("--- Collegamenti nel codice ---");
  {
    const route = leggi("src/app/site-omnia-ai/documenti-legali/[type]/[version]/pdf/route.ts");
    const posizioni = ["TIPO_DB_PER_SLUG[type]", '.from("legal_documents")', "impronta(markdown) !== doc.sha256", "generaPdfLegale("].map((s) => route.indexOf(s));
    atteso("la route controlla il tipo, legge il documento, verifica l'impronta e SOLO POI genera il PDF", posizioni.every((p) => p >= 0) && posizioni.every((p, i) => i === 0 || p > posizioni[i - 1]), JSON.stringify(posizioni));
    atteso("un file alterato non diventa un PDF (errore 500 se l'impronta non torna)", /impronta\(markdown\) !== doc\.sha256\) \{[\s\S]*?return errore\(500/.test(route));
    atteso("il percorso del file arriva dal database ma si accetta solo legal/<nome>.md", /\^legal\\\/\(\[a-z0-9-\]\+\\\.md\)\$/.test(route));
    atteso("l'Allegato A si compila solo per chi è collegato; l'accettazione si legge con la sessione (RLS) e l'id è validato", /if \(user\) \{/.test(route) && /UUID\.test\(abbonamentoId\)/.test(route) && !/createAdminClient/.test(route));
    atteso("risposta mai in cache condivisa, non indicizzabile, scaricata come allegato", /"Cache-Control": "private, no-store"/.test(route) && /"X-Robots-Tag": "noindex"/.test(route) && /Content-Disposition": `attachment; filename=/.test(route));
    uguale("nomi dei file PDF senza accenti né spazi", [nomeFilePdf("omnia_ai_allegato_a", 1), nomeFilePdf("omnia_ai_condizioni_abbonamento", 2), nomeFilePdf("sconosciuto", 3)], ["Allegato-A-Nomina-responsabile-del-trattamento-v1.pdf", "Condizioni-di-abbonamento-OMNIA-AI-v2.pdf", "Documento-OMNIA-AI-v3.pdf"]);
    uguale("gli indirizzi dei documenti rimandano ai tipi nel database", [TIPO_DB_PER_SLUG["allegato-a"], TIPO_DB_PER_SLUG["condizioni-abbonamento"], TIPO_DB_PER_SLUG["inesistente"]], ["omnia_ai_allegato_a", "omnia_ai_condizioni_abbonamento", undefined]);

    const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/documenti-contrattuali/page.tsx");
    atteso("la sezione legge con la sessione del cliente (RLS), mai con la chiave di servizio", /createClient\(\)/.test(pagina) && !/createAdminClient/.test(pagina) && /\.eq\("user_id", user\.id\)/.test(pagina));
    atteso("la sezione è nel menu dell'area riservata", /\/documenti-contrattuali`, label: "Documenti contrattuali"/.test(leggi("src/lib/omnia-ai-account-calcoli.ts")));
    const vista = leggi("src/components/omnia-ai/documenti-contrattuali-vista.tsx");
    atteso("ogni documento ha Leggi e Scarica PDF; il PDF porta l'abbonamento (per la riga dell'accettazione)", /\/pdf\?abbonamento=\$\{g\.abbonamentoId\}/.test(vista) && /Accettato il \{dataOraRoma\(d\.accettatoIl\)\}/.test(vista));
    atteso("data e ora dell'accettazione in evidenza (grassetto) e avviso se mancano dati di fatturazione, con il collegamento al profilo", /<strong>Accettato il/.test(vista) && /Nel profilo azienda mancano/.test(vista) && /profilo-azienda/.test(vista));
    atteso("la cookie policy è presentata come «in vigore all'attivazione», non come accettata", /Versione in vigore al momento dell&apos;attivazione/.test(vista));
    atteso("nelle caselle del checkout l'Allegato A ha il collegamento al PDF, scaricabile prima di accettare", /\$\{allegatoUrl\}\/pdf/.test(leggi("src/components/omnia-ai/consensi-abbonamento.tsx")));
    atteso("nessun riferimento alla console nei file nuovi dell'area AI", ![pagina, vista, route].some((t) => /site-console|CONSOLE_BASE_URL|lib\/console/.test(t)));
  }

  if (fallimenti.length > 0) {
    console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nAutotest dei PDF legali e dei documenti contrattuali: tutti i casi ok.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
