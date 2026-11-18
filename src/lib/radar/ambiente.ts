// Protezione esplicita contro le scritture accidentali delle importazioni di Tender Intelligence nel database di PRODUZIONE (richiesta del
// titolare del 16/11/2026, dopo l'anteprima partita con le variabili di produzione). Logica pura: legge solo l'ambiente che riceve.
//
// Regole:
//   - PVL: scrive SOLO nello staging, sempre (uso sperimentale autorizzato solo lì). Con qualunque altro database il giro non parte;
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

// Fase B2a: Sintel e SardegnaCAT (e ogni fonte nuova) come la PVL: solo staging, finché l'utente non autorizza la produzione.
export function scrittureRadarConsentite(fonte: "ted" | "pvl" | "sintel" | "sardegnacat", env: Record<string, string | undefined>): PermessoScrittura {
  const ambiente = ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL);
  if (env.VERCEL_ENV === "preview") return { ok: false, ambiente, motivo: MOTIVO_ANTEPRIMA };
  if (ambiente === "staging") return { ok: true, ambiente };
  if (fonte === "pvl") return { ok: false, ambiente, motivo: "La PVL è autorizzata solo sullo staging: nessuna scrittura in questo database." };
  if (fonte !== "ted") return { ok: false, ambiente, motivo: "Le fonti regionali sono autorizzate solo sullo staging: nessuna scrittura in questo database." };
  if (ambiente === "produzione" && env.VERCEL_ENV === "production") return { ok: true, ambiente };
  return { ok: false, ambiente, motivo: "Scritture nell'archivio di produzione consentite solo dal deploy di produzione." };
}

// Fase B2b (17/11/2026): gli importatori tengono coerenti la colonna «settori», le righe della 0121 e lo stato della classificazione SOLO con
// l'interruttore acceso: RADAR_CLASSIFICAZIONI=attive e SOLO sullo staging. Di base è SPENTO (il modulo resta disattivato durante la
// costruzione); in produzione resta spento finché l'utente non lo autorizza.
export function classificazioniAttive(env: Record<string, string | undefined>): boolean {
  return env.RADAR_CLASSIFICAZIONI === "attive" && ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL) === "staging";
}
