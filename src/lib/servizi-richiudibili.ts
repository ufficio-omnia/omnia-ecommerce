// Le sezioni dei servizi aggiuntivi dentro la gara (piano di lavoro, copertina della relazione, revisione umana, OMNIA FOOD MENU) si possono ridurre a una
// riga e riaprire. Regole, tutte qui così si provano senza browser:
//  - di base le sezioni sono APERTE: chi non tocca nulla vede la pagina di sempre;
//  - la scelta di ridurre si ricorda SUL DISPOSITIVO (localStorage) e SOLO dopo un clic dell'utente, come l'interruttore del tema; vale per quel servizio in
//    tutte le gare. Riaprendo la sezione la chiave si toglie: nel browser resta soltanto ciò che l'utente ha ridotto;
//  - se il browser blocca i dati del sito (modalità privata, blocchi) la scelta vale per la visita, senza errori;
//  - ci sono momenti in cui la sezione DEVE vedersi anche se ridotta (il ritorno dal pagamento su Stripe): `forzaApertura` la apre per quella visita senza
//    cancellare la preferenza.

export const SERVIZI_RICHIUDIBILI = ["piano_lavoro", "copertina", "revisione_umana", "food_menu"] as const;
export type ServizioRichiudibile = (typeof SERVIZI_RICHIUDIBILI)[number];

export const PREFISSO_CHIAVE_SERVIZIO = "omnia-ai:servizio-ridotto:";
export const EVENTO_SERVIZI = "omnia-ai:servizi-ridotti";
const VALORE_RIDOTTO = "1";

export function chiaveServizio(id: ServizioRichiudibile): string {
  return `${PREFISSO_CHIAVE_SERVIZIO}${id}`;
}

type Lettura = Pick<Storage, "getItem"> | null;
type Scrittura = Pick<Storage, "setItem" | "removeItem"> | null;

// true solo se la preferenza salvata è esattamente «ridotto»: qualunque altro valore (assente, vuoto, vecchio, manomesso) lascia la sezione aperta
export function leggiRidotto(storage: Lettura, id: ServizioRichiudibile): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(chiaveServizio(id)) === VALORE_RIDOTTO;
  } catch {
    return false;
  }
}

// Ridotta → si salva; riaperta → si toglie la chiave (niente «aperto» salvato). Ritorna false se il browser non ha permesso di scrivere.
export function salvaRidotto(storage: Scrittura, id: ServizioRichiudibile, ridotto: boolean): boolean {
  if (!storage) return false;
  try {
    if (ridotto) storage.setItem(chiaveServizio(id), VALORE_RIDOTTO);
    else storage.removeItem(chiaveServizio(id));
    return true;
  } catch {
    return false;
  }
}

// Com'è la sezione adesso: prima vale il clic fatto in questa visita, poi (se non c'è stato) l'apertura forzata, poi la preferenza salvata.
export function sezioneRidotta(params: { salvato: boolean; sceltaInQuestaVisita: boolean | null; forzaApertura: boolean }): boolean {
  if (params.sceltaInQuestaVisita !== null) return params.sceltaInQuestaVisita;
  if (params.forzaApertura) return false;
  return params.salvato;
}

export function ridottoNelBrowser(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
