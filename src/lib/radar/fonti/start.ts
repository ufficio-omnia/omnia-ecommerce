// START Toscana (Fase 2): lettura dell'elenco pubblico delle procedure aperte. Solo rete: nessun database. Regole di lettura in
// sessione-fonte.ts (le stesse delle altre fonti: tetto, pausa, sospensione su 401/403/429 e su formato inatteso); formato, campi, finestra e
// indirizzi ammessi in start-calcoli.ts.
//
// Un giro: le pagine dell'elenco una dopo l'altra, finché l'elenco finisce (totale dichiarato raggiunto o pagina corta), entro il tetto del
// giro. Prima di OGNI richiesta: struttura confermata, finestra del robots.txt aperta (in UTC) e indirizzo ammesso (solo l'elenco delle
// aperte; mai esiti, mai la scheda, mai start.e.toscana.it). Nessun dettaglio si legge: la scadenza arriva dalla PVL con l'unione per CIG.
// Una pagina che non si legge (rete, 5xx) ferma la lettura: le righe già lette si scrivono, ma il giro NON è completo (nessuna gara esce
// dalle aperte). Una sospensione (401/403/429, formato) ferma tutto il giro, come per le altre fonti.
import { ErroreFonte, type SessioneFonte } from "./sessione-fonte";
import {
  CANALE_START,
  HOST_START,
  dentroFinestraStart,
  elencoCompletoStart,
  giroAmmessoStart,
  leggiElencoStart,
  percorsoAmmessoStart,
  sembraPaginaStart,
  urlElencoStart,
  type ElencoStart,
  type RigaElencoStart,
} from "./start-calcoli";

export type LetturaStart = {
  righe: RigaElencoStart[];
  pagine: number;
  totaleDichiarato: number | null;
  formato: ElencoStart["formato"];
  // una pagina ha ripetuto solo numeri già visti: il parametro di pagina non è quello vero
  paginaRipetuta: boolean;
  // perché la lettura si è fermata prima della fine (pagina non letta, tetto, finestra chiusa); null se è arrivata in fondo
  interruzione: string | null;
  // tutte le pagine lette senza errori e l'elenco finito: SOLO allora le gare possono uscire dalle aperte
  completo: boolean;
};

export class LettoreStart {
  constructor(
    readonly sessione: SessioneFonte,
    private readonly ora: () => Date = () => new Date(),
  ) {}

  private async pagina(url: string): Promise<string> {
    // controllo esplicito prima della richiesta: solo l'elenco delle aperte, solo dentro la finestra del robots.txt
    if (!percorsoAmmessoStart(url)) throw new ErroreFonte(`${this.sessione.nome}: indirizzo non ammesso: nessuna lettura`, null, false);
    if (!dentroFinestraStart(this.ora())) throw new ErroreFonte(`${this.sessione.nome}: la finestra di lettura del robots.txt (23:00–04:00 UTC) si è chiusa: lettura fermata`, null, false);
    const r = await this.sessione.leggi(url, { accetta: "text/html", formatoAtteso: sembraPaginaStart, descrizioneFormato: "una pagina dell'elenco di START" });
    // un reindirizzamento fuori dall'elenco (accesso, altra pagina, altro host) non si segue in silenzio: la fonte si sospende
    let finale = "";
    try {
      finale = new URL(r.urlFinale).toString();
    } catch {
      finale = "";
    }
    if (finale && finale !== url && !percorsoAmmessoStart(finale)) {
      throw new ErroreFonte(`${this.sessione.nome}: l'elenco ha reindirizzato fuori da ${HOST_START}${CANALE_START.percorsoElenco}: connettore sospeso finché non si verifica`, r.stato, true);
    }
    return r.testo;
  }

  async leggiElenco(): Promise<LetturaStart> {
    if (!CANALE_START.confermato) throw new ErroreFonte(`${this.sessione.nome}: struttura dell'elenco non confermata sulle pagine vere: nessuna lettura`, null, false);
    if (!giroAmmessoStart(this.ora())) throw new ErroreFonte(`${this.sessione.nome}: fuori dalla finestra di lettura del robots.txt (23:00–04:00 UTC): nessuna lettura`, null, false);
    const righe: RigaElencoStart[] = [];
    const visti = new Set<string>();
    let pagine = 0;
    let totaleDichiarato: number | null = null;
    let formato: ElencoStart["formato"] = "nessuno";
    let paginaRipetuta = false;
    let ultimaPaginaRighe = 0;
    let interruzione: string | null = null;
    for (let n = 1; ; n++) {
      if (this.sessione.richieste >= this.sessione.limiti.richiesteMassime) {
        interruzione = `tetto di ${this.sessione.limiti.richiesteMassime} richieste raggiunto alla pagina ${n}`;
        break;
      }
      const url = urlElencoStart(n);
      if (!url) {
        interruzione = `pagina ${n} oltre il massimo`;
        break;
      }
      let elenco: ElencoStart;
      try {
        elenco = leggiElencoStart(await this.pagina(url));
      } catch (e) {
        // sospensione o interruzione: si ferma tutto il giro, come per le altre fonti; altro (rete, 5xx, finestra chiusa): lettura fermata,
        // giro non completo
        if (e instanceof ErroreFonte && (e.sospendi || e.message === "Interrotta")) throw e;
        interruzione = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
        break;
      }
      pagine++;
      if (n === 1) {
        totaleDichiarato = elenco.totaleDichiarato;
        formato = elenco.formato;
        // una prima pagina senza righe riconoscibili, con un elenco che non si dichiara vuoto: il formato non è quello atteso → sospensione
        if (elenco.righe.length === 0 && totaleDichiarato !== 0) {
          throw new ErroreFonte(`${this.sessione.nome}: nessuna procedura riconosciuta nella prima pagina dell'elenco (formato da confermare): connettore sospeso finché non si verifica`, 200, true);
        }
      }
      const nuove = elenco.righe.filter((r) => !visti.has(r.numero));
      if (elenco.righe.length > 0 && nuove.length === 0) {
        paginaRipetuta = true;
        break;
      }
      for (const r of nuove) {
        visti.add(r.numero);
        righe.push(r);
      }
      ultimaPaginaRighe = elenco.righe.length;
      if (totaleDichiarato !== null && visti.size >= totaleDichiarato) break;
      if (elenco.righe.length < CANALE_START.perPagina) break;
    }
    const completo = elencoCompletoStart({ pagine, numeri: visti.size, ultimaPaginaRighe, totaleDichiarato, paginaRipetuta, errore: interruzione !== null });
    return { righe, pagine, totaleDichiarato, formato, paginaRipetuta, interruzione, completo };
  }
}
