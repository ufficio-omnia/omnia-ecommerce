"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { BASE_URL } from "@/lib/zone";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { confermaPagamentoBonifico } from "@/lib/console/ordini";

// Azioni sugli ordini. Ognuna parte da richiediAdminAzione(). L'esito di
// un'azione riuscita si mostra con un redirect e un avviso in cima alla pagina
// (parametri ?esito=…): la riga su cui si è cliccato sparisce o cambia, quindi
// un messaggio dentro la riga andrebbe perso — e "email al cliente non partita"
// è un'informazione che non deve perdersi.

export type StatoAzione = { errore?: string };

const LIMITE_BYTE_FATTURA = 15 * 1024 * 1024;

// Il percorso reale del file, non quello visto dal browser (la console è
// riscritta da /site-console): invalida il layout e quindi tutte le pagine.
function ricaricaConsole() {
  revalidatePath("/site-console", "layout");
}

export async function confermaBonifico(_stato: StatoAzione, formData: FormData): Promise<StatoAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { errore: "Ordine non valido." };

  const esito = await confermaPagamentoBonifico(createAdminClient(), { orderId, adminId: sessione.userId });
  if (!esito.ok) return { errore: esito.errore };

  ricaricaConsole();
  const parametri = new URLSearchParams({
    esito: "confermato",
    ordine: orderId.slice(0, 8),
    email: esito.emailInviata ? "1" : "0",
  });
  if (!esito.dataRegistrata) parametri.set("data", "0");
  redirect(`/bonifici?${parametri.toString()}`);
}

export async function caricaFattura(_stato: StatoAzione, formData: FormData): Promise<StatoAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const orderId = String(formData.get("orderId") ?? "");
  const file = formData.get("file");
  if (!orderId) return { errore: "Ordine non valido." };
  if (!(file instanceof File) || file.size === 0) return { errore: "Scegli un file PDF." };
  if (file.size > LIMITE_BYTE_FATTURA) return { errore: "Il file supera i 15 MB." };
  // Non basta il tipo dichiarato dal browser: un PDF vero comincia con "%PDF".
  if (!(await file.slice(0, 5).text()).startsWith("%PDF")) return { errore: "Il file non è un PDF." };

  const admin = createAdminClient();

  const { data: ordine } = await admin
    .from("orders")
    .select("status, users(email)")
    .eq("id", orderId)
    .maybeSingle<{ status: string; users: { email: string } | null }>();
  if (!ordine) return { errore: "Ordine non trovato." };
  if (ordine.status !== "pagato") return { errore: "La fattura si carica solo per un ordine pagato." };

  // Service role: l'upload con la sessione dell'utente falliva sulla RLS dello
  // storage per motivi non chiari (vedi la nota nel vecchio pannello admin).
  // Il controllo admin qui sopra è la barriera.
  const percorso = `${orderId}.pdf`;
  const { error: erroreUpload } = await admin.storage
    .from("invoices")
    .upload(percorso, file, { contentType: "application/pdf", upsert: true });
  if (erroreUpload) {
    console.error("Console: upload fattura fallito", erroreUpload.message);
    return { errore: "Caricamento del file non riuscito." };
  }

  const { error: erroreRiga } = await admin
    .from("invoices")
    .upsert({ order_id: orderId, file_path: percorso }, { onConflict: "order_id" });
  if (erroreRiga) {
    console.error("Console: salvataggio fattura fallito", erroreRiga.message);
    return { errore: "File caricato ma fattura non registrata: riprova." };
  }

  let emailInviata = false;
  if (ordine.users?.email) {
    emailInviata = await sendEmail({
      to: ordine.users.email,
      subject: "La tua fattura è disponibile",
      html: `<p>La fattura relativa al tuo ordine è ora disponibile nella tua area riservata.</p><p><a href="${BASE_URL}/dashboard">Vai alla dashboard</a></p>`,
    });
  }

  ricaricaConsole();
  redirect(`/ordini?${new URLSearchParams({ esito: "fattura", ordine: orderId.slice(0, 8), email: emailInviata ? "1" : "0" })}`);
}

export async function eliminaOrdine(_stato: StatoAzione, formData: FormData): Promise<StatoAzione> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { errore: "Ordine non valido." };

  const admin = createAdminClient();

  // Il file della fattura si legge prima: la riga in "invoices" sparisce a
  // cascata con l'ordine, il file nello storage no e va tolto a parte.
  const { data: fattura } = await admin
    .from("invoices")
    .select("file_path")
    .eq("order_id", orderId)
    .maybeSingle<{ file_path: string }>();

  const { error } = await admin.from("orders").delete().eq("id", orderId);
  if (error) {
    console.error("Console: eliminazione ordine fallita", error.message);
    // Le accettazioni contrattuali registrate (legal_acceptances) bloccano la
    // cancellazione di proposito: la prova non deve sparire con l'ordine.
    if (/foreign key|violat/i.test(error.message)) {
      return {
        errore:
          "Impossibile eliminare: l'ordine ha accettazioni contrattuali registrate, che per obbligo di legge non si cancellano.",
      };
    }
    return { errore: "Errore nell'eliminazione dell'ordine." };
  }

  if (fattura?.file_path) await admin.storage.from("invoices").remove([fattura.file_path]);

  ricaricaConsole();
  redirect(`/ordini?${new URLSearchParams({ esito: "eliminato", ordine: orderId.slice(0, 8) })}`);
}
