import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { costruisciEvidenza, type EvidenzaDati } from "@/lib/valori-impresa";

// Tutto ciò che, per una gara, vale come RISCONTRO di un valore numerico
// scritto nell'offerta tecnica (R9): profilo azienda, dati di gara estratti
// (sedi, personale uscente, criteri, requisiti), TUTTI i documenti di gara
// indicizzati — non solo gli estratti recuperati dalla ricerca per
// somiglianza per l'ultimo messaggio, che possono non contenere il dettaglio
// rilevante — e ciò che il cliente ha scritto in chat (una conferma del
// cliente è un riscontro). Letto una volta per generazione, vedi
// valori-impresa.ts per come viene usato.

const PAGINA_CHUNK = 1000;
// Tetto di sicurezza: un capitolato molto grande non deve far esplodere la
// lettura; oltre questo numero di chunk si usa quello che c'è.
const MAX_CHUNK = 6000;

export async function caricaEvidenzaDati(params: {
  garaId: string;
  userId: string;
  testiAggiuntivi?: string[];
  // Solo per le prove fuori da una richiesta Next.js (senza cookie): un client
  // già pronto al posto di quello del server.
  supabase?: Pick<Awaited<ReturnType<typeof createClient>>, "from">;
}): Promise<EvidenzaDati> {
  const { garaId, userId } = params;
  const supabase = params.supabase ?? (await createClient());

  const [{ data: gara }, { data: profilo }, { data: messaggi }] = await Promise.all([
    supabase
      .from("gare")
      .select("importo, criteri_valutazione, requisiti, limiti_formattazione, sedi, personale_uscente")
      .eq("id", garaId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("companies")
      .select("numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("gara_messaggi").select("contenuto").eq("gara_id", garaId).eq("ruolo", "utente"),
  ]);

  // La gara risulta del cliente (RLS + filtro user_id qui sopra): solo dopo
  // questa verifica si leggono i chunk con il client di servizio.
  const testiDocumenti: string[] = [];
  if (gara) {
    const admin = createAdminClient();
    for (let da = 0; da < MAX_CHUNK; da += PAGINA_CHUNK) {
      const { data: chunk, error } = await admin
        .from("gara_documenti_chunks")
        .select("contenuto")
        .eq("gara_id", garaId)
        .order("id", { ascending: true })
        .range(da, da + PAGINA_CHUNK - 1);
      if (error) {
        console.error("caricaEvidenzaDati: errore lettura chunk dei documenti di gara:", error);
        break;
      }
      for (const c of chunk ?? []) testiDocumenti.push((c as { contenuto: string }).contenuto);
      if ((chunk?.length ?? 0) < PAGINA_CHUNK) break;
    }
  }

  return costruisciEvidenza({
    profilo: profilo ?? null,
    gara: gara ?? {},
    testiDocumenti,
    messaggiCliente: (messaggi ?? []).map((m) => (m as { contenuto: string }).contenuto),
    testiAggiuntivi: params.testiAggiuntivi,
  });
}
