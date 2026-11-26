// SATER (Fase 2): lettura degli elenchi del portale Intercent-ER (API REST di Plone). Solo rete: nessun database. Regole di lettura in
// sessione-fonte.ts (le stesse di PVL, Sintel e SardegnaCAT: tetto, pausa, sospensione su 401/403/429 e su formato inatteso); formato e
// campi in intercenter-calcoli.ts.
//
// Un giro = una richiesta per cartella (3), più le pagine seguenti SOLO se il portale le indica («batching.next», stesso indirizzo) e finché
// non si raggiunge «items_total». Se il canale non è confermato (CANALE_INTERCENTER.confermato) o manca anche un solo percorso, il lettore
// si ferma PRIMA di qualunque richiesta: nessuna lettura parziale.
import { ErroreFonte, SessioneFonte } from "./sessione-fonte";
import {
  CANALE_INTERCENTER,
  PAGINE_MASSIME_INTERCENTER,
  leggiElencoIntercenter,
  paginaSeguenteIntercenter,
  urlCartellaIntercenter,
  type CartellaIntercenter,
  type ElementoIntercenter,
} from "./intercenter-calcoli";

const sembraJson = (testo: string) => /^\s*\{/.test(testo);

export type CartellaLetta = { cartella: CartellaIntercenter; elementi: ElementoIntercenter[]; totaleDichiarato: number | null; pagine: number };

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
      const elementi: ElementoIntercenter[] = [];
      let totale: number | null = null;
      let pagine = 0;
      let indirizzo: string | null = url as string;
      while (indirizzo && pagine < PAGINE_MASSIME_INTERCENTER) {
        const r = await this.sessione.leggi(indirizzo, { accetta: "application/json", formatoAtteso: sembraJson, descrizioneFormato: "un elenco JSON del portale" });
        const elenco = leggiElencoIntercenter(r.testo);
        if ("errore" in elenco) throw new ErroreFonte(`${this.sessione.nome}: ${elenco.errore} (cartella «${cartella.nome}»): connettore sospeso finché non si verifica`, 200, true);
        elementi.push(...elenco.elementi);
        totale = elenco.totaleDichiarato ?? totale;
        byte += r.testo.length;
        pagine++;
        // pagina seguente solo se mancano voci rispetto a items_total e il portale indica una pagina dello STESSO indirizzo
        indirizzo = totale !== null && elementi.length < totale && elenco.elementi.length > 0 ? paginaSeguenteIntercenter(url as string, elenco.prossima) : null;
      }
      cartelle.push({ cartella, elementi, totaleDichiarato: totale, pagine });
    }
    return { cartelle, byte };
  }
}
