// Registrazione e riesecuzione delle chiamate di compressione, per provare
// il meccanismo (accetta/rifiuta, ripristino, nuovo tentativo) quante volte
// serve senza richiamare il modello. Una "cassetta" per cartella: ogni
// chiave (sotto-criterio) tiene la sequenza delle risposte ricevute, nello
// stesso ordine in cui la logica di comprimiBloccoConGaranzie le richiede
// (primo tentativo, secondo tentativo con le correzioni, ...) — la
// riproduzione consuma la stessa sequenza nello stesso ordine, quindi
// funziona finché la logica ATTORNO alla chiamata (quanti tentativi, cosa
// correggere) è quella che si vuole provare a costo zero; se il numero di
// chiamate per chiave cambia, quelle in più restano senza registrazione (il
// blocco resta invariato, senza errore) — succede quando la nuova logica
// avrebbe chiamato il modello più volte del run registrato: serve una nuova
// registrazione.
import fs from "fs";
import path from "path";
import type { FunzioneCompressione } from "../../src/lib/compressione-mirata";

type VoceCassetta = { correzioni: string[]; testo: string | null };
type Cassetta = Record<string, VoceCassetta[]>;

function percorsoCassetta(cartella: string): string {
  return path.join(cartella, "cassetta.json");
}

function leggiCassetta(cartella: string): Cassetta {
  const p = percorsoCassetta(cartella);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function scriviCassetta(cartella: string, cassetta: Cassetta): void {
  fs.mkdirSync(cartella, { recursive: true });
  fs.writeFileSync(percorsoCassetta(cartella), JSON.stringify(cassetta, null, 2));
}

// Chiama davvero il modello (tramite `reale`) e salva ogni richiesta/
// risposta nella cassetta, accodata alla sequenza della sua chiave.
export function registraCompressione(cartella: string, reale: FunzioneCompressione): FunzioneCompressione {
  const cassetta = leggiCassetta(cartella);
  return async (richiesta) => {
    const testo = await reale(richiesta);
    cassetta[richiesta.chiave] = cassetta[richiesta.chiave] ?? [];
    cassetta[richiesta.chiave].push({ correzioni: richiesta.correzioni ?? [], testo });
    scriviCassetta(cartella, cassetta);
    return testo;
  };
}

// Nessuna chiamata: rilegge la cassetta e restituisce, per ogni chiave, le
// risposte registrate nello stesso ordine in cui furono chiamate.
export function riproduciCompressione(cartella: string): FunzioneCompressione {
  const cassetta = leggiCassetta(cartella);
  const usati: Record<string, number> = {};
  return async (richiesta) => {
    const indice = usati[richiesta.chiave] ?? 0;
    usati[richiesta.chiave] = indice + 1;
    const voce = cassetta[richiesta.chiave]?.[indice];
    if (!voce) {
      console.warn(`  [riproduzione] nessuna registrazione per ${richiesta.chiave} (tentativo ${indice + 1}): nessuna chiamata, il blocco resta invariato.`);
      return null;
    }
    return voce.testo;
  };
}

export function cassettaEsiste(cartella: string): boolean {
  return fs.existsSync(percorsoCassetta(cartella));
}
