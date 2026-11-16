"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useMarchioStato } from "./marchio-stato-context";

// Porting diretto (stessi tempi, stesse parole, stessa fisica) dello
// script del mockup di riferimento: campo di parole fluttuanti che
// convergono verso la console quando il sistema "risponde". Manipolazione
// diretta del DOM dentro useEffect (non stato React) perché è esattamente
// così che funziona nel riferimento — reimplementarlo con setState
// ridurrebbe il framerate e rischierebbe di far deviare il comportamento
// dall'originale approvato.

const PAROLE = [
  "frequenze", "Ecolabel", "UNI 13549", "DPI", "monte ore", "CAM", "subappalto", "LQA",
  "non conformità", "ausiliariato", "organico", "RSPP", "soglia di sbarramento", "capitolato",
  "facchinaggio", "KPI", "campionamento", "area omogenea", "detergenti", "allegato B",
  "sopralluogo", "offerta tecnica", "stazione appaltante", "piano di lavoro",
];

const ANCORE = [
  { x: 0.19, y: 0.27 },
  { x: 0.81, y: 0.32 },
  { x: 0.25, y: 0.73 },
  { x: 0.77, y: 0.69 },
  { x: 0.5, y: 0.2 },
  { x: 0.14, y: 0.52 },
];

type Scenario = { q: string; a: string; f: string[]; p: string[] };

const SCENARI: Scenario[] = [
  {
    q: "Quali criteri premiano l'uso di prodotti certificati?",
    a: "Il disciplinare assegna 18 punti alla sostenibilità ambientale: 11 all'impiego di detergenti con marchio Ecolabel UE o equivalente, 7 alla coerenza con i Criteri Ambientali Minimi. L'attribuzione piena richiede la certificazione su almeno l'80% dei prodotti dichiarati in offerta.",
    f: ["Disciplinare · art. 18", "Capitolato · § 4.2", "Allegato B · tabella 3"],
    p: ["Ecolabel UE", "Criteri Ambientali Minimi", "detergenti", "80% dei prodotti"],
  },
  {
    q: "Qual è il monte ore minimo richiesto dal capitolato?",
    a: "Il capitolato fissa in 4.320 ore annue il monte ore del lotto 1, ripartite tra operatori e responsabile di commessa. È una soglia inderogabile: offrire meno comporta l'esclusione, e il piano di lavoro deve dimostrarne il rispetto area per area.",
    f: ["Capitolato · § 2.1", "Allegato A · monte ore", "Disciplinare · art. 11"],
    p: ["monte ore", "4.320 ore annue", "piano di lavoro", "area omogenea"],
  },
  {
    q: "Come viene valutato il sistema di controllo qualità?",
    a: "Quindici punti sono riservati all'autocontrollo conforme alla norma UNI EN 13549. Per il punteggio pieno servono i livelli di qualità accettabili, la frequenza dei controlli e le modalità di campionamento, con registrazione delle non conformità e delle relative azioni correttive.",
    f: ["Disciplinare · art. 18.3", "Capitolato · § 6", "Norma UNI EN 13549"],
    p: ["UNI EN 13549", "livelli di qualità", "campionamento", "non conformità"],
  },
];

type Particella = { t: string; x: number; y: number; vx: number; vy: number; r: boolean; o: number };

// Sotto questa larghezza le parole che galleggiano non si disegnano affatto (e il canvas è nascosto dal CSS): su telefoni e
// tablet passavano dietro al titolo e ai testi e sembravano sovrapposte al contenuto. Sopra, il CSS le lascia vedere solo ai
// margini laterali. Stesso valore della regola in omnia-ai.css (max-width: 1099px).
const LARGHEZZA_MIN_PAROLE = 1100;

// `anteprimaDocumento`: l'anteprima illustrativa della relazione in Word (componente server), mostrata accanto alla console
// nella sezione «Scopri cosa genera OMNIA AI».
export default function HeroDemo({ anteprimaDocumento }: { anteprimaDocumento?: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const domandaRef = useRef<HTMLParagraphElement>(null);
  const rispostaRef = useRef<HTMLDivElement>(null);
  const fontiRef = useRef<HTMLDivElement>(null);
  const { setStato } = useMarchioStato();

  useEffect(() => {
    const cv = canvasRef.current;
    const eD = domandaRef.current;
    const eR = rispostaRef.current;
    const cFonti = fontiRef.current;
    if (!cv || !eD || !eR || !cFonti) return;
    const cx = cv.getContext("2d");
    if (!cx) return;

    const ridotto = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Colori delle parole che galleggiano: vengono dal tema (variabili di omnia-ai.css) e si rileggono quando il tema cambia.
    let rgbParticella = "155,146,220";
    let rgbVerde = "79,209,165";
    const leggiColori = () => {
      const stile = getComputedStyle(document.documentElement);
      rgbParticella = stile.getPropertyValue("--particella-rgb").replace(/\s/g, "") || rgbParticella;
      rgbVerde = stile.getPropertyValue("--verde-rgb").replace(/\s/g, "") || rgbVerde;
    };
    leggiColori();
    let W = 0;
    let H = 0;
    let P: Particella[] = [];
    let fase = 0;
    let centro = ANCORE[0];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // attiva: la scheda è visibile; stretto: schermo da telefono (niente parole). Il ciclo di disegno gira solo quando servono
    // entrambe le cose: prima continuava a girare a vuoto anche a scheda nascosta.
    let attiva = !document.hidden;
    const mqStretto = matchMedia(`(max-width: ${LARGHEZZA_MIN_PAROLE - 1}px)`);
    let stretto = mqStretto.matches;
    let inCorso = false;
    const timeout: ReturnType<typeof setTimeout>[] = [];
    const differita = (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      timeout.push(id);
      return id;
    };

    function dim() {
      W = cv!.width = innerWidth * dpr;
      H = cv!.height = innerHeight * dpr;
      cv!.style.width = innerWidth + "px";
      cv!.style.height = innerHeight + "px";
    }
    function semina() {
      const n = innerWidth < 760 ? 12 : PAROLE.length;
      P = PAROLE.slice(0, n).map((t) => ({
        t,
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.15 * dpr,
        vy: (Math.random() - 0.5) * 0.15 * dpr,
        r: false,
        o: 0.05 + Math.random() * 0.1,
      }));
    }
    dim();
    semina();
    const onResize = () => {
      dim();
      semina();
    };
    let raf = 0;
    const avvia = () => {
      if (ridotto || inCorso || !attiva || stretto) return;
      inCorso = true;
      raf = requestAnimationFrame(disegna);
    };
    const onVisibility = () => {
      attiva = !document.hidden;
      avvia();
    };
    const onLarghezza = () => {
      stretto = mqStretto.matches;
      avvia();
    };
    addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    mqStretto.addEventListener("change", onLarghezza);

    function disegna() {
      if (!attiva || stretto) {
        inCorso = false;
        cx!.clearRect(0, 0, W, H);
        return;
      }
      cx!.clearRect(0, 0, W, H);
      const c = { x: W * centro.x, y: H * centro.y };
      P.forEach((p, i) => {
        if (fase === 2 && p.r) {
          p.o += (0 - p.o) * 0.09;
        } else if (fase === 1 && p.r) {
          const a = i * 2.35;
          const tx = c.x + Math.cos(a) * 170 * dpr;
          const ty = c.y + Math.sin(a) * 105 * dpr;
          p.x += (tx - p.x) * 0.05;
          p.y += (ty - p.y) * 0.05;
          p.o += (0.5 - p.o) * 0.05;
          cx!.beginPath();
          cx!.moveTo(c.x, c.y);
          cx!.lineTo(p.x, p.y);
          cx!.strokeStyle = "rgba(" + rgbVerde + "," + p.o * 0.24 + ")";
          cx!.lineWidth = dpr;
          cx!.stroke();
        } else {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x = W;
          if (p.x > W) p.x = 0;
          if (p.y < 0) p.y = H;
          if (p.y > H) p.y = 0;
          p.o += (0.09 - p.o) * 0.02;
        }
        cx!.font = 13 * dpr + 'px "Space Grotesk", sans-serif';
        cx!.fillStyle = "rgba(" + (fase === 1 && p.r ? rgbVerde : rgbParticella) + "," + p.o.toFixed(3) + ")";
        cx!.fillText(p.t, p.x, p.y);
      });
      raf = requestAnimationFrame(disegna);
    }
    avvia();
    // Con il movimento ridotto le parole si disegnano una volta sola: si ridisegnano se cambia il tema.
    const disegnaFermo = () => {
      cx.clearRect(0, 0, W, H);
      if (stretto) return;
      cx.font = 13 * dpr + "px sans-serif";
      P.forEach((p) => {
        cx.fillStyle = "rgba(" + rgbParticella + ",.09)";
        cx.fillText(p.t, p.x, p.y);
      });
    };
    if (ridotto) disegnaFermo();
    const osservatoreTema = new MutationObserver(() => {
      leggiColori();
      if (ridotto) disegnaFermo();
    });
    osservatoreTema.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });

    function scrivi(el: HTMLElement, txt: string, vel: number, fine?: () => void) {
      let i = 0;
      el.textContent = "";
      (function passo() {
        el.textContent = txt.slice(0, ++i);
        if (i < txt.length) differita(passo, vel);
        else fine?.();
      })();
    }
    function prepara(sc: Scenario) {
      let i = Math.floor(Math.random() * ANCORE.length);
      if (ANCORE[i] === centro) i = (i + 1) % ANCORE.length;
      centro = ANCORE[i];
      const liberi = P.filter((p) => !p.r);
      sc.p.forEach((t) => {
        const k = Math.floor(Math.random() * liberi.length);
        const p = liberi.splice(k, 1)[0];
        if (p) {
          p.t = t;
          p.r = true;
          p.o = 0.06;
        }
      });
    }
    function libera() {
      P.forEach((p) => {
        if (p.r) {
          p.r = false;
          p.t = PAROLE[Math.floor(Math.random() * PAROLE.length)];
          p.x = Math.random() * W;
          p.y = Math.random() * H;
          p.o = 0;
        }
      });
    }

    let s = -1;
    function ciclo() {
      s = (s + 1) % SCENARI.length;
      const sc = SCENARI[s];
      fase = 0;
      eR!.textContent = "";
      setStato("riposo");
      cFonti!.innerHTML = sc.f.map((t) => `<span class="omnia-fonte">${t}</span>`).join("");
      prepara(sc);
      scrivi(eD!, sc.q, 40, () =>
        differita(() => {
          fase = 1;
          setStato("elaborazione");
          const fs = [...cFonti!.children];
          differita(
            () => fs.forEach((f, i) => differita(() => f.classList.add("on"), i * 250)),
            950,
          );
          differita(() => {
            setStato("pronto");
            scrivi(eR!, sc.a, 15, () => differita(chiudi, 6200));
          }, 1500);
        }, 600),
      );
    }
    function chiudi() {
      fase = 2;
      differita(() => {
        libera();
        fase = 0;
        ciclo();
      }, 1000);
    }

    if (ridotto) {
      const sc = SCENARI[0];
      eD.textContent = sc.q;
      eR.textContent = sc.a;
      cFonti.innerHTML = sc.f.map((t) => `<span class="omnia-fonte on">${t}</span>`).join("");
      setStato("pronto");
    } else {
      differita(ciclo, 900);
    }

    return () => {
      attiva = false;
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      mqStretto.removeEventListener("change", onLarghezza);
      osservatoreTema.disconnect();
      timeout.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setup imperativo eseguito una sola volta, come nello script originale
  }, []);

  return (
    <>
      {/* Livelli decorativi fissi: DEVONO restare fratelli di .omnia-wrap,
          mai annidati dentro — .omnia-wrap ha position:relative e crea un
          proprio contesto di stacking, dentro il quale un discendente
          position:fixed con z-index esplicito (anche 0) dipinge SEMPRE
          sopra il contenuto normale non posizionato, qualunque z-index
          gli si dia: coprirebbe il testo (bug osservato in pratica). Per
          questo qui c'è un secondo .omnia-wrap solo per la sezione hero,
          invece di uno unico condiviso con il resto della pagina. */}
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
            Nata dall&apos;esperienza di professionisti del settore, OMNIA AI analizza bandi,
            disciplinari e capitolati e trasforma la documentazione di gara in offerte tecniche
            Word strutturate, personalizzate e pronte per la revisione finale.
          </p>
          <p className="omnia-sotto-2">
            Una piattaforma completa, con strumenti e servizi specialistici per l&apos;analisi, la
            pianificazione e la formulazione delle offerte: semplifica ogni fase del lavoro e
            valorizza le competenze dei professionisti.
          </p>
          <div className="omnia-azioni">
            <Link className="omnia-btn omnia-btn-p" href="/demo">
              Richiedi la demo
            </Link>
            <Link className="omnia-btn omnia-btn-s" href="/come-funziona">
              Come funziona
            </Link>
          </div>
          <p className="micro omnia-hero-nota">
            Demo su una gara vera, non su un esempio preconfezionato: compili il modulo e scegli
            subito giorno e ora.
          </p>
        </section>

        <section className="omnia-section omnia-genera" id="cosa-genera" aria-labelledby="omnia-genera-titolo">
          <p className="omnia-occhiello">Il risultato</p>
          <h2 id="omnia-genera-titolo">Scopri cosa genera OMNIA AI</h2>
          <p className="omnia-guida">
            Non un testo da riformattare: una relazione tecnica in Word già organizzata sulla griglia
            di valutazione, e risposte sui documenti di gara che indicano sempre da dove vengono.
          </p>

          <div className="omnia-genera-griglia">
            {anteprimaDocumento}

            <figure className="omnia-genera-scheda">
              <figcaption className="omnia-genera-etichetta">
                <b>Domande sui documenti di gara</b>
                <span>Ogni risposta indica articolo, paragrafo o tabella da cui viene.</span>
              </figcaption>
              <div className="omnia-console">
                <div className="omnia-riga-q">
                  <p ref={domandaRef} />
                  <span className="omnia-cursore" />
                </div>
                <div className="omnia-risposta" ref={rispostaRef} />
                <div className="omnia-fonti" ref={fontiRef} />
              </div>
            </figure>
          </div>
          <p className="omnia-nota-illustrativa">
            Anteprime illustrative con contenuti di esempio: non riproducono documenti di gare o di
            clienti reali.
          </p>
        </section>
      </div>
    </>
  );
}
