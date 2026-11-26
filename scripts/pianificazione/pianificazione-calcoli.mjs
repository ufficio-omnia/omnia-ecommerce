// Pianificazione dello staging (decisione dell'utente del 23/11, documento 54A; richieste nel documento 54): logica PURA del lanciatore dei
// giri pianificati. Nessuna rete, nessun database, nessun file: provata da scripts/verifica-pianificazione-staging.ts.
//   - quale autorizzazione usa un giro: quella VALIDA della fonte (non revocata, non scaduta, non esaurita, senza esecuzioni aperte), della
//     sessione e della cartella della pianificazione, con il comando ESATTO della fonte. Nessuna valida = il giro non parte (blocco automatico
//     alla scadenza; il rinnovo è una nuova autorizzazione, mai automatica). Più di una valida = ambiguità: il giro non parte;
//   - i controlli della cartella: commit e impronta dello script dichiarati NELL'autorizzazione, albero pulito;
//   - l'ambiente del giro: staging SOLO dalla guardia, variabili vietate tolte, npx senza rete;
//   - la riga del registro locale: solo numeri e motivi, mai testo libero.

// Sessione a cui il coordinatore lega le quattro autorizzazioni della pianificazione. Il registro accetta solo identificativi «local_…»
// (registro.mjs, rilascia): si usa quello di B2, che ha preparato la pianificazione (documento 54 §3, proposta A). Con la proposta B il
// coordinatore cambierebbe la regola del registro e questa costante.
export const SESSIONE_PIANIFICAZIONE = "local_2d381c41-6b2d-4db3-84dc-0a84c65b2b03";

// La cartella DEDICATA dei giri pianificati: una worktree ferma sul commit autorizzato (documento 54 §1), mai il ramo di lavoro. Le
// autorizzazioni della pianificazione si riconoscono da questa cartella (la sessione è la stessa delle autorizzazioni manuali di B2).
export const CARTELLA_PIANIFICAZIONE = "C:/Users/Dell/Desktop/OMNIA-PROGETTO1/.claude/worktrees/pianificazione-staging";
export const eCartellaPianificazione = (c) => stessaCartella(c, CARTELLA_PIANIFICAZIONE);

// Fase 2 (26/11): anche SATER; come le altre, un giro pianificato parte solo con la SUA autorizzazione registrata
export const FONTI_PIANIFICATE = ["ted", "pvl", "sintel", "sardegnacat", "sater"];

// Il comando ESATTO di ogni fonte: deve coincidere con quello registrato nell'autorizzazione (esegui-autorizzato.mjs lo verifica di nuovo).
export const COMANDI_PIANIFICATI = {
  ted: ["npx", "tsx", "scripts/radar-importa-ted.ts"],
  pvl: ["npx", "tsx", "scripts/radar-importa-pvl.ts", "incrementale"],
  sintel: ["npx", "tsx", "scripts/radar-importa-regionale.ts", "sintel"],
  sardegnacat: ["npx", "tsx", "scripts/radar-importa-regionale.ts", "sardegnacat"],
  sater: ["npx", "tsx", "scripts/radar-importa-regionale.ts", "sater"],
};
export const SCRIPT_DELLA_FONTE = { ted: "scripts/radar-importa-ted.ts", pvl: "scripts/radar-importa-pvl.ts", sintel: "scripts/radar-importa-regionale.ts", sardegnacat: "scripts/radar-importa-regionale.ts", sater: "scripts/radar-importa-regionale.ts" };

export const STAGING_REF = "ryawdldqiumqsskrnyps";
export const PRODUZIONE_REF = "bihfrzspqxsrzlbqqvqa";

function stessaCartella(a, b) { return confrontabile(a) === confrontabile(b); }
function confrontabile(x) { return String(x ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(); }
const stessoComando = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * L'autorizzazione del giro, dagli eventi del registro (leggiRegistro). `{ aut }` se ce n'è UNA valida; altrimenti `{ motivo }`:
 * «nessuna_autorizzazione» (mai rilasciata per questa fonte e cartella), «scaduta», «esaurita», «revocata», «esecuzione_aperta»,
 * «senza_commit» (manca il commit o l'impronta dello script nell'ambiente dell'autorizzazione), «piu_autorizzazioni».
 */
export function scegliAutorizzazione(eventi, { fonte, sessione = SESSIONE_PIANIFICAZIONE, cartella, adesso }) {
  const comando = COMANDI_PIANIFICATI[fonte];
  if (!comando) return { motivo: "fonte_sconosciuta" };
  const rilasci = eventi.filter((e) => e.evento === "rilascio" && e.tipo === "importazione" && e.sessione === sessione && stessaCartella(e.cartella, cartella)
    && Array.isArray(e.comandi) && e.comandi.length === 1 && stessoComando(e.comandi[0], comando) && Array.isArray(e.semaforo) && e.semaforo.length === 1 && e.semaforo[0] === fonte);
  if (!rilasci.length) return { motivo: "nessuna_autorizzazione" };
  const stato = (a) => {
    if (eventi.some((e) => e.evento === "revoca" && e.id === a.id)) return "revocata";
    if (!(Date.parse(a.scade_il) > adesso.getTime())) return "scaduta";
    const ricevute = eventi.filter((e) => e.evento === "ricevuta" && e.id === a.id);
    const esiti = eventi.filter((e) => e.evento === "esito" && e.id === a.id);
    if (ricevute.some((r) => !esiti.some((x) => x.uso === r.uso))) return "esecuzione_aperta";
    if (ricevute.length >= a.usi_max) return "esaurita";
    if (!/^[0-9a-f]{40}$/.test(a.ambiente?.PIANIFICAZIONE_COMMIT ?? "") || !/^[0-9a-f]{64}$/.test(a.ambiente?.PIANIFICAZIONE_SCRIPT_SHA256 ?? "")) return "senza_commit";
    return "valida";
  };
  const valide = rilasci.filter((a) => stato(a) === "valida");
  if (valide.length > 1) return { motivo: "piu_autorizzazioni" };
  if (valide.length === 1) return { aut: valide[0] };
  // il motivo è quello dell'autorizzazione più recente della fonte
  return { motivo: stato(rilasci[rilasci.length - 1]) };
}

/** I controlli della cartella prima del giro: null se tutto torna, altrimenti il motivo. */
export function controlliCartella({ head, porcelain, impronta, aut }) {
  if (head !== aut.ambiente.PIANIFICAZIONE_COMMIT) return "commit_diverso";
  const sporche = String(porcelain ?? "").split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l && l !== "?? supabase/.temp/");
  if (sporche.length) return "albero_non_pulito";
  if (impronta !== aut.ambiente.PIANIFICAZIONE_SCRIPT_SHA256) return "impronta_diversa";
  return null;
}

// variabili che non devono MAI arrivare a un giro dello staging (documento 54): contatto dello User-Agent (D7, solo produzione), email
// (spente fino alla fase F8), Vercel, produzione, cron, porta delle autorizzazioni (la mette il lanciatore registrato). L'evidenza NON è
// vietata: nel collaudo F1 è ACCESA come in produzione (C12, coordinamento del 23/11), la mette ambienteDelGiro
export function variabileVietata(k) {
  return ["RADAR_CONTATTO_FONTI", "RADAR_NOTIFICHE_EMAIL", "TI_REGISTRO", "TI_AUTORIZZAZIONE", "TI_USO"].includes(k)
    || /^VERCEL/.test(k) || /^RADAR_[A-Z]+_PRODUZIONE$/.test(k) || /^RADAR_[A-Z]+_CRON$/.test(k);
}

/** L'ambiente del giro: quello del processo senza le variabili vietate né valori della produzione, più lo staging dalla guardia. */
export function ambienteDelGiro(base, staging) {
  if (staging.STAGING_PROJECT_REF !== STAGING_REF || staging.STAGING_SUPABASE_URL !== `https://${STAGING_REF}.supabase.co`) throw new Error("guardia: non è lo staging");
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (variabileVietata(k) || /^RADAR_/.test(k) || /^NEXT_PUBLIC_SUPABASE|^SUPABASE_/.test(k)) continue;
    if (typeof v === "string" && v.includes(PRODUZIONE_REF)) continue;
    env[k] = v;
  }
  return {
    ...env,
    NEXT_PUBLIC_SUPABASE_URL: staging.STAGING_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: staging.STAGING_SECRET_KEY,
    RADAR_STAGING_REF: STAGING_REF,
    RADAR_CLASSIFICAZIONI: "attive",
    // C12: evidenza delle modifiche (0123) accesa come in produzione; le email restano spente (nessun RADAR_NOTIFICHE_EMAIL)
    RADAR_REGISTRO_EVIDENZA: "attivo",
    // npx non scarica mai nulla: se tsx non c'è nella cartella, il giro fallisce invece di andare in rete
    npm_config_offline: "true",
  };
}

// i motivi che si possono scrivere nel registro locale: parole in minuscolo, mai testo libero della fonte o del database
const MOTIVO = /^[a-z_]{1,40}$/;

/** L'ultima riga JSON dell'uscita del giro (l'esito che gli script stampano), o null. */
export function esitoDaUscita(uscita) {
  const s = String(uscita ?? "");
  const fine = s.lastIndexOf("}");
  for (let i = s.lastIndexOf("{\n", fine); i >= 0; i = s.lastIndexOf("{\n", i - 1)) {
    try {
      return JSON.parse(s.slice(i, fine + 1));
    } catch {
      // un'apertura interna: si prova quella prima
    }
  }
  return null;
}

/** La riga del registro locale del lanciatore: solo numeri, booleani e motivi in parole fisse. */
export function rigaLog({ inizio, fine, fonte, aut, uso = null, codice, esito, motivo = null }) {
  const n = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const st = esito && typeof esito === "object" ? esito.statistiche ?? {} : {};
  return {
    inizio,
    durata_s: n((Date.parse(fine) - Date.parse(inizio)) / 1000),
    fonte,
    aut: /^AUT-\d{8}-\d{2}$/.test(aut ?? "") ? aut : null,
    uso: /^USO-[0-9a-f]{12}$/.test(uso ?? "") ? uso : null,
    codice: n(codice),
    motivo: MOTIVO.test(motivo ?? "") ? motivo : null,
    eseguita: typeof esito?.eseguita === "boolean" ? esito.eseguita : null,
    motivo_giro: MOTIVO.test(esito?.motivo ?? "") ? esito.motivo : null,
    con_errore: esito ? !!esito.errore : null,
    sospesa: typeof esito?.sospesa === "boolean" ? esito.sospesa : null,
    richieste_fonte: n(st.pvl?.richieste ?? st.fonte?.richieste ?? st.ted?.richieste ?? null),
    letti: n(st.avvisi?.letti ?? st.letti ?? null),
    gare_nuove: n(st.nuove ?? st.bandi?.nuoveNazionali ?? null),
  };
}
