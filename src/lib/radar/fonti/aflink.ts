// Lettura del feed RSS dei bandi di un'istanza AF Soluzioni (fase B2-0: SardegnaCAT; Fase 2: più istanze). Solo rete: nessun database.
// Regole di lettura in sessione-fonte.ts (le stesse della PVL); formato e campi in aflink-calcoli.ts.
//
// Un giro = UNA lettura dell'indirizzo pubblicato (tutti gli elementi in corso, senza paginazione). I reindirizzamenti del portale si seguono
// come farebbe un lettore di feed; l'indirizzo non si modifica mai. Un'istanza senza indirizzo CONFERMATO (urlFeed null) non si legge:
// il lettore si ferma prima di qualunque richiesta.
import { ErroreFonte, SessioneFonte } from "./sessione-fonte";
import { ISTANZE_AFLINK, leggiFeedAflink, type FeedAflink, type IstanzaAflink } from "./aflink-calcoli";

const sembraXml = (testo: string) => /^\s*(<\?xml[^>]*>\s*)?<rss\b/i.test(testo);

export class LettoreAflink {
  constructor(
    readonly istanza: IstanzaAflink,
    readonly sessione: SessioneFonte,
  ) {}

  async leggiFeed(): Promise<FeedAflink & { byte: number }> {
    const urlFeed = ISTANZE_AFLINK[this.istanza].urlFeed;
    if (!urlFeed) throw new ErroreFonte(`${this.sessione.nome}: indirizzo del feed non confermato su una pagina ufficiale: nessuna lettura`, null, false);
    const r = await this.sessione.leggi(urlFeed, {
      accetta: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      formatoAtteso: sembraXml,
      descrizioneFormato: "un feed RSS",
    });
    const feed = leggiFeedAflink(r.testo, ISTANZE_AFLINK[this.istanza].campiObbligatori);
    if ("errore" in feed) throw new ErroreFonte(`${this.sessione.nome}: ${feed.errore}: connettore sospeso finché non si verifica`, 200, true);
    return { ...feed, byte: r.testo.length };
  }
}
