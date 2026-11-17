// Lettura dei dati aperti di Sintel via rete (fase B2-0). Solo rete: nessun database. Regole di lettura in sessione-fonte.ts (le stesse
// della PVL); formato e colonne in sintel-calcoli.ts.
//
// Un giro normale: 1 richiesta ai metadati (data dell'ultimo caricamento: se è quella già letta, il giro finisce lì) + 1 richiesta di dati
// (circa 900 righe con scadenza futura, tutte le categorie: la classificazione per settore si fa qui, non nella richiesta).
import { SessioneFonte, ErroreFonte } from "./sessione-fonte";
import { RIGHE_PER_PAGINA_SINTEL, URL_DATI_SINTEL, URL_METADATI_SINTEL, dataAggiornamentoSintel, parametriSintel, righeSintelValide, type RigaSintel } from "./sintel-calcoli";

const sembraJson = (testo: string, tipo: string) => /json/i.test(tipo) || /^\s*[{[]/.test(testo);

function analizza(testo: string, nome: string): unknown {
  try {
    return JSON.parse(testo);
  } catch {
    throw new ErroreFonte(`${nome} ha risposto con dati illeggibili: connettore sospeso`, 200, true);
  }
}

export class LettoreSintel {
  constructor(readonly sessione: SessioneFonte) {}

  // Data dell'ultimo caricamento del dataset (ISO), oppure null se i metadati non la indicano (si leggono comunque i dati).
  async dataAggiornamento(): Promise<string | null> {
    const r = await this.sessione.leggi(URL_METADATI_SINTEL, { accetta: "application/json", formatoAtteso: sembraJson, descrizioneFormato: "il JSON dei metadati" });
    return dataAggiornamentoSintel(analizza(r.testo, this.sessione.nome));
  }

  // Tutte le righe con scadenza da «daGiorno» in poi, a pagine; si ferma alla prima pagina corta o al numero massimo di pagine.
  async leggiDaGiorno(daGiorno: string, pagineMassime: number): Promise<{ righe: RigaSintel[]; completo: boolean }> {
    const righe: RigaSintel[] = [];
    for (let pagina = 0; pagina < pagineMassime; pagina++) {
      const parametri = parametriSintel({ daGiorno, limite: RIGHE_PER_PAGINA_SINTEL, offset: pagina * RIGHE_PER_PAGINA_SINTEL });
      const r = await this.sessione.leggi(`${URL_DATI_SINTEL}?${new URLSearchParams(parametri)}`, { accetta: "application/json", formatoAtteso: sembraJson, descrizioneFormato: "il JSON delle righe" });
      const esito = righeSintelValide(analizza(r.testo, this.sessione.nome));
      if ("errore" in esito) throw new ErroreFonte(`${this.sessione.nome}: ${esito.errore}: connettore sospeso finché non si verifica`, 200, true);
      righe.push(...esito.righe);
      if (esito.righe.length < RIGHE_PER_PAGINA_SINTEL) return { righe, completo: true };
    }
    return { righe, completo: false };
  }
}
