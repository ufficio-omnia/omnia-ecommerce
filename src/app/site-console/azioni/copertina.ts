"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { validaImpostazioniCopertina } from "@/lib/copertina-diritto-calcoli";
import { CHIAVE_POLITICA_PROVA_COPERTINA, CHIAVE_PREZZO_COPERTINA, CHIAVE_VENDITA_COPERTINA, NOTA_CONSOLE_CONDIZIONI_COPERTINA, PREZZO_COPERTINA } from "@/lib/copertina-acquisto-calcoli";
import { pagamentoCopertinaDisponibile } from "@/lib/copertina-diritto";
import { migrazioneCopertinaPacchettiEseguita } from "@/lib/copertina-vendita";
import { cercaClientePerConcessione } from "@/lib/console/piano-lavoro";
import { euroACentesimi } from "@/lib/omnia-ai-catalogo-calcoli";
import { modalitaChiaveStripe } from "@/lib/omnia-ai-vendita";
import { LIMITI_CATALOGO, SERVIZI, serializzaCatalogoPacchetti, validaCatalogoDaModulo } from "@/lib/pacchetti-servizi-calcoli";
import { POLITICHE_PROVA, validaNuovaConcessione } from "@/lib/piano-lavoro-offerta-calcoli";

// ───── la pagina «Copertina» (menu Sistema, richiesta dell'utente del 17/11/2026): vendita, prezzo, prova, pacchetti, concessioni ─────
// Come le azioni del piano di lavoro (azioni/piano-lavoro.ts), con chiavi e tabelle della copertina. Le offerte dedicate usano le azioni comuni dei pacchetti
// (azioni/pacchetti.ts) con il servizio «copertina».

function ricaricaConsole() {
  revalidatePath("/site-console", "layout");
}

async function salvaValori(chiavi: { chiave: string; valore: string }[], operatoreId: string): Promise<boolean> {
  const adesso = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("console_impostazioni")
    .upsert(
      chiavi.map((c) => ({ chiave: c.chiave, valore: c.valore, aggiornato_il: adesso, aggiornato_da: operatoreId })),
      { onConflict: "chiave" },
    );
  if (error) console.error("Console: salvataggio delle impostazioni della copertina fallito", error.message);
  return !error;
}

// Accende o sospende la vendita della copertina a tutti (singola gara e pacchetti). Si accende solo con la chiave Stripe riconosciuta e con la tabella degli
// acquisti (migrazione 0107); i pacchetti si vedono solo se c'è anche la 0130. Si spegne sempre. Chi ha già pagato o ha delle unità le usa comunque.
export async function impostaVenditaCopertina(_stato: StatoCopertinaAzione, formData: FormData): Promise<StatoCopertinaAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const azione = String(formData.get("azione") ?? "");
  if (azione !== "attiva" && azione !== "sospendi") return { errore: "Azione non valida." };

  const avvisi: string[] = [];
  if (azione === "attiva") {
    if (modalitaChiaveStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI) === "sconosciuta") return { errore: "Non posso accendere la vendita: la chiave Stripe di OMNIA AI manca o non è riconosciuta." };
    const { error } = await createAdminClient().from("omnia_ai_copertine_acquisti").select("id", { count: "exact", head: true });
    if (error) return { errore: schemaAssente(error) ? "Non posso accendere la vendita: manca la migrazione 0107 (acquisti della copertina)." : "Non posso accendere la vendita: il controllo della tabella degli acquisti non è riuscito. Riprova." };
    const m0130 = await migrazioneCopertinaPacchettiEseguita();
    if (m0130 !== "si") avvisi.push("I pacchetti della copertina NON si vedono finché non esegui la migrazione 0130: per ora si vende solo la singola gara.");
    if (!process.env.OPENAI_API_KEY) avvisi.push("In questo ambiente manca la chiave di OpenAI (OPENAI_API_KEY): chi compra non riuscirebbe a generare.");
  }

  if (!(await salvaValori([{ chiave: CHIAVE_VENDITA_COPERTINA, valore: azione === "attiva" ? "1" : "0" }], sessione.userId))) return { errore: "Salvataggio non riuscito." };

  ricaricaConsole();
  return {
    ok: true,
    avviso: [
      azione === "attiva"
        ? "Vendita accesa: nella gara compare l'acquisto della copertina e, nella home e in «Servizi aggiuntivi», i pacchetti (solo con la chiave Stripe reale)."
        : "Vendita sospesa: l'acquisto e i pacchetti della copertina non sono più visibili. Chi ha già pagato, ha delle unità, una concessione o condizioni particolari continua a usarli.",
      ...avvisi,
    ].join(" "),
  };
}

// Il prezzo della copertina di UNA gara per tutti (IVA inclusa). Vale per i nuovi acquisti; un prezzo dedicato a un cliente (scheda cliente) prevale.
export async function salvaPrezzoSingoloCopertina(_stato: StatoCopertinaAzione, formData: FormData): Promise<StatoCopertinaAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const centesimi = euroACentesimi(String(formData.get("prezzo") ?? ""));
  if (centesimi === null) return { errore: "Scrivi un importo in euro (per esempio 50 oppure 49,90)." };
  if (centesimi < PREZZO_COPERTINA.minimoCentesimi || centesimi > PREZZO_COPERTINA.massimoCentesimi) {
    return { errore: `Il prezzo dev'essere tra ${(PREZZO_COPERTINA.minimoCentesimi / 100).toFixed(2).replace(".", ",")} e ${(PREZZO_COPERTINA.massimoCentesimi / 100).toLocaleString("it-IT")} euro.` };
  }
  if (!(await salvaValori([{ chiave: CHIAVE_PREZZO_COPERTINA, valore: String(centesimi) }], sessione.userId))) return { errore: "Salvataggio non riuscito." };

  ricaricaConsole();
  return { ok: true };
}

// Che cosa fa la copertina per chi è in prova (con la vendita accesa): la compra come tutti, è inclusa gratis, oppure non è disponibile.
export async function impostaPoliticaProvaCopertina(_stato: StatoCopertinaAzione, formData: FormData): Promise<StatoCopertinaAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const politica = String(formData.get("politica") ?? "");
  if (!(POLITICHE_PROVA as string[]).includes(politica)) return { errore: "Scelta non valida." };
  if (!(await salvaValori([{ chiave: CHIAVE_POLITICA_PROVA_COPERTINA, valore: politica }], sessione.userId))) return { errore: "Salvataggio non riuscito." };

  ricaricaConsole();
  return { ok: true };
}

// L'elenco dei pacchetti prepagati della copertina in vendita (quantità di gare e prezzo IVA inclusa). Righe vuote ignorate; elenco vuoto = nessun pacchetto.
export async function salvaCatalogoPacchettiCopertina(_stato: StatoCopertinaAzione, formData: FormData): Promise<StatoCopertinaAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const righe = Array.from({ length: LIMITI_CATALOGO.pacchettiMassimi }, (_, i) => ({
    quantita: String(formData.get(`quantita_${i + 1}`) ?? ""),
    prezzoEuro: String(formData.get(`prezzo_${i + 1}`) ?? ""),
  }));
  const esito = validaCatalogoDaModulo(righe);
  if (!esito.ok) return { errore: esito.errore };

  if (!(await salvaValori([{ chiave: SERVIZI.copertina.chiaveCatalogo, valore: serializzaCatalogoPacchetti(esito.catalogo) }], sessione.userId))) return { errore: "Salvataggio non riuscito." };

  ricaricaConsole();
  return esito.catalogo.length === 0 ? { ok: true, avviso: "Salvato: nessun pacchetto della copertina in vendita. I clienti vedono solo l'acquisto della singola gara; chi ha già delle unità le usa." } : { ok: true };
}

// Concede gratis la copertina a un cliente: per tutte le sue gare (numero massimo e/o scadenza facoltativi) oppure per una gara. Migrazione 0130.
export async function creaConcessioneCopertina(_stato: StatoCopertinaAzione, formData: FormData): Promise<StatoCopertinaAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const esito = validaNuovaConcessione(
    {
      tipo: String(formData.get("tipo") ?? ""),
      garaId: String(formData.get("garaId") ?? ""),
      gareMassime: String(formData.get("gareMassime") ?? ""),
      scadeIl: String(formData.get("scadeIl") ?? ""),
      motivo: String(formData.get("motivo") ?? ""),
    },
    giornoRoma(new Date()),
  );
  if (!esito.ok) return { errore: esito.errore };
  const v = esito.valori;

  // il cliente si rilegge QUI dall'email (mai da un identificativo arrivato dal browser) e dev'essere un titolare
  const ricerca = await cercaClientePerConcessione(String(formData.get("email") ?? ""));
  if (ricerca.stato === "errore") return { errore: "Ricerca del cliente non riuscita: riprova." };
  if (ricerca.stato === "ufficio_gare") return { errore: "Questo indirizzo è di un Ufficio Gare: la concessione va data al titolare dell'account." };
  if (ricerca.stato === "non_trovato") return { errore: "Nessun cliente con questo indirizzo email." };
  const cliente = ricerca.cliente;

  let garaTitolo: string | null = null;
  if (v.tipo === "gara") {
    const gara = cliente.gare.find((g) => g.id === v.garaId);
    if (!gara) return { errore: "Questa gara non è di questo cliente." };
    garaTitolo = gara.titolo;
  }

  const { error } = await createAdminClient().from("omnia_ai_copertina_concessioni").insert({
    user_id: cliente.id,
    tipo: v.tipo,
    gara_id: v.garaId,
    gara_titolo: garaTitolo,
    gare_massime: v.gareMassime,
    scade_il: v.scadeIl,
    motivo: v.motivo,
    creata_da_email: sessione.email,
  });
  if (error) {
    if (schemaAssente(error)) return { errore: "La tabella delle concessioni della copertina non esiste ancora (migrazione 0130): nessuna concessione creata." };
    console.error("Console: creazione della concessione della copertina fallita", error.message);
    return { errore: "Creazione della concessione non riuscita." };
  }

  ricaricaConsole();
  return { ok: true, avviso: process.env.OPENAI_API_KEY ? undefined : "Attenzione: in questo ambiente manca la chiave di OpenAI (OPENAI_API_KEY): il cliente vede il servizio ma la copertina non parte." };
}

// Revoca una concessione (non si cancella: resta nella storia). Le copertine già fatte restano del cliente.
export async function revocaConcessioneCopertina(_stato: StatoCopertinaAzione, formData: FormData): Promise<StatoCopertinaAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { errore: "Concessione non valida." };

  const { data, error } = await createAdminClient()
    .from("omnia_ai_copertina_concessioni")
    .update({ attiva: false, revocata_il: new Date().toISOString(), revocata_da_email: sessione.email })
    .eq("id", id)
    .eq("attiva", true)
    .select("id");
  if (error) {
    console.error("Console: revoca della concessione della copertina fallita", error.message);
    return { errore: "Revoca non riuscita." };
  }
  if ((data ?? []).length === 0) return { errore: "La concessione non esiste o è già revocata." };

  ricaricaConsole();
  return { ok: true };
}

// Copertina della relazione tecnica dalla console (migrazione 0106): per ogni cliente si decide se il servizio è acceso o spento, se è gratis (con un numero
// di gare e una scadenza facoltativi) o a pagamento (con un prezzo per gara). Una riga per cliente, riscritta a ogni salvataggio: lo spegnimento è «attivo =
// falso», niente si cancella. Ogni azione parte da richiediAdminAzione().

export type StatoCopertinaAzione = { errore?: string; ok?: boolean; avviso?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function salvaImpostazioniCopertina(_stato: StatoCopertinaAzione, formData: FormData): Promise<StatoCopertinaAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const userId = String(formData.get("userId") ?? "");
  if (!UUID.test(userId)) return { errore: "Utente non valido." };

  const esito = validaImpostazioniCopertina(
    {
      stato: String(formData.get("stato") ?? ""),
      modalita: String(formData.get("modalita") ?? ""),
      prezzo: String(formData.get("prezzo") ?? ""),
      gareMassime: String(formData.get("gareMassime") ?? ""),
      scadeIl: String(formData.get("scadeIl") ?? ""),
      nota: String(formData.get("nota") ?? ""),
    },
    giornoRoma(new Date()),
  );
  if (!esito.ok) return { errore: esito.errore };
  const v = esito.valori;

  const admin = createAdminClient();

  // Il cliente si rilegge QUI (mai si dà per buono ciò che arriva dal browser): dev'essere un cliente titolare, non un amministratore né un Ufficio Gare
  // (l'Ufficio Gare lavora con le impostazioni del suo titolare).
  const { data: utente, error: erroreUtente } = await admin.from("users").select("id, role").eq("id", userId).maybeSingle<{ id: string; role: string }>();
  if (erroreUtente) {
    console.error("Console: lettura dell'utente per la copertina fallita", erroreUtente.message);
    return { errore: "Lettura del cliente non riuscita." };
  }
  if (!utente) return { errore: "Utente non trovato." };
  if (utente.role !== "cliente") return { errore: "Il servizio si imposta solo per i clienti." };
  const { data: membro, error: erroreMembro } = await admin.from("omnia_ai_membri").select("titolare_id").eq("membro_id", userId).maybeSingle<{ titolare_id: string }>();
  if (erroreMembro && !schemaAssente(erroreMembro)) {
    console.error("Console: verifica del ruolo del cliente fallita", erroreMembro.message);
    return { errore: "Lettura del cliente non riuscita." };
  }
  if (membro) return { errore: "Questo utente è un Ufficio Gare: le impostazioni vanno date al titolare dell'account." };

  const { error } = await admin.from("omnia_ai_copertina_impostazioni").upsert(
    {
      user_id: userId,
      attivo: v.attivo,
      modalita: v.modalita,
      prezzo_centesimi: v.prezzoCentesimi,
      gare_massime: v.gareMassime,
      scade_il: v.scadeIl,
      nota: v.nota,
      aggiornata_il: new Date().toISOString(),
      aggiornata_da_email: sessione.email,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    if (schemaAssente(error)) return { errore: "Le tabelle della copertina non esistono ancora (migrazione 0106): nessuna impostazione salvata." };
    console.error("Console: salvataggio delle impostazioni della copertina fallito", error.message);
    return { errore: "Salvataggio non riuscito." };
  }

  revalidatePath("/site-console", "layout");
  // la chiave di OpenAI di QUESTO ambiente: senza, il cliente vede il servizio ma la copertina non parte (le chiavi di Vercel non sono quelle di .env.local)
  const avvisoChiaveOpenAI =
    v.attivo && !process.env.OPENAI_API_KEY
      ? "Attenzione: in questo ambiente manca la chiave di OpenAI (OPENAI_API_KEY): il cliente vede il servizio ma la copertina non parte finché non la aggiungi tra le variabili d'ambiente di Vercel e rifai il deploy."
      : null;
  // «a pagamento»: cosa manca perché il cliente possa davvero pagare, detto subito accanto al salvataggio invece di lasciarlo scoprire a lui
  if (v.attivo && v.modalita === "pagamento") {
    const problemi: string[] = [];
    // la tabella degli acquisti (migrazione 0107): senza, il cliente vede il prezzo ma non può comprare
    const { error: erroreAcquisti } = await admin.from("omnia_ai_copertine_acquisti").select("id", { count: "exact", head: true });
    if (erroreAcquisti) problemi.push(schemaAssente(erroreAcquisti) ? "manca la migrazione 0107 (acquisti della copertina)" : "non riesco a controllare la tabella degli acquisti");
    // la chiave Stripe di questo ambiente: il database è condiviso, ma il pagamento si può completare solo dove la chiave è quella reale (o di prova, in locale)
    if (!pagamentoCopertinaDisponibile(process.env)) problemi.push("in questo ambiente la chiave Stripe di OMNIA AI non è quella reale");
    const parti = [problemi.length > 0 ? `Salvato, ma il cliente per ora NON può pagare: ${problemi.join("; ")}. Vede il prezzo, senza poter generare.` : "Salvato. Il cliente vede il prezzo e può pagare la gara con carta su Stripe.", NOTA_CONSOLE_CONDIZIONI_COPERTINA];
    if (avvisoChiaveOpenAI) parti.push(avvisoChiaveOpenAI);
    return { ok: true, avviso: parti.join(" ") };
  }
  return avvisoChiaveOpenAI ? { ok: true, avviso: avvisoChiaveOpenAI } : { ok: true };
}
