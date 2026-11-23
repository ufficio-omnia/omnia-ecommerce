import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAutorizzato } from "@/lib/cron-autorizzato";
import { eseguiImportazioneRegionale } from "@/lib/radar/importa-regionali";
import { portaGiroProgrammato } from "@/lib/radar/giro-programmato";

// Tender Intelligence: giri programmati da SardegnaCAT alle 08:20, 11:20, 14:20 e 17:20 ora di Roma nei giorni feriali e alle 12:20 il sabato
// e la domenica (piano 48C §3.2; il feed chiede una frequenza bassa). Rotta propria dal K1 (prima era insieme a Sintel in radar-regionali,
// che resta finché il coordinamento non cambia vercel.json). NON è in vercel.json: le righe le mette il coordinamento al rilascio autorizzato.
// Guardie in quest'ordine (48C §3.1), le prime tre PRIMA di qualunque lettura del database:
//   1. segreto del cron; 2. RADAR_SARDEGNACAT_CRON=attivo (spento di base); 3. porta oraria di Roma; poi nell'importatore: ambiente
//   consentito, fonte accesa dalla console, doppio richiamo, un giro alla volta (e il semaforo del coordinamento), limiti verso la fonte.
// La risposta contiene solo numeri e motivi.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!cronAutorizzato(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const porta = portaGiroProgrammato("sardegnacat", process.env, new Date());
  if (!porta.passa) return NextResponse.json({ eseguita: false, motivo: porta.motivo }, { headers: { "Cache-Control": "no-store" } });
  let risultato: unknown;
  try {
    const esito = await eseguiImportazioneRegionale(createAdminClient(), "sardegnacat", { tempoMassimoMs: 120_000 });
    risultato = esito.eseguita ? { eseguita: true, invariataAllaFonte: esito.invariataAllaFonte, sospesa: esito.sospesa, statistiche: esito.statistiche, durataMs: esito.durataMs, errore: esito.errore } : esito;
  } catch {
    risultato = { eseguita: false, motivo: "errore_imprevisto" };
  }
  return NextResponse.json(risultato, { headers: { "Cache-Control": "no-store" } });
}
