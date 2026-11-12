// SOLO PER IL BENCHMARK DI REGIONE (branch perf/benchmark-regione*): mai da unire in master.
// Misura, dall'interno della funzione Vercel, le distanze che cambiano con la regione:
//   ?misura=ping     → risposta immediata: il tempo visto dal client è solo rete client↔funzione + piattaforma
//   ?misura=rete     → (predefinita) andata e ritorno funzione→Supabase (Auth e REST, 10 volte ciascuno, in sequenza)
//                      e funzione→servizi esterni del motore (Anthropic, OpenAI, Voyage: 5 volte, SENZA chiavi né dati:
//                      si misura solo la connessione, la risposta è un errore di autorizzazione o una pagina vuota)
//   ?misura=stream   → 10 pezzi, uno ogni 200 ms: il client verifica che lo streaming arrivi a pezzi e non in blocco
//   ?misura=durata&secondi=N (max 100) → attesa di N secondi: verifica che una funzione lunga non venga interrotta
// Nessuna scrittura, nessun dato di clienti, nessuna chiamata ai modelli. Spento in produzione (vedi benchmark-regione.ts).
import { benchmarkAcceso, hostSupabase, statistiche, tokenValido } from "@/lib/benchmark-regione";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const INTESTAZIONI = { "Cache-Control": "no-store", "Content-Type": "application/json" };

async function cronometra(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  try {
    await fn();
  } catch {
    // la misura vale anche se la risposta è un errore: conta il tempo di andata e ritorno
  }
  return performance.now() - t0;
}

async function serie(volte: number, fn: () => Promise<unknown>): Promise<number[]> {
  const tempi: number[] = [];
  for (let i = 0; i < volte; i++) tempi.push(await cronometra(fn));
  return tempi;
}

export async function GET(request: Request) {
  if (!benchmarkAcceso() || !tokenValido(request.headers.get("x-benchmark-token"))) {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const misura = url.searchParams.get("misura") ?? "rete";
  const regione = process.env.VERCEL_REGION ?? "locale";

  if (misura === "ping") {
    return new Response(JSON.stringify({ regione, ora: Date.now() }), { headers: INTESTAZIONI });
  }

  if (misura === "stream") {
    const codifica = new TextEncoder();
    const flusso = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < 10; i++) {
          controller.enqueue(codifica.encode(JSON.stringify({ pezzo: i, regione, ora: Date.now() }) + "\n"));
          await new Promise((r) => setTimeout(r, 200));
        }
        controller.close();
      },
    });
    return new Response(flusso, { headers: { "Cache-Control": "no-store", "Content-Type": "application/x-ndjson" } });
  }

  if (misura === "durata") {
    const secondi = Math.min(100, Math.max(1, Number(url.searchParams.get("secondi") ?? "5") || 5));
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, secondi * 1000));
    return new Response(JSON.stringify({ regione, richiesti_s: secondi, trascorsi_ms: Date.now() - t0 }), { headers: INTESTAZIONI });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const chiave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const intestazioniSupabase = { apikey: chiave, Authorization: `Bearer ${chiave}` };
  const authHealth = await serie(10, () => fetch(`${base}/auth/v1/health`, { headers: intestazioniSupabase, cache: "no-store" }).then((r) => r.arrayBuffer()));
  const restSelect = await serie(10, () => fetch(`${base}/rest/v1/gare?select=id&limit=1`, { headers: intestazioniSupabase, cache: "no-store" }).then((r) => r.arrayBuffer()));

  const esterni: Record<string, ReturnType<typeof statistiche>> = {};
  for (const host of ["api.anthropic.com", "api.openai.com", "api.voyageai.com"]) {
    esterni[host] = statistiche(await serie(5, () => fetch(`https://${host}/`, { method: "GET", redirect: "manual", cache: "no-store" }).then((r) => r.arrayBuffer())));
  }

  return new Response(
    JSON.stringify({
      regione,
      supabase_host: hostSupabase(),
      supabase_auth_health_ms: statistiche(authHealth),
      supabase_rest_select_ms: statistiche(restSelect),
      esterni_ms: esterni,
    }),
    { headers: INTESTAZIONI },
  );
}
