import { createAdminClient } from "@/lib/supabase/admin";
import { righeDelCliente, type RigaAccesso } from "./accessi-dati-calcoli";
import { leggiAccessiCliente, type RisultatoAccessi } from "./accessi-dati";
import { aggiungiGiorni, mezzanotteRoma } from "./periodo";

// Comune alla pagina dell'estratto e alla sua versione CSV: stesso cliente, stesso
// periodo, stesse righe. Nessuna delle due deve poter mostrare una cosa diversa dall'altra.

export const UUID_CLIENTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

// Un giorno di calendario valido «AAAA-MM-GG», altrimenti null (valore ignorato).
export function giornoValido(valore: string | undefined): string | null {
  if (!valore || !GIORNO.test(valore) || Number.isNaN(Date.parse(`${valore}T00:00:00Z`))) return null;
  return valore;
}

export type Estratto =
  | { stato: "ok"; cliente: { id: string; email: string | null }; righe: RigaAccesso[] }
  | Exclude<RisultatoAccessi, { stato: "ok" }>
  | { stato: "id_non_valido" };

// Le righe del cliente nel periodo [dal, al] (giorni di Roma, estremi compresi; vuoti =
// senza limite). L'email del cliente è quella attuale dell'utente; se l'utente non c'è
// più si usa quella copiata nelle righe del registro.
export async function leggiEstratto(idCliente: string, dal: string | null, al: string | null): Promise<Estratto> {
  if (!UUID_CLIENTE.test(idCliente)) return { stato: "id_non_valido" };

  const { data: utente } = await createAdminClient().from("users").select("email").eq("id", idCliente).maybeSingle<{ email: string }>();
  const letto = await leggiAccessiCliente({ id: idCliente, email: utente?.email ?? null });
  if (letto.stato !== "ok") return letto;

  const email = utente?.email ?? letto.righe.find((r) => r.clienteId === idCliente && r.clienteEmail)?.clienteEmail ?? null;
  const dalIso = dal ? mezzanotteRoma(dal).getTime() : null;
  const alIso = al ? mezzanotteRoma(aggiungiGiorni(al, 1)).getTime() : null;
  const nelPeriodo = righeDelCliente(letto.righe, { id: idCliente, email }).filter((r) => {
    const t = Date.parse(r.accessoIl);
    return (dalIso === null || t >= dalIso) && (alIso === null || t < alIso);
  });
  return { stato: "ok", cliente: { id: idCliente, email }, righe: nelPeriodo };
}
