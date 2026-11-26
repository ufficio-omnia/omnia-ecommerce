// Protezione esplicita contro le scritture accidentali delle importazioni di Tender Intelligence nel database di PRODUZIONE (richiesta del
// titolare del 16/11/2026, dopo l'anteprima partita con le variabili di produzione). Logica pura: legge solo l'ambiente che riceve.
//
// Regole (fonteAutorizzata, sotto):
//   - PVL, Sintel, SardegnaCAT: nello staging sempre; in produzione solo dal deploy di produzione e con RADAR_<FONTE>_PRODUZIONE=autorizzata
//     (K8, L6 del piano 36); senza la variabile il giro non parte;
//   - TED: nello staging sempre; in produzione solo dal deploy di produzione su Vercel (VERCEL_ENV=production), mai da un computer
//     locale né da un'anteprima che usi il database di produzione;
//   - un database non riconosciuto (né staging né produzione) è trattato come produzione: niente scritture;
//   - fase B3: su un'anteprima di Vercel (VERCEL_ENV=preview) nessuna scrittura degli importatori, nemmeno sullo staging.
// Gli identificativi dei progetti non sono segreti (compaiono negli indirizzi pubblici); le chiavi non si leggono mai qui.

export const PROGETTO_PRODUZIONE = "bihfrzspqxsrzlbqqvqa";
export const PROGETTO_STAGING = "ryawdldqiumqsskrnyps";

export type AmbienteDb = "produzione" | "staging" | "sconosciuto";

export function ambienteDb(url: string | undefined): AmbienteDb {
  const u = (url ?? "").trim().toLowerCase().replace(/\/+$/, "");
  if (u.includes(PROGETTO_PRODUZIONE)) return "produzione";
  if (u === `https://${PROGETTO_STAGING}.supabase.co`) return "staging";
  return "sconosciuto";
}

export type PermessoScrittura = { ok: true; ambiente: AmbienteDb } | { ok: false; ambiente: AmbienteDb; motivo: string };

// Fase B3 (18/11/2026): sulle ANTEPRIME di Vercel (VERCEL_ENV=preview) nessuna importazione, nemmeno sullo staging: la Preview serve al
// collaudo dell'interfaccia e LEGGE lo staging, non lo scrive («Importazioni. Accensione dei connettori. Cron automatici»: non autorizzati).
// Vale per il cron, per «Esegui un giro adesso» della console e per qualunque altra chiamata degli importatori, qualunque sia lo stato delle
// fonti nel database. Non cambia nulla per il deploy di produzione né per gli script locali (VERCEL_ENV assente).
export const MOTIVO_ANTEPRIMA = "Anteprima Vercel: le importazioni sono spente (la Preview legge lo staging, non lo scrive).";

// Fase 2: «sater» (Intercent-ER / SATER). In produzione come Sintel e SardegnaCAT: solo dal deploy di produzione e con la sua variabile
// della tabella VARIABILI_PRODUZIONE (decisione dell'utente del 26/11: SATER in produzione); senza la variabile non importa e non notifica.
// Fase 2: «tuttogare» (TuttoGare PA, in costruzione). NON ha la variabile di produzione (VARIABILI_PRODUZIONE): fuori dallo staging non è
// mai autorizzata, qualunque cosa ci sia nel database o nell'ambiente.
export const FONTI_RADAR = ["ted", "pvl", "sintel", "sardegnacat", "sater", "tuttogare"] as const;
export type FonteRadar = (typeof FONTI_RADAR)[number];

/**
 * A che cosa serve il permesso (fase B4, 20/11/2026, L6 del piano 36):
 *   - «importazione»: il connettore scrive nell'archivio (cron, «Esegui un giro adesso» della console, script);
 *   - «notifiche»: una modifica rilevata da quella fonte può diventare un evento del motore delle email (al posto dell'elenco
 *     FONTI_SOLO_STAGING proposto nel 26B A.4: una sola regola per importatori, console e motore).
 */
export type UsoFonte = "importazione" | "notifiche";

/**
 * K8 (L6): la variabile che autorizza una fonte in PRODUZIONE (valore «autorizzata»). TED non ne ha: in produzione vale il solo deploy di
 * produzione, come prima (48C §3.7). Le variabili si creano su Vercel, ambiente Production, solo con l'autorizzazione dell'utente (51 §4).
 */
export const VARIABILI_PRODUZIONE: Readonly<Partial<Record<FonteRadar, string>>> = {
  pvl: "RADAR_PVL_PRODUZIONE",
  sintel: "RADAR_SINTEL_PRODUZIONE",
  sardegnacat: "RADAR_SARDEGNACAT_PRODUZIONE",
  sater: "RADAR_SATER_PRODUZIONE",
};
const NOMI_FONTI: Record<FonteRadar, string> = { ted: "TED", pvl: "La PVL", sintel: "Sintel", sardegnacat: "SardegnaCAT", sater: "SATER", tuttogare: "TuttoGare" };

/**
 * L'UNICA regola che decide se una fonte del Radar si può usare in questo ambiente, per un dato uso (importatori, accensione dalla console,
 * motore delle notifiche):
 *   - anteprima di Vercel (VERCEL_ENV=preview): MAI, nemmeno sullo staging;
 *   - staging: sempre;
 *   - PVL, Sintel, SardegnaCAT: in produzione SOLO dal deploy di produzione e con RADAR_<FONTE>_PRODUZIONE=autorizzata (K8); senza la
 *     variabile, solo staging, come prima;
 *   - TED: in produzione solo dal deploy di produzione su Vercel (VERCEL_ENV=production), mai da un computer locale;
 *   - un database non riconosciuto vale come produzione.
 * Una fonte fuori dall'elenco (per esempio «manuale» dei collegamenti) non è mai autorizzata.
 */
export function fonteAutorizzata(fonte: string, uso: UsoFonte, env: Record<string, string | undefined>): PermessoScrittura {
  const ambiente = ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL);
  const cosa = uso === "importazione" ? "nessuna scrittura" : "nessuna notifica";
  if (!(FONTI_RADAR as readonly string[]).includes(fonte)) return { ok: false, ambiente, motivo: `Fonte non riconosciuta: ${cosa}.` };
  if (env.VERCEL_ENV === "preview") {
    return { ok: false, ambiente, motivo: uso === "importazione" ? MOTIVO_ANTEPRIMA : "Anteprima Vercel: le notifiche sono spente (la Preview legge lo staging, non lo scrive)." };
  }
  if (ambiente === "staging") return { ok: true, ambiente };
  // K8 (L6 del piano 36, 48C §3.7): PVL, Sintel e SardegnaCAT in produzione SOLO se ci sono tutte e tre le condizioni: deploy di produzione
  // su Vercel, database di produzione e la variabile della fonte RADAR_<FONTE>_PRODUZIONE=autorizzata (creata solo con l'autorizzazione
  // dell'utente). Senza la variabile tutto resta com'era (stessi motivi)
  const variabile = VARIABILI_PRODUZIONE[fonte as FonteRadar];
  if (variabile && ambiente === "produzione" && env.VERCEL_ENV === "production") {
    if (env[variabile] === "autorizzata") return { ok: true, ambiente };
    // sul deploy di produzione manca solo la variabile: l'amministratore deve leggere esattamente che cosa manca
    return { ok: false, ambiente, motivo: `${NOMI_FONTI[fonte as FonteRadar]} in produzione richiede ${variabile}=autorizzata, che si crea solo con l'autorizzazione dell'utente: ${cosa}.` };
  }
  if (fonte === "pvl") return { ok: false, ambiente, motivo: `La PVL è autorizzata solo sullo staging: ${cosa} in questo database.` };
  if (fonte !== "ted") return { ok: false, ambiente, motivo: `Le fonti regionali sono autorizzate solo sullo staging: ${cosa} in questo database.` };
  if (ambiente === "produzione" && env.VERCEL_ENV === "production") return { ok: true, ambiente };
  return {
    ok: false,
    ambiente,
    motivo: uso === "importazione" ? "Scritture nell'archivio di produzione consentite solo dal deploy di produzione." : "Notifiche di produzione consentite solo dal deploy di produzione.",
  };
}

// Fase B2a: Sintel e SardegnaCAT (e ogni fonte nuova) come la PVL: solo staging, finché l'utente non autorizza la produzione.
// Fase B4: è lo stesso permesso di fonteAutorizzata per l'importazione (nome storico, usato da importatori, console e verifiche).
export function scrittureRadarConsentite(fonte: FonteRadar, env: Record<string, string | undefined>): PermessoScrittura {
  return fonteAutorizzata(fonte, "importazione", env);
}

// Pacchetto P (piano 55 §2, decisione dell'utente D-F del 23/11): un interruttore del radar con lo STESSO schema di K8. Acceso SOLO con il
// valore ESATTO della sua variabile (né «1», né «true», né spazi, né maiuscole diverse) e:
//   - sullo staging, come prima. `anteprimaSulloStaging` dice se vale anche sulle anteprime di Vercel, che leggono lo staging: sì per ciò che
//     le pagine solo LEGGONO (classificazioni), no per ciò che SCRIVE (evidenza);
//   - oppure in produzione, SOLO sul deploy di produzione di Vercel (VERCEL_ENV=production) con il database di produzione.
// Sempre spento su un database sconosciuto, da un ambiente locale o da un'anteprima verso la produzione. Senza la variabile: spento.
export function interruttoreRadar(env: Record<string, string | undefined>, variabile: string, valore: string, opzioni: { anteprimaSulloStaging: boolean }): boolean {
  if (env[variabile] !== valore) return false;
  const ambiente = ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL);
  if (ambiente === "staging") return opzioni.anteprimaSulloStaging || env.VERCEL_ENV !== "preview";
  return ambiente === "produzione" && env.VERCEL_ENV === "production";
}

// Fase B2b (17/11/2026): gli importatori tengono coerenti la colonna «settori», le righe della 0121 e lo stato della classificazione SOLO con
// l'interruttore acceso: RADAR_CLASSIFICAZIONI=attive. Di base è SPENTO. Sullo staging come prima (anche sulle anteprime, che leggono); in
// produzione col pacchetto P solo sul deploy di produzione (interruttoreRadar). Le pagine lo usano per leggere le classificazioni.
export function classificazioniAttive(env: Record<string, string | undefined>): boolean {
  return interruttoreRadar(env, "RADAR_CLASSIFICAZIONI", "attive", { anteprimaSulloStaging: true });
}
