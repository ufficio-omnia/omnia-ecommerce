"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";

// Hero della home e sezione «Scopri cosa genera OMNIA AI».
//
// Sullo sfondo, solo sugli schermi larghi, galleggiano parole del settore (canvas): restano ai margini (maschera nel CSS) e non si
// disegnano sotto i 1100 px. La console degli esempi NON è animata a tempo: domanda, risposta e riferimenti sono subito leggibili e si
// cambia esempio con le schede (revisione del 16/11/2026: prima il testo si scriveva lettera per lettera e il riquadro restava a lungo
// vuoto). Gli esempi sono dimostrativi, con dati di fantasia, e lo dicono.

const PAROLE = [
  "frequenze", "Ecolabel", "UNI 13549", "DPI", "monte ore", "CAM", "subappalto", "LQA",
  "non conformità", "ausiliariato", "organico", "RSPP", "soglia di sbarramento", "capitolato",
  "facchinaggio", "KPI", "campionamento", "area omogenea", "detergenti", "allegato B",
  "sopralluogo", "offerta tecnica", "stazione appaltante", "piano di lavoro",
];

type Scenario = { etichetta: string; q: string; a: string; f: string[] };

const SCENARI: Scenario[] = [
  {
    etichetta: "Prodotti certificati",
    q: "Quali criteri premiano l'uso di prodotti certificati?",
    a: "Il disciplinare assegna 18 punti alla sostenibilità ambientale: 11 all'impiego di detergenti con marchio Ecolabel UE o equivalente, 7 alla coerenza con i Criteri Ambientali Minimi. L'attribuzione piena richiede la certificazione su almeno l'80% dei prodotti dichiarati in offerta.",
    f: ["Disciplinare · art. 18", "Capitolato · § 4.2", "Allegato B · tabella 3"],
  },
  {
    etichetta: "Monte ore",
    q: "Qual è il monte ore minimo richiesto dal capitolato?",
    a: "Il capitolato fissa in 4.320 ore annue il monte ore del lotto 1, ripartite tra operatori e responsabile di commessa. È una soglia inderogabile: offrire meno comporta l'esclusione, e il piano di lavoro deve dimostrarne il rispetto area per area.",
    f: ["Capitolato · § 2.1", "Allegato A · monte ore", "Disciplinare · art. 11"],
  },
  {
    etichetta: "Controllo qualità",
    q: "Come viene valutato il sistema di controllo qualità?",
    a: "Quindici punti sono riservati all'autocontrollo conforme alla norma UNI EN 13549. Per il punteggio pieno servono i livelli di qualità accettabili, la frequenza dei controlli e le modalità di campionamento, con registrazione delle non conformità e delle relative azioni correttive.",
    f: ["Disciplinare · art. 18.3", "Capitolato · § 6", "Norma UNI EN 13549"],
  },
];

// I settori in cui OMNIA AI è specializzata (gli stessi della domanda frequente «Su quali gare funziona davvero?»).
const SETTORI = [
  "Pulizie e sanificazione",
  "Facchinaggio",
  "Ausiliariato",
  "Portierato",
  "Ristorazione collettiva",
  "Vigilanza",
  "Elisuperfici",
];

// Sotto questa larghezza le parole che galleggiano non si disegnano (e il canvas è nascosto dal CSS): su telefoni e tablet passavano
// dietro ai testi. Stesso valore della regola in omnia-ai.css (max-width: 1099px).
const LARGHEZZA_MIN_PAROLE = 1100;

type Particella = { t: string; x: number; y: number; vx: number; vy: number; o: number };

// `anteprimaDocumento`: l'anteprima illustrativa della relazione in Word (componente server), accanto alla console.
export default function HeroDemo({ anteprimaDocumento }: { anteprimaDocumento?: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scelto, setScelto] = useState(0);
  const schedeRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;

    const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Colori delle parole: vengono dal tema (variabili di omnia-ai.css) e si rileggono quando il tema cambia.
    let rgbParticella = "155,146,220";
    const leggiColori = () => {
      const stile = getComputedStyle(document.documentElement);
      rgbParticella = stile.getPropertyValue("--particella-rgb").replace(/\s/g, "") || rgbParticella;
      // --verde-rgb resta letto per coerenza con il tema (le parole sono tutte nella tinta delle particelle)
      void stile.getPropertyValue("--verde-rgb");
    };
    leggiColori();
    let W = 0;
    let H = 0;
    let P: Particella[] = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Il ciclo di disegno gira solo a scheda visibile e su schermo largo.
    let attiva = !document.hidden;
    const mqStretto = matchMedia(`(max-width: ${LARGHEZZA_MIN_PAROLE - 1}px)`);
    let stretto = mqStretto.matches;
    let inCorso = false;

    function dim() {
      W = cv!.width = innerWidth * dpr;
      H = cv!.height = innerHeight * dpr;
      cv!.style.width = innerWidth + "px";
      cv!.style.height = innerHeight + "px";
    }
    function semina() {
      P = PAROLE.map((t) => ({
        t,
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.15 * dpr,
        vy: (Math.random() - 0.5) * 0.15 * dpr,
        o: 0.05 + Math.random() * 0.1,
      }));
    }
    dim();
    semina();

    let raf = 0;
    function disegna() {
      if (!attiva || stretto) {
        inCorso = false;
        cx!.clearRect(0, 0, W, H);
        return;
      }
      cx!.clearRect(0, 0, W, H);
      cx!.font = 13 * dpr + 'px "Space Grotesk", sans-serif';
      P.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
        p.o += (0.09 - p.o) * 0.02;
        cx!.fillStyle = "rgba(" + rgbParticella + "," + p.o.toFixed(3) + ")";
        cx!.fillText(p.t, p.x, p.y);
      });
      raf = requestAnimationFrame(disegna);
    }
    const avvia = () => {
      if (ridotto || inCorso || !attiva || stretto) return;
      inCorso = true;
      raf = requestAnimationFrame(disegna);
    };
    // Con il movimento ridotto le parole si disegnano una volta sola (ferme).
    const disegnaFermo = () => {
      cx.clearRect(0, 0, W, H);
      if (stretto) return;
      cx.font = 13 * dpr + "px sans-serif";
      P.forEach((p) => {
        cx.fillStyle = "rgba(" + rgbParticella + ",.09)";
        cx.fillText(p.t, p.x, p.y);
      });
    };

    const onResize = () => {
      dim();
      semina();
      if (ridotto) disegnaFermo();
    };
    const onVisibility = () => {
      attiva = !document.hidden;
      avvia();
    };
    const onLarghezza = () => {
      stretto = mqStretto.matches;
      if (ridotto) disegnaFermo();
      avvia();
    };
    addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    mqStretto.addEventListener("change", onLarghezza);
    const osservatoreTema = new MutationObserver(() => {
      leggiColori();
      if (ridotto) disegnaFermo();
    });
    osservatoreTema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });

    if (ridotto) disegnaFermo();
    else avvia();

    return () => {
      attiva = false;
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      mqStretto.removeEventListener("change", onLarghezza);
      osservatoreTema.disconnect();
    };
  }, []);

  // schede degli esempi: frecce sinistra/destra, Inizio e Fine (schema «tabs» accessibile)
  function alTasto(e: KeyboardEvent<HTMLButtonElement>) {
    const n = SCENARI.length;
    const mappa: Record<string, number> = { ArrowRight: (scelto + 1) % n, ArrowLeft: (scelto - 1 + n) % n, Home: 0, End: n - 1 };
    if (!(e.key in mappa)) return;
    e.preventDefault();
    const nuovo = mappa[e.key];
    setScelto(nuovo);
    schedeRef.current[nuovo]?.focus();
  }

  return (
    <>
      {/* Livelli decorativi fissi: DEVONO restare fratelli di .omnia-wrap, mai annidati dentro — .omnia-wrap ha position:relative e
          crea un proprio contesto di stacking, dentro il quale un discendente position:fixed coprirebbe il testo (bug osservato). */}
      <div className="omnia-fondo-solido" aria-hidden="true" />
      <canvas ref={canvasRef} className="omnia-campo" aria-hidden="true" />
      <div className="omnia-vel" aria-hidden="true" />

      <div className="omnia-wrap">
        <section className="omnia-hero" aria-labelledby="omnia-hero-titolo">
          {/* Lo slogan ufficiale: mai tradotto né modificato. lang="en" perché i lettori di schermo lo pronuncino in inglese. */}
          <p className="omnia-slogan" lang="en">
            <span className="omnia-slogan-tech">TECH WHEN POSSIBLE.</span>{" "}
            <span className="omnia-slogan-human">HUMAN WHEN IT MATTERS.</span>
          </p>
          <h1 id="omnia-hero-titolo">
            <span className="omnia-h1-riga">Dalla gara d&apos;appalto all&apos;offerta tecnica</span>{" "}
            <span className="omnia-h1-riga">
              L&apos;intelligenza artificiale incontra{" "}
              <span className="omnia-accento">10&nbsp;anni di esperienza</span>
            </span>
          </h1>
          <p className="omnia-sotto">
            Carichi bando, disciplinare e capitolato: OMNIA AI li analizza e prepara l&apos;offerta tecnica
            in Word, strutturata sui criteri di valutazione e modificabile, pronta per la tua verifica
            finale.
          </p>

          {/* Il passaggio, in tre tappe: documenti di gara → analisi → offerta tecnica in Word */}
          <ol className="omnia-flusso" aria-label="Il percorso, in tre tappe">
            <li>
              <span className="omnia-flusso-tag">PDF · Word</span>
              <b>Documenti di gara</b>
            </li>
            <li>
              <span className="omnia-flusso-tag">Analisi</span>
              <b>Criteri, punteggi e vincoli</b>
            </li>
            <li className="omnia-flusso-arrivo">
              <span className="omnia-flusso-tag">DOCX</span>
              <b>Offerta tecnica modificabile</b>
            </li>
          </ol>

          <div className="omnia-azioni">
            <Link className="omnia-btn omnia-btn-p" href="/demo">
              Richiedi la demo
            </Link>
            <Link className="omnia-btn omnia-btn-s" href="/come-funziona">
              Come funziona
            </Link>
          </div>
          {/* per chi è già pronto ad acquistare: la demo è facoltativa */}
          <p className="omnia-hero-piani">
            Vuoi partire subito? <Link href="/piani">Confronta piani e prezzi</Link>
          </p>

          <div className="omnia-settori">
            <p>Specializzata nelle gare di facility management:</p>
            <ul>
              {SETTORI.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="omnia-section omnia-genera" id="cosa-genera" aria-labelledby="omnia-genera-titolo">
          <p className="omnia-occhiello">Il risultato</p>
          <h2 id="omnia-genera-titolo">Scopri cosa genera OMNIA AI</h2>
          <p className="omnia-guida">
            Una relazione tecnica in Word organizzata sulla griglia di valutazione, e risposte sui
            documenti di gara con i riferimenti per verificarle.
          </p>

          <div className="omnia-genera-griglia">
            {anteprimaDocumento}

            <figure className="omnia-genera-scheda">
              <figcaption className="omnia-genera-etichetta">
                <b>Domande sui documenti di gara</b>
                <span>Ogni risposta indica articolo, paragrafo o tabella da cui viene, per verificarla.</span>
              </figcaption>
              <div className="omnia-esempi-schede" role="tablist" aria-label="Esempi di domande">
                {SCENARI.map((sc, i) => (
                  <button
                    key={sc.etichetta}
                    ref={(el) => {
                      schedeRef.current[i] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`omnia-esempio-scheda-${i}`}
                    aria-selected={scelto === i}
                    aria-controls={`omnia-esempio-${i}`}
                    tabIndex={scelto === i ? 0 : -1}
                    onClick={() => setScelto(i)}
                    onKeyDown={alTasto}
                  >
                    {sc.etichetta}
                  </button>
                ))}
              </div>
              {/* Tutti gli esempi stanno nella stessa cella della griglia: l'altezza è quella del più lungo e non cambia mai */}
              <div className="omnia-console omnia-esempi">
                {SCENARI.map((sc, i) => (
                  <div
                    key={sc.etichetta}
                    id={`omnia-esempio-${i}`}
                    role="tabpanel"
                    aria-labelledby={`omnia-esempio-scheda-${i}`}
                    className={`omnia-esempio${scelto === i ? " attivo" : ""}`}
                    hidden={false}
                    aria-hidden={scelto !== i}
                  >
                    <p className="omnia-esempio-domanda">{sc.q}</p>
                    <p className="omnia-esempio-risposta">{sc.a}</p>
                    <div className="omnia-fonti">
                      {sc.f.map((t) => (
                        <span key={t} className="omnia-fonte on">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="omnia-esempio-nota">Esempio dimostrativo con dati di fantasia, non una risposta in tempo reale.</p>
            </figure>
          </div>
          <p className="omnia-nota-illustrativa">
            L&apos;anteprima del documento è illustrativa: contenuti di esempio, non tratti da gare reali.
          </p>
        </section>
      </div>
    </>
  );
}
