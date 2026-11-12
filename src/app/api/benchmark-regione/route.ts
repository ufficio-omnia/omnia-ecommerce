// SOLO PER IL BENCHMARK DI REGIONE (branch perf/benchmark-regione*): mai da unire in master.
// Misura, dall'interno della funzione Vercel, le distanze che cambiano con la regione:
//   ?misura=ping     → risposta immediata: il tempo visto dal client è solo rete client↔funzione + piattaforma
//   ?misura=rete     → (predefinita) andata e ritorno funzione→Supabase (Auth e REST, 10 volte ciascuno, in sequenza)
//                      e funzione→servizi esterni del motore (Anthropic, OpenAI, Voyage: 5 volte, SENZA chiavi né dati:
//                      si misura solo la connessione, la risposta è un errore di autorizzazione o una pagina vuota)
//   ?misura=esterni  → chiamate POST agli indirizzi VERI di Voyage (/v1/embeddings) e Anthropic (/v1/messages) con chiave
//                      FINTA (risposta 401, nessun calcolo, nessun costo), con i tempi di DNS, TCP, TLS e risposta, su
//                      connessione nuova e riusata
//   ?misura=stream   → 10 pezzi, uno ogni 200 ms: il client verifica che lo streaming arrivi a pezzi e non in blocco
//   ?misura=durata&secondi=N (max 100) → attesa di N secondi: verifica che una funzione lunga non venga interrotta
// Nessuna scrittura, nessun dato di clienti, nessuna chiamata ai modelli. Spento in produzione (vedi benchmark-regione.ts).
import https from "node:https";
import { benchmarkAcceso, hostSupabase, statistiche, tokenValido } from "@/lib/benchmark-regione";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const INTESTAZIONI = { "Cache-Control": "no-store", "Content-Type": "application/json" };

type Fasi = { dns: number; tcp: number; tls: number; risposta: number; totale: number; stato: number };

// Una richiesta HTTPS con i tempi di ogni fase (dall'inizio): fine DNS, connessione TCP, cifratura TLS, intestazioni della
// risposta. Con agent=false la connessione è sempre nuova. Solo per il banco di prova: nessun dato utile viene inviato.
function chiamataCronometrata(
  s: { host: string; path: string; corpo: string; intestazioni: Record<string, string> },
  agente: https.Agent | false,
): Promise<Fasi> {
  return new Promise((risolvi) => {
    const t0 = performance.now();
    const f: Fasi = { dns: NaN, tcp: NaN, tls: NaN, risposta: NaN, totale: NaN, stato: 0 };
    const req = https.request(
      { host: s.host, path: s.path, method: "POST", agent: agente, headers: { ...s.intestazioni, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s.corpo) } },
      (res) => {
        f.risposta = performance.now() - t0;
        f.stato = res.statusCode ?? 0;
        res.resume();
        res.on("end", () => { f.totale = performance.now() - t0; risolvi(f); });
      },
    );
    req.on("socket", (sock) => {
      sock.on("lookup", () => { f.dns = performance.now() - t0; });
      sock.on("connect", () => { f.tcp = performance.now() - t0; });
      sock.on("secureConnect", () => { f.tls = performance.now() - t0; });
    });
    req.on("error", () => { f.totale = performance.now() - t0; risolvi(f); });
    req.setTimeout(15_000, () => req.destroy());
    req.end(s.corpo);
  });
}

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

  if (misura === "esterni") {
    // Chiamate come quelle VERE del motore (stesso indirizzo e metodo), ma con chiave FINTA: il servizio risponde 401 senza
    // calcolare nulla e senza costi. Per ogni chiamata si misurano le fasi: risoluzione DNS, connessione TCP, cifratura TLS,
    // prima risposta. «nuova» = connessione nuova ogni volta (come un messaggio di chat dopo una pausa); «riusata» = stessa
    // connessione tenuta aperta (la prima della serie è nuova, le altre la riusano).
    const servizi: { nome: string; host: string; path: string; corpo: string; intestazioni: Record<string, string> }[] = [
      { nome: "voyage_embeddings", host: "api.voyageai.com", path: "/v1/embeddings", corpo: JSON.stringify({ input: ["prova"], model: "voyage-4", input_type: "query" }), intestazioni: { Authorization: "Bearer pa-benchmark-finto" } },
      { nome: "anthropic_messages", host: "api.anthropic.com", path: "/v1/messages", corpo: JSON.stringify({ model: "claude-x", max_tokens: 1, messages: [{ role: "user", content: "x" }] }), intestazioni: { "x-api-key": "sk-ant-benchmark-finto", "anthropic-version": "2023-06-01" } },
    ];
    const risultati: Record<string, unknown> = {};
    for (const s of servizi) {
      const nuove: Fasi[] = [];
      for (let i = 0; i < 6; i++) nuove.push(await chiamataCronometrata(s, false));
      const agente = new https.Agent({ keepAlive: true, maxSockets: 1 });
      const riusate: Fasi[] = [];
      for (let i = 0; i < 6; i++) riusate.push(await chiamataCronometrata(s, agente));
      agente.destroy();
      const campo = (serie: Fasi[], k: keyof Fasi) => statistiche(serie.map((f) => Number(f[k])).filter((x) => Number.isFinite(x)));
      risultati[s.nome] = {
        stato_http: [...new Set(nuove.concat(riusate).map((f) => f.stato))],
        nuova_connessione: { dns_ms: campo(nuove, "dns"), tcp_ms: campo(nuove, "tcp"), tls_ms: campo(nuove, "tls"), prima_risposta_ms: campo(nuove, "risposta"), totale_ms: campo(nuove, "totale") },
        connessione_riusata: { totale_ms: campo(riusate.slice(1), "totale"), prima_della_serie_ms: Math.round(riusate[0].totale) },
      };
    }
    return new Response(JSON.stringify({ regione, ...risultati }), { headers: INTESTAZIONI });
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
