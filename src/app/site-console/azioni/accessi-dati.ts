"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { validaRegistrazione } from "@/lib/console/accessi-dati-calcoli";
import { trovaClientePerEmail } from "@/lib/console/accessi-dati";
import { schemaAssente } from "@/lib/omnia-ai-incassi";

// Registra un accesso del personale ai documenti o ai contenuti di un cliente (registro
// promesso da condizioni di abbonamento art. 10 e Allegato A art. 4, migrazione 0082).
//
// L'operatore NON è un campo del modulo: è l'amministratore la cui sessione sta
// scrivendo, così nessuno può registrare un accesso a nome di un altro. La riga
// non si modifica più (il registro è solo in aggiunta): per correggere si scrive una
// nuova riga.

export type StatoRegistrazioneAccesso = { errore?: string; ok?: boolean; avviso?: string };

export async function registraAccesso(_stato: StatoRegistrazioneAccesso, formData: FormData): Promise<StatoRegistrazioneAccesso> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };

  const campo = (nome: string) => String(formData.get(nome) ?? "");
  const esito = validaRegistrazione(
    {
      caso: campo("caso"),
      riguarda: campo("riguarda"),
      clienteEmail: campo("cliente"),
      motivo: campo("motivo"),
      ambito: campo("ambito"),
      data: campo("data"),
      ora: campo("ora"),
      garaId: campo("gara"),
    },
    new Date(),
  );
  if (!esito.ok) return { errore: esito.errore };
  const v = esito.valori;

  // Il cliente si identifica dall'email. Se non esiste (account già eliminato) l'accesso si
  // registra comunque, con la sola email: il registro non deve rifiutare un accesso avvenuto.
  const cliente = v.clienteEmail ? await trovaClientePerEmail(v.clienteEmail) : null;

  const { error } = await createAdminClient()
    .from("omnia_ai_accessi_dati")
    .insert({
      accesso_il: v.accessoIl.toISOString(),
      operatore_id: sessione.userId,
      operatore_email: sessione.email,
      cliente_id: cliente?.id ?? null,
      cliente_email: v.tuttiIClienti ? null : v.clienteEmail,
      tutti_i_clienti: v.tuttiIClienti,
      caso: v.caso,
      motivo: v.motivo,
      ambito: v.ambito,
      gara_id: v.garaId,
    });
  if (error) {
    console.error("Console: registrazione dell'accesso ai dati fallita", error.message);
    if (schemaAssente(error)) return { errore: "Il registro non esiste ancora nel database: eseguire la migrazione 0082. L'accesso NON è stato registrato." };
    return { errore: "Registrazione non riuscita: l'accesso NON è stato registrato, riprova." };
  }

  revalidatePath("/site-console", "layout");
  if (!v.tuttiIClienti && !cliente) return { ok: true, avviso: "Registrato. Nessun utente ha questa email (account eliminato?): l'accesso compare nell'estratto solo cercando per email." };
  return { ok: true };
}
