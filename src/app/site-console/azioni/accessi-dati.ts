"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediAdminAzione } from "@/lib/console/accesso";
import { validaRegistrazione } from "@/lib/console/accessi-dati-calcoli";
import { trovaClientePerEmail } from "@/lib/console/accessi-dati";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { UUID_CLIENTE, giornoValido } from "@/lib/console/accessi-dati-estratto";
import { inviaEstrattoAccessi } from "@/lib/console/accessi-dati-invio";

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
  if (!v.tuttiIClienti && !cliente) return { ok: true, avviso: "Registrato. Nessun utente ha questa email (account eliminato?): l'accesso compare nell'estratto solo cercando per email. Nessuna email inviata." };

  // L'estratto aggiornato parte al cliente in PDF, se la casella è spuntata. Solo per un accesso a UN cliente: un accesso
  // generale al database non si notifica a tutti i clienti da qui. L'accesso è già registrato: un invio fallito non lo annulla.
  if (!v.tuttiIClienti && cliente && formData.get("invia_estratto") === "si") {
    const invio = await inviaEstrattoAccessi({
      clienteId: cliente.id,
      operatore: sessione.email,
      occasione: "nuovo_accesso",
      accesso: { accessoIl: v.accessoIl, caso: v.caso, ambito: v.ambito, motivo: v.motivo },
    });
    if (!invio.ok) return { ok: true, avviso: `Registrato, ma l'estratto NON è partito (${invio.motivo}). Rimandalo dalla pagina dell'estratto con «Invia al cliente».` };
    return { ok: true, avviso: `Registrato. Estratto in PDF inviato a ${invio.a}.` };
  }
  return { ok: true };
}

export type StatoInvioEstratto = { errore?: string; ok?: boolean; avviso?: string };

// Manda al cliente l'estratto in PDF dalla pagina dell'estratto (stesso periodo mostrato), per esempio quando lo chiede.
export async function inviaEstrattoAlCliente(_stato: StatoInvioEstratto, formData: FormData): Promise<StatoInvioEstratto> {
  const sessione = await richiediAdminAzione();
  if (!sessione) return { errore: "Non autorizzato." };
  const clienteId = String(formData.get("cliente") ?? "");
  if (!UUID_CLIENTE.test(clienteId)) return { errore: "Cliente non valido." };
  const invio = await inviaEstrattoAccessi({
    clienteId,
    dal: giornoValido(String(formData.get("dal") ?? "") || undefined),
    al: giornoValido(String(formData.get("al") ?? "") || undefined),
    operatore: sessione.email,
    occasione: "su_richiesta",
  });
  if (!invio.ok) return { errore: `Estratto non inviato: ${invio.motivo}.` };
  return { ok: true, avviso: `Estratto in PDF inviato a ${invio.a}.` };
}
