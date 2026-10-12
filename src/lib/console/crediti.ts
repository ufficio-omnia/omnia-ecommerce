import { createAdminClient } from "@/lib/supabase/admin";
import { leggiIdentita } from "./costi";
import { calcolaCrediti, type AcquistoCredito, type ConsumoCredito, type ResultatoCrediti, type SaldoCredito } from "./crediti-calcoli";
import type { Periodo } from "./periodo";

// Lettura dei dati per la pagina Crediti. I calcoli stanno in crediti-calcoli.ts.
// Da chiamare solo dopo richiediAdminPagina().

export type CreditiLetti =
  | { stato: "errore"; messaggio: string }
  | { stato: "ok"; risultato: ResultatoCrediti; includiProva: boolean };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function leggiCrediti(periodo: Periodo, opzioni: { includiProva?: boolean } = {}): Promise<CreditiLetti> {
  const includiProva = opzioni.includiProva ?? false;
  const admin = createAdminClient();

  // Tutto lo storico, non solo il periodo: gli estinti si ricavano per differenza dal totale.
  const [acquistiQ, consumiQ, saldiQ] = await Promise.all([
    admin.from("omnia_ai_credit_purchases").select("user_id, crediti, importo_centesimi, stripe_session_id, created_at").limit(5000),
    admin.from("gara_consumi").select("user_id, created_at").eq("tipo", "credito").limit(5000),
    admin.from("credits").select("user_id, balance").limit(5000),
  ]);

  for (const [nome, q] of [["acquisti", acquistiQ], ["consumi", consumiQ], ["saldi", saldiQ]] as const) {
    if (q.error) {
      console.error(`Console: lettura ${nome} dei crediti fallita`, q.error.message);
      return { stato: "errore", messaggio: `Lettura dei crediti non riuscita (${nome}).` };
    }
  }

  const acquisti: AcquistoCredito[] = ((acquistiQ.data ?? []) as { user_id: string; crediti: number; importo_centesimi: number; stripe_session_id: string | null; created_at: string }[]).map((a) => ({
    user_id: a.user_id,
    crediti: num(a.crediti),
    importo_centesimi: num(a.importo_centesimi),
    created_at: a.created_at,
    prova: (a.stripe_session_id ?? "").startsWith("cs_test_"),
  }));
  const consumi = (consumiQ.data ?? []) as ConsumoCredito[];
  const saldi: SaldoCredito[] = ((saldiQ.data ?? []) as { user_id: string; balance: number }[]).map((s) => ({ user_id: s.user_id, balance: num(s.balance) }));

  const identita = await leggiIdentita([...acquisti.map((a) => a.user_id), ...consumi.map((c) => c.user_id), ...saldi.map((s) => s.user_id)]);

  return { stato: "ok", risultato: calcolaCrediti({ acquisti, consumi, saldi, identita }, periodo, includiProva), includiProva };
}
