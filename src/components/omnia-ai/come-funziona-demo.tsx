"use client";

import { useEffect, useState } from "react";
import { useMarchioStato } from "./marchio-stato-context";

// Versione "spiegata" della console della home: qui il recupero dei
// frammenti è un passo esplicito e visibile (le schede "frammenti
// recuperati"), non solo i pallini delle fonti dopo la risposta — è
// proprio quello che questa pagina deve mostrare.

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

type Fase = "domanda" | "recupero" | "risposta" | "pausa";

function useTypewriter(testo: string, attivo: boolean, velocita: number) {
  const [scritto, setScritto] = useState("");
  useEffect(() => {
    if (!attivo) {
      setScritto("");
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i++;
      setScritto(testo.slice(0, i));
      if (i >= testo.length) clearInterval(id);
    }, velocita);
    return () => clearInterval(id);
  }, [testo, attivo, velocita]);
  return scritto;
}

export default function ComeFunzionaDemo() {
  const { setStato } = useMarchioStato();
  const [fase, setFase] = useState<Fase>("domanda");
  const [frammentiVisibili, setFrammentiVisibili] = useState(0);

  const domandaScritta = useTypewriter(DOMANDA, fase === "domanda", 38);
  const rispostaScritta = useTypewriter(RISPOSTA, fase === "risposta", 15);
  const domandaCompleta = fase !== "domanda" || domandaScritta.length === DOMANDA.length;

  useEffect(() => {
    const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ridotto) {
      setFase("risposta");
      setFrammentiVisibili(FRAMMENTI.length);
      setStato("pronto");
      return;
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const dopo = (fn: () => void, ms: number) => timeouts.push(setTimeout(fn, ms));

    if (fase === "domanda" && domandaScritta.length === DOMANDA.length) {
      setStato("elaborazione");
      dopo(() => setFase("recupero"), 500);
    }
    if (fase === "recupero") {
      FRAMMENTI.forEach((_, i) => dopo(() => setFrammentiVisibili(i + 1), 500 + i * 600));
      dopo(() => setFase("risposta"), 500 + FRAMMENTI.length * 600 + 400);
    }
    if (fase === "risposta" && rispostaScritta.length === RISPOSTA.length) {
      setStato("pronto");
      dopo(() => setFase("pausa"), 5000);
    }
    if (fase === "pausa") {
      dopo(() => {
        setFrammentiVisibili(0);
        setStato("riposo");
        setFase("domanda");
      }, 1200);
    }

    return () => timeouts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ciclo temporizzato, non deve rieseguire ad ogni render
  }, [fase, domandaScritta, rispostaScritta]);

  return (
    <div className="omnia-console" style={{ margin: "0", maxWidth: "none" }}>
      <div className="omnia-riga-q">
        <p>{domandaScritta}</p>
        {!domandaCompleta && <span className="omnia-cursore" />}
      </div>

      {frammentiVisibili > 0 && (
        <div style={{ borderTop: "1px solid var(--bordo)", padding: "16px 18px 4px", textAlign: "left" }}>
          <p className="micro" style={{ textAlign: "left", fontSize: 12, letterSpacing: "0.02em", textTransform: "uppercase" }}>
            Frammenti recuperati
          </p>
          <div className="omnia-frammenti">
            {FRAMMENTI.map((f, i) => (
              <div key={f.fonte} className={`omnia-frammento${i < frammentiVisibili ? " on" : ""}`}>
                <div className="omnia-frammento-fonte">{f.fonte}</div>
                <div className="omnia-frammento-testo">{f.testo}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(fase === "risposta" || fase === "pausa") && (
        <div className="omnia-risposta">{rispostaScritta}</div>
      )}
    </div>
  );
}
