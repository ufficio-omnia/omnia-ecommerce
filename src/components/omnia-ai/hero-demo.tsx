"use client";

import { useEffect, useRef } from "react";
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

export default function HeroDemo() {
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
    let W = 0;
    let H = 0;
    let P: Particella[] = [];
    let fase = 0;
    let centro = ANCORE[0];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let attiva = true;
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
        o: 0.08 + Math.random() * 0.18,
      }));
    }
    dim();
    semina();
    const onResize = () => {
      dim();
      semina();
    };
    const onVisibility = () => {
      attiva = !document.hidden;
    };
    addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    let raf = 0;
    function disegna() {
      if (!attiva) {
        raf = requestAnimationFrame(disegna);
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
          p.o += (0.85 - p.o) * 0.05;
          cx!.beginPath();
          cx!.moveTo(c.x, c.y);
          cx!.lineTo(p.x, p.y);
          cx!.strokeStyle = "rgba(79,209,165," + p.o * 0.24 + ")";
          cx!.lineWidth = dpr;
          cx!.stroke();
        } else {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x = W;
          if (p.x > W) p.x = 0;
          if (p.y < 0) p.y = H;
          if (p.y > H) p.y = 0;
          p.o += (0.14 - p.o) * 0.02;
        }
        cx!.font = 13 * dpr + 'px "Space Grotesk", sans-serif';
        cx!.fillStyle = (fase === 1 && p.r ? "rgba(79,209,165," : "rgba(155,146,220,") + p.o.toFixed(3) + ")";
        cx!.fillText(p.t, p.x, p.y);
      });
      raf = requestAnimationFrame(disegna);
    }
    if (!ridotto) {
      raf = requestAnimationFrame(disegna);
    } else {
      cx.font = 13 * dpr + "px sans-serif";
      P.forEach((p) => {
        cx.fillStyle = "rgba(155,146,220,.14)";
        cx.fillText(p.t, p.x, p.y);
      });
    }

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
        <section className="omnia-hero">
          <h1>L&apos;unica AI per gare scritta da chi le gare le ha scritte.</h1>
          <p className="omnia-sotto">
            OMNIA AI legge bando, disciplinare e capitolato e ti restituisce la relazione tecnica
            in Word: indice, intestazioni con il tuo logo, tabelle formattate, stili e
            numerazione già a posto. Dietro non c&apos;è un modello generico, ci sono dieci anni
            di offerte tecniche scritte a mano per soft e hard facility.
          </p>
          <div className="omnia-azioni">
            <Link className="omnia-btn omnia-btn-p" href="/demo">
              Richiedi la demo
            </Link>
            <Link className="omnia-btn omnia-btn-s" href="/come-funziona">
              Come funziona
            </Link>
          </div>
          <p className="micro" style={{ marginTop: 18, fontSize: 13.5, color: "var(--fioco)" }}>
            Demo su una gara vera, non su un esempio preconfezionato. Rispondiamo entro 24 ore.
          </p>

          <div className="omnia-console">
            <div className="omnia-riga-q">
              <p ref={domandaRef} />
              <span className="omnia-cursore" />
            </div>
            <div className="omnia-risposta" ref={rispostaRef} />
            <div className="omnia-fonti" ref={fontiRef} />
          </div>
        </section>
      </div>
    </>
  );
}
