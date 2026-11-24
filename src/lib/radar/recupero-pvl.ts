// Ripresa del recupero della PVL fermato (K4): dopo 3 tentativi incompleti dello stesso blocco il recupero si ferma e resta fermo finché un
// amministratore non lo riprende dalla console (pagina «Fonti» di B1, con la conferma nel server e il registro della console, 0112).
// Solo server, chiave di servizio. NESSUNA richiesta alla PVL: si cambia solo il cursore, con una scrittura condizionata.
import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { scrittureRadarConsentite } from "./ambiente";
import { cursorePvlV2Valido, riprendiRecupero } from "./importa-pvl-cursore";

export type EsitoRipresaRecuperoPvl =
  | { ok: true; blocco: { da: string; a: string } }
  // non_fermo: il recupero non è fermo (o il cursore non è un v2 valido): niente da fare
  // giro_in_corso: un giro tiene il blocco (anche il semaforo del coordinamento): si riprova dopo
  // cambiato_nel_frattempo: lo stato della fonte è cambiato tra la lettura e la scrittura (un giro, un'altra ripresa): nulla scritto
  | { ok: false; motivo: "ambiente_non_consentito" | "schema_assente" | "errore_lettura" | "fonte_assente" | "non_fermo" | "giro_in_corso" | "cambiato_nel_frattempo" | "errore_scrittura"; dettaglio?: string };

type RigaPvl = { cursore: unknown; blocco_fino_a: string | null; aggiornata_il: string | null; conteggi: Record<string, unknown> | null };

/**
 * Riprende il recupero fermo della PVL. `autore`: chi lo chiede (l'identificativo dell'amministratore, al più 100 caratteri, finisce in
 * conteggi.ultima_ripresa_recupero). La scrittura passa SOLO se lo stato della fonte non è cambiato dopo la lettura (stessa aggiornata_il:
 * ogni salvataggio del cursore e ogni presa del blocco la cambiano) e se nessun giro tiene il blocco.
 */
export async function riprendiRecuperoPvl(db: SupabaseClient, autore: string, opzioni: { adesso?: Date; env?: Record<string, string | undefined> } = {}): Promise<EsitoRipresaRecuperoPvl> {
  const permesso = scrittureRadarConsentite("pvl", opzioni.env ?? process.env);
  if (!permesso.ok) return { ok: false, motivo: "ambiente_non_consentito", dettaglio: permesso.motivo };
  const chi = autore.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!chi) return { ok: false, motivo: "errore_scrittura", dettaglio: "autore mancante" };
  const adesso = opzioni.adesso ?? new Date();

  const { data: riga, error } = await db.from("radar_fonti_stato").select("cursore, blocco_fino_a, aggiornata_il, conteggi").eq("fonte", "pvl").maybeSingle<RigaPvl>();
  if (error) return { ok: false, motivo: schemaAssente(error) ? "schema_assente" : "errore_lettura", dettaglio: error.message };
  if (!riga) return { ok: false, motivo: "fonte_assente" };
  const cursore = cursorePvlV2Valido(riga.cursore);
  if (!cursore || !cursore.recupero.fermo) return { ok: false, motivo: "non_fermo" };
  if (riga.blocco_fino_a && Date.parse(riga.blocco_fino_a) >= adesso.getTime()) return { ok: false, motivo: "giro_in_corso" };

  const fermo = cursore.recupero.fermo;
  const conteggi = { ...(riga.conteggi ?? {}), ultima_ripresa_recupero: { il: adesso.toISOString(), autore: chi, blocco: { da: fermo.da, a: fermo.a } } };
  let q = db
    .from("radar_fonti_stato")
    .update({ cursore: riprendiRecupero(cursore), conteggi, aggiornata_il: adesso.toISOString() })
    .eq("fonte", "pvl")
    .or(`blocco_fino_a.is.null,blocco_fino_a.lt.${adesso.toISOString()}`);
  q = riga.aggiornata_il === null ? q.is("aggiornata_il", null) : q.eq("aggiornata_il", riga.aggiornata_il);
  const scritta = await q.select("fonte");
  if (scritta.error) return { ok: false, motivo: "errore_scrittura", dettaglio: scritta.error.message };
  if ((scritta.data ?? []).length === 0) return { ok: false, motivo: "cambiato_nel_frattempo" };
  return { ok: true, blocco: { da: fermo.da, a: fermo.a } };
}
