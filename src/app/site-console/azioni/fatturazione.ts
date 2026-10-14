"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { STATI_FATTURA, filtroPredefinito, leggiFiltroFattura, type StatoFattura } from "@/lib/console/fatturazione-calcoli";
import { dataRoma } from "@/lib/console/giorni-lavorativi";
import { dataRoma as dataLeggibile } from "@/lib/data-it";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html";
import { creaNotifica } from "@/lib/omnia-ai-notifiche";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { TABELLA_PER_FONTE, percorsoFatturaPagamento } from "@/lib/omnia-ai-pagamenti";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";

// Stato di fatturazione degli incassi OMNIA AI e degli acquisti di crediti, segnato
// a mano, e PDF della fattura caricato sul singolo pagamento (il cliente lo scarica dalla
// sua area riservata, «Pagamenti e fatture»). Ogni azione parte da richiediAdminAzione().
// Tocca SOLO le colonne di fatturazione: importi, date di incasso e id Stripe non si
// modificano mai da qui.

export type StatoAzioneFattura = { errore?: string };

const CHIAVE = /^(incasso|crediti):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
const TABELLE = TABELLA_PER_FONTE;
const MASSIMO_RIGHE = 200;
const DATA_MINIMA = "2020-01-01";
const LIMITE_BYTE_FATTURA = 15 * 1024 * 1024;

type Valori = { stato: StatoFattura; numero: string | null; data: string | null; note: string | null };

// Legge e controlla i campi del modulo. Restituisce i valori da scrivere o il
// messaggio di errore da mostrare.
function leggiModulo(formData: FormData, conNumero: boolean): Valori | string {
  const stato = String(formData.get("stato") ?? "");
  if (!(STATI_FATTURA as string[]).includes(stato)) return "Stato non valido.";

  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const numero = conNumero ? String(formData.get("numero") ?? "").trim() : "";
  const data = String(formData.get("data") ?? "").trim();

  if (stato === "fatturata") {
    if (!GIORNO.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) return "Indica la data della fattura.";
    if (data < DATA_MINIMA || data > dataRoma(new Date())) return "La data della fattura non può essere futura né anteriore al 2020.";
    if (numero.length > 60) return "Il numero della fattura è troppo lungo (massimo 60 caratteri).";
    return { stato, numero: numero === "" ? null : numero, data, note: note === "" ? null : note };
  }
  if (stato === "non_dovuta" && note.length < 3) return "Per una riga «non dovuta» scrivi nelle note perché (es. «duplicato», «storno»).";
  // da fatturare: il numero e la data di una fattura non hanno più senso
  return { stato: stato as StatoFattura, numero: null, data: null, note: note === "" ? null : note };
}

// Aggiorna le righe indicate (chiavi "incasso:<uuid>" / "crediti:<uuid>"). Ritorna
// il numero di righe aggiornate o un messaggio di errore.
async function applica(chiavi: string[], v: Valori, userId: string, extra: Record<string, unknown> = {}): Promise<number | string> {
  const perTabella: Record<keyof typeof TABELLE, string[]> = { incasso: [], crediti: [] };
  for (const chiave of new Set(chiavi)) {
    if (!CHIAVE.test(chiave)) return "Riga non valida.";
    const [tipo, id] = chiave.split(":") as [keyof typeof TABELLE, string];
    perTabella[tipo].push(id);
  }

  const admin = createAdminClient();
  const adesso = new Date().toISOString();
  let aggiornate = 0;

  for (const tipo of Object.keys(perTabella) as (keyof typeof TABELLE)[]) {
    const ids = perTabella[tipo];
    if (ids.length === 0) continue;
    const { data, error } = await admin
      .from(TABELLE[tipo])
      .update({
        stato_fattura: v.stato,
        numero_fattura: v.numero,
        data_fattura: v.data,
        note_fattura: v.note,
        fatturazione_aggiornata_il: adesso,
        fatturazione_aggiornata_da: userId,
        ...extra,
      })
      .in("id", ids)
      .select("id");

    if (error) {
      console.error("Console: aggiornamento stato fattura fallito", error.message);
      if (schemaAssente(error)) return Object.keys(extra).length > 0 ? "Caricamento del PDF non disponibile: eseguire la migrazione 0081." : "Stato di fatturazione non disponibile: eseguire la migrazione 0079.";
      return "Aggiornamento non riuscito.";
    }
    aggiornate += data?.length ?? 0;
  }

  return aggiornate;
}

function tornaAllElenco(aggiornate: number, stato: StatoFattura, formData: FormData, email?: boolean): never {
  revalidatePath("/site-console", "layout");
  const parametri = new URLSearchParams({ esito: "aggiornate", n: String(aggiornate), nuovo: stato });
  // l'email al cliente c'è solo al primo caricamento del PDF: se non parte va detto
  if (email !== undefined) parametri.set("email", email ? "1" : "0");
  const includiProva = formData.get("prova") === "1";
  // si torna alla scheda in cui si stava lavorando: l'indicazione si omette solo se è quella predefinita
  const filtro = leggiFiltroFattura(String(formData.get("filtro") ?? ""), includiProva);
  if (filtro !== filtroPredefinito(includiProva)) parametri.set("stato", filtro);
  if (includiProva) parametri.set("prova", "1");
  redirect(`/fatturazione?${parametri.toString()}`);
}

type CaricamentoPdf = { errore: string } | { extra: Record<string, unknown>; primoCaricamento: boolean; userId: string | null; dataPagamento: string };

// Carica il PDF di una fattura sul pagamento indicato. Si carica SOLO una fattura già
// emessa: il pagamento deve risultare «fatturata», altrimenti il cliente si troverebbe
// una fattura scaricabile su un pagamento ancora da fatturare. Il file sta nel bucket
// privato «invoices», in un percorso fisso per pagamento (ricaricarlo lo sostituisce).
async function caricaPdfFattura(riga: string, file: File, stato: StatoFattura): Promise<CaricamentoPdf> {
  if (stato !== "fatturata") return { errore: "Per caricare il PDF segna il pagamento come «fatturata»." };
  if (!CHIAVE.test(riga)) return { errore: "Riga non valida." };
  if (file.size > LIMITE_BYTE_FATTURA) return { errore: "Il file supera i 15 MB." };
  // Non basta il tipo dichiarato dal browser: un PDF vero comincia con «%PDF».
  if (!(await file.slice(0, 5).text()).startsWith("%PDF")) return { errore: "Il file non è un PDF." };

  const [fonte, id] = riga.split(":") as [keyof typeof TABELLE, string];
  const colonnaData = fonte === "incasso" ? "pagato_il" : "created_at";
  const admin = createAdminClient();

  const { data: attuale, error: erroreLettura } = await admin
    .from(TABELLE[fonte])
    .select(`user_id, fattura_caricata_il, ${colonnaData}`)
    .eq("id", id)
    .maybeSingle<Record<string, string | null>>();
  if (erroreLettura) {
    console.error("Console: lettura del pagamento per il PDF fattura fallita", erroreLettura.message);
    return { errore: schemaAssente(erroreLettura) ? "Caricamento del PDF non disponibile: eseguire la migrazione 0081." : "Lettura del pagamento non riuscita." };
  }
  if (!attuale) return { errore: "Riga non trovata." };

  const { error: erroreUpload } = await admin.storage.from("invoices").upload(percorsoFatturaPagamento(fonte, id), file, { contentType: "application/pdf", upsert: true });
  if (erroreUpload) {
    console.error("Console: upload del PDF fattura fallito", erroreUpload.message);
    return { errore: "Caricamento del file non riuscito." };
  }

  return {
    extra: { fattura_file_path: percorsoFatturaPagamento(fonte, id), fattura_caricata_il: attuale.fattura_caricata_il ?? new Date().toISOString() },
    primoCaricamento: !attuale.fattura_caricata_il,
    userId: attuale.user_id,
    dataPagamento: String(attuale[colonnaData] ?? ""),
  };
}

// Avvisa il cliente che la fattura è disponibile (stessa cosa che si fa per gli ordini
// dell'e-commerce). Il link porta all'area riservata di OMNIA AI, non alla console. Il
// testo è fisso: nessun dato del cliente finisce nell'HTML se non la data del pagamento.
async function avvisaClienteFattura(userId: string | null, dataPagamento: string): Promise<boolean> {
  if (!userId) return false;
  const { data: utente } = await createAdminClient().from("users").select("email").eq("id", userId).maybeSingle<{ email: string }>();
  if (!utente?.email) return false;
  const quando = dataPagamento ? ` del ${dataLeggibile(dataPagamento)}` : "";
  return sendEmail({
    to: utente.email,
    subject: "La tua fattura OMNIA AI è disponibile",
    html: `<p>La fattura relativa al tuo pagamento${escapeHtml(quando)} è ora disponibile nella tua area riservata di OMNIA AI, nella pagina «Pagamenti e fatture».</p><p><a href="${OMNIA_AI_BASE_URL}/dashboard/omnia-ai/pagamenti">Vai a Pagamenti e fatture</a></p><p>Ricorda che la ricevuta che ti invia Stripe a ogni addebito non è la fattura.</p>`,
  });
}

// Notifica «fattura disponibile» nel campanello del cliente. Fire-and-forget (creaNotifica non
// solleva mai errori): se il tipo non è ancora ammesso dal database (migrazione 0083) l'errore
// va nel log e il resto continua.
async function notificaFatturaDisponibile(userId: string, riga: string, dataPagamento: string): Promise<void> {
  const quando = dataPagamento ? ` del ${dataLeggibile(dataPagamento)}` : "";
  await creaNotifica({
    userId,
    tipo: "fattura_disponibile",
    garaId: null,
    titolo: "La tua fattura è disponibile",
    corpo: `La fattura del pagamento${quando} è pronta: la trovi in «Pagamenti e fatture».`,
    chiaveDedup: riga,
  });
}

export async function aggiornaStatoFattura(_stato: StatoAzioneFattura, formData: FormData): Promise<StatoAzioneFattura> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const valori = leggiModulo(formData, true);
  if (typeof valori === "string") return { errore: valori };

  const riga = String(formData.get("riga") ?? "");
  const file = formData.get("file");

  let pdf: Extract<CaricamentoPdf, { extra: Record<string, unknown> }> | null = null;
  if (file instanceof File && file.size > 0) {
    const esitoPdf = await caricaPdfFattura(riga, file, valori.stato);
    if ("errore" in esitoPdf) return { errore: esitoPdf.errore };
    pdf = esitoPdf;
  }

  const esito = await applica([riga], valori, sessione.userId, pdf?.extra);
  if (typeof esito === "string") return { errore: esito };
  if (esito === 0) return { errore: "Riga non trovata." };

  // Il cliente si avvisa solo la prima volta che la fattura compare: sostituire un file
  // già caricato non manda un'altra email.
  const emailInviata = pdf?.primoCaricamento ? await avvisaClienteFattura(pdf.userId, pdf.dataPagamento) : undefined;
  // E la notifica nel campanello dell'area riservata: l'email può finire nello spam o non partire,
  // la notifica c'è comunque. Una sola per pagamento (chiave di deduplica).
  if (pdf?.primoCaricamento && pdf.userId) await notificaFatturaDisponibile(pdf.userId, riga, pdf.dataPagamento);
  tornaAllElenco(esito, valori.stato, formData, emailInviata);
}

// Per più righe insieme (es. tutte le righe di un mese): stessa data e stesse note
// per tutte, senza numero (il numero è di una fattura sola: si aggiunge poi riga per riga).
export async function aggiornaStatoFatturaMultiplo(_stato: StatoAzioneFattura, formData: FormData): Promise<StatoAzioneFattura> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const righe = formData.getAll("righe").map(String);
  if (righe.length === 0) return { errore: "Seleziona almeno una riga." };
  if (righe.length > MASSIMO_RIGHE) return { errore: `Troppe righe insieme (massimo ${MASSIMO_RIGHE}).` };

  const valori = leggiModulo(formData, false);
  if (typeof valori === "string") return { errore: valori };

  const esito = await applica(righe, valori, sessione.userId);
  if (typeof esito === "string") return { errore: esito };

  tornaAllElenco(esito, valori.stato, formData);
}
