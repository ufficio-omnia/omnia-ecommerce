import type { LoghiOrganigramma } from "@/lib/org-chart";
import { calcolaLayout } from "@/lib/organigramma-layout";
import { creaMisura, disegnaLayout, famigliaPerDocumento, LARGHEZZA_IMMAGINE_PX, type ImmagineFigura } from "@/lib/figure-disegno";
import type { DatiOrganigramma } from "@/lib/organigramma-dati";

// Disegno dell'organigramma strutturato: layout puro (organigramma-layout.ts)
// disegnato su canvas con il motore comune delle figure (figure-disegno.ts:
// font caricato da file, immagine larga 2400 px, stesso carattere del
// documento Word fra Liberation Sans/Serif e Carlito).

export { LARGHEZZA_IMMAGINE_PX };

export async function disegnaOrganigramma(
  dati: DatiOrganigramma,
  loghi: LoghiOrganigramma = {},
  opzioni: { font?: string | null } = {},
): Promise<ImmagineFigura> {
  const famiglia = famigliaPerDocumento(opzioni.font);
  const misura = creaMisura(famiglia);
  const layout = calcolaLayout(dati, {
    misura,
    loghi: {
      ...(loghi.aziendale ? { impresa: { w: loghi.aziendale.width, h: loghi.aziendale.height } } : {}),
      ...(loghi.cliente ? { committente: { w: loghi.cliente.width, h: loghi.cliente.height } } : {}),
    },
  });
  return disegnaLayout(layout, { famiglia, logoImpresa: loghi.aziendale, logoCommittente: loghi.cliente });
}
