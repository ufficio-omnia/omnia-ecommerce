// Stato di caricamento dell'area riservata: appare SUBITO al cambio di pagina, mentre il server prepara la pagina nuova.
// Barra laterale e barra in alto restano dove sono (stanno nel layout, che non si ridisegna); qui solo il contenuto.
// Sagome neutre, nessun testo inventato né numero: niente che possa sembrare un dato vero. Nessun dato letto, nessuna
// richiesta al server: è un componente statico. Tema chiaro e scuro dai colori del sito; senza animazione se il sistema
// chiede movimento ridotto (regola in omnia-ai.css).
export default function CaricamentoAreaRiservata() {
  return (
    <div className="omnia-caricamento" role="status" aria-live="polite" aria-busy="true">
      <span className="omnia-caricamento-testo-nascosto">Caricamento della pagina…</span>
      <div className="omnia-caricamento-riga omnia-caricamento-titolo" />
      <div className="omnia-caricamento-riga omnia-caricamento-sottotitolo" />
      <div className="omnia-riquadro omnia-caricamento-riquadro">
        <div className="omnia-caricamento-riga" />
        <div className="omnia-caricamento-riga omnia-caricamento-corta" />
        <div className="omnia-caricamento-riga" />
      </div>
    </div>
  );
}
