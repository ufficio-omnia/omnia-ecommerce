// Accesso alla coda radar_lavori (migrazione 0111). Solo server, con la chiave di servizio: la tabella non ha regole per i ruoli utente.
// Le regole (blocco, tentativi, attese) stanno in lavori-calcoli.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { bloccoFinoA, dopoErrore, erroreDaConservare, prendibile, type LavoroRiga } from "./lavori-calcoli";

export type LavoroDaAccodare = {
  tipo: string;
  chiaveIdempotenza: string;
  accountId: string | null;
  dati: Record<string, unknown>;
  maxTentativi?: number;
};

export type Lavoro = LavoroRiga & { tipo: string; account_id: string | null; dati: Record<string, unknown> };

const COLONNE = "id, tipo, account_id, dati, stato, tentativi, max_tentativi, prossimo_tentativo_il, bloccato_fino_a";

// Accoda senza doppioni: con la stessa chiave di idempotenza la seconda richiesta non crea nulla (true se il lavoro è nuovo).
export async function accodaLavoro(admin: SupabaseClient, l: LavoroDaAccodare): Promise<{ nuovo: boolean; errore: string | null }> {
  const { data, error } = await admin
    .from("radar_lavori")
    .upsert(
      { tipo: l.tipo, chiave_idempotenza: l.chiaveIdempotenza, account_id: l.accountId, dati: l.dati, max_tentativi: l.maxTentativi ?? 3 },
      { onConflict: "chiave_idempotenza", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return { nuovo: false, errore: error.message };
  return { nuovo: (data ?? []).length > 0, errore: null };
}

// Prende UN lavoro dei tipi indicati, se ce n'è uno pronto. L'aggiornamento è condizionato allo stato letto: se un altro esecutore l'ha
// preso nel frattempo, l'aggiornamento non tocca righe e si prova il candidato successivo.
export async function prendiLavoro(admin: SupabaseClient, tipi: readonly string[], adesso: Date = new Date()): Promise<Lavoro | null> {
  const ora = adesso.toISOString();
  const { data: candidati, error } = await admin
    .from("radar_lavori")
    .select(COLONNE)
    .in("tipo", [...tipi])
    .in("stato", ["in_coda", "in_corso"])
    .lte("prossimo_tentativo_il", ora)
    .order("prossimo_tentativo_il", { ascending: true })
    .limit(5)
    .returns<Lavoro[]>();
  if (error || !candidati) return null;

  for (const c of candidati) {
    if (!prendibile(c, adesso)) continue;
    let q = admin
      .from("radar_lavori")
      .update({ stato: "in_corso", tentativi: c.tentativi + 1, bloccato_fino_a: bloccoFinoA(adesso), iniziato_il: ora })
      .eq("id", c.id)
      .eq("stato", c.stato)
      .eq("tentativi", c.tentativi);
    q = c.bloccato_fino_a === null ? q.is("bloccato_fino_a", null) : q.eq("bloccato_fino_a", c.bloccato_fino_a);
    const { data: presi } = await q.select(COLONNE).returns<Lavoro[]>();
    if (presi && presi.length === 1) return presi[0];
  }
  return null;
}

export async function completaLavoro(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin.from("radar_lavori").update({ stato: "completato", completato_il: new Date().toISOString(), bloccato_fino_a: null, errore: null }).eq("id", id);
  if (error) console.error("Coda del Radar: chiusura del lavoro non riuscita", id, error.message);
}

export async function segnaErroreLavoro(admin: SupabaseClient, l: Pick<Lavoro, "id" | "tentativi" | "max_tentativi">, e: unknown, adesso: Date = new Date()): Promise<void> {
  const esito = dopoErrore(l, adesso);
  const { error } = await admin
    .from("radar_lavori")
    .update({ stato: esito.stato, prossimo_tentativo_il: esito.prossimo_tentativo_il, bloccato_fino_a: null, errore: erroreDaConservare(e) })
    .eq("id", l.id);
  if (error) console.error("Coda del Radar: registrazione dell'errore non riuscita", l.id, error.message);
}
