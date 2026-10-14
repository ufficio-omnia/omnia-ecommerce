import { createAdminClient } from "@/lib/supabase/admin";
import { PIANI, normalizzaPianoSlug } from "@/lib/omnia-ai-plans";
import { creaNotifica } from "@/lib/omnia-ai-notifiche";
import { MESSAGGIO_GARE_GRATUITE_ESAURITE, calcolaGareGratuite } from "@/lib/omnia-ai-gare-gratuite";

export type ConsumoResult = { error?: string };

const MESSAGGIO_QUOTA_ESAURITA =
  "Hai esaurito le gare incluse nel tuo piano e i crediti aggiuntivi. Acquista crediti o attendi il rinnovo del piano per continuare.";

// Una gara si consuma una sola volta nella vita, nell'istante in cui
// parte l'analisi documenti: l'indice unico parziale su gara_consumi
// (gara_id, solo dove non è null) è la vera garanzia di idempotenza
// (anche sotto doppio click concorrente), il controllo qui sotto è solo
// l'ottimizzazione per non tentare un insert inutile nel caso comune
// (rianalisi). gara_id resta annullabile e sopravvive alla cancellazione
// della gara (on delete set null, non cascade): il consumo è un fatto
// storico, cancellare la gara non deve mai liberare quota.
//
// subscriptions.plan è testo libero digitato a mano dal form admin
// (non vincolato agli slug di PIANI): un piano sconosciuto vale 0 gare
// incluse, si passa direttamente ai crediti invece di bloccare per un
// dato admin imperfetto. Stesso discorso per current_period_start, mai
// valorizzato dal form admin: si usa created_at come inizio finestra.
export async function consumeGaraQuotaIfNeeded({
  garaId,
  userId,
}: {
  garaId: string;
  userId: string;
}): Promise<ConsumoResult> {
  const admin = createAdminClient();

  const { data: consumoEsistente } = await admin
    .from("gara_consumi")
    .select("id")
    .eq("gara_id", garaId)
    .maybeSingle<{ id: string }>();

  if (consumoEsistente) {
    return {};
  }

  // Il titolo va catturato ora, al momento del consumo: gara_consumi
  // sopravvive alla cancellazione della gara (on delete set null), senza
  // questa copia il registro diventerebbe illeggibile per le righe la
  // cui gara non esiste più.
  const { data: garaEsistente } = await admin
    .from("gare")
    .select("titolo, estrazione_stato, criteri_valutazione")
    .eq("id", garaId)
    .maybeSingle<{ titolo: string; estrazione_stato: string; criteri_valutazione: string | null }>();

  // Gare analizzate prima che esistesse questo registro (o comunque
  // finite con dati estratti senza una riga corrispondente, es. per un
  // bug futuro) contano come già consumate: chi ha già ricevuto
  // l'analisi non la ripaga. Si recupera la riga mancante senza scalare
  // nulla — subscription_id resta null, non essendo un vero evento di
  // consumo avvenuto ora, non si attribuisce a un abbonamento/periodo
  // che potrebbe non essere più quello di allora.
  const giaAnalizzata =
    garaEsistente?.estrazione_stato === "completata" || !!garaEsistente?.criteri_valutazione;

  if (giaAnalizzata) {
    const { error: recuperoError } = await admin.from("gara_consumi").insert({
      gara_id: garaId,
      gara_titolo: garaEsistente?.titolo ?? null,
      user_id: userId,
      subscription_id: null,
      tipo: "piano",
    });

    if (recuperoError && recuperoError.code !== "23505") {
      console.error("Errore recupero consumo gara già analizzata:", recuperoError);
    }

    return {};
  }

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("id, plan, current_period_start, current_period_end, created_at")
    .eq("user_id", userId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      plan: string;
      current_period_start: string | null;
      current_period_end: string | null;
      created_at: string;
    }>();

  const subscriptionAttiva =
    subscription &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > Date.now());

  // normalizzaPianoSlug tollera maiuscole/spazi in subscription.plan — bug
  // osservato in pratica: un piano impostato da admin con un valore come
  // "Enterprise" (form di testo libero, nessuna validazione) non veniva
  // riconosciuto con un confronto diretto, azzerando le gare incluse di un
  // abbonamento davvero attivo.
  const pianoSlug = subscriptionAttiva ? normalizzaPianoSlug(subscription.plan) : null;
  const gareIncluse = pianoSlug ? (PIANI[pianoSlug]?.gareIncluse ?? 0) : 0;

  if (subscriptionAttiva && gareIncluse > 0) {
    const inizioPeriodo = subscription.current_period_start ?? subscription.created_at;

    const { count } = await admin
      .from("gara_consumi")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tipo", "piano")
      .gte("created_at", inizioPeriodo);

    if ((count ?? 0) < gareIncluse) {
      const { error: insertError } = await admin.from("gara_consumi").insert({
        gara_id: garaId,
        gara_titolo: garaEsistente?.titolo ?? null,
        user_id: userId,
        subscription_id: subscription.id,
        tipo: "piano",
      });

      if (!insertError) {
        return {};
      }

      // Violazione unique(gara_id): un'altra richiesta concorrente ha
      // già consumato questa gara — idempotente, non un errore reale.
      if (insertError.code === "23505") {
        return {};
      }

      console.error("Errore inserimento consumo gara (piano):", insertError);
      return { error: MESSAGGIO_QUOTA_ESAURITA };
    }
  }

  const { data: crediti } = await admin
    .from("credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle<{ balance: number }>();

  const balanceLetto = crediti?.balance ?? 0;

  if (balanceLetto > 0) {
    const { error: insertError } = await admin.from("gara_consumi").insert({
      gara_id: garaId,
      gara_titolo: garaEsistente?.titolo ?? null,
      user_id: userId,
      subscription_id: subscription?.id ?? null,
      tipo: "credito",
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return {};
      }
      console.error("Errore inserimento consumo gara (credito):", insertError);
      return { error: MESSAGGIO_QUOTA_ESAURITA };
    }

    // L'ordine insert-poi-decrementa è deliberato: se il decremento
    // fallisce dopo un insert riuscito, l'utente ha comunque diritto
    // all'analisi già registrata — si perde un credito in accounting,
    // mai un blocco su un'operazione già concessa. Guardia .eq("balance",
    // balanceLetto) contro una lettura stale concorrente: se non
    // corrisponde più, si logga e basta, non si ritenta.
    const { error: decrementoError } = await admin
      .from("credits")
      .update({ balance: balanceLetto - 1 })
      .eq("user_id", userId)
      .eq("balance", balanceLetto);

    if (decrementoError) {
      console.error("Errore decremento crediti dopo consumo gara:", decrementoError);
    }

    return {};
  }

  // Cliente che non ha MAI avuto un abbonamento e ha gare gratuite assegnate dalla console:
  // si scala il contatore gratuito. Chi ha avuto un abbonamento, anche cessato, non ci passa.
  const { count: abbonamentiAvuti } = await admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((abbonamentiAvuti ?? 0) === 0) {
    const gratuita = await consumaGaraGratuita({ admin, userId, garaId, titolo: garaEsistente?.titolo ?? null });
    if (gratuita) return gratuita;
  }

  // Deduplicata per periodo di fatturazione (non per tentativo): un
  // cliente che riprova più volte nello stesso periodo non riceve una
  // notifica per ogni tentativo fallito, solo la prima volta che il
  // piano risulta davvero esaurito in quel periodo.
  const periodo = subscription?.current_period_start ?? subscription?.created_at ?? "senza-abbonamento";
  await creaNotifica({
    userId,
    tipo: "gare_piano_esaurite",
    garaId,
    titolo: "Gare del piano esaurite",
    corpo: `Hai esaurito le gare incluse nel piano e i crediti aggiuntivi: "${garaEsistente?.titolo ?? "l'ultima gara"}" resta in attesa.`,
    chiaveDedup: `${userId}:${periodo}`,
  });

  return { error: MESSAGGIO_QUOTA_ESAURITA };
}

// Consumo dal contatore delle gare gratuite (migrazione 0084). Restituisce null se il cliente
// non ha un contatore (non è in prova: chi chiama prosegue col comportamento di sempre).
// Stesso ordine del consumo da credito: prima si registra il consumo (l'indice unico su
// gara_id rende l'operazione idempotente), poi si incrementa «usate» con una guardia contro
// una lettura vecchia concorrente. A zero il cliente non perde nulla di quanto ha già: non
// può solo avviare nuove analisi.
async function consumaGaraGratuita({
  admin,
  userId,
  garaId,
  titolo,
}: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  garaId: string;
  titolo: string | null;
}): Promise<ConsumoResult | null> {
  const { data: riga } = await admin.from("omnia_ai_gare_gratuite").select("assegnate, usate").eq("user_id", userId).maybeSingle<{ assegnate: number; usate: number }>();
  const gare = calcolaGareGratuite(riga);
  if (!gare || !riga) return null;

  if (gare.rimanenti <= 0) {
    await notificaGareGratuiteEsaurite(userId, gare.assegnate);
    return { error: MESSAGGIO_GARE_GRATUITE_ESAURITE };
  }

  const { error: insertError } = await admin.from("gara_consumi").insert({
    gara_id: garaId,
    gara_titolo: titolo,
    user_id: userId,
    subscription_id: null,
    tipo: "gratuita",
  });
  if (insertError) {
    // già consumata da una richiesta concorrente: idempotente
    if (insertError.code === "23505") return {};
    console.error("Errore inserimento consumo gara (gratuita):", insertError);
    return { error: MESSAGGIO_GARE_GRATUITE_ESAURITE };
  }

  const { error: aggiornaError } = await admin
    .from("omnia_ai_gare_gratuite")
    .update({ usate: riga.usate + 1, aggiornato_il: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("usate", riga.usate);
  if (aggiornaError) console.error("Errore aggiornamento gare gratuite dopo consumo:", aggiornaError);

  // Era l'ultima: il cliente lo sa subito, nel campanello (oltre che nel banner).
  if (gare.rimanenti - 1 <= 0) await notificaGareGratuiteEsaurite(userId, gare.assegnate);
  return {};
}

// Una sola notifica per «ciclo» di gare gratuite: se la console ne assegna altre e finiscono di
// nuovo, la chiave cambia (dipende dal totale assegnato) e se ne genera una nuova.
async function notificaGareGratuiteEsaurite(userId: string, assegnate: number): Promise<void> {
  await creaNotifica({
    userId,
    tipo: "gare_gratuite_esaurite",
    garaId: null,
    titolo: "Gare gratuite esaurite",
    corpo: "Hai usato tutte le gare gratuite. Per avviare nuove analisi scegli un abbonamento dalla pagina «Abbonamento».",
    chiaveDedup: `${userId}:gratuite:${assegnate}`,
  });
}
