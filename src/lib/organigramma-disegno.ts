import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { assicuraFontRegistrato, NOME_FONT_ORGANIGRAMMA, type LoghiOrganigramma } from "@/lib/org-chart";
import { calcolaLayout, LARGHEZZA_DISEGNO, type Misura, type Prim } from "@/lib/organigramma-layout";
import type { DatiOrganigramma } from "@/lib/organigramma-dati";

// Disegno dell'organigramma strutturato: layout puro (organigramma-layout.ts)
// disegnato su un canvas Skia con il font caricato ESPLICITAMENTE da file
// (stesso motivo di org-chart.ts: i font di sistema non ci sono sul serverless
// e il testo uscirebbe come riquadri vuoti). Tutto — forme e testo — sul
// canvas, nessun SVG rasterizzato. Larghezza dell'immagine fissa a 2400 px.
//
// Font: Liberation Sans, l'unico caricato nel repository (compatibile per
// metriche con Arial). Il carattere del documento Word può essere diverso
// (es. Times New Roman): nessun font serif è incluso, quindi l'organigramma
// usa sempre questo.

export const LARGHEZZA_IMMAGINE_PX = 2400;
// Larghezza con cui l'immagine entra nel documento Word (come gli altri
// organigrammi): 600 px a 96 dpi sono circa 16 cm, la larghezza utile A4.
const LARGHEZZA_NEL_DOCUMENTO = 600;

function creaMisura(): Misura {
  assicuraFontRegistrato();
  const ctx = createCanvas(16, 16).getContext("2d");
  return (testo, size, bold) => {
    ctx.font = `${bold ? "bold " : ""}${size}px "${NOME_FONT_ORGANIGRAMMA}"`;
    return ctx.measureText(testo).width;
  };
}

function rettangoloArrotondato(ctx: SKRSContext2D, p: Extract<Prim, { t: "rect" }>) {
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

export async function disegnaOrganigramma(
  dati: DatiOrganigramma,
  loghi: LoghiOrganigramma = {},
): Promise<{ buffer: Buffer; width: number; height: number; larghezzaPx: number; altezzaPx: number }> {
  const misura = creaMisura();

  const loghiImpresa = loghi.aziendale;
  const loghiCommittente = loghi.cliente;
  const layout = calcolaLayout(dati, {
    misura,
    loghi: {
      ...(loghiImpresa ? { impresa: { w: loghiImpresa.width, h: loghiImpresa.height } } : {}),
      ...(loghiCommittente ? { committente: { w: loghiCommittente.width, h: loghiCommittente.height } } : {}),
    },
  });

  const scala = LARGHEZZA_IMMAGINE_PX / LARGHEZZA_DISEGNO;
  const larghezzaPx = LARGHEZZA_IMMAGINE_PX;
  const altezzaPx = Math.ceil(layout.altezza * scala);
  const canvas = createCanvas(larghezzaPx, altezzaPx);
  const ctx = canvas.getContext("2d");
  ctx.scale(scala, scala);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, LARGHEZZA_DISEGNO, layout.altezza);

  const immagini = new Map<string, Image>();
  if (loghiImpresa) immagini.set("impresa", await loadImage(Buffer.from(loghiImpresa.base64, "base64")));
  if (loghiCommittente) immagini.set("committente", await loadImage(Buffer.from(loghiCommittente.base64, "base64")));

  for (const p of layout.prims) {
    if (p.t === "rect") {
      rettangoloArrotondato(ctx, p);
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
      if (p.frecce === "entrambe" && p.punti.length >= 2) {
        const n = p.punti.length;
        testaFreccia(ctx, p.punti[1][0], p.punti[1][1], p.punti[0][0], p.punti[0][1], p.colore);
        testaFreccia(ctx, p.punti[n - 2][0], p.punti[n - 2][1], p.punti[n - 1][0], p.punti[n - 1][1], p.colore);
      }
    } else if (p.t === "testo") {
      ctx.font = `${p.bold ? "bold " : ""}${p.size}px "${NOME_FONT_ORGANIGRAMMA}"`;
      ctx.fillStyle = p.colore;
      ctx.textAlign = p.ancora === "centro" ? "center" : "left";
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
