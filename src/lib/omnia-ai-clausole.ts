// Le clausole che il cliente approva specificamente (seconda casella del checkout), per
// versione delle Condizioni di abbonamento. Il NUMERO cambia con la versione (la v2 ha
// un articolo in più a metà testo, quindi le clausole successive scorrono di uno): per
// questo la casella non ha i numeri scritti a mano nei componenti, ma li legge da qui.
//
// Modulo senza dipendenze di server: lo usano anche i componenti client del checkout.
// Lo verifica scripts/verifica-legale-omnia-ai.ts: per ogni versione i titoli qui sotto
// devono coincidere con le intestazioni «clausola-N» del testo, così un numero sfasato
// si scopre prima di arrivare in un contratto.

export type ClausolaSpecifica = { numero: number; titolo: string };

export const CLAUSOLE_SPECIFICHE: Record<number, ClausolaSpecifica[]> = {
  1: [
    { numero: 5, titolo: "Gare incluse e crediti aggiuntivi" },
    { numero: 8, titolo: "Cosa succede dopo la cessazione" },
    { numero: 11, titolo: "Nessuna garanzia sull'esito della gara" },
    { numero: 14, titolo: "Limitazione di responsabilità" },
  ],
  2: [
    { numero: 5, titolo: "Gare incluse e crediti aggiuntivi" },
    { numero: 8, titolo: "Cosa succede dopo la cessazione" },
    { numero: 10, titolo: "Riservatezza, base di conoscenza, accesso e trattamento dei dati" },
    { numero: 12, titolo: "Nessuna garanzia sull'esito della gara" },
    { numero: 15, titolo: "Limitazione di responsabilità" },
  ],
};

// Titolo con cui l'Allegato A compare nella casella (dalla v2 delle condizioni).
export const TITOLO_ALLEGATO_A = "Atto di nomina a responsabile del trattamento";

// Le clausole della versione indicata. Per una versione non ancora descritta qui (una
// revisione pubblicata senza aggiornare questo file) si usa la più recente nota: meglio
// una casella con i numeri dell'ultima versione verificata che un checkout che si rompe;
// l'autotest impedisce comunque di arrivarci con una migrazione nel repository.
export function clausoleSpecifiche(versioneCondizioni: number): ClausolaSpecifica[] {
  const note = Object.keys(CLAUSOLE_SPECIFICHE).map(Number).sort((a, b) => a - b);
  const scelta = [...note].reverse().find((v) => v <= versioneCondizioni) ?? note[0];
  return CLAUSOLE_SPECIFICHE[scelta];
}
