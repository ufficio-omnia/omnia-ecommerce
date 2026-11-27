"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { archivioNewsletter } from "@/lib/newsletter/archivio";
import { controllaEdizione, normalizzaContenuto } from "@/lib/newsletter/contenuto";
import { emailValida } from "@/lib/newsletter/destinatari";
import { generaNuovaEdizione, rigenera, ripristinaVersione, type TestoEditor } from "@/lib/newsletter/versioni";
import { avviaInvio, inviaProva, riprendiInvio } from "@/lib/newsletter/invio";
import { dataRoma, daInputLocale, oraValida, prossimaScadenza } from "@/lib/newsletter/pianificazione";
import { BASI_GIURIDICHE, contenutoVuoto, type BaseGiuridica, type CategoriaIscritto, type ChiaveSezione, type DestinatariScelti, type Impostazioni } from "@/lib/newsletter/tipi";

// Newsletter & Comunicazioni (migrazione 0141). Ogni azione parte da richiediAdminAzione(). Le regole che contano
// (approvazione, doppio invio, modifica dopo l'approvazione) sono anche nel database e nella libreria: qui si
// controlla l'input e si riporta l'esito.

export type EsitoNewsletter = { errore?: string; ok?: boolean; avviso?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errore(e: unknown): EsitoNewsletter {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("Console newsletter:", msg);
  if (/PGRST205|42P01|newsletter_/.test(msg) && /does not exist|Could not find|schema cache/i.test(msg)) {
    return { errore: "Le tabelle della newsletter non esistono ancora: va eseguita la migrazione 0141." };
  }
  return { errore: msg.replace(/^Newsletter, /, "").slice(0, 300) };
}

function aggiorna(id?: string) {
  revalidatePath("/site-console/newsletter", "layout");
  if (id) revalidatePath(`/site-console/newsletter/${id}`);
}

// ───── edizioni ─────

export async function creaEdizioneVuota(_s: EsitoNewsletter, _f: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  void _s;
  void _f;
  let id: string;
  try {
    const e = await archivioNewsletter().creaEdizione({ data_edizione: dataRoma(new Date()), contenuto: contenutoVuoto(), origine: "manuale" }, sessione.userId);
    await archivioNewsletter().annota(e.id, "creata", { origine: "manuale" }, sessione.userId);
    id = e.id;
  } catch (e) {
    return errore(e);
  }
  aggiorna();
  redirect(`/newsletter/${id}`);
}

export async function generaEdizioneSettimanale(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  if (!process.env.ANTHROPIC_API_KEY) return { errore: "ANTHROPIC_API_KEY non configurata: la generazione non è disponibile." };
  const fonti = String(formData.get("fonti") ?? "")
    .split(/\s+/)
    .filter((x) => /^https?:\/\//.test(x));
  const indicazioni = String(formData.get("indicazioni") ?? "");
  let id: string;
  try {
    // l'edizione nasce subito (numero e data) e la generazione ne diventa la versione 1: anche un tentativo fallito
    // resta legato all'edizione, con il suo costo, e si può rigenerare
    const { edizione } = await generaNuovaEdizione({ dataEdizione: dataRoma(new Date()), fontiManuali: fonti, indicazioni, autore: sessione.userId });
    id = edizione.id;
  } catch (e) {
    return errore(e);
  }
  aggiorna();
  redirect(`/newsletter/${id}`);
}

function leggiTestoEditor(formData: FormData): TestoEditor | null {
  const grezzo = formData.get("testo");
  if (typeof grezzo !== "string" || !grezzo) return null;
  try {
    const t = JSON.parse(grezzo) as Record<string, unknown>;
    const d = (t.destinatari ?? {}) as Record<string, unknown>;
    const data = String(t.data_edizione ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
    return {
      oggetto: String(t.oggetto ?? "").replace(/\s+/g, " ").trim().slice(0, 150),
      preheader: String(t.preheader ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      data_edizione: data,
      contenuto: normalizzaContenuto(t.contenuto),
      destinatari: { abbonati_attivi: d.abbonati_attivi !== false, altri_autorizzati: d.altri_autorizzati !== false },
    };
  } catch {
    return null;
  }
}

// Rigenerazione intera, di una sezione o di una notizia. Il testo dell'editor (anche non salvato) si salva prima.
export async function rigeneraNewsletter(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  if (!process.env.ANTHROPIC_API_KEY) return { errore: "ANTHROPIC_API_KEY non configurata: la generazione non è disponibile." };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Edizione non valida." };
  const tipo = String(formData.get("tipo") ?? "");
  if (tipo !== "rigenerazione" && tipo !== "rigenerazione_sezione" && tipo !== "rigenerazione_notizia") return { errore: "Tipo di rigenerazione non valido." };
  const chiave = String(formData.get("chiave") ?? "") as ChiaveSezione;
  const indice = Number(formData.get("indice"));
  try {
    const r = await rigenera({
      edizioneId: id,
      tipo,
      chiave: tipo === "rigenerazione" ? undefined : chiave,
      indice: tipo === "rigenerazione_notizia" && Number.isInteger(indice) && indice >= 0 ? indice : undefined,
      indicazioni: String(formData.get("indicazioni") ?? "").slice(0, 1500),
      testoEditor: leggiTestoEditor(formData),
      autore: sessione.userId,
    });
    aggiorna(id);
    return r.ok ? { ok: true, avviso: `${r.messaggio} Costo stimato: ${r.costoUsd.toFixed(3)} $.` } : { errore: `${r.errore}${r.costoUsd > 0 ? ` Costo stimato del tentativo: ${r.costoUsd.toFixed(3)} $ (registrato).` : ""}` };
  } catch (e) {
    return errore(e);
  }
}

export async function ripristinaVersioneNewsletter(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  const numero = Number(formData.get("numero"));
  if (!UUID.test(id) || !Number.isInteger(numero) || numero < 1) return { errore: "Versione non valida." };
  try {
    const r = await ripristinaVersione({ edizioneId: id, numero, testoEditor: leggiTestoEditor(formData), autore: sessione.userId });
    aggiorna(id);
    return r.ok ? { ok: true, avviso: r.messaggio } : { errore: r.errore };
  } catch (e) {
    return errore(e);
  }
}

export async function salvaEdizione(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Edizione non valida." };
  let grezzo: unknown;
  try {
    grezzo = JSON.parse(String(formData.get("contenuto") ?? "{}"));
  } catch {
    return { errore: "Contenuto non leggibile." };
  }
  const data = String(formData.get("data_edizione") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { errore: "Data dell'edizione non valida." };
  const destinatari: DestinatariScelti = { abbonati_attivi: formData.get("abbonati_attivi") === "1", altri_autorizzati: formData.get("altri_autorizzati") === "1" };
  try {
    const a = archivioNewsletter();
    const prima = await a.leggiEdizione(id);
    if (!prima) return { errore: "Edizione non trovata." };
    const dopo = await a.aggiornaEdizione(
      id,
      {
        oggetto: String(formData.get("oggetto") ?? "").replace(/\s+/g, " ").trim().slice(0, 150),
        preheader: String(formData.get("preheader") ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        data_edizione: data,
        contenuto: normalizzaContenuto(grezzo),
        destinatari,
      },
      ["bozza", "in_revisione", "approvata", "programmata"],
    );
    if (!dopo) return { errore: "L'edizione è in invio o già inviata: non si modifica più." };
    await a.annota(id, "salvata", { versione: dopo.versione }, sessione.userId);
    aggiorna(id);
    if ((prima.stato === "approvata" || prima.stato === "programmata") && dopo.stato === "in_revisione") {
      return { ok: true, avviso: "Salvato. L'edizione era approvata: la modifica ha tolto l'approvazione (e l'eventuale programmazione). Va riapprovata." };
    }
    return { ok: true };
  } catch (e) {
    return errore(e);
  }
}

export async function cambiaStatoEdizione(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  const azione = String(formData.get("azione") ?? "");
  if (!UUID.test(id)) return { errore: "Edizione non valida." };
  try {
    const a = archivioNewsletter();
    const e = await a.leggiEdizione(id);
    if (!e) return { errore: "Edizione non trovata." };
    let esito = null;
    if (azione === "revisione") {
      esito = await a.aggiornaEdizione(id, { stato: "in_revisione" }, ["bozza"]);
    } else if (azione === "bozza") {
      esito = await a.aggiornaEdizione(id, { stato: "bozza", approvata_il: null, approvata_da: null, programmata_per: null }, ["in_revisione", "approvata", "programmata"]);
    } else if (azione === "approva") {
      const c = controllaEdizione(e);
      if (c.bloccanti.length) return { errore: `Non approvabile: ${c.bloccanti.join(" ")}` };
      if (formData.get("conferma") !== "1") return { errore: "Spunta la conferma di aver riletto l'anteprima e le fonti." };
      esito = await a.aggiornaEdizione(id, { stato: "approvata", approvata_il: new Date().toISOString(), approvata_da: sessione.userId }, ["bozza", "in_revisione"]);
    } else if (azione === "annulla") {
      esito = await a.aggiornaEdizione(id, { stato: "annullata", programmata_per: null }, ["bozza", "in_revisione", "approvata", "programmata"]);
    } else if (azione === "ripristina") {
      esito = await a.aggiornaEdizione(id, { stato: "bozza", approvata_il: null, approvata_da: null }, ["annullata"]);
    } else if (azione === "deprogramma") {
      esito = await a.aggiornaEdizione(id, { stato: "approvata", programmata_per: null }, ["programmata"]);
    } else {
      return { errore: "Azione sconosciuta." };
    }
    if (!esito) return { errore: "Lo stato dell'edizione non lo consente (o è cambiato nel frattempo)." };
    await a.annota(id, `stato:${azione}`, { da: e.stato, a: esito.stato, versione: esito.versione }, sessione.userId);
    aggiorna(id);
    return { ok: true };
  } catch (e) {
    return errore(e);
  }
}

export async function programmaInvio(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Edizione non valida." };
  try {
    const a = archivioNewsletter();
    let quando: Date | null;
    const scelta = String(formData.get("quando") ?? "");
    if (scelta) quando = daInputLocale(scelta);
    else {
      const imp = await a.leggiImpostazioni();
      quando = prossimaScadenza(imp.giorno_invio, imp.ora_invio, new Date());
    }
    if (!quando) return { errore: "Data e ora non valide." };
    if (quando.getTime() < Date.now() + 2 * 60 * 1000) return { errore: "Scegli un momento nel futuro (almeno 2 minuti da adesso), oppure usa «Invia adesso»." };
    const esito = await a.aggiornaEdizione(id, { stato: "programmata", programmata_per: quando.toISOString() }, ["approvata"]);
    if (!esito) return { errore: "Si programma solo un'edizione approvata." };
    await a.annota(id, "programmata", { per: quando.toISOString() }, sessione.userId);
    aggiorna(id);
    return { ok: true };
  } catch (e) {
    return errore(e);
  }
}

export async function inviaEmailDiProva(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Edizione non valida." };
  const indirizzi = String(formData.get("indirizzi") ?? "").split(/[\s,;]+/);
  try {
    const r = await inviaProva(id, indirizzi, sessione.userId);
    aggiorna(id);
    return r.ok ? { ok: true, avviso: r.messaggio } : { errore: r.errore };
  } catch (e) {
    return errore(e);
  }
}

export async function inviaAdesso(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Edizione non valida." };
  // conferma esplicita col numero dei destinatari mostrato nella pagina: se nel frattempo è cambiato, si ferma
  const attesi = Number(formData.get("destinatari_attesi"));
  if (formData.get("conferma") !== "INVIA") return { errore: "Per inviare scrivi INVIA nel campo di conferma." };
  try {
    const { anteprimaDestinatari } = await import("@/lib/newsletter/invio");
    const e = await archivioNewsletter().leggiEdizione(id);
    if (!e) return { errore: "Edizione non trovata." };
    const { inclusi } = await anteprimaDestinatari(e);
    if (!Number.isFinite(attesi) || inclusi.length !== attesi) return { errore: `I destinatari sono cambiati (${inclusi.length} invece di ${attesi}): ricarica la pagina e ricontrolla l'elenco.` };
    if (inclusi.length === 0) return { errore: "Nessun destinatario autorizzato: niente da inviare." };
    const r = await avviaInvio(id, sessione.userId, "manuale");
    aggiorna(id);
    return r.ok ? { ok: true, avviso: r.messaggio } : { errore: r.errore };
  } catch (e) {
    return errore(e);
  }
}

export async function riprendiInvioEdizione(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Edizione non valida." };
  try {
    const r = await riprendiInvio(id, sessione.userId);
    aggiorna(id);
    return r.ok ? { ok: true, avviso: r.messaggio } : { errore: r.errore };
  } catch (e) {
    return errore(e);
  }
}

// ───── iscritti ─────

export async function aggiungiIscritto(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const base = String(formData.get("base_giuridica") ?? "") as BaseGiuridica;
  const prova = String(formData.get("prova_base") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "altro") as CategoriaIscritto;
  const dal = String(formData.get("base_dal") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  if (!emailValida(email)) return { errore: "Indirizzo email non valido." };
  if (!BASI_GIURIDICHE.includes(base)) return { errore: "Scegli la base giuridica." };
  if (prova.length < 10) return { errore: "Descrivi la prova della base giuridica (almeno 10 caratteri: come, quando, dove è documentata)." };
  if (!["cliente", "prospect", "interno", "altro"].includes(categoria)) return { errore: "Categoria non valida." };
  if (dal && !/^\d{4}-\d{2}-\d{2}$/.test(dal)) return { errore: "Data della base non valida." };
  if (formData.get("dichiarazione") !== "1") return { errore: "Conferma che la base giuridica è documentata e conservata." };
  try {
    const a = archivioNewsletter();
    const esistente = await a.iscrittoPerEmail(email);
    if (esistente) return { errore: `Indirizzo già presente (stato: ${esistente.stato}).` };
    const nuovo = await a.aggiungiIscritto(
      {
        email,
        nome: String(formData.get("nome") ?? "").trim().slice(0, 120) || null,
        user_id: UUID.test(userId) ? userId : null,
        categoria,
        stato: "iscritto",
        base_giuridica: base,
        prova_base: prova.slice(0, 1000),
        base_dal: dal || dataRoma(new Date()),
      },
      sessione.userId,
    );
    await a.annota(null, "iscritto_aggiunto", { iscritto: nuovo.id, base }, sessione.userId);
    aggiorna();
    return { ok: true };
  } catch (e) {
    return errore(e);
  }
}

export async function cambiaStatoIscritto(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const id = String(formData.get("id") ?? "");
  const azione = String(formData.get("azione") ?? "");
  if (!UUID.test(id)) return { errore: "Iscritto non valido." };
  try {
    const a = archivioNewsletter();
    if (azione === "disiscrivi") {
      await a.aggiornaIscritto(id, { stato: "disiscritto", disiscritto_il: new Date().toISOString(), motivo_uscita: "disiscritto dall'amministratore" });
    } else {
      // riattivare un disiscritto richiede un nuovo consenso: si fa dalla pagina pubblica dell'interessato, non da qui
      return { errore: "Azione non prevista: un indirizzo disiscritto si riattiva solo con un nuovo consenso dell'interessato." };
    }
    await a.annota(null, `iscritto:${azione}`, { iscritto: id }, sessione.userId);
    aggiorna();
    return { ok: true };
  } catch (e) {
    return errore(e);
  }
}

// ───── impostazioni ─────

export async function salvaImpostazioniNewsletter(_s: EsitoNewsletter, formData: FormData): Promise<EsitoNewsletter> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const g = Number(formData.get("giorno_generazione"));
  const gi = Number(formData.get("giorno_invio"));
  const og = String(formData.get("ora_generazione") ?? "");
  const oi = String(formData.get("ora_invio") ?? "");
  if (![g, gi].every((x) => Number.isInteger(x) && x >= 1 && x <= 7)) return { errore: "Giorno non valido." };
  if (!oraValida(og) || !oraValida(oi)) return { errore: "Ora non valida (formato HH:MM)." };
  const mittenteEmail = String(formData.get("mittente_email") ?? "").trim().toLowerCase();
  // solo il dominio verificato su Resend
  if (!emailValida(mittenteEmail) || !mittenteEmail.endsWith("@omniaitalia.com")) return { errore: "Il mittente deve essere un indirizzo @omniaitalia.com (dominio verificato su Resend)." };
  const rispondiA = String(formData.get("rispondi_a") ?? "").trim().toLowerCase();
  if (rispondiA && !emailValida(rispondiA)) return { errore: "Indirizzo di risposta non valido." };
  const notifica = String(formData.get("email_notifica_admin") ?? "").trim().toLowerCase();
  if (!emailValida(notifica)) return { errore: "Indirizzo per le notifiche non valido." };
  const imp: Impostazioni = {
    giorno_generazione: g,
    ora_generazione: og,
    giorno_invio: gi,
    ora_invio: oi,
    generazione_automatica: formData.get("generazione_automatica") === "1",
    mittente_nome: String(formData.get("mittente_nome") ?? "").replace(/["<>\r\n]/g, "").trim().slice(0, 80) || "OMNIA AI | Tender Weekly",
    mittente_email: mittenteEmail,
    rispondi_a: rispondiA || null,
    email_notifica_admin: notifica,
    resend_piano: String(formData.get("resend_piano") ?? "").trim().slice(0, 60) || null,
    resend_quota_mensile_eur: (() => {
      const v = String(formData.get("resend_quota_mensile_eur") ?? "").trim().replace(",", ".");
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
    })(),
  };
  try {
    await archivioNewsletter().salvaImpostazioni(imp, sessione.userId);
    await archivioNewsletter().annota(null, "impostazioni", { ...imp }, sessione.userId);
    aggiorna();
    return { ok: true };
  } catch (e) {
    return errore(e);
  }
}
