import type { SupabaseClient } from "@supabase/supabase-js";
import {
  costruisciConsensi,
  costruisciRevoca,
  dataStandard,
  stringaDaFirmare,
  type ConsensoDaSalvare,
  type ConsensoRegistrato,
  type TipoConsenso,
} from "@/lib/demo-consensi-calcoli";
import { firmaConsenso, firmaConsensoValida, sha256Hex } from "@/lib/demo-hash";

// Registro verificabile dei consensi delle richieste di demo (tabella demo_consensi, migrazione 0098). Solo SERVER.
// Il registro si AGGIUNGE soltanto; ogni riga ha una firma HMAC del server (se il segreto è configurato): chi modifica una riga a mano
// nel database fa smettere di tornare la firma, e quel consenso non vale più per nessun invio a Google.

export type EsitoConsensi = { ok: true } | { ok: false };

function riga(leadId: string, c: ConsensoDaSalvare, adessoIso: string, segreto: string | null): Record<string, unknown> {
  const base = {
    lead_id: leadId,
    registrato_il: adessoIso,
    tipo: c.tipo,
    valore: c.valore,
    versione_testo: c.versione_testo,
    testo_sha256: c.testo_sha256,
    informativa_versione: c.informativa_versione,
    fonte: c.fonte,
    dichiarato_dal_browser: c.dichiarato_dal_browser,
    ip_hash: c.ip_hash,
  };
  return { ...base, firma: segreto ? firmaConsenso(stringaDaFirmare({ ...base, registrato_il: adessoIso }), segreto) : null };
}

// Registra i tre consensi di UN invio del modulo. Se anche una sola riga non si salva restituisce {ok:false}: il chiamante annulla la
// richiesta (non esiste una richiesta senza la prova dei suoi consensi).
export async function registraConsensiRichiesta(
  admin: SupabaseClient,
  leadId: string,
  input: { adsConsenso: boolean; cookieAccettati: boolean; ipHash: string | null },
  adesso: Date,
  segreto: string | null,
): Promise<EsitoConsensi> {
  const consensi = costruisciConsensi(input, sha256Hex);
  const adessoIso = adesso.toISOString();
  const { error } = await admin.from("demo_consensi").insert(consensi.map((c) => riga(leadId, c, adessoIso, segreto)));
  return error ? { ok: false } : { ok: true };
}

// Revoca di un consenso (riga nuova «denied»; il registro non si modifica).
export async function registraRevoca(admin: SupabaseClient, leadId: string, tipo: TipoConsenso, ipHash: string | null, adesso: Date, segreto: string | null): Promise<EsitoConsensi> {
  const { error } = await admin.from("demo_consensi").insert(riga(leadId, costruisciRevoca(tipo, ipHash, sha256Hex), adesso.toISOString(), segreto));
  return error ? { ok: false } : { ok: true };
}

export async function leggiConsensi(admin: SupabaseClient, leadIds: string[]): Promise<{ ok: true; perRichiesta: Map<string, ConsensoRegistrato[]> } | { ok: false }> {
  const perRichiesta = new Map<string, ConsensoRegistrato[]>();
  if (leadIds.length === 0) return { ok: true, perRichiesta };
  const { data, error } = await admin
    .from("demo_consensi")
    .select("lead_id, registrato_il, tipo, valore, versione_testo, testo_sha256, informativa_versione, fonte, dichiarato_dal_browser, ip_hash, firma")
    .in("lead_id", leadIds);
  if (error) return { ok: false };
  for (const r of (data ?? []) as ConsensoRegistrato[]) {
    const elenco = perRichiesta.get(r.lead_id) ?? [];
    elenco.push({ ...r, registrato_il: dataStandard(r.registrato_il) });
    perRichiesta.set(r.lead_id, elenco);
  }
  return { ok: true, perRichiesta };
}

// Verifica della firma di una riga (richiede il segreto). Una riga senza firma NON è verificabile.
export function verificatoreFirma(segreto: string): (r: ConsensoRegistrato) => boolean {
  return (r) => firmaConsensoValida(stringaDaFirmare(r), r.firma, segreto);
}
