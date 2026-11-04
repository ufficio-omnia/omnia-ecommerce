// Richiesta di demo di OMNIA AI: regole PURE (nessun database, nessuna rete, nessun cookie letto qui) usate dal modulo nel browser,
// dall'azione sul server e dai test (scripts/verifica-demo-tracciamento-omnia-ai.ts). Il modulo e l'azione validano con la STESSA
// funzione: ciò che il browser accetta, il server lo ricontrolla identico.

export const SETTORI_DEMO = [
  "Pulizie e sanificazione",
  "Multiservizi",
  "Ausiliariato",
  "Facchinaggio",
  "Ristorazione collettiva",
  "Vigilanza privata e servizi fiduciari",
  "Altro",
] as const;
export type SettoreDemo = (typeof SETTORI_DEMO)[number];

// Versione dei testi e dei consensi mostrati nel modulo (si salva col lead). Se si cambia il testo dell'informativa breve o dei
// consensi, si cambia anche questa.
export const VERSIONE_CONSENSI_DEMO = "demo-2026-11-04";

// Dove il banner dei cookie di omnia-ai.it conserva la scelta del visitatore (src/components/omnia-ai/cookie-consent.tsx): qui si
// LEGGE soltanto, per sapere se i cookie pubblicitari sono stati accettati. Un test controlla che sia la stessa chiave.
export const CHIAVE_CONSENSO_COOKIE = "omnia-ai-cookie-consent";
export const CHIAVE_ATTRIBUZIONE = "omnia-ai-attribuzione";
export const GIORNI_VALIDITA_ATTRIBUZIONE = 90;
export const NOME_CAMPO_TRAPPOLA = "sito_web";

// ── Modulo ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CampoModulo = "nome" | "azienda" | "email" | "telefono" | "settore" | "privacy";
export type DatiModuloDemo = {
  nome: string;
  azienda: string;
  email: string;
  telefono: string;
  settore: SettoreDemo;
  // consenso FACOLTATIVO all'uso dell'email (cifrata) per misurare l'efficacia delle campagne pubblicitarie
  adsConsenso: boolean;
};
export type EsitoValidazione = { ok: true; dati: DatiModuloDemo } | { ok: false; errori: Partial<Record<CampoModulo, string>> };

const CARATTERI_DI_CONTROLLO = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

function testo(valore: unknown): string {
  return typeof valore === "string" ? valore.replace(/\s+/g, " ").trim() : "";
}
function vero(valore: unknown): boolean {
  return valore === true || valore === "on" || valore === "true" || valore === "1";
}

export function normalizzaEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Telefono: cifre, e solo «+» in testa; si accettano spazi, trattini, punti e parentesi (si tolgono). Da 6 a 15 cifre.
export function pulisciTelefono(valore: string): string | null {
  const grezzo = valore.trim();
  if (grezzo === "" || /[^0-9+\s().-]/.test(grezzo)) return null;
  const cifre = grezzo.replace(/\D/g, "");
  if (cifre.length < 6 || cifre.length > 15) return null;
  if (grezzo.includes("+") && !grezzo.startsWith("+")) return null;
  return `${grezzo.startsWith("+") ? "+" : ""}${cifre}`;
}

export function validaModuloDemo(grezzo: Record<string, unknown>): EsitoValidazione {
  const errori: Partial<Record<CampoModulo, string>> = {};

  const nome = testo(grezzo.nome);
  if (nome.length < 2 || nome.length > 120 || (nome.match(/\p{L}/gu) ?? []).length < 2 || CARATTERI_DI_CONTROLLO.test(nome)) {
    errori.nome = "Scrivi il tuo nome e cognome.";
  }
  const azienda = testo(grezzo.azienda);
  if (azienda.length < 1 || azienda.length > 160 || CARATTERI_DI_CONTROLLO.test(azienda)) {
    errori.azienda = "Scrivi il nome dell'azienda.";
  }
  const email = testo(grezzo.email);
  if (email.length > 254 || !EMAIL.test(email)) {
    errori.email = "Scrivi un indirizzo email valido.";
  }
  const telefono = pulisciTelefono(testo(grezzo.telefono));
  if (!telefono) {
    errori.telefono = "Scrivi un numero di telefono valido (da 6 a 15 cifre).";
  }
  const settore = testo(grezzo.settore);
  if (!(SETTORI_DEMO as readonly string[]).includes(settore)) {
    errori.settore = "Scegli il settore di attività.";
  }
  if (!vero(grezzo.privacy)) {
    errori.privacy = "Per continuare devi confermare di aver letto l'informativa privacy.";
  }

  if (Object.keys(errori).length > 0 || !telefono) return { ok: false, errori };
  return { ok: true, dati: { nome, azienda, email, telefono, settore: settore as SettoreDemo, adsConsenso: vero(grezzo.adsConsenso) } };
}

// Per le conversioni Google: minuscolo e senza spazi; per gmail.com e googlemail.com si tolgono i punti prima della «@» e il «+»
// con quel che segue (regola della Data Manager API di Google). Gli altri domini restano com'è.
export function emailPerGoogle(email: string): string {
  const pulita = normalizzaEmail(email).replace(/\s+/g, "");
  const chiocciola = pulita.lastIndexOf("@");
  if (chiocciola < 1) return pulita;
  const locale = pulita.slice(0, chiocciola);
  const dominio = pulita.slice(chiocciola + 1);
  if (dominio !== "gmail.com" && dominio !== "googlemail.com") return pulita;
  const senzaPlus = locale.split("+")[0];
  return `${senzaPlus.replace(/\./g, "")}@${dominio}`;
}

// ── Attribuzione pubblicitaria ───────────────────────────────────────────────────────────────────────────────────────────

export const CAMPI_ID_CLIC = ["gclid", "gbraid", "wbraid"] as const;
export const CAMPI_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export const CAMPI_ATTRIBUZIONE = [...CAMPI_ID_CLIC, ...CAMPI_UTM] as const;
export type CampoAttribuzione = (typeof CAMPI_ATTRIBUZIONE)[number];
export type Attribuzione = Partial<Record<CampoAttribuzione, string>>;

const ID_CLIC = /^[A-Za-z0-9_-]{8,200}$/;
const VALORE_UTM = /^[\p{L}\p{N} _\-.~+:|,()/]{1,200}$/u;

function valoreValido(campo: CampoAttribuzione, valore: unknown): string | null {
  if (typeof valore !== "string") return null;
  const v = valore.trim();
  if (v === "") return null;
  const regola = (CAMPI_ID_CLIC as readonly string[]).includes(campo) ? ID_CLIC : VALORE_UTM;
  return regola.test(v) ? v : null;
}

// Dall'indirizzo della pagina («?gclid=…&utm_source=…»): solo i valori ben formati; null se non ce n'è nessuno. Un valore strano
// (script, spazi in un identificativo, troppo lungo) si scarta: finisce nel database e nei report, non deve poter portare altro.
export function leggiAttribuzioneDaUrl(ricerca: string): Attribuzione | null {
  let parametri: URLSearchParams;
  try {
    parametri = new URLSearchParams(ricerca);
  } catch {
    return null;
  }
  const risultato: Attribuzione = {};
  for (const campo of CAMPI_ATTRIBUZIONE) {
    const v = valoreValido(campo, parametri.get(campo));
    if (v) risultato[campo] = v;
  }
  return Object.keys(risultato).length > 0 ? risultato : null;
}

// Un oggetto qualunque (letto dal browser o ricevuto dal modulo) ridotto ai soli campi noti e ben formati.
export function pulisciAttribuzione(grezzo: unknown): Attribuzione {
  const risultato: Attribuzione = {};
  if (typeof grezzo !== "object" || grezzo === null) return risultato;
  for (const campo of CAMPI_ATTRIBUZIONE) {
    const v = valoreValido(campo, (grezzo as Record<string, unknown>)[campo]);
    if (v) risultato[campo] = v;
  }
  return risultato;
}

export function haAttribuzione(a: Attribuzione): boolean {
  return Object.keys(a).length > 0;
}

// Cosa si conserva nel browser (solo con i cookie pubblicitari accettati): i valori e quando sono stati salvati.
export type AttribuzioneSalvata = { v: 1; salvatoIl: number; valori: Attribuzione };

export function costruisciAttribuzioneSalvata(valori: Attribuzione, adessoMs: number): AttribuzioneSalvata {
  return { v: 1, salvatoIl: adessoMs, valori };
}

// Legge quanto era stato salvato: scartato se illeggibile, di un'altra versione, scaduto (oltre 90 giorni: l'identificativo di
// clic di Google Ads non vale più) o dal futuro.
export function leggiAttribuzioneSalvata(contenuto: string | null, adessoMs: number): Attribuzione | null {
  if (!contenuto) return null;
  let oggetto: unknown;
  try {
    oggetto = JSON.parse(contenuto);
  } catch {
    return null;
  }
  if (typeof oggetto !== "object" || oggetto === null) return null;
  const { v, salvatoIl, valori } = oggetto as { v?: unknown; salvatoIl?: unknown; valori?: unknown };
  if (v !== 1 || typeof salvatoIl !== "number" || !Number.isFinite(salvatoIl)) return null;
  const eta = adessoMs - salvatoIl;
  if (eta < 0 || eta > GIORNI_VALIDITA_ATTRIBUZIONE * 86_400_000) return null;
  const pulito = pulisciAttribuzione(valori);
  return haAttribuzione(pulito) ? pulito : null;
}

// Il consenso ai cookie pubblicitari, come lo salva il banner: solo «accepted» vale come consenso.
export function cookiePubblicitariAccettati(valoreSalvato: string | null): boolean {
  return valoreSalvato === "accepted";
}

// ── Identificativi di Google Analytics (solo con consenso) ───────────────────────────────────────────────────────────────

// «_ga» = «GA1.1.1234567890.1700000000» → client_id «1234567890.1700000000».
export function clientIdDaCookieGa(valore: string | null | undefined): string | null {
  const m = /^GA\d+\.\d+\.(\d{5,12}\.\d{5,12})$/.exec((valore ?? "").trim());
  return m ? m[1] : null;
}

// «_ga_<ID>» = «GS1.1.1700000000.1.1.…» (forma vecchia) o «GS2.1.s1700000000$o1$g1…» (nuova) → session_id «1700000000».
export function sessionIdDaCookieGa(valore: string | null | undefined): string | null {
  const m = /^GS\d+\.\d+\.s?(\d{9,12})(?:[.$]|$)/.exec((valore ?? "").trim());
  return m ? m[1] : null;
}

export function valoreCookie(cookie: string, nome: string): string | null {
  for (const pezzo of cookie.split(";")) {
    const i = pezzo.indexOf("=");
    if (i < 0) continue;
    if (pezzo.slice(0, i).trim() === nome) {
      try {
        return decodeURIComponent(pezzo.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
