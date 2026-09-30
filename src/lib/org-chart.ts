import sharp from "sharp";
import path from "path";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import type { StileOrganigramma } from "@/lib/org-chart-style";

// Le FORME (rettangoli, linee, loghi) restano SVG rasterizzato da sharp
// (libvips/librsvg) come prima — solo il TESTO non è più un <text> SVG.
// Il testo tramite librsvg risolve "font-family" con i font DI SISTEMA
// (fontconfig): presenti in locale (dove il rendering sembrava corretto)
// ma ASSENTI nell'ambiente serverless di Vercel — senza un font
// risolvibile, librsvg disegna ogni carattere come un riquadro vuoto
// ("tofu"), anche il testo normale, non solo gli accentati — bug osservato
// in produzione su un organigramma reale, invisibile finché non si genera
// davvero lì (in locale non si presenta mai). Il primo tentativo
// (incorporare il font nell'SVG con "@font-face" in base64) NON risolve:
// verificato che questa build di librsvg lo ignora silenziosamente e
// ricade comunque su un font sostitutivo di sistema, che è quello che
// probabilmente manca su Vercel — un test locale che sembra funzionare non
// lo dimostra, perché la build sharp di Windows può avere un fallback che
// quella Linux non ha.
//
// Soluzione: il testo è disegnato a parte su un canvas (@napi-rs/canvas,
// motore Skia) con il font caricato ESPLICITAMENTE da file
// (GlobalFonts.registerFromPath) — un meccanismo diverso da fontconfig,
// che non cerca font di sistema per nome: il file è la sola fonte del
// glifo, quindi il risultato è identico a prescindere dai font installati
// sulla macchina che esegue il rendering (verificato: funziona anche
// registrando il file sotto un nome di fantasia mai esistito come font di
// sistema). Il canvas del testo viene poi sovrapposto (sharp .composite)
// all'immagine SVG delle sole forme.
//
// Font: Liberation Sans (licenza SIL Open Font License 1.1, redistribuzione
// libera — vedi src/assets/fonts/LICENSE_LIBERATION), scelto perché
// compatibile per metriche con Arial (il nome già usato qui prima) e già
// presente nell'albero delle dipendenze (pdfjs-dist lo usa come font
// standard per il rendering PDF) — qui è una copia propria nel repository,
// non un percorso dentro node_modules di un altro pacchetto, per non
// dipendere da un dettaglio interno che potrebbe cambiare a ogni versione.
const NOME_FONT_ORGANIGRAMMA = "OmniaOrgChart";
let fontRegistrato = false;
function assicuraFontRegistrato(): void {
  if (fontRegistrato) return;
  const cartellaFont = path.join(process.cwd(), "src", "assets", "fonts");
  GlobalFonts.registerFromPath(path.join(cartellaFont, "LiberationSans-Regular.ttf"), NOME_FONT_ORGANIGRAMMA);
  GlobalFonts.registerFromPath(path.join(cartellaFont, "LiberationSans-Bold.ttf"), NOME_FONT_ORGANIGRAMMA);
  fontRegistrato = true;
}

// Un'operazione di disegno testo, raccolta durante la costruzione dell'SVG
// invece di finire in un <text> — riprodotta poi su un canvas dedicato.
// "anchor"/coordinate hanno lo stesso significato dei corrispondenti
// text-anchor/x/y SVG che sostituiscono (compreso il fatto che "y" è la
// baseline del testo, non il bordo superiore: la baseline di default di
// Canvas2D coincide con quella di SVG, nessuna conversione necessaria).
type TextOp = { x: number; y: number; text: string; anchor: "start" | "middle"; bold: boolean; fontSize: number; color: string };

const STILE_DEFAULT: StileOrganigramma = {
  boxFill: "#2E86C1",
  boxStroke: "#1B4F72",
  boxRadius: 6,
  connectorStroke: "#4A5C58",
  fontColor: "#FFFFFF",
};

type OrgNode = {
  text: string;
  level: number;
  children: OrgNode[];
  lines: string[];
  bulletItems: string[];
  livello?: string;
  laterale?: "sx" | "dx";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

const BOX_WIDTH = 200;
const BOX_WIDTH_ELENCO = 260;
const CHARS_PER_LINE = 22;
const CHARS_PER_LINE_ELENCO = 30;
const MAX_LINES = 3;
const LINE_HEIGHT = 15;
const BOX_PADDING_V = 16;
const H_GAP = 30;
const V_GAP = 50;
const MARGIN = 24;
const LEGENDA_ALTEZZA = 26;
const LEGENDA_PALETTE = ["#8E9AAF", "#1B2631", "#D68910", "#27974C", "#C0392B", "#7D3C98"];
const LOGO_ALTEZZA_MAX = 48;
const LOGO_STRIP_ALTEZZA = 60;

export type LoghiOrganigramma = {
  aziendale?: { base64: string; width: number; height: number };
  software?: { base64: string; width: number; height: number };
  cliente?: { base64: string; width: number; height: number };
};

const LIVELLO_TAG_REGEX = /\s*\{LIVELLO:([^}]+)\}\s*$/i;
const BANNER_REGEX = /\[BANNER\]([\s\S]*?)\[\/BANNER\]/gi;

// Interpreta un elenco a rientri (2 spazi = un livello) come gerarchia,
// con alcune estensioni oltre alla semplice etichetta:
//   Direzione Commessa {LIVELLO:Governo}
//     • voce elenco dentro la casella del genitore
//     < Casella laterale a sinistra del genitore
//     > Casella laterale a destra del genitore
//       Sotto-casella normale
function parseHierarchy(testo: string): OrgNode[] {
  const righe = testo.split("\n").filter((r) => r.trim().length > 0);
  const roots: OrgNode[] = [];
  const stack: { node: OrgNode; level: number }[] = [];

  for (const rigaGrezza of righe) {
    const indentMatch = rigaGrezza.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].replace(/\t/g, "  ").length : 0;
    const level = Math.floor(indent / 2);
    let testoRiga = rigaGrezza.trim();

    // Un elenco puntato ("• voce") appartiene alla casella del nodo
    // corrente (elenco interno), non è una casella a sé — come i box
    // "Resp. di Funzione" / "Uffici di Gestione" con elenco di ruoli
    // osservati negli organigrammi reali.
    if (/^[•·]\s+/.test(testoRiga)) {
      const voce = testoRiga.replace(/^[•·]\s+/, "");
      const genitore = [...stack].reverse().find((s) => s.level < level);
      if (genitore) {
        genitore.node.bulletItems.push(voce);
        continue;
      }
    }

    let laterale: "sx" | "dx" | undefined;
    if (/^<\s+/.test(testoRiga)) {
      laterale = "sx";
      testoRiga = testoRiga.replace(/^<\s+/, "");
    } else if (/^>\s+/.test(testoRiga)) {
      laterale = "dx";
      testoRiga = testoRiga.replace(/^>\s+/, "");
    }

    const livelloMatch = testoRiga.match(LIVELLO_TAG_REGEX);
    const livello = livelloMatch ? livelloMatch[1].trim() : undefined;
    if (livelloMatch) testoRiga = testoRiga.slice(0, livelloMatch.index);

    const text = testoRiga.trim().replace(/^[-*]\s*/, "");
    const node: OrgNode = { text, level, children: [], lines: [], bulletItems: [], livello, laterale };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, level });
  }

  return roots;
}

function collectNodes(roots: OrgNode[]): OrgNode[] {
  const allNodes: OrgNode[] = [];
  function collect(node: OrgNode) {
    allNodes.push(node);
    node.children.forEach(collect);
  }
  roots.forEach(collect);
  return allNodes;
}

// A capo per parola (mai a metà parola) su un massimo di righe: oltre,
// l'ultima riga finisce con "…" — molto più leggibile del troncamento
// brutale di una singola riga usato in precedenza (bug segnalato: le
// etichette finivano tagliate a metà parola in quasi ogni casella).
function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let i = 0;

  while (i < words.length && lines.length < maxLines) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      i++;
    } else if (!current) {
      lines.push(word.slice(0, maxCharsPerLine));
      i++;
    } else {
      lines.push(current);
      current = "";
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (i < words.length) {
    const ultima = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = `${ultima.slice(0, Math.max(0, maxCharsPerLine - 1))}…`;
  }

  return lines.length ? lines : [""];
}

// Schiarisce un colore esadecimale verso il bianco di una frazione
// (0-1): usato per dare un accenno di gerarchia visiva ai livelli più
// profondi (più chiari), come i colori variati per livello osservati
// negli organigrammi reali, senza richiedere una tavolozza multipla
// esplicita dall'estrazione di stile.
function schiarisci(hex: string, frazione: number): string {
  const pulito = hex.replace("#", "");
  const r = parseInt(pulito.slice(0, 2), 16);
  const g = parseInt(pulito.slice(2, 4), 16);
  const b = parseInt(pulito.slice(4, 6), 16);
  const mix = (canale: number) => Math.round(canale + (255 - canale) * frazione);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function calcolaDimensioni(node: OrgNode): void {
  const haElenco = node.bulletItems.length > 0;
  const maxChars = haElenco ? CHARS_PER_LINE_ELENCO : CHARS_PER_LINE;
  node.lines = wrapText(node.text, maxChars, haElenco ? 1 : MAX_LINES);
  node.width = haElenco ? BOX_WIDTH_ELENCO : BOX_WIDTH;

  if (haElenco) {
    const righeElenco = node.bulletItems.map((v) => wrapText(v, maxChars - 2, 1)[0]);
    node.height = BOX_PADDING_V + LINE_HEIGHT + righeElenco.length * LINE_HEIGHT + 6;
    node.lines = [node.lines[0], ...righeElenco.map((r) => `• ${r}`)];
  }
}

function layout(
  roots: OrgNode[],
): { allNodes: OrgNode[]; width: number; height: number; livelli: string[] } {
  const allNodes = collectNodes(roots);
  const nodiNormali = allNodes.filter((n) => !n.laterale);

  for (const node of allNodes) {
    calcolaDimensioni(node);
  }

  // Altezza uniforme per livello dell'albero (righe allineate come in un
  // vero organigramma aziendale), calcolata sul nodo con più righe di
  // testo di quel livello — i nodi con elenco interno hanno un'altezza
  // propria, già calcolata in calcolaDimensioni, e non influenzano gli
  // altri nodi del loro stesso livello.
  const maxLivelloAlbero = nodiNormali.reduce((max, n) => Math.max(max, n.level), 0);
  const altezzaPerLivello: number[] = [];
  for (let livello = 0; livello <= maxLivelloAlbero; livello++) {
    const nodiLivello = nodiNormali.filter((n) => n.level === livello && n.bulletItems.length === 0);
    const maxRighe = Math.max(1, ...nodiLivello.map((n) => n.lines.length));
    altezzaPerLivello[livello] = BOX_PADDING_V + maxRighe * LINE_HEIGHT;
  }
  for (const node of nodiNormali) {
    if (node.bulletItems.length === 0) node.height = altezzaPerLivello[node.level];
  }

  const yPerLivello: number[] = [];
  let cumY = 0;
  for (let livello = 0; livello <= maxLivelloAlbero; livello++) {
    const altezzaMax = Math.max(
      altezzaPerLivello[livello],
      ...nodiNormali.filter((n) => n.level === livello).map((n) => n.height ?? 0),
    );
    yPerLivello[livello] = cumY;
    cumY += altezzaMax + V_GAP;
  }

  // Le caselle laterali (sx/dx) non entrano nel flusso orizzontale
  // normale: si posizionano accanto al genitore, sulla sua stessa riga,
  // come i box "Preposto Sicurezza"/"Ispettore della Qualità" affiancati
  // al "Responsabile di Commessa" negli organigrammi reali.
  let nextX = 0;
  function place(node: OrgNode, yBase: number[]): number {
    const figliNormali = node.children.filter((c) => !c.laterale);
    let x: number;
    if (figliNormali.length === 0) {
      x = nextX;
      nextX += (node.width ?? BOX_WIDTH) + H_GAP;
    } else {
      const childXs = figliNormali.map((c) => place(c, yBase));
      x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    }
    node.x = x;
    node.y = yBase[node.level];

    for (const laterale of node.children.filter((c) => c.laterale)) {
      laterale.y = node.y;
      laterale.height = node.height;
      laterale.x =
        laterale.laterale === "sx"
          ? (node.x ?? 0) - (laterale.width ?? BOX_WIDTH) - H_GAP
          : (node.x ?? 0) + (node.width ?? BOX_WIDTH) + H_GAP;
    }
    return x;
  }

  // I nodi radice con elenco interno (es. "Resp. di Funzione", "Uffici
  // di Gestione") formano una riga a sé stante SOPRA il resto
  // dell'organigramma, centrata rispetto ad esso — non caselle laterali
  // né rami dell'albero — come nei progetti di riferimento, dove queste
  // caselle informative stanno in alto, non ai lati.
  const radiciTestata = roots.filter((n) => n.bulletItems.length > 0);
  const radiciAlbero = roots.filter((n) => n.bulletItems.length === 0);

  let testataX = 0;
  for (const nodo of radiciTestata) {
    nodo.x = testataX;
    nodo.y = 0;
    testataX += (nodo.width ?? BOX_WIDTH_ELENCO) + H_GAP;
  }
  const testataWidth = Math.max(0, testataX - H_GAP);
  const testataHeight = Math.max(0, ...radiciTestata.map((n) => n.height ?? 0));
  const offsetAlbero = radiciTestata.length > 0 ? testataHeight + V_GAP : 0;
  const yPerLivelloAlbero = yPerLivello.map((y) => y + offsetAlbero);

  radiciAlbero.forEach((n) => place(n, yPerLivelloAlbero));

  // La larghezza reale dell'albero deve includere le caselle laterali
  // (sx/dx): "nextX" conta solo i nodi normali e sottostimava la
  // larghezza vera quando una casella laterale sporgeva di lato,
  // causando una centratura sbagliata rispetto alla testata (bug
  // osservato: organigramma visivamente sbilanciato/disordinato).
  const nodiAlbero = collectNodes(radiciAlbero);
  const alberoMinX = Math.min(0, ...nodiAlbero.map((n) => n.x ?? 0));
  const alberoMaxX = Math.max(0, ...nodiAlbero.map((n) => (n.x ?? 0) + (n.width ?? BOX_WIDTH)));
  if (alberoMinX < 0) {
    nodiAlbero.forEach((n) => {
      n.x = (n.x ?? 0) - alberoMinX;
    });
  }
  const alberoWidth = alberoMaxX - alberoMinX;

  // Centra il gruppo (testata o albero) più stretto rispetto all'altro.
  if (testataWidth > 0 && alberoWidth > 0) {
    if (testataWidth > alberoWidth) {
      const scarto = (testataWidth - alberoWidth) / 2;
      nodiAlbero.forEach((n) => {
        n.x = (n.x ?? 0) + scarto;
      });
    } else if (alberoWidth > testataWidth) {
      const scarto = (alberoWidth - testataWidth) / 2;
      radiciTestata.forEach((n) => {
        n.x = (n.x ?? 0) + scarto;
      });
    }
  }

  // Se una casella laterale sinistra esce dal bordo, trasla l'intero
  // disegno per non tagliarla.
  const minX = Math.min(0, ...allNodes.map((n) => n.x ?? 0));
  if (minX < 0) {
    for (const node of allNodes) node.x = (node.x ?? 0) - minX;
  }

  const maxX = Math.max(...allNodes.map((n) => (n.x ?? 0) + (n.width ?? BOX_WIDTH)));
  const width = Math.max(maxX, testataWidth, alberoWidth, BOX_WIDTH);
  const height = offsetAlbero + cumY - V_GAP;

  const livelli = [...new Set(allNodes.map((n) => n.livello).filter((v): v is string => !!v))];

  return { allNodes, width, height, livelli };
}

function renderSvg(
  roots: OrgNode[],
  allNodes: OrgNode[],
  width: number,
  height: number,
  stile: StileOrganigramma,
  livelli: string[],
  banner: string[],
  loghi: LoghiOrganigramma,
): { svg: string; textOps: TextOp[] } {
  const textOps: TextOp[] = [];
  const haLoghi = !!(loghi.aziendale || loghi.software || loghi.cliente);
  const offsetLoghi = haLoghi ? LOGO_STRIP_ALTEZZA : 0;
  const offsetLegenda = livelli.length > 0 ? LEGENDA_ALTEZZA + 10 : 0;
  const offsetTop = offsetLoghi + offsetLegenda;
  const totalWidth = width + MARGIN * 2;
  const totalHeightAlbero = height + MARGIN * 2 + offsetTop;
  const bannerHeight = banner.length > 0 ? banner.length * 42 : 0;
  const totalHeight = totalHeightAlbero + bannerHeight;

  const colorePerLivello = new Map(livelli.map((l, i) => [l, LEGENDA_PALETTE[i % LEGENDA_PALETTE.length]]));

  // Connettori "a bus" ortogonali (verticale-orizzontale-verticale),
  // come negli organigrammi aziendali professionali: una singola linea
  // orizzontale a metà strada tra genitore e figli, invece di linee
  // diagonali indipendenti per ogni figlio che si incrociano quando i
  // rami sono larghi. Le caselle laterali si collegano invece con una
  // freccia orizzontale bidirezionale, come i rapporti diretti/di staff
  // negli organigrammi reali.
  const lines: string[] = [];
  function drawConnectors(node: OrgNode) {
    const figliNormali = node.children.filter((c) => !c.laterale);
    const figliLaterali = node.children.filter((c) => c.laterale);

    for (const laterale of figliLaterali) {
      const y = (node.y ?? 0) + (node.height ?? 0) / 2 + MARGIN + offsetTop;
      const xNodo = (node.x ?? 0) + (laterale.laterale === "sx" ? 0 : node.width ?? BOX_WIDTH) + MARGIN;
      const xLaterale =
        (laterale.x ?? 0) + (laterale.laterale === "sx" ? laterale.width ?? BOX_WIDTH : 0) + MARGIN;
      lines.push(
        `<line x1="${xNodo}" y1="${y}" x2="${xLaterale}" y2="${y}" stroke="${stile.connectorStroke}" stroke-width="1.6" marker-start="url(#freccia)" marker-end="url(#freccia)" />`,
      );
    }

    if (figliNormali.length === 0) return;

    const parentX = (node.x ?? 0) + (node.width ?? BOX_WIDTH) / 2 + MARGIN;
    const parentBottomY = (node.y ?? 0) + (node.height ?? 0) + MARGIN + offsetTop;
    const childTopY = (figliNormali[0].y ?? 0) + MARGIN + offsetTop;
    const busY = (parentBottomY + childTopY) / 2;

    const childXs = figliNormali.map((c) => (c.x ?? 0) + (c.width ?? BOX_WIDTH) / 2 + MARGIN);
    const busXMin = Math.min(parentX, ...childXs);
    const busXMax = Math.max(parentX, ...childXs);

    lines.push(`<line x1="${parentX}" y1="${parentBottomY}" x2="${parentX}" y2="${busY}" stroke="${stile.connectorStroke}" stroke-width="1.6" />`);
    if (figliNormali.length > 1) {
      lines.push(`<line x1="${busXMin}" y1="${busY}" x2="${busXMax}" y2="${busY}" stroke="${stile.connectorStroke}" stroke-width="1.6" />`);
    }
    for (const child of figliNormali) {
      const childX = (child.x ?? 0) + (child.width ?? BOX_WIDTH) / 2 + MARGIN;
      const childTop = (child.y ?? 0) + MARGIN + offsetTop;
      lines.push(`<line x1="${childX}" y1="${busY}" x2="${childX}" y2="${childTop}" stroke="${stile.connectorStroke}" stroke-width="1.6" />`);
    }

    node.children.forEach(drawConnectors);
  }
  roots.forEach(drawConnectors);

  const maxLivelloAlbero = allNodes.filter((n) => !n.laterale).reduce((max, n) => Math.max(max, n.level), 0);

  const boxes = allNodes.map((node) => {
    const x = (node.x ?? 0) + MARGIN;
    const y = (node.y ?? 0) + MARGIN + offsetTop;
    const w = node.width ?? BOX_WIDTH;
    const h = node.height ?? BOX_PADDING_V + LINE_HEIGHT;
    // Se il nodo ha un {LIVELLO:...} esplicito usa il colore dedicato di
    // quel livello (coerente con la legenda); altrimenti una sfumatura
    // più chiara ai livelli più profondi dà comunque una gerarchia
    // visiva di base, senza richiedere tag espliciti ovunque.
    const fill = node.livello
      ? colorePerLivello.get(node.livello)!
      : maxLivelloAlbero > 0
        ? schiarisci(stile.boxFill, (node.level / maxLivelloAlbero) * 0.35)
        : stile.boxFill;

    const haElenco = node.bulletItems.length > 0;
    if (haElenco) {
      textOps.push({ x: x + 10, y: y + BOX_PADDING_V, text: node.lines[0], anchor: "start", bold: true, fontSize: 11, color: "#1B2631" });
      node.lines.slice(1).forEach((riga, i) => {
        textOps.push({ x: x + 10, y: y + BOX_PADDING_V + LINE_HEIGHT * (i + 1) + 6, text: riga, anchor: "start", bold: false, fontSize: 11, color: "#1B2631" });
      });
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${stile.boxRadius}" fill="white" stroke="${fill}" stroke-width="1.6" filter="url(#ombra)" />`;
    }

    const startY = y + h / 2 - ((node.lines.length - 1) * LINE_HEIGHT) / 2;
    node.lines.forEach((riga, i) => {
      textOps.push({ x: x + w / 2, y: startY + i * LINE_HEIGHT, text: riga, anchor: "middle", bold: false, fontSize: 11.5, color: stile.fontColor });
    });

    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${stile.boxRadius}" fill="${fill}" stroke="${stile.boxStroke}" stroke-width="1.2" filter="url(#ombra)" />`;
  });

  // Legenda su un'unica riga orizzontale in alto: più semplice da
  // dimensionare correttamente di uno stack verticale (che in precedenza
  // usciva dal bordo superiore del disegno con più di un livello).
  let legendaX = MARGIN;
  const legendaY = MARGIN + offsetLoghi + LEGENDA_ALTEZZA / 2;
  const legenda = livelli
    .map((l) => {
      const cx = legendaX + 6;
      const cerchio = `<circle cx="${cx}" cy="${legendaY}" r="6" fill="${colorePerLivello.get(l)}" />`;
      textOps.push({ x: cx + 12, y: legendaY + 4, text: l, anchor: "start", bold: false, fontSize: 10.5, color: "#1B2631" });
      legendaX += 24 + l.length * 6.5 + 24;
      return cerchio;
    })
    .join("");

  // Loghi reali (aziendale a sinistra, del software al centro, del
  // cliente/stazione appaltante a destra) in una fascia dedicata in
  // cima allo schema — come nei progetti di riferimento, dove
  // l'organigramma porta sempre i loghi delle parti coinvolte.
  function renderLogo(
    logo: { base64: string; width: number; height: number } | undefined,
    ancora: "sx" | "centro" | "dx",
  ): string {
    if (!logo) return "";
    const scala = Math.min(1, LOGO_ALTEZZA_MAX / logo.height);
    const w = logo.width * scala;
    const h = logo.height * scala;
    const y = MARGIN + (LOGO_STRIP_ALTEZZA - h) / 2;
    const x = ancora === "sx" ? MARGIN : ancora === "dx" ? totalWidth - MARGIN - w : (totalWidth - w) / 2;
    return `<image href="data:image/png;base64,${logo.base64}" x="${x}" y="${y}" width="${w}" height="${h}" />`;
  }
  const loghiSvg = haLoghi
    ? renderLogo(loghi.aziendale, "sx") + renderLogo(loghi.software, "centro") + renderLogo(loghi.cliente, "dx")
    : "";

  const bannerSvg = banner
    .map((testoBanner, i) => {
      const y = totalHeightAlbero + i * 42;
      const righeBanner = wrapText(testoBanner, Math.floor((width - 20) / 6), 2);
      righeBanner.forEach((r, j) => {
        textOps.push({ x: totalWidth / 2, y: y + 20 + j * 14, text: r, anchor: "middle", bold: false, fontSize: 10.5, color: "#FFFFFF" });
      });
      return `<rect x="${MARGIN}" y="${y + 4}" width="${width}" height="34" rx="6" fill="${stile.boxStroke}" filter="url(#ombra)" />`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
    <defs>
      <filter id="ombra" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1.8" flood-color="#000000" flood-opacity="0.22" />
      </filter>
      <marker id="freccia" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" fill="${stile.connectorStroke}" />
      </marker>
    </defs>
    <rect width="100%" height="100%" fill="white" />
    ${loghiSvg}
    ${legenda}
    ${lines.join("\n")}
    ${boxes.join("\n")}
    ${bannerSvg}
  </svg>`;
  return { svg, textOps };
}

// Genera un organigramma come immagine PNG a partire da un elenco a
// rientri con estensioni oltre alla semplice etichetta: "{LIVELLO:Nome}"
// per assegnare un nodo a una categoria con legenda colorata, "• voce"
// per un elenco puntato dentro la casella del genitore, "< "/"> " per
// caselle laterali collegate con freccia bidirezionale, e un blocco
// "[BANNER]testo[/BANNER]" per una fascia colorata a piena larghezza in
// fondo — come negli organigrammi aziendali reali (loghi/legenda esclusi
// in questa versione: vedi org-chart-style.ts per i colori, ricavati
// osservando organigrammi reali della knowledge base). Connettori "a
// bus" ortogonali, testo sempre a capo (mai troncato a metà parola).
export async function generateOrgChartPng(
  testoGerarchia: string,
  stile: StileOrganigramma = STILE_DEFAULT,
  loghi: LoghiOrganigramma = {},
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const banner: string[] = [];
  BANNER_REGEX.lastIndex = 0;
  const testoSenzaBanner = testoGerarchia.replace(BANNER_REGEX, (_intero, contenuto: string) => {
    banner.push(contenuto.trim());
    return "";
  });

  const roots = parseHierarchy(testoSenzaBanner);
  const { allNodes, width, height, livelli } = layout(roots);
  const { svg, textOps } = renderSvg(roots, allNodes, width, height, stile, livelli, banner, loghi);

  const offsetLoghi = loghi.aziendale || loghi.software || loghi.cliente ? LOGO_STRIP_ALTEZZA : 0;
  const offsetLegenda = livelli.length > 0 ? LEGENDA_ALTEZZA + 10 : 0;
  const bannerHeight = banner.length > 0 ? banner.length * 42 : 0;
  const totalWidth = width + MARGIN * 2;
  const totalHeight = height + MARGIN * 2 + offsetLoghi + offsetLegenda + bannerHeight;

  const basePng = await sharp(Buffer.from(svg)).png().toBuffer();

  // Il testo è disegnato qui, non nell'SVG sopra (vedi il commento in testa
  // al file sul perché) — un canvas trasparente delle stesse dimensioni
  // dell'immagine, con ogni operazione di testo raccolta da renderSvg nelle
  // stesse coordinate che avrebbe avuto come <text> SVG, poi sovrapposto
  // all'immagine delle sole forme con un unico composite.
  assicuraFontRegistrato();
  const canvasTesto = createCanvas(Math.round(totalWidth), Math.round(totalHeight));
  const ctx = canvasTesto.getContext("2d");
  for (const op of textOps) {
    ctx.font = `${op.bold ? "bold " : ""}${op.fontSize}px "${NOME_FONT_ORGANIGRAMMA}"`;
    ctx.fillStyle = op.color;
    ctx.textAlign = op.anchor === "middle" ? "center" : "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(op.text, op.x, op.y);
  }
  const buffer = textOps.length > 0 ? await sharp(basePng).composite([{ input: canvasTesto.toBuffer("image/png") }]).png().toBuffer() : basePng;

  // Riscala per l'inserimento nel documento Word (max ~600px di larghezza).
  const maxDisplayWidth = 600;
  const scale = totalWidth > maxDisplayWidth ? maxDisplayWidth / totalWidth : 1;

  return {
    buffer,
    width: Math.round(totalWidth * scale),
    height: Math.round(totalHeight * scale),
  };
}
