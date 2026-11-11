// Autotest della «Copertina relazione tecnica» (pulsante dentro la gara che chiede a OpenAI una copertina A4).
// Controlla, senza rete né database (OpenAI e storage sono sostituiti da finti):
//   - il comando è quello dell'utente, parola per parola, con titolo e CIG della gara; un logo mancante NON si chiede (il modello ne inventerebbe uno);
//   - il CIG che non ha la forma giusta non si stampa; senza CIG resta il solo titolo;
//   - il formato è A4 e multiplo di 16 (OpenAI rifiuta le altre dimensioni: errore reale della prima prova);
//   - la richiesta a OpenAI: «modifiche» con i loghi allegati nell'ordine giusto, «generazioni» senza loghi, errori leggibili;
//   - la pagina esce A4 (PNG e PDF di una sola pagina A4); un formato sbagliato viene riportato ad A4;
//   - il salvataggio (PNG + PDF con la stessa data nel nome, mai sopra una copertina precedente) e il costo registrato;
//   - un errore di OpenAI non lascia file a metà né chiede soldi (nessun consumo, nessun file);
//   - i nomi dei file: solo quelli di copertina, sotto la cartella della gara (così la cancellazione della gara li porta via);
//   - il pulsante è spento online (prezzo non deciso) e le guardie dell'azione ci sono.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  A4_ALTEZZA_PT,
  A4_LARGHEZZA_PT,
  COPERTINA_ALTEZZA,
  COPERTINA_DIMENSIONE,
  COPERTINA_LARGHEZZA,
  cigPerCopertina,
  comandoCopertina,
  copertineDaNomi,
  dataDaMarca,
  datiCopertina,
  marcaTempo,
  nomeFileScaricato,
  normalizzaStile,
  percorsoCopertina,
  percorsoCopertinaValido,
  promptCopertina,
  qualitaCopertina,
  rigaTitolo,
  scostamentoDaA4,
  stileDaNomeFile,
  usoDaRisposta,
  validaDatiCopertina,
  ETICHETTA_STILE,
  MESSAGGI_ERRORE_COPERTINA,
  messaggioErroreCopertina,
  STILI,
  CIG_CAMPO_MASSIMO,
  SOTTOTITOLO_MASSIMO,
  TESTI_CLIENTE_VUOTI,
  TITOLO_PRINCIPALE_MASSIMO,
  TITOLO_PRINCIPALE_PREDEFINITO,
  avvisiDopoTestiCliente,
  leggiTestiCliente,
} from "../src/lib/copertina-relazione-calcoli";
import { ErroreOpenAI, chiediImmagineAOpenAI, generaCopertina, modelloCopertina, paginaA4, pdfA4 } from "../src/lib/copertina-relazione";
import { chiediLetturaAOpenAI, leggiDocumentoPerCopertina, modelloLettura, primePagine } from "../src/lib/copertina-lettura";
import {
  ISTRUZIONI_LETTURA,
  LETTURA_PAGINE,
  SCHEMA_LETTURA,
  cigNelTesto,
  documentoPredefinito,
  leggiRispostaLettura,
  normalizzaPerConfronto,
  soloPdf,
  testoDaRisposta,
  verificaLettura,
  type LetturaGara,
} from "../src/lib/copertina-lettura-calcoli";
import { StandardFonts } from "pdf-lib";
import { SETTORI } from "../src/lib/gara-settore";
import { calcolaCostoStimato } from "../src/lib/ai-pricing";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const GARA_ID = "11111111-2222-3333-4444-555555555555";
const base = { titolo: "Servizio di pulizia degli edifici comunali", cig: "B1C2D3E4F5", stazioneAppaltante: "Comune di Valleverde", settore: "pulizie", logoStazione: true, logoCliente: true };

async function png(larghezza: number, altezza: number, colore = "#3366cc"): Promise<Buffer> {
  return sharp({ create: { width: larghezza, height: altezza, channels: 3, background: colore } }).png().toBuffer();
}

async function main() {
  console.log("--- Il comando dell'utente, parola per parola ---");
  {
    const dati = datiCopertina(base);
    const comando = comandoCopertina(dati);
    atteso("prima riga identica a quella scritta dall'utente", comando.startsWith("CREA COPERTINA GRAFICA CON SFONDO COME IMMAGINE IN A4 COERENTE CON IL Disciplinare/Capitolato della gara.\n"));
    atteso("«AL CENTRO SCRIVI: RELAZIONE TECNICA»", comando.includes("\nAL CENTRO SCRIVI: RELAZIONE TECNICA\n"));
    atteso("«SOTTO SEMPRE AL CENTRO SCRIVI: [titolo] - CIG: [cig]»", comando.includes("\nSOTTO SEMPRE AL CENTRO SCRIVI: Servizio di pulizia degli edifici comunali - CIG: B1C2D3E4F5\n"));
    atteso("logo della stazione appaltante IN ALTO A SINISTRA (prima immagine)", comando.includes("IN ALTO A SINISTRA METTI LOGO STAZIONE APPALTANTE (prima immagine allegata)"));
    atteso("logo del cliente IN BASSO A DESTRA (seconda immagine)", comando.includes("IN BASSO A DESTRA METTI LOGO CLIENTE (seconda immagine allegata)"));
    const prompt = promptCopertina(dati);
    atteso("il prompt contiene il comando intero", prompt.startsWith(comando));
    atteso("il prompt dice di riprodurre i loghi identici e di non scrivere altri testi", /IDENTICI/.test(prompt) && /Non scrivere nessun altro testo/.test(prompt));
    atteso("il nome della stazione appaltante è solo contesto (non va scritto)", /non scriverne il nome sulla pagina/.test(prompt));
    atteso("il tipo di servizio è nel contesto (pulizie)", /pulizia, sanificazione e igiene ambientale/.test(prompt));
  }

  console.log("--- Loghi mancanti: mai chiesti ---");
  {
    const soloStazione = comandoCopertina(datiCopertina({ ...base, logoCliente: false }));
    atteso("senza il logo del cliente non si chiede quello in basso a destra", soloStazione.includes("IN ALTO A SINISTRA") && !soloStazione.includes("IN BASSO A DESTRA"));
    const soloCliente = comandoCopertina(datiCopertina({ ...base, logoStazione: false }));
    atteso("senza il logo della stazione appaltante quello del cliente è la PRIMA immagine", !soloCliente.includes("IN ALTO A SINISTRA") && soloCliente.includes("IN BASSO A DESTRA METTI LOGO CLIENTE (prima immagine allegata)"));
    const nessuno = promptCopertina(datiCopertina({ ...base, logoStazione: false, logoCliente: false }));
    atteso("senza loghi non si nomina nessun logo da inserire e si vieta di inventarne", !nessuno.includes("IN ALTO A SINISTRA") && !nessuno.includes("IN BASSO A DESTRA") && /Non inserire nessun logo/.test(nessuno));
    const unoSolo = promptCopertina(datiCopertina({ ...base, logoCliente: false }));
    atteso("con un solo logo si vieta il logo negli angoli non richiesti", /nessun logo negli angoli per cui non è stato richiesto/.test(unoSolo));
  }

  console.log("--- CIG e titolo ---");
  {
    atteso("CIG valido: maiuscolo e senza spazi", cigPerCopertina(" b1c2 d3e4f5 ") === "B1C2D3E4F5");
    atteso("CIG di 9 caratteri: non si stampa", cigPerCopertina("B1C2D3E4F") === null);
    atteso("CIG di 11 caratteri: non si stampa", cigPerCopertina("B1C2D3E4F5A") === null);
    atteso("CIG con simboli: non si stampa", cigPerCopertina("B1C2D3E4-5") === null);
    atteso("CIG non testo (null, numero): non si stampa", cigPerCopertina(null) === null && cigPerCopertina(1234567890) === null);
    const senzaCig = datiCopertina({ ...base, cig: "NON INDICATO" });
    atteso("senza un CIG valido resta il solo titolo, senza «CIG:»", rigaTitolo(senzaCig) === "Servizio di pulizia degli edifici comunali" && !promptCopertina(senzaCig).includes("CIG"));
    atteso("titolo: spazi e a-capo ridotti a uno", datiCopertina({ ...base, titolo: "  Servizio  di\n pulizia\t " }).titolo === "Servizio di pulizia");
    atteso("titolo troppo lungo: tagliato a 300 caratteri", datiCopertina({ ...base, titolo: "a".repeat(500) }).titolo.length === 300);
    atteso("senza titolo non si genera", !validaDatiCopertina(datiCopertina({ ...base, titolo: "   " })).ok && validaDatiCopertina(datiCopertina(base)).ok);
    atteso("settore sconosciuto: contesto neutro (nessuna eccezione)", promptCopertina(datiCopertina({ ...base, settore: "inventato" })).includes("motivi astratti neutri e istituzionali"));
    for (const s of SETTORI) atteso(`settore ${s}: prompt costruibile`, promptCopertina(datiCopertina({ ...base, settore: s })).length > 200);
  }

  console.log("--- Formato A4 ---");
  {
    atteso("larghezza e altezza multipli di 16 (OpenAI rifiuta le altre)", COPERTINA_LARGHEZZA % 16 === 0 && COPERTINA_ALTEZZA % 16 === 0, `${COPERTINA_DIMENSIONE}`);
    atteso("rapporto A4 con scarto sotto lo 0,1%", scostamentoDaA4(COPERTINA_LARGHEZZA, COPERTINA_ALTEZZA) < 0.001, String(scostamentoDaA4(COPERTINA_LARGHEZZA, COPERTINA_ALTEZZA)));
    atteso("sotto il limite di 8,3 megapixel di OpenAI e sopra il minimo di 0,65", COPERTINA_LARGHEZZA * COPERTINA_ALTEZZA <= 8_294_400 && COPERTINA_LARGHEZZA * COPERTINA_ALTEZZA >= 655_360);
    atteso("la dimensione 1680×2376 (rifiutata da OpenAI nella prima prova) è scartata dal controllo", 2376 % 16 !== 0);
    atteso("scostamento: quadrato lontano da A4, A4 vicino a zero", scostamentoDaA4(1000, 1000) > 0.25 && scostamentoDaA4(1000, 1414) < 0.001 && scostamentoDaA4(0, 100) === Infinity);
    atteso("pagina PDF A4 in punti", Math.abs(A4_LARGHEZZA_PT - 595.28) < 0.01 && Math.abs(A4_ALTEZZA_PT - 841.89) < 0.01);
  }

  console.log("--- La richiesta a OpenAI (finta) ---");
  {
    let ultima: { url: string; init: RequestInit } | null = null;
    const finto = (corpo: unknown, stato = 200): typeof fetch =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        ultima = { url: String(url), init: init ?? {} };
        return new Response(JSON.stringify(corpo), { status: stato, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;
    const immagine = await png(40, 56);
    const risposta = { data: [{ b64_json: immagine.toString("base64") }], usage: { input_tokens: 1540, output_tokens: 2264 } };

    // con i loghi: modifiche
    const logo1 = { png: await png(30, 20, "#ff0000") };
    const logo2 = { png: await png(30, 20, "#00ff00") };
    const conLoghi = await chiediImmagineAOpenAI({ prompt: "PROVA", loghi: [logo1, logo2], apiKey: "chiave-finta", modello: "gpt-image-2", fetchFn: finto(risposta) });
    const richiestaModifiche = ultima as { url: string; init: RequestInit } | null;
    atteso("con i loghi usa l'endpoint delle modifiche", richiestaModifiche?.url === "https://api.openai.com/v1/images/edits");
    const modulo = richiestaModifiche?.init.body as FormData;
    atteso("la chiave va nell'intestazione, non nel corpo", (richiestaModifiche?.init.headers as Record<string, string>).Authorization === "Bearer chiave-finta" && ![...modulo.keys()].includes("apiKey"));
    atteso("i loghi sono allegati in ordine come image[]", modulo.getAll("image[]").length === 2 && (modulo.getAll("image[]")[0] as File).name === "logo-1.png" && (modulo.getAll("image[]")[1] as File).name === "logo-2.png");
    atteso("modello, formato, qualità e prompt nella richiesta", modulo.get("model") === "gpt-image-2" && modulo.get("size") === COPERTINA_DIMENSIONE && modulo.get("quality") === "medium" && modulo.get("prompt") === "PROVA" && modulo.get("n") === "1");
    atteso("risponde con l'immagine e i token", conLoghi.immagine.length > 0 && conLoghi.uso.inputTokens === 1540 && conLoghi.uso.outputTokens === 2264);

    // senza loghi: generazioni (JSON)
    await chiediImmagineAOpenAI({ prompt: "PROVA", loghi: [], apiKey: "chiave-finta", modello: "gpt-image-2", fetchFn: finto(risposta) });
    const richiestaGenerazioni = ultima as { url: string; init: RequestInit } | null;
    atteso("senza loghi usa l'endpoint delle generazioni", richiestaGenerazioni?.url === "https://api.openai.com/v1/images/generations");
    const corpoJson = JSON.parse(String(richiestaGenerazioni?.init.body));
    atteso("il corpo JSON ha il formato A4 e n numerico", corpoJson.size === COPERTINA_DIMENSIONE && corpoJson.n === 1 && corpoJson.model === "gpt-image-2");

    // errori
    const errore400 = await chiediImmagineAOpenAI({ prompt: "P", loghi: [], apiKey: "k", modello: "m", fetchFn: finto({ error: { message: "Invalid size" } }, 400) }).then(
      () => null,
      (e) => e,
    );
    atteso("errore 400: messaggio con lo stato e il dettaglio di OpenAI", errore400 instanceof ErroreOpenAI && errore400.stato === 400 && /400/.test(errore400.message) && /Invalid size/.test(errore400.message));
    const senzaImmagine = await chiediImmagineAOpenAI({ prompt: "P", loghi: [], apiKey: "k", modello: "m", fetchFn: finto({ data: [] }) }).then(
      () => null,
      (e) => e,
    );
    atteso("risposta senza immagine: errore chiaro", senzaImmagine instanceof ErroreOpenAI && /nessuna immagine/.test(senzaImmagine.message));
    const nonJson = await chiediImmagineAOpenAI({ prompt: "P", loghi: [], apiKey: "k", modello: "m", fetchFn: (async () => new Response("<html>502</html>", { status: 502 })) as typeof fetch }).then(
      () => null,
      (e) => e,
    );
    atteso("risposta non JSON (502): errore, non un crash", nonJson instanceof ErroreOpenAI && nonJson.stato === 502);
    const caduta = await chiediImmagineAOpenAI({ prompt: "P", loghi: [], apiKey: "k", modello: "m", fetchFn: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch }).then(
      () => null,
      (e) => e,
    );
    atteso("connessione caduta: errore leggibile", caduta instanceof ErroreOpenAI && /Connessione a OpenAI non riuscita/.test(caduta.message));

    atteso("usoDaRisposta: valori assenti o non numerici → null", usoDaRisposta({}).inputTokens === null && usoDaRisposta({ usage: { input_tokens: "x", output_tokens: -1 } }).outputTokens === null && usoDaRisposta(null).inputTokens === null);
    atteso("modello: quello predefinito, o quello della variabile OPENAI_IMAGE_MODEL", modelloCopertina({}) === "gpt-image-2" && modelloCopertina({ OPENAI_IMAGE_MODEL: " gpt-image-1.5 " }) === "gpt-image-1.5");
  }

  console.log("--- La pagina A4 (PNG e PDF) ---");
  {
    const giusta = await paginaA4(await png(COPERTINA_LARGHEZZA, COPERTINA_ALTEZZA));
    atteso("già A4: stessa dimensione", giusta.larghezza === COPERTINA_LARGHEZZA && giusta.altezza === COPERTINA_ALTEZZA);
    const quasi = await paginaA4(await png(1000, 1415));
    const metaQuasi = await sharp(quasi.png).metadata();
    atteso("quasi A4 (scarto minimo): riportata alla dimensione prevista", metaQuasi.width === COPERTINA_LARGHEZZA && metaQuasi.height === COPERTINA_ALTEZZA);
    const quadrata = await paginaA4(await png(1024, 1024));
    const metaQuadrata = await sharp(quadrata.png).metadata();
    atteso("formato sbagliato (quadrato): ritagliata ad A4", metaQuadrata.width === COPERTINA_LARGHEZZA && metaQuadrata.height === COPERTINA_ALTEZZA);
    const illeggibile = await paginaA4(Buffer.from("non è un'immagine")).then(
      () => null,
      (e) => e,
    );
    atteso("immagine non leggibile: errore, non un file rotto", illeggibile !== null);

    const pdfBuffer = await pdfA4(giusta.png);
    const pdf = await PDFDocument.load(pdfBuffer);
    const { width, height } = pdf.getPage(0).getSize();
    atteso("PDF: una sola pagina, A4", pdf.getPageCount() === 1 && Math.abs(width - A4_LARGHEZZA_PT) < 0.5 && Math.abs(height - A4_ALTEZZA_PT) < 0.5, `${width}×${height}`);
    atteso("PDF vero (intestazione %PDF)", pdfBuffer.subarray(0, 4).toString() === "%PDF");
  }

  console.log("--- Generazione e salvataggio (storage finto) ---");
  {
    const caricati: { percorso: string; tipo?: string; upsert?: boolean }[] = [];
    const rimossi: string[][] = [];
    let erroreSulPdf = false;
    const admin = {
      storage: {
        from: (bucket: string) => ({
          upload: async (percorso: string, _corpo: unknown, opzioni?: { contentType?: string; upsert?: boolean }) => {
            if (bucket !== "gare") return { error: { message: "bucket sbagliato" } };
            if (erroreSulPdf && percorso.endsWith(".pdf")) return { error: { message: "disco pieno" } };
            caricati.push({ percorso, tipo: opzioni?.contentType, upsert: opzioni?.upsert });
            return { error: null };
          },
          remove: async (percorsi: string[]) => {
            rimossi.push(percorsi);
            return { error: null };
          },
        }),
      },
    };
    const usi: Record<string, unknown>[] = [];
    const promptRicevuti: string[] = [];
    let loghiRicevuti = -1;
    const adesso = new Date("2026-11-10T15:30:00Z");
    // la lettura del documento finta: titolo e CIG del DISCIPLINARE (diversi da quelli della gara), con la sua direzione artistica
    const direzioneLetta = { tipoServizio: "pulizia e sanificazione di edifici comunali", luoghi: ["scuole dell'infanzia", "biblioteca civica"], territorio: "colline e vigneti", direzioneStilizzata: "Sagome stilizzate di scuole e biblioteca, collina con vigneti; palette blu petrolio e verde salvia.", direzioneRealistica: "Fotografia di un corridoio scolastico luminoso con il pavimento lucido." };
    let avvisiLettura: string[] = [];
    let documentoLetto = "";
    const comuni = {
      garaId: GARA_ID,
      accountId: "account-finto",
      stile: "stilizzato" as const,
      gara: { titolo: "Gara pulizie (titolo scritto dal cliente)", cig: null as string | null, stazioneAppaltante: base.stazioneAppaltante, settore: "pulizie" },
      documento: { file_path: `${GARA_ID}/disciplinare.pdf`, nome_file: "Disciplinare di gara.pdf" },
      logoStazionePath: "gara/logo.png",
      logoClientePath: "azienda/logo.png",
      admin: admin as never,
      leggiLogoFn: async (_bucket: string, percorso: string | null) => (percorso ? { png: await png(30, 20) } : undefined),
      leggiDocumentoFn: (async (p: { documento: { nome_file: string }; titoloGara: string; cigGara: string | null }) => {
        documentoLetto = p.documento.nome_file;
        return {
          lettura: { titolo: base.titolo, cig: "B1C2D3E4F5", ente: "Comune di Valleverde", direzione: direzioneLetta },
          esito: { titolo: base.titolo, cig: "B1C2D3E4F5", titoloDaDocumento: true, cigDaDocumento: true, verificatoSulTesto: true, avvisi: avvisiLettura },
          uso: { inputTokens: 1500, outputTokens: 500 },
          modello: "gpt-5.4-mini",
        };
      }) as never,
      registraUso: async (u: Record<string, unknown>) => {
        usi.push(u);
      },
      chiediImmagine: (async (p: { prompt: string; loghi: unknown[] }) => {
        promptRicevuti.push(p.prompt);
        loghiRicevuti = p.loghi.length;
        return { immagine: await png(COPERTINA_LARGHEZZA, COPERTINA_ALTEZZA), uso: { inputTokens: 1540, outputTokens: 2264 } };
      }) as never,
      adesso,
    };
    const apiKeyPrecedente = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "chiave-finta";

    const esito = await generaCopertina(comuni as never);
    atteso("generazione riuscita, con la data nel risultato", esito.ok && esito.marca === "20261110T153000Z");
    atteso("titolo e CIG sulla copertina sono quelli del DOCUMENTO (non quelli scritti dal cliente nella gara)", esito.ok && esito.titolo === base.titolo && esito.cig === "B1C2D3E4F5" && esito.documento === "Disciplinare di gara.pdf" && documentoLetto === "Disciplinare di gara.pdf");
    atteso("il prompt dell'immagine ha il titolo e il CIG letti, e la direzione artistica del documento", promptRicevuti[0].includes(`SOTTO SEMPRE AL CENTRO SCRIVI: ${base.titolo} - CIG: B1C2D3E4F5`) && promptRicevuti[0].includes("Sagome stilizzate di scuole e biblioteca") && !promptRicevuti[0].includes("Gara pulizie (titolo scritto dal cliente)"));
    atteso("salvati PNG e PDF nel bucket «gare», sotto la cartella della gara, con la stessa data", caricati.length === 2 && caricati[0].percorso === `${GARA_ID}/copertina-20261110T153000Z-stilizzato.png` && caricati[1].percorso === `${GARA_ID}/copertina-20261110T153000Z-stilizzato.pdf`);
    atteso("mai sopra un file precedente (upsert spento)", caricati.every((c) => c.upsert === false));
    atteso("tipi dei file", caricati[0].tipo === "image/png" && caricati[1].tipo === "application/pdf");
    atteso("i due loghi sono arrivati al modello e il prompt nomina entrambi", loghiRicevuti === 2 && /prima immagine allegata/.test(promptRicevuti[0]) && /seconda immagine allegata/.test(promptRicevuti[0]));
    atteso("costi registrati: prima la lettura (modello di testo), poi l'immagine, con provider, token, gara e account", usi.length === 2 && usi[0].provider === "openai" && usi[0].model === "gpt-5.4-mini" && usi[0].inputTokens === 1500 && /copertina_relazione_lettura$/.test(String(usi[0].operazione)) && usi[1].provider === "openai" && usi[1].model === "gpt-image-2" && usi[1].inputTokens === 1540 && usi[1].outputTokens === 2264 && usi[1].garaId === GARA_ID && usi[1].userId === "account-finto" && /copertina_relazione_stilizzato$/.test(String(usi[1].operazione)));

    // lo stile realistico: stesso flusso, direzione fotografica, file con «-realistico», costo con il suo nome; i due stili non si pestano i piedi
    usi.length = 0;
    caricati.length = 0;
    promptRicevuti.length = 0;
    const realistico = await generaCopertina({ ...comuni, stile: "realistico" } as never);
    atteso("stile realistico: generazione riuscita, con lo stile nel risultato", realistico.ok && realistico.stile === "realistico" && realistico.marca === "20261110T153000Z");
    atteso("stile realistico: file «-realistico» (PNG e PDF), accanto a quelli stilizzati senza collisioni", caricati.length === 2 && caricati[0].percorso === `${GARA_ID}/copertina-20261110T153000Z-realistico.png` && caricati[1].percorso === `${GARA_ID}/copertina-20261110T153000Z-realistico.pdf`);
    atteso("stile realistico: il prompt usa la direzione FOTOGRAFICA (non quella grafica) e le note sulla fotografia", promptRicevuti[0].includes("corridoio scolastico luminoso") && !promptRicevuti[0].includes("Sagome stilizzate di scuole") && /FOTOGRAFIA realistica/.test(promptRicevuti[0]) && /STILE REALISTICO/.test(promptRicevuti[0]));
    atteso("stile realistico: la lettura è la stessa (titolo e CIG del documento) e il costo dell'immagine ha il nome dello stile", promptRicevuti[0].includes(`SOTTO SEMPRE AL CENTRO SCRIVI: ${base.titolo} - CIG: B1C2D3E4F5`) && usi.length === 2 && /copertina_relazione_lettura$/.test(String(usi[0].operazione)) && /copertina_relazione_realistico$/.test(String(usi[1].operazione)));
    const stilizzato2 = await generaCopertina({ ...comuni, stile: "stilizzato" } as never);
    atteso("stile stilizzato dopo il realistico: la direzione torna quella grafica", stilizzato2.ok && promptRicevuti[1].includes("Sagome stilizzate di scuole") && !promptRicevuti[1].includes("corridoio scolastico luminoso") && /STILE STILIZZATO/.test(promptRicevuti[1]));
    usi.length = 0;
    caricati.length = 0;
    avvisiLettura = ["Nel documento scelto non ho trovato un CIG."];
    const conAvvisi = await generaCopertina(comuni as never);
    atteso("gli avvisi della lettura arrivano al cliente", conAvvisi.ok && conAvvisi.avvisi.length === 1 && /CIG/.test(conAvvisi.avvisi[0]));
    avvisiLettura = [];
    usi.length = 0;
    caricati.length = 0;

    // un logo che non si legge: la copertina si fa lo stesso, senza quel logo
    caricati.length = 0;
    const senzaUnLogo = await generaCopertina({ ...comuni, logoClientePath: null } as never);
    atteso("logo del cliente assente: copertina fatta con un solo logo", senzaUnLogo.ok && loghiRicevuti === 1 && !/IN BASSO A DESTRA/.test(promptRicevuti[promptRicevuti.length - 1]));

    // ── i testi scritti dal cliente (richiesta dell'11/11/2026): prevalgono sull'estrazione, campo per campo; il documento resta letto per lo sfondo ──
    const ultimoPrompt = () => promptRicevuti[promptRicevuti.length - 1];
    // una lettura finta con gli avvisi divisi per argomento, come li dà verificaLettura: titolo non verificato, CIG non trovato, documento scansionato
    const AVVISO_TITOLO = "Non ho trovato il titolo parola per parola nel documento.";
    const AVVISO_CIG = "Nel documento scelto non ho trovato un CIG: la copertina non lo riporta.";
    const AVVISO_SCANSIONE = "Il documento non ha testo selezionabile (sembra una scansione).";
    let letture = 0;
    const lettoConAvvisi = (titolo: string, cig: string | null) =>
      (async (p: { documento: { nome_file: string } }) => {
        letture++;
        documentoLetto = p.documento.nome_file;
        return {
          lettura: { titolo, cig, ente: "Comune di Valleverde", direzione: direzioneLetta },
          esito: { titolo, cig, titoloDaDocumento: false, cigDaDocumento: false, verificatoSulTesto: false, avvisi: [AVVISO_TITOLO, AVVISO_CIG, AVVISO_SCANSIONE], avvisiTitolo: [AVVISO_TITOLO], avvisiCig: [AVVISO_CIG], avvisiDocumento: [AVVISO_SCANSIONE] },
          uso: { inputTokens: 1500, outputTokens: 500 },
          modello: "gpt-5.4-mini",
        };
      }) as never;
    const tutti = { titoloPrincipale: "RELAZIONE TECNICA - OFFERTA TECNICA", sottotitolo: "Servizio di pulizia dei presidi ospedalieri - Lotto 2", cig: "A9B8C7D6E5" };
    usi.length = 0;
    caricati.length = 0;
    promptRicevuti.length = 0;
    letture = 0;
    const conTutti = await generaCopertina({ ...comuni, leggiDocumentoFn: lettoConAvvisi("Titolo letto dal documento", "B1C2D3E4F5"), testiCliente: tutti } as never);
    atteso("tutti e tre i testi del cliente: sulla pagina ci sono i suoi, e dicono che sono suoi", conTutti.ok && conTutti.titoloPrincipale === tutti.titoloPrincipale && conTutti.titolo === tutti.sottotitolo && conTutti.cig === tutti.cig && conTutti.daCliente.titoloPrincipale && conTutti.daCliente.sottotitolo && conTutti.daCliente.cig);
    atteso(
      "il comando al modello ha i testi del cliente e NESSUNO di quelli estratti (né il titolo letto né il CIG letto né «RELAZIONE TECNICA» da solo)",
      ultimoPrompt().includes(`AL CENTRO SCRIVI: ${tutti.titoloPrincipale}\n`) && ultimoPrompt().includes(`SOTTO SEMPRE AL CENTRO SCRIVI: ${tutti.sottotitolo} - CIG: ${tutti.cig}\n`) && !ultimoPrompt().includes("Titolo letto dal documento") && !ultimoPrompt().includes("B1C2D3E4F5") && !ultimoPrompt().includes("AL CENTRO SCRIVI: RELAZIONE TECNICA\n"),
    );
    atteso("il documento si legge comunque (lo sfondo): la lettura è partita, il suo costo registrato, e la direzione artistica del documento è nel prompt", letture === 1 && documentoLetto === "Disciplinare di gara.pdf" && /copertina_relazione_lettura$/.test(String(usi[0]?.operazione)) && ultimoPrompt().includes("Sagome stilizzate di scuole e biblioteca") && ultimoPrompt().includes("colline e vigneti"));
    atteso("avvisi: con titolo e CIG scritti dal cliente non servono più quelli su titolo, CIG e scansione", conTutti.ok && conTutti.avvisi.length === 0);

    // un testo alla volta: gli altri restano quelli del documento
    const soloCig = await generaCopertina({ ...comuni, leggiDocumentoFn: lettoConAvvisi("Titolo letto dal documento", "B1C2D3E4F5"), testiCliente: { titoloPrincipale: null, sottotitolo: null, cig: "A9B8C7D6E5" } } as never);
    atteso(
      "solo il CIG del cliente: titolo principale di sempre, sottotitolo letto dal documento, CIG del cliente",
      soloCig.ok && soloCig.titoloPrincipale === "RELAZIONE TECNICA" && soloCig.titolo === "Titolo letto dal documento" && soloCig.cig === "A9B8C7D6E5" && !soloCig.daCliente.titoloPrincipale && !soloCig.daCliente.sottotitolo && soloCig.daCliente.cig && ultimoPrompt().includes("AL CENTRO SCRIVI: RELAZIONE TECNICA\n") && ultimoPrompt().includes("Titolo letto dal documento - CIG: A9B8C7D6E5"),
    );
    atteso("solo il CIG del cliente: resta l'avviso sul titolo e quello sulla scansione (riguardano ciò che il cliente NON ha scritto), sparisce quello sul CIG", soloCig.ok && soloCig.avvisi.join("|") === `${AVVISO_TITOLO}|${AVVISO_SCANSIONE}`);
    const soloSottotitolo = await generaCopertina({ ...comuni, leggiDocumentoFn: lettoConAvvisi("Titolo letto dal documento", "B1C2D3E4F5"), testiCliente: { titoloPrincipale: null, sottotitolo: "Mio sottotitolo", cig: null } } as never);
    atteso(
      "solo il sottotitolo del cliente: il CIG resta quello letto dal documento",
      soloSottotitolo.ok && soloSottotitolo.titolo === "Mio sottotitolo" && soloSottotitolo.cig === "B1C2D3E4F5" && soloSottotitolo.daCliente.sottotitolo && !soloSottotitolo.daCliente.cig && ultimoPrompt().includes("SOTTO SEMPRE AL CENTRO SCRIVI: Mio sottotitolo - CIG: B1C2D3E4F5"),
    );
    atteso("solo il sottotitolo del cliente: sparisce l'avviso sul titolo, restano quelli sul CIG e sulla scansione", soloSottotitolo.ok && soloSottotitolo.avvisi.join("|") === `${AVVISO_CIG}|${AVVISO_SCANSIONE}`);
    const soloPrincipale = await generaCopertina({ ...comuni, leggiDocumentoFn: lettoConAvvisi("Titolo letto dal documento", "B1C2D3E4F5"), testiCliente: { titoloPrincipale: "OFFERTA TECNICA MIGLIORATIVA", sottotitolo: null, cig: null } } as never);
    atteso(
      "solo il titolo principale: titolo e CIG letti dal documento, nessun «RELAZIONE TECNICA» rimasto nel comando",
      soloPrincipale.ok && soloPrincipale.titoloPrincipale === "OFFERTA TECNICA MIGLIORATIVA" && soloPrincipale.daCliente.titoloPrincipale && !soloPrincipale.daCliente.sottotitolo && !soloPrincipale.daCliente.cig && ultimoPrompt().includes("AL CENTRO SCRIVI: OFFERTA TECNICA MIGLIORATIVA\n") && !/RELAZIONE TECNICA/.test(ultimoPrompt()) && ultimoPrompt().includes("«OFFERTA TECNICA MIGLIORATIVA» grande e ben visibile"),
    );
    atteso("solo il titolo principale: gli avvisi sul documento restano tutti e tre (il cliente non ha scritto né titolo né CIG)", soloPrincipale.ok && soloPrincipale.avvisi.length === 3);
    // senza testi del cliente (o con tutti vuoti) tutto come prima, avvisi compresi
    const nessuno = await generaCopertina({ ...comuni, leggiDocumentoFn: lettoConAvvisi("Titolo letto dal documento", "B1C2D3E4F5"), testiCliente: TESTI_CLIENTE_VUOTI } as never);
    atteso("testi del cliente tutti vuoti: come prima (titolo e CIG letti, «RELAZIONE TECNICA», tutti gli avvisi)", nessuno.ok && nessuno.titoloPrincipale === "RELAZIONE TECNICA" && nessuno.titolo === "Titolo letto dal documento" && nessuno.cig === "B1C2D3E4F5" && !nessuno.daCliente.titoloPrincipale && !nessuno.daCliente.sottotitolo && !nessuno.daCliente.cig && nessuno.avvisi.length === 3);
    // il documento non dà nessun titolo: con il sottotitolo del cliente si genera lo stesso (prima: errore «la gara non ha un titolo»)
    const gara0 = { titolo: "", cig: null as string | null, stazioneAppaltante: base.stazioneAppaltante, settore: "pulizie" };
    const senzaTitoloLetto = await generaCopertina({ ...comuni, gara: gara0, leggiDocumentoFn: lettoConAvvisi("", null), testiCliente: { titoloPrincipale: null, sottotitolo: "Titolo scritto dal cliente", cig: null } } as never);
    atteso("nessun titolo dal documento né dalla gara, ma il cliente lo scrive: la copertina si genera", senzaTitoloLetto.ok && senzaTitoloLetto.titolo === "Titolo scritto dal cliente" && senzaTitoloLetto.cig === null && !/ - CIG:/.test(ultimoPrompt()));
    const ancoraSenzaTitolo = await generaCopertina({ ...comuni, gara: gara0, leggiDocumentoFn: lettoConAvvisi("", null), testiCliente: { titoloPrincipale: "SOLO IL PRINCIPALE", sottotitolo: null, cig: null } } as never);
    atteso("nessun titolo da nessuna parte e il cliente scrive solo il principale: errore chiaro come prima, immagine mai chiesta", !ancoraSenzaTitolo.ok && /titolo/.test(ancoraSenzaTitolo.errore));
    // difesa in più: anche se arrivasse un testo non ripulito, la pagina non lo mostra lungo né su più righe
    const sporco = await generaCopertina({ ...comuni, testiCliente: { titoloPrincipale: `Titolo\ncon\ta-capo   e  spazi${"x".repeat(200)}`, sottotitolo: null, cig: "  a9b8 c7d6e5 " } } as never);
    atteso(
      "difesa in più: un testo non ripulito arriva al modello su una riga sola e non oltre il massimo; il CIG con spazi e minuscole è normalizzato",
      sporco.ok && !/\n/.test(sporco.titoloPrincipale) && sporco.titoloPrincipale.length <= TITOLO_PRINCIPALE_MASSIMO && sporco.cig === "A9B8C7D6E5" && ultimoPrompt().split("\n").filter((r) => r.startsWith("AL CENTRO SCRIVI:")).length === 1,
    );
    usi.length = 0;
    caricati.length = 0;

    // errore di OpenAI: nessun file, nessun costo
    caricati.length = 0;
    usi.length = 0;
    const errore = await generaCopertina({ ...comuni, chiediImmagine: (async () => { throw new ErroreOpenAI("OpenAI ha rifiutato la richiesta (500): boom", 500); }) as never } as never);
    atteso("errore nel disegno: messaggio per il cliente, nessun file salvato; la lettura già fatta resta registrata, l'immagine mai pagata no", !errore.ok && /Riprova/.test(errore.ok ? "" : errore.errore) && caricati.length === 0 && usi.length === 1 && /copertina_relazione_lettura$/.test(String(usi[0].operazione)));
    atteso("il messaggio al cliente non contiene i dettagli tecnici di OpenAI", !errore.ok && !/boom|500|OpenAI/.test(errore.errore));
    // la lettura del documento non riesce: nessun disegno, nessun file, e un messaggio che dice di scegliere un altro documento
    usi.length = 0;
    promptRicevuti.length = 0;
    const lettura = await generaCopertina({ ...comuni, leggiDocumentoFn: (async () => { throw new ErroreOpenAI("OpenAI non ha restituito una lettura utilizzabile del documento."); }) as never } as never);
    atteso("lettura non riuscita: messaggio dedicato, immagine mai chiesta, nessun file, nessun costo", !lettura.ok && /documento/.test(lettura.errore) && promptRicevuti.length === 0 && caricati.length === 0 && usi.length === 0);
    // titolo vuoto (né nel documento né nella gara): non si disegna
    const senzaTitolo = await generaCopertina({ ...comuni, leggiDocumentoFn: (async () => ({ lettura: { titolo: "", cig: null, ente: null, direzione: direzioneLetta }, esito: { titolo: "", cig: null, titoloDaDocumento: false, cigDaDocumento: false, verificatoSulTesto: true, avvisi: [] }, uso: { inputTokens: 1, outputTokens: 1 }, modello: "gpt-5.4-mini" })) as never } as never);
    atteso("nessun titolo disponibile: errore chiaro e immagine mai chiesta", !senzaTitolo.ok && /titolo/.test(senzaTitolo.errore) && promptRicevuti.length === 0);
    const rifiutato = await generaCopertina({ ...comuni, chiediImmagine: (async () => { throw new ErroreOpenAI("OpenAI ha rifiutato la richiesta (400): Your request was rejected by the safety system", 400); }) as never } as never);
    atteso("rifiuto per le regole sui contenuti: messaggio dedicato che invita a controllare i loghi", !rifiutato.ok && /loghi/.test(rifiutato.errore));

    // la causa vera, non sempre «il documento»: con la chiave rifiutata il cliente non deve sentirsi dire di cambiare documento (successo in produzione l'11/11/2026)
    const M = MESSAGGI_ERRORE_COPERTINA;
    const leggendo = (e: unknown) => generaCopertina({ ...comuni, leggiDocumentoFn: (async () => { throw e; }) as never } as never);
    const disegnando = (e: unknown) => generaCopertina({ ...comuni, chiediImmagine: (async () => { throw e; }) as never } as never);
    const messaggioDi = (r: { ok: boolean; errore?: string }) => (r.ok ? "ok" : (r.errore ?? ""));
    atteso("lettura con la chiave rifiutata da OpenAI (401): «non configurato», NON «scegli un altro documento»", messaggioDi(await leggendo(new ErroreOpenAI("OpenAI ha rifiutato la richiesta (401): Incorrect API key provided", 401))) === M.nonConfigurato && !/altro documento/.test(M.nonConfigurato));
    atteso("lettura con modello non disponibile (404) o senza permessi (403): «non configurato»", messaggioDi(await leggendo(new ErroreOpenAI("OpenAI ha rifiutato la richiesta (404): The model does not exist", 404))) === M.nonConfigurato && messaggioDi(await leggendo(new ErroreOpenAI("OpenAI ha rifiutato la richiesta (403): forbidden", 403))) === M.nonConfigurato);
    atteso("lettura con troppe richieste o credito finito (429): «sovraccarico», riprova tra poco", messaggioDi(await leggendo(new ErroreOpenAI("OpenAI ha rifiutato la richiesta (429): You exceeded your current quota", 429))) === M.sovraccarico && /Riprova/.test(M.sovraccarico));
    atteso("lettura senza risposta in tempo o senza connessione: «troppo tempo», non il documento", messaggioDi(await leggendo(new ErroreOpenAI("OpenAI non ha risposto in tempo."))) === M.lento && messaggioDi(await leggendo(new ErroreOpenAI("Connessione a OpenAI non riuscita: fetch failed"))) === M.lento);
    const documentoNonLeggibile = await Promise.all(
      [new ErroreOpenAI("Non riesco a scaricare il documento dallo spazio di archiviazione."), new ErroreOpenAI("Il PDF è troppo grande per essere letto."), new ErroreOpenAI("OpenAI ha rifiutato la richiesta (400): Invalid file data", 400), new Error("boom")].map((e) => leggendo(e)),
    );
    atteso("lettura: documento davvero non leggibile (non scaricabile, troppo grande, 400 di OpenAI sul file, errore qualunque): resta «scegli un altro documento»", documentoNonLeggibile.every((r) => messaggioDi(r) === M.documento) && /altro documento/.test(M.documento));
    atteso("disegno con la chiave rifiutata (401) o troppe richieste (429): stesse cause, stessi messaggi", messaggioDi(await disegnando(new ErroreOpenAI("OpenAI ha rifiutato la richiesta (401): x", 401))) === M.nonConfigurato && messaggioDi(await disegnando(new ErroreOpenAI("OpenAI ha rifiutato la richiesta (429): x", 429))) === M.sovraccarico);
    atteso("disegno: un errore qualunque resta il messaggio generico, senza dettagli tecnici", messaggioDi(await disegnando(new ErroreOpenAI("OpenAI ha rifiutato la richiesta (500): boom", 500))) === M.generico && messaggioDi(await disegnando(new Error("boom"))) === M.generico);
    atteso("nessun messaggio al cliente contiene dettagli tecnici (codici, nomi di variabili, «boom»)", Object.values(M).every((m) => !/\b(401|403|404|429|500)\b|API_KEY|boom|quota|Bearer/i.test(m)));
    atteso("la funzione dei messaggi non si lascia ingannare: un errore senza stato numerico o un valore che non è un errore", messaggioErroreCopertina({ stato: "401" }, "lettura") === M.documento && messaggioErroreCopertina(null, "disegno") === M.generico && messaggioErroreCopertina(undefined, "lettura") === M.documento);

    // PDF non salvato: l'immagine già caricata si toglie
    caricati.length = 0;
    rimossi.length = 0;
    erroreSulPdf = true;
    const aMeta = await generaCopertina(comuni as never);
    atteso("PDF non salvato: l'errore c'è e il PNG già caricato viene tolto (niente copertine a metà)", !aMeta.ok && rimossi.length === 1 && rimossi[0][0] === `${GARA_ID}/copertina-20261110T153000Z-stilizzato.png`);
    erroreSulPdf = false;

    // senza chiave
    delete process.env.OPENAI_API_KEY;
    const senzaChiave = await generaCopertina(comuni as never);
    atteso("senza la chiave di OpenAI: errore chiaro, nessuna chiamata", !senzaChiave.ok && /chiave/.test(senzaChiave.errore));
    if (apiKeyPrecedente === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = apiKeyPrecedente;
  }

  console.log("--- I testi scritti dal cliente: controlli, comando, avvisi, azione e pannello ---");
  {
    const ok = (g: Parameters<typeof leggiTestiCliente>[0]) => {
      const r = leggiTestiCliente(g);
      return r.ok ? r.testi : null;
    };
    const errore = (g: Parameters<typeof leggiTestiCliente>[0]) => {
      const r = leggiTestiCliente(g);
      return r.ok ? null : r.errore;
    };
    atteso("nessun testo (campi vuoti, spazi, assenti o non testo): nessuna scelta", [{ titoloPrincipale: "", sottotitolo: "", cig: "" }, { titoloPrincipale: "   ", sottotitolo: "\n\t", cig: " " }, { titoloPrincipale: null, sottotitolo: undefined, cig: 12 }].every((g) => { const t = ok(g); return t !== null && t.titoloPrincipale === null && t.sottotitolo === null && t.cig === null; }));
    atteso("i tre testi scritti bene passano come sono (CIG in maiuscolo)", JSON.stringify(ok({ titoloPrincipale: "RELAZIONE TECNICA - OFFERTA TECNICA", sottotitolo: "Servizio di pulizia - Lotto 2", cig: "b1c2d3e4f5" })) === JSON.stringify({ titoloPrincipale: "RELAZIONE TECNICA - OFFERTA TECNICA", sottotitolo: "Servizio di pulizia - Lotto 2", cig: "B1C2D3E4F5" }));
    atteso("spazi di troppo, a-capo e tabulazioni diventano uno spazio (il testo va al modello su una riga sola)", ok({ titoloPrincipale: "  OFFERTA \n\n TECNICA\t2026  ", sottotitolo: "a\r\nb\u0000c\u0007d", cig: "" })?.titoloPrincipale === "OFFERTA TECNICA 2026" && ok({ titoloPrincipale: "", sottotitolo: "a\r\nb\u0000c\u0007d", cig: "" })?.sottotitolo === "a b c d");
    atteso(`i limiti sono ${TITOLO_PRINCIPALE_MASSIMO} caratteri per il titolo principale e ${SOTTOTITOLO_MASSIMO} per il sottotitolo: al limite passa, oltre si RIFIUTA con il motivo (mai accorciato in silenzio)`, ok({ titoloPrincipale: "T".repeat(TITOLO_PRINCIPALE_MASSIMO), sottotitolo: "S".repeat(SOTTOTITOLO_MASSIMO), cig: "" }) !== null && /titolo principale è troppo lungo.*100/.test(errore({ titoloPrincipale: "T".repeat(TITOLO_PRINCIPALE_MASSIMO + 1), sottotitolo: "", cig: "" }) ?? "") && /sottotitolo è troppo lungo.*300/.test(errore({ titoloPrincipale: "", sottotitolo: "S".repeat(SOTTOTITOLO_MASSIMO + 1), cig: "" }) ?? ""));
    atteso("CIG scritto con la scritta davanti o con spazi in mezzo: si capisce lo stesso", ["CIG: B1C2D3E4F5", "cig B1C2D3E4F5", "CIG-B1C2D3E4F5", "CIG.B1C2D3E4F5", "B1C2 D3E4F5", " b1c2d3e4f5 "].every((c) => ok({ titoloPrincipale: "", sottotitolo: "", cig: c })?.cig === "B1C2D3E4F5"));
    atteso("un codice che inizia per «CIG» ma è di 10 caratteri non perde le tre lettere (la scritta si toglie solo se seguita da separatore o spazio)", ok({ titoloPrincipale: "", sottotitolo: "", cig: "CIGABC1234" })?.cig === "CIGABC1234");
    atteso(
      "CIG sbagliato (troppo corto, troppo lungo, simboli): errore chiaro che dice come correggere o lasciare vuoto, nessuna copertina con un CIG inventato",
      ["B12345", "B1C2D3E4F5X", "B1C2D3E4F!", "CIG: 123"].every((c) => /CIG non è valido/.test(errore({ titoloPrincipale: "", sottotitolo: "", cig: c }) ?? "") && /lascialo vuoto/.test(errore({ titoloPrincipale: "", sottotitolo: "", cig: c }) ?? "")),
    );
    atteso("la sola scritta «CIG:» senza codice vale come campo vuoto (nessuna scelta, nessun errore)", ["CIG:", "cig -", "CIG: "].every((c) => { const t = ok({ titoloPrincipale: "", sottotitolo: "", cig: c }); return t !== null && t.cig === null; }));
    atteso("un solo campo sbagliato basta a rifiutare tutto (niente copertina a metà con i campi buoni)", errore({ titoloPrincipale: "OFFERTA TECNICA", sottotitolo: "Sottotitolo buono", cig: "XX" }) !== null && ok({ titoloPrincipale: "OFFERTA TECNICA", sottotitolo: "Sottotitolo buono", cig: "XX" }) === null);
    atteso("il campo CIG della pagina ha spazio per la scritta e gli spazi", CIG_CAMPO_MASSIMO >= "CIG: B1C2 D3E4 F5".length);

    // il comando
    const datiBase = { titolo: base.titolo, cig: base.cig, stazioneAppaltante: base.stazioneAppaltante, settore: base.settore, stile: "stilizzato", logoStazione: true, logoCliente: true };
    const predefinito = datiCopertina(datiBase);
    atteso("titolo principale di base: «RELAZIONE TECNICA» (il comando dell'utente, parola per parola)", predefinito.titoloPrincipale === TITOLO_PRINCIPALE_PREDEFINITO && TITOLO_PRINCIPALE_PREDEFINITO === "RELAZIONE TECNICA" && comandoCopertina(predefinito).split("\n")[1] === "AL CENTRO SCRIVI: RELAZIONE TECNICA");
    atteso("titolo principale vuoto o non testo: torna «RELAZIONE TECNICA»", ["", "   ", null, undefined, 5].every((v) => datiCopertina({ ...datiBase, titoloPrincipale: v }).titoloPrincipale === "RELAZIONE TECNICA"));
    const custom = datiCopertina({ ...datiBase, titoloPrincipale: "RELAZIONE TECNICA - OFFERTA TECNICA", titolo: "Sottotitolo scelto", cig: "A9B8C7D6E5" });
    atteso(
      "titolo principale del cliente: sta nella seconda riga del comando e nella nota sui testi; il sottotitolo e il CIG nella terza",
      comandoCopertina(custom).split("\n")[1] === "AL CENTRO SCRIVI: RELAZIONE TECNICA - OFFERTA TECNICA" && comandoCopertina(custom).split("\n")[2] === "SOTTO SEMPRE AL CENTRO SCRIVI: Sottotitolo scelto - CIG: A9B8C7D6E5" && promptCopertina(custom).includes("«RELAZIONE TECNICA - OFFERTA TECNICA» grande e ben visibile"),
    );
    atteso("il resto del comando non cambia con il titolo principale (prima riga, loghi in alto a sinistra e in basso a destra)", comandoCopertina(custom).split("\n")[0] === comandoCopertina(predefinito).split("\n")[0] && /IN ALTO A SINISTRA METTI LOGO STAZIONE APPALTANTE/.test(comandoCopertina(custom)) && /IN BASSO A DESTRA METTI LOGO CLIENTE/.test(comandoCopertina(custom)));
    atteso("titolo principale troppo lungo che arrivasse fin qui: tagliato al massimo, mai oltre", datiCopertina({ ...datiBase, titoloPrincipale: "x".repeat(500) }).titoloPrincipale.length === TITOLO_PRINCIPALE_MASSIMO);
    atteso("senza CIG il sottotitolo resta solo il titolo, anche con il titolo principale del cliente (mai un CIG inventato)", comandoCopertina(datiCopertina({ ...datiBase, titoloPrincipale: "OFFERTA", cig: null })).split("\n")[2] === `SOTTO SEMPRE AL CENTRO SCRIVI: ${base.titolo}`);

    // gli avvisi, con la vera verificaLettura (divisione per argomento)
    const testoLungo = "Disciplinare di gara per l'affidamento del servizio. ".repeat(40);
    const lett = (t: string, c: string | null): LetturaGara => ({ titolo: t, cig: c, ente: null, direzione: { tipoServizio: "x", luoghi: [], territorio: null, direzioneStilizzata: "a", direzioneRealistica: "b" } });
    const veri = verificaLettura({ lettura: lett("Titolo che nel testo non c'è per niente", null), testoPdf: testoLungo, titoloGara: "Titolo della gara", cigGara: null });
    atteso("verificaLettura divide gli avvisi per argomento (titolo, CIG, documento) senza cambiarne l'ordine né il numero", veri.avvisiTitolo.length === 1 && veri.avvisiCig.length === 1 && veri.avvisiDocumento.length === 0 && veri.avvisi.join("|") === [...veri.avvisiTitolo, ...veri.avvisiCig].join("|"));
    const scansione = verificaLettura({ lettura: lett("Titolo", null), testoPdf: "", titoloGara: "T", cigGara: null });
    atteso("documento senza testo: l'avviso sulla scansione sta tra quelli del documento, dopo gli altri", scansione.avvisiDocumento.length === 1 && scansione.avvisi[scansione.avvisi.length - 1] === scansione.avvisiDocumento[0]);
    const nulla = { titoloPrincipale: null, sottotitolo: null, cig: null };
    atteso("senza testi del cliente (o solo il titolo principale) gli avvisi restano tutti, identici", avvisiDopoTestiCliente(veri, nulla) === veri.avvisi && avvisiDopoTestiCliente(veri, { ...nulla, titoloPrincipale: "X" }).length === veri.avvisi.length);
    atteso("sottotitolo scritto dal cliente: via l'avviso sul titolo, resta quello sul CIG", avvisiDopoTestiCliente(veri, { ...nulla, sottotitolo: "Mio" }).join("|") === veri.avvisiCig.join("|"));
    atteso("CIG scritto dal cliente: via l'avviso sul CIG, resta quello sul titolo", avvisiDopoTestiCliente(veri, { ...nulla, cig: "A9B8C7D6E5" }).join("|") === veri.avvisiTitolo.join("|"));
    atteso("scansione: l'avviso sparisce solo se il cliente ha scritto SIA il titolo SIA il CIG", avvisiDopoTestiCliente(scansione, { ...nulla, sottotitolo: "Mio" }).includes(scansione.avvisiDocumento[0]) && avvisiDopoTestiCliente(scansione, { ...nulla, cig: "A9B8C7D6E5" }).includes(scansione.avvisiDocumento[0]) && !avvisiDopoTestiCliente(scansione, { ...nulla, sottotitolo: "Mio", cig: "A9B8C7D6E5" }).includes(scansione.avvisiDocumento[0]));
    atteso("l'avviso sul titolo rimanda al campo «Sottotitolo centrale» (e non più al titolo della gara in alto)", /Sottotitolo centrale/.test(veri.avvisiTitolo[0]) && !/in alto nella pagina/.test(veri.avvisiTitolo[0]));

    // l'azione del server e il pannello
    const azione = leggi("src/app/actions/gara-copertina.ts");
    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertina-panel.tsx");
    const inizioGenera = azione.indexOf("export async function generaCopertinaGara(");
    const corpoGenera = azione.slice(inizioGenera, azione.indexOf("export type AcquistoCopertinaState"));
    atteso(
      "l'azione legge i tre campi dal modulo, li controlla subito dopo lo stile e PRIMA di database, riserva e gare gratis: un CIG sbagliato non consuma nulla",
      /formData\.get\("testoTitoloPrincipale"\)/.test(corpoGenera) && /formData\.get\("testoSottotitolo"\)/.test(corpoGenera) && /formData\.get\("testoCig"\)/.test(corpoGenera) && corpoGenera.indexOf("leggiTestiCliente(") > corpoGenera.indexOf("normalizzaStile(") && corpoGenera.indexOf("leggiTestiCliente(") < corpoGenera.indexOf('.from("gare")') && corpoGenera.indexOf("leggiTestiCliente(") < corpoGenera.indexOf("riservaCopertina(") && /if \(!testi\.ok\) return \{ error: testi\.errore \}/.test(corpoGenera),
    );
    atteso("l'azione passa i testi controllati a generaCopertina e rimanda alla pagina cosa è finito sulla copertina e quali testi sono del cliente", /testiCliente: testi\.testi/.test(corpoGenera) && /titoloPrincipale: esito\.titoloPrincipale/.test(corpoGenera) && /daCliente: esito\.daCliente/.test(corpoGenera));
    atteso("il documento resta obbligatorio anche se il cliente scrive tutti i testi (serve per lo sfondo)", /Scegli il documento da cui leggere titolo e CIG/.test(corpoGenera) && corpoGenera.indexOf("documentoId") > -1 && corpoGenera.indexOf("Scegli il documento") < corpoGenera.indexOf("riservaCopertina("));
    atteso(
      "il pannello ha i tre campi con i nomi che l'azione legge, ognuno con la sua etichetta, nel modulo che genera",
      ["testoTitoloPrincipale", "testoSottotitolo", "testoCig"].every((n) => new RegExp(`name="${n}"`).test(pannello) && corpoGenera.includes(`"${n}"`)) && ["copertina-titolo-principale", "copertina-sottotitolo", "copertina-cig"].every((id) => new RegExp(`htmlFor="${id}"`).test(pannello) && new RegExp(`id="${id}"`).test(pannello)) && /<fieldset/.test(pannello) && /<legend/.test(pannello),
    );
    atteso(
      "i campi sono CONTROLLATI (restano scritti dopo ogni generazione) e hanno i limiti giusti",
      /value=\{titoloPrincipale\}/.test(pannello) && /value=\{sottotitolo\}/.test(pannello) && /value=\{cig\}/.test(pannello) && /onChange=\{\(e\) => setTitoloPrincipale/.test(pannello) && /onChange=\{\(e\) => setSottotitolo/.test(pannello) && /onChange=\{\(e\) => setCig/.test(pannello) && !/defaultValue=\{(titoloPrincipale|sottotitolo|cig)\}/.test(pannello) && /maxLength=\{TITOLO_PRINCIPALE_MASSIMO\}/.test(pannello) && /maxLength=\{SOTTOTITOLO_MASSIMO\}/.test(pannello) && /maxLength=\{CIG_CAMPO_MASSIMO\}/.test(pannello),
    );
    atteso("il pannello dice che ciò che il cliente scrive ha la precedenza, che un campo vuoto resta quello letto e che il documento serve comunque per lo sfondo", /ha la precedenza su quello letto dal documento/.test(pannello) && /un campo lasciato vuoto resta quello letto/.test(pannello) && /resta comunque usato per lo sfondo/.test(pannello) && /Per esempio: RELAZIONE TECNICA - OFFERTA TECNICA/.test(pannello));
    atteso("dopo la generazione il pannello elenca i tre testi finiti sulla pagina e dice quali sono «scritto da te»", /Titolo principale: <strong>\{state\.titoloPrincipale/.test(pannello) && /Sottotitolo: <strong>\{state\.titolo\}/.test(pannello) && /CIG: <strong>\{state\.cig\}/.test(pannello) && (pannello.match(/scritto da te/g) ?? []).length >= 3 && /Nessun CIG/.test(pannello));
    atteso("i campi del cliente non toccano i pulsanti dei due stili né il conteggio delle generazioni (stesso modulo, stessi valori di «stile»)", /name="stile"/.test(pannello) && /value=\{s\.stile\}/.test(pannello) && /\{s\.fatte\} di \{s\.massime\} generazioni fatte/.test(pannello));
  }

  console.log("--- La direzione artistica nel prompt ---");
  {
    const direzione = { tipoServizio: "pulizia e sanificazione di edifici comunali", luoghi: ["scuole dell'infanzia", "biblioteca civica"], territorio: "colline e vigneti", direzioneStilizzata: "Sagome stilizzate di scuole e biblioteca; palette blu petrolio.", direzioneRealistica: "Fotografia del lungolago con i platani al mattino." };
    const prompt = promptCopertina(datiCopertina({ ...base, direzione }));
    atteso("la direzione artistica del documento è nel prompt, con luoghi e territorio", prompt.includes("DIREZIONE ARTISTICA") && prompt.includes("Sagome stilizzate di scuole e biblioteca") && prompt.includes("scuole dell'infanzia; biblioteca civica") && prompt.includes("Territorio: colline e vigneti"));
    atteso("senza uno stile il prompt è quello stilizzato (come prima della scelta)", prompt.includes("STILE STILIZZATO") && !prompt.includes("Fotografia del lungolago") && datiCopertina({ ...base }).stile === "stilizzato");

    // lo stile realistico
    const real = promptCopertina(datiCopertina({ ...base, direzione, stile: "realistico" }));
    atteso("stile realistico: il comando dell'utente resta intatto in testa al prompt", real.startsWith(comandoCopertina(datiCopertina({ ...base, direzione, stile: "realistico" }))) && real.includes("SOTTO SEMPRE AL CENTRO SCRIVI: Servizio di pulizia degli edifici comunali - CIG: B1C2D3E4F5"));
    atteso("stile realistico: la direzione è quella FOTOGRAFICA, con luoghi e territorio", real.includes("STILE REALISTICO") && real.includes("Fotografia del lungolago con i platani al mattino.") && !real.includes("Sagome stilizzate di scuole") && real.includes("scuole dell'infanzia; biblioteca civica") && real.includes("Territorio: colline e vigneti"));
    atteso("stile realistico: è una fotografia, non un'illustrazione", /FOTOGRAFIA realistica a tutta pagina/.test(real) && /Non un'illustrazione/.test(real));
    atteso("stile realistico: nessuna scritta, bandiera o volto riconoscibile nella foto", /nessuna scritta leggibile/.test(real) && /bandiere/.test(real) && /senza volti riconoscibili/.test(real));
    atteso("stile realistico: velatura chiara sulla fascia centrale perché i testi si leggano sulla foto", /velatura chiara/.test(real) && /fascia centrale/.test(real));
    atteso("stile realistico: i loghi su pannelli bianchi, identici all'originale", /pannelli bianchi/.test(real) && /IDENTICI/.test(real) && !/Mettili su un'area chiara o neutra/.test(real));
    atteso("stile stilizzato: niente fotografia né velatura, loghi su area chiara", !/FOTOGRAFIA realistica/.test(prompt) && !/velatura/.test(prompt) && /area chiara o neutra/.test(prompt));
    const realSenza = promptCopertina(datiCopertina({ ...base, direzione: null, stile: "realistico" }));
    atteso("stile realistico senza la lettura del documento: ripiego fotografico sul settore", realSenza.includes("Sfondo fotografico coerente con il tema della gara: una fotografia di ambienti puliti e luminosi") && !realSenza.includes("motivi astratti"));
    atteso("stile realistico senza CIG: nessuna menzione del CIG nel prompt", !promptCopertina(datiCopertina({ ...base, cig: null, direzione, stile: "realistico" })).includes("CIG"));
    atteso("stile non valido: ripiego sullo stilizzato (mai un prompt senza stile)", datiCopertina({ ...base, stile: "cartoon" }).stile === "stilizzato" && normalizzaStile("realistico") === "realistico" && normalizzaStile(" stilizzato ") === "stilizzato" && normalizzaStile("cartoon") === null && normalizzaStile(undefined) === null && normalizzaStile("") === null);
    atteso("gli stili sono due, con la loro etichetta", STILI.length === 2 && ETICHETTA_STILE.stilizzato === "Stile stilizzato" && ETICHETTA_STILE.realistico === "Stile realistico");
    atteso("il tipo di servizio è quello letto nel documento", prompt.includes("Tipo di servizio: pulizia e sanificazione di edifici comunali."));
    atteso("le illustrazioni non devono contenere scritte, insegne, bandiere (difetto visto nelle prove)", /NESSUNA scritta/.test(prompt) && /insegne/.test(prompt) && /bandiere/.test(prompt));
    atteso("la fascia centrale resta libera per i testi", /fascia centrale/.test(prompt) && /molto semplice, chiaro e senza dettagli/.test(prompt));
    atteso("la palette segue i loghi e lo stile è professionale, non generico", /armonizza con i colori dei loghi/.test(prompt) && /NON un modello generico|non un modello generico/.test(prompt));
    atteso("il comando dell'utente resta la prima parte del prompt, intatto", prompt.startsWith(comandoCopertina(datiCopertina({ ...base, direzione }))));
    const senza = promptCopertina(datiCopertina({ ...base, direzione: null }));
    atteso("senza la lettura del documento si ripiega sul motivo del settore", senza.includes("motivi astratti che richiamino pulizia") && !senza.includes("Territorio:"));
    atteso("qualità dell'immagine: media di base, alta se richiesta, valori strani ignorati", qualitaCopertina({}) === "medium" && qualitaCopertina({ OPENAI_IMAGE_QUALITY: " High " }) === "high" && qualitaCopertina({ OPENAI_IMAGE_QUALITY: "ultra" }) === "medium");
  }

  console.log("--- Lettura del disciplinare: la risposta del modello ---");
  {
    const valida = { titolo: "  Servizio di pulizia\n degli edifici  ", cig: " b1c2 d3e4f5 ", ente: "Comune di Valleverde", tipo_servizio: "pulizia", luoghi: ["scuole", " biblioteca ", "", "palestra", "centro anziani", "municipio", "parco", "settimo luogo"], territorio: "colline", direzione_stilizzata: "Sagome di scuole.", direzione_realistica: "Foto di un corridoio." };
    const lettura = leggiRispostaLettura(JSON.stringify(valida));
    atteso("risposta valida: campi ripuliti (spazi, CIG maiuscolo senza spazi)", lettura?.titolo === "Servizio di pulizia degli edifici" && lettura.cig === "B1C2D3E4F5" && lettura.ente === "Comune di Valleverde");
    atteso("i luoghi sono al massimo 6, senza voci vuote", lettura?.direzione.luoghi.length === 6 && lettura.direzione.luoghi[1] === "biblioteca");
    atteso("CIG che non ha la forma giusta (es. un CUP di 15 caratteri): scartato", leggiRispostaLettura(JSON.stringify({ ...valida, cig: "J12B25000120004" }))?.cig === null);
    atteso("senza titolo o senza una delle due direzioni artistiche la lettura non è utilizzabile", leggiRispostaLettura(JSON.stringify({ ...valida, titolo: " " })) === null && leggiRispostaLettura(JSON.stringify({ ...valida, direzione_stilizzata: "" })) === null && leggiRispostaLettura(JSON.stringify({ ...valida, direzione_realistica: " " })) === null);
    atteso("le due direzioni arrivano separate, una per stile", lettura?.direzione.direzioneStilizzata === "Sagome di scuole." && lettura.direzione.direzioneRealistica === "Foto di un corridoio.");
    atteso("JSON rotto, vuoto, non oggetto: nessuna eccezione, risposta non utilizzabile", leggiRispostaLettura("{rotto") === null && leggiRispostaLettura(null) === null && leggiRispostaLettura("42") === null);
    atteso("le direzioni artistiche troppo lunghe sono tagliate (finiscono in un altro prompt)", (leggiRispostaLettura(JSON.stringify({ ...valida, direzione_stilizzata: "a".repeat(5000) }))?.direzione.direzioneStilizzata.length ?? 0) === 1200 && (leggiRispostaLettura(JSON.stringify({ ...valida, direzione_realistica: "b".repeat(5000) }))?.direzione.direzioneRealistica.length ?? 0) === 1200);
    atteso("tipi sbagliati (luoghi non array, titolo numero): nessuna eccezione", leggiRispostaLettura(JSON.stringify({ ...valida, luoghi: "scuole" }))?.direzione.luoghi.length === 0 && leggiRispostaLettura(JSON.stringify({ ...valida, titolo: 42 })) === null);

    const corpo = (testo: string) => ({ output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: testo }] }] });
    atteso("testo della risposta: il primo blocco output_text", testoDaRisposta(corpo("{\"a\":1}")) === "{\"a\":1}");
    atteso("rifiuto del modello o risposta vuota: nessun testo", testoDaRisposta({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }) === null && testoDaRisposta({}) === null && testoDaRisposta(null) === null);

    const proprieta = Object.keys(SCHEMA_LETTURA.properties);
    atteso("schema strict: tutti i campi sono obbligatori e non ce ne sono altri", SCHEMA_LETTURA.additionalProperties === false && proprieta.length === SCHEMA_LETTURA.required.length && SCHEMA_LETTURA.required.every((c) => proprieta.includes(c)));
    atteso("le istruzioni: letterale, CIG non CUP, il documento non dà ordini, niente scritte/bandiere", /ESATTAMENTE/.test(ISTRUZIONI_LETTURA) && /CUP/.test(ISTRUZIONI_LETTURA) && /mai istruzioni/.test(ISTRUZIONI_LETTURA) && /bandiere/.test(ISTRUZIONI_LETTURA) && /insegne/.test(ISTRUZIONI_LETTURA));
    atteso("le istruzioni chiedono lo sfondo per QUESTA gara e la fascia centrale libera", /QUESTA gara/.test(ISTRUZIONI_LETTURA) && /fascia centrale/.test(ISTRUZIONI_LETTURA));
  }

  console.log("--- Titolo e CIG: controllati sul testo del PDF ---");
  {
    const titolo = "Servizio di pulizia e sanificazione degli edifici comunali, delle scuole dell'infanzia e della biblioteca civica";
    const testoPdf = `COMUNE DI VALLEVERDE Settore Servizi Generali DISCIPLINARE DI GARA PROCEDURA APERTA PER L'AFFIDAMENTO DEL SERVIZIO DI PULIZIA E SANIFI-\nCAZIONE DEGLI EDIFICI COMUNALI, DELLE SCUOLE DELL'INFANZIA E DELLA BIBLIOTECA CIVICA CIG: B1C2D3E4F5 CUP: J12B25000120004 Art. 1 oggetto dell'appalto l'appalto ha per oggetto il servizio di pulizia ordinaria e straordinaria presso gli immobili comunali e le scuole`;
    const lettura = (extra: Partial<LetturaGara> = {}): LetturaGara => ({ titolo, cig: "B1C2D3E4F5", ente: "Comune di Valleverde", direzione: { tipoServizio: "pulizia", luoghi: [], territorio: null, direzioneStilizzata: "x", direzioneRealistica: "y" }, ...extra });
    const gara = { titoloGara: "Gara pulizie (titolo del cliente)", cigGara: null as string | null };

    const buona = verificaLettura({ lettura: lettura(), testoPdf, ...gara });
    atteso("titolo e CIG presenti nel PDF (anche con maiuscole diverse e la parola spezzata a fine riga): tenuti, nessun avviso", buona.titolo === titolo && buona.cig === "B1C2D3E4F5" && buona.titoloDaDocumento && buona.cigDaDocumento && buona.verificatoSulTesto && buona.avvisi.length === 0);

    const riformulato = verificaLettura({ lettura: lettura({ titolo: "Servizio di igiene degli stabili del Comune" }), testoPdf, ...gara });
    atteso("titolo riformulato dal modello (non scritto nel PDF): si usa il titolo della gara e si avvisa", riformulato.titolo === "Gara pulizie (titolo del cliente)" && !riformulato.titoloDaDocumento && riformulato.avvisi.some((a) => /titolo/.test(a)));
    const troppoCorto = verificaLettura({ lettura: lettura({ titolo: "Servizio" }), testoPdf, ...gara });
    atteso("titolo troppo corto per valere come «trovato»: ripiego sul titolo della gara", troppoCorto.titolo === "Gara pulizie (titolo del cliente)");

    const cigSbagliato = verificaLettura({ lettura: lettura({ cig: "B1C2D3E4F6" }), testoPdf, ...gara });
    atteso("CIG con una lettera sbagliata (non nel PDF): NON si stampa, e lo si dice", cigSbagliato.cig === null && !cigSbagliato.cigDaDocumento && cigSbagliato.avvisi.some((a) => /non lo riporta/.test(a)));
    const cigDaAnalisi = verificaLettura({ lettura: lettura({ cig: null }), testoPdf, titoloGara: gara.titoloGara, cigGara: "9A8B7C6D5E" });
    atteso("nessun CIG nel documento ma l'analisi della gara ne ha uno: si usa quello, segnalato", cigDaAnalisi.cig === "9A8B7C6D5E" && !cigDaAnalisi.cigDaDocumento && cigDaAnalisi.avvisi.some((a) => /analisi/.test(a)));
    const cigErratoConAnalisi = verificaLettura({ lettura: lettura({ cig: "ZZZZZZZZZZ" }), testoPdf, titoloGara: gara.titoloGara, cigGara: "B1C2D3E4F5" });
    atteso("CIG del modello non nel PDF: ripiego sul CIG dell'analisi (valido), mai quello inventato", cigErratoConAnalisi.cig === "B1C2D3E4F5");
    const cigDelCup = verificaLettura({ lettura: lettura({ cig: "J12B250001" }), testoPdf, ...gara });
    atteso("un pezzo di un altro codice (le prime 10 lettere del CUP) non vale come CIG: va cercato intero", cigDelCup.cig === null && !cigDelCup.cigDaDocumento);
    atteso("il CIG nel testo: intero sì, dentro un codice più lungo no, con uno spazio a metà sì", cigNelTesto("B1C2D3E4F5", "CIG: B1C2D3E4F5.") && !cigNelTesto("B1C2D3E4F5", "codice XB1C2D3E4F5Y") && !cigNelTesto("B1C2D3E4F5", "B1C2D3E4F512") && cigNelTesto("B1C2D3E4F5", "cig b1c2 d3e4f5 del lotto") && !cigNelTesto("corto", "corto"));

    const scansione = verificaLettura({ lettura: lettura(), testoPdf: "   ", ...gara });
    atteso("PDF senza testo (scansione): si tengono i dati letti e si avvisa di controllarli", scansione.titolo === titolo && scansione.cig === "B1C2D3E4F5" && !scansione.verificatoSulTesto && scansione.avvisi.some((a) => /scansione/.test(a)));
    atteso("normalizzazione: maiuscole, accenti, spazi, trattini e punteggiatura non contano", normalizzaPerConfronto("L'affidamento — Più  semplice-\nmente") === normalizzaPerConfronto("laffidamento piu semplicemente"));
    atteso("il titolo della gara usato come ripiego è ripulito", verificaLettura({ lettura: lettura({ titolo: "Servizio inesistente nel testo del pdf" }), testoPdf, titoloGara: "  Gara   con spazi\n", cigGara: null }).titolo === "Gara con spazi");
  }

  console.log("--- Quale documento leggere ---");
  {
    const docs = [
      { id: "a", nome_file: "Allegato 1 - Modulo offerta.pdf", created_at: "2026-11-01T10:00:00Z" },
      { id: "b", nome_file: "Capitolato speciale d'appalto.pdf", created_at: "2026-11-01T10:01:00Z" },
      { id: "c", nome_file: "Disciplinare di gara.pdf", created_at: "2026-11-01T10:02:00Z" },
      { id: "d", nome_file: "Bando di gara.pdf", created_at: "2026-11-01T10:03:00Z" },
      { id: "e", nome_file: "Disciplinare.docx", created_at: "2026-11-01T10:04:00Z" },
    ];
    atteso("tra i documenti si propone il disciplinare in PDF", documentoPredefinito(docs) === "c");
    atteso("senza disciplinare si propone il capitolato", documentoPredefinito(docs.filter((d) => d.id !== "c")) === "b");
    atteso("senza disciplinare né capitolato si propone il bando", documentoPredefinito(docs.filter((d) => d.id === "a" || d.id === "d")) === "d");
    atteso("un allegato «al disciplinare» non batte il capitolato vero", documentoPredefinito([{ id: "x", nome_file: "Allegato 2 al disciplinare.pdf" }, { id: "y", nome_file: "Capitolato.pdf" }]) === "y");
    atteso("solo allegati o nomi qualunque: il PDF più vecchio", documentoPredefinito([{ id: "p2", nome_file: "doc2.pdf", created_at: "2026-11-02T00:00:00Z" }, { id: "p1", nome_file: "doc1.pdf", created_at: "2026-11-01T00:00:00Z" }]) === "p1");
    atteso("nessun PDF: nessun documento proposto (il Word non si legge)", documentoPredefinito([{ id: "w", nome_file: "Disciplinare.docx" }]) === null && documentoPredefinito([]) === null);
    atteso("elenco da scegliere: solo i PDF", soloPdf(docs).length === 4 && soloPdf(docs).every((d) => d.nome_file.endsWith(".pdf")));
  }

  console.log("--- Lettura con OpenAI (finta) e PDF lungo ---");
  {
    // un PDF di 25 pagine con testo: il titolo e il CIG stanno in pagina 1, un testo riconoscibile in ogni pagina
    async function pdfConTesto(pagine: number, primaPagina: string[]): Promise<Buffer> {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 1; i <= pagine; i++) {
        const pagina = doc.addPage([595, 842]);
        const righe = i === 1 ? primaPagina : [`CONTENUTO PAGINA-${i} del disciplinare di gara con testo sufficiente per essere letto e verificato dal controllo automatico`];
        righe.forEach((r, k) => pagina.drawText(r, { x: 40, y: 780 - k * 18, size: 10, font }));
      }
      return Buffer.from(await doc.save());
    }
    const titoloPdf = "Servizio di pulizia e sanificazione degli edifici comunali e delle scuole";
    // il titolo su una riga a sé, abbastanza corta da stare nella pagina (il testo che esce dal bordo non viene estratto)
    const lungo = await pdfConTesto(25, ["COMUNE DI VALLEVERDE - DISCIPLINARE DI GARA", "PROCEDURA APERTA PER L'AFFIDAMENTO DEL", titoloPdf.toUpperCase(), "CIG: B1C2D3E4F5   CUP: J12B25000120004", "CONTENUTO PAGINA-1 del disciplinare di gara con testo sufficiente per essere letto e verificato dal controllo automatico"]);
    const corto = await pdfConTesto(3, ["DISCIPLINARE"]);

    const tagliato = await primePagine(lungo);
    atteso(`un PDF di 25 pagine si taglia alle prime ${LETTURA_PAGINE}`, (await PDFDocument.load(tagliato)).getPageCount() === LETTURA_PAGINE);
    atteso("un PDF corto resta identico (stesso file)", (await primePagine(corto)) === corto);
    const illeggibile = Buffer.from("questo non è un PDF");
    atteso("un PDF che non si riesce a tagliare piccolo: si manda com'è", (await primePagine(illeggibile)) === illeggibile);
    const enorme = Buffer.alloc(16 * 1024 * 1024, 1);
    const troppoGrande = await primePagine(enorme).then(() => null, (e) => e);
    atteso("un PDF illeggibile E enorme: errore, non si manda a OpenAI", troppoGrande instanceof ErroreOpenAI);

    // OpenAI finto: registra la richiesta e risponde con una lettura
    let richiesta: { url: string; init: RequestInit } | null = null;
    const rispostaLettura = (extra: Record<string, unknown> = {}) => ({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ titolo: titoloPdf, cig: "B1C2D3E4F5", ente: "Comune di Valleverde", tipo_servizio: "pulizia", luoghi: ["scuole"], territorio: null, direzione_stilizzata: "Sagome di scuole.", direzione_realistica: "Foto di una scuola.", ...extra }) }] }],
      usage: { input_tokens: 1500, output_tokens: 600 },
    });
    const fintoOpenAI = (corpo: unknown, stato = 200): typeof fetch =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        richiesta = { url: String(url), init: init ?? {} };
        return new Response(JSON.stringify(corpo), { status: stato, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;

    const esito = await chiediLetturaAOpenAI({ pdf: tagliato, apiKey: "chiave-finta", modello: "gpt-5.4-mini", fetchFn: fintoOpenAI(rispostaLettura()) });
    const r = richiesta as { url: string; init: RequestInit } | null;
    const corpoRichiesta = JSON.parse(String(r?.init.body));
    atteso("la lettura usa l'endpoint delle risposte, con la chiave nell'intestazione", r?.url === "https://api.openai.com/v1/responses" && (r.init.headers as Record<string, string>).Authorization === "Bearer chiave-finta");
    atteso("modello, ragionamento leggero e risposta vincolata allo schema (strict)", corpoRichiesta.model === "gpt-5.4-mini" && corpoRichiesta.reasoning.effort === "low" && corpoRichiesta.text.format.type === "json_schema" && corpoRichiesta.text.format.strict === true);
    const contenuto = corpoRichiesta.input[0].content as { type: string; filename?: string; file_data?: string; text?: string }[];
    atteso("il PDF va come file allegato e le istruzioni come testo", contenuto[0].type === "input_file" && contenuto[0].file_data?.startsWith("data:application/pdf;base64,") === true && contenuto[1].type === "input_text" && contenuto[1].text === ISTRUZIONI_LETTURA);
    const pdfInviato = Buffer.from(String(contenuto[0].file_data).split(",")[1], "base64");
    atteso("il PDF inviato è quello tagliato (10 pagine), non l'intero documento", (await PDFDocument.load(pdfInviato)).getPageCount() === LETTURA_PAGINE);
    atteso("risponde con la lettura e i token", esito.lettura.titolo === titoloPdf && esito.lettura.cig === "B1C2D3E4F5" && esito.uso.inputTokens === 1500 && esito.uso.outputTokens === 600);

    const rifiutata = await chiediLetturaAOpenAI({ pdf: corto, apiKey: "k", modello: "m", fetchFn: fintoOpenAI({ error: { message: "bad" } }, 400) }).then(() => null, (e) => e);
    atteso("errore di OpenAI: ErroreOpenAI con lo stato", rifiutata instanceof ErroreOpenAI && rifiutata.stato === 400);
    const vuota = await chiediLetturaAOpenAI({ pdf: corto, apiKey: "k", modello: "m", fetchFn: fintoOpenAI({ output: [] }) }).then(() => null, (e) => e);
    atteso("risposta senza lettura utilizzabile: errore chiaro", vuota instanceof ErroreOpenAI && /lettura utilizzabile/.test(vuota.message));
    atteso("modello di lettura: quello predefinito, o quello della variabile OPENAI_LETTURA_MODEL", modelloLettura({}) === "gpt-5.4-mini" && modelloLettura({ OPENAI_LETTURA_MODEL: " gpt-5.5 " }) === "gpt-5.5");

    // dal file del bucket alla lettura verificata (storage finto, OpenAI finto)
    const percorsi: string[] = [];
    const scarica = (buffer: Buffer | null) => async (p: string) => {
      percorsi.push(p);
      return buffer;
    };
    const base2 = { admin: {} as never, documento: { file_path: "gara/disciplinare.pdf", nome_file: "Disciplinare di gara.pdf" }, apiKey: "k", titoloGara: "Gara pulizie", cigGara: null };
    const letto = await leggiDocumentoPerCopertina({ ...base2, scarica: scarica(lungo), fetchFn: fintoOpenAI(rispostaLettura()) });
    atteso("documento vero (titolo e CIG in pagina 1): lettura verificata sul testo, nessun avviso", letto.esito.titolo === titoloPdf && letto.esito.cig === "B1C2D3E4F5" && letto.esito.verificatoSulTesto && letto.esito.avvisi.length === 0 && percorsi[0] === "gara/disciplinare.pdf");
    const inventato = await leggiDocumentoPerCopertina({ ...base2, scarica: scarica(lungo), fetchFn: fintoOpenAI(rispostaLettura({ titolo: "Servizio di manutenzione delle strade provinciali", cig: "ZZ99ZZ99ZZ" })) });
    atteso("il modello inventa titolo e CIG: non finiscono sulla copertina (ripiego su gara e nessun CIG)", inventato.esito.titolo === "Gara pulizie" && inventato.esito.cig === null && inventato.esito.avvisi.length === 2);
    const oltreLeDieci = await leggiDocumentoPerCopertina({ ...base2, scarica: scarica(lungo), fetchFn: fintoOpenAI(rispostaLettura({ titolo: "CONTENUTO PAGINA-15 del disciplinare di gara con testo" })) });
    atteso("un titolo che sta SOLO oltre le prime pagine non vale: il testo controllato è quello delle pagine inviate", oltreLeDieci.esito.titolo === "Gara pulizie" && !oltreLeDieci.esito.titoloDaDocumento);
    const senzaTesto = await leggiDocumentoPerCopertina({ ...base2, scarica: scarica(illeggibile), fetchFn: fintoOpenAI(rispostaLettura()) });
    atteso("PDF di cui non si estrae il testo: lettura tenuta con l'avviso di controllare", senzaTesto.esito.titolo === titoloPdf && !senzaTesto.esito.verificatoSulTesto && senzaTesto.esito.avvisi.some((a) => /scansione/.test(a)));
    const nonScaricato = await leggiDocumentoPerCopertina({ ...base2, scarica: scarica(null), fetchFn: fintoOpenAI(rispostaLettura()) }).then(() => null, (e) => e);
    atteso("documento non scaricabile dallo storage: errore, OpenAI mai chiamato", nonScaricato instanceof ErroreOpenAI && /scaricare/.test(nonScaricato.message));
  }

  console.log("--- Nomi dei file ---");
  {
    const data = new Date("2026-11-10T15:30:05.123Z");
    atteso("marca di tempo senza simboli", marcaTempo(data) === "20261110T153005Z");
    atteso("percorso sotto la cartella della gara, con lo stile nel nome (la cancellazione della gara lo porta via)", percorsoCopertina(GARA_ID, data, "stilizzato", "png") === `${GARA_ID}/copertina-20261110T153005Z-stilizzato.png` && percorsoCopertina(GARA_ID, data, "realistico", "pdf") === `${GARA_ID}/copertina-20261110T153005Z-realistico.pdf`);
    atteso("i due stili generati nello stesso istante hanno nomi diversi (nessuna collisione)", percorsoCopertina(GARA_ID, data, "stilizzato", "png") !== percorsoCopertina(GARA_ID, data, "realistico", "png"));
    atteso("data letta dalla marca", dataDaMarca("20261110T153005Z")?.toISOString() === "2026-11-10T15:30:05.000Z" && dataDaMarca("rotta") === null);
    const elenco = copertineDaNomi(["copertina-20261109T100000Z.png", "copertina-20261110T153005Z.png", "copertina-20261110T153005Z.pdf", "copertina-20261109T100000Z.pdf", "altro.pdf", "copertina-orfana.pdf", "copertina-20261111T080000Z.pdf", "relazione.docx"]);
    atteso("elenco: dalla più recente, solo con il PNG, PDF abbinato per data", elenco.length === 2 && elenco[0].marca === "20261110T153005Z" && elenco[0].pdf === "copertina-20261110T153005Z.pdf" && elenco[1].marca === "20261109T100000Z");
    atteso("un PDF senza il suo PNG non conta come copertina", !elenco.some((c) => c.marca === "20261111T080000Z"));
    atteso("nome accettato solo se è un file di copertina", percorsoCopertinaValido(GARA_ID, "copertina-20261110T153005Z.pdf") && percorsoCopertinaValido(GARA_ID, "copertina-20261110T153005Z.png"));
    atteso("nome rifiutato: altro tipo di file, percorso con cartelle, risalita, vuoto", !percorsoCopertinaValido(GARA_ID, "documento.pdf") && !percorsoCopertinaValido(GARA_ID, "../altra-gara/copertina-20261110T153005Z.pdf") && !percorsoCopertinaValido(GARA_ID, "x/copertina-20261110T153005Z.png") && !percorsoCopertinaValido(GARA_ID, "") && !percorsoCopertinaValido(GARA_ID, undefined));
    atteso("id gara rifiutato se non è un identificativo", !percorsoCopertinaValido("../altra", "copertina-20261110T153005Z.png") && !percorsoCopertinaValido("", "copertina-20261110T153005Z.png"));
    const conStili = copertineDaNomi([
      "copertina-20261110T153005Z-stilizzato.png", "copertina-20261110T153005Z-stilizzato.pdf",
      "copertina-20261110T153005Z-realistico.png", "copertina-20261110T153005Z-realistico.pdf",
      "copertina-20261109T100000Z.png", "copertina-20261109T100000Z.pdf",
      "copertina-20261111T080000Z-realistico.pdf", "copertina-20261112T080000Z-cartoon.png",
    ]);
    atteso("due stili nella stessa data: entrambi in elenco, ciascuno col suo PDF; prima la stilizzata", conStili.length === 3 && conStili[0].stile === "stilizzato" && conStili[0].pdf === "copertina-20261110T153005Z-stilizzato.pdf" && conStili[1].stile === "realistico" && conStili[1].pdf === "copertina-20261110T153005Z-realistico.pdf");
    atteso("le copertine di prima della scelta dello stile (senza stile nel nome) valgono come stilizzate", conStili[2].marca === "20261109T100000Z" && conStili[2].stile === "stilizzato" && conStili[2].png === "copertina-20261109T100000Z.png" && conStili[2].pdf === "copertina-20261109T100000Z.pdf");
    atteso("un PDF senza il suo PNG, o uno stile inventato, non sono copertine", !conStili.some((c) => c.marca === "20261111T080000Z" || c.marca === "20261112T080000Z"));
    atteso("un PDF realistico non si abbina al PNG stilizzato della stessa data", copertineDaNomi(["copertina-20261110T153005Z-stilizzato.png", "copertina-20261110T153005Z-realistico.pdf"])[0].pdf === null);
    atteso("stile dal nome del file", stileDaNomeFile("copertina-20261110T153005Z-realistico.png") === "realistico" && stileDaNomeFile("copertina-20261110T153005Z-stilizzato.pdf") === "stilizzato" && stileDaNomeFile("copertina-20261110T153005Z.png") === "stilizzato" && stileDaNomeFile("altro.png") === null);
    atteso("nomi con lo stile accettati; stile inventato e doppi stili rifiutati", percorsoCopertinaValido(GARA_ID, "copertina-20261110T153005Z-realistico.png") && percorsoCopertinaValido(GARA_ID, "copertina-20261110T153005Z-stilizzato.pdf") && !percorsoCopertinaValido(GARA_ID, "copertina-20261110T153005Z-cartoon.png") && !percorsoCopertinaValido(GARA_ID, "copertina-20261110T153005Z-realistico-stilizzato.png") && !percorsoCopertinaValido(GARA_ID, "../copertina-20261110T153005Z-realistico.png"));
    atteso("nome del file scaricato: con lo stile tra parentesi", nomeFileScaricato("Gara pulizie", "pdf", "realistico") === "Copertina relazione tecnica (realistico) - Gara pulizie.pdf");
    atteso("nome del file scaricato: titolo ripulito dai simboli non ammessi", nomeFileScaricato('Gara: "pulizie" / scuole?', "pdf") === "Copertina relazione tecnica - Gara pulizie scuole.pdf");
    atteso("nome del file scaricato: senza titolo", nomeFileScaricato("   ", "png") === "Copertina relazione tecnica.png");
  }

  console.log("--- Costo ---");
  {
    const costo = calcolaCostoStimato("gpt-image-2", 1540, 2264);
    atteso("il modello immagini ha una tariffa (il costo non resta vuoto)", costo !== null && costo > 0.05 && costo < 0.2, String(costo));
  }

  // Chi può generare (acceso/spento, gratis o a pagamento, gare, scadenza, massimo 3 per stile) si prova in scripts/verifica-copertina-diritti.ts.

  console.log("--- Guardie nel codice ---");
  {
    const azione = leggi("src/app/actions/gara-copertina.ts");
    const generazione = azione.slice(azione.indexOf("export async function generaCopertinaGara"), azione.indexOf("export type DownloadCopertinaState"));
    const ordine = ["richiediAccountAzione()", "accessoNegatoPerAccount(", "normalizzaStile(formData.get(\"stile\"))", "estrazione_stato !== \"completata\"", "documentoId", ".endsWith(\".pdf\")", "generaCopertina("].map((s) => generazione.indexOf(s));
    atteso("l'azione controlla, nell'ordine: funzione accesa, sessione, sola lettura, stile valido, analisi completata, documento scelto (PDF), poi genera", ordine.every((p, i) => p >= 0 && (i === 0 || p > ordine[i - 1])), JSON.stringify(ordine));
    atteso("lo stile non ha un valore di ripiego: se non è uno dei due l'azione si ferma", /const stile = normalizzaStile\(formData\.get\("stile"\)\);\s*if \(!stile\) return \{ error:/.test(generazione) && /stile,\s*gara:/.test(generazione));
    atteso("la gara si legge con la sessione (RLS), non con la chiave di servizio", /createClient\(\)[\s\S]*\.from\("gare"\)/.test(generazione) && !/createAdminClient\(\)\s*\.from\("gare"\)/.test(generazione));
    atteso("il documento si cerca TRA quelli della gara con la sessione (RLS): l'identificativo dal browser non basta", /supabase\s*\.from\("gara_documenti"\)[\s\S]*\.eq\("id", documentoId\)[\s\S]*\.eq\("gara_id", garaId\)/.test(generazione) && /\^\[0-9a-f-\]\{36\}\$\/i\.test\(documentoId\)/.test(generazione));
    atteso("l'azione non legge titolo e CIG dal browser: arrivano solo dal documento (o dai dati già in archivio)", !/formData\.get\("(titolo|cig)"\)/.test(generazione));
    const scarico = azione.slice(azione.indexOf("export async function scaricaCopertinaGara"));
    atteso("lo scarico accetta solo i nomi dei file di copertina e controlla la gara con la sessione", scarico.includes("percorsoCopertinaValido(") && scarico.includes("richiediAccountAzione()") && /supabase\.from\("gare"\)/.test(scarico));
    const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
    atteso("il riquadro compare solo se la funzione è accesa e l'analisi è completata", /if \(gara\.estrazione_stato === "completata"\) \{/.test(pagina) && /\{copertinaPannello && <CopertinaPanel/.test(pagina));
    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertina-panel.tsx");
    atteso("due pulsanti, uno per stile, nello stesso modulo: il valore del premuto arriva all'azione", pannello.includes('name="stile"') && pannello.includes("value={s.stile}") && pannello.includes("stili.map((s)") && pannello.includes("Genera copertina relazione tecnica — ") && /type="submit"\s+name="stile"/.test(pannello));
    atteso("il pannello mostra lo stile di ogni copertina e la più recente di ciascuno stile", pannello.includes("ETICHETTA_STILE[c.stile]") && pannello.includes("primaPerStile"));
    atteso("il pannello fa scegliere il documento (solo PDF) e non nomina più OpenAI né i tempi", pannello.includes('name="documentoId"') && !/La crea OpenAI/.test(pannello) && !/in circa un minuto;/.test(pannello));
    atteso("la pagina propone il disciplinare/capitolato e passa solo i PDF", /documentoPredefinito\(pdfDellaGara\)/.test(pagina) && /soloPdf\(documentiOrdinati\)/.test(pagina));
    const lib = leggi("src/lib/copertina-relazione.ts");
    atteso("nessun file sovrascritto e chiave di OpenAI letta solo dal server", lib.includes("upsert: false") && !/NEXT_PUBLIC_[A-Z_]*OPENAI/.test(lib) && lib.includes("process.env.OPENAI_API_KEY"));
  }

  if (fallimenti.length) {
    console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli della copertina della relazione sono superati.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
