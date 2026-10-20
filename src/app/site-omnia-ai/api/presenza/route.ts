import { createClient } from "@/lib/supabase/server";
import { DIMENSIONE_MASSIMA_CORPO, leggiSegnale } from "@/lib/omnia-ai-presenza-calcoli";
import { registraSegnale } from "@/lib/omnia-ai-presenza";

// Il segnale di presenza dell'area riservata di OMNIA AI (migrazione 0094): arriva dal browser ogni ~45 secondi finché la
// scheda è aperta e visibile. Regole:
//   - chi è lo decide SOLO la sessione (cookie), mai il corpo della richiesta: nessuno può scrivere la presenza di un altro;
//   - senza sessione, 401 (il browser smette di mandare segnali);
//   - il corpo è un piccolo JSON {attivo, percorso}, con un tetto di dimensione; del percorso si tiene soltanto la SEZIONE;
//   - risposta sempre vuota e senza cache; un errore di scrittura non diventa un errore per l'utente.
export const dynamic = "force-dynamic";

const INTESTAZIONI = { "Cache-Control": "no-store" };

// Legge il corpo fino a `max` byte: se è più lungo si ferma e dice null (senza caricarlo tutto in memoria).
async function leggiCorpoLimitato(request: Request, max: number): Promise<string | null> {
  const lettore = request.body?.getReader();
  if (!lettore) return "";
  const pezzi: Uint8Array[] = [];
  let totale = 0;
  for (;;) {
    const { done, value } = await lettore.read();
    if (done) break;
    totale += value.byteLength;
    if (totale > max) {
      await lettore.cancel();
      return null;
    }
    pezzi.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(pezzi));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401, headers: INTESTAZIONI });

  const dichiarata = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(dichiarata) && dichiarata > DIMENSIONE_MASSIMA_CORPO) return new Response(null, { status: 413, headers: INTESTAZIONI });

  const corpo = await leggiCorpoLimitato(request, DIMENSIONE_MASSIMA_CORPO).catch(() => null);
  if (corpo === null) return new Response(null, { status: 413, headers: INTESTAZIONI });

  const segnale = leggiSegnale(corpo);
  if (!segnale) return new Response(null, { status: 400, headers: INTESTAZIONI });

  await registraSegnale(user.id, segnale);
  return new Response(null, { status: 204, headers: INTESTAZIONI });
}
