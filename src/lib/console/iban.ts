// Controllo dell'IBAN dei dati bancari. L'IBAN che l'admin salva viene mostrato a
// tutti i clienti che pagano con bonifico e inviato per email: un refuso significa
// bonifici che finiscono altrove. Per questo non basta «non vuoto»: si controlla
// la struttura e la cifra di controllo (modulo 97, norma ISO 13616), che scopre
// quasi tutti gli errori di battitura.

// IBAN di esempio con cui la migrazione 0029 ha riempito la tabella: se è ancora
// quello, i clienti vedono un conto che non esiste.
export const IBAN_DI_ESEMPIO = "IT60X0542811101000000123456";

// Lunghezze dei paesi più probabili per questa attività; un paese non in elenco
// si accetta con la sola struttura e la cifra di controllo (15-34 caratteri).
const LUNGHEZZA_PER_PAESE: Record<string, number> = { IT: 27, SM: 27, SK: 24, DE: 22, FR: 27, ES: 24, AT: 20, CH: 21, BE: 16, NL: 18, LU: 20, PT: 25, IE: 22, GB: 22 };

// Maiuscolo e senza spazi, separatori o trattini.
export function normalizzaIban(valore: string): string {
  return valore.replace(/[\s.-]+/g, "").toUpperCase();
}

function restoModulo97(iban: string): number {
  // si sposta il paese e la cifra di controllo in fondo e le lettere diventano numeri (A=10 … Z=35)
  const riordinato = iban.slice(4) + iban.slice(0, 4);
  let resto = 0;
  for (const carattere of riordinato) {
    const cifre = /[A-Z]/.test(carattere) ? String(carattere.charCodeAt(0) - 55) : carattere;
    for (const c of cifre) resto = (resto * 10 + Number(c)) % 97;
  }
  return resto;
}

// null se l'IBAN è valido, altrimenti la frase da mostrare all'utente.
export function erroreIban(valore: string): string | null {
  const iban = normalizzaIban(valore);
  if (iban === "") return "Inserisci l'IBAN.";
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return "L'IBAN non ha un formato valido: due lettere del paese, due cifre di controllo e poi il numero di conto.";
  const attesa = LUNGHEZZA_PER_PAESE[iban.slice(0, 2)];
  if (attesa !== undefined && iban.length !== attesa) return `Un IBAN ${iban.slice(0, 2)} ha ${attesa} caratteri: questo ne ha ${iban.length}.`;
  if (restoModulo97(iban) !== 1) return "La cifra di controllo dell'IBAN non torna: c'è un errore di battitura.";
  return null;
}

export function eIbanDiEsempio(valore: string): boolean {
  return normalizzaIban(valore) === IBAN_DI_ESEMPIO;
}
