"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { validaImpostazioniCopertina } from "@/lib/copertina-diritto-calcoli";
import { NOTA_CONSOLE_CONDIZIONI_COPERTINA } from "@/lib/copertina-acquisto-calcoli";
import { pagamentoCopertinaDisponibile } from "@/lib/copertina-diritto";

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
