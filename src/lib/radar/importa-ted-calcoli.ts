// Avanzamento dell'importazione TED (cursore salvato in radar_fonti_stato.cursore). Logica pura, provata da scripts/verifica-radar-b1.ts.
//
// 1) RECUPERO dello storico (una volta): gli ultimi 90 giorni (D3 del 48C, coerente con la 48A; un parametro, al più 365), a finestre di 31 giorni, prima tutti i bandi poi tutti gli esiti. Il cursore
//    si salva dopo OGNI pagina (punto di ripresa): un'interruzione riparte dalla pagina successiva; i doppioni li scartano chiavi e impronte.
// 2) SINCRONIZZAZIONE quotidiana: dall'ultimo giorno letto meno 3 giorni (sovrapposizione: TED può indicizzare in ritardo) fino a oggi,
//    bandi poi esiti, tutte le pagine. Un giro interrotto riprende dal suo punto.

// Recupero iniziale di TED (K5): 90 giorni di base (D3 dell'utente, 23/11). Chi lancia il giro può chiedere altro, tra 1 e 365 giorni.
export const GIORNI_RECUPERO = 90;
export const GIORNI_RECUPERO_MASSIMI = 365;
export const giorniRecuperoValidi = (g: number | undefined): number => (g !== undefined && Number.isInteger(g) && g >= 1 && g <= GIORNI_RECUPERO_MASSIMI ? g : GIORNI_RECUPERO);
export const GIORNI_FINESTRA = 31;
export const GIORNI_SOVRAPPOSIZIONE = 3;

export type CursoreTed = {
  versione: 1;
  fase: "recupero" | "incrementale";
  // giro in corso: intervallo, tipo di avviso, inizio della finestra, pagina
  inCorso: boolean;
  da: string;
  a: string;
  tipo: "bando" | "esito";
  finestraDa: string;
  pagina: number;
  // ultimo giorno letto per intero (fine del recupero o dell'ultimo giro di sincronizzazione)
  ultimoGiorno: string | null;
  recuperoCompletatoIl: string | null;
};

export function giornoIso(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function aggiungiGiorni(giorno: string, giorni: number): string {
  const d = new Date(`${giorno}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
}

export function cursoreIniziale(oggi: string, giorni: number = GIORNI_RECUPERO): CursoreTed {
  const da = aggiungiGiorni(oggi, -giorniRecuperoValidi(giorni));
  return { versione: 1, fase: "recupero", inCorso: true, da, a: oggi, tipo: "bando", finestraDa: da, pagina: 1, ultimoGiorno: null, recuperoCompletatoIl: null };
}

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

export function cursoreValido(v: unknown): CursoreTed | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<CursoreTed>;
  const giorno = (x: unknown) => typeof x === "string" && GIORNO.test(x);
  if (c.versione !== 1 || (c.fase !== "recupero" && c.fase !== "incrementale") || (c.tipo !== "bando" && c.tipo !== "esito") || typeof c.inCorso !== "boolean") return null;
  if (!giorno(c.da) || !giorno(c.a) || !giorno(c.finestraDa) || !Number.isInteger(c.pagina) || (c.pagina as number) < 1 || (c.pagina as number) > 60) return null;
  if (c.ultimoGiorno !== null && !giorno(c.ultimoGiorno)) return null;
  if (c.recuperoCompletatoIl !== null && !giorno(c.recuperoCompletatoIl)) return null;
  if ((c.da as string) > (c.a as string)) return null;
  return c as CursoreTed;
}

// Il giro da fare adesso: un recupero (o un giro) in corso continua; altrimenti parte una sincronizzazione dall'ultimo giorno letto.
export function cursoreAllAvvio(salvato: unknown, oggi: string, giorniRecupero: number = GIORNI_RECUPERO): CursoreTed {
  const c = cursoreValido(salvato);
  if (!c) return cursoreIniziale(oggi, giorniRecupero);
  if (c.inCorso) return c;
  const base = c.ultimoGiorno ?? oggi;
  const da = aggiungiGiorni(base, -GIORNI_SOVRAPPOSIZIONE);
  return { ...c, fase: "incrementale", inCorso: true, da, a: oggi, tipo: "bando", finestraDa: da, pagina: 1 };
}

// La finestra di date da leggere adesso: 31 giorni nel recupero, tutto l'intervallo nella sincronizzazione.
export function finestraCorrente(c: CursoreTed): { da: string; a: string } {
  if (c.fase === "incrementale") return { da: c.da, a: c.a };
  const fine = aggiungiGiorni(c.finestraDa, GIORNI_FINESTRA - 1);
  return { da: c.finestraDa, a: fine < c.a ? fine : c.a };
}

// Il cursore dopo aver letto una pagina con «letti» avvisi su «totale» della finestra.
export function cursoreDopoPagina(c: CursoreTed, letti: number, totale: number, perPagina: number, oggi: string): CursoreTed {
  if (letti >= perPagina && c.pagina * perPagina < totale) return { ...c, pagina: c.pagina + 1 };
  const finestra = finestraCorrente(c);
  if (c.fase === "recupero" && finestra.a < c.a) return { ...c, finestraDa: aggiungiGiorni(finestra.a, 1), pagina: 1 };
  if (c.tipo === "bando") return { ...c, tipo: "esito", finestraDa: c.da, pagina: 1 };
  // bandi ed esiti letti per tutto l'intervallo: giro finito
  return {
    ...c,
    fase: "incrementale",
    inCorso: false,
    tipo: "bando",
    finestraDa: c.da,
    pagina: 1,
    ultimoGiorno: c.a,
    recuperoCompletatoIl: c.recuperoCompletatoIl ?? (c.fase === "recupero" ? oggi : null),
  };
}

// Una sincronizzazione su TED pubblicato da più di 15 mesi fa non ha senso: si ricomincia dal recupero (caso di un'importazione ferma a lungo).
export function serveNuovoRecupero(c: CursoreTed, oggi: string): boolean {
  return c.fase === "incrementale" && !c.inCorso && c.ultimoGiorno !== null && c.ultimoGiorno < aggiungiGiorni(oggi, -450);
}
