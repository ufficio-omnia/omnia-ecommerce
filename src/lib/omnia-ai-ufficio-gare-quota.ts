import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ContestoAccount } from "@/lib/omnia-ai-account";
import type { MotivoQuotaFinita } from "@/lib/omnia-ai-account-calcoli";
import { avvisaTitolareQuotaFinita } from "@/lib/omnia-ai-ufficio-gare-avvisi";

// Fa partire, DOPO la risposta (la pagina o l'azione non aspetta la posta), l'email al titolare quando
// l'Ufficio Gare si trova davanti a «gare finite» o «abbonamento non attivo». Non fa nulla per il titolare
// (che ha già i suoi avvisi) né per un Ufficio Gare sospeso. Mai un errore verso chi chiama: un problema di
// posta non deve rompere la pagina. Il limite di una al giorno è del database (omnia-ai-ufficio-gare-avvisi.ts).
export function avvisaTitolareDopoLaRisposta({
  contesto,
  emailUfficioGare,
  motivo,
}: {
  contesto: ContestoAccount;
  emailUfficioGare: string | null | undefined;
  motivo: MotivoQuotaFinita;
}): void {
  if (contesto.ruolo !== "ufficio_gare" || contesto.sospeso || !emailUfficioGare) return;
  after(async () => {
    try {
      await avvisaTitolareQuotaFinita({
        admin: createAdminClient(),
        titolareId: contesto.accountId,
        membroId: contesto.userId,
        emailUfficioGare,
        motivo,
      });
    } catch (e) {
      console.error("Avviso al titolare (gare finite): errore", e instanceof Error ? e.message : e);
    }
  });
}
