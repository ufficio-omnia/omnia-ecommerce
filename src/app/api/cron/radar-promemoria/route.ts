import { NextResponse, type NextRequest } from "next/server";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { statoInvioEmail } from "@/lib/radar/notifiche/interruttore";

// Tender Intelligence, fase B4 (20/11/2026, B2): processo del motore delle notifiche email (fase «eventi» una volta al giorno di Roma, fase
// «invio» a ogni passaggio). PREPARATO MA NON ATTIVO:
//   - questo percorso NON è in vercel.json (la voce consigliata, ogni 30 minuti dalle 05:30 alle 19:30 UTC, si aggiunge solo con
//     un'autorizzazione dell'utente);
//   - prima di qualunque lettura: il segreto del cron (CRON_SECRET), poi l'interruttore unico RADAR_NOTIFICHE_EMAIL («attivo», mai sulle
//     anteprime, solo con il database dello staging). Spento = risposta immediata, nessun modulo del database caricato;
//   - il motore usa SOLO il provider finto (Resend chiuso nel codice).
// La risposta contiene solo numeri e motivi: nessun indirizzo, nessun testo delle email.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stato = statoInvioEmail(process.env);
  if (!stato.acceso) {
    return NextResponse.json({ eseguito: false, motivo: stato.motivo }, { headers: { "Cache-Control": "no-store" } });
  }
  let risultato: unknown;
  try {
    const [{ dipendenzeReali, eseguiPassaggio }, { PARAMETRI_PROPOSTI }] = await Promise.all([import("@/lib/radar/notifiche/motore"), import("@/lib/radar/notifiche/parametri")]);
    risultato = await eseguiPassaggio(await dipendenzeReali(process.env, PARAMETRI_PROPOSTI));
  } catch {
    risultato = { eseguito: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
