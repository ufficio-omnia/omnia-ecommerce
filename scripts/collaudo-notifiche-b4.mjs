// Collaudo CON ACCESSO della fase B4, GRADO 3: pagina «Notifiche» (preferenze delle email) sullo STAGING, con la sola 0124 applicata (Z2) e
// SENZA motore, coda ne' email (0125 assente, RADAR_NOTIFICHE_EMAIL e RADAR_REGISTRO_EVIDENZA spenti). Piano 41
// (41_PIANO_COLLAUDO_B4_GRADO_3.md). Scrive sullo staging (sessioni, presenza, le righe della 0124): parte SOLO con un'autorizzazione
// registrata del coordinatore (tipo «scrittura_prova», 1 uso), lanciato da esegui-autorizzato.mjs dalla cartella dell'anteprima.
// Stesso schema di collaudo-accesso-b4.mjs (collaudato il 19/11), di cui riusa la pagina d'accesso, i collegamenti e le letture.
//
//   node scripts/collaudo-notifiche-b4.mjs <file delle variabili> <porta>      → la finestra (solo con autorizzazione registrata)
//   node scripts/collaudo-notifiche-b4.mjs --preliminare <porta>               → controllo PRELIMINARE: solo /pronto con i pulsanti bloccati;
//                                                                              nessuna autorizzazione, nessun file delle variabili, nessuna rete
//   node scripts/collaudo-notifiche-b4.mjs --misure <registro> <finestre.json> → controllo 11: richieste per vista dal registro dell'osservatore
//
// Finestra, in ordine, fermandosi al primo problema PRIMA di qualunque rete:
//   1. porta delle autorizzazioni (TI_REGISTRO, controllaPorta);
//   2. guardia: file delle variabili FUORI dal repository; Supabase = SOLO lo staging; RADAR_NOTIFICHE_PREFERENZE e RADAR_UFFICIO_GARE
//      «attivo»; RADAR_NOTIFICHE_EMAIL e RADAR_REGISTRO_EVIDENZA SPENTI; lanciatore dell'anteprima presente; registro dell'osservatore di
//      rete indicato (OSSERVA_RETE_FILE): senza sorveglianza della rete la finestra non parte;
//   3. pagina d'accesso solo sul loopback («localhost», porta dell'app + 1), SENZA collegamenti: un pulsante per utente, nell'ordine
//      1 (titolare-benchmark, impresa 3) → 2 (ti-titolare, impresa 1) → 3 (ufficio-benchmark, Ufficio Gare dell'impresa 3);
//   4. avvio dell'app come la Preview (scripts/avvia-anteprima-locale.mjs) e SORVEGLIANZA DELLA RETE: una sola richiesta del server verso un
//      host diverso dallo staging o da «localhost» (Resend compreso) = FERMO;
//   5. SOLO al clic: prerequisiti letti con la chiave di servizio (solo GET; se mancano: 409, nessun collegamento), poi il collegamento di
//      QUELL'utente, verificato subito lato server. PRIMA di mandare il browser nell'app, con il token solo in memoria: identità, positivi,
//      cinque tentativi di scrittura innocui sulle tabelle della 0124 (attesi 401/403), la funzione dei destinatari non chiamabile dal token
//      (401/403/404), l'isolamento da tutte le altre imprese (0124 e le 11 tabelle dei gradi 1–2);
//   6. «Verifiche finali» (dopo il passo 3): solo GET con la chiave di servizio: righe della 0124 nei tetti e di soli utenti di prova,
//      autori giusti, nessuna riaccensione dall'Ufficio Gare, nulla scritto altrove, 0125 assente, nessuna richiesta esterna nel registro;
//   7. VIOLAZIONE o ERRORE = FERMO (nessun cookie, ogni altro pulsante 423, app spenta, uscita 3); finestra oltre DURATA_MASSIMA_MIN: fermo
//      (o chiusura normale se le verifiche finali sono già fatte);
//   8. alla chiusura il resoconto dei 12 controlli (parte lato server).
//
// Mai token, chiavi, cookie, collegamenti o id completi a schermo, nei log o su disco. L'unico id mostrato, SOLO nella pagina /pronto su
// localhost e mai nell'uscita, è quello dell'utente di prova titolare-benchmark, che serve al passo 2c (azione diretta verso l'impresa 3).
// Le prove di questo script sono solo a secco (scripts/verifica-collaudo-notifiche-b4.ts), mai contro lo staging.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Fermo,
  ID_IMPOSSIBILE,
  IMPRESA_1,
  IMPRESA_2,
  IMPRESA_3,
  IMPRESE,
  MARGINE_INIZIO_MS,
  SOLO_LOCALE,
  STAGING_URL,
  STATI_SCRITTURA_RESPINTA,
  TABELLE_ISOLAMENTO,
  UFFICIO_GARE,
  analizzaRegistro,
  ascoltaSoloLocale,
  categoria,
  chiudi,
  cookieDiSessione,
  creaLettore,
  dentro,
  erroriAmbienteBase,
  esitoControllo,
  generaCollegamento,
  leggiVariabili,
  misura,
  nomeUtente,
  rigaVoce,
  serverAccesso,
} from "./collaudo-accesso-b4.mjs";

export const NOME_SCRIPT = "collaudo-notifiche-b4.mjs";
export const NOTIFICHE = "/dashboard/omnia-ai/opportunita/notifiche";
export const TABELLA_IMPRESA = "omnia_ai_radar_notifiche_impresa";
export const TABELLA_PERSONE = "omnia_ai_radar_notifiche_persone";
/** Le tabelle della 0124, con la colonna dell'impresa (isolamento). */
export const TABELLE_0124 = [
  { tabella: TABELLA_IMPRESA, colonna: "impresa_id" },
  { tabella: TABELLA_PERSONE, colonna: "impresa_id" },
];
/** Le tabelle della 0125: nel perimetro di Z2/Z3 NON devono esistere. */
export const TABELLE_0125 = ["omnia_ai_radar_eventi", "omnia_ai_radar_email_consegne", "radar_notifiche_giri"];
/** La funzione dei destinatari (0125, solo servizio): dal token deve essere respinta o assente. */
export const STATI_FUNZIONE_RESPINTA = new Set([401, 403, 404]);
export const DURATA_MASSIMA_MIN = 35;
/** Tetti delle righe della 0124 (piano 41 §4): imprese 1 e 3; persone: titolare 3, Ufficio Gare 3, titolare 1. */
export const TETTO_IMPRESA = 2;
export const TETTO_PERSONE = 3;

// Gli utenti del grado 3, NELL'ORDINE del piano 41: l'impresa 3 accende per prima, così l'isolamento 1 → 3 e 3 → 1 si prova su righe vere.
export const UTENTI_NOTIFICHE = [
  {
    email: IMPRESA_3,
    zona: "omnia-ai",
    arrivo: NOTIFICHE,
    passo: "1",
    ruolo: "titolare",
    impresa: IMPRESA_3,
    primo: true,
    prerequisiti: ["tabelle_0124", "0125_assente", "radar_impresa", "membri_impresa_3"],
    compito: "accende gli avvisi email dell'impresa 3, spegne «Nuove opportunità» nelle proprie preferenze, schermate a 1280 e 375 px, poi Esci",
  },
  {
    email: IMPRESA_1,
    zona: "omnia-ai",
    arrivo: NOTIFICHE,
    passo: "2",
    ruolo: "titolare",
    impresa: IMPRESA_1,
    prerequisiti: ["radar_impresa", "membri_impresa_1", "impresa_3_accesa"],
    compito: "accende gli avvisi dell'impresa 1, spegne «Scadenze», azione diretta verso la persona dell'impresa 3 (attesa «Persona non valida.»), 60 s fermi, schermate, poi Esci",
  },
  {
    email: UFFICIO_GARE,
    zona: "omnia-ai",
    arrivo: NOTIFICHE,
    passo: "3",
    ruolo: "ufficio_gare",
    impresa: IMPRESA_3,
    prerequisiti: ["membro_attivo", "impresa_3_accesa"],
    compito: "vede l'interruttore senza poterlo cambiare, spegne «Rettifiche», prova a riaccendere «Nuove opportunità» (atteso il rifiuto), schermate, poi Esci",
  },
];

// I 12 controlli obbligatori del grado 3 (piano 41 §5bis): che cosa verifica lo script lato server e che cosa si osserva nel browser.
export const CONTROLLI = [
  { n: 1, titolo: "Pagina «Notifiche» raggiungibile, con l'interruttore acceso, da titolare e Ufficio Gare", browser: "passi 1a, 2a, 3a (scheda «Notifiche» presente, arrivo diretto)" },
  { n: 2, titolo: "Avviso «Gli avvisi email non sono ancora attivi» sempre presente", browser: "letturaNotifiche su ogni vista (avviso: sì)" },
  { n: 3, titolo: "Il titolare accende l'interruttore dell'impresa: riga dell'impresa e righe iniziali D-E4", browser: "passi 1b, 2b" },
  { n: 4, titolo: "Il titolare cambia le proprie preferenze (senza la 0125: «Lo stato degli indirizzi non è ancora disponibile»)", browser: "passi 1c, 2c" },
  { n: 5, titolo: "L'Ufficio Gare vede l'interruttore dell'impresa senza poterlo cambiare", browser: "passo 3a (nessun pulsante, «dal titolare dell'impresa»)" },
  { n: 6, titolo: "L'Ufficio Gare spegne solo le proprie, non riaccende, vede solo la propria riga", browser: "passi 3b, 3c (provaRiaccensione: «Per riaccendere…»), 3d" },
  { n: 7, titolo: "Isolamento tra imprese (1 ↔ 3, e 2), anche con l'azione diretta tra imprese", browser: "passo 2d (provaAzioneDirettaPersona: «Persona non valida.»)" },
  { n: 8, titolo: "API dirette respinte: scritture sulla 0124 (401/403) e funzione dei destinatari (401/403/404) dal token", browser: null },
  { n: 9, titolo: "Scritture nei tetti: impresa ≤ 2, persone ≤ 3, solo utenti di prova, 0 altrove", browser: null },
  { n: 10, titolo: "Nessuna email e nessuna richiesta esterna: sorveglianza della rete, 0125 assente, motore spento", browser: null },
  { n: 11, titolo: "Nessun aggiornamento periodico della pagina: 60 s fermi = 0 richieste di Opportunità", browser: "passo 2e; conteggio con --misure" },
  { n: 12, titolo: "Schermate a 1280 e 375 px di titolare e Ufficio Gare", browser: "passi 1d, 2f, 3e" },
];

/** I problemi dell'ambiente del grado 3 (solo nomi, mai valori). */
export function erroriAmbienteNotifiche(v) {
  const e = erroriAmbienteBase(v);
  if (v.RADAR_NOTIFICHE_PREFERENZE !== "attivo") e.push("RADAR_NOTIFICHE_PREFERENZE non è «attivo»");
  if (v.RADAR_UFFICIO_GARE !== "attivo") e.push("RADAR_UFFICIO_GARE non è «attivo» (l'Ufficio Gare non entrerebbe in Opportunità)");
  for (const k of ["RADAR_NOTIFICHE_EMAIL", "RADAR_REGISTRO_EVIDENZA"]) if (!["", "0"].includes(v[k] ?? "")) e.push(`${k} deve essere spento (vuoto o «0»)`);
  return [...new Set(e)];
}

const descrivi = (x) => (x.n !== undefined ? String(x.n) : `errore ${x.errore}`);
const voce = (controllo, testo, esito) => ({ controllo, testo, esito });
const enc = encodeURIComponent;

// ───── prerequisiti (chiave di servizio, solo GET) ─────

/** Prerequisiti di un utente PRIMA di generare il suo collegamento: { ok, motivo }. Se mancano, nessun collegamento e 409. */
export async function verificaPrerequisitiNotifiche({ lettore, utente, ricorda = () => {} }) {
  const [id1, id3, idUfficio] = await Promise.all([lettore.idDi(IMPRESA_1), lettore.idDi(IMPRESA_3), lettore.idDi(UFFICIO_GARE)]);
  if (!id1 || !id3 || !idUfficio) return { ok: false, motivo: "utenti di prova non trovati" };
  ricorda({ id3 });
  const idImpresa = utente.impresa === IMPRESA_1 ? id1 : id3;
  for (const p of utente.prerequisiti ?? []) {
    if (p === "tabelle_0124") {
      for (const { tabella, colonna } of TABELLE_0124) {
        const r = await lettore.conta(tabella, colonna, `${colonna}=not.is.null`);
        if (r.errore !== undefined) return { ok: false, motivo: `la 0124 non risulta applicata (${tabella}: ${descrivi(r)})` };
      }
    }
    if (p === "0125_assente") {
      for (const t of TABELLE_0125) {
        const r = await lettore.conta(t, "id", "id=not.is.null");
        if (r.errore !== 404) return { ok: false, motivo: `${t} risponde ${descrivi(r)}: la 0125 sembra applicata, perimetro diverso dal piano 41` };
      }
    }
    if (p === "radar_impresa") {
      const r = await lettore.conta("omnia_ai_radar_impostazioni", "user_id", `user_id=eq.${idImpresa}&attivo=eq.true`);
      if (r.n !== 1) return { ok: false, motivo: `il Radar dell'impresa di ${nomeUtente(utente.impresa)} non risulta abilitato (${descrivi(r)})` };
    }
    if (p === "membri_impresa_3") {
      const [tutti, ufficio] = await Promise.all([
        lettore.conta("omnia_ai_membri", "membro_id", `titolare_id=eq.${id3}&attivo=eq.true`),
        lettore.conta("omnia_ai_membri", "membro_id", `titolare_id=eq.${id3}&membro_id=eq.${idUfficio}&attivo=eq.true`),
      ]);
      if (tutti.n !== 1 || ufficio.n !== 1) return { ok: false, motivo: `l'impresa 3 deve avere un solo Ufficio Gare attivo, ${nomeUtente(UFFICIO_GARE)} (attivi ${descrivi(tutti)}, suo ${descrivi(ufficio)}): altrimenti le righe iniziali superano il tetto` };
    }
    if (p === "membri_impresa_1") {
      const r = await lettore.conta("omnia_ai_membri", "membro_id", `titolare_id=eq.${id1}&attivo=eq.true`);
      if (r.n !== 0) return { ok: false, motivo: `l'impresa 1 ha membri attivi dell'Ufficio Gare (${descrivi(r)}): le righe iniziali supererebbero il tetto` };
    }
    if (p === "membro_attivo") {
      const r = await lettore.conta("omnia_ai_membri", "membro_id", `membro_id=eq.${idUfficio}&titolare_id=eq.${id3}&attivo=eq.true`);
      if (r.n !== 1) return { ok: false, motivo: `${nomeUtente(UFFICIO_GARE)} non risulta Ufficio Gare attivo dell'impresa 3 (${descrivi(r)})` };
    }
    if (p === "impresa_3_accesa") {
      const r = await lettore.conta(TABELLA_IMPRESA, "impresa_id", `impresa_id=eq.${id3}&email_attive=eq.true`);
      if (r.n !== 1) return { ok: false, motivo: `gli avvisi email dell'impresa 3 non risultano accesi (${descrivi(r)}): completare prima il passo 1` };
    }
  }
  return { ok: true, motivo: "" };
}

// ───── verifiche lato server con il token, PRIMA che il browser entri nell'app ─────

/**
 * Tentativi di scrittura diretta sulla 0124 con il token: costruiti per NON scrivere nulla nemmeno se, per errore, fossero ammessi
 * (filtri impossibili, oppure righe che violano una chiave esterna). Attesi 401 o 403 (la 0124 dà ai clienti solo la lettura).
 */
export function tentativiNotifiche(idImpresa, idUtente) {
  const impresa = `${STAGING_URL}/rest/v1/${TABELLA_IMPRESA}`;
  const persone = `${STAGING_URL}/rest/v1/${TABELLA_PERSONE}`;
  return [
    { lettera: "a", metodo: "PATCH", url: `${impresa}?impresa_id=eq.${idImpresa}&creato_il=lt.2000-01-01T00:00:00Z`, corpo: { email_attive: false } },
    { lettera: "b", metodo: "PATCH", url: `${persone}?impresa_id=eq.${idImpresa}&user_id=eq.${ID_IMPOSSIBILE}`, corpo: { scadenze: true } },
    { lettera: "c", metodo: "DELETE", url: `${persone}?impresa_id=eq.${ID_IMPOSSIBILE}`, corpo: null },
    { lettera: "d", metodo: "POST", url: persone, corpo: { impresa_id: ID_IMPOSSIBILE, user_id: idUtente, scadenze: true } },
    { lettera: "e", metodo: "POST", url: impresa, corpo: { impresa_id: ID_IMPOSSIBILE, email_attive: true } },
  ];
}

/** La funzione dei destinatari chiesta dal token per un'ALTRA impresa: deve essere assente o respinta (mai righe). */
export const chiamataDestinatari = (idAltra) => ({ lettera: "f", metodo: "POST", url: `${STAGING_URL}/rest/v1/rpc/radar_notifiche_destinatari`, corpo: { p_imprese: [idAltra] } });

async function positivo(lettore, controllo, testo, tabella, colonna, filtro, token) {
  const [esistono, viste] = await Promise.all([lettore.conta(tabella, colonna, filtro), lettore.conta(tabella, colonna, filtro, token)]);
  let esito = "ok";
  if (esistono.errore !== undefined || viste.errore !== undefined) esito = "ERRORE";
  else if (esistono.n === 0 || viste.n !== esistono.n) esito = "ERRORE";
  return voce(controllo, `${testo}: viste ${descrivi(viste)}, esistenti ${descrivi(esistono)} (attese uguali e almeno 1)`, esito);
}

async function isolamento(lettore, nome, nomeAltra, { tabella, colonna }, idAltra, token) {
  const filtro = `${colonna}=eq.${idAltra}`;
  const [esistono, viste] = await Promise.all([lettore.conta(tabella, colonna, filtro), lettore.conta(tabella, colonna, filtro, token)]);
  let esito;
  if (viste.n > 0) esito = "VIOLAZIONE";
  else if (viste.errore !== undefined && !STATI_SCRITTURA_RESPINTA.has(viste.errore)) esito = "ERRORE";
  else if (esistono.errore !== undefined) esito = "ERRORE";
  else if (esistono.n === 0) esito = "non applicabile (l'altra impresa non ha righe)";
  else esito = viste.n === 0 ? "ok" : `ok (accesso negato, ${viste.errore})`;
  return voce(7, `${nome} → impresa di ${nomeAltra}, ${tabella}: viste ${descrivi(viste)}, esistenti ${descrivi(esistono)}`, esito);
}

/** Le verifiche con la sessione appena creata. Ogni eccezione diventa una voce ERRORE (quindi FERMO). */
export async function verificheDopoAccessoNotifiche({ lettore, utente, accessToken }) {
  const nome = nomeUtente(utente.email);
  const voci = [];
  try {
    const io = await lettore.identita(accessToken);
    if (!io || io.email !== utente.email) return { voci: [voce(1, `${nome}: identità della sessione non riconosciuta`, "ERRORE")] };
    voci.push(voce(1, `${nome}: identità della sessione = utente del clic`, "ok"));
    const [idImpresa, id3] = await Promise.all([lettore.idDi(utente.impresa), lettore.idDi(IMPRESA_3)]);
    if (!idImpresa || !id3) return { voci: [...voci, voce(7, `${nome}: impresa non trovata`, "ERRORE")] };
    voci.push(await positivo(lettore, 7, `${nome}: propria riga di users`, "users", "id", `id=eq.${io.id}`, accessToken));

    // controllo 9: all'apertura della finestra la 0124 è vuota (i tetti si contano da zero)
    if (utente.primo) {
      for (const { tabella, colonna } of TABELLE_0124) {
        const r = await lettore.conta(tabella, colonna, `${colonna}=not.is.null`);
        voci.push(voce(9, `${tabella} all'apertura della finestra: ${descrivi(r)} righe (attese 0)`, r.n === 0 ? "ok" : "ERRORE"));
      }
    }
    // controlli 5 e 6: l'Ufficio Gare legge la riga dell'impresa e SOLO la propria riga delle persone
    if (utente.ruolo === "ufficio_gare") {
      voci.push(await positivo(lettore, 6, `${nome}: iscrizione attiva all'Ufficio Gare dell'impresa 3`, "omnia_ai_membri", "membro_id", `membro_id=eq.${io.id}&titolare_id=eq.${id3}&attivo=eq.true`, accessToken));
      voci.push(await positivo(lettore, 5, `${nome}: riga dell'interruttore dell'impresa 3 letta con la sua sessione`, TABELLA_IMPRESA, "impresa_id", `impresa_id=eq.${id3}`, accessToken));
      voci.push(await positivo(lettore, 6, `${nome}: propria riga delle preferenze`, TABELLA_PERSONE, "user_id", `impresa_id=eq.${id3}&user_id=eq.${io.id}`, accessToken));
      const filtro = `impresa_id=eq.${id3}&user_id=eq.${id3}`;
      const [esistono, viste] = await Promise.all([lettore.conta(TABELLA_PERSONE, "user_id", filtro), lettore.conta(TABELLA_PERSONE, "user_id", filtro, accessToken)]);
      let esito = "ok";
      if (viste.n > 0) esito = "VIOLAZIONE";
      else if (viste.errore !== undefined || esistono.errore !== undefined) esito = "ERRORE";
      else if (esistono.n !== 1) esito = "NON RIUSCITO (manca la riga del titolare: passo 1)";
      voci.push(voce(6, `${nome}: riga delle preferenze del titolare dell'impresa 3: viste ${descrivi(viste)}, esistenti ${descrivi(esistono)} (attese 0 viste)`, esito));
    }

    // controllo 8: cinque tentativi di scrittura diretta sulla 0124 e la funzione dei destinatari, con il token
    for (const t of tentativiNotifiche(idImpresa, io.id)) {
      let stato;
      try {
        stato = await lettore.tenta(t, accessToken);
      } catch {
        stato = "rete";
      }
      const tabella = t.url.includes(TABELLA_IMPRESA) ? TABELLA_IMPRESA : TABELLA_PERSONE;
      voci.push(voce(8, `${nome}: tentativo ${t.lettera} (${t.metodo} su ${tabella}) risposta ${stato} (attesa 401 o 403)`, STATI_SCRITTURA_RESPINTA.has(stato) ? "ok" : stato === "rete" ? "ERRORE" : "VIOLAZIONE"));
    }

    // controllo 7: isolamento da TUTTE le altre imprese: 0124 e le 11 tabelle dei gradi 1–2; controllo 8: la funzione per un'altra impresa
    for (const altra of IMPRESE.filter((x) => x !== utente.impresa)) {
      const idAltra = await lettore.idDi(altra);
      if (!idAltra) {
        voci.push(voce(7, `${nome}: impresa di ${nomeUtente(altra)} non trovata`, "ERRORE"));
        continue;
      }
      voci.push(...(await Promise.all([...TABELLE_0124, ...TABELLE_ISOLAMENTO].map((t) => isolamento(lettore, nome, nomeUtente(altra), t, idAltra, accessToken)))));
      let stato;
      try {
        stato = await lettore.tenta(chiamataDestinatari(idAltra), accessToken);
      } catch {
        stato = "rete";
      }
      voci.push(voce(8, `${nome}: funzione dei destinatari per l'impresa di ${nomeUtente(altra)} risposta ${stato} (attesa 401, 403 o 404)`, STATI_FUNZIONE_RESPINTA.has(stato) ? "ok" : stato === "rete" ? "ERRORE" : "VIOLAZIONE"));
    }
  } catch {
    voci.push(voce(7, `${nome}: verifica interrotta da un errore`, "ERRORE"));
  }
  return { voci };
}

// ───── verifiche finali (dopo il passo 3), SOLO chiave di servizio e SOLO GET ─────

/** Righe di una tabella scritte o toccate nella finestra: unione, per chiave, delle letture con ogni colonna di data. */
async function toccateNellaFinestra(lettore, tabella, colonne, chiave, colonneData, inizio) {
  const per = new Map();
  for (const c of colonneData) {
    const r = await lettore.righe(tabella, colonne, `${c}=gte.${enc(inizio)}`);
    if (r.errore !== undefined) return { errore: r.errore };
    for (const x of r.righe) per.set(chiave(x), x);
  }
  return { righe: [...per.values()] };
}

/** Le categorie attese alla fine (piano 41 §3): D-E4 e poi una categoria spenta da ciascuno. */
export const ATTESE_FINALI = {
  titolare3: { nuove_opportunita: false, scadenze: true, rettifiche: true },
  ufficio3: { nuove_opportunita: false, scadenze: true, rettifiche: false },
  titolare1: { nuove_opportunita: true, scadenze: false, rettifiche: true },
};
const CATEGORIE = ["nuove_opportunita", "scadenze", "rettifiche"];
const uguali = (riga, attese) => CATEGORIE.every((c) => riga[c] === attese[c]);

export async function verificheFinaliNotifiche({ lettore, inizio, registroRete = null }) {
  const voci = [];
  try {
    const [id1, id2, id3, idUfficio] = await Promise.all([lettore.idDi(IMPRESA_1), lettore.idDi(IMPRESA_2), lettore.idDi(IMPRESA_3), lettore.idDi(UFFICIO_GARE)]);
    if (!id1 || !id2 || !id3 || !idUfficio) return [voce(9, "utenti di prova non trovati", "ERRORE")];
    const nome = new Map([[id1, nomeUtente(IMPRESA_1)], [id2, nomeUtente(IMPRESA_2)], [id3, nomeUtente(IMPRESA_3)], [idUfficio, nomeUtente(UFFICIO_GARE)]]);

    // 3, 5, 9: le righe dell'interruttore dell'impresa
    const imp = await toccateNellaFinestra(lettore, TABELLA_IMPRESA, "impresa_id,email_attive,aggiornato_da", (x) => x.impresa_id, ["creato_il", "aggiornato_il"], inizio);
    if (imp.errore !== undefined) voci.push(voce(9, `${TABELLA_IMPRESA}: lettura non riuscita (${imp.errore})`, "ERRORE"));
    else {
      const fuori = imp.righe.filter((r) => ![id1, id3].includes(r.impresa_id)).length;
      voci.push(voce(9, `${TABELLA_IMPRESA}: righe toccate nella finestra ${imp.righe.length} (tetto ${TETTO_IMPRESA}), di imprese fuori elenco ${fuori}`, imp.righe.length <= TETTO_IMPRESA && fuori === 0 ? "ok" : "VIOLAZIONE"));
      for (const id of [id3, id1]) {
        const r = imp.righe.find((x) => x.impresa_id === id);
        let esito = "ok";
        if (r && r.aggiornato_da !== id) esito = "VIOLAZIONE";
        else if (!r || r.email_attive !== true) esito = "NON RIUSCITO";
        const autore = r ? (r.aggiornato_da === id ? "il titolare" : r.aggiornato_da === idUfficio ? "l'Ufficio Gare" : "un altro utente") : "—";
        voci.push(voce(id === id3 ? 5 : 3, `interruttore dell'impresa di ${nome.get(id)}: ${r ? (r.email_attive ? "acceso" : "spento") : "assente"}, autore ${autore} (atteso acceso dal titolare)`, esito));
      }
    }
    const imp2 = await lettore.conta(TABELLA_IMPRESA, "impresa_id", `impresa_id=eq.${id2}`);
    voci.push(voce(7, `interruttore dell'impresa di ${nome.get(id2)}: ${descrivi(imp2)} righe (attese 0)`, imp2.errore !== undefined ? "ERRORE" : imp2.n === 0 ? "ok" : "VIOLAZIONE"));

    // 3, 4, 6, 7, 9: le righe delle persone
    const per = await toccateNellaFinestra(lettore, TABELLA_PERSONE, "impresa_id,user_id,nuove_opportunita,scadenze,rettifiche,aggiornato_da", (x) => `${x.impresa_id}/${x.user_id}`, ["creato_il", "aggiornato_il"], inizio);
    if (per.errore !== undefined) voci.push(voce(9, `${TABELLA_PERSONE}: lettura non riuscita (${per.errore})`, "ERRORE"));
    else {
      const ammesse = new Set([`${id3}/${id3}`, `${id3}/${idUfficio}`, `${id1}/${id1}`]);
      const fuori = per.righe.filter((r) => !ammesse.has(`${r.impresa_id}/${r.user_id}`)).length;
      voci.push(voce(9, `${TABELLA_PERSONE}: righe toccate nella finestra ${per.righe.length} (tetto ${TETTO_PERSONE}), fuori elenco ${fuori}`, per.righe.length <= TETTO_PERSONE && fuori === 0 ? "ok" : "VIOLAZIONE"));
      const riga = (imp, u) => per.righe.find((x) => x.impresa_id === imp && x.user_id === u);
      // titolare dell'impresa 3: righe iniziali e la sua scelta; MAI toccata dall'impresa 1 né dall'Ufficio Gare
      const t3 = riga(id3, id3);
      voci.push(voce(t3 && t3.aggiornato_da === id1 ? 7 : 4, `preferenze del titolare dell'impresa di ${nome.get(id3)}: ${t3 ? `autore ${t3.aggiornato_da === id3 ? "il titolare" : nome.get(t3.aggiornato_da) ?? "un altro utente"}, come atteso ${uguali(t3, ATTESE_FINALI.titolare3) ? "sì" : "no"}` : "assenti"}`, !t3 ? "NON RIUSCITO" : t3.aggiornato_da !== id3 ? "VIOLAZIONE" : uguali(t3, ATTESE_FINALI.titolare3) ? "ok" : "NON RIUSCITO"));
      // Ufficio Gare: righe iniziali D-E4 del titolare, poi solo spegnere (mai «nuove opportunità», spenta all'inizio)
      const u3 = riga(id3, idUfficio);
      let esitoU = "ok";
      if (!u3) esitoU = "NON RIUSCITO";
      else if (![id3, idUfficio].includes(u3.aggiornato_da) || u3.nuove_opportunita === true) esitoU = "VIOLAZIONE";
      else if (u3.aggiornato_da !== idUfficio || !uguali(u3, ATTESE_FINALI.ufficio3)) esitoU = "NON RIUSCITO";
      voci.push(voce(6, `preferenze dell'Ufficio Gare dell'impresa di ${nome.get(id3)}: ${u3 ? `autore ${nome.get(u3.aggiornato_da) ?? "un altro utente"}, «nuove opportunità» ${u3.nuove_opportunita ? "ACCESA" : "spenta"}, come atteso ${uguali(u3, ATTESE_FINALI.ufficio3) ? "sì" : "no"}` : "assenti"}`, esitoU));
      // titolare dell'impresa 1
      const t1 = riga(id1, id1);
      voci.push(voce(4, `preferenze del titolare dell'impresa di ${nome.get(id1)}: ${t1 ? `autore ${t1.aggiornato_da === id1 ? "il titolare" : "un altro utente"}, come atteso ${uguali(t1, ATTESE_FINALI.titolare1) ? "sì" : "no"}` : "assenti"}`, !t1 ? "NON RIUSCITO" : t1.aggiornato_da !== id1 ? "VIOLAZIONE" : uguali(t1, ATTESE_FINALI.titolare1) ? "ok" : "NON RIUSCITO"));
      // nessuna riga dell'impresa 3 scritta dall'impresa 1 (azione diretta respinta)
      const daImpresa1 = per.righe.filter((r) => r.impresa_id === id3 && r.aggiornato_da === id1).length;
      voci.push(voce(7, `righe dell'impresa di ${nome.get(id3)} scritte dal titolare dell'impresa 1: ${daImpresa1} (attese 0)`, daImpresa1 === 0 ? "ok" : "VIOLAZIONE"));
    }
    const per2 = await lettore.conta(TABELLA_PERSONE, "impresa_id", `impresa_id=eq.${id2}`);
    voci.push(voce(7, `preferenze dell'impresa di ${nome.get(id2)}: ${descrivi(per2)} righe (attese 0)`, per2.errore !== undefined ? "ERRORE" : per2.n === 0 ? "ok" : "VIOLAZIONE"));

    // 9: nulla scritto altrove dalle imprese di prova (nessuna visita a «Per te» o Cerca, nessun salvataggio, nessuna console)
    const prova = `in.(${id1},${id2},${id3})`;
    const zero = [
      ["omnia_ai_radar_utilizzi", "id", `user_id=${prova}&creato_il=gte.${enc(inizio)}`],
      ["omnia_ai_radar_salvate", "id", `user_id=${prova}&creata_il=gte.${enc(inizio)}`],
      ["omnia_ai_radar_salvate", "id", `user_id=${prova}&aggiornata_il=gte.${enc(inizio)}`],
      ["omnia_ai_radar_profili", "id", `user_id=${prova}&aggiornato_il=gte.${enc(inizio)}`],
      ["omnia_ai_radar_gare_aggiunte", "id", `user_id=${prova}&creata_il=gte.${enc(inizio)}`],
      ["omnia_ai_radar_impostazioni", "user_id", `aggiornata_il=gte.${enc(inizio)}`],
      ["radar_console_registro", "id", `creato_il=gte.${enc(inizio)}`],
      ["omnia_ai_gare_gratuite", "user_id", `aggiornato_il=gte.${enc(inizio)}`],
      ["omnia_ai_gare_gratuite_log", "id", `created_at=gte.${enc(inizio)}`],
    ];
    for (const [tabella, colonna, filtro] of zero) {
      const r = await lettore.conta(tabella, colonna, filtro);
      voci.push(voce(9, `${tabella} (${filtro.split("&").pop().split("=")[0]}) nella finestra: ${descrivi(r)} (tetto 0)`, r.errore !== undefined ? "ERRORE" : r.n === 0 ? "ok" : "VIOLAZIONE"));
    }

    // 10: la 0125 è ancora assente (nessun evento, nessuna coda), nessuna richiesta esterna nel registro dell'osservatore
    for (const t of TABELLE_0125) {
      const r = await lettore.conta(t, "id", "id=not.is.null");
      voci.push(voce(10, `${t}: ${r.errore === 404 ? "assente" : descrivi(r)} (attesa assente: 0125 non applicata)`, r.errore === 404 ? "ok" : "VIOLAZIONE"));
    }
    if (registroRete !== null) {
      const daQuando = Date.parse(inizio);
      const fuori = analizzaRegistro(registroRete).filter((r) => r.t >= daQuando && categoria(r) === "FUORI");
      const host = [...new Set(fuori.map((r) => r.host))].join(", ");
      voci.push(voce(10, `richieste del server fuori dallo staging e da localhost nel registro dell'osservatore: ${fuori.length}${host ? ` (${host})` : ""} (attese 0)`, fuori.length === 0 ? "ok" : "VIOLAZIONE"));
    } else voci.push(voce(10, "registro dell'osservatore di rete non leggibile alla fine", "ERRORE"));
  } catch {
    voci.push(voce(9, "verifiche finali interrotte da un errore", "ERRORE"));
  }
  return voci;
}

/** Il resoconto dei 12 controlli: esito lato server e la parte da registrare dal browser. */
export function resocontoControlli(voci) {
  return [
    "Resoconto dei 12 controlli del grado 3 (parte lato server; la parte nel browser va nel resoconto con le schermate):",
    ...CONTROLLI.map((c) => {
      const suoi = voci.filter((v) => v.controllo === c.n);
      const esito = esitoControllo(suoi);
      return `  ${c.n}. ${c.titolo}: lato server ${esito}${suoi.length ? ` (${suoi.length} voci)` : ""}${c.browser ? ` · nel browser: ${c.browser}` : ""}`;
    }),
  ];
}

// ───── sorveglianza della rete (controllo 10): il registro dell'osservatore, letto ogni secondo ─────

/**
 * Legge le righe NUOVE del registro dell'osservatore di rete (solo ora, pid, metodo, host e percorso) e chiama alFuori(host) alla prima
 * richiesta verso un host diverso dallo staging o da «localhost» (Resend compreso). Parte dalla fine del file com'è all'avvio.
 */
export function sorvegliaRete({ file, alFuori, intervalloMs = 1000 }) {
  let posizione = 0;
  try {
    posizione = fs.statSync(file).size;
  } catch {
    posizione = 0;
  }
  let resto = "";
  let scattata = false;
  const giro = () => {
    if (scattata) return;
    let dimensione;
    try {
      dimensione = fs.statSync(file).size;
    } catch {
      return;
    }
    if (dimensione < posizione) posizione = 0;
    if (dimensione === posizione) return;
    const fd = fs.openSync(file, "r");
    let testo;
    try {
      const buf = Buffer.alloc(dimensione - posizione);
      fs.readSync(fd, buf, 0, buf.length, posizione);
      posizione = dimensione;
      testo = resto + buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    const righe = testo.split("\n");
    resto = righe.pop() ?? "";
    for (const r of analizzaRegistro(righe.join("\n"))) {
      if (categoria(r) === "FUORI") {
        scattata = true;
        alFuori(r.host);
        return;
      }
    }
  };
  const timer = setInterval(giro, intervalloMs);
  timer.unref?.();
  return {
    giro,
    ferma() {
      clearInterval(timer);
      giro();
    },
  };
}

// ───── nel browser (strumento javascript del pannello): letture e prove, autosufficienti ─────

/**
 * Da eseguire NEL BROWSER sulla pagina «Notifiche» come `(${letturaNotifiche})(document)`: solo stati e conteggi, mai indirizzi o id.
 * Avviso presente, interruttore dell'impresa (stato, modificabile), le proprie categorie (accesa, bloccata), sezione dei destinatari,
 * indirizzi email nel contenuto della pagina (la barra superiore col saluto è esclusa).
 */
export function letturaNotifiche(documento) {
  const testo = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
  const contenuto = documento.querySelector(".omnia-app-shell") ?? documento.body;
  const impresa = documento.querySelector('section[aria-labelledby="notifiche-impresa"]');
  const mie = documento.querySelector('section[aria-labelledby="notifiche-mie"]');
  const categorie = {};
  for (const c of ["nuove_opportunita", "scadenze", "rettifiche"]) {
    const x = mie?.querySelector(`input[type="checkbox"][name="${c}"]`);
    categorie[c] = x ? { accesa: x.checked, bloccata: x.disabled || !!x.closest("fieldset")?.disabled } : null;
  }
  const t = testo(contenuto);
  return {
    pagina: documento.location?.pathname ?? null,
    avviso: t.includes("Gli avvisi email non sono ancora attivi"),
    interruttore: impresa ? { acceso: /sono accesi/.test(testo(impresa)), modificabile: !!impresa.querySelector('button[type="submit"]') } : null,
    categorie,
    salvaPreferenze: !!mie?.querySelector('button[type="submit"]'),
    destinatari: !!documento.querySelector('section[aria-labelledby="notifiche-destinatari"]'),
    statoIndirizziNonDisponibile: t.includes("Lo stato degli indirizzi non è ancora disponibile"),
    indirizziEmail: (t.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi) ?? []).length,
    messaggi: [...(contenuto.querySelectorAll('[role="alert"], [role="status"]') ?? [])].map(testo),
  };
}

/**
 * NEL BROWSER, passo 2d, come `(${provaAzioneDirettaPersona})(document, "<id della persona dell'impresa 3 mostrato da /pronto>")`: cambia
 * SOLO il campo nascosto «persona» del modulo «Le mie preferenze» e lo invia. Atteso sotto il modulo: «Persona non valida.».
 */
export function provaAzioneDirettaPersona(documento, persona) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(persona))) return { esito: "identificativo non valido: niente inviato" };
  const modulo = documento.querySelector('section[aria-labelledby="notifiche-mie"] form');
  const campo = modulo?.querySelector('input[type="hidden"][name="persona"]');
  if (!modulo || !campo) return { esito: "modulo «Le mie preferenze» non trovato: niente inviato" };
  if (campo.value === persona) return { esito: "è già la propria persona: niente inviato" };
  campo.value = persona;
  modulo.requestSubmit();
  return { esito: "inviato: leggere il messaggio sotto il modulo (atteso «Persona non valida.»)" };
}

/**
 * NEL BROWSER, passo 3c, come `(${provaRiaccensione})(document, "nuove_opportunita")`: l'Ufficio Gare toglie il blocco a una propria
 * categoria SPENTA e invia il modulo. Atteso: «Per riaccendere una categoria chiedi al titolare dell'impresa.».
 */
export function provaRiaccensione(documento, categoria) {
  if (!["nuove_opportunita", "scadenze", "rettifiche"].includes(categoria)) return { esito: "categoria non valida: niente inviato" };
  const modulo = documento.querySelector('section[aria-labelledby="notifiche-mie"] form');
  const casella = modulo?.querySelector(`input[type="checkbox"][name="${categoria}"]`);
  if (!modulo || !casella) return { esito: "casella non trovata: niente inviato" };
  if (casella.checked || !casella.disabled) return { esito: "la casella non è spenta e bloccata come atteso per l'Ufficio Gare: niente inviato" };
  casella.disabled = false;
  casella.checked = true;
  modulo.requestSubmit();
  return { esito: "inviato: leggere il messaggio sotto il modulo (atteso «Per riaccendere una categoria chiedi al titolare dell'impresa.»)" };
}

// ───── la pagina /pronto del grado 3 ─────

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Titolo e riquadro di /pronto; l'id della persona dell'impresa 3 compare solo dopo il passo 1 (letto al clic, mai prima). */
export function paginaNotifiche(ricordati) {
  return {
    titolo: "Collaudo B4 grado 3 (Notifiche)",
    riquadro: () =>
      `<div class="d2"><strong>Passo 2d — azione diretta verso l'impresa 3</strong> (utente di prova titolare-benchmark, solo su questa pagina locale):<br>${
        ricordati.id3 ? `<code>${escapeHtml(ricordati.id3)}</code>` : "compare dopo il clic del passo 1"
      }<br><strong>Passo 3c</strong>: categoria da provare a riaccendere <code>nuove_opportunita</code>.<br>Mai <code>?__zone</code> negli indirizzi dopo l'arrivo; mai pagine di Opportunità diverse da «Notifiche».</div>`,
  };
}

// ───── modalità senza finestra ─────

async function preliminare(argv, opzioni) {
  const [porta = "3110"] = argv;
  if (!/^\d{4,5}$/.test(porta)) throw new Fermo("porta non valida");
  const vietato = async () => {
    throw new Fermo("modalità preliminare");
  };
  const server = serverAccesso({ portaApp: porta, preliminare: true, prerequisiti: vietato, accedi: vietato, verifica: vietato, finali: vietato, utenti: UTENTI_NOTIFICHE, pagina: paginaNotifiche({}) });
  try {
    const indirizzo = await ascoltaSoloLocale(server, opzioni.portaAccesso ?? Number(porta) + 1);
    console.log(`Controllo PRELIMINARE del grado 3: http://${SOLO_LOCALE}:${indirizzo.port}/pronto — nessuna autorizzazione, nessun file delle variabili, nessuna rete, nessun collegamento. Ctrl+C per chiudere.`);
    await (opzioni.attendi
      ? opzioni.attendi({ portaAccesso: indirizzo.port })
      : new Promise((risolvi) => {
          for (const segnale of ["SIGINT", "SIGTERM"]) process.once(segnale, risolvi);
        }));
    return 0;
  } finally {
    await chiudi(server);
    console.log("Pagina d'accesso chiusa.");
  }
}

function misureDaFile(argv) {
  const [registro, fileFinestre] = argv;
  if (!registro || !fs.existsSync(registro) || !fileFinestre || !fs.existsSync(fileFinestre)) throw new Fermo("uso: --misure <registro dell'osservatore> <finestre.json>");
  const d = JSON.parse(fs.readFileSync(fileFinestre, "utf8"));
  const esito = misura(fs.readFileSync(registro, "utf8"), { finestre: d.finestre ?? [], escludiPid: (d.escludiPid ?? []).map(Number) });
  for (const r of esito.righe) console.log(r);
  console.log(esito.ok ? "Misure: tutte in regola." : "Misure: ALCUNE NON IN REGOLA.");
  return esito.ok ? 0 : 1;
}

/**
 * Il collaudo del grado 3. Iniettabili per le prove a secco: controllaPorta, fetchFn, avvia (riceve { portaAccesso, segnale } e si chiude al
 * segnale), cartella, portaAccesso, adesso, intervalloRete, durataMassimaMs.
 */
export async function collaudo(argv, env, opzioni = {}) {
  if (argv[0] === "--preliminare") return preliminare(argv.slice(1), opzioni);
  if (argv[0] === "--misure") return misureDaFile(argv.slice(1));
  const cartella = opzioni.cartella ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [fileVariabili, porta = "3110"] = argv;

  // 1. porta delle autorizzazioni
  let controllaPorta = opzioni.controllaPorta;
  if (!controllaPorta) {
    const registro = env.TI_REGISTRO;
    if (!registro) throw new Fermo("lanciare con esegui-autorizzato.mjs (autorizzazione registrata del coordinatore)");
    ({ controllaPorta } = await import(pathToFileURL(path.join(registro, "registro.mjs")).href));
  }
  try {
    controllaPorta({ script: NOME_SCRIPT });
  } catch (e) {
    throw new Fermo(e instanceof Error ? e.message : String(e));
  }

  // 2. guardia
  if (!fileVariabili || !fs.existsSync(fileVariabili)) throw new Fermo("file delle variabili mancante");
  if (dentro(fileVariabili, cartella)) throw new Fermo("il file delle variabili deve stare FUORI dalla cartella del progetto");
  if (!/^\d{4,5}$/.test(porta)) throw new Fermo("porta non valida");
  const variabili = leggiVariabili(fs.readFileSync(fileVariabili, "utf8"));
  const errori = erroriAmbienteNotifiche(variabili);
  if (errori.length) throw new Fermo(`ambiente non autorizzato: ${errori.join("; ")}`);
  const lanciatore = path.join(cartella, "scripts", "avvia-anteprima-locale.mjs");
  if (!opzioni.avvia && !fs.existsSync(lanciatore)) throw new Fermo("manca scripts/avvia-anteprima-locale.mjs (i commit d'anteprima vanno integrati prima)");
  const fileRete = env.OSSERVA_RETE_FILE;
  if (!fileRete) throw new Fermo("manca OSSERVA_RETE_FILE: senza la sorveglianza della rete la finestra non parte");
  if (dentro(fileRete, cartella)) throw new Fermo("il registro dell'osservatore deve stare FUORI dalla cartella del progetto");
  const fetchFn = opzioni.fetchFn ?? fetch;
  const inizio = new Date((opzioni.adesso ?? Date.now)() - MARGINE_INIZIO_MS).toISOString();

  // 3. pagina d'accesso SENZA collegamenti
  const lettore = creaLettore({ variabili, fetchFn });
  const fermo = new AbortController();
  const ricordati = {};
  const leggiRegistro = () => {
    try {
      return fs.readFileSync(fileRete, "utf8");
    } catch {
      return null;
    }
  };
  const server = serverAccesso({
    portaApp: porta,
    utenti: UTENTI_NOTIFICHE,
    pagina: paginaNotifiche(ricordati),
    prerequisiti: (utente) => verificaPrerequisitiNotifiche({ lettore, utente, ricorda: (x) => Object.assign(ricordati, x) }),
    accedi: async (utente) => {
      const tokenHash = await generaCollegamento({ variabili, email: utente.email, fetchFn });
      return cookieDiSessione({ variabili, tokenHash, fetchFn });
    },
    verifica: (utente, accessToken) => verificheDopoAccessoNotifiche({ lettore, utente, accessToken }),
    finali: () => verificheFinaliNotifiche({ lettore, inizio, registroRete: leggiRegistro() }),
    alFermo: () => fermo.abort(),
  });

  // 4. app, sorveglianza della rete e tempo massimo; 8. alla fine si chiude tutto e si stampa il resoconto
  const rete = sorvegliaRete({
    file: fileRete,
    intervalloMs: opzioni.intervalloRete ?? 1000,
    alFuori: (host) => {
      const v = voce(10, `richiesta del server verso un host esterno: ${host}`, "VIOLAZIONE");
      server.stato.voci.push(v);
      console.log(rigaVoce(v));
      server.ferma(`[10] richiesta del server verso un host esterno (${host})`);
    },
  });
  const tempo = setTimeout(() => {
    if (server.stato.finali === "fatte") {
      console.log(`Finestra oltre ${DURATA_MASSIMA_MIN} minuti dopo le verifiche finali: chiusura.`);
      fermo.abort();
    } else server.ferma(`finestra oltre ${DURATA_MASSIMA_MIN} minuti senza le verifiche finali`);
  }, opzioni.durataMassimaMs ?? DURATA_MASSIMA_MIN * 60 * 1000);
  tempo.unref?.();
  let codice = 0;
  try {
    const indirizzo = await ascoltaSoloLocale(server, opzioni.portaAccesso ?? Number(porta) + 1);
    console.log(`Pagina del collaudo (grado 3): http://${SOLO_LOCALE}:${indirizzo.port}/pronto — nessun collegamento generato: ognuno nasce solo dal pulsante del suo utente, nell'ordine.`);
    console.log(`Processo del collaudo: pid ${process.pid} (da escludere dalle misure del controllo 11). Sorveglianza della rete attiva.`);
    const avvia =
      opzioni.avvia ??
      (({ segnale }) =>
        new Promise((risolvi) => {
          const figlio = spawn(process.execPath, [lanciatore, "avvia", fileVariabili, porta], { cwd: cartella, stdio: "inherit", env: process.env });
          for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => figlio.kill(s));
          segnale.addEventListener("abort", () => figlio.kill("SIGTERM"), { once: true });
          figlio.on("exit", (c) => risolvi(c ?? 0));
        }));
    codice = await avvia({ portaAccesso: indirizzo.port, segnale: fermo.signal });
  } finally {
    clearTimeout(tempo);
    rete.ferma();
    await chiudi(server);
    console.log("Pagina d'accesso chiusa.");
    for (const r of resocontoControlli(server.stato.voci)) console.log(r);
  }
  if (server.stato.fermo) {
    console.log(`Esito: COLLAUDO FERMATO (${server.stato.fermo}).`);
    return 3;
  }
  return codice;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collaudo(process.argv.slice(2), process.env)
    .then((codice) => process.exit(codice))
    .catch((e) => {
      console.error(`COLLAUDO FERMATO: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    });
}
