import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { chiaveAvviso, eAvvisoGiaInviato, type MotivoQuotaFinita, type TipoAvvisoTitolare } from "@/lib/omnia-ai-account-calcoli";
import { emailAvvisoGareFinite, emailAvvisoRevisioneRichiesta } from "@/lib/omnia-ai-email-ufficio-gare-calcoli";
import type { EmailPronta } from "@/lib/omnia-ai-email-eventi-calcoli";

// Le email che l'Ufficio Gare fa partire verso il titolare. Il limite «al massimo una al giorno» NON sta nel
// codice ma nel database: si scrive una riga in omnia_ai_membri_avvisi con chiave unica (titolare, tipo, chiave,
// giorno di Roma); se la riga esiste già l'email di oggi è già partita e non se ne manda un'altra, anche con
// cento richieste contemporanee. Se l'invio fallisce la riga si toglie, così il prossimo tentativo può riprovare.

export type EsitoAvviso = "inviato" | "gia_inviato_oggi" | "non_riuscito";

const DA = "OMNIA AI <noreply@omniaitalia.com>";

async function avvisaTitolare({
  admin,
  titolareId,
  membroId,
  tipo,
  chiave,
  costruisci,
}: {
  admin: SupabaseClient;
  titolareId: string;
  membroId: string;
  tipo: TipoAvvisoTitolare;
  chiave: string;
  costruisci: () => EmailPronta;
}): Promise<EsitoAvviso> {
  const { data: riga, error } = await admin
    .from("omnia_ai_membri_avvisi")
    .insert({ titolare_id: titolareId, membro_id: membroId, tipo, chiave })
    .select("id")
    .single<{ id: string }>();

  if (error || !riga) {
    if (eAvvisoGiaInviato(error)) return "gia_inviato_oggi";
    console.error("Avviso al titolare: registrazione non riuscita", tipo, error?.code, error?.message);
    return "non_riuscito";
  }

  const rilascia = async () => {
    const { error: erroreRilascio } = await admin.from("omnia_ai_membri_avvisi").delete().eq("id", riga.id);
    if (erroreRilascio) console.error("Avviso al titolare: riga non rilasciata dopo un invio fallito", erroreRilascio.message);
  };

  const { data: titolare } = await admin.from("users").select("email").eq("id", titolareId).maybeSingle<{ email: string }>();
  if (!titolare?.email) {
    console.error("Avviso al titolare: email del titolare mancante", titolareId);
    await rilascia();
    return "non_riuscito";
  }

  const email = costruisci();
  let inviata = false;
  try {
    inviata = await sendEmail({ to: titolare.email, from: DA, subject: email.oggetto, html: email.html });
  } catch (e) {
    console.error("Avviso al titolare: invio non riuscito", e instanceof Error ? e.message : e);
  }
  if (!inviata) {
    await rilascia();
    return "non_riuscito";
  }
  return "inviato";
}

// Gare finite (o crediti esauriti) o abbonamento non attivo: una email al giorno in tutto.
export function avvisaTitolareQuotaFinita({
  admin,
  titolareId,
  membroId,
  emailUfficioGare,
  motivo,
}: {
  admin: SupabaseClient;
  titolareId: string;
  membroId: string;
  emailUfficioGare: string;
  motivo: MotivoQuotaFinita;
}): Promise<EsitoAvviso> {
  return avvisaTitolare({
    admin,
    titolareId,
    membroId,
    tipo: "quota_esaurita",
    chiave: chiaveAvviso("quota_esaurita"),
    costruisci: () => emailAvvisoGareFinite({ emailUfficioGare, motivo }),
  });
}

// L'Ufficio Gare ha chiesto la revisione umana: una email al giorno per ogni gara.
export function avvisaTitolareRevisione({
  admin,
  titolareId,
  membroId,
  emailUfficioGare,
  garaId,
  titoloGara,
}: {
  admin: SupabaseClient;
  titolareId: string;
  membroId: string;
  emailUfficioGare: string;
  garaId: string;
  titoloGara: string;
}): Promise<EsitoAvviso> {
  return avvisaTitolare({
    admin,
    titolareId,
    membroId,
    tipo: "revisione_richiesta",
    chiave: chiaveAvviso("revisione_richiesta", garaId),
    costruisci: () => emailAvvisoRevisioneRichiesta({ emailUfficioGare, titoloGara, garaId }),
  });
}
