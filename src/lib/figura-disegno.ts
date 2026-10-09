import { creaMisura, disegnaLayout, famigliaPerDocumento, type ImmagineFigura } from "@/lib/figure-disegno";
import { calcolaLayoutFigura } from "@/lib/figure-layout";
import type { DatiFigura } from "@/lib/figure-dati";

// Disegno di una figura (archetipo) come immagine PNG larga 2400 px, con il
// carattere libero compatibile con quello del documento.
export async function disegnaFigura(dati: DatiFigura, opzioni: { font?: string | null } = {}): Promise<ImmagineFigura> {
  const famiglia = famigliaPerDocumento(opzioni.font);
  const misura = creaMisura(famiglia);
  const layout = calcolaLayoutFigura(dati, { misura });
  return disegnaLayout(layout, { famiglia });
}
