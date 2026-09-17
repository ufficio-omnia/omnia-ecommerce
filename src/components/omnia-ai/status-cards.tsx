import BrandMark from "./brand-mark";

export type StatusCardsProps = {
  gareAttive: number;
  gareCompletate: number;
  gareIncluse: number;
  consumatePiano: number;
  saldoCrediti: number;
  dataRinnovo: string | null;
  prossimaScadenza: { titolo: string; giorni: number } | null;
};

function testoProssimaScadenza(p: StatusCardsProps["prossimaScadenza"]): string {
  if (!p) return "Nessuna";
  if (p.giorni <= 0) return "Oggi";
  if (p.giorni === 1) return "Domani";
  return `Fra ${p.giorni} giorni`;
}

// Cinque riquadri, mai una percentuale unica: crediti aggiuntivi e gare
// del piano restano due numeri separati apposta, sommarli in un solo
// indicatore nasconderebbe che sono due risorse con regole diverse
// (le gare del piano si azzerano al rinnovo, i crediti no). Il rinnovo
// non è un sesto riquadro: è una seconda riga dentro il riquadro piano,
// stesso soggetto (il periodo di abbonamento). Filigrana del marchio
// solo su questo riquadro, mai sugli altri quattro.
export default function StatusCards({
  gareAttive,
  gareCompletate,
  gareIncluse,
  consumatePiano,
  saldoCrediti,
  dataRinnovo,
  prossimaScadenza,
}: StatusCardsProps) {
  return (
    <div className="omnia-riquadri-stato">
      <div className="omnia-riquadro-stato">
        <div className="omnia-riquadro-stato-etichetta">Gare attive</div>
        <div className="omnia-riquadro-stato-valore">{gareAttive}</div>
      </div>

      <div className="omnia-riquadro-stato">
        <div className="omnia-riquadro-stato-etichetta">Gare completate</div>
        <div className="omnia-riquadro-stato-valore">{gareCompletate}</div>
      </div>

      <div className="omnia-riquadro-stato omnia-riquadro-stato-filigrana">
        <BrandMark />
        <div className="omnia-riquadro-stato-etichetta">Gare del piano</div>
        <div className="omnia-riquadro-stato-valore">
          {consumatePiano} <span className="unita">/ {gareIncluse}</span>
        </div>
        {dataRinnovo && <div className="omnia-riquadro-stato-nota">Rinnovo il {dataRinnovo}</div>}
      </div>

      <div className="omnia-riquadro-stato">
        <div className="omnia-riquadro-stato-etichetta">Crediti aggiuntivi</div>
        <div className="omnia-riquadro-stato-valore">{saldoCrediti}</div>
      </div>

      <div className="omnia-riquadro-stato">
        <div className="omnia-riquadro-stato-etichetta">Prossima scadenza</div>
        <div className="omnia-riquadro-stato-valore" style={{ fontSize: 18 }}>
          {testoProssimaScadenza(prossimaScadenza)}
        </div>
        {prossimaScadenza && <div className="omnia-riquadro-stato-nota">{prossimaScadenza.titolo}</div>}
      </div>
    </div>
  );
}
