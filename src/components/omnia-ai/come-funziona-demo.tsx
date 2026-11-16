// Esempio della pagina «Come funziona»: la domanda, i passaggi dei documenti da cui parte la risposta e la risposta con le fonti, TUTTI
// subito visibili (revisione del 16/11/2026: prima il testo si scriveva lettera per lettera e il riquadro restava a lungo vuoto). È un
// esempio dimostrativo con dati di fantasia, non una risposta in tempo reale: la pagina lo dice sopra il riquadro. Nessuna animazione a
// tempo; solo una comparsa morbida in CSS, spenta con prefers-reduced-motion.

const DOMANDA = "Quali requisiti di esperienza pregressa chiede il disciplinare?";
const FRAMMENTI = [
  {
    fonte: "Disciplinare · art. 7",
    testo:
      "I concorrenti devono dimostrare di aver eseguito, nell'ultimo triennio, servizi analoghi per un importo complessivo non inferiore a due volte il valore posto a base di gara.",
  },
  {
    fonte: "Capitolato · § 1.3",
    testo:
      "Per servizi analoghi si intendono gli interventi di pulizia, sanificazione o facchinaggio svolti presso strutture sanitarie o assimilabili per complessità.",
  },
];
const RISPOSTA =
  "Il disciplinare, all'art. 7, richiede un fatturato specifico nel triennio pari ad almeno il doppio della base d'asta in servizi analoghi. Il capitolato, al § 1.3, precisa che sono validi solo gli interventi svolti presso strutture sanitarie o assimilabili per complessità: un riferimento generico a \"servizi di pulizia\" non basta a dimostrare il requisito.";

export default function ComeFunzionaDemo() {
  return (
    <div className="omnia-console omnia-esempio-statico">
      <div className="omnia-esempio-statico-parte">
        <p className="omnia-esempio-statico-etichetta">La domanda</p>
        <p className="omnia-esempio-domanda">{DOMANDA}</p>
      </div>
      <div className="omnia-esempio-statico-parte">
        <p className="omnia-esempio-statico-etichetta">I passaggi dei documenti da cui parte la risposta</p>
        <div className="omnia-frammenti">
          {FRAMMENTI.map((f) => (
            <div key={f.fonte} className="omnia-frammento on">
              <div className="omnia-frammento-fonte">{f.fonte}</div>
              <div className="omnia-frammento-testo">{f.testo}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="omnia-esempio-statico-parte">
        <p className="omnia-esempio-statico-etichetta">La risposta, con le fonti</p>
        <p className="omnia-esempio-risposta-cf">{RISPOSTA}</p>
      </div>
    </div>
  );
}
