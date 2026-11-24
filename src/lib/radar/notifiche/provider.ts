// Fase B4 (20/11/2026, B2) — il PROVIDER delle email del motore delle notifiche. Interfaccia comune, provider FINTO in memoria e scelta del
// provider con la CHIUSURA FORZATA di Resend.
//
// Decisione dell'utente del 19/11: «Preview e staging devono usare provider finto, senza inviare email reali»; «Riutilizzare Resend, ma solo
// nel futuro ambiente di produzione autorizzato». Pacchetto P (piano 55 §2, decisione D-F del 23/11): Resend vale SOLO in produzione con
// l'interruttore acceso (resendConsentito(env)); di base è spento, e l'accensione delle email è la fase F8 con la sua autorizzazione. Questo
// modulo non chiama mai la rete (l'adattatore di Resend sta in provider-resend.ts); il modulo src/lib/email.ts non si usa.

import { createHash } from "node:crypto";
import { statoInvioEmail } from "./interruttore";

/** Una email pronta da consegnare. `a` esiste solo in memoria durante l'invio: non si salva mai. */
export type MessaggioEmail = {
  a: string;
  oggetto: string;
  html: string;
  testo: string;
  /** «omnia-radar/<id della consegna>»: Resend la conserva 24 ore e pretende lo stesso contenuto */
  chiaveIdempotenza: string;
  tags: { name: string; value: string }[];
};

/**
 * L'esito di un tentativo, già classificato (docum. Resend: errori, idempotenza, limiti; 26B §5.4):
 *   - inviata: accettata, con l'identificativo del provider;
 *   - riprova: errore transitorio (429 di frequenza, 5xx, 409 di richieste concorrenti, rete o tempo scaduto). `dopoInvio` dice se la
 *     richiesta potrebbe essere arrivata (rete caduta o tempo scaduto DOPO l'invio): si riprova solo con la STESSA chiave;
 *   - quota: quota giornaliera o mensile esaurita: nulla parte, nulla si perde, si riprova il giorno dopo;
 *   - incerto: 409 invalid_idempotent_request (stessa chiave, contenuto diverso): non deve succedere con un modello deterministico;
 *   - fallita: errore definitivo (400, 422, 401, 403). `configurazione` = chiave o dominio: la fase si ferma e la console lo mostra.
 */
export type EsitoProvider =
  | { esito: "inviata"; providerId: string }
  | { esito: "riprova"; codice: string; attesaSecondi: number | null; dopoInvio: boolean }
  | { esito: "quota"; codice: string }
  | { esito: "incerto"; codice: string }
  | { esito: "fallita"; codice: string; configurazione: boolean };

export type NomeProvider = "finto" | "resend";

export interface ProviderEmail {
  readonly nome: NomeProvider;
  invia(m: MessaggioEmail): Promise<EsitoProvider>;
  /** email che il provider accetta ancora (null = sconosciuta) */
  quotaResidua(): number | null;
}

/**
 * Resend (email VERE) solo in PRODUZIONE e solo con l'interruttore acceso (statoInvioEmail: RADAR_NOTIFICHE_EMAIL=attivo, deploy di
 * produzione, database di produzione). Sullo staging, sulle anteprime e in locale MAI: lì il motore usa il provider finto (decisione del
 * 19/11, piano 26B §5.4; pacchetto P, piano 55 §2). Di base è spento perché l'interruttore è spento (55A D-C: accensione in F8).
 */
export function resendConsentito(env: Record<string, string | undefined>): boolean {
  const s = statoInvioEmail(env);
  return s.acceso && s.ambiente === "produzione";
}

// F8 (55A D-C: «prima una prova con un indirizzo interno»): con RADAR_EMAIL_DESTINATARIO_PROVA ogni email va SOLO a quell'indirizzo, con
// «[PROVA] » davanti all'oggetto e una chiave di idempotenza propria (nessun conflitto con gli invii veri di dopo). Gli eventi del giro
// risultano consegnati: la prova si fa quando il modulo è aperto solo a utenti interni o di prova.
export const VARIABILE_DESTINATARIO_PROVA = "RADAR_EMAIL_DESTINATARIO_PROVA";
const INDIRIZZO = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

export function conDestinatarioDiProva(base: ProviderEmail, indirizzo: string): ProviderEmail {
  if (!INDIRIZZO.test(indirizzo)) throw new Error(`${VARIABILE_DESTINATARIO_PROVA} non è un indirizzo email valido: nessun invio`);
  return {
    nome: base.nome,
    quotaResidua: () => base.quotaResidua(),
    invia: (m: MessaggioEmail) => base.invia({ ...m, a: indirizzo, oggetto: `[PROVA] ${m.oggetto}`, chiaveIdempotenza: `prova-${m.chiaveIdempotenza}` }),
  };
}

function impronta(testo: string): string {
  return createHash("sha256").update(testo).digest("hex");
}

/** Un esito preparato per le prove: dopo `n` chiamate con quella chiave (0 = la prima) il finto risponde così. */
export type CopioneFinto = (m: MessaggioEmail, tentativo: number) => EsitoProvider | null;

/**
 * Il provider FINTO: registra in memoria e risponde «finto-<impronta>»; nessuna rete. Imita l'idempotenza di Resend: la stessa chiave con
 * lo stesso contenuto restituisce lo stesso identificativo SENZA una seconda consegna; la stessa chiave con un contenuto diverso dà
 * «incerto» (409 invalid_idempotent_request). Un copione facoltativo simula errori e quote nelle prove.
 */
export class ProviderFinto implements ProviderEmail {
  readonly nome = "finto" as const;
  /** consegne effettive, in ordine (una per chiave) */
  readonly consegnate: { chiave: string; a: string; oggetto: string; impronta: string; providerId: string }[] = [];
  private readonly perChiave = new Map<string, { impronta: string; providerId: string }>();
  private readonly tentativi = new Map<string, number>();
  constructor(private readonly opzioni: { copione?: CopioneFinto; quota?: number | null } = {}) {}

  quotaResidua(): number | null {
    return this.opzioni.quota === undefined || this.opzioni.quota === null ? null : Math.max(0, this.opzioni.quota - this.consegnate.length);
  }

  async invia(m: MessaggioEmail): Promise<EsitoProvider> {
    const n = this.tentativi.get(m.chiaveIdempotenza) ?? 0;
    this.tentativi.set(m.chiaveIdempotenza, n + 1);
    const preparato = this.opzioni.copione?.(m, n) ?? null;
    if (preparato && preparato.esito !== "inviata") return preparato;
    const contenuto = impronta(JSON.stringify([m.a, m.oggetto, m.html, m.testo]));
    const gia = this.perChiave.get(m.chiaveIdempotenza);
    if (gia) return gia.impronta === contenuto ? { esito: "inviata", providerId: gia.providerId } : { esito: "incerto", codice: "invalid_idempotent_request" };
    const q = this.quotaResidua();
    if (q !== null && q <= 0) return { esito: "quota", codice: "daily_quota_exceeded" };
    const providerId = `finto-${impronta(m.chiaveIdempotenza).slice(0, 24)}`;
    this.perChiave.set(m.chiaveIdempotenza, { impronta: contenuto, providerId });
    this.consegnate.push({ chiave: m.chiaveIdempotenza, a: m.a, oggetto: m.oggetto, impronta: contenuto, providerId });
    return { esito: "inviata", providerId };
  }
}

/**
 * La scelta del provider: il finto ovunque (staging, anteprime, prove, locale), Resend SOLO se resendConsentito(env). `creaResend` è
 * l'adattatore (provider-resend.ts), passato da chi chiama per non legare questo file alla rete. Senza la chiave RESEND_API_KEY Resend
 * non parte; con RADAR_EMAIL_DESTINATARIO_PROVA ogni email va solo all'indirizzo di prova (F8).
 */
export function sceltaProvider(env: Record<string, string | undefined> = {}, creaResend?: (chiave: string) => ProviderEmail): ProviderEmail {
  if (!resendConsentito(env)) return new ProviderFinto();
  const chiave = env.RESEND_API_KEY;
  if (!chiave) throw new Error("RESEND_API_KEY mancante: le email vere non partono");
  if (!creaResend) throw new Error("adattatore di Resend non passato: le email vere non partono");
  const prova = env[VARIABILE_DESTINATARIO_PROVA];
  return prova !== undefined ? conDestinatarioDiProva(creaResend(chiave), prova) : creaResend(chiave);
}
