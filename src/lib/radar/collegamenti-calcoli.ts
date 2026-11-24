// Collegamento reversibile delle gare doppie (fase B1-bis, migrazione 0117; esteso a tutte le fonti in B2a). Logica pura, provata da
// scripts/verifica-radar-pvl.ts e scripts/verifica-radar-b2a.ts.
//
// Quando due gare dell'archivio risultano la stessa, una delle due si «assorbe» nell'altra: resta intera nel database, sparisce da elenchi e
// ricerca, e la sua scheda porta a quella che resta. Nulla si cancella o si sposta; il collegamento si annulla dalla console e, una volta
// annullato, non si rifà da solo.
//
// Regole dell'utente (17/11/2026): un SOLO sistema di unione per tutte le fonti (questo); unioni AUTOMATICHE solo con identificativi
// ufficiali affidabili (CIG, numero dell'avviso TED, identificativo della procedura sulla piattaforma o nella fonte); le corrispondenze
// probabili (per esempio stesso ente e stesso giorno di scadenza) sono solo SUGGERIMENTI, che diventano unioni quando un amministratore le
// conferma. Nessuna catena e nessun ciclo: si collega sempre alla gara che resta in fondo, e le gare già collegate a quella assorbita
// passano anch'esse alla gara che resta.

export type GaraCollegabile = { id: string; chiave: string; unita_a: string | null; unita_esclusa_con: string[] | null };

export type DecisioneCollegamento =
  | { collega: true; assorbita: string; resta: string; motivo: string }
  | { collega: false; motivo: "stessa_gara" | "gia_collegata" | "annullato_a_mano" | "gara_mancante" | "ciclo" };

// Resta la gara che contiene l'avviso TED (pubblicazione europea, storico completo); si assorbe quella che cita lo stesso avviso dalla PVL.
export function decidiCollegamento(numeroTed: string, garaTed: GaraCollegabile | null, garaPvl: GaraCollegabile | null): DecisioneCollegamento {
  if (!garaTed || !garaPvl) return { collega: false, motivo: "gara_mancante" };
  if (garaTed.id === garaPvl.id) return { collega: false, motivo: "stessa_gara" };
  if (garaPvl.unita_a || garaTed.unita_a) return { collega: false, motivo: "gia_collegata" };
  if ((garaPvl.unita_esclusa_con ?? []).includes(garaTed.id) || (garaTed.unita_esclusa_con ?? []).includes(garaPvl.id)) return { collega: false, motivo: "annullato_a_mano" };
  return { collega: true, assorbita: garaPvl.id, resta: garaTed.id, motivo: `stesso avviso TED ${numeroTed}, citato dalla PVL e letto da TED`.slice(0, 300) };
}

// La gara da mostrare: quella che resta, se questa è stata assorbita.
export function garaDaMostrare(g: { id: string; unita_a: string | null }): string {
  return g.unita_a ?? g.id;
}

// Elenchi dell'impresa (Monitorate): se l'impresa aveva salvato ENTRAMBE le copie di una gara poi collegata, la gara compare UNA volta,
// con il primo salvataggio dell'elenco (il più recente); gli altri salvataggi restano nel database, intatti (nessuna cancellazione).
export function unoPerGaraMostrata<T>(elementi: readonly T[], garaMostrata: (x: T) => string | undefined): T[] {
  const viste = new Set<string>();
  const out: T[] = [];
  for (const x of elementi) {
    const id = garaMostrata(x);
    if (id) {
      if (viste.has(id)) continue;
      viste.add(id);
    }
    out.push(x);
  }
  return out;
}

// ───── fase B2a: tutte le fonti ─────

export type GaraUnibile = GaraCollegabile & { fonti: string[] | null; prima_rilevazione_il: string | null };

// La gara che resta IN FONDO alla catena (al più qualche passaggio; un ciclo, che non dovrebbe mai esistere, dà null).
export function restaInFondo(id: string, gare: ReadonlyMap<string, Pick<GaraCollegabile, "id" | "unita_a">>): string | null {
  const visti = new Set<string>();
  let cur = id;
  for (let i = 0; i < 10; i++) {
    if (visti.has(cur)) return null;
    visti.add(cur);
    const g = gare.get(cur);
    if (!g) return cur;
    if (!g.unita_a) return cur;
    cur = g.unita_a;
  }
  return null;
}

// Quale gara resta tra due: quella con l'avviso europeo (TED), poi quella con la pubblicazione legale (PVL), poi la gara letta per prima.
// Così una gara di una fonte non ancora mostrabile ai clienti non diventa mai quella che resta al posto di una già visibile.
export function punteggioResta(g: Pick<GaraUnibile, "fonti" | "chiave">): number {
  const f = new Set(g.fonti && g.fonti.length > 0 ? g.fonti : [g.chiave.split(":")[0]]);
  return f.has("ted") ? 3 : f.has("pvl") ? 2 : 1;
}

export function sceltaResta(a: GaraUnibile, b: GaraUnibile): { resta: GaraUnibile; assorbita: GaraUnibile } {
  const pa = punteggioResta(a);
  const pb = punteggioResta(b);
  if (pa !== pb) return pa > pb ? { resta: a, assorbita: b } : { resta: b, assorbita: a };
  const ta = a.prima_rilevazione_il ?? "~";
  const tb = b.prima_rilevazione_il ?? "~";
  if (ta !== tb) return ta < tb ? { resta: a, assorbita: b } : { resta: b, assorbita: a };
  return a.id < b.id ? { resta: a, assorbita: b } : { resta: b, assorbita: a };
}

// Unione di due gare qualunque riconosciute uguali da un identificativo ufficiale. «restaPreferita»: la regola della fonte, se ne ha una
// (TED↔PVL: resta la gara TED). Le gare già assorbite si sostituiscono con quella che resta in fondo, così non nascono catene.
export function decidiUnione(
  idA: string,
  idB: string,
  gare: ReadonlyMap<string, GaraUnibile>,
  motivo: string,
  restaPreferita: string | null = null,
): DecisioneCollegamento {
  const ra = restaInFondo(idA, gare);
  const rb = restaInFondo(idB, gare);
  if (!ra || !rb) return { collega: false, motivo: "ciclo" };
  const a = gare.get(ra);
  const b = gare.get(rb);
  if (!a || !b) return { collega: false, motivo: "gara_mancante" };
  if (a.id === b.id) return { collega: false, motivo: "stessa_gara" };
  if ((a.unita_esclusa_con ?? []).includes(b.id) || (b.unita_esclusa_con ?? []).includes(a.id)) return { collega: false, motivo: "annullato_a_mano" };
  const preferita = restaPreferita ? restaInFondo(restaPreferita, gare) : null;
  const scelta = preferita === a.id ? { resta: a, assorbita: b } : preferita === b.id ? { resta: b, assorbita: a } : sceltaResta(a, b);
  return { collega: true, resta: scelta.resta.id, assorbita: scelta.assorbita.id, motivo: motivo.slice(0, 300) };
}

// Identificativo della traccia di un collegamento nel registro: diverso per ogni gara assorbita, così due collegamenti verso la stessa gara
// che resta non si confondono (rilievo 3 di B2 sulla 0117).
export function idTraccia(base: string, assorbita: string): string {
  return `${base}|${assorbita}`.slice(0, 200);
}

// Suggerimento di unione (corrispondenza probabile, non automatica): stessa chiave per le due gare, in qualunque ordine.
export function idProposta(a: string, b: string): string {
  return `proposta:${[a, b].sort().join("|")}`;
}
