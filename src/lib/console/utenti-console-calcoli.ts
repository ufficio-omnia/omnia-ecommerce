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

// ───── Password: consegna al cliente ─────

// A che punto è la password di un cliente creato dalla console:
//  - iniziale:      la password è quella scelta dall'amministratore, il cliente non l'ha ancora cambiata
//  - reset_inviato: l'amministratore l'ha azzerata e ha mandato l'email; il cliente non ha ancora scelto
//  - consegnata:    il cliente ha scelto la SUA password: da qui la console non può più farci nulla
export type StatoPasswordCliente = "iniziale" | "reset_inviato" | "consegnata";

export function statoPasswordCliente(riga: { resetRichiestoIl: string | null; passwordConsegnataIl: string | null }): StatoPasswordCliente {
  if (riga.passwordConsegnataIl) return "consegnata";
  if (riga.resetRichiestoIl) return "reset_inviato";
  return "iniziale";
}

// L'unica azione sulla password che la console conosce è il reset, e solo prima della consegna.
export function resetPasswordPermesso(stato: StatoPasswordCliente): boolean {
  return stato !== "consegnata";
}

export const MESSAGGIO_PASSWORD_GIA_CONSEGNATA =
  "Il cliente ha già scelto la sua password: da qui la console non può più modificarla né azzerarla. Se l'ha dimenticata può usare «Password dimenticata» nella pagina di accesso.";

// Email al cliente: il link porta alla pagina di attivazione, che lo fa entrare e lo manda a
// scegliere la password. Il testo dice chiaramente che da quel momento nessuno la conosce né può
// modificarla.
export function testoEmailResetPassword(link: string, escapeHtml: (t: string) => string): { oggetto: string; html: string } {
  return {
    oggetto: "Scegli la tua password per OMNIA AI",
    html: `<p>Abbiamo azzerato la password iniziale del tuo account OMNIA AI.</p><p>Per accedere, scegli ora la tua password con questo link:</p><p><a href="${escapeHtml(link)}">Scegli la tua password</a></p><p>Il link è valido per un tempo limitato e si usa una sola volta: se è scaduto, scrivici e te ne mandiamo uno nuovo.</p><p>Una volta scelta, la password la conosci solo tu: nessuno di Omnia potrà vederla né modificarla.</p>`,
  };
}
