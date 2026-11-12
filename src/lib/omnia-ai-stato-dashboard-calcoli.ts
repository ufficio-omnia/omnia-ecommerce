// Ritmo del controllo periodico della dashboard di OMNIA AI (spia del marchio + contatore della campanella).
// Logica pura, senza React né DOM: orologio, timer e visibilità della scheda arrivano da fuori, così
// scripts/verifica-stato-dashboard-omnia-ai.ts la prova con un orologio finto.
//
// Prima: due timer separati ogni 6 secondi, anche a scheda nascosta (due azioni del server ogni 6 s, ognuna con il suo
// controllo della sessione su Supabase Auth). Ora:
//   - un solo controllo, che porta insieme i due stati;
//   - ogni 30 secondi di norma, ogni 10 secondi solo mentre una gara del cliente è in elaborazione;
//   - a scheda nascosta nessun controllo; quando torna visibile ne parte subito uno (se l'ultimo ha almeno 5 secondi);
//   - mai due controlli sovrapposti: il successivo si programma solo dopo la risposta del precedente (setTimeout a
//     catena, non setInterval), e un controllo già in corso non se ne vede affiancare un altro;
//   - fermato (smontaggio del componente) = nessun timer resta vivo e nessuna risposta tardiva ne programma un altro.

export const INTERVALLO_ORDINARIO_MS = 30_000;
export const INTERVALLO_ELABORAZIONE_MS = 10_000;
export const INTERVALLO_MINIMO_RIPRESA_MS = 5_000;

export function prossimoIntervallo(inCorso: boolean): number {
  return inCorso ? INTERVALLO_ELABORAZIONE_MS : INTERVALLO_ORDINARIO_MS;
}

export type AmbientePoller<T> = {
  adesso: () => number;
  programma: (fn: () => void, ms: number) => T;
  annulla: (id: T) => void;
  visibile: () => boolean;
};

// controlla: il controllo vero. Restituisce se c'è un'elaborazione in corso (decide il ritmo), oppure null se l'esito
// non va usato (componente smontato): in quel caso vale l'ultimo ritmo noto. Un errore si ignora come un null.
export type PollerStato = {
  avvia: () => void;
  alCambioVisibilita: () => void;
  ferma: () => void;
};

export function creaPollerStato<T>(controlla: () => Promise<{ inCorso: boolean } | null>, ambiente: AmbientePoller<T>): PollerStato {
  let timer: T | null = null;
  let inVolo = false;
  let fermato = false;
  let ultimoControllo = Number.NEGATIVE_INFINITY;
  let ultimoInCorso = false;

  const annullaTimer = () => {
    if (timer !== null) {
      ambiente.annulla(timer);
      timer = null;
    }
  };

  const pianifica = (ms: number) => {
    annullaTimer();
    timer = ambiente.programma(() => {
      timer = null;
      void esegui();
    }, ms);
  };

  const esegui = async () => {
    if (fermato || inVolo || !ambiente.visibile()) return;
    annullaTimer();
    inVolo = true;
    ultimoControllo = ambiente.adesso();
    try {
      const esito = await controlla();
      if (esito) ultimoInCorso = esito.inCorso;
    } catch {
      // rete o server non raggiungibili: si riprova al prossimo giro, con il ritmo di prima
    } finally {
      inVolo = false;
    }
    if (!fermato && ambiente.visibile()) pianifica(prossimoIntervallo(ultimoInCorso));
  };

  return {
    avvia: () => {
      void esegui();
    },
    alCambioVisibilita: () => {
      if (fermato) return;
      if (!ambiente.visibile()) {
        annullaTimer();
        return;
      }
      if (inVolo || timer !== null) return;
      const trascorso = ambiente.adesso() - ultimoControllo;
      if (trascorso >= INTERVALLO_MINIMO_RIPRESA_MS) void esegui();
      else pianifica(INTERVALLO_MINIMO_RIPRESA_MS - trascorso);
    },
    ferma: () => {
      fermato = true;
      annullaTimer();
    },
  };
}
