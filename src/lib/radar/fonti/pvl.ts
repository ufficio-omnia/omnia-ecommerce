// Lettura delle pagine della ricerca avanzata della PVL di ANAC (fase B1-bis, SOLO STAGING). Solo rete: nessun database.
//
// Uso corretto della fonte (nessuna condizione d'uso pubblicata; richiesta del titolare del 16/11/2026):
//   - una richiesta alla volta, con una pausa fissa tra due richieste e un tempo massimo per richiesta (limiti in pvl-calcoli.ts);
//   - un tetto di richieste per giro, mai superato (i nuovi tentativi contano come richieste);
//   - nuovi tentativi SOLO su errori temporanei (5xx, rete, tempo scaduto), distanziati;
//   - 401, 403 e 429 = la fonte non vuole essere letta così: il connettore si SOSPENDE subito, senza ripetere la richiesta;
//   - una risposta che non è il JSON atteso (per esempio una pagina di verifica «sei un robot?») = sospensione: blocchi, CAPTCHA e
//     protezioni non si aggirano mai;
//   - nome generico del programma, nessun dato dell'azienda o delle persone nelle richieste, nessuna autenticazione.
import { PERCORSO_RICERCA_PVL, URL_PVL, USER_AGENT_PVL, leggiPaginaGrezza, parametriRicercaPvl, type LimitiPvl, type PaginaPvlGrezza } from "./pvl-calcoli";

export class ErrorePvl extends Error {
  constructor(
    messaggio: string,
    readonly stato: number | null,
    // la fonte va sospesa (serve un'azione dell'amministratore per riaccenderla)
    readonly sospendi: boolean,
    // il tetto di richieste del giro è finito: non è un errore della fonte, il giro riprende al prossimo avvio
    readonly tetto = false,
  ) {
    super(messaggio);
  }
}

export type RichiestaRegistrata = { quando: string; stato: number | null; ms: number; byte: number };

const attendi = (ms: number, segnale?: AbortSignal) =>
  new Promise<void>((ok, ko) => {
    if (segnale?.aborted) return ko(new ErrorePvl("Interrotta", null, false));
    const t = setTimeout(ok, ms);
    segnale?.addEventListener("abort", () => {
      clearTimeout(t);
      ko(new ErrorePvl("Interrotta", null, false));
    });
  });

// Una sessione di lettura = un giro: conta le richieste e rispetta pausa e tetto.
export class SessionePvl {
  richieste = 0;
  byte = 0;
  ms = 0;
  readonly registro: RichiestaRegistrata[] = [];
  private ultima = 0;

  constructor(
    readonly limiti: LimitiPvl,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly segnale?: AbortSignal,
  ) {}

  private async una(url: string): Promise<{ stato: number; testo: string; tipo: string }> {
    if (this.richieste >= this.limiti.richiesteMassime) throw new ErrorePvl(`Tetto di ${this.limiti.richiesteMassime} richieste per giro raggiunto`, null, false, true);
    const attesa = this.ultima + this.limiti.pausaMs - Date.now();
    if (attesa > 0) await attendi(attesa, this.segnale);
    this.ultima = Date.now();
    this.richieste++;
    const inizio = Date.now();
    const controllo = new AbortController();
    const timer = setTimeout(() => controllo.abort(), this.limiti.timeoutMs);
    const sgancia = () => controllo.abort();
    this.segnale?.addEventListener("abort", sgancia);
    try {
      const r = await this.fetchFn(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT_PVL }, signal: controllo.signal, cache: "no-store" });
      const testo = await r.text();
      const ms = Date.now() - inizio;
      this.byte += testo.length;
      this.ms += ms;
      this.registro.push({ quando: new Date(inizio).toISOString(), stato: r.status, ms, byte: testo.length });
      return { stato: r.status, testo, tipo: r.headers.get("content-type") ?? "" };
    } catch (e) {
      const ms = Date.now() - inizio;
      this.ms += ms;
      this.registro.push({ quando: new Date(inizio).toISOString(), stato: null, ms, byte: 0 });
      if (this.segnale?.aborted) throw new ErrorePvl("Interrotta", null, false);
      throw new ErrorePvl(controllo.signal.aborted ? "PVL: tempo massimo superato" : `PVL: rete non raggiungibile (${e instanceof Error ? e.message.slice(0, 80) : "errore"})`, null, false);
    } finally {
      clearTimeout(timer);
      this.segnale?.removeEventListener("abort", sgancia);
    }
  }

  async leggiPagina(p: { da: string; a: string; cpv: readonly string[]; token: string | null }): Promise<PaginaPvlGrezza> {
    const url = `${URL_PVL}${PERCORSO_RICERCA_PVL}?${new URLSearchParams(parametriRicercaPvl({ ...p, avvisiPerPagina: this.limiti.avvisiPerPagina }))}`;
    let ultimo: ErrorePvl | null = null;
    for (let tentativo = 1; tentativo <= this.limiti.tentativi; tentativo++) {
      let risposta: { stato: number; testo: string; tipo: string };
      try {
        risposta = await this.una(url);
      } catch (e) {
        if (e instanceof ErrorePvl && (e.tetto || e.message === "Interrotta")) throw e;
        ultimo = e instanceof ErrorePvl ? e : new ErrorePvl("PVL: lettura non riuscita", null, false);
        if (tentativo < this.limiti.tentativi) await attendi(this.limiti.pausaMs * 2 * tentativo, this.segnale);
        continue;
      }
      const { stato, testo, tipo } = risposta;
      if (stato === 401 || stato === 403 || stato === 429) throw new ErrorePvl(`La PVL ha risposto ${stato}: connettore sospeso, nessun nuovo tentativo`, stato, true);
      if (stato >= 500) {
        ultimo = new ErrorePvl(`La PVL ha risposto ${stato}`, stato, false);
        if (tentativo < this.limiti.tentativi) await attendi(this.limiti.pausaMs * 2 * tentativo, this.segnale);
        continue;
      }
      if (stato !== 200) throw new ErrorePvl(`La PVL ha risposto ${stato}`, stato, false);
      if (!/json/i.test(tipo) && !/^\s*[{[]/.test(testo)) throw new ErrorePvl("La PVL ha risposto con una pagina invece dei dati (possibile verifica anti-robot): connettore sospeso", 200, true);
      let j: unknown;
      try {
        j = JSON.parse(testo);
      } catch {
        throw new ErrorePvl("La PVL ha risposto con dati illeggibili: connettore sospeso", 200, true);
      }
      const pagina = leggiPaginaGrezza(j);
      // per la diagnosi si conservano solo i NOMI dei campi di primo livello, mai i valori
      const chiavi = j && typeof j === "object" && !Array.isArray(j) ? Object.keys(j as object).slice(0, 10).join(", ") : Array.isArray(j) ? "elenco" : typeof j;
      if (!pagina) throw new ErrorePvl(`La struttura della risposta della PVL è cambiata (campi: ${chiavi}): connettore sospeso finché non si verifica`, 200, true);
      return pagina;
    }
    throw ultimo ?? new ErrorePvl("PVL: lettura non riuscita", null, false);
  }
}
