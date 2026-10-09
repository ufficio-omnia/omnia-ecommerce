import path from "path";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { LARGHEZZA_DISEGNO, type LayoutFigura, type Misura, type Prim } from "@/lib/figure-base";

// Disegno di un layout di figura su canvas Skia, con il font caricato
// ESPLICITAMENTE da file (i font di sistema non ci sono sul serverless: il
// testo uscirebbe come riquadri vuoti — vedi org-chart.ts). Tutto, forme e
// testo, sul canvas. Larghezza dell'immagine fissa a 2400 px.
//
// «Stesso carattere del documento»: si usa il font libero metricamente
// compatibile con quello del documento Word — Liberation Serif per Times New
// Roman, Carlito per Calibri, Liberation Sans per Arial e per tutto il resto
// (Cambria e gli altri serif ricadono su Liberation Serif).

export const LARGHEZZA_IMMAGINE_PX = 2400;
// Larghezza con cui l'immagine entra nel documento Word: 600 px a 96 dpi sono
// circa 16 cm, la larghezza utile A4.
export const LARGHEZZA_NEL_DOCUMENTO = 600;

export type FamigliaFont = "sans" | "serif" | "calibri";

export function famigliaPerDocumento(nomeFont: string | null | undefined): FamigliaFont {
  const n = (nomeFont ?? "").toLowerCase();
  if (/calibri|carlito/.test(n)) return "calibri";
  if (/times|liberation serif|georgia|garamond|palatino|cambria|book antiqua|serif/.test(n) && !/sans/.test(n)) return "serif";
  return "sans";
}

const NOMI_FAMIGLIA: Record<FamigliaFont, string> = { sans: "OmniaFigSans", serif: "OmniaFigSerif", calibri: "OmniaFigCalibri" };
const FILE_FAMIGLIA: Record<FamigliaFont, [string, string]> = {
  sans: ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"],
  serif: ["LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf"],
  calibri: ["Carlito-Regular.ttf", "Carlito-Bold.ttf"],
};
const registrate = new Set<FamigliaFont>();

export function assicuraFontFigure(famiglia: FamigliaFont): string {
  const nome = NOMI_FAMIGLIA[famiglia];
  if (registrate.has(famiglia)) return nome;
  const cartella = path.join(process.cwd(), "src", "assets", "fonts");
  for (const file of FILE_FAMIGLIA[famiglia]) GlobalFonts.registerFromPath(path.join(cartella, file), nome);
  registrate.add(famiglia);
  return nome;
}

export function creaMisura(famiglia: FamigliaFont): Misura {
  const nome = assicuraFontFigure(famiglia);
  const ctx = createCanvas(16, 16).getContext("2d");
  return (testo, size, bold) => {
    ctx.font = `${bold ? "bold " : ""}${size}px "${nome}"`;
    return ctx.measureText(testo).width;
  };
}

function rettangolo(ctx: SKRSContext2D, p: Extract<Prim, { t: "rect" }>) {
  ctx.beginPath();
  if (p.r && p.r > 0) ctx.roundRect(p.x, p.y, p.w, p.h, p.r);
  else ctx.rect(p.x, p.y, p.w, p.h);
}

function testaFreccia(ctx: SKRSContext2D, daX: number, daY: number, aX: number, aY: number, colore: string) {
  const angolo = Math.atan2(aY - daY, aX - daX);
  const lato = 6;
  ctx.fillStyle = colore;
  ctx.beginPath();
  ctx.moveTo(aX, aY);
  ctx.lineTo(aX - lato * Math.cos(angolo - 0.45), aY - lato * Math.sin(angolo - 0.45));
  ctx.lineTo(aX - lato * Math.cos(angolo + 0.45), aY - lato * Math.sin(angolo + 0.45));
  ctx.closePath();
  ctx.fill();
}

export type LogoPerDisegno = { base64: string; width: number; height: number };

export type ImmagineFigura = { buffer: Buffer; width: number; height: number; larghezzaPx: number; altezzaPx: number };

export async function disegnaLayout(
  layout: LayoutFigura,
  opzioni: { famiglia?: FamigliaFont; logoImpresa?: LogoPerDisegno; logoCommittente?: LogoPerDisegno } = {},
): Promise<ImmagineFigura> {
  const nomeFont = assicuraFontFigure(opzioni.famiglia ?? "sans");
  const scala = LARGHEZZA_IMMAGINE_PX / LARGHEZZA_DISEGNO;
  const larghezzaPx = LARGHEZZA_IMMAGINE_PX;
  const altezzaPx = Math.ceil(layout.altezza * scala);
  const canvas = createCanvas(larghezzaPx, altezzaPx);
  const ctx = canvas.getContext("2d");
  ctx.scale(scala, scala);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, LARGHEZZA_DISEGNO, layout.altezza);

  const immagini = new Map<string, Image>();
  if (opzioni.logoImpresa) immagini.set("impresa", await loadImage(Buffer.from(opzioni.logoImpresa.base64, "base64")));
  if (opzioni.logoCommittente) immagini.set("committente", await loadImage(Buffer.from(opzioni.logoCommittente.base64, "base64")));

  for (const p of layout.prims) {
    if (p.t === "rect") {
      rettangolo(ctx, p);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke && (p.sw ?? 1) > 0) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.sw ?? 1;
        ctx.setLineDash(p.dash ?? []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (p.t === "linea") {
      ctx.strokeStyle = p.colore;
      ctx.lineWidth = p.sw;
      ctx.lineJoin = "round";
      ctx.setLineDash(p.dash ?? []);
      ctx.beginPath();
      p.punti.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
      const n = p.punti.length;
      if (p.frecce && n >= 2) {
        testaFreccia(ctx, p.punti[n - 2][0], p.punti[n - 2][1], p.punti[n - 1][0], p.punti[n - 1][1], p.colore);
        if (p.frecce === "entrambe") testaFreccia(ctx, p.punti[1][0], p.punti[1][1], p.punti[0][0], p.punti[0][1], p.colore);
      }
    } else if (p.t === "poligono") {
      ctx.beginPath();
      p.punti.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = p.fill;
      ctx.fill();
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.sw ?? 1;
        ctx.stroke();
      }
    } else if (p.t === "cerchio") {
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.sw ?? 1;
        ctx.stroke();
      }
    } else if (p.t === "testo") {
      ctx.font = `${p.bold ? "bold " : ""}${p.size}px "${nomeFont}"`;
      ctx.fillStyle = p.colore;
      ctx.textAlign = p.ancora === "centro" ? "center" : p.ancora === "fine" ? "right" : "left";
      ctx.textBaseline = "middle";
      ctx.fillText(p.testo, p.x, p.y);
    } else if (p.t === "logo") {
      const img = immagini.get(p.id);
      if (img) ctx.drawImage(img, p.x, p.y, p.w, p.h);
    }
  }

  const buffer = canvas.toBuffer("image/png");
  return {
    buffer,
    width: LARGHEZZA_NEL_DOCUMENTO,
    height: Math.round((LARGHEZZA_NEL_DOCUMENTO * altezzaPx) / larghezzaPx),
    larghezzaPx,
    altezzaPx,
  };
}
