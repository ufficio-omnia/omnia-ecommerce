import { REVISIONE } from "@/lib/omnia-ai-revisione-calcoli";

// Fascia della pagina dei piani che presenta il servizio di revisione umana della relazione tecnica.
//
// Nessun prezzo, di proposito (scelta dell'ufficio). I numeri non sono scritti a mano: vengono dalle
// stesse regole che il sistema applica davvero (lib/omnia-ai-revisione-calcoli.ts), così il sito non può
// promettere ciò che il servizio non fa. Nessuna promessa sull'esito della gara.
export default function RevisioneBanda() {
  return (
    <section className="omnia-revisione" aria-labelledby="omnia-revisione-titolo">
      <p className="omnia-revisione-etichetta">Revisione umana</p>
      <h2 id="omnia-revisione-titolo">L&apos;AI scrive. Un consulente esperto rifinisce.</h2>
      <p className="omnia-revisione-testo">
        Hai finito la relazione con OMNIA AI? Dall&apos;interfaccia chiedi con un clic la revisione umana di
        consulenti esperti in gare d&apos;appalto: ti contattano personalmente e la relazione revisionata ti arriva
        entro {REVISIONE.oreConsegna} ore dalla richiesta.
      </p>
      <ul className="omnia-revisione-punti">
        <li>
          <b>Contatto personale</b>
          <span>entro {REVISIONE.oreContattoLavorative} ore lavorative</span>
        </li>
        <li>
          <b>Consegna</b>
          <span>entro {REVISIONE.oreConsegna} ore dalla richiesta</span>
        </li>
        <li>
          <b>Pronta da consegnare</b>
          <span>intestazione, piè di pagina e copertina grafica personalizzata</span>
        </li>
      </ul>
      <p className="omnia-revisione-nota">
        Disponibile per tutti gli abbonati, sulle gare che scadono tra almeno {REVISIONE.oreMinimePerGestire} ore.
      </p>
    </section>
  );
}
