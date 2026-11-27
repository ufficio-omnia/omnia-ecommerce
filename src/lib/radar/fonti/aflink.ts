// Lettura del feed RSS dei bandi di un'istanza AF Soluzioni (fase B2-0: SardegnaCAT; Fase 2: più istanze). Solo rete: nessun database.
// Regole di lettura in sessione-fonte.ts (le stesse della PVL); formato e campi in aflink-calcoli.ts.
//
// Un giro = UNA lettura dell'indirizzo pubblicato (tutti gli elementi in corso, senza paginazione). I reindirizzamenti del portale si seguono
// come farebbe un lettore di feed; l'indirizzo non si modifica mai. Un'istanza senza indirizzo CONFERMATO (urlFeed null) non si legge:
// il lettore si ferma prima di qualunque richiesta.
// Fase 2 (EmPULIA): le istanze con «paginazione» scorrono le pagine dell'indirizzo pubblicato cambiando SOLO il numero di pagina
// (urlPaginaAflink), fino al totRecord ed entro pagineMassime; poi leggono i «feedAggiuntivi» pubblicati (consultazioni). Gli elementi si
// uniscono per IdMsg. Una pagina che ripete solo elementi già visti, o un totale non raggiunto, rendono la lettura NON completa (allarme).
// SardegnaCAT e SATER non dichiarano né pagine né feed aggiuntivi: leggono come prima.
import { ErroreFonte, SessioneFonte } from "./sessione-fonte";
import { ISTANZE_AFLINK, leggiFeedAflink, urlPaginaAflink, type ElementoAflink, type FeedAflink, type IstanzaAflink } from "./aflink-calcoli";

const sembraXml = (testo: string) => /^\s*(<\?xml[^>]*>\s*)?<rss\b/i.test(testo);

export class LettoreAflink {
  constructor(
    readonly istanza: IstanzaAflink,
    readonly sessione: SessioneFonte,
  ) {}

  private async leggiUno(url: string): Promise<FeedAflink & { byte: number }> {
    const r = await this.sessione.leggi(url, {
      accetta: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      formatoAtteso: sembraXml,
      descrizioneFormato: "un feed RSS",
    });
    const feed = leggiFeedAflink(r.testo, ISTANZE_AFLINK[this.istanza].campiObbligatori);
    if ("errore" in feed) throw new ErroreFonte(`${this.sessione.nome}: ${feed.errore}: connettore sospeso finché non si verifica`, 200, true);
    return { ...feed, byte: r.testo.length };
  }

  // completo: tutte le pagine dichiarate lette (sempre vero per le istanze senza paginazione); pagine: letture del feed principale
  async leggiFeed(): Promise<FeedAflink & { byte: number; completo: boolean; pagine: number }> {
    const desc = ISTANZE_AFLINK[this.istanza];
    const urlFeed = ISTANZE_AFLINK[this.istanza].urlFeed;
    if (!urlFeed) throw new ErroreFonte(`${this.sessione.nome}: indirizzo del feed non confermato su una pagina ufficiale: nessuna lettura`, null, false);
    const primo = await this.leggiUno(urlFeed);
    if (!desc.paginazione && !(desc.feedAggiuntivi ?? []).length) return { ...primo, completo: true, pagine: 1 };

    const elementi: ElementoAflink[] = [];
    const visti = new Set<string>();
    const aggiungi = (lista: readonly ElementoAflink[]) => {
      let nuovi = 0;
      for (const e of lista) {
        const id = (e.IdMsg ?? "").trim();
        if (id && visti.has(id)) continue;
        if (id) visti.add(id);
        elementi.push(e);
        nuovi++;
      }
      return nuovi;
    };
    aggiungi(primo.elementi);
    let byte = primo.byte;
    let pagine = 1;
    let completo = true;
    if (desc.paginazione) {
      const totale = primo.totaleDichiarato;
      const servono = totale === null ? 1 : Math.ceil(totale / desc.paginazione.perPagina);
      if (servono > desc.paginazione.pagineMassime) completo = false;
      for (let p = 2; p <= Math.min(servono, desc.paginazione.pagineMassime); p++) {
        const url = urlPaginaAflink(urlFeed, p);
        if (!url) {
          completo = false;
          break;
        }
        const pagina = await this.leggiUno(url);
        byte += pagina.byte;
        pagine++;
        if (pagina.elementi.length === 0) break;
        // una pagina con soli elementi già visti: il numero di pagina non è quello vero (nessun doppione, lettura non completa)
        if (aggiungi(pagina.elementi) === 0) {
          completo = false;
          break;
        }
      }
      if (totale !== null && visti.size < totale) completo = false;
    }
    for (const url of desc.feedAggiuntivi ?? []) {
      const altro = await this.leggiUno(url);
      byte += altro.byte;
      aggiungi(altro.elementi);
    }
    return { elementi, totaleDichiarato: primo.totaleDichiarato, byte, completo, pagine };
  }
}
