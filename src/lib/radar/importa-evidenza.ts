// Fase B4 (20/11/2026, B2) — EVIDENZA delle modifiche nel registro dei cambiamenti (colonne della 0123) e regole COMUNI di confronto tra
// versioni dei connettori (26B §6.2). Logica pura: nessun database, nessuna rete.
//
// Correzioni (26B §6.2, decisione dell'utente del 19/11: «Non inviare email sulla base di semplici differenze di formattazione, di una
// riclassificazione interna o di inferenze AI non verificate»):
//   1. scadenza confrontata per ISTANTE, non come testo: «Z» e «+01:00» dello stesso istante non sono una proroga (16 casi su 200 sullo staging);
//   2. un'ora che SPARISCE nello stesso giorno (lotti TED disallineati) non è una modifica; un'ora che COMPARE resta una rettifica (parziale);
//   3. collegamento ai documenti normalizzato (stessa regola della PVL, collegamentoNormalizzato); il cambio del collegamento non è MAI email;
//   7. oggetto confrontato senza maiuscole, accenti, spazi, punteggiatura ed entità HTML.
// Evidenza (0123): scritta SOLO con l'interruttore RADAR_REGISTRO_EVIDENZA («attivo», solo staging, mai sulle anteprime), perché le colonne
// esistono solo dopo la 0123: prima della sua applicazione gli importatori scrivono esattamente come oggi.

import { ambienteDb } from "./ambiente";
import { giornoDiRoma } from "./fonti/ted-calcoli";
import { collegamentoNormalizzato } from "./modifiche-pvl";
import { testoPerConfronto } from "./settori";

/** Le colonne della 0123 si scrivono solo con l'interruttore acceso, sullo staging, fuori dalle anteprime (dopo l'applicazione della 0123). */
export function registroConEvidenza(env: Record<string, string | undefined>): boolean {
  return env.RADAR_REGISTRO_EVIDENZA === "attivo" && env.VERCEL_ENV !== "preview" && ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) === "staging";
}

const ENTITA: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** L'oggetto come si confronta tra due versioni (punto 7): una differenza solo di forma non è una rettifica. */
export function oggettoPerConfronto(s: string | null | undefined): string {
  const decodificato = String(s ?? "")
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]{2,6});/gi, (m, n: string) => ENTITA[n.toLowerCase()] ?? m);
  return testoPerConfronto(decodificato);
}

/** Il collegamento ai documenti come si confronta (punto 3): la stessa regola del rilevamento PVL. */
export function documentiPerConfronto(u: string | null | undefined): string | null {
  return collegamentoNormalizzato(u ?? null);
}

/** Una scadenza dell'archivio: il giorno e, SOLO con l'ora indicata, l'istante. */
export type ScadenzaConfronto = { giorno: string | null; iso: string | null };

/**
 * È la stessa scadenza? (punti 1 e 2)
 *   - entrambe con l'ora: stesso ISTANTE (non lo stesso testo);
 *   - giorni diversi: no;
 *   - stesso giorno, l'ora che SPARISCE nella versione nuova: sì (non è una modifica, la gara tiene l'ora indicata);
 *   - stesso giorno, l'ora che COMPARE: no (rettifica, con evidenza parziale: mai email da sola).
 */
export function stessaScadenza(prima: ScadenzaConfronto, dopo: ScadenzaConfronto): boolean {
  if (prima.iso && dopo.iso) {
    const a = Date.parse(prima.iso), b = Date.parse(dopo.iso);
    return Number.isFinite(a) && Number.isFinite(b) ? a === b : prima.iso === dopo.iso;
  }
  if ((prima.giorno ?? null) !== (dopo.giorno ?? null)) return false;
  if (prima.iso && !dopo.iso) return true;
  return !(!prima.iso && dopo.iso);
}

// ───────────────────────── colonne dell'evidenza (0123) ─────────────────────────

export type Affidabilita = "avviso_ufficiale" | "confronto_versioni" | "parziale" | "non_verificata";

/** L'avviso che porta la modifica, come lo descrive la fonte. */
export type AvvisoDellaModifica = {
  fonte: string;
  /** avviso nuovo (id_fonte) */
  idAvviso: string;
  /** l'avviso confrontato, se noto */
  idAvvisoPrecedente: string | null;
  url: string | null;
  /** giorno di pubblicazione (AAAA-MM-GG) */
  pubblicatoIl: string | null;
  versione: number | null;
  tipo: string | null;
  /** numero TED corrispondente («123456-2026») */
  avvisoTed: string | null;
  /** che cosa DICHIARA la fonte: TED change-reason-code, PVL «rettifica», SardegnaCAT «rettificato»/«revocato» */
  dichiarazione: string | null;
};

const TED = /^[0-9]{1,8}-[0-9]{4}$/;
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;
const HTTP = /^https?:\/\//;

/**
 * Quanto è affidabile una modifica di questa fonte (26B §6.1, 26C):
 *   - TED: ogni versione è un avviso ufficiale; con il codice del motivo «avviso_ufficiale», altrimenti «confronto_versioni»;
 *   - PVL: «avviso_ufficiale» con la rettifica dichiarata; altrimenti decide il rilevamento PVL (importa-pvl-pagina.ts);
 *   - Sintel: «parziale» finché la scadenza non si confronta lotto per lotto (mai email);
 *   - SardegnaCAT: «parziale» (il segnale c'è, i campi no), e comunque fonte nascosta ai clienti;
 *   - un'ora che compare nello stesso giorno: «parziale» (mai email da sola); dentro una modifica DICHIARATA dalla fonte vale come avviso
 *     ufficiale (decisione 15, approvata il 19/11: «si segnala solo dentro una rettifica dichiarata»).
 */
export function affidabilitaDi(fonte: string, avviso: Pick<AvvisoDellaModifica, "dichiarazione">, cambio: { campo: string | null; prima: string | null; dopo: string | null }): Affidabilita {
  const base = String(cambio.campo ?? "").split("@")[0];
  if (base === "scadenza_offerte" && cambio.prima && cambio.dopo && GIORNO.test(cambio.prima) && !GIORNO.test(cambio.dopo) && Number.isFinite(Date.parse(cambio.dopo)) && giornoDiRoma(new Date(cambio.dopo)) === cambio.prima) {
    const dichiarata = fonte === "pvl" ? avviso.dichiarazione === "rettifica" : fonte === "ted" && !!avviso.dichiarazione;
    return dichiarata ? "avviso_ufficiale" : "parziale";
  }
  if (fonte === "ted") return avviso.dichiarazione ? "avviso_ufficiale" : "confronto_versioni";
  if (fonte === "pvl") return avviso.dichiarazione === "rettifica" ? "avviso_ufficiale" : "confronto_versioni";
  if (fonte === "sintel" || fonte === "sardegnacat") return "parziale";
  return "non_verificata";
}

/** Una riga del registro come la scrivono gli importatori (prima dell'evidenza). */
export type RigaRegistro = { tipo: string; campo: string | null; valore_precedente: string | null; valore_nuovo: string | null; notificabile: boolean; fonte: string };

/**
 * Le colonne della 0123 per una riga del registro. `notifica_email` vale SOLO per una modifica verificata e notificabile di un tipo ammesso
 * (lo stesso vincolo della 0123, qui calcolato prima di scrivere): mai «nuova», «esito», «correzione_dati», mai il solo collegamento ai
 * documenti, mai dati parziali o non verificati.
 */
export function evidenzaDellaRiga(r: RigaRegistro, a: AvvisoDellaModifica, esecuzioneId: string | null): Record<string, unknown> {
  const affidabilita = ["rettifica", "proroga", "annullamento"].includes(r.tipo) ? affidabilitaDi(r.fonte, a, { campo: r.campo, prima: r.valore_precedente, dopo: r.valore_nuovo }) : null;
  const documenti = String(r.campo ?? "").split("@")[0] === "url_documenti";
  const notificaEmail = r.notificabile && !documenti && ["rettifica", "proroga", "annullamento"].includes(r.tipo) && (affidabilita === "avviso_ufficiale" || affidabilita === "confronto_versioni");
  return {
    avviso_precedente_id: a.idAvvisoPrecedente ? a.idAvvisoPrecedente.slice(0, 200) : null,
    avviso_url: a.url && HTTP.test(a.url) && a.url.length <= 2000 ? a.url : null,
    avviso_pubblicato_il: a.pubblicatoIl && GIORNO.test(a.pubblicatoIl.slice(0, 10)) ? a.pubblicatoIl.slice(0, 10) : null,
    avviso_versione: a.versione !== null && Number.isInteger(a.versione) && a.versione >= 0 && a.versione <= 1000 ? a.versione : null,
    avviso_tipo: a.tipo ? a.tipo.slice(0, 60) : null,
    avviso_ted: a.avvisoTed && TED.test(a.avvisoTed) ? a.avvisoTed : null,
    dichiarazione_fonte: a.dichiarazione ? a.dichiarazione.slice(0, 60) : null,
    affidabilita,
    esecuzione_id: esecuzioneId,
    notifica_email: notificaEmail,
  };
}

/**
 * TED, punto 6: un avviso UFFICIALE di modifica (versione successiva con il codice del motivo) che non cambia nessuno dei campi confrontati
 * diventa comunque una riga «rettifica» con campo «avviso»: l'email dice che la fonte ha pubblicato un avviso di modifica e rimanda
 * all'avviso ufficiale, senza supporre che cosa sia cambiato.
 */
export function rigaAvvisoSenzaCampi(procedura: string, fonte: string, idAvviso: string, notificabile: boolean): Record<string, unknown> {
  return { procedura_id: procedura, tipo: "rettifica", campo: "avviso", valore_precedente: null, valore_nuovo: null, fonte, id_fonte: idAvviso, notificabile };
}
