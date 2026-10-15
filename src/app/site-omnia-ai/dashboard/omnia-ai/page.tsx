import { createClient } from "@/lib/supabase/server";
import { getConsumoPeriodoCorrente } from "@/lib/omnia-ai-consumo-periodo";
import { getOmniaAiAccessState } from "@/lib/omnia-ai-access";
import { richiediAccountPagina } from "@/lib/omnia-ai-account-guardie";
import { clientePerAccount } from "@/lib/omnia-ai-account-lavoro";
import { leggiFontiQuota } from "@/lib/gara-diritto";
import { gareRimanenti } from "@/lib/gara-diritto-calcoli";
import { avvisaTitolareDopoLaRisposta } from "@/lib/omnia-ai-ufficio-gare-quota";
import StatusCards from "@/components/omnia-ai/status-cards";
import GareRecentiList from "@/components/omnia-ai/gare-recenti-list";
import CosaVuoiFareOggi from "@/components/omnia-ai/cosa-vuoi-fare-oggi";
import AttivitaRecente, { type AttivitaVoce } from "@/components/omnia-ai/attivita-recente";
import { giorniAllaScadenza, type GaraRigaProps } from "@/components/omnia-ai/gara-riga";

type GaraRow = {
  id: string;
  titolo: string;
  stazione_appaltante: string | null;
  scadenza: string | null;
  estrazione_stato: string;
  estrazione_aggiornata_il: string | null;
  created_at: string;
};

const LIMITE_ATTIVITA = 10;

// Nessuna gestione di "cessato" qui: il layout blocca del tutto
// l'accesso a questa pagina (e a ogni altra sotto dashboard/omnia-ai)
// prima che il rendering arrivi fin qui, mostrando la schermata di
// vendita al suo posto.
export default async function OmniaAiHomePage() {
  const supabase = await createClient();
  // Titolare o Ufficio Gare: i dati sono sempre dell'account effettivo (il titolare).
  const sessione = await richiediAccountPagina();
  if (!sessione) return null;
  const { user, contesto } = sessione;
  const accountId = contesto.accountId;
  const ufficioGare = contesto.ruolo === "ufficio_gare";
  // abbonamento, crediti e gare gratuite si leggono sul titolare (l'Ufficio Gare non ha accesso a quelle tabelle)
  const clienteAbbonamento = clientePerAccount(contesto, supabase);

  const [consumoPeriodo, statoAccesso, { data: gareRaw }, { data: documentiRaw }] = await Promise.all([
    getConsumoPeriodoCorrente(accountId, clienteAbbonamento),
    getOmniaAiAccessState(accountId, clienteAbbonamento),
    supabase
      .from("gare")
      .select("id, titolo, stazione_appaltante, scadenza, estrazione_stato, estrazione_aggiornata_il, created_at")
      .eq("user_id", accountId)
      .order("scadenza", { ascending: true, nullsFirst: false })
      .returns<GaraRow[]>(),
    supabase
      .from("gara_documenti")
      .select("gara_id, nome_file, created_at")
      .eq("user_id", accountId)
      .order("created_at", { ascending: false })
      .returns<{ gara_id: string; nome_file: string; created_at: string }[]>(),
  ]);

  const gare = gareRaw ?? [];
  const documenti = documentiRaw ?? [];
  const gareIds = gare.map((g) => g.id);

  const gareConDocumenti = new Set(documenti.map((d) => d.gara_id));

  const { data: sezioniRaw } =
    gareIds.length > 0
      ? await supabase
          .from("gara_relazione_sezioni")
          .select("gara_id, created_at")
          .in("gara_id", gareIds)
          .order("created_at", { ascending: true })
          .returns<{ gara_id: string; created_at: string }[]>()
      : { data: [] as { gara_id: string; created_at: string }[] };

  const sezioni = sezioniRaw ?? [];
  const primaRelazionePerGara = new Map<string, string>();
  for (const s of sezioni) {
    if (!primaRelazionePerGara.has(s.gara_id)) primaRelazionePerGara.set(s.gara_id, s.created_at);
  }
  const gareConRelazione = new Set(primaRelazionePerGara.keys());

  const gareRighe: GaraRigaProps[] = gare.map((g) => ({
    id: g.id,
    titolo: g.titolo,
    stazioneAppaltante: g.stazione_appaltante,
    scadenza: g.scadenza,
    estrazioneStato: g.estrazione_stato,
    documentiCaricati: gareConDocumenti.has(g.id),
    relazioneGenerata: gareConRelazione.has(g.id),
  }));

  const gareCompletate = gareConRelazione.size;
  const gareAttive = gare.length - gareCompletate;

  const prossima = gare.find((g) => g.scadenza && (giorniAllaScadenza(g.scadenza) ?? -1) >= 0);
  const prossimaScadenza = prossima
    ? { titolo: prossima.titolo, giorni: giorniAllaScadenza(prossima.scadenza) ?? 0 }
    : null;

  const dataRinnovo = consumoPeriodo?.subscription.current_period_end
    ? new Date(consumoPeriodo.subscription.current_period_end).toLocaleDateString("it-IT")
    : null;

  const titoloPerGara = new Map(gare.map((g) => [g.id, g.titolo] as const));

  // L'Ufficio Gare vede un solo numero, «gare a disposizione», e non le voci amministrative (piano, rinnovo,
  // crediti). Se è zero il titolare riceve l'email (una al giorno, deciso dal database): a mostrarlo
  // all'Ufficio Gare ci pensa la pagina, con il promemoria.
  let gareDisponibili: number | null = null;
  if (ufficioGare && (statoAccesso.stato === "attivo" || statoAccesso.stato === "prova")) {
    const fonti = await leggiFontiQuota(clienteAbbonamento, accountId);
    if (fonti) {
      gareDisponibili = gareRimanenti(fonti);
      if (gareDisponibili === 0) avvisaTitolareDopoLaRisposta({ contesto, emailUfficioGare: user.email, motivo: "gare_finite" });
    }
  }

  const attivita: AttivitaVoce[] = [
    ...documenti.map((d) => ({
      testo: `Documento "${d.nome_file}" caricato su ${titoloPerGara.get(d.gara_id) ?? "una gara"}`,
      garaId: d.gara_id,
      orario: d.created_at,
    })),
    ...gare
      .filter((g) => g.estrazione_stato === "completata" && g.estrazione_aggiornata_il)
      .map((g) => ({
        testo: `Analisi conclusa per "${g.titolo}"`,
        garaId: g.id,
        orario: g.estrazione_aggiornata_il as string,
      })),
    ...[...primaRelazionePerGara.entries()].map(([garaId, orario]) => ({
      testo: `Relazione generata per "${titoloPerGara.get(garaId) ?? "una gara"}"`,
      garaId,
      orario,
    })),
  ]
    .sort((a, b) => new Date(b.orario).getTime() - new Date(a.orario).getTime())
    .slice(0, LIMITE_ATTIVITA);

  return (
    <div className="omnia-app-shell largo">
      <StatusCards
        gareAttive={gareAttive}
        gareCompletate={gareCompletate}
        gareIncluse={consumoPeriodo?.gareIncluse ?? 0}
        consumatePiano={consumoPeriodo?.consumatePiano ?? 0}
        saldoCrediti={consumoPeriodo?.saldoCrediti ?? 0}
        dataRinnovo={dataRinnovo}
        prossimaScadenza={prossimaScadenza}
        gareGratuite={statoAccesso.stato === "prova" ? statoAccesso.gare : null}
        ufficioGare={ufficioGare}
        gareDisponibili={gareDisponibili}
      />

      <GareRecentiList gare={gareRighe} />
      <CosaVuoiFareOggi ufficioGare={ufficioGare} />
      <AttivitaRecente voci={attivita} />
    </div>
  );
}
