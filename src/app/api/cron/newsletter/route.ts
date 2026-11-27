import { NextResponse, type NextRequest } from "next/server";
import { cronAutorizzato } from "@/lib/cron-autorizzato";

// Newsletter «Tender Weekly»: processo pianificato (consigliato ogni 15 minuti). PREPARATO MA NON ATTIVO:
//   - il percorso NON è in vercel.json: la voce si aggiunge solo con l'autorizzazione dell'utente;
//   - prima di tutto il segreto del cron (CRON_SECRET), poi l'interruttore NEWSLETTER_CRON («attivo»). Spento = risposta
//     immediata, nessuna lettura del database;
//   - invia SOLO le edizioni APPROVATE e PROGRAMMATE con orario già passato (la presa dello stato è condizionata: un
//     invio contemporaneo dalla console non raddoppia);
//   - genera la bozza della settimana nella finestra «giorno e ora di generazione + 20 ore» (impostazioni della console,
//     ora di Roma), una sola per settimana ISO (vincolo unico sul database). La bozza NON parte da sola;
//   - avvisa l'amministratore quando la bozza è pronta (solo sul deploy di produzione).
// La risposta contiene solo numeri e motivi: nessun indirizzo, nessun testo.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.NEWSLETTER_CRON !== "attivo") {
    return NextResponse.json({ eseguito: false, motivo: "interruttore_spento" }, { headers: { "Cache-Control": "no-store" } });
  }
  const { eseguiPassaggioNewsletter } = await import("@/lib/newsletter/cron");
  const risultato = await eseguiPassaggioNewsletter(new Date());
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
