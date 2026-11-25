import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { invioEmailAcceso } from "@/lib/radar/notifiche/interruttore";
import { preferenzeNotificheAttive } from "@/lib/radar/interruttori-b4";
import { COLONNE_NOTIFICHE_PERSONE, TABELLA_NOTIFICHE_IMPRESA, TABELLA_NOTIFICHE_PERSONE, categorieDa, preferenzeDaRiga } from "@/lib/radar/notifiche-preferenze-calcoli";
import { avvisoNotifiche, type RuoloOpportunita } from "@/lib/opportunita-testi-calcoli";

// Invito ad attivare gli avvisi email, in testa alle pagine di «Opportunità» (richiesta del coordinamento del 25/11). Solo LETTURE, con la
// sessione dell'utente (RLS: il titolare vede la sua impresa, l'Ufficio Gare la propria riga), e solo se il motore è acceso e la pagina
// «Notifiche» esiste: altrimenti nessuna lettura e niente da mostrare. Le regole e le frasi sono in opportunita-testi-calcoli.ts.
export default async function AvvisoNotifiche({
  contesto,
  operativo,
  env = process.env,
}: {
  contesto: { accountId: string; userId: string; ruolo: RuoloOpportunita };
  operativo: boolean;
  env?: Record<string, string | undefined>;
}) {
  const motoreAcceso = invioEmailAcceso(env);
  const paginaNotifiche = preferenzeNotificheAttive(env);
  if (!motoreAcceso || !paginaNotifiche || !operativo) return null;
  const sessione = await createClient();
  const [impresa, persona] = await Promise.all([
    sessione.from(TABELLA_NOTIFICHE_IMPRESA).select("email_attive").eq("impresa_id", contesto.accountId).maybeSingle<{ email_attive: boolean }>(),
    sessione.from(TABELLA_NOTIFICHE_PERSONE).select(COLONNE_NOTIFICHE_PERSONE).eq("impresa_id", contesto.accountId).eq("user_id", contesto.userId).maybeSingle<Record<string, unknown>>(),
  ]);
  const avviso = avvisoNotifiche({
    motoreAcceso,
    paginaNotifiche,
    operativo,
    lettura: !impresa.error && !persona.error,
    ruolo: contesto.ruolo,
    emailImpresaAttive: impresa.data?.email_attive === true,
    preferenze: persona.data ? categorieDa(preferenzeDaRiga(persona.data)) : null,
  });
  if (!avviso) return null;
  const href = `${RADICE_OPPORTUNITA}/notifiche`;
  if (avviso.forma === "nota")
    return (
      <p className="omnia-opp-avviso-nota">
        {avviso.testo}{" "}
        <Link href={href} prefetch={false}>
          {avviso.pulsante}
        </Link>
      </p>
    );
  return (
    <section className="omnia-opp-invito" aria-labelledby="omnia-opp-invito-titolo">
      <div>
        <h2 id="omnia-opp-invito-titolo">{avviso.titolo}</h2>
        <p>{avviso.testo}</p>
      </div>
      <Link className="omnia-btn omnia-btn-p omnia-btn-piccolo" href={href} prefetch={false}>
        {avviso.pulsante}
      </Link>
    </section>
  );
}
