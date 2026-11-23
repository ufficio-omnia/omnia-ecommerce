import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiImportazioneTed } from "@/lib/radar/importa-ted";
import { portaGiroProgrammato } from "@/lib/radar/giro-programmato";

// Tender Intelligence: giri programmati da TED alle 10:15 e alle 16:15 ora di Roma, nei giorni feriali (piano 48C §3.2, D2 dell'utente).
// Guardie in quest'ordine (48C §3.1), le prime tre PRIMA di qualunque lettura del database:
//   1. segreto del cron; 2. RADAR_TED_CRON=attivo (spento di base, K1); 3. porta oraria di Roma (vercel.json chiama entrambe le ore UTC
//   possibili, CRON_PROPOSTI in programmazione-calcoli.ts, e passa solo quella giusta); poi nell'importatore: ambiente consentito, fonte
//   accesa dalla console, doppio richiamo, un giro alla volta.
// Un giro dura al massimo 4 minuti e 40 pagine; se non basta (recupero) riprende al giro dopo dal punto salvato. La risposta contiene solo
// numeri e motivi.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const porta = portaGiroProgrammato("ted", process.env, new Date());
  if (!porta.passa) return NextResponse.json({ eseguita: false, motivo: porta.motivo }, { headers: { "Cache-Control": "no-store" } });
  let risultato: unknown;
  try {
    const esito = await eseguiImportazioneTed(createAdminClient(), { tempoMassimoMs: 240_000, pagineMassime: 40 });
    risultato = esito.eseguita ? { eseguita: true, fase: esito.fase, giroFinito: esito.giroFinito, fermata: esito.fermata, sospesa: esito.sospesa, totali: esito.totali, durataMs: esito.durataMs, errore: esito.errore } : esito;
  } catch {
    risultato = { eseguita: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
