import { richiediOpportunitaPagina } from "@/lib/radar/guardie-opportunita";
import { dirittoRadarOppure404 } from "@/lib/radar/area-cliente";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import AggiungiForm from "@/components/omnia-ai/opportunita/aggiungi-form";

// «Aggiungi a mano» (04, §5): se il CIG è già nell'archivio pubblico si apre quella gara; altrimenti nasce una gara riservata dell'impresa,
// che si collegherà da sola quando il CIG comparirà in una fonte. Il collegamento non viene mai aperto da OMNIA.
export default async function AggiungiOpportunitaPage() {
  const sessione = await richiediOpportunitaPagina();
  if (!sessione) return null;
  const { diritto } = await dirittoRadarOppure404(sessione.contesto.accountId);
  return (
    <div className="omnia-app-shell">
      <TestataOpportunita attiva="aggiungi" sottotitolo="Per seguire una gara che non trovi nelle fonti (per esempio una gara sotto soglia appena pubblicata)." />
      <div className="omnia-riquadro">
        {diritto.operativo ? <AggiungiForm /> : <p className="omnia-messaggio-stato avviso">{diritto.messaggioSolaLettura}</p>}
      </div>
      <p className="omnia-opp-nota">
        Le gare che aggiungi restano riservate alla tua impresa: non entrano nell&apos;archivio comune e nessun altro cliente le vede.
      </p>
    </div>
  );
}
