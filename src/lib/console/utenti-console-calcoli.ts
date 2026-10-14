import { MAX_GARE_GRATUITE } from "@/lib/omnia-ai-gare-gratuite";

// Calcoli puri (nessun database) per creare un cliente dalla console: controllo dei campi del
// modulo «Nuovo utente» e generatore di password. La creazione vera sta in
// site-console/azioni/utenti-console.ts.

export const PASSWORD_MIN = 10;
// bcrypt, usato da Supabase Auth, ignora quanto sta oltre i 72 byte: oltre non si accetta, per
// non far credere che una password lunghissima sia davvero tutta controllata
export const PASSWORD_MAX = 72;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type NuovoUtenteInput = { email: string; password: string; gare: string };
export type NuovoUtenteValido = { email: string; password: string; gare: number };

export function validaNuovoUtente(input: NuovoUtenteInput): { ok: true; valori: NuovoUtenteValido } | { ok: false; errore: string } {
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, errore: "Indica un'email valida." };

  const password = input.password;
  if (password.length < PASSWORD_MIN) return { ok: false, errore: `La password deve avere almeno ${PASSWORD_MIN} caratteri.` };
  if (password.length > PASSWORD_MAX) return { ok: false, errore: `La password può avere al massimo ${PASSWORD_MAX} caratteri.` };
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return { ok: false, errore: "La password deve contenere almeno una lettera e una cifra." };
  const parteLocale = email.split("@")[0];
  if (password.toLowerCase() === email || (parteLocale.length >= 4 && password.toLowerCase().includes(parteLocale))) {
    return { ok: false, errore: "La password non può contenere l'email (o la sua parte prima della chiocciola)." };
  }

  const testoGare = input.gare.trim();
  const gare = testoGare === "" ? 0 : Number(testoGare);
  if (!Number.isInteger(gare) || gare < 0 || gare > MAX_GARE_GRATUITE) return { ok: false, errore: `Le gare gratuite devono essere un numero intero da 0 a ${MAX_GARE_GRATUITE}.` };

  return { ok: true, valori: { email, password, gare } };
}

// Alfabeto senza i caratteri che si confondono a voce o a occhio (0/O, 1/l/I): la password
// la si comunica al cliente, che la vedrà una volta sola prima di sceglierne una sua.
const ALFABETO = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LUNGHEZZA_GENERATA = 16;

// `casuale` restituisce un numero in [0, 1): nel browser si passa crypto.getRandomValues, nei
// test una sequenza nota. Garantisce almeno una lettera e una cifra (le due cose che la
// validazione chiede), poi mescola.
export function generaPassword(casuale: () => number): string {
  const scegli = (insieme: string) => insieme[Math.min(insieme.length - 1, Math.floor(casuale() * insieme.length))];
  const caratteri = [scegli("abcdefghijkmnpqrstuvwxyz"), scegli("23456789")];
  while (caratteri.length < LUNGHEZZA_GENERATA) caratteri.push(scegli(ALFABETO));
  // Fisher-Yates
  for (let i = caratteri.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(casuale() * (i + 1)));
    [caratteri[i], caratteri[j]] = [caratteri[j], caratteri[i]];
  }
  return caratteri.join("");
}
