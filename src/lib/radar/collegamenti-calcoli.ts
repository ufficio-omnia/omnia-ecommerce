// Collegamento reversibile delle gare doppie (fase B1-bis, migrazione 0117). Logica pura, provata da scripts/verifica-radar-pvl.ts.
//
// Quando due gare dell'archivio risultano la stessa (oggi: un avviso TED citato dalla PVL in una gara e letto da TED in un'altra), una delle
// due si «assorbe» nell'altra: resta intera nel database, sparisce da elenchi e ricerca, e la sua scheda porta a quella che resta. Nulla
// si cancella o si sposta; il collegamento si annulla dalla console e, una volta annullato, non si rifà da solo.

export type GaraCollegabile = { id: string; chiave: string; unita_a: string | null; unita_esclusa_con: string[] | null };

export type DecisioneCollegamento =
  | { collega: true; assorbita: string; resta: string; motivo: string }
  | { collega: false; motivo: "stessa_gara" | "gia_collegata" | "annullato_a_mano" | "gara_mancante" };

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
