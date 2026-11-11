import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { caricaLogo } from "@/lib/org-chart-loghi";
import { logAiUsage } from "@/lib/ai-usage";
import { operazionePerRegistro } from "@/lib/anthropic";
import { ErroreOpenAI, postaAOpenAI } from "@/lib/copertina-openai";
import { leggiDocumentoPerCopertina, type DocumentoDaLeggere } from "@/lib/copertina-lettura";
import {
  A4_ALTEZZA_PT,
  A4_LARGHEZZA_PT,
  COPERTINA_ALTEZZA,
  COPERTINA_DIMENSIONE,
  COPERTINA_LARGHEZZA,
  COPERTINA_MODELLO_PREDEFINITO,
  PREFISSO_FILE_COPERTINA,
  copertineDaNomi,
  datiCopertina,
  marcaTempo,
  percorsoCopertina,
  promptCopertina,
  qualitaCopertina,
  scostamentoDaA4,
  usoDaRisposta,
  validaDatiCopertina,
  type CopertinaElenco,
  type Stile,
  type UsoImmagine,
} from "@/lib/copertina-relazione-calcoli";

// Le parti che parlano con l'esterno della copertina della relazione tecnica (OpenAI, storage, immagini). Le regole e il testo del comando
// stanno in copertina-relazione-calcoli.ts, la lettura del disciplinare in copertina-lettura.ts. Prima della generazione tutti i controlli
// (chi può, analisi completata) sono già stati fatti dall'azione.

// già in uso nei test e nel codice che importa da qui
export { ErroreOpenAI };

const URL_GENERAZIONI = "https://api.openai.com/v1/images/generations";
const URL_MODIFICHE = "https://api.openai.com/v1/images/edits";
// La generazione di un'immagine grande può durare più di un minuto; la pagina della gara ha già un tetto di 800 s
const TEMPO_MASSIMO_MS = 280_000;
// I loghi non servono più grandi di così al modello (e più pixel = più token da pagare)
const LATO_MASSIMO_LOGO = 1024;

export type Logo = { png: Buffer };

// Un logo del bucket, pronto da allegare: sempre PNG, ridotto. undefined se manca o non si legge (un logo mancante non è un errore).
export async function leggiLogo(bucket: string, percorso: string | null): Promise<Logo | undefined> {
  const grezzo = await caricaLogo(bucket, percorso);
  if (!grezzo) return undefined;
  const png = await sharp(Buffer.from(grezzo.base64, "base64"))
    .resize({ width: LATO_MASSIMO_LOGO, height: LATO_MASSIMO_LOGO, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return { png };
}

// Il logo del cliente (l'azienda che usa OMNIA AI) sta sul profilo azienda del titolare; la lettura usa la chiave di servizio, come per l'organigramma
export async function leggiPercorsoLogoCliente(admin: SupabaseClient, accountId: string): Promise<string | null> {
  const { data } = await admin.from("companies").select("logo_path").eq("user_id", accountId).maybeSingle<{ logo_path: string | null }>();
  return data?.logo_path ?? null;
}

export function modelloCopertina(env: Record<string, string | undefined> = process.env): string {
  return env.OPENAI_IMAGE_MODEL?.trim() || COPERTINA_MODELLO_PREDEFINITO;
}

// Una richiesta a OpenAI: con loghi allegati usa «modifiche» (le immagini fanno da riferimento), senza usa «generazioni». Il modello risponde
// sempre con l'immagine in base64. `fetchFn` si può sostituire per provare senza rete.
export async function chiediImmagineAOpenAI(params: {
  prompt: string;
  loghi: Logo[];
  apiKey: string;
  modello: string;
  fetchFn?: typeof fetch;
}): Promise<{ immagine: Buffer; uso: UsoImmagine }> {
  const { prompt, loghi, apiKey, modello } = params;
  const comune = { model: modello, prompt, size: COPERTINA_DIMENSIONE, quality: qualitaCopertina(process.env), output_format: "png" };

  let corpo: unknown;
  if (loghi.length > 0) {
    const modulo = new FormData();
    for (const [chiave, valore] of Object.entries({ ...comune, n: "1" })) modulo.append(chiave, valore);
    loghi.forEach((logo, i) => modulo.append("image[]", new Blob([new Uint8Array(logo.png)], { type: "image/png" }), `logo-${i + 1}.png`));
    corpo = await postaAOpenAI({ url: URL_MODIFICHE, apiKey, corpo: modulo, tempoMassimoMs: TEMPO_MASSIMO_MS, fetchFn: params.fetchFn });
  } else {
    corpo = await postaAOpenAI({ url: URL_GENERAZIONI, apiKey, corpo: { ...comune, n: 1 }, tempoMassimoMs: TEMPO_MASSIMO_MS, fetchFn: params.fetchFn });
  }

  const base64 = (corpo as { data?: { b64_json?: unknown }[] } | null)?.data?.[0]?.b64_json;
  if (typeof base64 !== "string" || !base64) throw new ErroreOpenAI("OpenAI non ha restituito nessuna immagine.");
  return { immagine: Buffer.from(base64, "base64"), uso: usoDaRisposta(corpo) };
}

// La pagina esce già A4 dalle dimensioni chieste; se il modello restituisce un formato diverso (oltre l'1,5%) la si porta ad A4 ritagliando
// dal centro, e comunque si riporta alla dimensione prevista (così il PDF e il PNG sono sempre uguali tra una generazione e l'altra).
export async function paginaA4(immagine: Buffer): Promise<{ png: Buffer; larghezza: number; altezza: number }> {
  const meta = await sharp(immagine).metadata();
  if (!meta.width || !meta.height) throw new ErroreOpenAI("L'immagine restituita da OpenAI non è leggibile.");
  const giusta = meta.width === COPERTINA_LARGHEZZA && meta.height === COPERTINA_ALTEZZA;
  if (giusta || scostamentoDaA4(meta.width, meta.height) <= 0.015) {
    // formato A4 già buono: nessun ritaglio, solo la dimensione normalizzata se serve
    const png = giusta ? await sharp(immagine).png().toBuffer() : await sharp(immagine).resize(COPERTINA_LARGHEZZA, COPERTINA_ALTEZZA, { fit: "fill" }).png().toBuffer();
    return { png, larghezza: COPERTINA_LARGHEZZA, altezza: COPERTINA_ALTEZZA };
  }
  const png = await sharp(immagine).resize(COPERTINA_LARGHEZZA, COPERTINA_ALTEZZA, { fit: "cover", position: "centre" }).png().toBuffer();
  return { png, larghezza: COPERTINA_LARGHEZZA, altezza: COPERTINA_ALTEZZA };
}

// Un PDF di una sola pagina A4 con l'immagine a tutta pagina
export async function pdfA4(png: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Copertina relazione tecnica");
  pdf.setProducer("OMNIA AI");
  const pagina = pdf.addPage([A4_LARGHEZZA_PT, A4_ALTEZZA_PT]);
  const immagine = await pdf.embedPng(png);
  pagina.drawImage(immagine, { x: 0, y: 0, width: A4_LARGHEZZA_PT, height: A4_ALTEZZA_PT });
  return Buffer.from(await pdf.save());
}

export type EsitoCopertina =
  // titolo e CIG che sono finiti sulla copertina, il documento da cui sono stati letti e cosa il cliente deve sapere (ripieghi, controlli non possibili)
  | { ok: true; marca: string; stile: Stile; titolo: string; cig: string | null; documento: string; avvisi: string[] }
  | { ok: false; errore: string };

// Genera la copertina di una gara e la salva (PNG + PDF A4) nel bucket «gare». OpenAI legge prima il disciplinare/capitolato scelto (titolo, CIG e
// indicazioni per lo sfondo, con i controlli sul testo del PDF), poi si disegna la pagina. I due loghi si leggono qui: quello della stazione
// appaltante è della gara, quello del cliente è del profilo azienda del titolare (`accountId`: l'account effettivo, anche quando lavora l'Ufficio Gare).
export async function generaCopertina(params: {
  garaId: string;
  accountId: string;
  // lo stile dello sfondo: stilizzato (illustrazione) o realistico (fotografia)
  stile: Stile;
  // i dati già noti della gara: servono come ripiego se il documento non dà titolo o CIG verificabili, e per il settore
  gara: { titolo: string; cig: string | null; stazioneAppaltante: string | null; settore: unknown };
  documento: DocumentoDaLeggere;
  logoStazionePath: string | null;
  logoClientePath: string | null;
  admin?: SupabaseClient;
  // sostituibili per provare senza rete né database
  leggiDocumentoFn?: typeof leggiDocumentoPerCopertina;
  chiediImmagine?: typeof chiediImmagineAOpenAI;
  leggiLogoFn?: typeof leggiLogo;
  registraUso?: typeof logAiUsage;
  adesso?: Date;
}): Promise<EsitoCopertina> {
  const { garaId, accountId, gara, documento, stile } = params;
  const admin = params.admin ?? createAdminClient();
  const leggiDocumento = params.leggiDocumentoFn ?? leggiDocumentoPerCopertina;
  const chiedi = params.chiediImmagine ?? chiediImmagineAOpenAI;
  const leggi = params.leggiLogoFn ?? leggiLogo;
  const registra = params.registraUso ?? logAiUsage;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, errore: "La generazione della copertina non è configurata (manca la chiave di OpenAI)." };

  // in che punto siamo, per dire al cliente cosa non è andato
  let fase: "lettura" | "disegno" | "salvataggio" = "lettura";
  try {
    const letto = await leggiDocumento({ admin, documento, apiKey, titoloGara: gara.titolo, cigGara: gara.cig });
    // il costo si registra appena OpenAI ha risposto, anche se i passaggi dopo dovessero fallire
    await registra({
      userId: accountId,
      garaId,
      operazione: operazionePerRegistro("copertina_relazione_lettura"),
      provider: "openai",
      model: letto.modello,
      inputTokens: letto.uso.inputTokens,
      outputTokens: letto.uso.outputTokens,
    });

    fase = "disegno";
    const [logoStazione, logoCliente] = await Promise.all([leggi("gare", params.logoStazionePath), leggi("company-assets", params.logoClientePath)]);
    const dati = datiCopertina({
      titolo: letto.esito.titolo,
      cig: letto.esito.cig,
      // il nome dell'ente serve solo come contesto: se l'analisi non l'ha trovato vale quello letto nel documento
      stazioneAppaltante: gara.stazioneAppaltante ?? letto.lettura.ente,
      settore: gara.settore,
      direzione: letto.lettura.direzione,
      stile,
      logoStazione: Boolean(logoStazione),
      logoCliente: Boolean(logoCliente),
    });
    const valido = validaDatiCopertina(dati);
    if (!valido.ok) return { ok: false, errore: valido.errore };
    const loghi = [logoStazione, logoCliente].filter((l): l is Logo => Boolean(l));

    const modello = modelloCopertina();
    const { immagine, uso } = await chiedi({ prompt: promptCopertina(dati), loghi, apiKey, modello });
    await registra({
      userId: accountId,
      garaId,
      // lo stile nel nome: i due stili possono costare in modo diverso e in console si confrontano
      operazione: operazionePerRegistro(`copertina_relazione_${stile}`),
      provider: "openai",
      model: modello,
      inputTokens: uso.inputTokens,
      outputTokens: uso.outputTokens,
    });

    fase = "salvataggio";
    const pagina = await paginaA4(immagine);
    const pdf = await pdfA4(pagina.png);

    const adesso = params.adesso ?? new Date();
    const percorsoPng = percorsoCopertina(garaId, adesso, stile, "png");
    const percorsoPdf = percorsoCopertina(garaId, adesso, stile, "pdf");
    const caricaPng = await admin.storage.from("gare").upload(percorsoPng, pagina.png, { contentType: "image/png", upsert: false });
    if (caricaPng.error) throw new Error(`Salvataggio dell'immagine non riuscito: ${caricaPng.error.message}`);
    const caricaPdf = await admin.storage.from("gare").upload(percorsoPdf, pdf, { contentType: "application/pdf", upsert: false });
    if (caricaPdf.error) {
      // senza il PDF la copertina resterebbe a metà: si toglie anche l'immagine
      await admin.storage.from("gare").remove([percorsoPng]);
      throw new Error(`Salvataggio del PDF non riuscito: ${caricaPdf.error.message}`);
    }
    return { ok: true, marca: marcaTempo(adesso), stile, titolo: dati.titolo, cig: dati.cig, documento: documento.nome_file, avvisi: letto.esito.avvisi };
  } catch (err) {
    console.error(`Copertina relazione: generazione non riuscita (${fase})`, err instanceof Error ? err.message : err);
    if (fase === "lettura") {
      return { ok: false, errore: "Non sono riuscito a leggere il documento scelto. Riprova, oppure scegli un altro documento." };
    }
    if (err instanceof ErroreOpenAI && err.stato === 400 && /safety|moderation|content/i.test(err.message)) {
      return { ok: false, errore: "OpenAI ha rifiutato la richiesta per le sue regole sui contenuti (potrebbe dipendere da uno dei loghi). Controlla i loghi caricati e riprova." };
    }
    return { ok: false, errore: "La generazione della copertina non è riuscita. Riprova tra qualche istante." };
  }
}

// Le copertine già generate per la gara (la più recente per prima), lette dal bucket
export async function elencaCopertine(admin: SupabaseClient, garaId: string): Promise<CopertinaElenco[]> {
  const { data, error } = await admin.storage.from("gare").list(garaId, { limit: 1000, search: PREFISSO_FILE_COPERTINA });
  if (error) {
    console.error("Copertine: elenco dei file non riuscito:", error.message);
    return [];
  }
  return copertineDaNomi((data ?? []).map((voce) => voce.name));
}

// Un link temporaneo (a ora) per mostrare o scaricare un file della copertina
export async function linkCopertina(admin: SupabaseClient, garaId: string, nomeFile: string, scarica?: string): Promise<string | null> {
  const { data, error } = await admin.storage.from("gare").createSignedUrl(`${garaId}/${nomeFile}`, scarica ? 60 : 3600, scarica ? { download: scarica } : undefined);
  if (error || !data) return null;
  return data.signedUrl;
}
