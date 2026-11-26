// SATER (Fase 2): lettura degli elenchi del portale Intercent-ER (API REST di Plone). Solo rete: nessun database. Regole di lettura in
// sessione-fonte.ts (le stesse di PVL, Sintel e SardegnaCAT: tetto, pausa, sospensione su 401/403/429 e su formato inatteso); formato e
// campi in intercenter-calcoli.ts.
//
// Un giro = UNA richiesta per cartella (3 in tutto). Finché il canale non è confermato (CANALE_INTERCENTER.confermato) o manca anche un solo
// percorso, il lettore si ferma PRIMA di qualunque richiesta: nessuna lettura parziale.
import { ErroreFonte, SessioneFonte } from "./sessione-fonte";
import { CANALE_INTERCENTER, leggiElencoIntercenter, urlCartellaIntercenter, type CartellaIntercenter, type ElementoIntercenter } from "./intercenter-calcoli";

const sembraJson = (testo: string) => /^\s*\{/.test(testo);

export type CartellaLetta = { cartella: CartellaIntercenter; elementi: ElementoIntercenter[]; totaleDichiarato: number | null };

export class LettoreIntercenter {
  constructor(readonly sessione: SessioneFonte) {}

  async leggiCartelle(): Promise<{ cartelle: CartellaLetta[]; byte: number }> {
    if (!CANALE_INTERCENTER.confermato) throw new ErroreFonte(`${this.sessione.nome}: canale del portale non confermato (indirizzi, licenza e nomi dei campi): nessuna lettura`, null, false);
    const indirizzi = CANALE_INTERCENTER.cartelle.map((c) => ({ cartella: c, url: urlCartellaIntercenter(c) }));
    const mancante = indirizzi.find((x) => !x.url);
    if (mancante) throw new ErroreFonte(`${this.sessione.nome}: percorso della cartella «${mancante.cartella.nome}» non confermato: nessuna lettura`, null, false);
    const cartelle: CartellaLetta[] = [];
    let byte = 0;
    for (const { cartella, url } of indirizzi) {
      const r = await this.sessione.leggi(url as string, { accetta: "application/json", formatoAtteso: sembraJson, descrizioneFormato: "un elenco JSON del portale" });
      const elenco = leggiElencoIntercenter(r.testo);
      if ("errore" in elenco) throw new ErroreFonte(`${this.sessione.nome}: ${elenco.errore} (cartella «${cartella.nome}»): connettore sospeso finché non si verifica`, 200, true);
      cartelle.push({ cartella, elementi: elenco.elementi, totaleDichiarato: elenco.totaleDichiarato });
      byte += r.testo.length;
    }
    return { cartelle, byte };
  }
}
