import type { SupabaseClient } from "@supabase/supabase-js";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { giornoRoma } from "@/lib/omnia-ai-catalogo-calcoli";
import { modalitaChiaveStripe } from "@/lib/omnia-ai-vendita";
import { acquistoCopertinaDisponibile, provaAcquistoCopertinaLocaleAttiva } from "@/lib/copertina-acquisto-calcoli";
import type { Stile } from "@/lib/copertina-relazione-calcoli";
import {
  COLONNE_IMPOSTAZIONI_COPERTINA,
  impostazioniDaRiga,
  usoDaRighe,
  valutaDirittoCopertina,
  type EsitoDirittoCopertina,
  type ImpostazioniCopertina,
  type RigaGenerazione,
  type UsoCopertine,
} from "@/lib/copertina-diritto-calcoli";

// Le letture e le scritture nel database della copertina della relazione tecnica: le impostazioni del cliente (scritte dalla console) e il registro delle
// generazioni (tabelle della migrazione 0106). Le regole stanno in copertina-diritto-calcoli.ts. Tutto con la chiave di servizio, lato server.

// NODE_ENV non è production e non si è su Vercel: le prove in locale
export function sviluppoLocale(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "production" && !env.VERCEL;
}

export type ContestoLettoCopertina = {
  impostazioni: ImpostazioniCopertina | null;
  // la migrazione 0106 non è stata eseguita
  schemaAssente: boolean;
  // la lettura è fallita per un altro motivo: nel dubbio non si decide (e non si genera)
  errore: boolean;
  uso: UsoCopertine;
  // questa gara ha un acquisto PAGATO (migrazione 0107); falso anche se la tabella non c'è
  acquistata: boolean;
  // la tabella degli acquisti c'è (migrazione 0107): senza, non si può comprare
  acquistiDisponibili: boolean;
  // il giorno di oggi a Roma
  oggi: string;
};

// Le impostazioni del cliente, ciò che ha già generato e se questa gara è stata pagata: una lettura sola per la pagina della gara e per l'azione che genera.
export async function leggiContestoCopertina(params: { admin: SupabaseClient; accountId: string; garaId: string; adesso?: Date }): Promise<ContestoLettoCopertina> {
  const { admin, accountId, garaId } = params;
  const adesso = params.adesso ?? new Date();
  const vuoto: UsoCopertine = { gareGratisUsate: [], perStile: { stilizzato: 0, realistico: 0 } };
  const base = { oggi: giornoRoma(adesso), uso: vuoto, acquistata: false, acquistiDisponibili: false };

  const { data: riga, error } = await admin.from("omnia_ai_copertina_impostazioni").select(COLONNE_IMPOSTAZIONI_COPERTINA).eq("user_id", accountId).maybeSingle();
  if (error) {
    if (schemaAssente(error)) return { ...base, impostazioni: null, schemaAssente: true, errore: false };
    console.error("Copertina: lettura delle impostazioni del cliente non riuscita", error.message);
    return { ...base, impostazioni: null, schemaAssente: false, errore: true };
  }

  const { data: righe, error: erroreRighe } = await admin
    .from("gara_copertine")
    .select("gara_id, stile, stato, fonte, creata_il")
    .eq("user_id", accountId)
    .limit(5000)
    .returns<RigaGenerazione[]>();
  if (erroreRighe) {
    if (schemaAssente(erroreRighe)) return { ...base, impostazioni: null, schemaAssente: true, errore: false };
    console.error("Copertina: lettura delle generazioni del cliente non riuscita", erroreRighe.message);
    return { ...base, impostazioni: impostazioniDaRiga(riga), schemaAssente: false, errore: true };
  }

  // L'acquisto della gara (migrazione 0107): senza la tabella non ci sono acquisti e non si può comprare, e tutto il resto funziona.
  const { data: acquisti, error: erroreAcquisti } = await admin
    .from("omnia_ai_copertine_acquisti")
    .select("id")
    .eq("user_id", accountId)
    .eq("gara_id", garaId)
    .eq("stato", "pagata")
    .limit(1);
  let acquistata = false;
  let acquistiDisponibili = true;
  if (erroreAcquisti) {
    if (schemaAssente(erroreAcquisti)) acquistiDisponibili = false;
    else {
      console.error("Copertina: lettura dell'acquisto della gara non riuscita", erroreAcquisti.message);
      return { ...base, impostazioni: impostazioniDaRiga(riga), schemaAssente: false, errore: true, uso: usoDaRighe(righe ?? [], garaId, adesso) };
    }
  } else {
    acquistata = (acquisti ?? []).length > 0;
  }

  return { oggi: base.oggi, impostazioni: impostazioniDaRiga(riga), schemaAssente: false, errore: false, uso: usoDaRighe(righe ?? [], garaId, adesso), acquistata, acquistiDisponibili };
}

// La decisione per uno stile, sul contesto già letto. Il pagamento è possibile se la tabella degli acquisti c'è e la chiave Stripe di questo ambiente lo
// permette (reale, o di prova in una prova in locale).
export function decidi(ctx: ContestoLettoCopertina, garaId: string, stile: Stile, env: Record<string, string | undefined> = process.env): EsitoDirittoCopertina {
  return valutaDirittoCopertina({
    impostazioni: ctx.impostazioni,
    schemaAssente: ctx.schemaAssente,
    sviluppoLocale: sviluppoLocale(env),
    oggi: ctx.oggi,
    garaId,
    uso: ctx.uso,
    stile,
    acquistata: ctx.acquistata,
    pagamentoDisponibile: ctx.acquistiDisponibili && pagamentoCopertinaDisponibile(env),
  });
}

// Il pagamento online della copertina è possibile in questo ambiente? (chiave Stripe di OMNIA AI reale, o di prova con la prova in locale accesa)
export function pagamentoCopertinaDisponibile(env: Record<string, string | undefined> = process.env): boolean {
  return acquistoCopertinaDisponibile({ modalita: modalitaChiaveStripe(env.STRIPE_SECRET_KEY_OMNIA_AI), provaLocale: provaAcquistoCopertinaLocaleAttiva(env) });
}

// ───── il registro delle generazioni ─────

export type Riserva = { stato: "ok"; id: string } | { stato: "schema_assente" } | { stato: "errore" };

// Registra che sta partendo una generazione (così il limite per stile e le gare gratis tengono conto anche di quella in corso)
export async function riservaCopertina(admin: SupabaseClient, params: { garaId: string; userId: string; stile: Stile; fonte: "gratis" | "sviluppo" | "pagamento" }): Promise<Riserva> {
  const { data, error } = await admin
    .from("gara_copertine")
    .insert({ gara_id: params.garaId, user_id: params.userId, stile: params.stile, fonte: params.fonte, stato: "in_corso" })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    if (error && schemaAssente(error)) return { stato: "schema_assente" };
    console.error("Copertina: registrazione della generazione non riuscita", error?.message);
    return { stato: "errore" };
  }
  return { stato: "ok", id: data.id };
}

// Generazione riuscita: la riga diventa «pronta» e ricorda la marca dei file. Se non si riesce ad aggiornarla resta «in_corso» (e dopo 20 minuti non conta
// più): si registra l'errore ma non si toglie al cliente una copertina già pagata e salvata.
export async function completaCopertina(admin: SupabaseClient, id: string, marca: string): Promise<void> {
  const { error } = await admin.from("gara_copertine").update({ stato: "pronta", marca, completata_il: new Date().toISOString() }).eq("id", id);
  if (error) console.error("Copertina: chiusura della generazione non riuscita (la riga resta in corso)", error.message);
}

// Generazione non riuscita: la riga si cancella, non conta né per il limite né per le gare gratis
export async function annullaCopertina(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin.from("gara_copertine").delete().eq("id", id);
  if (error) console.error("Copertina: cancellazione della generazione non riuscita (smetterà di contare da sola)", error.message);
}
