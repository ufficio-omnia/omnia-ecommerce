// Lettura via rete delle fonti aperte di Tender Intelligence (fase B2-0: Sintel e SardegnaCAT). Solo rete: nessun database.
//
// Le regole sono QUELLE DELLA PVL (fonti/pvl.ts, fase B1-bis), qui scritte una volta per le fonti nuove; in B2a la sessione della PVL
// passerà a questa classe senza cambiare comportamento, così resta un solo modo di leggere le fonti:
//   - una richiesta alla volta, con una pausa fissa tra due richieste e un tempo massimo per richiesta;
//   - un tetto di richieste per giro, mai superato (i nuovi tentativi contano come richieste);
//   - nuovi tentativi SOLO su errori temporanei (5xx, rete, tempo scaduto), distanziati;
//   - 401, 403 e 429 = la fonte non vuole essere letta così: il connettore si SOSPENDE subito, senza ripetere la richiesta;
//   - una risposta che non è nel formato atteso (per esempio una pagina di verifica «sei un robot?») = sospensione: blocchi, CAPTCHA e
//     protezioni non si aggirano mai;
//   - User-Agent: quello del giro (K9, user-agent.ts: con il contatto reale di RADAR_CONTATTO_FONTI, o il nome generico sullo staging);
//     nessun altro dato dell'azienda o delle persone nelle richieste, nessuna autenticazione, nessun cookie.

export const USER_AGENT_FONTI = "omnia-radar/1.0 (lettura avvisi pubblici)";

export type LimitiFonte = { pausaMs: number; timeoutMs: number; tentativi: number; richiesteMassime: number };

export class ErroreFonte extends Error {
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

export type RispostaFonte = { stato: number; testo: string; tipo: string; urlFinale: string };

const attendi = (ms: number, segnale?: AbortSignal) =>
  new Promise<void>((ok, ko) => {
    if (segnale?.aborted) return ko(new ErroreFonte("Interrotta", null, false));
    const t = setTimeout(ok, ms);
    segnale?.addEventListener("abort", () => {
      clearTimeout(t);
      ko(new ErroreFonte("Interrotta", null, false));
    });
  });

// Una sessione di lettura = un giro di UNA fonte: conta le richieste e rispetta pausa e tetto.
export class SessioneFonte {
  richieste = 0;
  byte = 0;
  ms = 0;
  readonly registro: RichiestaRegistrata[] = [];
  private ultima = 0;

  constructor(
    // nome della fonte nei messaggi («Sintel», «SardegnaCAT»)
    readonly nome: string,
    readonly limiti: LimitiFonte,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly segnale?: AbortSignal,
    // K9: lo User-Agent del giro (user-agent.ts); di base quello generico
    private readonly userAgent: string = USER_AGENT_FONTI,
    // Fase 2 (EmPULIA, SIAPS): un reindirizzamento seguito conta come una richiesta in più (budget in richieste HTTP). Di base no: le fonti
    // di prima contano come sempre
    private readonly contaReindirizzamenti = false,
  ) {}

  private async una(url: string, accetta: string): Promise<RispostaFonte> {
    if (this.richieste >= this.limiti.richiesteMassime) throw new ErroreFonte(`${this.nome}: tetto di ${this.limiti.richiesteMassime} richieste per giro raggiunto`, null, false, true);
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
      // i reindirizzamenti si seguono come farebbe un lettore di feed (l'indirizzo pubblicato non si cambia mai)
      const r = await this.fetchFn(url, { headers: { Accept: accetta, "User-Agent": this.userAgent }, signal: controllo.signal, cache: "no-store", redirect: "follow" });
      const testo = await r.text();
      if (this.contaReindirizzamenti && r.redirected) this.richieste++;
      const ms = Date.now() - inizio;
      this.byte += testo.length;
      this.ms += ms;
      this.registro.push({ quando: new Date(inizio).toISOString(), stato: r.status, ms, byte: testo.length });
      return { stato: r.status, testo, tipo: r.headers.get("content-type") ?? "", urlFinale: r.url || url };
    } catch (e) {
      const ms = Date.now() - inizio;
      this.ms += ms;
      this.registro.push({ quando: new Date(inizio).toISOString(), stato: null, ms, byte: 0 });
      if (this.segnale?.aborted) throw new ErroreFonte("Interrotta", null, false);
      throw new ErroreFonte(controllo.signal.aborted ? `${this.nome}: tempo massimo superato` : `${this.nome}: rete non raggiungibile (${e instanceof Error ? e.message.slice(0, 80) : "errore"})`, null, false);
    } finally {
      clearTimeout(timer);
      this.segnale?.removeEventListener("abort", sgancia);
    }
  }

  // Legge un indirizzo con le regole sopra. «formatoAtteso» dice se il testo ricevuto è davvero il formato della fonte (JSON, XML…):
  // se non lo è, la fonte si sospende (pagina di verifica, errore travestito, cambio di formato).
  async leggi(url: string, opzioni: { accetta: string; formatoAtteso: (testo: string, tipo: string) => boolean; descrizioneFormato: string }): Promise<RispostaFonte> {
    let ultimo: ErroreFonte | null = null;
    for (let tentativo = 1; tentativo <= this.limiti.tentativi; tentativo++) {
      let risposta: RispostaFonte;
      try {
        risposta = await this.una(url, opzioni.accetta);
      } catch (e) {
        if (e instanceof ErroreFonte && (e.tetto || e.message === "Interrotta")) throw e;
        ultimo = e instanceof ErroreFonte ? e : new ErroreFonte(`${this.nome}: lettura non riuscita`, null, false);
        if (tentativo < this.limiti.tentativi) await attendi(this.limiti.pausaMs * 2 * tentativo, this.segnale);
        continue;
      }
      const { stato, testo, tipo } = risposta;
      if (stato === 401 || stato === 403 || stato === 429) throw new ErroreFonte(`${this.nome} ha risposto ${stato}: connettore sospeso, nessun nuovo tentativo`, stato, true);
      if (stato >= 500) {
        ultimo = new ErroreFonte(`${this.nome} ha risposto ${stato}`, stato, false);
        if (tentativo < this.limiti.tentativi) await attendi(this.limiti.pausaMs * 2 * tentativo, this.segnale);
        continue;
      }
      if (stato !== 200) throw new ErroreFonte(`${this.nome} ha risposto ${stato}`, stato, false);
      if (!opzioni.formatoAtteso(testo, tipo)) throw new ErroreFonte(`${this.nome} ha risposto con qualcosa che non è ${opzioni.descrizioneFormato} (possibile verifica anti-robot o cambio di formato): connettore sospeso`, 200, true);
      return risposta;
    }
    throw ultimo ?? new ErroreFonte(`${this.nome}: lettura non riuscita`, null, false);
  }
}

// Limiti scritti nel codice e controllati: valori fuori dagli intervalli tornano ai predefiniti (stessa regola della PVL).
export function limitiValidi(parziali: Partial<Record<keyof LimitiFonte, unknown>> | null | undefined, predefiniti: LimitiFonte, intervalli: Record<keyof LimitiFonte, { min: number; max: number }>): LimitiFonte {
  const out = { ...predefiniti };
  for (const k of Object.keys(predefiniti) as (keyof LimitiFonte)[]) {
    const v = Number(parziali?.[k]);
    if (Number.isInteger(v) && v >= intervalli[k].min && v <= intervalli[k].max) out[k] = v;
  }
  return out;
}
