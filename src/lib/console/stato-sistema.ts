import { createAdminClient } from "@/lib/supabase/admin";

// Controlli di stato mostrati nella Panoramica. Nessun valore segreto esce da
// qui: delle chiavi si legge solo se sono presenti e, per Stripe, il prefisso
// pubblico che distingue modalità live e di prova (sk_live_ / sk_test_).

export type VoceStato = {
  voce: string;
  esito: "ok" | "avviso" | "errore";
  dettaglio: string;
};

export type StatoSistema = { voci: VoceStato[]; pingMs: number | null };

function modalitaStripe(chiave: string | undefined): "live" | "prova" | null {
  if (!chiave) return null;
  if (/^[sr]k_live_/.test(chiave)) return "live";
  if (/^[sr]k_test_/.test(chiave)) return "prova";
  return null;
}

export async function leggiStatoSistema(opzioni: { registroAccessiDisponibile: boolean }): Promise<StatoSistema> {
  const voci: VoceStato[] = [];

  let pingMs: number | null = null;
  try {
    const inizio = Date.now();
    const { error } = await createAdminClient().from("users").select("id", { count: "exact", head: true });
    pingMs = Date.now() - inizio;
    voci.push(
      error
        ? { voce: "Database", esito: "errore", dettaglio: `Interrogazione fallita: ${error.message}` }
        : { voce: "Database", esito: "ok", dettaglio: `Raggiungibile, risposta in ${pingMs} ms` },
    );
  } catch (e) {
    voci.push({ voce: "Database", esito: "errore", dettaglio: e instanceof Error ? e.message : "Non raggiungibile" });
  }

  voci.push(
    opzioni.registroAccessiDisponibile
      ? { voce: "Registro accessi", esito: "ok", dettaglio: "Tabella console_accessi presente" }
      : {
          voce: "Registro accessi",
          esito: "avviso",
          dettaglio: "Tabella assente: eseguire la migrazione 0074. Senza, nessuna traccia e nessun limite alle richieste di link",
        },
  );

  voci.push(
    process.env.RESEND_API_KEY
      ? { voce: "Email transazionali", esito: "ok", dettaglio: "Chiave Resend configurata" }
      : { voce: "Email transazionali", esito: "errore", dettaglio: "RESEND_API_KEY mancante: il link di accesso non può partire" },
  );

  const ecommerce = modalitaStripe(process.env.STRIPE_SECRET_KEY);
  voci.push(
    ecommerce === "live"
      ? { voce: "Stripe e-commerce", esito: "ok", dettaglio: "Chiave in modalità live" }
      : ecommerce === "prova"
        ? { voce: "Stripe e-commerce", esito: "avviso", dettaglio: "Chiave in modalità di prova: gli incassi non sono reali" }
        : { voce: "Stripe e-commerce", esito: "errore", dettaglio: "Chiave mancante o non riconosciuta" },
  );

  const omniaAi = modalitaStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI);
  voci.push(
    omniaAi === "live"
      ? { voce: "Stripe OMNIA AI", esito: "ok", dettaglio: "Chiave in modalità live" }
      : omniaAi === "prova"
        ? { voce: "Stripe OMNIA AI", esito: "avviso", dettaglio: "Modalità di prova: abbonamenti e crediti AI non sono incassi reali" }
        : { voce: "Stripe OMNIA AI", esito: "errore", dettaglio: "Chiave mancante o non riconosciuta" },
  );

  return { voci, pingMs };
}
