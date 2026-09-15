import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { collectGaraFilePaths, removeGaraFiles } from "@/lib/gara-storage";

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
