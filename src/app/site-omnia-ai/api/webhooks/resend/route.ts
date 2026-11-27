import { NextResponse, type NextRequest } from "next/server";
import { gestisciEvento, verificaFirmaSvix } from "@/lib/newsletter/webhook";

// Webhook di Resend per la newsletter: https://omnia-ai.it/api/webhooks/resend (eventi delivered, bounced,
// complained, delivery_delayed, opened, clicked, failed). Firma Svix verificata con RESEND_WEBHOOK_SECRET: senza
// segreto o con firma errata → 401 e nessuna lettura del database. Eventi di email non della newsletter: ignorati.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const corpo = await request.text();
  const ok = verificaFirmaSvix(
    corpo,
    { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), firma: request.headers.get("svix-signature") },
    process.env.RESEND_WEBHOOK_SECRET,
  );
  if (!ok) return NextResponse.json({ error: "firma non valida" }, { status: 401 });
  let evento: unknown;
  try {
    evento = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ error: "corpo non valido" }, { status: 400 });
  }
  try {
    const esito = await gestisciEvento(request.headers.get("svix-id")!, evento as Parameters<typeof gestisciEvento>[1]);
    return NextResponse.json({ esito });
  } catch (e) {
    console.error("Newsletter: evento del webhook non registrato", e instanceof Error ? e.message : e);
    // 500: Resend riprova più tardi (l'evento è idempotente grazie a svix_id)
    return NextResponse.json({ error: "errore" }, { status: 500 });
  }
}
