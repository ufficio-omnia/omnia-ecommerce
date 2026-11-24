import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { schedaGaraApribile } from "@/lib/radar/gara";
import { richiediOpportunitaPagina } from "@/lib/radar/guardie-opportunita";
import { dirittoRadarOppure404, RADICE_OPPORTUNITA } from "@/lib/radar/area-cliente";
import { distanzaScadenza, euro, scadenzaLeggibile, giorniAllaScadenza } from "@/lib/radar/sintesi-calcoli";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import AzioniSalvataggio from "@/components/omnia-ai/opportunita/azioni-salvataggio";
import { giorno } from "@/components/omnia-ai/opportunita/formato";

// Scheda di una gara aggiunta a mano: i dati scritti dall'impresa, il CIG e il collegamento (che OMNIA non apre mai). Quando il CIG compare in
// una fonte la gara si collega da sola e questa pagina porta alla scheda pubblica. Riservata: si legge con la sessione (regole di accesso).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Aggiunta = { id: string; cig: string | null; url: string | null; oggetto: string | null; ente: string | null; scadenza_giorno: string | null; scadenza_offerte: string | null; scadenza_ora_indicata: boolean; importo: number | string | null; procedura_id: string | null; collegata_il: string | null; creata_il: string };

export default async function GaraAggiuntaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sessione = await richiediOpportunitaPagina();
  if (!sessione) return null;
  const { diritto } = await dirittoRadarOppure404(sessione.contesto.accountId);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const da = (await searchParams).da;
  const supabase = await createClient();
  const [{ data: a }, { data: salvata }] = await Promise.all([
    supabase.from("omnia_ai_radar_gare_aggiunte").select("id, cig, url, oggetto, ente, scadenza_giorno, scadenza_offerte, scadenza_ora_indicata, importo, procedura_id, collegata_il, creata_il").eq("id", id).maybeSingle<Aggiunta>(),
    supabase.from("omnia_ai_radar_salvate").select("id, monitorata").eq("aggiunta_id", id).maybeSingle<{ id: string; monitorata: boolean }>(),
  ]);
  if (!a) notFound();
  // collegata a una gara pubblica: si passa alla scheda solo se si apre per il cliente; una gara con SOLO fonti nascoste ai clienti (0120, la
  // PVL dopo la L5a) non esiste per il cliente, e allora restano i dati scritti dall'impresa (documento 47 §3.1)
  if (a.procedura_id && (await schedaGaraApribile(createAdminClient(), a.procedura_id))) redirect(`${RADICE_OPPORTUNITA}/gara/${a.procedura_id}`);
  if (salvata) {
    after(async () => {
      await supabase.from("omnia_ai_radar_salvate").update({ ultimo_aggiornamento_visto_il: new Date().toISOString() }).eq("id", salvata.id);
    });
  }
  const giorni = giorniAllaScadenza(a.scadenza_giorno, new Date());

  return (
    <div className="omnia-app-shell largo">
      <TestataOpportunita attiva={null} />
      {da === "aggiungi" && <p className="omnia-messaggio-stato successo">Gara aggiunta e monitorata. La colleghiamo da sola alla gara pubblica quando il CIG compare in una fonte.</p>}
      {da === "gia" && <p className="omnia-messaggio-stato avviso">Avevi già aggiunto una gara con questo CIG: eccola.</p>}
      <h2 className="omnia-opp-scheda-titolo">{a.oggetto ?? (a.cig ? `Gara con CIG ${a.cig}` : "Gara aggiunta a mano")}</h2>
      <div className="omnia-opp-scheda-corpo">
        <section className="omnia-riquadro omnia-opp-insintesi">
          <span className="omnia-eyebrow">In sintesi (dati scritti da te)</span>
          <div className="omnia-opp-sintesi-riga">
            <div className="omnia-opp-sintesi-etichetta">Chi</div>
            <div className="omnia-opp-sintesi-valore">{a.ente ?? "non indicato"}</div>
          </div>
          <div className="omnia-opp-sintesi-riga">
            <div className="omnia-opp-sintesi-etichetta">Quanto</div>
            <div className="omnia-opp-sintesi-valore">{a.importo !== null ? euro(Number(a.importo)) : "non indicato"}</div>
          </div>
          <div className="omnia-opp-sintesi-riga">
            <div className="omnia-opp-sintesi-etichetta">Entro quando</div>
            <div className="omnia-opp-sintesi-valore">
              {a.scadenza_giorno ? `${scadenzaLeggibile(a.scadenza_giorno, a.scadenza_offerte)}${distanzaScadenza(giorni)}` : "non indicata"}
            </div>
          </div>
          <div className="omnia-opp-sintesi-riga">
            <div className="omnia-opp-sintesi-etichetta">CIG</div>
            <div className="omnia-opp-sintesi-valore">{a.cig ?? "non indicato"}</div>
          </div>
          <div className="omnia-opp-sintesi-riga">
            <div className="omnia-opp-sintesi-etichetta">Fonte</div>
            <div className="omnia-opp-sintesi-valore">
              Aggiunta a mano il {giorno(a.creata_il)}
              <div className="omnia-opp-nota">Non ancora trovata nelle fonti pubbliche attive. Quando il suo CIG compare in una fonte, la colleghiamo da sola.</div>
            </div>
          </div>
        </section>
        <aside className="omnia-riquadro omnia-opp-scheda-azioni">
          <span className="omnia-eyebrow">Azioni</span>
          {a.url && (
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="omnia-btn omnia-btn-p">
              Apri sulla piattaforma
            </a>
          )}
          <AzioniSalvataggio aggiuntaId={a.id} salvata={!!salvata} monitorata={!!salvata?.monitorata} operativo={diritto.operativo} />
          <p className="omnia-opp-nota">
            <Link href={`${RADICE_OPPORTUNITA}/monitorate`}>Torna alle gare che segui</Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
