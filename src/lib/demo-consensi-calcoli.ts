import { VERSIONE_CONSENSI_DEMO } from "@/lib/demo-lead-calcoli";

// Consensi della richiesta di demo: regole PURE (nessun database, nessuna chiave). I TESTI che il visitatore vede nel modulo stanno qui,
// in un'unica fonte: il modulo li mostra, il server ne calcola l'impronta SHA-256 e la salva nel registro dei consensi
// (demo_consensi, migrazione 0098) insieme alla versione. Così «cosa ha accettato» è dimostrabile e non dipende da una copia a mano.
// Il registro si AGGIUNGE soltanto; il consenso valido è l'ultima riga per richiesta e tipo (una revoca è una riga nuova «denied»);
// ogni riga ha una firma HMAC del server (vedi demo-hash.ts), per accorgersi di una riga alterata.

// Versione della Privacy policy in vigore sul sito quando il consenso è dato (legal/privacy-policy-omnia-ai-v2.md, v1 in
// src/components/omnia-ai/legal/privacy-policy-v1.tsx). La v2 entra in vigore quando si esegue la migrazione 0100 (riga in legal_documents):
// questa costante va in produzione con lo stesso rilascio, quindi la migrazione si esegue SUBITO dopo il deploy (vedi la guida del Google tag).
// Cambia solo il valore registrato nei consensi: il testo del modulo (VERSIONE_CONSENSI_DEMO) non è cambiato.
export const VERSIONE_INFORMATIVA_PRIVACY = "2";

// Versione e testo del banner dei cookie di omnia-ai.it. Il banner mostra ESATTAMENTE questo testo (src/components/omnia-ai/cookie-consent.tsx lo
// importa da qui: una sola fonte). Il testo contiene una volta sola le parole «Cookie policy», che nel banner diventano il collegamento.
// Cambiare il testo vuol dire cambiare la versione: la scelta del visitatore si salva con la versione che ha visto, e una scelta fatta con
// una versione precedente non vale più (il banner si ripropone). «banner-2026-09» era: «Usiamo un cookie tecnico-pubblicitario solo se
// acconsenti, per capire quali annunci portano contatti utili. Nessun dato viene venduto a terzi.» (i consensi già registrati restano così).
export const VERSIONE_BANNER_COOKIE = "banner-2026-11";
export const TESTO_BANNER_COOKIE =
  "Usiamo Google Analytics e Google Ads per capire quali annunci portano contatti utili. Se accetti, salviamo cookie di misurazione e pubblicitari; non li usiamo per annunci personalizzati. Se rifiuti, non salviamo cookie e Google Analytics resta spento; sulle pagine di presentazione Google Ads riceve comunque un segnale tecnico senza cookie (la pagina visitata, senza parametri dell'indirizzo). Nessun dato viene venduto a terzi. Dettagli nella Cookie policy.";

export const TESTI_MODULO_DEMO = {
  informativaPrima:
    "Usiamo i dati che inserisci per organizzare la demo e ricontattarti. Dopo l'invio si apre il calendario Google, dove scegli giorno e ora: la prenotazione è gestita da Google. Titolare del trattamento: Omnia Consulting SRLS. Dettagli, finalità e diritti nell'",
  informativaLink: "informativa privacy",
  informativaDopo: ".",
  privacy: "Ho letto l'informativa privacy e accetto che OMNIA AI tratti i miei dati per gestire la prenotazione e contattarmi riguardo alla demo.",
  ads: "Facoltativo: acconsento a che il mio indirizzo email, in forma cifrata, sia usato per misurare l'efficacia delle campagne pubblicitarie di OMNIA AI.",
} as const;

export type TipoConsenso = "informativa_privacy" | "misurazione_pubblicitaria" | "cookie_pubblicitari";
export type ValoreConsenso = "granted" | "denied";
export type FonteConsenso = "modulo_demo" | "banner_cookie_dichiarato" | "revoca";
export const TIPI_CONSENSO: readonly TipoConsenso[] = ["informativa_privacy", "misurazione_pubblicitaria", "cookie_pubblicitari"];

// Il testo ESATTO a cui si riferisce ogni consenso.
export function testoCanonico(tipo: TipoConsenso): string {
  if (tipo === "informativa_privacy") {
    return `${TESTI_MODULO_DEMO.informativaPrima}${TESTI_MODULO_DEMO.informativaLink}${TESTI_MODULO_DEMO.informativaDopo}\n${TESTI_MODULO_DEMO.privacy}`;
  }
  if (tipo === "misurazione_pubblicitaria") return TESTI_MODULO_DEMO.ads;
  return TESTO_BANNER_COOKIE;
}

export function versioneTesto(tipo: TipoConsenso): string {
  return tipo === "cookie_pubblicitari" ? VERSIONE_BANNER_COOKIE : VERSIONE_CONSENSI_DEMO;
}

export type ConsensoDaSalvare = {
  tipo: TipoConsenso;
  valore: ValoreConsenso;
  versione_testo: string;
  testo_sha256: string;
  informativa_versione: string;
  fonte: FonteConsenso;
  dichiarato_dal_browser: boolean;
  ip_hash: string | null;
};

// I tre consensi di UN invio del modulo. Si registra anche il «no» (consenso facoltativo non dato, cookie non accettati): dimostra che la
// scelta è stata offerta. L'informativa privacy qui è sempre «granted» (senza non si arriva fin qui). L'impronta del testo la calcola il
// chiamante con SHA-256 (qui non si importa crypto).
export function costruisciConsensi(input: { adsConsenso: boolean; cookieAccettati: boolean; ipHash: string | null }, hash: (testo: string) => string): ConsensoDaSalvare[] {
  const base = (tipo: TipoConsenso, valore: ValoreConsenso, fonte: FonteConsenso, dichiarato: boolean): ConsensoDaSalvare => ({
    tipo,
    valore,
    versione_testo: versioneTesto(tipo),
    testo_sha256: hash(testoCanonico(tipo)),
    informativa_versione: VERSIONE_INFORMATIVA_PRIVACY,
    fonte,
    dichiarato_dal_browser: dichiarato,
    ip_hash: input.ipHash,
  });
  return [
    base("informativa_privacy", "granted", "modulo_demo", false),
    base("misurazione_pubblicitaria", input.adsConsenso ? "granted" : "denied", "modulo_demo", false),
    base("cookie_pubblicitari", input.cookieAccettati ? "granted" : "denied", "banner_cookie_dichiarato", true),
  ];
}

export type ConsensoRegistrato = ConsensoDaSalvare & { lead_id: string; registrato_il: string; firma: string | null };

// Ciò che si firma (HMAC): tutto quello che rende il consenso «quello», in un ordine fisso. Cambiare un campo cambia la firma.
// La data si riscrive SEMPRE in forma standard (UTC, millisecondi): Postgres la restituisce con un altro aspetto («+00:00», microsecondi),
// ma è lo stesso istante e la firma deve tornare.
export function dataStandard(valore: string): string {
  const t = Date.parse(valore);
  return Number.isFinite(t) ? new Date(t).toISOString() : valore;
}

export function stringaDaFirmare(r: Pick<ConsensoRegistrato, "lead_id" | "tipo" | "valore" | "versione_testo" | "testo_sha256" | "informativa_versione" | "fonte" | "registrato_il">): string {
  return [r.lead_id, r.tipo, r.valore, r.versione_testo, r.testo_sha256, r.informativa_versione, r.fonte, dataStandard(r.registrato_il)].join("|");
}

// L'ultima riga per tipo (per data; a parità, l'ultima nell'elenco).
export function ultimoConsenso(registri: ConsensoRegistrato[], tipo: TipoConsenso): ConsensoRegistrato | null {
  let ultimo: ConsensoRegistrato | null = null;
  for (const r of registri) {
    if (r.tipo !== tipo) continue;
    if (!ultimo || Date.parse(r.registrato_il) >= Date.parse(ultimo.registrato_il)) ultimo = r;
  }
  return ultimo;
}

export type EsitoConsenso = "concesso" | "negato" | "mancante" | "firma_non_valida";

// Lo stato di un consenso: l'ultima riga conta; se si può verificare la firma e non torna, NON vale. `verificaFirma` assente = la
// firma non si controlla (segreto non configurato): il consenso vale ma la guida dice di configurare il segreto.
export function statoConsenso(registri: ConsensoRegistrato[], tipo: TipoConsenso, verificaFirma?: (r: ConsensoRegistrato) => boolean): EsitoConsenso {
  const ultimo = ultimoConsenso(registri, tipo);
  if (!ultimo) return "mancante";
  if (verificaFirma && !verificaFirma(ultimo)) return "firma_non_valida";
  return ultimo.valore === "granted" ? "concesso" : "negato";
}

export type ConsensiVerificati = { privacy: boolean; cookie: boolean; misurazione: boolean };

// Cosa si può fare con i dati di una richiesta, in base ai consensi: l'informativa dev'essere stata accettata per qualunque uso; il clic si
// manda a Google Ads solo con i cookie pubblicitari accettati; l'email cifrata solo con il consenso del modulo.
export function consensiVerificati(registri: ConsensoRegistrato[], verificaFirma?: (r: ConsensoRegistrato) => boolean): ConsensiVerificati {
  return {
    privacy: statoConsenso(registri, "informativa_privacy", verificaFirma) === "concesso",
    cookie: statoConsenso(registri, "cookie_pubblicitari", verificaFirma) === "concesso",
    misurazione: statoConsenso(registri, "misurazione_pubblicitaria", verificaFirma) === "concesso",
  };
}

// La revoca è una riga nuova «denied» (il registro non si modifica).
export function costruisciRevoca(tipo: TipoConsenso, ipHash: string | null, hash: (testo: string) => string): ConsensoDaSalvare {
  return {
    tipo,
    valore: "denied",
    versione_testo: versioneTesto(tipo),
    testo_sha256: hash(testoCanonico(tipo)),
    informativa_versione: VERSIONE_INFORMATIVA_PRIVACY,
    fonte: "revoca",
    dichiarato_dal_browser: false,
    ip_hash: ipHash,
  };
}
