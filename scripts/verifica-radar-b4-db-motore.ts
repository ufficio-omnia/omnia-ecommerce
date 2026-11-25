// Verifica della fase B4, MOTORE delle notifiche email (B2, Fase A del 20/11/2026). Livello 1: NESSUN database vero, NESSUNA rete (fetch
// bloccato). Il motore gira su un database IN MEMORIA che imita PostgREST per le sole operazioni che usa, con i vincoli che contano
// (chiavi uniche non parziali, «uno alla volta» dei giri, separazione tra imprese delle consegne) e il CONTEGGIO delle richieste.
// Provider: il FINTO del motore. Modello delle email: quello vero di B1 (componiEmailRadar), così la composizione è provata davvero.
// Uso: npx tsx scripts/verifica-radar-b4-db-motore.ts   → codice 0 se tutto passa, 1 altrimenti.
import fs from "fs";
import path from "path";
import { componiEmailRadar } from "../src/lib/radar/email-modelli";
import { dipendenzeReali, eseguiPassaggio, eseguiRavvicinata, prendiInCarico, ultimoPassaggioProgrammato, type DipendenzeMotore, type StatoAccesso } from "../src/lib/radar/notifiche/motore";
import { PARAMETRI_PROPOSTI, type ParametriNotifiche } from "../src/lib/radar/notifiche/parametri";
import { ProviderFinto, resendConsentito, sceltaProvider, type CopioneFinto } from "../src/lib/radar/notifiche/provider";
import { classificaRispostaResend, creaProviderResend, quotaDaIntestazioni, richiestaResend } from "../src/lib/radar/notifiche/provider-resend";
import { esitoDopoInvio, pianoInvioCompleto, type ConsegnaInCoda } from "../src/lib/radar/notifiche/coda-calcoli";
import { eventiModifica, gareDelleListe, eventoRiepilogo, chiaveAvviso, nuoveDaValutare, scadenzaDaRegistro, type RigaModifica, type RigaGara, type RigaNuova } from "../src/lib/radar/notifiche/eventi-calcoli";
import { dopoIngressoInLista } from "../src/lib/radar/notifiche/ravvicinata";
import { giornoRoma } from "../src/lib/radar/notifiche/calendario";
import type { EventoRiepilogo, TipoEvento } from "../src/lib/radar/notifiche/tipi";

// rete bloccata: qualunque fetch fa fallire la verifica
globalThis.fetch = (async () => {
  throw new Error("RETE VIETATA nella verifica del motore B4");
}) as typeof fetch;

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
}

// ═══════════════════════ database in memoria (imitazione di PostgREST per le operazioni del motore): scripts/lib/db-finto-motore.ts ═══════════════════════
import { DbFinto, type Riga } from "./lib/db-finto-motore";
import { FONTI_NASCOSTE_PREDEFINITE, fontiNascosteDa } from "../src/lib/radar/fonti-gara-calcoli";

// ═══════════════════════ dati SINTETICI (dichiarati come tali: imprese, persone e gare inventate) ═══════════════════════

const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I1 = U(1), I2 = U(2), I3 = U(3), M1 = U(11), M2 = U(12), MB = U(21);
// O2 (direttiva 44A, confronto A/B): di base il valore proposto (PARAMETRI_PROPOSTI); RADAR_PROVA_O2=0 o =1 fa girare TUTTA questa verifica
// con O1 o con O2. La prova «provaO2AB» confronta comunque le due nella stessa esecuzione.
const O2 = process.env.RADAR_PROVA_O2 === undefined ? PARAMETRI_PROPOSTI.statoPassaggioInUnaChiamata : process.env.RADAR_PROVA_O2 === "1";
const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co", RADAR_NOTIFICHE_EMAIL: "attivo", RADAR_EMAIL_ORIGINE: "http://localhost:3000" };

type Mondo = { db: DbFinto; provider: ProviderFinto; d: DipendenzeMotore; ora: { t: Date }; accesso: Map<string, StatoAccesso> };

function giorno(base: string, n: number): string {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Una gara sintetica dell'archivio. */
function gara(n: number, x: Partial<RigaGara> & { chiave?: string } = {}): RigaGara {
  return {
    id: U(100 + n),
    chiave: x.chiave ?? `ted:SINT-${n}`,
    oggetto: `Gara sintetica ${n} — servizi di pulizia (dati inventati)`,
    sa_denominazione: `Ente sintetico ${n}`,
    luogo_regioni: ["lombardia"],
    tipo_opportunita: "bando",
    tipo_procedura: "aperta",
    valore_stimato: 100000 + n,
    data_pubblicazione: "2026-10-18",
    scadenza_giorno: null,
    scadenza_offerte: null,
    scadenza_ora_indicata: false,
    stato: "aperta",
    unita_a: null,
    url_avviso: `https://esempio.invalid/avviso/${n}`,
    url_documenti: null,
    prima_rilevazione_il: "2026-10-18T08:00:00Z",
    ultima_rilevazione_il: "2026-10-19T08:00:00Z",
    fonti: [String(x.chiave ?? "ted").split(":")[0]],
    ...x,
  };
}

function mondo(opzioni: { parametri?: Partial<ParametriNotifiche>; copione?: CopioneFinto; quota?: number | null; env?: Record<string, string | undefined>; inizio?: string } = {}): Mondo {
  const db = new DbFinto();
  const ora = { t: new Date(opzioni.inizio ?? "2026-10-20T05:30:00Z") };
  db.orologio = () => ora.t;
  const accesso = new Map<string, StatoAccesso>([[I1, "attivo"], [I2, "prova"], [I3, "attivo"]]);
  db.tabelle.auth_users = [
    { id: I1, email: "titolare1@prova.test", email_confermata_il: "2026-01-01" },
    { id: I2, email: "titolare2@prova.test", email_confermata_il: "2026-01-01" },
    { id: I3, email: "titolare3@prova.test", email_confermata_il: "2026-01-01" },
    { id: M1, email: "ufficio1@prova.test", email_confermata_il: "2026-01-01" },
    { id: M2, email: "sospeso1@prova.test", email_confermata_il: "2026-01-01" },
    { id: MB, email: "bloccato2@prova.test", email_confermata_il: "2026-01-01", banned_until: "2099-01-01T00:00:00Z" },
  ];
  db.tabelle.omnia_ai_membri = [
    { membro_id: M1, titolare_id: I1, attivo: true },
    { membro_id: M2, titolare_id: I1, attivo: false },
    { membro_id: MB, titolare_id: I2, attivo: true },
  ];
  db.tabelle.omnia_ai_radar_impostazioni = [I1, I2, I3].map((u) => ({ user_id: u, attivo: true }));
  db.tabelle.omnia_ai_radar_notifiche_impresa = [
    { impresa_id: I1, email_attive: true },
    { impresa_id: I2, email_attive: true },
    { impresa_id: I3, email_attive: false },
  ];
  const tutte = { nuove_opportunita: true, scadenze: true, rettifiche: true, email_bloccata_il: null, motivo_blocco: null };
  db.tabelle.omnia_ai_radar_notifiche_persone = [
    { impresa_id: I1, user_id: I1, ...tutte },
    { impresa_id: I1, user_id: M1, ...tutte, nuove_opportunita: false },
    { impresa_id: I1, user_id: M2, ...tutte },
    { impresa_id: I2, user_id: I2, ...tutte, nuove_opportunita: false },
    { impresa_id: I2, user_id: MB, ...tutte },
    { impresa_id: I3, user_id: I3, ...tutte },
  ];
  // la PVL VISIBILE con una riga esplicita (come lo staging dopo la 48B; senza riga sarebbe visibile lo stesso, direttiva 48A): questo
  // mondo prova anche i casi PVL (gara 2, proroga di un lotto PVL)
  db.tabelle.radar_fonti_stato = [{ fonte: "sardegnacat", nascosta_ai_clienti: true }, { fonte: "ted", nascosta_ai_clienti: false }, { fonte: "pvl", nascosta_ai_clienti: false }];
  // archivio sintetico (giorni contati dal 20/10/2026, cambio dell'ora il 25/10/2026)
  db.tabelle.radar_procedure = [
    gara(1, { scadenza_giorno: "2026-10-30", scadenza_offerte: "2026-10-30T11:00:00Z", scadenza_ora_indicata: true }), // 10 giorni
    gara(2, { chiave: "pvl:SINT-2", scadenza_giorno: "2026-10-25" }), // 5 giorni, senza ora
    gara(3, { scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T10:00:00Z", scadenza_ora_indicata: true }), // lotti con scadenze diverse
    gara(4, { chiave: "sardegnacat:SINT-4", scadenza_giorno: "2026-10-30" }), // fonte nascosta ai clienti
    gara(5, { stato: "annullata", scadenza_giorno: "2026-10-30" }),
  ];
  db.tabelle.radar_lotti = [
    { procedura_id: U(103), numero_lotto: "1", oggetto: "Lotto 1", cig: "AAAAAAAAA1", scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T10:00:00Z", scadenza_ora_indicata: true },
    { procedura_id: U(103), numero_lotto: "2", oggetto: "Lotto 2", cig: "AAAAAAAAA2", scadenza_giorno: "2026-10-25", scadenza_offerte: null, scadenza_ora_indicata: false },
    { procedura_id: U(103), numero_lotto: "3", oggetto: "Lotto 3", cig: "AAAAAAAAA3", scadenza_giorno: null, scadenza_offerte: null, scadenza_ora_indicata: false },
  ];
  db.tabelle.omnia_ai_radar_gare_aggiunte = [
    { id: U(201), user_id: I1, cig: null, url: null, oggetto: "Gara aggiunta a mano (sintetica)", ente: "Ente sintetico A", scadenza_giorno: "2026-10-21", scadenza_offerte: null, scadenza_ora_indicata: false, procedura_id: null, creata_il: "2026-10-10T08:00:00Z", aggiornata_il: "2026-10-10T08:00:00Z" },
  ];
  db.tabelle.omnia_ai_radar_salvate = [
    { user_id: I1, procedura_id: U(101), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" },
    { user_id: I1, procedura_id: U(103), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" },
    { user_id: I1, procedura_id: U(104), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" },
    { user_id: I1, procedura_id: U(105), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" },
    { user_id: I1, procedura_id: null, aggiunta_id: U(201), creata_il: "2026-10-10T08:00:00Z" },
    { user_id: I2, procedura_id: U(102), aggiunta_id: null, creata_il: "2026-10-10T08:00:00Z" },
    // salvata OGGI: nessun promemoria a 10 giorni (nessun recupero per le gare salvate tardi)
    { user_id: I2, procedura_id: U(101), aggiunta_id: null, creata_il: "2026-10-20T05:00:00Z" },
    { user_id: I3, procedura_id: U(101), aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" },
  ];
  db.tabelle.radar_aggiornamenti = [];
  db.tabelle.omnia_ai_radar_profili = [
    { user_id: I1, posizione: 1, settori: ["pulizia"], sottocategorie: {}, regioni: ["lombardia"], tipi_procedura: [], importo_min: null, importo_max: null, vedere_correlate: true, aggiornato_il: "2026-10-01T00:00:00Z" },
  ];
  db.tabelle.radar_classificazioni_stato = [];
  db.tabelle.radar_classificazioni = [];
  const provider = new ProviderFinto({ copione: opzioni.copione, quota: opzioni.quota });
  let n = 0;
  const d: DipendenzeMotore = {
    admin: db as unknown as DipendenzeMotore["admin"],
    env: opzioni.env ?? STAGING,
    provider,
    componi: componiEmailRadar,
    parametri: { ...PARAMETRI_PROPOSTI, statoPassaggioInUnaChiamata: O2, ...opzioni.parametri },
    statoAccesso: async (id) => {
      db.richieste.push({ tabella: "subscriptions", metodo: "select" });
      return accesso.get(id) ?? "cessato";
    },
    adesso: () => ora.t,
    nuovoId: () => U(900000 + ++n),
    attendi: async () => undefined,
    ultimoPassaggio: ultimoPassaggioProgrammato,
    cursoreNuoveIniziale: () => "2026-10-13T00:00:00Z",
  };
  return { db, provider, d, ora, accesso };
}

const consegne = (m: Mondo) => m.db.t("omnia_ai_radar_email_consegne");
const eventi = (m: Mondo) => m.db.t("omnia_ai_radar_eventi");
const di = (m: Mondo, f: (c: Riga) => boolean) => consegne(m).filter(f);
const tipoDi = (m: Mondo, c: Riga) => String(eventi(m).find((e) => e.id === c.evento_id)?.tipo ?? "");

async function principale(): Promise<void> {
  // ───── 1. guardie: spento, anteprima, produzione, provider ─────
  for (const [nome, env] of [
    ["interruttore spento", { NEXT_PUBLIC_SUPABASE_URL: STAGING.NEXT_PUBLIC_SUPABASE_URL }],
    ["anteprima", { ...STAGING, VERCEL_ENV: "preview" }],
    ["produzione", { ...STAGING, NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" }],
    ["origine di produzione", { ...STAGING, RADAR_EMAIL_ORIGINE: "https://omnia-ai.it" }],
  ] as const) {
    const m = mondo({ env });
    const e = await eseguiPassaggio(m.d);
    controlla(`guardia «${nome}»: nessun passaggio e 0 richieste al database`, e.eseguito === false && m.db.conta() === 0 && m.provider.consegnate.length === 0, { e, richieste: m.db.conta() });
  }
  {
    const m = mondo();
    const e = await eseguiPassaggio({ ...m.d, provider: { nome: "resend", invia: async () => ({ esito: "inviata", providerId: "x" }), quotaResidua: () => null } });
    controlla("guardia: un provider diverso dal finto non parte (Resend chiuso)", e.eseguito === false && m.db.conta() === 0);
    // pacchetto P: Resend SOLO in produzione, sul deploy di produzione, con l'interruttore acceso; altrove mai (staging, anteprime, locale)
    const PROD = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
    const NIENTE_RESEND = [{}, STAGING, { ...STAGING, VERCEL_ENV: "preview" }, { NEXT_PUBLIC_SUPABASE_URL: PROD, RADAR_NOTIFICHE_EMAIL: "attivo" }, { NEXT_PUBLIC_SUPABASE_URL: PROD, RADAR_NOTIFICHE_EMAIL: "attivo", VERCEL_ENV: "preview" }, { NEXT_PUBLIC_SUPABASE_URL: PROD, VERCEL_ENV: "production" }];
    controlla("resendConsentito: falso sullo staging, sulle anteprime, in locale verso la produzione e senza l'interruttore", NIENTE_RESEND.every((env) => resendConsentito(env) === false));
    controlla("resendConsentito: vero SOLO in produzione, sul deploy di produzione, con RADAR_NOTIFICHE_EMAIL=attivo", resendConsentito({ NEXT_PUBLIC_SUPABASE_URL: PROD, RADAR_NOTIFICHE_EMAIL: "attivo", VERCEL_ENV: "production" }) === true);
    controlla("sceltaProvider: il finto in ogni ambiente senza Resend consentito", NIENTE_RESEND.every((env) => sceltaProvider(env).nome === "finto"));
    let lanciato = false;
    try {
      creaProviderResend("chiave-finta", async () => ({ status: 200, json: async () => ({}), headers: { get: () => null } }), STAGING);
    } catch {
      lanciato = true;
    }
    controlla("creaProviderResend non si costruisce sullo staging", lanciato);
    const dr = await dipendenzeReali({}, PARAMETRI_PROPOSTI).catch(() => null);
    controlla("dipendenzeReali usa il provider finto", !dr || dr.provider.nome === "finto");
  }

  // ───── 2. primo giro (20/10/2026 07:30 a Roma): eventi, consegne, invii ─────
  const m = mondo();
  const e1 = await eseguiPassaggio(m.d);
  controlla("primo passaggio eseguito", e1.eseguito === true, e1);
  const tipiEventi = eventi(m).map((e) => `${e.impresa_id === I1 ? "I1" : e.impresa_id === I2 ? "I2" : "I3"}:${e.gara_chiave}:${e.tipo}:${e.versione}`).sort();
  const attesi = [
    `I1:a:${U(201)}:scadenza_1:2026-10-21`, // gara aggiunta a mano, scadenza dell'impresa
    `I1:p:${U(101)}:scadenza_10:2026-10-30T11:00:00.000Z`,
    `I1:p:${U(103)}:scadenza_1:2026-10-21T10:00:00.000Z`, // lotto 1
    `I1:p:${U(103)}:scadenza_5:2026-10-25`, // lotto 2 (gruppo distinto, senza ora)
    `I2:p:${U(102)}:scadenza_5:2026-10-25`, // PVL sullo staging
  ].sort();
  controlla("eventi del primo giro: esattamente i promemoria attesi (gruppi di lotti, gara aggiunta, nessuna fonte nascosta, nessuna gara annullata, nessuna salvata oggi, impresa con le email spente esclusa)", JSON.stringify(tipiEventi.filter((t) => !t.includes("riepilogo"))) === JSON.stringify(attesi), tipiEventi);
  controlla("nessun evento per la gara della fonte nascosta (SardegnaCAT)", !eventi(m).some((e) => e.gara_chiave === `p:${U(104)}`));
  controlla("nessun evento per la gara annullata", !eventi(m).some((e) => e.gara_chiave === `p:${U(105)}`));
  controlla("nessun evento per l'impresa con le email spente", !eventi(m).some((e) => e.impresa_id === I3));
  const destinatari = new Set(consegne(m).map((c) => c.destinatario_id));
  controlla("consegne solo al titolare e all'Ufficio Gare ATTIVO (mai al membro sospeso né all'utente bloccato)", destinatari.has(I1) && destinatari.has(M1) && destinatari.has(I2) && !destinatari.has(M2) && !destinatari.has(MB) && !destinatari.has(I3), [...destinatari]);
  controlla("tutte le consegne inviate con il provider finto", consegne(m).every((c) => c.stato === "inviata" && c.provider === "finto" && String(c.provider_id).startsWith("finto-")), consegne(m).map((c) => c.stato));
  controlla("una email per consegna, nessun doppione", m.provider.consegnate.length === consegne(m).length && new Set(m.provider.consegnate.map((x) => x.chiave)).size === m.provider.consegnate.length);
  controlla("chiave di idempotenza = omnia-radar/<id della consegna>", consegne(m).every((c) => m.provider.consegnate.some((x) => x.chiave === `omnia-radar/${c.id}`)));
  controlla("nessun indirizzo email salvato nelle tabelle del motore", !JSON.stringify([eventi(m), consegne(m), m.db.t("radar_notifiche_giri")]).includes("@prova.test"));
  const giri1 = m.db.t("radar_notifiche_giri");
  controlla("giro «eventi» riuscito con i cursori, più il giro «invio»", giri1.some((g) => g.fase === "eventi" && g.esito === "riuscito" && g.cursore_nuove) && giri1.some((g) => g.fase === "invio" && g.esito === "riuscito"), giri1);
  const richiestePrimo = m.db.conta();
  controlla("richieste del primo passaggio (fase «eventi» completa e invio): ≤ 50", richiestePrimo <= 50, { richiestePrimo, dettaglio: m.db.richieste.map((r) => `${r.tabella}:${r.metodo}`) });
  // nessun N+1: con 40 gare in più nelle liste (e 40 promemoria in più) le richieste al database NON crescono con le gare
  {
    const grande = mondo();
    for (let i = 0; i < 40; i++) {
      const g = gara(800 + i, { scadenza_giorno: "2026-10-30" });
      grande.db.t("radar_procedure").push(g);
      grande.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" });
    }
    await eseguiPassaggio(grande.d);
    const senzaInvii = (x: Mondo) => x.db.richieste.filter((r) => r.tabella !== "subscriptions").length;
    const nGrande = senzaInvii(grande), nPiccolo = senzaInvii(m) ;
    // le richieste crescono SOLO a blocchi di 50 consegne da inviare (ogni blocco: presa in carico, eventi, ricontrollo ≈ 12), mai per gara
    const blocchiInPiu = Math.ceil(consegne(grande).length / 50) - Math.ceil(consegne(m).length / 50);
    controlla("nessun N+1: 40 gare e 40 promemoria in più aggiungono richieste solo per blocchi di 50 consegne (≤ 12 a blocco, + 2)", nGrande - nPiccolo <= 12 * blocchiInPiu + 2 && eventi(grande).length >= eventi(m).length + 40, { nGrande, nPiccolo, blocchiInPiu, consegne: consegne(grande).length });
  }

  // ───── 3. stesso giorno di nuovo: 0 righe nuove, 0 email ─────
  const prima = { e: eventi(m).length, c: consegne(m).length, p: m.provider.consegnate.length };
  m.ora.t = new Date("2026-10-20T06:00:00Z");
  const richiestePrimaDelSecondo = m.db.conta();
  const e2 = await eseguiPassaggio(m.d);
  controlla("rieseguito lo stesso giorno: fase «eventi» saltata, 0 eventi, 0 consegne, 0 email", e2.eseguito && "saltata" in e2.eventi && eventi(m).length === prima.e && consegne(m).length === prima.c && m.provider.consegnate.length === prima.p, e2);
  const richiesteVuoto = m.db.conta() - richiestePrimaDelSecondo;
  controlla(`passaggio vuoto (N7, ${O2 ? "O2" : "O1"}): ESATTAMENTE ${O2 ? "1 richiesta (stato del passaggio)" : "2 richieste (giri di oggi, consegne pronte)"} e nessun giro «invio» in più dopo il battito`, richiesteVuoto === (O2 ? 1 : 2) && m.db.t("radar_notifiche_giri").filter((g) => g.fase === "invio").length === 1, { richiesteVuoto });

  // ───── 3-bis. fase «eventi» caduta prima della chiusura e rifatta lo stesso giorno: chiavi uniche, nessun doppione ─────
  {
    const k = mondo();
    await eseguiPassaggio(k.d);
    const n = { e: eventi(k).length, c: consegne(k).length, p: k.provider.consegnate.length };
    for (const g of k.db.t("radar_notifiche_giri")) if (g.fase === "eventi") Object.assign(g, { esito: "fallito", errore: "processo_caduto" });
    k.ora.t = new Date("2026-10-20T06:00:00Z");
    const e = await eseguiPassaggio(k.d);
    controlla("fase «eventi» rifatta dopo una caduta: 0 eventi, 0 consegne, 0 email in più", e.eseguito && !("saltata" in e.eventi) && eventi(k).length === n.e && consegne(k).length === n.c && k.provider.consegnate.length === n.p && n.e > 0, { prima: n, e });
  }

  // ───── 4. proroga TED e la stessa notizia dalla PVL: un solo evento, i promemoria della vecchia scadenza annullati ─────
  m.db.t("omnia_ai_radar_email_consegne").push(); // nulla
  const vecchia = "2026-10-30T11:00:00Z", nuova = "2026-11-06T11:00:00Z";
  const p1 = m.db.t("radar_procedure").find((p) => p.id === U(101))!;
  Object.assign(p1, { scadenza_giorno: "2026-11-06", scadenza_offerte: nuova, fonti: ["ted", "pvl"] });
  const base = { procedura_id: U(101), campo: "scadenza_offerte", valore_precedente: vecchia, valore_nuovo: nuova, notificabile: true, notifica_email: true, avviso_url: "https://esempio.invalid/rettifica", avviso_pubblicato_il: "2026-10-20", dichiarazione_fonte: "cor-buy" };
  m.db.t("radar_aggiornamenti").push(
    { id: U(301), tipo: "proroga", fonte: "ted", id_fonte: "123456-2026", avviso_ted: null, affidabilita: "avviso_ufficiale", rilevato_il: "2026-10-20T09:00:00Z", ...base },
    { id: U(302), tipo: "proroga", fonte: "pvl", id_fonte: "pvl-avviso-9", avviso_ted: null, affidabilita: "confronto_versioni", rilevato_il: "2026-10-20T10:00:00Z", ...base, valore_nuovo: "2026-11-06T12:00:00+01:00" },
    // mai email: cambio del solo collegamento, riclassificazione, fonte nascosta, Sintel non di scadenza
    { id: U(303), tipo: "rettifica", campo: "url_documenti", fonte: "ted", id_fonte: "123456-2026", procedura_id: U(101), valore_precedente: "a", valore_nuovo: "b", notificabile: true, notifica_email: true, affidabilita: "avviso_ufficiale", rilevato_il: "2026-10-20T09:00:00Z", avviso_url: null, avviso_pubblicato_il: null, avviso_ted: null, dichiarazione_fonte: null },
    { id: U(304), tipo: "correzione_dati", campo: "settori", fonte: "ted", id_fonte: "x", procedura_id: U(101), valore_precedente: null, valore_nuovo: null, notificabile: false, notifica_email: false, affidabilita: null, rilevato_il: "2026-10-20T09:00:00Z", avviso_url: null, avviso_pubblicato_il: null, avviso_ted: null, dichiarazione_fonte: null },
  );
  m.ora.t = new Date("2026-10-21T05:30:00Z");
  const e3 = await eseguiPassaggio(m.d);
  const proroghe = eventi(m).filter((e) => e.tipo === "proroga");
  controlla("proroga: un solo evento per impresa anche con TED e PVL (versione = nuova scadenza)", proroghe.length === 2 && proroghe.every((e) => e.versione === "scadenza:2026-11-06T11:00:00.000Z"), proroghe.map((e) => [e.impresa_id, e.versione]));
  controlla("proroga: I3 (email spente) senza evento; I2 la riceve (gara in lista)", proroghe.some((e) => e.impresa_id === I1) && proroghe.some((e) => e.impresa_id === I2) && !proroghe.some((e) => e.impresa_id === I3));
  const dieci = eventi(m).find((e) => e.tipo === "scadenza_10" && e.gara_chiave === `p:${U(101)}` && e.impresa_id === I1);
  controlla("proroga: il promemoria della vecchia scadenza è annullato («scadenza_cambiata»)", dieci?.stato === "annullato" && dieci?.motivo_annullamento === "scadenza_cambiata", dieci);
  const datiProroga = proroghe.find((e) => e.impresa_id === I1)?.dati as { cambioScadenza?: { precedente: { istante: string }; nuova: { istante: string } }; evidenza?: { motivoFonte: string | null; affidabilita: string } } | undefined;
  controlla("proroga: prima e dopo dall'evidenza, motivo della fonte tradotto, affidabilità ufficiale", datiProroga?.cambioScadenza?.precedente.istante === "2026-10-30T11:00:00.000Z" && datiProroga?.cambioScadenza?.nuova.istante === "2026-11-06T11:00:00.000Z" && datiProroga?.evidenza?.motivoFonte === "Correzione da parte dell'amministrazione aggiudicatrice" && datiProroga?.evidenza?.affidabilita === "avviso_ufficiale", datiProroga);
  controlla("nessun evento dal solo cambio del collegamento né dalla riclassificazione", !eventi(m).some((e) => e.aggiornamento_id === U(303) || e.aggiornamento_id === U(304)));
  controlla("cursore delle modifiche avanzato all'ultima letta", m.db.t("radar_notifiche_giri").some((g) => g.fase === "eventi" && g.giorno_roma === "2026-10-21" && g.cursore_modifiche === "2026-10-20T10:00:00Z"));
  controlla("conteggi del giro: modifiche saltate col motivo (il solo collegamento cambiato); la riclassificazione non si legge nemmeno (notifica_email falso)", e3.eseguito && !("saltata" in e3.eventi) && (e3.eventi as Record<string, number>).modifiche_saltate_documenti === 1 && !("modifiche_saltate_non_notificabile" in (e3.eventi as object)), e3);

  // ───── 5. stesso giro rieseguito domani di nuovo: la stessa proroga non rinasce ─────
  m.ora.t = new Date("2026-10-22T05:30:00Z");
  await eseguiPassaggio(m.d);
  controlla("la stessa proroga non dà un secondo evento nei giorni dopo", eventi(m).filter((e) => e.tipo === "proroga").length === 2);
  controlla("nessuna email doppia in tutto (chiavi distinte)", new Set(m.provider.consegnate.map((x) => x.chiave)).size === m.provider.consegnate.length);

  // ───── 6. riepilogo: solo A, B mai (anche con le correlate accese), gare senza luogo escluse con profilo regionale, N5 ─────
  await provaRiepilogo();

  // ───── 7. tetto per persona: 20 urgenti → 15 singole + 1 raggruppata con 5 incluse, nessun doppione ─────
  await provaTetto();

  // ───── 8. errori del provider, nuovi tentativi, affitti scaduti, caduta tra invio e scrittura ─────
  await provaErrori();

  // ───── 9. ricontrollo all'invio ─────
  await provaRicontrollo();

  // ───── 10. avviso «ravvicinato» ─────
  await provaRavvicinata();

  // ───── 11. parametri N1, N6, N7 e conservazione ─────
  await provaParametri();

  // ───── 11bis. difetto del 20/11: proroga di UN solo lotto ─────
  await provaLotti();

  // ───── 11ter. N6 decisa: la compattazione annulla solo il testo, mai chiavi ed esiti ─────
  await provaCompattazioneIntatta();

  // ───── 11quater. difetto 3.3 (proposta A): gare classificate dopo il giro che le ha viste ─────
  await provaSospese();

  // ───── 11quinquies. O1: presa in carico con gli affitti scaduti (ordine, concorrenza, passaggio a vuoto) ─────
  await provaPresaInCarico();

  // ───── 12. adattatore Resend (chiuso): classificazione delle risposte ─────
  provaResend();

  // ───── 13. guardia delle fonti nel calcolo delle modifiche (fonteAutorizzata, uso «notifiche») ─────
  provaD5();

  // ───── 14. simulazione di 10 giorni (con il cambio d'ora del 25/10/2026) ─────
  await provaSimulazione();

  // ───── O2 (44A): confronto A/B sugli stessi scenari ─────
  await provaO2AB();

  // ───── Z8 (documento 46): fonti nascoste in aggiunta al database (decisione 7.14 nel collaudo) ─────
  await provaFontiNascosteAggiunte();

  // ───── 48A: la PVL di nuovo visibile nei promemoria, nei riepiloghi e nelle rettifiche ─────
  await provaPvlVisibile();

  // ───── 15. testo dei file e rotta ─────
  provaTesto();
  await provaRotta();
}

async function provaFontiNascosteAggiunte(): Promise<void> {
  // gara 2 = solo PVL, nella lista dell'impresa 2, a 5 giorni; la riga «pvl» del mondo la dichiara VISIBILE
  const chiavePvl = `p:${U(102)}`;
  const senza = mondo();
  await eseguiPassaggio(senza.d);
  const pvlSenza = eventi(senza).filter((e) => e.gara_chiave === chiavePvl);
  controlla("fonti nascoste aggiunte: di base (campo assente) la gara solo PVL dà il suo promemoria, come prima", pvlSenza.length === 1 && pvlSenza[0].tipo === "scadenza_5", eventi(senza).map((e) => `${e.gara_chiave}:${e.tipo}`));
  const con = mondo();
  con.d.fontiNascosteAggiunte = ["pvl"];
  await eseguiPassaggio(con.d);
  const pvlCon = eventi(con).filter((e) => e.gara_chiave === chiavePvl || JSON.stringify(e.dati ?? {}).includes(U(102)));
  controlla("fonti nascoste aggiunte: con «pvl» la gara solo PVL non compare in nessun evento (né promemoria né riepilogo) — decisione 7.14", pvlCon.length === 0, pvlCon.map((e) => `${e.gara_chiave}:${e.tipo}`));
  controlla("fonti nascoste aggiunte: nessuna consegna per la gara solo PVL", !consegne(con).some((c) => String(c.chiave).includes(U(102))));
  controlla("fonti nascoste aggiunte: tutti gli altri eventi identici (stesse chiavi e tipi)",
    JSON.stringify(eventi(con).map((e) => `${e.impresa_id}:${e.gara_chiave}:${e.tipo}`).sort()) === JSON.stringify(eventi(senza).filter((e) => e.gara_chiave !== chiavePvl && e.tipo !== "riepilogo_opportunita").concat(eventi(senza).filter((e) => e.tipo === "riepilogo_opportunita")).map((e) => `${e.impresa_id}:${e.gara_chiave}:${e.tipo}`).sort()));
  controlla("fonti nascoste aggiunte: nessuna richiesta in più al database", con.db.conta() <= senza.db.conta(), { con: con.db.conta(), senza: senza.db.conta() });

  // la regola UNICA delle fonti nascoste (fonti-gara-calcoli.ts), la stessa delle pagine. Decisioni del 23/11: la PVL è VISIBILE (48A,
  // revoca della 7.14) e SardegnaCAT anche, senza parere (48E, D4-bis): nessuna fonte nascosta di base; la console può sempre nasconderne una
  controlla("regola delle fonti: nessuna riga → NESSUNA fonte nascosta di base (PVL 48A, SardegnaCAT 48E)", JSON.stringify(fontiNascosteDa([])) === JSON.stringify([]));
  controlla("regola delle fonti: la riga esplicita decide (sardegnacat visibile, ted nascosta)",
    JSON.stringify(fontiNascosteDa([{ fonte: "sardegnacat", nascosta_ai_clienti: false }, { fonte: "ted", nascosta_ai_clienti: true }])) === JSON.stringify(["ted"]));
  controlla("regola delle fonti: una fonte nascosta dalla console (riga «true») resta nascosta", JSON.stringify(fontiNascosteDa([{ fonte: "sardegnacat", nascosta_ai_clienti: true }, { fonte: "pvl", nascosta_ai_clienti: false }])) === JSON.stringify(["sardegnacat"]));
  controlla("regola delle fonti: un valore nullo vale come riga mancante (visibile)", JSON.stringify(fontiNascosteDa([{ fonte: "sardegnacat", nascosta_ai_clienti: null }])) === JSON.stringify([]));
  controlla("regola delle fonti: le predefinite sono VUOTE", FONTI_NASCOSTE_PREDEFINITE.length === 0);
  const tipiPvl = async (righePvl: Riga[]) => {
    const m = mondo();
    m.db.tabelle.radar_fonti_stato = [...m.db.t("radar_fonti_stato").filter((r) => r.fonte !== "pvl"), ...righePvl];
    await eseguiPassaggio(m.d);
    return {
      eventi: eventi(m).filter((e) => e.gara_chiave === chiavePvl || JSON.stringify(e.dati ?? {}).includes(U(102))).length,
      consegne: consegne(m).filter((c) => eventi(m).some((e) => e.id === c.evento_id && e.gara_chiave === chiavePvl)).length,
      letture: m.db.richieste.filter((r) => r.tabella === "radar_fonti_stato").length,
    };
  };
  const assente = await tipiPvl([]);
  const nascosta = await tipiPvl([{ fonte: "pvl", nascosta_ai_clienti: true }]);
  const visibile = await tipiPvl([{ fonte: "pvl", nascosta_ai_clienti: false }]);
  controlla("48A motore: riga «pvl» ASSENTE → la gara solo PVL dà il suo promemoria con le consegne (visibile di base, come in produzione)", assente.eventi === 1 && assente.consegne > 0, assente);
  controlla("48A motore: riga «pvl» visibile (come sarà lo staging dopo la 48B) → il suo promemoria c'è", visibile.eventi === 1 && visibile.consegne === assente.consegne);
  controlla("48A motore: riga «pvl» nascosta (come lo staging oggi, fino alla 48B) → nessun evento", nascosta.eventi === 0);
  controlla("regola delle fonti: la lettura delle fonti resta UNA richiesta per passaggio, con o senza la riga", assente.letture === nascosta.letture && assente.letture === visibile.letture);
  // SardegnaCAT nel motore (48E): senza la riga è visibile come le altre; nascosta dalla console (riga «true») non dà eventi
  const eventiSardegna = async (righe: Riga[]) => {
    const m = mondo();
    m.db.tabelle.radar_fonti_stato = [...m.db.t("radar_fonti_stato").filter((r) => r.fonte !== "sardegnacat"), ...righe];
    await eseguiPassaggio(m.d);
    return eventi(m).filter((e) => e.gara_chiave === `p:${U(104)}`).length;
  };
  const sardegnaAssente = await eventiSardegna([]);
  const sardegnaVisibile = await eventiSardegna([{ fonte: "sardegnacat", nascosta_ai_clienti: false }]);
  const sardegnaNascosta = await eventiSardegna([{ fonte: "sardegnacat", nascosta_ai_clienti: true }]);
  controlla("48E motore: riga «sardegnacat» ASSENTE → la gara solo SardegnaCAT dà i suoi eventi (nessuna fonte nascosta di base)", sardegnaAssente > 0, sardegnaAssente);
  controlla("48E motore: riga «sardegnacat» visibile (lo staging dopo la sua richiesta) → gli stessi eventi", sardegnaVisibile === sardegnaAssente, { sardegnaVisibile, sardegnaAssente });
  controlla("48E motore: riga «sardegnacat» nascosta (dalla console, o lo staging di oggi) → nessun evento", sardegnaNascosta === 0, sardegnaNascosta);
  const pagine = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "radar", "fonti-nascoste.ts"), "utf8");
  controlla("regola delle fonti: fonti-nascoste.ts usa la STESSA regola (fontiNascosteDa) e, in caso di errore, le predefinite",
    /return fontiNascosteDa\(data \?\? \[\]\);/.test(pagine) && (pagine.match(/return \[\.\.\.FONTI_NASCOSTE_PREDEFINITE\];/g) ?? []).length === 2);
}

async function provaRotta(): Promise<void> {
  const { GET } = await import("../src/app/api/cron/radar-promemoria/route");
  const salvato = { segreto: process.env.CRON_SECRET, email: process.env.RADAR_NOTIFICHE_EMAIL };
  // ogni richiesta di rete (il database passa da fetch) contata: con l'interruttore spento la rotta non ne deve fare nessuna
  const fetchBloccata = globalThis.fetch;
  let richiesteRete = 0;
  globalThis.fetch = ((...a: Parameters<typeof fetch>) => {
    richiesteRete++;
    return fetchBloccata(...a);
  }) as typeof fetch;
  try {
    delete process.env.RADAR_NOTIFICHE_EMAIL;
    process.env.CRON_SECRET = "segreto-di-prova-sintetico";
    const richiesta = (h: Record<string, string>) => ({ headers: new Headers(h) }) as unknown as Parameters<typeof GET>[0];
    const senza = await GET(richiesta({}));
    controlla("rotta: senza il segreto del cron → 401", senza.status === 401);
    const sbagliato = await GET(richiesta({ authorization: "Bearer altro" }));
    controlla("rotta: segreto sbagliato → 401", sbagliato.status === 401);
    const giusto = await GET(richiesta({ authorization: "Bearer segreto-di-prova-sintetico" }));
    const corpo = (await giusto.json()) as { eseguito?: boolean; motivo?: string };
    controlla("rotta: segreto giusto e interruttore spento → nessun passaggio («spento»)", giusto.status === 200 && corpo.eseguito === false && corpo.motivo === "spento", corpo);
    // valori non esatti: restano «spento» (solo «attivo» accende)
    const nonEsatti: unknown[] = [];
    for (const v of ["ATTIVO", "1", "true", " attivo"]) {
      process.env.RADAR_NOTIFICHE_EMAIL = v;
      const r = await GET(richiesta({ authorization: "Bearer segreto-di-prova-sintetico" }));
      nonEsatti.push([v, r.status, ((await r.json()) as { motivo?: string }).motivo]);
    }
    delete process.env.RADAR_NOTIFICHE_EMAIL;
    controlla(
      "rotta: senza RADAR_NOTIFICHE_EMAIL=attivo (assente o con un valore non esatto) risponde «spento» SENZA nessuna richiesta di rete né al database (51 §10)",
      richiesteRete === 0 && nonEsatti.every((x) => JSON.stringify((x as unknown[]).slice(1)) === JSON.stringify([200, "spento"])),
      { richiesteRete, nonEsatti },
    );
    delete process.env.CRON_SECRET;
    const vuoto = await GET(richiesta({ authorization: "Bearer undefined" }));
    controlla("rotta: senza CRON_SECRET impostato nessuna chiamata passa", vuoto.status === 401);
  } finally {
    globalThis.fetch = fetchBloccata;
    if (salvato.segreto === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = salvato.segreto;
    if (salvato.email === undefined) delete process.env.RADAR_NOTIFICHE_EMAIL;
    else process.env.RADAR_NOTIFICHE_EMAIL = salvato.email;
  }
}

// Direttiva 48A (23/11/2026, revoca della 7.14): le gare PVL tornano nei promemoria, nei riepiloghi e nelle rettifiche come quelle delle
// altre fonti. Lo stesso scenario con la riga «pvl» visibile (lo staging dopo la 48B), assente (la produzione: nasce visibile) e nascosta
// (lo staging di oggi): con la PVL nascosta la gara UNITA TED+PVL resta visibile (basta una fonte visibile), la sola PVL no.
async function provaPvlVisibile(): Promise<void> {
  const scenario = async (righePvl: Riga[]) => {
    const m = mondo();
    m.db.tabelle.radar_fonti_stato = [...m.db.t("radar_fonti_stato").filter((r) => r.fonte !== "pvl"), ...righePvl];
    const soloPvl = gara(460, { chiave: "pvl:SINT-460", prima_rilevazione_il: "2026-10-19T09:00:00Z", scadenza_giorno: "2026-12-01" });
    const unita = gara(461, { fonti: ["ted", "pvl"], prima_rilevazione_il: "2026-10-19T09:00:00Z", scadenza_giorno: "2026-12-01" });
    m.db.t("radar_procedure").push(soloPvl, unita);
    for (const g of [soloPvl, unita]) {
      m.db.t("radar_classificazioni_stato").push({ procedura_id: g.id, stato: "classificata" });
      m.db.t("radar_classificazioni").push({ procedura_id: g.id, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true });
    }
    await eseguiPassaggio(m.d);
    const riepilogo = new Set(((eventi(m).find((e) => e.tipo === "riepilogo_opportunita" && e.impresa_id === I1)?.dati as EventoRiepilogo | undefined)?.gare ?? []).map((g) => g.proceduraId));
    const promemoria = eventi(m).filter((e) => e.gara_chiave === `p:${U(102)}` && String(e.tipo).startsWith("scadenza_"));
    const consegnePromemoria = consegne(m).filter((c) => promemoria.some((e) => e.id === c.evento_id)).length;
    // proroga arrivata dalla SOLA PVL sulla gara solo PVL (gara 2, nella lista dell'impresa 2)
    const p2 = m.db.t("radar_procedure").find((p) => p.id === U(102))!;
    Object.assign(p2, { scadenza_giorno: "2026-11-02", scadenza_offerte: "2026-11-02T11:00:00Z", scadenza_ora_indicata: true });
    m.db.t("radar_aggiornamenti").push({ id: U(360), tipo: "proroga", fonte: "pvl", id_fonte: "pvl-avviso-60", avviso_ted: null, affidabilita: "confronto_versioni", rilevato_il: "2026-10-20T10:00:00Z", procedura_id: U(102), campo: "scadenza_offerte", valore_precedente: "2026-10-25T10:00:00Z", valore_nuovo: "2026-11-02T12:00:00+01:00", notificabile: true, notifica_email: true, avviso_url: "https://esempio.invalid/rettifica-pvl", avviso_pubblicato_il: "2026-10-20", dichiarazione_fonte: null });
    // e una proroga dalla SOLA PVL sulla gara UNITA TED+PVL (gara 1, nella lista dell'impresa 1): la gara resta visibile per TED, ma la
    // notizia viene da una fonte che, se nascosta, il cliente non vede
    const p1 = m.db.t("radar_procedure").find((p) => p.id === U(101))!;
    Object.assign(p1, { fonti: ["ted", "pvl"], scadenza_giorno: "2026-11-06", scadenza_offerte: "2026-11-06T11:00:00Z" });
    m.db.t("radar_aggiornamenti").push({ id: U(361), tipo: "proroga", fonte: "pvl", id_fonte: "pvl-avviso-61", avviso_ted: null, affidabilita: "confronto_versioni", rilevato_il: "2026-10-20T10:00:00Z", procedura_id: U(101), campo: "scadenza_offerte", valore_precedente: "2026-10-30T11:00:00Z", valore_nuovo: "2026-11-06T12:00:00+01:00", notificabile: true, notifica_email: true, avviso_url: "https://esempio.invalid/rettifica-pvl-unita", avviso_pubblicato_il: "2026-10-20", dichiarazione_fonte: null });
    m.ora.t = new Date("2026-10-21T05:30:00Z");
    await eseguiPassaggio(m.d);
    const proroghe = eventi(m).filter((e) => e.tipo === "proroga" && e.gara_chiave === `p:${U(102)}`);
    const consegneProroga = consegne(m).filter((c) => proroghe.some((e) => e.id === c.evento_id)).length;
    const prorogheUnita = eventi(m).filter((e) => e.tipo === "proroga" && e.gara_chiave === `p:${U(101)}`).length;
    return { soloPvl: riepilogo.has(soloPvl.id), unita: riepilogo.has(unita.id), promemoria: promemoria.length, consegnePromemoria, proroghe: proroghe.length, consegneProroga, prorogheUnita };
  };
  const visibile = await scenario([{ fonte: "pvl", nascosta_ai_clienti: false }]);
  const assente = await scenario([]);
  const nascosta = await scenario([{ fonte: "pvl", nascosta_ai_clienti: true }]);
  controlla("48A notifiche, PVL visibile: la gara solo PVL e quella unita TED+PVL entrano nel riepilogo", visibile.soloPvl && visibile.unita, visibile);
  controlla("48A notifiche, PVL visibile: il promemoria della gara solo PVL, con le sue consegne", visibile.promemoria === 1 && visibile.consegnePromemoria > 0, visibile);
  controlla("48A notifiche, PVL visibile: la proroga arrivata dalla sola PVL dà il suo evento e le consegne", visibile.proroghe === 1 && visibile.consegneProroga > 0, visibile);
  controlla("48A notifiche, PVL visibile: la proroga dalla sola PVL sulla gara unita TED+PVL dà il suo evento", visibile.prorogheUnita > 0, visibile);
  controlla("48A notifiche, riga «pvl» assente (produzione): esattamente come visibile", JSON.stringify(assente) === JSON.stringify(visibile), { assente, visibile });
  controlla("48A notifiche, PVL nascosta: la sola PVL esce da riepilogo, promemoria e proroghe; l'unita TED+PVL resta nel riepilogo", !nascosta.soloPvl && nascosta.unita && nascosta.promemoria === 0 && nascosta.proroghe === 0, nascosta);
  controlla("48A notifiche, PVL nascosta: la proroga arrivata dalla sola PVL non dà eventi nemmeno sulla gara unita (fonte non visibile)", nascosta.prorogheUnita === 0, nascosta);
}

async function provaRiepilogo(): Promise<void> {
  const m = mondo();
  const nuove: RigaGara[] = [];
  for (let i = 0; i < 25; i++) nuove.push(gara(400 + i, { prima_rilevazione_il: `2026-10-19T${String(10 + (i % 10)).padStart(2, "0")}:00:00Z`, data_pubblicazione: i < 3 ? "2026-10-19" : "2026-10-18", scadenza_giorno: "2026-12-01" }));
  const b = gara(450, { prima_rilevazione_il: "2026-10-19T09:00:00Z", scadenza_giorno: "2026-12-01" });
  const senzaLuogo = gara(451, { prima_rilevazione_il: "2026-10-19T09:00:00Z", luogo_regioni: [], scadenza_giorno: "2026-12-01" });
  const salvata = gara(452, { prima_rilevazione_il: "2026-10-19T09:00:00Z", scadenza_giorno: "2026-12-01" });
  const vecchia = gara(453, { prima_rilevazione_il: "2026-10-19T09:00:00Z", data_pubblicazione: "2026-10-01", scadenza_giorno: "2026-12-01" });
  m.db.t("radar_procedure").push(...nuove, b, senzaLuogo, salvata, vecchia);
  for (const g of [...nuove, senzaLuogo, salvata, vecchia]) {
    m.db.t("radar_classificazioni_stato").push({ procedura_id: g.id, stato: "classificata" });
    m.db.t("radar_classificazioni").push({ procedura_id: g.id, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true });
  }
  m.db.t("radar_classificazioni_stato").push({ procedura_id: b.id, stato: "classificata" });
  m.db.t("radar_classificazioni").push({ procedura_id: b.id, settore: "pulizia", rilevanza: "B", sottocategorie: [], attiva: true });
  m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: salvata.id, aggiunta_id: null, creata_il: "2026-10-19T12:00:00Z" });
  await eseguiPassaggio(m.d);
  const r = eventi(m).find((e) => e.tipo === "riepilogo_opportunita" && e.impresa_id === I1);
  const dati = r?.dati as EventoRiepilogo | undefined;
  const ids = new Set((dati?.gare ?? []).map((g) => g.proceduraId));
  controlla("riepilogo: un evento per l'impresa, versione = giorno di Roma", !!r && r.versione === "2026-10-20" && r.gara_chiave === "riepilogo");
  controlla("riepilogo: al più 20 gare più «altre 5»", dati?.gare.length === 20 && dati?.altreNonIncluse === 5, { n: dati?.gare.length, altre: dati?.altreNonIncluse });
  controlla("riepilogo: MAI una B, anche con le correlate accese nel profilo", !ids.has(b.id));
  controlla("riepilogo: ogni gara con rilevanza «A» (campo facoltativo N4)", (dati?.gare ?? []).every((g) => g.rilevanza === "A"));
  controlla("riepilogo: gara senza luogo esclusa con un profilo regionale", !ids.has(senzaLuogo.id));
  controlla("riepilogo: N5, gara già salvata dall'impresa esclusa", !ids.has(salvata.id));
  controlla("riepilogo: gara pubblicata da più di 7 giorni esclusa", !ids.has(vecchia.id));
  controlla("riepilogo: le più recenti prima", (dati?.gare ?? []).slice(0, 3).every((g) => nuove.slice(0, 3).some((n) => n.id === g.proceduraId)));
  controlla("riepilogo: solo a chi ha «nuove opportunità» accese (titolare sì, Ufficio Gare no)", di(m, (c) => c.evento_id === r?.id).map((c) => c.destinatario_id).join() === I1);
  controlla("riepilogo: I2 senza profilo non riceve nulla", !eventi(m).some((e) => e.tipo === "riepilogo_opportunita" && e.impresa_id === I2));
  // N5 spento: anche la gara già salvata entra
  const m2 = mondo({ parametri: { escludiGiaSalvateDalRiepilogo: false } });
  m2.db.t("radar_procedure").push(salvata);
  m2.db.t("radar_classificazioni_stato").push({ procedura_id: salvata.id, stato: "classificata" });
  m2.db.t("radar_classificazioni").push({ procedura_id: salvata.id, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true });
  m2.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: salvata.id, aggiunta_id: null, creata_il: "2026-10-19T12:00:00Z" });
  await eseguiPassaggio(m2.d);
  const r2 = eventi(m2).find((e) => e.tipo === "riepilogo_opportunita")?.dati as EventoRiepilogo | undefined;
  controlla("N5 spento: la gara già salvata entra nel riepilogo", !!r2?.gare.some((g) => g.proceduraId === salvata.id));
  // funzione pura: la B resta fuori anche passando direttamente le righe
  const soloB: RigaNuova[] = [{ ...b, classificazione_stato: { stato: "classificata" }, classificazioni: [{ settore: "pulizia", rilevanza: "B", sottocategorie: [], attiva: true }] }];
  const e = eventoRiepilogo({ oggi: "2026-10-20", adesso: new Date("2026-10-20T06:00:00Z"), impresaId: I1, profilo: { impresaId: I1, settori: ["pulizia"], sottocategorie: {}, procedure: [], regioni: [], importoMin: null, importoMax: null, vedereCorrelate: true }, nuove: soloB, giaInLista: new Set(), parametri: { escludiGiaSalvateDalRiepilogo: true }, nascoste: new Set(), env: STAGING, origine: "http://localhost:3000", nuovoId: () => U(1), adessoIso: "2026-10-20T06:00:00Z" });
  controlla("riepilogo (puro): solo B → nessun evento", e === null);
}

async function provaTetto(): Promise<void> {
  const m = mondo();
  // 20 gare salvate da I1 con il promemoria a 1 giorno OGGI (urgenti), entrate nella lista giorni fa
  for (let i = 0; i < 20; i++) {
    const g = gara(500 + i, { scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T09:00:00Z", scadenza_ora_indicata: true });
    m.db.t("radar_procedure").push(g);
    m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" });
  }
  await eseguiPassaggio(m.d);
  const mie = di(m, (c) => c.destinatario_id === I1);
  const singoleInviate = mie.filter((c) => c.tipo_consegna === "singola" && c.stato === "inviata");
  const raggruppate = mie.filter((c) => c.tipo_consegna === "raggruppata");
  const incluse = mie.filter((c) => c.stato === "inclusa");
  controlla("tetto: al più 15 email singole per persona nel passaggio", singoleInviate.length === 15, singoleInviate.length);
  controlla("tetto: gli urgenti oltre il tetto partono SUBITO in una sola email raggruppata", raggruppate.length === 1 && raggruppate[0].stato === "inviata", raggruppate.map((r) => r.stato));
  const urgentiI1 = mie.filter((c) => c.tipo_consegna === "singola" && ["scadenza_1"].includes(tipoDi(m, c))).length;
  const urgentiInCoda = mie.filter((c) => c.stato === "in_coda" && ["scadenza_1", "scadenza_ravvicinata", "proroga", "modifica_scadenza", "annullamento", "rettifica"].includes(tipoDi(m, c)));
  const nonUrgentiInCoda = mie.filter((c) => c.stato === "in_coda" && ["scadenza_5", "scadenza_10"].includes(tipoDi(m, c)));
  controlla("tetto: urgenti = 15 singole + le altre incluse nel raggruppamento (nessuna persa, nessuna rinviata)", incluse.length + singoleInviate.length === urgentiI1 && incluse.every((c) => c.inclusa_in === raggruppate[0]?.id) && urgentiInCoda.length === 0, { incluse: incluse.length, urgentiI1 });
  controlla("tetto: i promemoria a 5 e 10 giorni oltre il tetto aspettano il passaggio dopo (30 minuti)", nonUrgentiInCoda.length === 2 && nonUrgentiInCoda.every((c) => c.prossimo_tentativo_il === "2026-10-20T06:00:00.000Z"), nonUrgentiInCoda.map((c) => c.prossimo_tentativo_il));
  m.ora.t = new Date("2026-10-20T06:00:00Z");
  await eseguiPassaggio(m.d);
  controlla("tetto: al passaggio dopo partono anche loro", di(m, (c) => c.destinatario_id === I1 && c.stato === "in_coda").length === 0);
  controlla("tetto: email consegnate a I1 nei due passaggi = 18 (15 singole + 1 raggruppata, poi i 2 promemoria non urgenti)", m.provider.consegnate.filter((x) => x.a === "titolare1@prova.test").length === 18);
  controlla("tetto: nessuna consegna inclusa partita da sola", incluse.every((c) => !m.provider.consegnate.some((x) => x.chiave === `omnia-radar/${c.id}`)));
  // l'email raggruppata, ritentata dopo una caduta della rete, ha lo STESSO contenuto (la chiave di idempotenza lo pretende)
  {
    const m2 = mondo();
    for (let i = 0; i < 20; i++) {
      const g = gara(500 + i, { scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T09:00:00Z", scadenza_ora_indicata: true });
      m2.db.t("radar_procedure").push(g);
      m2.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" });
    }
    const originale = m2.provider.invia.bind(m2.provider);
    let cadute = 0;
    m2.d.provider = {
      nome: "finto",
      quotaResidua: () => null,
      invia: async (x) => {
        const r = await originale(x);
        if (x.tags.some((t) => t.value === "raggruppamento") && cadute++ === 0) return { esito: "riprova", codice: "rete", attesaSecondi: null, dopoInvio: true };
        return r;
      },
    };
    await eseguiPassaggio(m2.d);
    const raggr = di(m2, (c) => c.tipo_consegna === "raggruppata" && c.destinatario_id === I1);
    controlla("raggruppata: dopo la caduta della rete resta in coda (nessuna perdita)", raggr.length === 1 && raggr[0].stato === "in_coda", raggr.map((c) => c.stato));
    m2.ora.t = new Date("2026-10-20T05:40:00Z");
    await eseguiPassaggio(m2.d);
    const dopo = di(m2, (c) => c.tipo_consegna === "raggruppata" && c.destinatario_id === I1);
    controlla("raggruppata: il nuovo tentativo ha lo stesso contenuto (inviata, non «esito_incerto») e nessuna email doppia", dopo.length === 1 && dopo[0].stato === "inviata" && new Set(m2.provider.consegnate.map((x) => x.chiave)).size === m2.provider.consegnate.length, dopo.map((c) => [c.stato, c.motivo]));
  }
  // pianoInvioCompleto: il riepilogo non entra mai in un raggruppamento
  const coda: ConsegnaInCoda[] = [...Array.from({ length: 16 }, (_, i) => ({ id: `u${i}`, tipo: "scadenza_1" as TipoEvento, creataIl: "2026-10-20T05:00:00Z", giornoEvento: "2026-10-20" })), { id: "r", tipo: "riepilogo_opportunita", creataIl: "2026-10-20T05:00:00Z", giornoEvento: "2026-10-20" }];
  const p = pianoInvioCompleto(coda, { oggi: "2026-10-20", ultimoPassaggioDelGiorno: false, quotaResidua: null });
  controlla("piano completo: riepilogo mai raggruppato, rinviato se non c'è posto", !p.raggruppate.includes("r") && p.rinviate.includes("r"), p);
  const pu = pianoInvioCompleto(coda, { oggi: "2026-10-20", ultimoPassaggioDelGiorno: true, quotaResidua: null });
  controlla("piano completo: all'ultimo passaggio del giorno il riepilogo parte comunque", pu.singole.includes("r") && !pu.raggruppate.includes("r"), pu);
  const pq = pianoInvioCompleto(coda, { oggi: "2026-10-20", ultimoPassaggioDelGiorno: true, quotaResidua: 0 });
  controlla("piano completo: senza quota tutto resta in coda", pq.singole.length === 0 && pq.raggruppate.length === 0 && pq.rinviate.length === 17);
}

async function provaErrori(): Promise<void> {
  // 429 di frequenza, poi successo con la STESSA chiave
  {
    const copione: CopioneFinto = (_m, n) => (n === 0 ? { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false } : null);
    const m = mondo({ copione });
    await eseguiPassaggio(m.d);
    const tutte = consegne(m);
    controlla("429: tutte di nuovo in coda dopo 5 minuti, nessuna persa", tutte.length > 0 && tutte.every((c) => c.stato === "in_coda" && c.tentativi === 1 && c.prossimo_tentativo_il === "2026-10-20T05:35:00.000Z"), tutte.map((c) => [c.stato, c.prossimo_tentativo_il]));
    m.ora.t = new Date("2026-10-20T05:36:00Z");
    await eseguiPassaggio(m.d);
    controlla("429: al tentativo dopo partono, con la stessa chiave di idempotenza", consegne(m).every((c) => c.stato === "inviata" && c.tentativi === 2) && m.provider.consegnate.length === tutte.length);
  }
  // rete caduta DOPO l'invio: il finto aveva già consegnato; il nuovo tentativo con la stessa chiave NON consegna di nuovo
  {
    let caduta = true;
    const copione: CopioneFinto = () => null;
    const m = mondo({ copione });
    const originale = m.provider.invia.bind(m.provider);
    m.d.provider = {
      nome: "finto",
      quotaResidua: () => null,
      invia: async (x) => {
        const r = await originale(x);
        if (caduta) return { esito: "riprova", codice: "rete", attesaSecondi: null, dopoInvio: true };
        return r;
      },
    };
    await eseguiPassaggio(m.d);
    const n = m.provider.consegnate.length;
    caduta = false;
    m.ora.t = new Date("2026-10-20T05:40:00Z");
    await eseguiPassaggio(m.d);
    controlla("rete caduta dopo l'invio: il nuovo tentativo con la stessa chiave non duplica", m.provider.consegnate.length === n && consegne(m).every((c) => c.stato === "inviata"), { n, dopo: m.provider.consegnate.length });
  }
  // finestra di 24 ore: oltre, «esito_incerto» (mai un rinvio alla cieca)
  {
    const a = esitoDopoInvio({ tentativi: 3, primoTentativoIl: "2026-10-19T06:00:00Z" }, { esito: "riprova", codice: "rete", attesaSecondi: null, dopoInvio: true }, "finto", new Date("2026-10-20T05:50:00Z"), { attesaMinuti: [5, 30, 120, 360, 720], finestraOre: 24 });
    controlla("oltre la finestra di 24 ore con invio forse avvenuto: esito_incerto", a.stato === "esito_incerto" && a.motivo === "finestra_idempotenza_scaduta", a);
    const b = esitoDopoInvio({ tentativi: 5, primoTentativoIl: "2026-10-20T00:00:00Z" }, { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false }, "finto", new Date("2026-10-20T05:50:00Z"), { attesaMinuti: [5, 30, 120, 360, 720], finestraOre: 24 });
    controlla("tentativi esauriti senza invio: fallita", b.stato === "fallita" && b.motivo === "tentativi_esauriti", b);
    const c = esitoDopoInvio({ tentativi: 0, primoTentativoIl: null }, { esito: "riprova", codice: "429", attesaSecondi: 90, dopoInvio: false }, "finto", new Date("2026-10-20T05:00:00Z"), { attesaMinuti: [5], finestraOre: 24 });
    controlla("retry-after del provider rispettato", c.stato === "in_coda" && c.prossimo_tentativo_il === "2026-10-20T05:01:30.000Z", c);
    const q = esitoDopoInvio({ tentativi: 1, primoTentativoIl: "2026-10-20T05:00:00Z" }, { esito: "quota", codice: "daily_quota_exceeded" }, "finto", new Date("2026-10-20T15:00:00Z"), { attesaMinuti: [5], finestraOre: 24 });
    controlla("quota esaurita: in coda per il giorno dopo, nessun tentativo contato", q.stato === "in_coda" && q.tentativi === 1 && q.prossimo_tentativo_il === "2026-10-21T05:30:00.000Z" && q.motivo === "quota_provider", q);
    const i = esitoDopoInvio({ tentativi: 0, primoTentativoIl: null }, { esito: "incerto", codice: "invalid_idempotent_request" }, "finto", new Date(), { attesaMinuti: [5], finestraOre: 24 });
    controlla("409 contenuto diverso: esito_incerto", i.stato === "esito_incerto");
  }
  // 401: fallita, la fase si ferma, il resto torna in coda
  {
    const copione: CopioneFinto = () => ({ esito: "fallita", codice: "invalid_api_key", configurazione: true });
    const m = mondo({ copione });
    const e = await eseguiPassaggio(m.d);
    const f = consegne(m).filter((c) => c.stato === "fallita");
    controlla("errore di configurazione: una sola fallita, la fase si ferma, le altre restano in coda", f.length === 1 && f[0].motivo === "configurazione_provider" && consegne(m).filter((c) => c.stato === "in_coda").length === consegne(m).length - 1 && e.eseguito && (e.invio as Record<string, number>).fermo_configurazione_provider === 1, { stati: consegne(m).map((c) => c.stato), e });
  }
  // quota esaurita: nulla parte, nulla si perde
  {
    const m = mondo({ quota: 0 });
    await eseguiPassaggio(m.d);
    controlla("quota 0: nessuna email, tutte in coda", m.provider.consegnate.length === 0 && consegne(m).every((c) => c.stato === "in_coda"), consegne(m).map((c) => c.stato));
  }
  // affitto scaduto e caduta tra l'invio e la scrittura dell'esito
  {
    const m = mondo();
    m.db.guasti.set("omnia_ai_radar_email_consegne|upsert", 0);
    // il primo passaggio crea eventi e consegne; facciamo cadere la scrittura degli ESITI (il secondo upsert del blocco)
    let upsert = 0;
    const da = m.d.admin.from.bind(m.d.admin);
    m.d.admin = {
      ...m.db,
      rpc: m.db.rpc.bind(m.db),
      from: (t: string) => {
        const q = da(t) as unknown as { upsert: (...a: unknown[]) => unknown };
        if (t === "omnia_ai_radar_email_consegne") {
          const orig = q.upsert.bind(q);
          q.upsert = (...a: unknown[]) => {
            const o = a[1] as { onConflict?: string } | undefined;
            if (o?.onConflict === "id" && (a[0] as { stato?: string }[]).some((r) => r.stato === "inviata") && ++upsert === 1) throw new Error("processo caduto");
            return orig(...a);
          };
        }
        return q;
      },
    } as unknown as DipendenzeMotore["admin"];
    await eseguiPassaggio(m.d);
    const inviateDalFinto = m.provider.consegnate.length;
    const appese = consegne(m).filter((c) => c.stato === "in_invio");
    controlla("caduta tra invio e scrittura: consegne rimaste «in_invio» con l'affitto", inviateDalFinto > 0 && appese.length === inviateDalFinto, { inviateDalFinto, appese: appese.length });
    m.ora.t = new Date("2026-10-20T05:50:00Z"); // affitto di 10 minuti scaduto
    await eseguiPassaggio(m.d);
    controlla("affitto scaduto (O1): riprese nella presa in carico e chiuse con la stessa chiave, NESSUNA email doppia", consegne(m).every((c) => c.stato === "inviata") && m.provider.consegnate.length === inviateDalFinto, { finto: m.provider.consegnate.length, stati: consegne(m).map((c) => c.stato) });
  }
  // un errore del database nella fase «eventi»: giro «fallito», la fase «invio» continua
  {
    const m = mondo();
    m.db.guasti.set("omnia_ai_radar_eventi|upsert", 1);
    const e = await eseguiPassaggio(m.d);
    controlla("errore del database negli eventi: giro «fallito» con il passo, nessuna eccezione", e.eseguito && "saltata" in e.eventi && String(e.eventi.saltata).startsWith("errore:eventi") && m.db.t("radar_notifiche_giri").some((g) => g.fase === "eventi" && g.esito === "fallito"), e);
    m.ora.t = new Date("2026-10-20T06:00:00Z");
    await eseguiPassaggio(m.d);
    controlla("il passaggio dopo rifà la fase «eventi» dello stesso giorno (nessun giro riuscito)", eventi(m).length > 0 && consegne(m).every((c) => c.stato === "inviata"));
  }
  // un giro in corso blocca il secondo; un blocco scaduto si libera
  {
    const m = mondo();
    m.db.t("radar_notifiche_giri").push({ id: "g-occupato", giorno_roma: "2026-10-20", fase: "eventi", esito: "in_corso", iniziato_il: "2026-10-20T05:29:00Z", in_corso_fino_il: "2026-10-20T05:44:00Z", ambiente: "staging", provider: "finto" });
    const e = await eseguiPassaggio(m.d);
    controlla("uno alla volta: con un giro «eventi» in corso il secondo non parte", e.eseguito && "saltata" in e.eventi && e.eventi.saltata === "altro_giro_in_corso" && eventi(m).length === 0, e);
    m.ora.t = new Date("2026-10-20T06:00:00Z");
    await eseguiPassaggio(m.d);
    controlla("uno alla volta: il blocco scaduto si libera («blocco_scaduto») e il giro riparte", m.db.t("radar_notifiche_giri").some((g) => g.id === "g-occupato" && g.esito === "fallito" && g.errore === "blocco_scaduto") && eventi(m).length > 0);
  }
}

async function provaRicontrollo(): Promise<void> {
  const copione: CopioneFinto = (_m, n) => (n === 0 ? { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false } : null);
  const m = mondo({ copione });
  await eseguiPassaggio(m.d); // tutte in coda dopo il 429
  // tra la creazione e l'invio: M1 spegne le scadenze, I1 toglie la gara aggiunta dalla lista, I2 perde l'abbonamento
  Object.assign(m.db.t("omnia_ai_radar_notifiche_persone").find((p) => p.user_id === M1)!, { scadenze: false });
  m.db.tabelle.omnia_ai_radar_salvate = m.db.t("omnia_ai_radar_salvate").filter((s) => s.aggiunta_id !== U(201));
  m.accesso.set(I2, "cessato");
  m.ora.t = new Date("2026-10-20T05:36:00Z");
  await eseguiPassaggio(m.d);
  const m1 = di(m, (c) => c.destinatario_id === M1);
  controlla("ricontrollo: categoria spenta dopo la creazione → scartata («categoria_spenta»; la gara tolta dalla lista viene prima)", m1.length > 0 && m1.every((c) => c.stato === "scartata" && ["categoria_spenta", "gara_fuori_lista"].includes(String(c.motivo))) && m1.some((c) => c.motivo === "categoria_spenta"), m1.map((c) => [c.stato, c.motivo]));
  const aggiunta = di(m, (c) => c.destinatario_id === I1 && String(eventi(m).find((e) => e.id === c.evento_id)?.gara_chiave).startsWith("a:"));
  controlla("ricontrollo: gara tolta dalla lista → scartata («gara_fuori_lista»)", aggiunta.length === 1 && aggiunta[0].stato === "scartata" && aggiunta[0].motivo === "gara_fuori_lista", aggiunta.map((c) => [c.stato, c.motivo]));
  const i2 = di(m, (c) => c.impresa_id === I2);
  controlla("ricontrollo: abbonamento scaduto (N1) → scartata", i2.length > 0 && i2.every((c) => c.stato === "scartata" && c.motivo === "abbonamento_non_valido"), i2.map((c) => [c.stato, c.motivo]));
  controlla("ricontrollo: le scartate non partono mai", !m.provider.consegnate.some((x) => consegne(m).some((c) => c.stato === "scartata" && x.chiave === `omnia-radar/${c.id}`)));
  // la scadenza cambia nell'archivio mentre il promemoria aspetta in coda (stesso giorno: la fase «eventi» non rigira) → scartato all'invio
  const s = mondo({ copione });
  await eseguiPassaggio(s.d);
  Object.assign(s.db.t("radar_procedure").find((p) => p.id === U(101))!, { scadenza_giorno: "2026-11-06", scadenza_offerte: "2026-11-06T11:00:00Z" });
  s.ora.t = new Date("2026-10-20T05:36:00Z");
  await eseguiPassaggio(s.d);
  const dieci = di(s, (c) => tipoDi(s, c) === "scadenza_10" && c.impresa_id === I1);
  controlla("ricontrollo: scadenza cambiata dopo la nascita del promemoria → scartato («scadenza_cambiata»), mai inviato", dieci.length > 0 && dieci.every((c) => c.stato === "scartata" && c.motivo === "scadenza_cambiata"), dieci.map((c) => [c.stato, c.motivo]));
}

async function provaRavvicinata(): Promise<void> {
  const m = mondo({ inizio: "2026-10-20T14:00:00Z" });
  // una gara nuova salvata ORA con la scadenza domani alle 10 (1 giorno): avviso immediato una volta sola
  const g = gara(600, { scadenza_giorno: "2026-10-21", scadenza_offerte: "2026-10-21T08:00:00Z", scadenza_ora_indicata: true });
  m.db.t("radar_procedure").push(g);
  m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-20T13:59:00Z" });
  const ent = { impresaId: I1, proceduraId: g.id, aggiuntaId: null, autoreId: M1 };
  const r1 = await dopoIngressoInLista(ent, { env: STAGING, dipendenze: m.d });
  controlla("ravvicinata: evento e consegne creati e inviati subito (titolare e Ufficio Gare)", r1.esito === "accodata" && r1.eventi === 1 && r1.consegne === 2 && m.provider.consegnate.length === 2, r1);
  const r2 = await dopoIngressoInLista(ent, { env: STAGING, dipendenze: m.d });
  controlla("ravvicinata: la seconda volta niente (una volta sola per versione)", r2.esito === "non_dovuta" && m.provider.consegnate.length === 2, r2);
  const spento = await dopoIngressoInLista(ent, { env: {}, dipendenze: m.d });
  controlla("ravvicinata: interruttore spento → «spento»", spento.esito === "spento");
  // con il promemoria a 1 giorno già nato per quella versione: nessun avviso ravvicinato
  const m2 = mondo({ inizio: "2026-10-20T14:00:00Z" });
  m2.db.t("radar_procedure").push(g);
  m2.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-20T13:59:00Z" });
  m2.db.t("omnia_ai_radar_eventi").push({ id: "e-1", impresa_id: I1, categoria: "scadenze", tipo: "scadenza_1", gara_chiave: `p:${g.id}`, versione: "2026-10-21T08:00:00.000Z", stato: "attivo", dati: {}, creato_il: "2026-10-20T05:30:00Z" });
  const r3 = await eseguiRavvicinata(m2.d, ent);
  controlla("ravvicinata: mai se il promemoria a 1 giorno è già nato", r3.esito === "non_dovuta" && r3.motivo === "scadenza_non_ravvicinata", r3);
  // scadenza lontana: nessun avviso
  const m3 = mondo({ inizio: "2026-10-20T14:00:00Z" });
  const r4 = await eseguiRavvicinata(m3.d, { ...ent, proceduraId: U(101) });
  controlla("ravvicinata: scadenza a 10 giorni → nessun avviso", r4.esito === "non_dovuta", r4);
}

// Difetto 3.3 (proposta A, approvata dall'utente il 20/11): una gara letta da un giro quando non era ancora classificata resta «in sospeso»
// nel giro (radar_notifiche_giri.nuove_in_sospeso, bozza 0125) e si rivaluta al giro dopo. Prima la gara era persa per sempre (R1).
// O1 (approvata dall'utente il 20/11): UNA lettura delle consegne prendibili (in coda e dovute, oppure con l'affitto scaduto) e UN
// aggiornamento condizionato. Recupero identico, stesso ordine di priorità, mai una consegna presa due volte da passaggi concorrenti.
async function provaPresaInCarico(): Promise<void> {
  const consegna = (n: number, p: Riga = {}): Riga => ({
    id: U(9000 + n), tipo_consegna: "singola", evento_id: U(8000), inclusa_in: null, impresa_id: I1, destinatario_id: I1, ruolo: "titolare", chiave: `prova-presa-in-carico-${n}`,
    priorita: 5, stato: "in_coda", tentativi: 0, primo_tentativo_il: null, prossimo_tentativo_il: "2026-10-20T05:00:00Z", in_invio_fino_il: null, provider: null, provider_id: null,
    ultimo_errore: null, motivo: null, inviata_il: null, chiusa_il: null, creata_il: "2026-10-20T04:00:00Z", aggiornata_il: "2026-10-20T04:00:00Z", ...p,
  });
  // l'evento SINTETICO delle consegne della prova (una consegna «singola» ha sempre il suo evento, della stessa impresa)
  const conEvento = (m: Mondo) => m.db.t("omnia_ai_radar_eventi").push({ id: U(8000), impresa_id: I1, categoria: "scadenze", tipo: "scadenza_10", gara_chiave: `p:${U(101)}`, versione: "prova-presa", stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: "2026-10-20T04:00:00Z" });
  // alle 05:30: 55 in coda dovute (priorità 5), un affitto SCADUTO urgente (priorità 1), una in coda poco urgente (6), un affitto NON scaduto,
  // una in coda non ancora dovuta
  {
    const m = mondo();
    conEvento(m);
    m.db.tabelle.omnia_ai_radar_email_consegne = [
      ...Array.from({ length: 55 }, (_, i) => consegna(i + 1)),
      consegna(60, { priorita: 1, stato: "in_invio", in_invio_fino_il: "2026-10-20T05:20:00Z" }),
      consegna(61, { priorita: 6 }),
      consegna(62, { priorita: 1, stato: "in_invio", in_invio_fino_il: "2026-10-20T05:40:00Z" }),
      consegna(63, { priorita: 1, prossimo_tentativo_il: "2026-10-20T06:00:00Z" }),
      // affitto scaduto ma tentativo non ancora dovuto: come prima (rimessa in coda, si prendeva solo quando dovuta) non si prende
      consegna(64, { priorita: 1, stato: "in_invio", in_invio_fino_il: "2026-10-20T05:20:00Z", prossimo_tentativo_il: "2026-10-20T06:00:00Z" }),
    ];
    const r1 = await prendiInCarico(m.d, null);
    const id1 = new Set(r1.prese.map((x) => x.id));
    controlla("O1: un blocco di 50 in ordine di priorità: l'affitto scaduto urgente dentro, la meno urgente fuori", r1.prese.length === 50 && id1.has(U(9060)) && !id1.has(U(9061)) && r1.affittiScaduti === 1, { n: r1.prese.length, affitti: r1.affittiScaduti });
    controlla("O1: l'affitto scaduto ripreso con un affitto nuovo, tentativo dovuto invariato", (() => {
      const c = consegne(m).find((x) => x.id === U(9060))!;
      return c.stato === "in_invio" && c.in_invio_fino_il === "2026-10-20T05:40:00.000Z" && c.prossimo_tentativo_il === "2026-10-20T05:00:00Z";
    })());
    const r2 = await prendiInCarico(m.d, null);
    const id2 = new Set(r2.prese.map((x) => x.id));
    controlla("O1: il blocco dopo prende le rimaste (le altre 6 di priorità 5 + la meno urgente), mai l'affitto non scaduto né quella non dovuta", r2.prese.length === 7 && id2.has(U(9061)) && !id2.has(U(9062)) && !id2.has(U(9063)) && !id1.has(U(9064)) && !id2.has(U(9064)) && ![...id2].some((x) => id1.has(x)), { n: r2.prese.length });
    const prima = m.db.conta();
    const r3 = await prendiInCarico(m.d, null);
    controlla("O1: nulla da prendere → UNA sola richiesta", r3.prese.length === 0 && m.db.conta() - prima === 1, { richieste: m.db.conta() - prima });
    controlla("O1: l'affitto non scaduto e la consegna non dovuta restano com'erano", consegne(m).find((x) => x.id === U(9062))?.in_invio_fino_il === "2026-10-20T05:40:00Z" && consegne(m).find((x) => x.id === U(9063))?.stato === "in_coda" && consegne(m).find((x) => x.id === U(9064))?.in_invio_fino_il === "2026-10-20T05:20:00Z");
    // avviso «ravvicinato» (soloIds): solo consegne in coda, mai un affitto scaduto, come prima
    const m2 = mondo();
    conEvento(m2);
    m2.db.tabelle.omnia_ai_radar_email_consegne = [consegna(70, { stato: "in_invio", in_invio_fino_il: "2026-10-20T05:20:00Z" }), consegna(71)];
    const r4 = await prendiInCarico(m2.d, [U(9070), U(9071)]);
    controlla("O1: con l'elenco del «ravvicinato» solo quelle in coda (come prima)", r4.prese.length === 1 && r4.prese[0].id === U(9071) && r4.affittiScaduti === 0);
  }
  // concorrenza: due prese in carico NELLO STESSO MOMENTO (le due letture vedono le stesse 32 righe): ogni consegna presa una volta sola
  {
    const m = mondo();
    conEvento(m);
    m.db.tabelle.omnia_ai_radar_email_consegne = [
      ...Array.from({ length: 30 }, (_, i) => consegna(i + 1)),
      consegna(40, { stato: "in_invio", in_invio_fino_il: "2026-10-20T05:20:00Z" }),
      consegna(41, { stato: "in_invio", in_invio_fino_il: "2026-10-20T05:25:00Z" }),
    ];
    const [a, b] = await Promise.all([prendiInCarico(m.d, null), prendiInCarico(m.d, null)]);
    const ia = new Set(a.prese.map((x) => x.id));
    const comuni = b.prese.filter((x) => ia.has(x.id)).length;
    controlla("O1 concorrenza: due prese in carico insieme → 32 consegne prese, NESSUNA due volte; affitti contati una volta", a.prese.length + b.prese.length === 32 && comuni === 0 && a.affittiScaduti + b.affittiScaduti === 2, { a: a.prese.length, b: b.prese.length, comuni });
  }
  // concorrenza tra due PASSAGGI interi: dopo un 429 tutte in coda; due passaggi insieme → ogni email una sola volta
  {
    const copione: CopioneFinto = (_m, n) => (n === 0 ? { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false } : null);
    const m = mondo({ copione });
    await eseguiPassaggio(m.d);
    const tutte = consegne(m).length;
    m.ora.t = new Date("2026-10-20T05:36:00Z");
    await Promise.all([eseguiPassaggio(m.d), eseguiPassaggio(m.d)]);
    const chiavi = m.provider.consegnate.map((x) => x.chiave);
    controlla("O1 concorrenza: due passaggi insieme → ogni consegna inviata UNA volta", tutte > 0 && consegne(m).every((c) => c.stato === "inviata") && chiavi.length === tutte && new Set(chiavi).size === tutte, { tutte, inviate: chiavi.length });
  }
}

async function provaSospese(): Promise<void> {
  type DatiRiepilogo = { gare?: { proceduraId: string | null }[] };
  const nelRiepilogo = (m: Mondo, giorno: string, id: string) =>
    eventi(m).some((e) => e.tipo === "riepilogo_opportunita" && e.impresa_id === I1 && e.versione === giorno && ((e.dati as DatiRiepilogo | null)?.gare ?? []).some((g) => g.proceduraId === id));
  const giroDi = (m: Mondo, giorno: string) => m.db.t("radar_notifiche_giri").find((g) => g.fase === "eventi" && g.giorno_roma === giorno && g.esito === "riuscito");
  const sospese = (m: Mondo, giorno: string) => (giroDi(m, giorno)?.nuove_in_sospeso as string[] | undefined) ?? [];
  const classifica = (m: Mondo, id: string) => {
    const s = m.db.t("radar_classificazioni_stato").find((x) => x.procedura_id === id);
    if (s) s.stato = "classificata";
    else m.db.t("radar_classificazioni_stato").push({ procedura_id: id, stato: "classificata" });
    m.db.t("radar_classificazioni").push({ procedura_id: id, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true });
  };
  const nuova = (m: Mondo, n: number, x: { stato?: "in_attesa" | "fallita" | null; pubblicata?: string; rilevata?: string } = {}) => {
    const g = gara(n, { prima_rilevazione_il: x.rilevata ?? "2026-10-19T10:00:00Z", data_pubblicazione: x.pubblicata ?? "2026-10-19", scadenza_giorno: "2026-12-01" });
    m.db.t("radar_procedure").push(g);
    if (x.stato) m.db.t("radar_classificazioni_stato").push({ procedura_id: g.id, stato: x.stato });
    return g.id;
  };
  const giorno = async (m: Mondo, quando: string) => {
    m.ora.t = new Date(quando);
    return eseguiPassaggio(m.d);
  };

  // R1 (DIFETTO): vista il 20/10 «in attesa», classificata A il 20/10 alle 12:00 → nel riepilogo del 21/10. Prima: mai
  {
    const m = mondo();
    const g = nuova(m, 470, { stato: "in_attesa" });
    await giorno(m, "2026-10-20T05:30:00Z");
    controlla("R1 sospese: vista «in attesa» il 20/10 → non nel riepilogo di oggi, ma in sospeso nel giro", !nelRiepilogo(m, "2026-10-20", g) && sospese(m, "2026-10-20").includes(g), sospese(m, "2026-10-20"));
    classifica(m, g);
    await giorno(m, "2026-10-21T05:30:00Z");
    controlla("R1 difetto 3.3: classificata dopo il giro → nel riepilogo del 21/10", nelRiepilogo(m, "2026-10-21", g), eventi(m).filter((e) => e.tipo === "riepilogo_opportunita").map((e) => [e.versione, ((e.dati as DatiRiepilogo | null)?.gare ?? []).map((x) => x.proceduraId)]));
    controlla("R1 sospese: valutata, esce dall'elenco", !sospese(m, "2026-10-21").includes(g));
    // R3: mai due volte (giri del 22 e del 23)
    await giorno(m, "2026-10-22T05:30:00Z");
    await giorno(m, "2026-10-23T05:30:00Z");
    controlla("R3 sospese: mai due volte nel riepilogo", !nelRiepilogo(m, "2026-10-22", g) && !nelRiepilogo(m, "2026-10-23", g));
    // R5: riclassificata dopo essere stata proposta → non riproposta
    const s = m.db.t("radar_classificazioni_stato").find((x) => x.procedura_id === g)!;
    s.stato = "in_attesa";
    await giorno(m, "2026-10-24T05:30:00Z");
    s.stato = "classificata";
    await giorno(m, "2026-10-25T05:30:00Z");
    controlla("R5 sospese: riclassificata dopo la proposta → non riproposta, mai rimessa in sospeso", !nelRiepilogo(m, "2026-10-24", g) && !nelRiepilogo(m, "2026-10-25", g) && !sospese(m, "2026-10-24").includes(g) && !sospese(m, "2026-10-25").includes(g));
  }
  // R2: ancora in attesa dopo la finestra delle nuove (pubblicata il 19/10: fino al 26/10) → esce, nessun riepilogo
  {
    const m = mondo();
    const h = nuova(m, 471, { stato: "in_attesa" });
    const tenuta: boolean[] = [];
    for (let gg = 20; gg <= 27; gg++) {
      await giorno(m, `2026-10-${gg}T05:30:00Z`);
      tenuta.push(sospese(m, `2026-10-${gg}`).includes(h));
    }
    controlla("R2 sospese: in sospeso dal 20 al 26/10, fuori il 27/10 (oltre i 7 giorni dalla pubblicazione)", JSON.stringify(tenuta) === JSON.stringify([true, true, true, true, true, true, true, false]), tenuta);
    controlla("R2 sospese: mai nel riepilogo", !eventi(m).some((e) => e.tipo === "riepilogo_opportunita" && ((e.dati as DatiRiepilogo | null)?.gare ?? []).some((x) => x.proceduraId === h)));
  }
  {
    const k = mondo();
    const f = nuova(k, 472, { stato: "fallita" });
    const senza = nuova(k, 473, { stato: null });
    await giorno(k, "2026-10-20T05:30:00Z");
    controlla("sospese: classificazione fallita o senza stato → in sospeso", sospese(k, "2026-10-20").includes(f) && sospese(k, "2026-10-20").includes(senza), sospese(k, "2026-10-20"));
    // una gara in sospeso collegata a un'altra (0117) o chiusa esce dall'elenco
    Object.assign(k.db.t("radar_procedure").find((p) => p.id === f)!, { unita_a: U(101) });
    Object.assign(k.db.t("radar_procedure").find((p) => p.id === senza)!, { stato: "annullata" });
    await giorno(k, "2026-10-21T05:30:00Z");
    // (le gare sintetiche 101–104 del mondo non sono classificate: restano in sospeso anche loro, giustamente)
    controlla("sospese: collegata a un'altra o non più aperta → esce", !sospese(k, "2026-10-21").includes(f) && !sospese(k, "2026-10-21").includes(senza), sospese(k, "2026-10-21"));
  }
  // R4: il giro del 21/10 fallisce → vale l'elenco del giro riuscito del 20/10; il 22/10 la gara arriva
  {
    const m = mondo();
    const g = nuova(m, 474, { stato: "in_attesa" });
    await giorno(m, "2026-10-20T05:30:00Z");
    classifica(m, g);
    m.db.guasti.set("omnia_ai_radar_eventi|upsert", 1);
    const r = await giorno(m, "2026-10-21T05:30:00Z");
    controlla("R4 sospese: giro del 21/10 fallito (guasto simulato), nessun riepilogo", r.eseguito && "saltata" in r.eventi && !nelRiepilogo(m, "2026-10-21", g), r);
    await giorno(m, "2026-10-22T05:30:00Z");
    controlla("R4 sospese: dopo il giro fallito vale l'elenco del 20/10 → nel riepilogo del 22/10", nelRiepilogo(m, "2026-10-22", g));
  }
  // R6: richieste. Due mondi uguali con una gara nuova classificata il 21/10; nel secondo c'è in più una gara in sospeso dal 20/10 (ancora
  // in attesa): il giro del 21/10 fa UNA sola richiesta in più (la rilettura delle sospese). Senza sospese, nessuna richiesta in più.
  {
    const conta = async (conSospesa: boolean) => {
      const m = mondo();
      // le gare sintetiche del mondo classificate (senza righe: non pertinenti), così nel primo mondo non c'è nessuna gara in sospeso
      for (const p of m.db.t("radar_procedure")) if (!m.db.t("radar_classificazioni_stato").some((x) => x.procedura_id === p.id)) m.db.t("radar_classificazioni_stato").push({ procedura_id: p.id, stato: "classificata" });
      if (conSospesa) nuova(m, 475, { stato: "in_attesa" });
      await giorno(m, "2026-10-20T05:30:00Z");
      const n = nuova(m, 476, { rilevata: "2026-10-20T10:00:00Z", pubblicata: "2026-10-20" });
      classifica(m, n);
      const prima = m.db.conta();
      await giorno(m, "2026-10-21T05:30:00Z");
      return { richieste: m.db.conta() - prima, nel: nelRiepilogo(m, "2026-10-21", n), sospese: sospese(m, "2026-10-20").length };
    };
    const senza = await conta(false);
    const con = await conta(true);
    controlla("R6 sospese: senza gare in sospeso l'elenco è vuoto; con una, UNA richiesta in più nel giro e stesso riepilogo", senza.sospese === 0 && con.sospese === 1 && con.richieste === senza.richieste + 1 && con.nel && senza.nel, { senza, con });
    // se quel giorno NON ci sono gare nuove, le sospese costano 3 richieste: la rilettura e le due delle classificazioni (che senza gare da
    // valutare non si farebbero)
    const soloSospese = async (conSospesa: boolean) => {
      const m = mondo();
      for (const p of m.db.t("radar_procedure")) if (!m.db.t("radar_classificazioni_stato").some((x) => x.procedura_id === p.id)) m.db.t("radar_classificazioni_stato").push({ procedura_id: p.id, stato: "classificata" });
      if (conSospesa) nuova(m, 477, { stato: "in_attesa" });
      await giorno(m, "2026-10-20T05:30:00Z");
      const prima = m.db.conta();
      await giorno(m, "2026-10-21T05:30:00Z");
      return m.db.conta() - prima;
    };
    const a = await soloSospese(false);
    const b = await soloSospese(true);
    controlla("R6 sospese: giorno senza gare nuove → le sospese costano 3 richieste (rilettura e classificazioni)", b === a + 3, { senza: a, con: b });
  }
  // tetto della 0125: al più 2000 gare in sospeso, le più recenti; le altre contate
  {
    const tante = Array.from({ length: 2001 }, (_, i) => gara(5000 + i, { prima_rilevazione_il: new Date(Date.parse("2026-10-19T00:00:00Z") + i * 1000).toISOString(), data_pubblicazione: "2026-10-19" }));
    const v = nuoveDaValutare({ nuove: tante, idsSospesi: [], sospese: [], statoDi: new Map(), oggi: "2026-10-20" });
    controlla("sospese: al più 2000 (vincolo della 0125), le più recenti; l'esclusa contata", v.inSospeso.length === 2000 && v.oltreIlMassimo === 1 && !v.inSospeso.includes(tante[0].id) && v.inSospeso.includes(tante[2000].id), { n: v.inSospeso.length, oltre: v.oltreIlMassimo });
  }
}

// N6 decisa il 20/11 (30 giorni; 7 respinto), con la richiesta dell'utente di tenere separate compattazione e conservazione: dopo la
// compattazione di un riepilogo e degli altri eventi restano INTATTI chiavi uniche, chiavi di idempotenza, stato ed esiti delle consegne; si
// annulla SOLO il testo (`dati`, con l'ora in `dati_compattati_il`). Rifare la fase «eventi» dopo la compattazione: 0 eventi, 0 consegne,
// 0 email in più.
async function provaCompattazioneIntatta(): Promise<void> {
  controlla(
    "N6: tre parametri distinti (riepiloghi 30, altri eventi 30, conservazione 365)",
    PARAMETRI_PROPOSTI.giorniCompattazioneRiepiloghi === 30 && PARAMETRI_PROPOSTI.giorniCompattazioneAltri === 30 && PARAMETRI_PROPOSTI.giorniConservazione === 365,
  );
  const m = mondo();
  // due gare nuove classificate A: il primo giro crea anche un riepilogo, oltre ai promemoria del mondo sintetico
  for (const n of [460, 461]) {
    const g = gara(n, { prima_rilevazione_il: "2026-10-19T10:00:00Z", data_pubblicazione: "2026-10-19", scadenza_giorno: "2026-12-01" });
    m.db.t("radar_procedure").push(g);
    m.db.t("radar_classificazioni_stato").push({ procedura_id: g.id, stato: "classificata" });
    m.db.t("radar_classificazioni").push({ procedura_id: g.id, settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: true });
  }
  await eseguiPassaggio(m.d);
  const riepiloghi = eventi(m).filter((e) => e.tipo === "riepilogo_opportunita");
  const altri = eventi(m).filter((e) => e.tipo !== "riepilogo_opportunita");
  controlla("compattazione (preparazione): un riepilogo, altri eventi, consegne inviate con l'esito del provider", riepiloghi.length > 0 && altri.length > 0 && consegne(m).length > 0 && consegne(m).every((c) => c.stato === "inviata" && !!c.provider_id), { riepiloghi: riepiloghi.length, altri: altri.length });
  // gli eventi e le consegne «invecchiano» di 50 giorni: oltre i 30 della compattazione, lontani dai 365 della conservazione
  for (const e of eventi(m)) e.creato_il = "2026-08-31T05:30:00Z";
  for (const c of consegne(m)) c.creata_il = "2026-08-31T05:30:00Z";
  const senzaTesto = (e: Riga) => JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => k !== "dati" && k !== "dati_compattati_il")));
  const fotoEventi = eventi(m).map(senzaTesto).sort();
  const fotoConsegne = consegne(m).map((c) => JSON.stringify(c)).sort();
  const email = m.provider.consegnate.length;
  // la fase «eventi» rifatta lo stesso giorno (come dopo una caduta): calcola gli stessi eventi e compatta
  const rifai = async (ora: string) => {
    for (const g of m.db.t("radar_notifiche_giri")) if (g.fase === "eventi") Object.assign(g, { esito: "fallito", errore: "processo_caduto" });
    m.ora.t = new Date(ora);
    return eseguiPassaggio(m.d);
  };
  const r1 = await rifai("2026-10-20T06:00:00Z");
  const compattati = eventi(m).filter((e) => e.dati === null && !!e.dati_compattati_il);
  controlla("compattazione: riepilogo e altri eventi compattati (solo il testo, con l'ora)", r1.eseguito && compattati.length === eventi(m).length && compattati.some((e) => e.tipo === "riepilogo_opportunita") && compattati.some((e) => e.tipo !== "riepilogo_opportunita"), { compattati: compattati.length, eventi: eventi(m).length });
  controlla("compattazione: chiavi ed esiti intatti — eventi uguali salvo il testo (id, chiave unica, stato)", JSON.stringify(eventi(m).map(senzaTesto).sort()) === JSON.stringify(fotoEventi));
  controlla("compattazione: chiavi ed esiti intatti — consegne identiche (id e quindi chiave di idempotenza, chiave unica, stato, provider, provider_id, tentativi)", JSON.stringify(consegne(m).map((c) => JSON.stringify(c)).sort()) === JSON.stringify(fotoConsegne));
  // e di nuovo, DOPO la compattazione: nessun evento né consegna rinasce, nessuna email
  const r2 = await rifai("2026-10-20T06:30:00Z");
  controlla("compattazione: rifatta la fase «eventi» dopo la compattazione → 0 eventi, 0 consegne, 0 email in più", r2.eseguito && !("saltata" in r2.eventi) && eventi(m).length === fotoEventi.length && consegne(m).length === fotoConsegne.length && m.provider.consegnate.length === email, { eventi: eventi(m).length, consegne: consegne(m).length, email: m.provider.consegnate.length, r2 });
  controlla("compattazione: dopo il secondo giro chiavi ed esiti ancora intatti", JSON.stringify(eventi(m).map(senzaTesto).sort()) === JSON.stringify(fotoEventi) && JSON.stringify(consegne(m).map((c) => JSON.stringify(c)).sort()) === JSON.stringify(fotoConsegne));
}

// Difetto del 20/11 (Incarico 3): la proroga di UN solo lotto arriva all'email con il suo lotto anche senza CIG (TED «LOT-0001»); lo
// spostamento della scadenza «più vicina» della gara non apre una seconda serie; lo stesso lotto da TED (numero) e PVL (CIG) compare una volta
async function provaLotti(): Promise<void> {
  const m = mondo();
  m.db.t("radar_procedure").push(
    // dopo l'avviso: lotto 1 dal 05/11 al 20/11, lotto 2 fermo al 10/11; la gara («la più vicina») passa dal 05/11 al 10/11
    gara(6, { scadenza_giorno: "2026-11-10", scadenza_offerte: "2026-11-10T10:00:00Z", scadenza_ora_indicata: true }),
    gara(7, { scadenza_giorno: "2026-11-25", scadenza_offerte: "2026-11-25T10:00:00Z", scadenza_ora_indicata: true, fonti: ["ted", "pvl"] }),
  );
  m.db.t("radar_lotti").push(
    { procedura_id: U(106), numero_lotto: "LOT-0001", oggetto: "Lotto 1 (sintetico)", cig: null, scadenza_giorno: "2026-11-20", scadenza_offerte: "2026-11-20T10:00:00Z", scadenza_ora_indicata: true },
    { procedura_id: U(106), numero_lotto: "LOT-0002", oggetto: "Lotto 2 (sintetico)", cig: null, scadenza_giorno: "2026-11-10", scadenza_offerte: "2026-11-10T10:00:00Z", scadenza_ora_indicata: true },
    { procedura_id: U(107), numero_lotto: "LOT-0001", oggetto: "Lotto 1 (sintetico)", cig: "BBBBBBBBB1", scadenza_giorno: "2026-11-25", scadenza_offerte: "2026-11-25T10:00:00Z", scadenza_ora_indicata: true },
    { procedura_id: U(107), numero_lotto: "LOT-0002", oggetto: "Lotto 2 (sintetico)", cig: "BBBBBBBBB2", scadenza_giorno: "2026-11-30", scadenza_offerte: "2026-11-30T10:00:00Z", scadenza_ora_indicata: true },
  );
  m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: U(106), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" }, { user_id: I1, procedura_id: U(107), aggiunta_id: null, creata_il: "2026-10-15T08:00:00Z" });
  const riga = (n: number, p: Record<string, unknown>) => ({ id: U(n), tipo: "proroga", notificabile: true, notifica_email: true, avviso_url: null, avviso_pubblicato_il: "2026-10-19", dichiarazione_fonte: "cor-buy", affidabilita: "avviso_ufficiale", rilevato_il: "2026-10-19T09:00:00Z", avviso_ted: null, ...p });
  m.db.t("radar_aggiornamenti").push(
    riga(410, { procedura_id: U(106), campo: "scadenza_offerte", valore_precedente: "2026-11-05T10:00:00Z", valore_nuovo: "2026-11-10T10:00:00Z", fonte: "ted", id_fonte: "700900-2026" }),
    riga(411, { procedura_id: U(106), campo: "scadenza_offerte@LOT-0001", valore_precedente: "2026-11-05T10:00:00Z", valore_nuovo: "2026-11-20T10:00:00Z", fonte: "ted", id_fonte: "700900-2026" }),
    riga(412, { procedura_id: U(107), campo: "scadenza_offerte@LOT-0001", valore_precedente: "2026-11-15T10:00:00Z", valore_nuovo: "2026-11-25T10:00:00Z", fonte: "ted", id_fonte: "700901-2026" }),
    riga(413, { procedura_id: U(107), campo: "scadenza_offerte@BBBBBBBBB1", valore_precedente: "2026-11-15T10:00:00Z", valore_nuovo: "2026-11-25T10:00:00Z", fonte: "pvl", id_fonte: "pvl-avviso-7", avviso_ted: "700901-2026", affidabilita: "confronto_versioni" }),
  );
  await eseguiPassaggio(m.d);
  type DatiProroga = { cambioScadenza?: { lotti: { numero: string | null; titolo: string | null; cig: string | null }[] } };
  const proroghe = (n: number) => eventi(m).filter((e) => e.tipo === "proroga" && e.impresa_id === I1 && e.gara_chiave === `p:${U(n)}`);
  const p6 = proroghe(106);
  controlla("difetto lotto (motore): UNA proroga, alla nuova scadenza del lotto 1 (nessuna serie per il 10/11 della gara)", p6.length === 1 && p6[0].versione === "scadenza:2026-11-20T10:00:00.000Z", p6.map((e) => e.versione));
  const lotti6 = (p6[0]?.dati as DatiProroga | undefined)?.cambioScadenza?.lotti ?? [];
  controlla("difetto lotto (motore): il lotto senza CIG si riconosce dal numero, con il suo titolo", lotti6.length === 1 && lotti6[0].numero === "LOT-0001" && lotti6[0].titolo === "Lotto 1 (sintetico)" && lotti6[0].cig === null, lotti6);
  const p7 = proroghe(107);
  const lotti7 = (p7[0]?.dati as DatiProroga | undefined)?.cambioScadenza?.lotti ?? [];
  controlla("lotti (motore): lo stesso lotto da TED (numero) e PVL (CIG) → un evento con il lotto UNA volta", p7.length === 1 && lotti7.length === 1 && lotti7[0].cig === "BBBBBBBBB1" && lotti7[0].numero === "LOT-0001", { p7: p7.length, lotti7 });
}

async function provaParametri(): Promise<void> {
  // N1: abbonamento richiesto (proposta) contro non richiesto
  {
    const m = mondo();
    m.accesso.set(I2, "cessato");
    await eseguiPassaggio(m.d);
    controlla("N1 sì: impresa con l'abbonamento scaduto senza eventi né email", !eventi(m).some((e) => e.impresa_id === I2));
    const m2 = mondo({ parametri: { abbonamentoRichiesto: false } });
    m2.accesso.set(I2, "cessato");
    await eseguiPassaggio(m2.d);
    controlla("N1 no: l'impresa riceve comunque (decide solo il Radar attivo e le email accese)", eventi(m2).some((e) => e.impresa_id === I2));
    controlla("N1 no: lo stato dell'abbonamento non si legge nemmeno", !m2.db.richieste.some((r) => r.tabella === "subscriptions"));
  }
  // N6: compattazione dei riepiloghi a 7 giorni (respinto il 20/11) contro 30 (N6 decisa); altri eventi a 30; conservazione 12 mesi
  for (const giorni of [7, 30]) {
    const m = mondo({ parametri: { giorniCompattazioneRiepiloghi: giorni } });
    m.db.t("omnia_ai_radar_eventi").push(
      { id: "r-8", impresa_id: I1, categoria: "nuove_opportunita", tipo: "riepilogo_opportunita", gara_chiave: "riepilogo", versione: "2026-10-12", stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: "2026-10-12T05:30:00Z" },
      { id: "s-8", impresa_id: I1, categoria: "scadenze", tipo: "scadenza_5", gara_chiave: `p:${U(109)}`, versione: "2026-10-17", stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: "2026-10-12T05:30:00Z" },
      { id: "s-40", impresa_id: I1, categoria: "scadenze", tipo: "scadenza_5", gara_chiave: `p:${U(108)}`, versione: "2026-09-15", stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: "2026-09-10T05:30:00Z" },
      { id: "vecchio", impresa_id: I1, categoria: "scadenze", tipo: "scadenza_5", gara_chiave: `p:${U(107)}`, versione: "2025-09-15", stato: "attivo", dati: null, dati_compattati_il: "2025-10-10T00:00:00Z", creato_il: "2025-09-10T05:30:00Z" },
    );
    m.db.t("omnia_ai_radar_email_consegne").push({ id: "c-vecchia", tipo_consegna: "singola", evento_id: "vecchio", inclusa_in: null, impresa_id: I1, destinatario_id: I1, ruolo: "titolare", chiave: "vecchia", priorita: 4, stato: "inviata", creata_il: "2025-09-10T05:30:00Z" });
    await eseguiPassaggio(m.d);
    const r8 = eventi(m).find((e) => e.id === "r-8");
    controlla(`N6 = ${giorni}: riepilogo di 8 giorni ${giorni === 7 ? "compattato" : "ancora intero"}`, giorni === 7 ? r8?.dati === null && !!r8?.dati_compattati_il : r8?.dati !== null, r8);
    controlla(`N6 = ${giorni}: gli altri eventi si compattano a 30 giorni`, eventi(m).find((e) => e.id === "s-8")?.dati !== null && eventi(m).find((e) => e.id === "s-40")?.dati === null);
    controlla(`conservazione: eventi e consegne di oltre 12 mesi cancellati`, !eventi(m).some((e) => e.id === "vecchio") && !consegne(m).some((c) => c.id === "c-vecchia"));
  }
  // N6 decisa il 20/11: con i parametri IN USO (quelli della rotta) anche i riepiloghi si compattano dopo 30 giorni, non 7
  {
    controlla("decisione 7: parametri in uso, riepiloghi e altri eventi compattati a 30 giorni", PARAMETRI_PROPOSTI.giorniCompattazioneRiepiloghi === 30 && PARAMETRI_PROPOSTI.giorniCompattazioneAltri === 30);
    const m = mondo();
    const riepilogo = (id: string, giorno: string) => ({ id, impresa_id: I1, categoria: "nuove_opportunita", tipo: "riepilogo_opportunita", gara_chiave: "riepilogo", versione: giorno, stato: "attivo", dati: { x: 1 }, dati_compattati_il: null, creato_il: `${giorno}T05:30:00Z` });
    m.db.t("omnia_ai_radar_eventi").push(riepilogo("r-8", "2026-10-12"), riepilogo("r-29", "2026-09-21"), riepilogo("r-31", "2026-09-19"));
    await eseguiPassaggio(m.d);
    const dati = (id: string) => eventi(m).find((e) => e.id === id)?.dati;
    controlla("decisione 7: riepiloghi di 8 e 29 giorni ancora interi", dati("r-8") !== null && dati("r-8") !== undefined && dati("r-29") !== null && dati("r-29") !== undefined);
    controlla("decisione 7: riepilogo di 31 giorni compattato", dati("r-31") === null && !!eventi(m).find((e) => e.id === "r-31")?.dati_compattati_il);
  }
  // N7: con il parametro spento ogni passaggio scrive il suo giro «invio»
  {
    const m = mondo({ parametri: { giroInvioSoloConLavoro: false } });
    await eseguiPassaggio(m.d);
    for (const t of ["06:00", "06:30", "07:00"]) {
      m.ora.t = new Date(`2026-10-20T${t}:00Z`);
      await eseguiPassaggio(m.d);
    }
    controlla("N7 no: un giro «invio» per ogni passaggio (4)", m.db.t("radar_notifiche_giri").filter((g) => g.fase === "invio").length === 4);
    const m2 = mondo();
    await eseguiPassaggio(m2.d);
    for (const t of ["06:00", "06:30", "07:00"]) {
      m2.ora.t = new Date(`2026-10-20T${t}:00Z`);
      await eseguiPassaggio(m2.d);
    }
    controlla("N7 sì: un solo giro «invio» (quello con lavoro); i passaggi vuoti non scrivono", m2.db.t("radar_notifiche_giri").filter((g) => g.fase === "invio").length === 1);
  }
}

function provaResend(): void {
  const h = (x: Record<string, string>) => (n: string) => x[n.toLowerCase()] ?? null;
  const casi: [number, unknown, Record<string, string>, string, string][] = [
    [200, { id: "re_1" }, {}, "inviata", "200 con id"],
    [200, {}, {}, "riprova", "200 senza id (incerto se partita: si riprova con la stessa chiave)"],
    [429, { name: "rate_limit_exceeded" }, { "retry-after": "7" }, "riprova", "429 frequenza"],
    [429, { name: "daily_quota_exceeded" }, {}, "quota", "429 quota giornaliera"],
    [429, { name: "monthly_quota_exceeded" }, {}, "quota", "429 quota mensile"],
    [409, { name: "invalid_idempotent_request" }, {}, "incerto", "409 contenuto diverso"],
    [409, { name: "concurrent_idempotent_requests" }, {}, "riprova", "409 richieste concorrenti"],
    [500, { name: "application_error" }, {}, "riprova", "500"],
    [503, {}, {}, "riprova", "503"],
    [400, { name: "validation_error" }, {}, "fallita", "400"],
    [422, { name: "validation_error" }, {}, "fallita", "422"],
    [401, { name: "missing_api_key" }, {}, "fallita", "401"],
    [403, { name: "invalid_api_key" }, {}, "fallita", "403"],
  ];
  for (const [stato, corpo, intestazioni, atteso, nome] of casi) {
    const e = classificaRispostaResend(stato, corpo, h(intestazioni));
    controlla(`Resend ${nome} → ${atteso}`, e.esito === atteso, e);
  }
  const r = classificaRispostaResend(429, { name: "rate_limit_exceeded" }, h({ "retry-after": "7" }));
  controlla("Resend 429: retry-after letto", r.esito === "riprova" && r.attesaSecondi === 7);
  const c = classificaRispostaResend(401, { name: "missing_api_key" }, h({}));
  controlla("Resend 401/403: errore di configurazione (la fase si ferma)", c.esito === "fallita" && c.configurazione === true);
  controlla("Resend: quota dalle intestazioni", quotaDaIntestazioni(h({ "x-resend-daily-quota": "42" })) === 42 && quotaDaIntestazioni(h({})) === null);
  const q = richiestaResend({ a: "x@prova.test", oggetto: "o", html: "<p>h</p>", testo: "t", chiaveIdempotenza: "omnia-radar/abc", tags: [{ name: "tipo", value: "scadenza_1" }] });
  controlla("Resend: Idempotency-Key nell'intestazione, mittente noreply, nessuna chiave nel corpo", q.intestazioni["Idempotency-Key"] === "omnia-radar/abc" && JSON.parse(q.corpo).from === "OMNIA AI <noreply@omniaitalia.com>" && !q.corpo.includes("Bearer"));
  let lungo = false;
  try {
    richiestaResend({ a: "x@prova.test", oggetto: "o", html: "h", testo: "t", chiaveIdempotenza: "x".repeat(257), tags: [] });
  } catch {
    lungo = true;
  }
  controlla("Resend: chiave di idempotenza oltre 256 caratteri rifiutata", lungo);
}

function provaD5(): void {
  const lista = gareDelleListe({
    salvate: [{ user_id: I1, procedura_id: U(101), aggiunta_id: null, creata_il: "2026-10-01T00:00:00Z" }],
    procedure: new Map([[U(101), gara(1, { fonti: ["ted", "pvl"], scadenza_giorno: "2026-11-06" })]]),
    lotti: new Map(),
    aggiunte: new Map(),
    nascoste: new Set(),
    origine: "http://localhost:3000",
  });
  const riga = (fonte: string, id: string): RigaModifica => ({
    id,
    procedura_id: U(101),
    tipo: "rettifica",
    campo: "valore_stimato",
    valore_precedente: "100",
    valore_nuovo: "200",
    fonte,
    id_fonte: `${fonte}-1`,
    rilevato_il: "2026-10-20T00:00:00Z",
    notificabile: true,
    notifica_email: true,
    avviso_url: null,
    avviso_pubblicato_il: null,
    avviso_ted: null,
    dichiarazione_fonte: "rettifica",
    affidabilita: "avviso_ufficiale",
  });
  const prod = { NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co", VERCEL_ENV: "production" };
  const x = eventiModifica({ modifiche: [riga("pvl", "r1"), riga("ted", "r2"), riga("sintel", "r3")], liste: lista, nascoste: new Set(), env: prod, nuovoId: () => U(77), adessoIso: "2026-10-20T00:00:00Z" });
  controlla("fonteAutorizzata nel motore: in produzione la PVL e Sintel non danno eventi, TED sì (dal deploy di produzione)", x.eventi.length === 1 && x.eventi[0].dati.categoria === "rettifiche" && (x.saltate.fonte_non_autorizzata ?? 0) === 2, x.saltate);
  const s = eventiModifica({ modifiche: [riga("pvl", "r1")], liste: lista, nascoste: new Set(), env: STAGING, nuovoId: () => U(78), adessoIso: "2026-10-20T00:00:00Z" });
  controlla("fonteAutorizzata nel motore: sullo staging la PVL dà l'evento", s.eventi.length === 1);
  const anteprima = eventiModifica({ modifiche: [riga("ted", "r2")], liste: lista, nascoste: new Set(), env: { ...STAGING, VERCEL_ENV: "preview" }, nuovoId: () => U(79), adessoIso: "2026-10-20T00:00:00Z" });
  controlla("fonteAutorizzata nel motore: sulle anteprime nessuna fonte", anteprima.eventi.length === 0);
  controlla("avviso: la PVL che cita il numero TED ha la stessa chiave dell'avviso TED", chiaveAvviso({ id: "a", fonte: "pvl", id_fonte: "p1", avviso_ted: "123456-2026" }) === chiaveAvviso({ id: "b", fonte: "ted", id_fonte: "123456-2026", avviso_ted: null }));
  controlla("scadenza dal registro: «Z» e «+01:00» dello stesso istante = stessa scadenza", JSON.stringify(scadenzaDaRegistro("2026-11-06T11:00:00Z")) === JSON.stringify(scadenzaDaRegistro("2026-11-06T12:00:00+01:00")));
  controlla("scadenza dal registro: solo il giorno → ora null (mai presunta)", scadenzaDaRegistro("2026-11-06")?.ora === null && scadenzaDaRegistro("2026-11-06")?.istante === null);
  const soloAvviso = eventiModifica({ modifiche: [{ ...riga("ted", "r9"), campo: "avviso", valore_precedente: null, valore_nuovo: null }], liste: lista, nascoste: new Set(), env: STAGING, nuovoId: () => U(80), adessoIso: "2026-10-20T00:00:00Z" });
  const dm = soloAvviso.eventi[0]?.dati as { modifiche?: unknown[]; evidenza?: { affidabilita: string } } | undefined;
  controlla("avviso ufficiale senza campi cambiati: evento «rettifica» con modifiche vuote (il modello rimanda all'avviso)", soloAvviso.eventi.length === 1 && dm?.modifiche?.length === 0 && dm?.evidenza?.affidabilita === "avviso_ufficiale", soloAvviso);
}

/**
 * La simulazione di 10 giorni, riusabile (confronto A/B di O2): passaggi ogni 30 minuti dalle 05:30 alle 19:30 UTC (29 al giorno), con il
 * cambio d'ora del 25/10/2026; il 27/10 nessun passaggio (giro saltato: recupero breve); il 23/10 una proroga; il 24/10 una gara salvata tardi.
 */
async function simula(parametri: Partial<ParametriNotifiche> = {}): Promise<{ m: Mondo; g: RigaGara; tarda: RigaGara; richiestePerGiorno: number[]; richiestePerPassaggio: number[]; nonEseguiti: number }> {
  const m = mondo({ inizio: "2026-10-20T05:30:00Z", parametri });
  const g = gara(700, { scadenza_giorno: "2026-10-29", scadenza_offerte: "2026-10-29T11:00:00Z", scadenza_ora_indicata: true });
  m.db.t("radar_procedure").push(g);
  m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: g.id, aggiunta_id: null, creata_il: "2026-10-01T08:00:00Z" });
  const tarda = gara(701, { scadenza_giorno: "2026-10-29" });
  m.db.t("radar_procedure").push(tarda);
  const richiestePerGiorno: number[] = [];
  const richiestePerPassaggio: number[] = [];
  let nonEseguiti = 0;
  for (let gi = 0; gi < 10; gi++) {
    const g0 = giorno("2026-10-20", gi);
    if (g0 === "2026-10-23") {
      Object.assign(m.db.t("radar_procedure").find((p) => p.id === g.id)!, { scadenza_giorno: "2026-11-03", scadenza_offerte: "2026-11-03T11:00:00Z" });
      m.db.t("radar_aggiornamenti").push({ id: U(390), procedura_id: g.id, tipo: "proroga", campo: "scadenza_offerte", valore_precedente: "2026-10-29T11:00:00Z", valore_nuovo: "2026-11-03T11:00:00Z", fonte: "ted", id_fonte: "999999-2026", rilevato_il: "2026-10-23T04:00:00Z", notificabile: true, notifica_email: true, avviso_url: null, avviso_pubblicato_il: "2026-10-23", avviso_ted: null, dichiarazione_fonte: "cor-buy", affidabilita: "avviso_ufficiale" });
    }
    if (g0 === "2026-10-24") m.db.t("omnia_ai_radar_salvate").push({ user_id: I1, procedura_id: tarda.id, aggiunta_id: null, creata_il: "2026-10-24T12:00:00Z" });
    if (g0 === "2026-10-27") continue; // nessun passaggio oggi
    const prima = m.db.conta();
    for (let p = 0; p < 29; p++) {
      m.ora.t = new Date(Date.parse(`${g0}T05:30:00Z`) + p * 30 * 60_000);
      const primaDelPassaggio = m.db.conta();
      const e = await eseguiPassaggio(m.d);
      richiestePerPassaggio.push(m.db.conta() - primaDelPassaggio);
      if (!e.eseguito) nonEseguiti++;
    }
    richiestePerGiorno.push(m.db.conta() - prima);
  }
  return { m, g, tarda, richiestePerGiorno, richiestePerPassaggio, nonEseguiti };
}

// O2 (direttiva 44A): confronto A/B sugli STESSI scenari e sullo STESSO database sintetico. A = O1 (giri di oggi e presa in carico),
// B = O2 (stato del passaggio in una chiamata). Il risultato deve essere IDENTICO (email, consegne con stato, tentativi ed esito, eventi,
// giri); B non deve mai fare più richieste di A.
async function provaO2AB(): Promise<void> {
  const foto = (m: Mondo) =>
    JSON.stringify({
      email: m.provider.consegnate.map((x) => `${x.chiave}|${x.providerId}`),
      consegne: consegne(m).map((c) => `${c.chiave}|${c.stato}|${c.tentativi}|${c.provider_id ?? ""}|${c.motivo ?? ""}|${c.inviata_il ?? ""}|${c.prossimo_tentativo_il ?? ""}`).sort(),
      eventi: eventi(m).map((e) => `${e.impresa_id}|${e.gara_chiave}|${e.tipo}|${e.versione}|${e.stato}`).sort(),
      giri: m.db.t("radar_notifiche_giri").map((g) => `${g.fase}|${g.giorno_roma}|${g.esito}`).sort(),
    });
  const ab = async (nome: string, scenario: (o2: boolean) => Promise<Mondo>) => {
    const a = await scenario(false);
    const b = await scenario(true);
    const ra = a.db.conta(), rb = b.db.conta();
    controlla(`O2 A/B «${nome}»: stesso risultato (email, consegne, eventi, giri) con O2 spenta e accesa`, foto(a) === foto(b), { a: foto(a).slice(0, 300), b: foto(b).slice(0, 300) });
    controlla(`O2 A/B «${nome}»: O2 mai più richieste di O1 (${rb} contro ${ra})`, rb <= ra, { ra, rb });
    return { ra, rb };
  };
  const passaggio = async (m: Mondo, quando: string) => {
    m.ora.t = new Date(quando);
    return eseguiPassaggio(m.d);
  };
  const o2 = (x: boolean) => ({ statoPassaggioInUnaChiamata: x });

  // 1. simulazione di 10 giorni, richieste passaggio per passaggio
  {
    const a = await simula(o2(false));
    const b = await simula(o2(true));
    controlla("O2 A/B «simulazione di 10 giorni»: stesso risultato", foto(a.m) === foto(b.m));
    const passaggi = a.richiestePerPassaggio.map((ra, i) => [ra, b.richiestePerPassaggio[i]]);
    controlla("O2 A/B «simulazione»: in OGNI passaggio O2 ≤ O1; nei passaggi senza nulla da fare 1 richiesta contro 2", passaggi.every(([ra, rb]) => rb <= ra) && passaggi.every(([ra, rb]) => ra !== 2 || rb === 1) && a.nonEseguiti === 0 && b.nonEseguiti === 0, passaggi.filter(([ra, rb]) => rb > ra || (ra === 2 && rb !== 1)));
    const vuotiA = a.richiestePerPassaggio.filter((x) => x === 2).length;
    const totA = a.richiestePerGiorno.reduce((s, x) => s + x, 0), totB = b.richiestePerGiorno.reduce((s, x) => s + x, 0);
    console.log(`O2 A/B simulazione: richieste al giorno O1 ${a.richiestePerGiorno.join(", ")} | O2 ${b.richiestePerGiorno.join(", ")}; passaggi a vuoto ${vuotiA} su ${a.richiestePerPassaggio.length}; totale ${totA} → ${totB}`);
  }
  // 2. concorrenza: dopo un 429 tutte in coda, due passaggi INSIEME
  await ab("concorrenza (due passaggi insieme dopo un 429)", async (x) => {
    const m = mondo({ parametri: o2(x), copione: (_m, n) => (n === 0 ? { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false } : null) });
    await passaggio(m, "2026-10-20T05:30:00Z");
    m.ora.t = new Date("2026-10-20T05:36:00Z");
    await Promise.all([eseguiPassaggio(m.d), eseguiPassaggio(m.d)]);
    const chiavi = m.provider.consegnate.map((c) => c.chiave);
    controlla(`O2 ${x ? "accesa" : "spenta"}: due passaggi insieme, ogni email una volta`, chiavi.length > 0 && new Set(chiavi).size === chiavi.length && consegne(m).every((c) => c.stato === "inviata"));
    return m;
  });
  // 3. giro caduto a metà: la fase «eventi» fallisce (guasto), il passaggio dopo la rifà
  await ab("giro «eventi» caduto e rifatto", async (x) => {
    const m = mondo({ parametri: o2(x) });
    m.db.guasti.set("omnia_ai_radar_eventi|upsert", 1);
    await passaggio(m, "2026-10-20T05:30:00Z");
    await passaggio(m, "2026-10-20T06:00:00Z");
    await passaggio(m, "2026-10-20T06:30:00Z");
    return m;
  });
  // 4. lettura dello stato del passaggio che fallisce (O1: i giri di oggi; O2: la funzione): il passaggio si ferma, quello dopo recupera
  await ab("stato del passaggio non letto, poi recupero", async (x) => {
    const m = mondo({ parametri: o2(x) });
    m.db.guasti.set(x ? "rpc:radar_notifiche_stato_passaggio|rpc" : "radar_notifiche_giri|select", 1);
    const caduto = await passaggio(m, "2026-10-20T05:30:00Z").then(() => false, () => true);
    controlla(`O2 ${x ? "accesa" : "spenta"}: lettura dello stato non riuscita → il passaggio si ferma senza scrivere nulla`, caduto && eventi(m).length === 0 && consegne(m).length === 0);
    await passaggio(m, "2026-10-20T06:00:00Z");
    return m;
  });
  // 5. 429 e quota: tutte in coda, poi partono con la stessa chiave; quota esaurita: nulla parte, nulla si perde
  await ab("429 e nuovo tentativo", async (x) => {
    const m = mondo({ parametri: o2(x), copione: (_m, n) => (n === 0 ? { esito: "riprova", codice: "rate_limit_exceeded", attesaSecondi: null, dopoInvio: false } : null) });
    await passaggio(m, "2026-10-20T05:30:00Z");
    await passaggio(m, "2026-10-20T05:33:00Z"); // il tentativo non è ancora dovuto: nulla da prendere
    await passaggio(m, "2026-10-20T05:36:00Z");
    await passaggio(m, "2026-10-20T06:00:00Z");
    return m;
  });
  await ab("quota esaurita", async (x) => {
    const m = mondo({ parametri: o2(x), quota: 0 });
    await passaggio(m, "2026-10-20T05:30:00Z");
    await passaggio(m, "2026-10-20T06:00:00Z");
    controlla(`O2 ${x ? "accesa" : "spenta"}: quota esaurita, nessuna email, nulla perso`, m.provider.consegnate.length === 0 && consegne(m).length > 0 && consegne(m).every((c) => c.stato === "in_coda"));
    return m;
  });
  // 6. affitti scaduti: il processo cade tra l'invio e la scrittura degli esiti; dopo 10 minuti si riprendono con la stessa chiave
  await ab("affitti scaduti (caduta tra invio ed esito)", async (x) => {
    const m = mondo({ parametri: o2(x) });
    let upsert = 0;
    const da = m.d.admin.from.bind(m.d.admin);
    m.d.admin = {
      ...m.db,
      rpc: m.db.rpc.bind(m.db),
      from: (t: string) => {
        const q = da(t) as unknown as { upsert: (...a: unknown[]) => unknown };
        if (t === "omnia_ai_radar_email_consegne") {
          const orig = q.upsert.bind(q);
          q.upsert = (...a: unknown[]) => {
            const o = a[1] as { onConflict?: string } | undefined;
            if (o?.onConflict === "id" && (a[0] as { stato?: string }[]).some((r) => r.stato === "inviata") && ++upsert === 1) throw new Error("processo caduto");
            return orig(...a);
          };
        }
        return q;
      },
    } as unknown as DipendenzeMotore["admin"];
    await passaggio(m, "2026-10-20T05:30:00Z");
    const appese = consegne(m).filter((c) => c.stato === "in_invio").length;
    await passaggio(m, "2026-10-20T05:35:00Z"); // affitto ancora valido: nulla da prendere
    await passaggio(m, "2026-10-20T05:50:00Z"); // affitto scaduto: riprese
    controlla(`O2 ${x ? "accesa" : "spenta"}: affitti scaduti ripresi, nessuna email doppia`, appese > 0 && consegne(m).every((c) => c.stato === "inviata") && new Set(m.provider.consegnate.map((c) => c.chiave)).size === m.provider.consegnate.length);
    return m;
  });
  // 7. passaggio a vuoto: 2 richieste con O1, 1 con O2; il primo passaggio vuoto del giorno scrive il battito (O1: 3, O2: 2)
  {
    const conta = async (x: boolean) => {
      const m = mondo({ parametri: { ...o2(x), giroInvioSoloConLavoro: true } });
      await passaggio(m, "2026-10-20T05:30:00Z");
      const p0 = m.db.conta();
      await passaggio(m, "2026-10-20T06:00:00Z");
      const p1 = m.db.conta();
      await passaggio(m, "2026-10-20T06:30:00Z");
      return [p1 - p0, m.db.conta() - p1];
    };
    const [a1, a2] = await conta(false);
    const [b1, b2] = await conta(true);
    controlla("O2 A/B: passaggi a vuoto dopo il primo del giorno → O1 2 richieste, O2 1 richiesta", a1 === 2 && a2 === 2 && b1 === 1 && b2 === 1, { a1, a2, b1, b2 });
  }
}

async function provaSimulazione(): Promise<void> {
  const { m, g, tarda, richiestePerGiorno, nonEseguiti } = await simula();
  if (nonEseguiti) falliti.push(`simulazione: ${nonEseguiti} passaggi non eseguiti`);
  const ev = eventi(m).filter((e) => e.gara_chiave === `p:${g.id}` && e.impresa_id === I1);
  const serie = ev.map((e) => `${e.tipo}@${e.versione}:${e.stato}`).sort();
  controlla("simulazione: nessun promemoria della vecchia scadenza (le sue soglie cadevano prima o dopo la proroga), la proroga una volta, poi 10 e 5 giorni della NUOVA scadenza alle loro date", JSON.stringify(serie) === JSON.stringify([
    "proroga@scadenza:2026-11-03T11:00:00.000Z:attivo",
    "scadenza_10@2026-11-03T11:00:00.000Z:attivo",
    "scadenza_5@2026-11-03T11:00:00.000Z:attivo",
  ].sort()), serie);
  const chiaviEv = eventi(m).map((e) => `${e.impresa_id}|${e.gara_chiave}|${e.tipo}|${e.versione}`);
  controlla("simulazione: nessun evento doppio (impresa, gara, tipo, versione)", new Set(chiaviEv).size === chiaviEv.length);
  controlla("simulazione: nessuna email doppia (una per chiave di idempotenza)", new Set(m.provider.consegnate.map((x) => x.chiave)).size === m.provider.consegnate.length);
  controlla("simulazione: nessuna consegna rimasta in invio o in coda alla fine", !consegne(m).some((c) => c.stato === "in_invio" || c.stato === "in_coda"), consegne(m).filter((c) => c.stato === "in_coda" || c.stato === "in_invio").map((c) => c.id));
  controlla("simulazione: la gara salvata tardi (a 5 giorni dalla scadenza, il giorno della soglia) non recupera i promemoria passati, riceve quello a 1 giorno", !eventi(m).some((e) => e.gara_chiave === `p:${tarda.id}` && ["scadenza_10", "scadenza_5"].includes(String(e.tipo))) && eventi(m).some((e) => e.gara_chiave === `p:${tarda.id}` && e.tipo === "scadenza_1"));
  const giorniEventi = new Set(m.db.t("radar_notifiche_giri").filter((g) => g.fase === "eventi" && g.esito === "riuscito").map((g) => g.giorno_roma));
  controlla("simulazione: un giro «eventi» al giorno (9 giorni con passaggi, il 27 senza)", giorniEventi.size === 9 && !giorniEventi.has("2026-10-27"), [...giorniEventi]);
  controlla("simulazione: giorno di Roma corretto anche dopo il cambio d'ora (25/10)", giornoRoma(new Date("2026-10-25T23:30:00Z")) === "2026-10-26" && giornoRoma(new Date("2026-10-24T22:30:00Z")) === "2026-10-25");
  const massimo = Math.max(...richiestePerGiorno);

  controlla("simulazione: richieste al giorno entro il limite (≤ 160) e mai a valanga", massimo <= 160, { richiestePerGiorno });
  console.log(`Simulazione di 10 giorni (2 imprese sintetiche, 29 passaggi al giorno): richieste al giorno ${richiestePerGiorno.join(", ")}; email ${m.provider.consegnate.length}, eventi ${eventi(m).length}, consegne ${consegne(m).length}`);
}

function provaTesto(): void {
  const cartella = path.join(__dirname, "..", "src", "lib", "radar", "notifiche");
  const leggi = (f: string) => fs.readFileSync(path.join(cartella, f), "utf8");
  const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const motore = senzaCommenti(leggi("motore.ts"));
  controlla("motore: l'interruttore unico prima di qualunque lettura", motore.indexOf("statoInvioEmail(d.env)") > 0 && motore.indexOf("statoInvioEmail(d.env)") < motore.indexOf("await ultimiGiriEventi(d)"));
  controlla("motore: provider sbagliato per l'ambiente rifiutato (finto sullo staging, Resend in produzione), nel passaggio e nella ravvicinata",
    (motore.match(/d\.provider\.nome !== \(stato\.ambiente === "produzione" \? "resend" : "finto"\)/g) ?? []).length === 2 && !/d\.provider\.nome !== "finto"/.test(motore));
  const rotta = fs.readFileSync(path.join(__dirname, "..", "src", "app", "api", "cron", "radar-promemoria", "route.ts"), "utf8");
  const r = senzaCommenti(rotta);
  controlla("rotta: CRON_SECRET controllato prima dell'interruttore e prima di caricare il motore", r.indexOf("cronAutorizzato(") > 0 && r.indexOf("cronAutorizzato(") < r.indexOf("statoInvioEmail(") && r.indexOf("statoInvioEmail(") < r.indexOf('import("@/lib/radar/notifiche/motore")'));
  controlla("rotta: nessun import statico del database né del motore", !/^import .*(supabase\/admin|notifiche\/motore)/m.test(rotta));
  // F8 (decisione dell'utente del 25/11): in vercel.json ESATTAMENTE la riga del documento 51 §10, una sola volta; radar-regionali mai
  const cronVercel = (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[] }).crons ?? [];
  const cronPromemoria = cronVercel.filter((c) => c.path.includes("promemoria"));
  controlla(
    "rotta: in vercel.json una sola volta, con «*/30 5-19 * * *» (51 §10); nessun radar-regionali",
    cronPromemoria.length === 1 && cronPromemoria[0].path === "/api/cron/radar-promemoria" && cronPromemoria[0].schedule === "*/30 5-19 * * *" && !cronVercel.some((c) => c.path.includes("radar-regionali")),
    cronPromemoria,
  );
  const resend = senzaCommenti(leggi("provider-resend.ts"));
  controlla("provider-resend: nessuna chiamata di rete diretta (solo la funzione iniettata)", !/\bfetch\s*\(/.test(resend) && /richiedi\(r\.url/.test(resend));
  controlla("provider-resend: si costruisce solo con resendConsentito(env)", /if \(!resendConsentito\(env\)\) throw/.test(resend));
  controlla("provider: resendConsentito vero solo con l'interruttore acceso in produzione", /export function resendConsentito\(env[^)]*\): boolean \{\s*const s = statoInvioEmail\(env\);\s*return s\.acceso && s\.ambiente === "produzione";/.test(leggi("provider.ts")));
  const ravv = senzaCommenti(leggi("ravvicinata.ts"));
  controlla("ravvicinata: il motore si carica solo dopo l'interruttore", ravv.indexOf("invioEmailAcceso(env)") > 0 && ravv.indexOf("invioEmailAcceso(env)") < ravv.indexOf('await import("./motore")'));
  for (const f of ["motore.ts", "eventi-calcoli.ts", "provider.ts", "provider-resend.ts", "parametri.ts"]) {
    const t = leggi(f);
    controlla(`${f}: nessun import di src/lib/email.ts`, !/lib\/email["']/.test(t));
    controlla(`${f}: righe con LF`, !t.includes("\r\n"));
  }
}

principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`))
  .finally(() => {
    console.log(`Verifica B4 motore delle notifiche${O2 ? " (O2 attiva)" : ""}: ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
