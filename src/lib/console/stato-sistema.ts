import { createAdminClient } from "@/lib/supabase/admin";
import { statoTurnstile } from "@/lib/turnstile-calcoli";

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

// Provider di modelli con una chiave configurata in QUESTO ambiente. Serve alla
// pagina Costi per accorgersi di un provider collegato le cui chiamate non
// vengono registrate in ai_operazioni (e quindi non entrano nei costi). Solo i
// nomi: delle chiavi si legge unicamente se esistono.
const PROVIDER_CONOSCIUTI: { provider: string; variabile: string }[] = [
  { provider: "anthropic", variabile: "ANTHROPIC_API_KEY" },
  { provider: "voyage", variabile: "VOYAGE_API_KEY" },
  { provider: "openai", variabile: "OPENAI_API_KEY" },
];

export function providerConfigurati(): { provider: string; variabile: string }[] {
  return PROVIDER_CONOSCIUTI.filter((p) => Boolean(process.env[p.variabile]));
}

// true se la chiave Stripe di OMNIA AI è di prova: abbonamenti e crediti AI sono
// allora acquisti di prova e un ricavo calcolato su di essi non è denaro reale.
export function stripeOmniaAiInProva(): boolean {
  return modalitaStripe(process.env.STRIPE_SECRET_KEY_OMNIA_AI) === "prova";
}

// Dove sta girando la console: le chiavi e le variabili che legge sono quelle
// di QUEL processo. In locale sono le chiavi di .env.local (di prova), in
// produzione quelle di Vercel: la stessa voce può quindi dire cose diverse.
function ambienteEsecuzione(): "produzione" | "anteprima" | "locale" {
  if (process.env.VERCEL_ENV === "production") return "produzione";
  if (process.env.VERCEL_ENV === "preview") return "anteprima";
  return "locale";
}

export async function leggiStatoSistema(opzioni: { registroAccessiDisponibile: boolean }): Promise<StatoSistema> {
  const voci: VoceStato[] = [];
  const ambiente = ambienteEsecuzione();

  voci.push({
    voce: "Ambiente",
    esito: "ok",
    dettaglio:
      ambiente === "produzione"
        ? "Produzione (Vercel): le chiavi lette sono quelle di produzione"
        : ambiente === "anteprima"
          ? "Anteprima Vercel: variabili dell'anteprima, non quelle di produzione"
          : "Locale: le chiavi lette sono quelle di .env.local, non quelle di produzione",
  });

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

  // Verifica anti-bot dei moduli pubblici (Cloudflare Turnstile): attiva solo con entrambe le chiavi.
  const antibot = statoTurnstile({ chiaveSito: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, chiaveSegreta: process.env.TURNSTILE_SECRET_KEY });
  voci.push(
    antibot === "attiva"
      ? { voce: "Verifica anti-bot (Turnstile)", esito: "ok", dettaglio: "Attiva su richiesta demo, registrazione, login e password dimenticata" }
      : antibot === "incompleta"
        ? { voce: "Verifica anti-bot (Turnstile)", esito: "avviso", dettaglio: "Manca una delle due chiavi (NEXT_PUBLIC_TURNSTILE_SITE_KEY o TURNSTILE_SECRET_KEY): la verifica resta spenta" }
        : {
            voce: "Verifica anti-bot (Turnstile)",
            esito: "avviso",
            dettaglio: ambiente === "produzione" ? "Spenta: chiavi non impostate, i moduli pubblici non hanno nessuna verifica anti-bot" : `Spenta in questo ambiente (${ambiente}): normale in locale`,
          },
  );

  const ecommerce = modalitaStripe(process.env.STRIPE_SECRET_KEY);
  voci.push(
    ecommerce === "live"
      ? { voce: "Stripe e-commerce", esito: "ok", dettaglio: "Chiave in modalità live" }
      : ecommerce === "prova"
        ? ambiente === "produzione"
          ? { voce: "Stripe e-commerce", esito: "avviso", dettaglio: "Chiave in modalità di prova in produzione: gli incassi non sono reali" }
          : { voce: "Stripe e-commerce", esito: "ok", dettaglio: `Chiave di prova in questo ambiente (${ambiente}): normale; in produzione si legge quella live di Vercel` }
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
