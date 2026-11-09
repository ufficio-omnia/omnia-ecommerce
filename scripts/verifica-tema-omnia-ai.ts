// Controlli gratuiti sul tema chiaro/scuro di omnia-ai.it e della sua area riservata (nessuna rete, nessun database).
//   1. la logica: scelta salvata → tema, di base SEMPRE lo scuro;
//   2. lo script che parte prima della pagina, eseguito davvero caso per caso e confrontato con la logica;
//   3. il CSS: il tema scuro è rimasto com'era, quello chiaro ridefinisce ogni variabile, niente colori scritti a mano fuori dalla tavolozza;
//   4. il contrasto dei testi (WCAG AA) nel tema chiaro, calcolato sui colori veri del CSS;
//   5. dove sta l'interruttore, che cosa salva e quando, e come seguono il tema i pezzi di terzi (anti-bot, badge Stripe Climate).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  CHIAVE_TEMA,
  COLORI_BROWSER,
  SCELTA_PREDEFINITA,
  SCELTE_TEMA,
  applicaTemaAlDocumento,
  costruisciScriptTema,
  interpretaScelta,
  leggiScelta,
  salvaScelta,
  temaEffettivo,
} from "../src/lib/tema-omnia-ai";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");
const senzaCommentiCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const senzaCommentiJs = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ───── il CSS: blocchi e variabili ─────
function bloccoCss(css: string, intestazione: string): string {
  const inizio = css.indexOf(intestazione);
  if (inizio < 0) return "";
  const apre = css.indexOf("{", inizio);
  let livello = 0;
  for (let i = apre; i < css.length; i++) {
    if (css[i] === "{") livello++;
    if (css[i] === "}" && --livello === 0) return css.slice(apre + 1, i);
  }
  return "";
}
function variabili(blocco: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of senzaCommentiCss(blocco).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// ───── colori e contrasto (WCAG 2) ─────
type Rgba = { r: number; g: number; b: number; a: number };
function colore(valore: string): Rgba {
  const v = valore.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\s*\)$/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`colore non riconosciuto: ${valore}`);
}
function terna(valore: string, alfa: number): Rgba {
  const [r, g, b] = valore.split(",").map((n) => +n.trim());
  return { r, g, b, a: alfa };
}
function sopra(primo: Rgba, secondo: Rgba): Rgba {
  const a = primo.a + secondo.a * (1 - primo.a);
  const mix = (x: number, y: number) => (x * primo.a + y * secondo.a * (1 - primo.a)) / a;
  return { r: mix(primo.r, secondo.r), g: mix(primo.g, secondo.g), b: mix(primo.b, secondo.b), a };
}
function luminanza(c: Rgba): number {
  const lin = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
function contrasto(testo: Rgba, fondo: Rgba): number {
  const f = { ...fondo, a: 1 };
  const t = sopra(testo, f);
  const [chiaro, scuro] = [luminanza(t), luminanza(f)].sort((x, y) => y - x);
  return (chiaro + 0.05) / (scuro + 0.05);
}

// ───── lo script iniziale, eseguito con un documento finto ─────
type Esito = { tema: string | null; scelta: string | null; themeColor: string | null; colorScheme: string | null; errore: string | null };
function eseguiScript(opzioni: { salvato?: string | null; storageRotto?: boolean; sistemaChiaro?: boolean; senzaMatchMedia?: boolean; matchMediaRotto?: boolean; senzaMeta?: boolean }): Esito {
  const attributi: Record<string, string> = {};
  const meta: Record<string, { content: string | null; setAttribute(n: string, v: string): void }> = {};
  const creaMeta = () => ({ content: null as string | null, setAttribute(n: string, v: string) { if (n === "content") this.content = v; } });
  meta['meta[name="theme-color"]'] = creaMeta();
  meta['meta[name="color-scheme"]'] = creaMeta();
  const documento = {
    documentElement: { setAttribute: (n: string, v: string) => { attributi[n] = v; } },
    querySelector: (s: string) => (opzioni.senzaMeta ? null : meta[s] ?? null),
  };
  const finestra: Record<string, unknown> = {};
  const matchMedia = (q: string) => {
    if (opzioni.matchMediaRotto) throw new Error("matchMedia non disponibile");
    return { matches: q.includes("light") && !!opzioni.sistemaChiaro };
  };
  if (!opzioni.senzaMatchMedia) finestra.matchMedia = matchMedia;
  const contesto: Record<string, unknown> = {
    document: documento,
    window: finestra,
    localStorage: {
      getItem: (k: string) => {
        if (opzioni.storageRotto) throw new Error("storage bloccato");
        return k === CHIAVE_TEMA ? opzioni.salvato ?? null : null;
      },
    },
  };
  if (!opzioni.senzaMatchMedia) contesto.matchMedia = matchMedia;
  let errore: string | null = null;
  try {
    vm.runInNewContext(costruisciScriptTema(), contesto);
  } catch (e) {
    errore = e instanceof Error ? e.message : String(e);
  }
  return {
    tema: attributi["data-tema"] ?? null,
    scelta: attributi["data-tema-scelta"] ?? null,
    themeColor: meta['meta[name="theme-color"]'].content,
    colorScheme: meta['meta[name="color-scheme"]'].content,
    errore,
  };
}

async function main() {
  // ═════ 1. la logica ═════
  console.log("--- La logica ---");
  uguale("senza una scelta il tema è SEMPRE lo scuro (e valori strani valgono «scuro»)", [interpretaScelta(null), interpretaScelta(undefined), interpretaScelta(""), interpretaScelta("blu"), interpretaScelta("CHIARO")], ["scuro", "scuro", "scuro", "scuro", "scuro"]);
  uguale("le tre scelte valide si riconoscono", SCELTE_TEMA.map((s) => interpretaScelta(s)), ["scuro", "chiaro", "auto"]);
  uguale("la scelta predefinita è «scuro»", SCELTA_PREDEFINITA, "scuro");
  uguale(
    "tema effettivo: «auto» segue il sistema, le altre due no",
    [temaEffettivo("scuro", true), temaEffettivo("scuro", false), temaEffettivo("chiaro", true), temaEffettivo("chiaro", false), temaEffettivo("auto", true), temaEffettivo("auto", false)],
    ["scuro", "scuro", "chiaro", "chiaro", "chiaro", "scuro"],
  );
  uguale("i colori del browser: scuro #050509 (come --nero) e chiaro #f5f4fb", [COLORI_BROWSER.scuro, COLORI_BROWSER.chiaro], [{ themeColor: "#050509", colorScheme: "dark" }, { themeColor: "#f5f4fb", colorScheme: "light" }]);
  {
    const scritto: string[] = [];
    const finto = { getItem: () => "chiaro", setItem: (k: string, v: string) => void scritto.push(`${k}=${v}`) };
    const rotto = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    uguale("salvare e rileggere la scelta funziona; con storage assente o bloccato non c'è nessun errore e si resta sullo scuro", [salvaScelta(finto, "chiaro"), scritto, salvaScelta(null, "chiaro"), salvaScelta(rotto, "chiaro"), leggiScelta(finto), leggiScelta(null), leggiScelta(rotto)], [true, ["omnia-tema=chiaro"], false, false, "chiaro", "scuro", "scuro"]);
  }

  // ═════ 2. lo script iniziale ═════
  console.log("--- Lo script iniziale ---");
  const casi: { nome: string; opz: Parameters<typeof eseguiScript>[0]; scelta: string }[] = [
    { nome: "niente salvato", opz: {}, scelta: "scuro" },
    { nome: "niente salvato, sistema chiaro (il sito resta scuro)", opz: { sistemaChiaro: true }, scelta: "scuro" },
    { nome: "scuro", opz: { salvato: "scuro", sistemaChiaro: true }, scelta: "scuro" },
    { nome: "chiaro", opz: { salvato: "chiaro" }, scelta: "chiaro" },
    { nome: "auto con sistema chiaro", opz: { salvato: "auto", sistemaChiaro: true }, scelta: "auto" },
    { nome: "auto con sistema scuro", opz: { salvato: "auto", sistemaChiaro: false }, scelta: "auto" },
    { nome: "valore salvato non valido", opz: { salvato: "viola", sistemaChiaro: true }, scelta: "scuro" },
  ];
  for (const c of casi) {
    const e = eseguiScript(c.opz);
    const tema = temaEffettivo(interpretaScelta(c.scelta), !!c.opz.sistemaChiaro);
    uguale(`script, ${c.nome}: tema, scelta e colori del browser come dalla logica`, [e.errore, e.tema, e.scelta, e.themeColor, e.colorScheme], [null, tema, c.scelta, COLORI_BROWSER[tema].themeColor, COLORI_BROWSER[tema].colorScheme]);
  }
  {
    // stessa prova con la funzione che usa l'interruttore: stesso risultato dello script
    const uguali = SCELTE_TEMA.every((s) =>
      [true, false].every((sistemaChiaro) => {
        const dallo = eseguiScript({ salvato: s, sistemaChiaro });
        const attr: Record<string, string> = {};
        const m: Record<string, string> = {};
        applicaTemaAlDocumento(
          { documentElement: { setAttribute: (n, v) => { attr[n] = v; } }, querySelector: (sel) => ({ setAttribute: (n, v) => { m[sel] = v; } }) },
          s,
          sistemaChiaro,
        );
        return dallo.tema === attr["data-tema"] && dallo.scelta === attr["data-tema-scelta"] && dallo.themeColor === m['meta[name="theme-color"]'] && dallo.colorScheme === m['meta[name="color-scheme"]'];
      }),
    );
    atteso("lo script iniziale e l'applicazione dell'interruttore danno lo stesso risultato per ogni scelta e ogni sistema", uguali);
  }
  {
    const rotti = [eseguiScript({ storageRotto: true }), eseguiScript({ senzaMatchMedia: true, salvato: "auto" }), eseguiScript({ matchMediaRotto: true, salvato: "auto" }), eseguiScript({ senzaMeta: true, salvato: "chiaro" })];
    uguale("senza errori e con il tema giusto anche se: lo storage è bloccato, manca matchMedia, matchMedia fallisce, mancano i meta", rotti.map((e) => [e.errore, e.tema]), [[null, "scuro"], [null, "scuro"], [null, "scuro"], [null, "chiaro"]]);
  }
  {
    const script = costruisciScriptTema();
    atteso("lo script è un'unica funzione che parte subito, in ES5, e non tocca cookie né rete", /^\(function\(\)\{[\s\S]*\}\)\(\);$/.test(script) && !/=>|\blet\b|\bconst\b|`/.test(script) && !/cookie|fetch|XMLHttpRequest|sendBeacon|import\(/.test(script));
    atteso("lo script è corto (non rallenta la pagina)", script.length < 900, `${script.length} caratteri`);
  }

  // ═════ 3. il CSS ═════
  console.log("--- Il CSS ---");
  const cssGrezzo = leggi("src/app/site-omnia-ai/omnia-ai.css");
  const css = senzaCommentiCss(cssGrezzo);
  const scure = variabili(bloccoCss(cssGrezzo, ":root {"));
  const chiare = variabili(bloccoCss(cssGrezzo, ':root[data-tema="chiaro"] {'));
  uguale(
    "il tema scuro ha ancora esattamente i colori di sempre",
    {
      nero: scure["nero"], vetro: scure["vetro"], vetro2: scure["vetro-2"], vetro3: scure["vetro-3"], bordo: scure["bordo"], bordoF: scure["bordo-f"], viola: scure["viola"], verde: scure["verde"], ambra: scure["ambra"], rosso: scure["rosso"], testo: scure["testo"], fioco: scure["fioco"],
    },
    { nero: "#050509", vetro: "rgba(255, 255, 255, 0.038)", vetro2: "rgba(255, 255, 255, 0.06)", vetro3: "rgba(11, 10, 22, 0.5)", bordo: "rgba(150, 140, 255, 0.16)", bordoF: "rgba(150, 140, 255, 0.3)", viola: "#8b7fe8", verde: "#4fd1a5", ambra: "#e8a33d", rosso: "#e85d3d", testo: "#e9e7f4", fioco: "#8b8aa8" },
  );
  uguale(
    "le terne RGB del tema scuro sono quelle dei colori di ruolo (le trasparenze di prima non cambiano)",
    [scure["nero-rgb"], scure["pannello-rgb"], scure["bianco-rgb"], scure["viola-rgb"], scure["verde-rgb"], scure["ambra-rgb"], scure["rosso-rgb"]],
    ["5, 5, 9", "11, 10, 22", "255, 255, 255", "139, 127, 232", "79, 209, 165", "232, 163, 61", "232, 93, 61"],
  );
  const mancanti = Object.keys(scure).filter((n) => !(n in chiare));
  atteso("il tema chiaro ridefinisce OGNI variabile del tema scuro (nessuna resta col valore scuro per dimenticanza)", mancanti.length === 0, `mancano: ${mancanti.join(", ")}`);
  const inPiu = Object.keys(chiare).filter((n) => !(n in scure));
  atteso("il tema chiaro non inventa variabili che il tema scuro non ha", inPiu.length === 0, `in più: ${inPiu.join(", ")}`);
  atteso("il fondo dichiarato nel tema chiaro è lo stesso del colore del browser (--nero = #f5f4fb) e lo schema dei controlli nativi diventa «light»", chiare["nero"] === COLORI_BROWSER.chiaro.themeColor && /color-scheme:\s*light/.test(bloccoCss(cssGrezzo, ':root[data-tema="chiaro"] {')) && /color-scheme:\s*dark/.test(bloccoCss(cssGrezzo, "html {")));
  atteso("il tema scuro NON dipende dal sistema: nessuna regola prefers-color-scheme nel CSS (il tema del sistema vale solo con la scelta «automatico»)", !/prefers-color-scheme/.test(css));
  atteso("il tema chiaro si attiva SOLO con data-tema=\"chiaro\": nessun altro selettore lo usa per cambiare i colori", [...css.matchAll(/data-tema/g)].every((m) => css.slice(Math.max(0, m.index! - 8), m.index! + 20).includes(':root[data-tema="chiaro"]')));
  {
    // colori scritti a mano: fuori dai due blocchi di variabili non devono essercene (salvo le eccezioni volute)
    let resto = css;
    for (const intestazione of [":root {", ':root[data-tema="chiaro"] {']) {
      const corpo = bloccoCss(cssGrezzo, intestazione);
      resto = resto.replace(senzaCommentiCss(corpo), "");
    }
    const letterali = [...resto.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g)].map((m) => m[0].trim());
    uguale("nel CSS, fuori dalle variabili, restano solo i tre colori voluti: sfondo e testo dell'anteprima del logo caricato (bianco, sempre) e il testo del contatore rosso", letterali, ["#fff", "#6b7280", "#fff"]);
    const usate = new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
    const usateRgb = new Set([...css.matchAll(/rgba\(var\(--([a-z0-9-]+)\),/g)].map((m) => m[1]));
    const nonDefinite = [...usate, ...usateRgb].filter((n) => !(n in scure));
    atteso("ogni variabile usata nel CSS esiste (nessun var() senza definizione)", nonDefinite.length === 0, nonDefinite.join(", "));
    atteso("le trasparenze usano solo le terne «-rgb» dei colori di ruolo", [...usateRgb].every((n) => /-rgb$/.test(n)));
  }
  {
    const tsx = (dir: string): string[] => fs.readdirSync(path.join(radice, dir), { withFileTypes: true }).flatMap((v) => (v.isDirectory() ? tsx(path.join(dir, v.name)) : /\.tsx?$/.test(v.name) ? [path.join(dir, v.name).replace(/\\/g, "/")] : []));
    // fuori: la prova locale temporanea (non è nel repository), le icone e l'immagine social (sempre scure), il colore del browser del layout
    const esclusi = ["src/app/site-omnia-ai/apple-icon.tsx", "src/app/site-omnia-ai/opengraph-image.tsx", "src/app/site-omnia-ai/layout.tsx"];
    const file = [...tsx("src/components/omnia-ai"), ...tsx("src/app/site-omnia-ai")].filter((f) => !esclusi.includes(f) && !f.includes("/prova-tema/"));
    const colpevoli = file.filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|\b(white|black)\b\s*["']/.test(senzaCommentiJs(leggi(f))));
    atteso("nei componenti e nelle pagine di omnia-ai.it nessun colore scritto a mano (tutto passa dalle variabili, quindi dal tema)", colpevoli.length === 0, colpevoli.join(", "));
    const layout = senzaCommentiJs(leggi("src/app/site-omnia-ai/layout.tsx"));
    atteso("il colore del browser di base resta quello scuro (themeColor #050509, colorScheme dark): senza scelta non cambia nulla", /themeColor: "#050509"/.test(layout) && /colorScheme: "dark"/.test(layout));
  }

  // ═════ 4. il contrasto nel tema chiaro (e il testo nel tema scuro) ═════
  console.log("--- Il contrasto (WCAG AA, 4,5:1 per il testo) ---");
  {
    const fondoChiaro = colore(chiare["nero"]);
    const superficie = (v: Record<string, string>) => {
      const nero = colore(v["nero"]);
      const vetro = sopra(colore(v["vetro"]), { ...nero, a: 1 });
      const vetro2 = sopra(colore(v["vetro-2"]), vetro);
      return { nero, vetro, vetro2, pannello: sopra(terna(v["pannello-rgb"], 0.9), { ...nero, a: 1 }) };
    };
    const sc = superficie(chiare);
    const testiChiari = ["testo", "testo-2", "testo-2b", "testo-3", "fioco", "viola", "verde", "ambra", "rosso"];
    for (const [nomeFondo, fondo] of Object.entries({ "fondo": sc.nero, "superficie (vetro)": sc.vetro, "voce selezionata (vetro-2)": sc.vetro2, "pannello": sc.pannello })) {
      const peggiore = testiChiari.map((n) => ({ n, c: contrasto(colore(chiare[n]), fondo) })).sort((a, b) => a.c - b.c)[0];
      atteso(`tema chiaro: tutti i testi (normali e colorati) leggono su ${nomeFondo}`, peggiore.c >= 4.5, `il peggiore è --${peggiore.n}: ${peggiore.c.toFixed(2)}:1`);
    }
    // etichette colorate (badge, esiti): il colore del ruolo sul proprio tono chiaro (trasparenza fino a .14) sopra la superficie
    for (const ruolo of ["verde", "ambra", "rosso", "viola"]) {
      const tinta = sopra(terna(chiare[`${ruolo}-rgb`], 0.14), sc.vetro);
      const c = contrasto(colore(chiare[ruolo]), tinta);
      atteso(`tema chiaro: il ${ruolo} come testo sul proprio tono chiaro (badge, esiti)`, c >= 4.5, `${c.toFixed(2)}:1`);
    }
    atteso("tema chiaro: le terne dei colori di ruolo coincidono con i colori (la trasparenza usa lo stesso colore del testo)", ["viola", "verde", "ambra", "rosso"].every((r) => { const c = colore(chiare[r]); return chiare[`${r}-rgb`] === `${c.r}, ${c.g}, ${c.b}`; }));
    uguale("tema chiaro: testo sui pulsanti pieni (viola e verde) e sul gradiente di «Nuova gara»", [contrasto(colore(chiare["su-viola"]), colore(chiare["viola"])) >= 4.5, contrasto(colore(chiare["su-verde"]), colore(chiare["verde"])) >= 4.5, contrasto(colore(chiare["su-viola"]), colore(chiare["viola-2"])) >= 4.5, contrasto(colore("#ffffff"), colore(chiare["rosso"])) >= 4.5], [true, true, true, true]);
    atteso("tema chiaro: lo stato attivo dei pulsanti (--viola sull'interruttore selezionato) si legge", contrasto(colore(chiare["viola"]), sc.vetro2) >= 4.5);
    void fondoChiaro;

    const scuro = superficie(scure);
    const peggiore = ["testo", "testo-2", "testo-2b", "testo-3", "fioco", "viola", "verde"].map((n) => ({ n, c: contrasto(colore(scure[n]), scuro.nero) })).sort((a, b) => a.c - b.c)[0];
    atteso("tema scuro: i testi principali leggono sul fondo (invariato rispetto a prima)", peggiore.c >= 4.5, `il peggiore è --${peggiore.n}: ${peggiore.c.toFixed(2)}:1`);
    uguale("tema scuro: i testi sui pulsanti pieni restano leggibili", [contrasto(colore(scure["su-viola"]), colore(scure["viola"])) >= 4.5, contrasto(colore(scure["su-verde"]), colore(scure["verde"])) >= 4.5], [true, true]);
  }

  // ═════ 5. interruttore, salvataggio e pezzi di terzi ═════
  console.log("--- L'interruttore e i pezzi di terzi ---");
  {
    const layoutGrezzo = leggi("src/app/site-omnia-ai/layout.tsx");
    const layout = senzaCommentiJs(layoutGrezzo);
    const corpo = layout.slice(layout.indexOf("<body>"), layout.indexOf("</body>"));
    atteso("lo script del tema è il PRIMO elemento del body (parte prima del contenuto, nessun lampo del tema sbagliato)", /^<body>\s*(?:\{\}\s*)?<ApplicaTema \/>\s*\{children\}/.test(corpo), corpo.slice(0, 80));
    atteso("l'<html> non dichiara nessun tema da server (di base è lo scuro) e ammette gli attributi scritti dallo script", /<html lang="it" suppressHydrationWarning>/.test(layout) && !/data-tema/.test(layout));
    atteso("lo script lo scrive un componente server dal modulo della logica (un solo testo, provato qui sopra)", /costruisciScriptTema\(\)/.test(leggi("src/components/omnia-ai/applica-tema.tsx")) && !/"use client"/.test(leggi("src/components/omnia-ai/applica-tema.tsx")));

    const intestazione = leggi("src/components/omnia-ai/site-header.tsx");
    const topbar = leggi("src/components/omnia-ai/topbar.tsx");
    atteso("l'interruttore c'è nell'intestazione del sito (accanto ad «Accedi»), nel menu mobile (in versione grande) e nella barra dell'area riservata, anche per l'Ufficio Gare", /<Link href="\/login" className="omnia-accedi">[\s\S]*?<\/Link>\s*<ToggleTema \/>/.test(intestazione) && /<ToggleTema grande \/>/.test(intestazione) && /<ToggleTema \/>/.test(topbar) && !/ufficioGare &&[^\n]*<ToggleTema/.test(topbar));
    atteso("nel menu mobile l'interruttore è raggiungibile da tastiera (il ciclo del focus include anche i pulsanti)", /querySelectorAll<HTMLElement>\("a\[href\], button"\)/.test(intestazione));

    const toggle = leggi("src/components/omnia-ai/toggle-tema.tsx");
    atteso("l'interruttore ha tre pulsanti con nome e stato per i lettori di schermo (gruppo con etichetta, aria-label, aria-pressed)", /role="group" aria-label="Aspetto del sito"/.test(toggle) && /aria-pressed=\{scelta === s\}/.test(toggle) && /aria-label=\{ETICHETTE_SCELTA\[s\]\}/.test(toggle) && /SCELTE_TEMA\.map/.test(toggle));
    atteso("la scelta si salva SOLO al clic dell'utente: salvaScelta è chiamato solo dentro scegli()", (toggle.match(/salvaScelta\(/g) ?? []).length === 1 && /function scegli\(nuova: SceltaTema\) \{[\s\S]*?salvaScelta\(storage, nuova\);[\s\S]*?\n  \}/.test(toggle));
    atteso("con «automatico» il tema segue il sistema anche a pagina aperta, e il collegamento si toglie quando non serve", /if \(scelta !== "auto"\) return;/.test(toggle) && /addEventListener\("change", segui\)/.test(toggle) && /removeEventListener\("change", segui\)/.test(toggle));
    const tutti = ["src/components/omnia-ai", "src/app/site-omnia-ai", "src/lib"].flatMap((d) => (function visita(dir: string): string[] { return fs.readdirSync(path.join(radice, dir), { withFileTypes: true }).flatMap((v) => (v.isDirectory() ? visita(path.join(dir, v.name)) : /\.tsx?$/.test(v.name) ? [path.join(dir, v.name).replace(/\\/g, "/")] : [])); })(d));
    const chePossono = tutti.filter((f) => /localStorage/.test(senzaCommentiJs(leggi(f)))).sort();
    const delTema = tutti.filter((f) => /omnia-tema|CHIAVE_TEMA/.test(senzaCommentiJs(leggi(f)))).sort().join(",");
    atteso(
      "la scelta del tema non finisce in cookie: nessun codice del tema scrive document.cookie, e la chiave «omnia-tema» la usano solo il modulo del tema e l'interruttore (le altre cose che usano localStorage nel sito non la toccano)",
      !/document\.cookie/.test(senzaCommentiJs(leggi("src/lib/tema-omnia-ai.ts") + toggle + leggi("src/components/omnia-ai/use-tema.ts"))) && delTema === "src/components/omnia-ai/toggle-tema.tsx,src/lib/tema-omnia-ai.ts" && chePossono.includes("src/components/omnia-ai/toggle-tema.tsx"),
      delTema,
    );

    const hero = senzaCommentiJs(leggi("src/components/omnia-ai/hero-demo.tsx"));
    atteso("le parole che galleggiano nella home prendono i colori dal tema (--particella-rgb, --verde-rgb), si aggiornano al cambio di tema e l'osservatore si chiude all'uscita", /--particella-rgb/.test(hero) && /--verde-rgb/.test(hero) && /attributeFilter: \["data-tema"\]/.test(hero) && /osservatoreTema\.disconnect\(\)/.test(hero) && !/rgba\(\d/.test(hero));
    const cookie = senzaCommentiJs(leggi("src/components/omnia-ai/cookie-consent.tsx"));
    atteso("il banner dei cookie usa i colori del tema (nessun colore scritto a mano)", /rgba\(var\(--pannello-rgb\), \.92\)/.test(cookie) && !/rgba\(\d/.test(cookie));
    const badge = senzaCommentiJs(leggi("src/components/omnia-ai/climate-badge.tsx"));
    atteso("il badge Stripe Climate ha le due versioni (scura e chiara) e il CSS ne mostra una (provato nel controllo del badge)", /TEMI_BADGE = \["dark", "light"\]/.test(badge) && !/"use client"/.test(badge));
    for (const f of ["src/components/omnia-ai/login-form.tsx", "src/app/site-omnia-ai/registrati/registrati-form.tsx", "src/components/omnia-ai/demo-form.tsx"]) {
      atteso(`${f.replace("src/app/", "").replace("src/", "")}: il riquadro anti-bot segue il tema del sito`, /tema="sito"/.test(leggi(f)));
    }
    atteso("l'e-commerce non cambia: i suoi moduli restano sul tema chiaro di Cloudflare e il suo layout non ha lo script del tema", ["login/login-form.tsx", "registrati/registrati-form.tsx", "password-dimenticata/password-dimenticata-form.tsx"].every((f) => /tema="light"/.test(leggi(`src/app/(ecommerce)/${f}`))) && !/ApplicaTema|data-tema/.test(leggi("src/app/(ecommerce)/layout.tsx")) && !/ApplicaTema|data-tema/.test(leggi("src/app/site-console/layout.tsx")));
    atteso("la prova locale temporanea non è nel repository (cartella esclusa e assente dai file tracciati)", !/prova-tema/.test(leggi("package.json")));
    atteso("questi controlli sono nella batteria prima della build", /verifica-tema-omnia-ai\.ts/.test(leggi("package.json")));
  }

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
