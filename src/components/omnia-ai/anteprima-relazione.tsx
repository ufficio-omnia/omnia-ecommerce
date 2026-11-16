// Anteprima ILLUSTRATIVA di una pagina della relazione tecnica in Word, disegnata in HTML e CSS (nessuna immagine da caricare,
// nessun layout shift). Mostra la STRUTTURA che OMNIA AI produce davvero (intestazione con il logo del cliente, titoli numerati sul
// criterio, testo, parole chiave evidenziate, tabella con intestazione colorata, piè di pagina): i contenuti sono di esempio e la
// sezione della home lo dichiara sotto le anteprime. Non è uno screenshot e non va presentata come tale; nessun dato di gare o
// clienti reali (stessa regola del piano di lavoro: mai altre gare nei materiali).
//
// Le righe di testo sono barre grigie (testo «finto» leggibile come tale), tranne titoli e tabella: così l'anteprima comunica il
// risultato senza fingere un documento vero. aria-hidden sul foglio: per i lettori di schermo vale la didascalia.

const RIGHE_TABELLA = [
  ["Uffici e corridoi", "Giornaliera", "UNI EN 13549"],
  ["Servizi igienici", "2 volte al giorno", "UNI EN 13549"],
  ["Aree esterne", "Settimanale", "Verifica a vista"],
];

export default function AnteprimaRelazione() {
  return (
    <figure className="omnia-genera-scheda">
      <figcaption className="omnia-genera-etichetta">
        <b>Relazione tecnica in Word</b>
        <span>File .docx modificabile, impaginato sul tuo marchio e sui criteri di valutazione.</span>
      </figcaption>

      <div className="omnia-foglio" aria-hidden="true">
        <div className="omnia-foglio-pagina">
          <div className="omnia-foglio-testata">
            <span className="omnia-foglio-logo">IL TUO LOGO</span>
            <span className="omnia-foglio-testata-testo">Relazione tecnica · Servizio di pulizia e sanificazione</span>
          </div>

          <p className="omnia-foglio-criterio">Criterio B.3 · Sistema di controllo qualità · 15 punti</p>
          <p className="omnia-foglio-titolo">3.1 Organizzazione dei controlli</p>
          <span className="omnia-foglio-riga" style={{ width: "100%" }} />
          <span className="omnia-foglio-riga" style={{ width: "94%" }} />
          <span className="omnia-foglio-riga omnia-foglio-riga-chiave" style={{ width: "97%" }}>
            <i>livelli di qualità accettabili</i>
          </span>
          <span className="omnia-foglio-riga" style={{ width: "62%" }} />

          <div className="omnia-foglio-tabella">
            <div className="omnia-foglio-tabella-testa">
              <span>Area</span>
              <span>Frequenza</span>
              <span>Controllo</span>
            </div>
            {RIGHE_TABELLA.map((riga) => (
              <div key={riga[0]} className="omnia-foglio-tabella-riga">
                {riga.map((cella) => (
                  <span key={cella}>{cella}</span>
                ))}
              </div>
            ))}
          </div>

          <p className="omnia-foglio-titolo">3.2 Gestione delle non conformità</p>
          <span className="omnia-foglio-riga" style={{ width: "98%" }} />
          <span className="omnia-foglio-riga" style={{ width: "88%" }} />

          <div className="omnia-foglio-piede">
            <span>Il tuo logo · Offerta tecnica</span>
            <span>Pagina 7</span>
          </div>
        </div>
      </div>

      <ul className="omnia-foglio-file" aria-label="Cosa puoi ottenere da una gara">
        <li>
          <span className="omnia-foglio-est">DOCX</span> Relazione tecnica
        </li>
        <li>
          <span className="omnia-foglio-est verde">XLSX</span> Piano di lavoro*
        </li>
        <li>
          <span className="omnia-foglio-est">PDF</span> Copertina
        </li>
      </ul>
      <p className="omnia-foglio-nota">* Per le gare di servizi di pulizia. Piano di lavoro e copertina sono compresi con Professional ed Enterprise, acquistabili a parte con Starter.</p>
    </figure>
  );
}
