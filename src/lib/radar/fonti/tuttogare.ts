// TuttoGare (Fase 2): lettura delle istanze dell'anagrafica. Solo rete: nessun database. Regole di lettura in sessione-fonte.ts (le stesse
// delle altre fonti: tetto, pausa, sospensione su 401/403/429 e su formato inatteso); formato, campi e anagrafica in tuttogare-calcoli.ts e
// tuttogare-istanze.ts.
//
// Un giro, per ogni istanza attiva: la home (o, SOLO se acceso, il JSON interno), poi i dettagli delle gare nuove, cambiate o da rileggere,
// entro il tetto dell'istanza e quello del giro (le altre ai giri seguenti). Prima di OGNI richiesta: canale confermato e indirizzo ammesso
// (home o dettaglio, mai documenti o allegati). Se il canale non è confermato il lettore si ferma PRIMA di qualunque richiesta.
import { ErroreFonte, type SessioneFonte } from "./sessione-fonte";
import {
  CANALE_TUTTOGARE,
  affidamentoNellaRiga,
  dettaglioCompleto,
  dettaglioDaLeggere,
  leggiDettaglioTuttoGare,
  leggiHomeTuttoGare,
  leggiTabellaTuttoGare,
  percorsoAmmessoTuttoGare,
  sembraPaginaTuttoGare,
  urlDettaglioTuttoGare,
  urlHomeTuttoGare,
  urlTabellaTuttoGare,
  type CursoreTuttoGare,
  type DettaglioTuttoGare,
  type RigaHomeTuttoGare,
} from "./tuttogare-calcoli";
import type { IstanzaTuttoGare } from "./tuttogare-istanze";

export type IstanzaTuttoGareLetta = {
  istanza: IstanzaTuttoGare;
  righe: RigaHomeTuttoGare[];
  dettagli: { codice: string; dettaglio: DettaglioTuttoGare }[];
  // affidamenti dichiarati dal badge della procedura nella scheda della home: il dettaglio non si legge
  esclusiDallaRiga: string[];
  // gare da leggere rimaste fuori dai tetti (si leggono al giro dopo)
  rimandati: number;
  // codici trattati in questo giro (dettaglio letto o esclusi dalla riga): entrano nel cursore con la riga di oggi
  trattati: Set<string>;
};

export type LetturaTuttoGare = { istanze: IstanzaTuttoGareLetta[]; errori: { host: string; messaggio: string }[]; rimandati: number };

const sembraJson = (testo: string) => /^\s*\{/.test(testo);

export class LettoreTuttoGare {
  constructor(readonly sessione: SessioneFonte) {}

  private restanti(): number {
    return this.sessione.limiti.richiesteMassime - this.sessione.richieste;
  }

  private async pagina(istanza: IstanzaTuttoGare, url: string, json = false): Promise<string> {
    // controllo esplicito prima della richiesta: mai un indirizzo fuori da home, dettaglio (e JSON interno se acceso) dell'istanza
    if (!percorsoAmmessoTuttoGare(url, istanza)) throw new ErroreFonte(`${this.sessione.nome}: indirizzo non ammesso per ${istanza.host}: nessuna lettura`, null, false);
    const r = await this.sessione.leggi(url, json ? { accetta: "application/json", formatoAtteso: sembraJson, descrizioneFormato: "la tabella JSON delle gare" } : { accetta: "text/html", formatoAtteso: sembraPaginaTuttoGare, descrizioneFormato: "una pagina TuttoGare" });
    // un reindirizzamento verso un altro host non si segue in silenzio: l'istanza non si legge (nessuna sospensione dell'intera fonte)
    let host = "";
    try {
      host = new URL(r.urlFinale).hostname.toLowerCase();
    } catch {
      host = "";
    }
    if (host !== istanza.host) throw new ErroreFonte(`${this.sessione.nome}: ${istanza.host} ha reindirizzato a un altro indirizzo: istanza non letta`, r.stato, false);
    return r.testo;
  }

  async leggiIstanze(istanze: readonly IstanzaTuttoGare[], cursore: CursoreTuttoGare, oggi: string): Promise<LetturaTuttoGare> {
    if (!CANALE_TUTTOGARE.confermato) throw new ErroreFonte(`${this.sessione.nome}: mappa dei campi non confermata su un campione: nessuna lettura`, null, false);
    const lette: IstanzaTuttoGareLetta[] = [];
    const errori: { host: string; messaggio: string }[] = [];
    let rimandati = 0;
    for (const istanza of istanze) {
      if (this.restanti() < 1) {
        errori.push({ host: istanza.host, messaggio: "tetto delle richieste del giro raggiunto prima dell'istanza" });
        continue;
      }
      try {
        let usate = 1;
        let righe: RigaHomeTuttoGare[];
        const tabella = CANALE_TUTTOGARE.canale === "json" ? urlTabellaTuttoGare(istanza) : null;
        if (tabella) {
          const t = leggiTabellaTuttoGare(await this.pagina(istanza, tabella, true), istanza);
          if ("errore" in t) throw new ErroreFonte(`${this.sessione.nome}: ${t.errore} (${istanza.host}): connettore sospeso finché non si verifica`, 200, true);
          righe = t.righe;
        } else righe = leggiHomeTuttoGare(await this.pagina(istanza, urlHomeTuttoGare(istanza)), istanza);
        const voci = cursore[istanza.host] ?? {};
        const letta: IstanzaTuttoGareLetta = { istanza, righe, dettagli: [], esclusiDallaRiga: [], rimandati: 0, trattati: new Set() };
        for (const riga of righe) {
          if (!dettaglioDaLeggere(riga, voci[riga.codice], oggi)) continue;
          if (affidamentoNellaRiga(riga)) {
            letta.esclusiDallaRiga.push(riga.codice);
            letta.trattati.add(riga.codice);
            continue;
          }
          const url = urlDettaglioTuttoGare(istanza, riga.codice);
          if (!url || usate >= istanza.richiesteMassime || this.restanti() < 1) {
            letta.rimandati++;
            continue;
          }
          usate++;
          letta.dettagli.push({ codice: riga.codice, dettaglio: leggiDettaglioTuttoGare(await this.pagina(istanza, url)) });
          letta.trattati.add(riga.codice);
        }
        // formato: se NESSUN dettaglio letto ha i campi obbligatori dichiarati, la mappa non è quella vera → sospensione, nessuna scrittura
        if (letta.dettagli.length > 0 && !letta.dettagli.some((x) => dettaglioCompleto(x.dettaglio))) {
          throw new ErroreFonte(`${this.sessione.nome}: ai dettagli di ${istanza.host} mancano i campi dichiarati (formato da confermare): connettore sospeso finché non si verifica`, 200, true);
        }
        rimandati += letta.rimandati;
        lette.push(letta);
      } catch (e) {
        // sospensione (401/403/429, formato inatteso) o interruzione: si ferma TUTTO il giro, come per le altre fonti; altri errori (rete,
        // 5xx, reindirizzamento): solo questa istanza non si legge
        if (e instanceof ErroreFonte && (e.sospendi || e.tetto || e.message === "Interrotta")) throw e;
        errori.push({ host: istanza.host, messaggio: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) });
      }
    }
    return { istanze: lette, errori, rimandati };
  }
}
