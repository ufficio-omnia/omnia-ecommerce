import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { riprovaEmailNonInviate } from "@/lib/omnia-ai-email-eventi";

// Chiamata ogni 15 minuti da Vercel Cron (vedi vercel.json): rimanda le email automatiche legate agli
// eventi di Stripe che non sono partite (servizio di posta momentaneamente fuori uso, funzione
// interrotta a metà). Una email partita non viene mai rimandata: il registro (migrazione 0087) lo
// impedisce. Stessa autenticazione dell'altra route cron: Vercel manda "Authorization: Bearer
// $CRON_SECRET", e senza questo controllo chiunque potrebbe chiamarla.
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const esito = await riprovaEmailNonInviate(createAdminClient());
  return NextResponse.json(esito);
}
