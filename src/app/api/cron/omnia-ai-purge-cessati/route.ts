import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { collectGaraFilePaths, removeGaraFiles } from "@/lib/gara-storage";
import { creaNotifica } from "@/lib/omnia-ai-notifiche";

// Mezzanotte UTC del giorno corrente + offset: le colonne "scadenza"
// coinvolte sono un date puro (gare.scadenza), confrontato per
// uguaglianza esatta — scatta una sola volta, il giorno in cui la
// soglia viene attraversata, l'indice unico di dedup è solo la seconda
// rete di sicurezza contro un doppio run nello stesso giorno.
function dataOffset(giorni: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
}

// subscriptions.current_period_end è un timestamptz (viene da Stripe,
// porta un orario): l'uguaglianza esatta su una data non funzionerebbe,
// serve la finestra dell'intero giorno.
function finestraGiorno(giorni: number): { inizio: string; fine: string } {
  const inizio = new Date();
  inizio.setUTCHours(0, 0, 0, 0);
  inizio.setUTCDate(inizio.getUTCDate() + giorni);
  const fine = new Date(inizio);
  fine.setUTCDate(fine.getUTCDate() + 1);
  return { inizio: inizio.toISOString(), fine: fine.toISOString() };
}

// Chiamata una volta al giorno da Vercel Cron (vedi vercel.json): nessun
// cliente preme un pulsante per far scattare la cancellazione dei
// contenuti dopo 30 giorni di sola lettura, quindi deve farlo un job.
// Autenticazione: Vercel invia automaticamente "Authorization: Bearer
// $CRON_SECRET" quando la variabile d'ambiente CRON_SECRET è impostata
// sul progetto — nessun meccanismo custom da inventare, ma va verificata
// qui altrimenti chiunque potrebbe chiamare questa route pubblicamente.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Solo chi ha avuto almeno un abbonamento può essere "cessato": chi
  // non si è mai abbonato non ha contenuti da cancellare.
  const { data: subscriptionUsers } = await admin
    .from("subscriptions")
    .select("user_id")
    .returns<{ user_id: string }[]>();

  const userIds = [...new Set((subscriptionUsers ?? []).map((s) => s.user_id))];

  let svuotati = 0;
  let falliti = 0;
  const dettagliErrori: string[] = [];

  for (const userId of userIds) {
    try {
      const stato = await getOmniaAiAccessState(userId, admin);
      if (stato.stato !== "cessato") continue;

      // La subscription più recente è quella la cui cessazione ha
      // portato allo stato "cessato": è su quella riga che si marca
      // contenuti_cancellati_at, per non rielaborare l'utente ogni
      // giorno una volta già svuotato.
      const { data: subscription } = await admin
        .from("subscriptions")
        .select("id, contenuti_cancellati_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; contenuti_cancellati_at: string | null }>();

      if (!subscription || subscription.contenuti_cancellati_at) continue;

      const { data: gare } = await admin
        .from("gare")
        .select("id")
        .eq("user_id", userId)
        .returns<{ id: string }[]>();

      for (const gara of gare ?? []) {
        const filePaths = await collectGaraFilePaths(admin, gara.id);
        const { error: deleteError } = await admin.from("gare").delete().eq("id", gara.id);
        if (deleteError) throw deleteError;
        await removeGaraFiles(filePaths);
      }

      // Rete di sicurezza: normalmente già azzerati da
      // handleOmniaAiSubscriptionDeleted al momento della cessazione,
      // ripetuto qui nel caso quell'evento non sia mai arrivato (es.
      // impostazioni di riaddebito Stripe diverse da "Cancel the
      // subscription").
      await admin.from("credits").update({ balance: 0 }).eq("user_id", userId);

      const { error: stampError } = await admin
        .from("subscriptions")
        .update({ contenuti_cancellati_at: new Date().toISOString() })
        .eq("id", subscription.id);

      if (stampError) throw stampError;

      svuotati++;
    } catch (err) {
      falliti++;
      const messaggio = err instanceof Error ? err.message : String(err);
      dettagliErrori.push(`${userId}: ${messaggio}`);
      console.error("Cron purge OMNIA AI: errore su utente", userId, err);
    }
  }

  // Gare in scadenza fra 7 e fra 2 giorni: due cicli indipendenti dal
  // giro per-utente sopra (quello riguarda solo gli account cessati),
  // eseguiti nella stessa esecuzione giornaliera come richiesto, non in
  // una route cron separata.
  for (const [giorni, tipo] of [
    [7, "gara_scadenza_7gg"],
    [2, "gara_scadenza_2gg"],
  ] as const) {
    const { data: gareInScadenza } = await admin
      .from("gare")
      .select("id, user_id, titolo")
      .eq("scadenza", dataOffset(giorni))
      .returns<{ id: string; user_id: string; titolo: string }[]>();

    for (const gara of gareInScadenza ?? []) {
      await creaNotifica({
        userId: gara.user_id,
        tipo,
        garaId: gara.id,
        titolo: giorni === 7 ? "Gara in scadenza fra 7 giorni" : "Gara in scadenza fra 2 giorni",
        corpo: `"${gara.titolo}" scade fra ${giorni} giorni.`,
        chiaveDedup: gara.id,
      });
    }
  }

  // Rinnovo abbonamento fra 3 giorni.
  const finestraRinnovo = finestraGiorno(3);
  const { data: rinnoviInArrivo } = await admin
    .from("subscriptions")
    .select("id, user_id, current_period_end")
    .eq("status", "attivo")
    .gte("current_period_end", finestraRinnovo.inizio)
    .lt("current_period_end", finestraRinnovo.fine)
    .returns<{ id: string; user_id: string; current_period_end: string }[]>();

  for (const sub of rinnoviInArrivo ?? []) {
    await creaNotifica({
      userId: sub.user_id,
      tipo: "rinnovo_3gg",
      garaId: null,
      titolo: "Rinnovo fra 3 giorni",
      corpo: `Il tuo abbonamento si rinnova fra 3 giorni, il ${new Date(sub.current_period_end).toLocaleDateString("it-IT")}.`,
      chiaveDedup: `${sub.id}:${sub.current_period_end}`,
    });
  }

  // Una riga per ogni esecuzione, anche quando non c'è nulla da
  // svuotare: è la prova che il job sta girando, guardando la tabella
  // invece di scoprirne l'assenza da un cliente che ha ancora i suoi
  // dati dopo due mesi.
  await admin.from("omnia_ai_purge_log").insert({
    account_esaminati: userIds.length,
    account_svuotati: svuotati,
    account_falliti: falliti,
    dettaglio: dettagliErrori.length ? dettagliErrori.join("; ").slice(0, 4000) : null,
  });

  return NextResponse.json({ esaminati: userIds.length, svuotati, falliti });
}
