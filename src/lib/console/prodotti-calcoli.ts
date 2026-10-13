// Regole e calcoli puri (nessun database) per Prodotti e sconti.
//
// DOVE STAVA IL PROBLEMA. Le vecchie azioni del pannello admin non dicevano mai
// quando un'operazione falliva (tornavano in silenzio) e due regole stavano solo
// nel database: lo sconto deve essere minore del prezzo, e il prezzo non può
// scendere sotto uno sconto attivo. Qui le regole sono dichiarate e verificate
// prima di scrivere, così l'admin legge il perché invece di vedere «non è successo
// nulla».

export const PREZZO_MASSIMO = 100_000;
export const LUNGHEZZA_TITOLO = 200;
export const LUNGHEZZA_CATEGORIA = 100;
export const LUNGHEZZA_DESCRIZIONE = 2000;
export const LUNGHEZZA_ETICHETTA_FILE = 120;
export const ORDINE_FILE_MASSIMO = 999;

// «12,50» e «12.50» valgono lo stesso; al massimo due decimali, sempre positivo.
// null se non è un importo valido.
export function leggiImporto(valore: FormDataEntryValue | null | undefined): number | null {
  const testo = String(valore ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(testo)) return null;
  const importo = Number(testo);
  if (!Number.isFinite(importo) || importo <= 0 || importo > PREZZO_MASSIMO) return null;
  return Math.round(importo * 100) / 100;
}

export const ERRORE_IMPORTO = `Importo non valido: scrivi un numero positivo con al massimo due decimali, fino a ${PREZZO_MASSIMO.toLocaleString("it-IT")} (es. 399 o 399,50).`;

export type DatiProdotto = { titolo: string; categoria: string | null; prezzo: number; descrizione: string | null };

export function leggiDatiNuovoProdotto(campi: { titolo: unknown; categoria: unknown; prezzo: FormDataEntryValue | null; descrizione: unknown }): { errore: string } | { dati: DatiProdotto } {
  const titolo = String(campi.titolo ?? "").trim();
  const categoria = String(campi.categoria ?? "").trim();
  const descrizione = String(campi.descrizione ?? "").trim();
  const prezzo = leggiImporto(campi.prezzo);

  if (!titolo) return { errore: "Scrivi il titolo del prodotto." };
  if (titolo.length > LUNGHEZZA_TITOLO) return { errore: `Il titolo è troppo lungo (massimo ${LUNGHEZZA_TITOLO} caratteri).` };
  if (categoria.length > LUNGHEZZA_CATEGORIA) return { errore: `La categoria è troppo lunga (massimo ${LUNGHEZZA_CATEGORIA} caratteri).` };
  if (descrizione.length > LUNGHEZZA_DESCRIZIONE) return { errore: `La descrizione è troppo lunga (massimo ${LUNGHEZZA_DESCRIZIONE} caratteri).` };
  if (prezzo === null) return { errore: ERRORE_IMPORTO };
  return { dati: { titolo, categoria: categoria || null, prezzo, descrizione: descrizione || null } };
}

// Lo sconto deve essere un prezzo MINORE (uno uguale o maggiore non è uno sconto).
// Lo stesso vincolo c'è nel database (discount_price_valid): qui si dice perché.
export function erroreSconto(prezzo: number, prezzoScontato: number): string | null {
  if (prezzoScontato >= prezzo) return `Il prezzo scontato deve essere minore del prezzo di listino (${formattaImporto(prezzo)}).`;
  return null;
}

// Cambiando il prezzo di un prodotto in sconto, il nuovo prezzo deve restare sopra lo sconto.
export function errorePrezzoConSconto(nuovoPrezzo: number, scontoAttivo: boolean, prezzoScontato: number | null): string | null {
  if (scontoAttivo && prezzoScontato !== null && nuovoPrezzo <= prezzoScontato) {
    return `Il prodotto è in sconto a ${formattaImporto(prezzoScontato)}: il nuovo prezzo deve essere maggiore. Disattiva prima lo sconto, oppure scegli un prezzo più alto.`;
  }
  return null;
}

export function formattaImporto(importo: number): string {
  return importo.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

// Numero d'ordine di un file: intero tra 0 e 999.
export function leggiOrdineFile(valore: FormDataEntryValue | null | undefined, predefinito: number): number {
  const testo = String(valore ?? "").trim();
  if (testo === "") return predefinito;
  const n = Number(testo);
  return Number.isInteger(n) && n >= 0 && n <= ORDINE_FILE_MASSIMO ? n : predefinito;
}

// ───── Riepilogo per le tessere ─────

export type ProdottoRiepilogo = {
  attivo: boolean;
  prezzo: number;
  scontoAttivo: boolean;
  file: number;
  ordini: number;
};

export function riepilogoProdotti(prodotti: ProdottoRiepilogo[]) {
  const attivi = prodotti.filter((p) => p.attivo);
  return {
    totale: prodotti.length,
    attivi: attivi.length,
    disattivati: prodotti.length - attivi.length,
    inSconto: prodotti.filter((p) => p.attivo && p.scontoAttivo).length,
    // un prodotto in vendita senza file: il cliente pagherebbe e non avrebbe nulla da scaricare
    attiviSenzaFile: attivi.filter((p) => p.file === 0).length,
  };
}

// ───── Galleria delle anteprime: spostare una immagine ─────

export type VoceOrdinata = { id: string; sort_order: number };

// Sposta una voce di un posto in alto o in basso e rinumera TUTTE da 0 in ordine, così
// l'ordine è sempre una sequenza pulita (due voci con lo stesso numero non si
// potrebbero scambiare). Restituisce solo le voci il cui numero cambia; null se
// lo spostamento non è possibile (voce assente o già al bordo).
export function riordinaVoci(voci: VoceOrdinata[], id: string, direzione: "up" | "down"): VoceOrdinata[] | null {
  const ordinate = [...voci].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const indice = ordinate.findIndex((v) => v.id === id);
  const altro = direzione === "up" ? indice - 1 : indice + 1;
  if (indice === -1 || altro < 0 || altro >= ordinate.length) return null;

  [ordinate[indice], ordinate[altro]] = [ordinate[altro], ordinate[indice]];
  const originale = new Map(voci.map((v) => [v.id, v.sort_order]));
  return ordinate.map((v, posizione) => ({ id: v.id, sort_order: posizione })).filter((v) => originale.get(v.id) !== v.sort_order);
}

// Nome di un file per lo storage: lo storage rifiuta alcuni caratteri (accenti,
// spazi, parentesi) nelle chiavi, quindi tutto ciò che non è lettera, cifra, punto,
// trattino o trattino basso diventa «_». Il nome mostrato al cliente è l'etichetta
// del file, non questo. Si tiene la parte finale se il nome è lunghissimo, per non
// perdere l'estensione.
export function nomeFileSicuro(nome: string): string {
  const pulito = nome.replace(/[^a-zA-Z0-9._-]/g, "_");
  return pulito.length > 100 ? pulito.slice(-100) : pulito;
}

// ───── Anteprime caricate: quali si accettano ─────

export const TIPI_ANTEPRIMA = ["image/jpeg", "image/png", "image/webp"];
export const PESO_MASSIMO_ANTEPRIMA = 3 * 1024 * 1024;
export const PESO_MASSIMO_FILE_PRODOTTO = 25 * 1024 * 1024;

export function giudicaAnteprima(file: { name: string; size: number; type: string }): string | null {
  if (file.size === 0) return "file vuoto";
  if (!TIPI_ANTEPRIMA.includes(file.type)) return "formato non ammesso (solo JPG, PNG o WebP)";
  if (file.size > PESO_MASSIMO_ANTEPRIMA) return "oltre 3 MB";
  return null;
}
