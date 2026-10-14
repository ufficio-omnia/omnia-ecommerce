import { createAdminClient } from "@/lib/supabase/admin";
import { schemaAssente } from "@/lib/omnia-ai-incassi";
import { calcolaGareGratuite, type GareGratuite } from "@/lib/omnia-ai-gare-gratuite";

// Letture per il riquadro «Prova gratuita» della scheda cliente (migrazione 0084). Prima della
// migrazione le tabelle non ci sono: `disponibile: false`, e il riquadro lo dice.

export type MovimentoGareGratuite = { delta: number; motivo: string | null; operatore: string; creatoIl: string };

export type ProvaCliente = {
  disponibile: boolean;
  // creato a mano dalla console (e da chi)
  creatoDaConsole: { creatoIl: string; creatoDa: string; resetRichiestoIl: string | null; passwordConsegnataIl: string | null } | null;
  gare: GareGratuite | null;
  movimenti: MovimentoGareGratuite[];
  // ha avuto almeno un abbonamento: le gare gratuite riguardano solo chi non ne ha mai avuto
  haAvutoAbbonamento: boolean;
};

export async function leggiProvaCliente(userId: string): Promise<ProvaCliente> {
  const admin = createAdminClient();

  const { count: abbonamenti } = await admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  const haAvutoAbbonamento = (abbonamenti ?? 0) > 0;

  const [console_, gratuite, log] = await Promise.all([
    admin
      .from("omnia_ai_utenti_console")
      .select("creato_il, creato_da_email, reset_richiesto_il, password_consegnata_il")
      .eq("user_id", userId)
      .maybeSingle<{ creato_il: string; creato_da_email: string; reset_richiesto_il: string | null; password_consegnata_il: string | null }>(),
    admin.from("omnia_ai_gare_gratuite").select("assegnate, usate").eq("user_id", userId).maybeSingle<{ assegnate: number; usate: number }>(),
    admin
      .from("omnia_ai_gare_gratuite_log")
      .select("delta, motivo, operatore_email, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<{ delta: number; motivo: string | null; operatore_email: string; created_at: string }[]>(),
  ]);

  if (schemaAssente(console_.error) || schemaAssente(gratuite.error) || schemaAssente(log.error)) {
    return { disponibile: false, creatoDaConsole: null, gare: null, movimenti: [], haAvutoAbbonamento };
  }
  for (const [nome, q] of [["utenti_console", console_], ["gare_gratuite", gratuite], ["gare_gratuite_log", log]] as const) {
    if (q.error) console.error(`Console: lettura ${nome} fallita`, q.error.message);
  }

  return {
    disponibile: true,
    creatoDaConsole: console_.data
      ? { creatoIl: console_.data.creato_il, creatoDa: console_.data.creato_da_email, resetRichiestoIl: console_.data.reset_richiesto_il, passwordConsegnataIl: console_.data.password_consegnata_il }
      : null,
    gare: calcolaGareGratuite(gratuite.data),
    movimenti: (log.data ?? []).map((m) => ({ delta: m.delta, motivo: m.motivo, operatore: m.operatore_email, creatoIl: m.created_at })),
    haAvutoAbbonamento,
  };
}
