// Verifica della fase B4, parte database e motore delle notifiche (B2). Livello 1: NESSUN database, NESSUNA rete (fetch bloccato).
// Uso: npx tsx scripts/verifica-radar-b4-db.ts   → codice 0 se tutto passa, 1 altrimenti.
//
// Copre (19/11/2026): la regola unica «riceve sì/no» (pagina «Notifiche» di B1 e motore), lo stato dell'indirizzo, l'origine dei
// collegamenti delle email (mai la produzione fuori dal deploy di produzione), le letture di sola lettura per la console, il contratto
// tipi.ts e alcuni controlli sul testo dei file delle notifiche.
import fs from "fs";
import path from "path";
import {
  destinatariCheRicevono,
  ORDINE_MOTIVI,
  personaDaRiga,
  riceve,
  riceveTutte,
  statoIndirizzo,
  TESTO_MOTIVO,
  type PersonaImpresa,
  type PreferenzePersona,
  type StatoImpresaNotifiche,
} from "../src/lib/radar/notifiche/destinatari-calcoli";
import { origineAreaClienti, ORIGINE_LOCALE, PERCORSO_PREFERENZE, urlPerTe, urlPreferenze, urlScheda } from "../src/lib/radar/notifiche/origine";
import {
  codificaCursore,
  COLONNE_GIRI,
  COLONNE_PROBLEMI,
  contaConsegnePerStato,
  decodificaCursore,
  filtroDopoCursore,
  leggiProblemiEmail,
  leggiUltimiGiri,
  STATI_PROBLEMA,
} from "../src/lib/radar/notifiche/console-lettura";
import { CATEGORIA_DEL_TIPO, CATEGORIE_NOTIFICA, MASSIMO_EMAIL_SINGOLE_PER_PASSAGGIO, TIPI_EVENTO, TIPI_URGENTI, urgente, VERSIONE_CONTRATTO_NOTIFICHE, versioneScadenza } from "../src/lib/radar/notifiche/tipi";
import { aggiungiGiorni, giornoRoma, giorniDiCalendario, gruppiScadenza, oraRoma, promemoriaDovuti, scadenzaNota, versioniDaAnnullare, type LottoArchivio } from "../src/lib/radar/notifiche/calendario";
import { chiaveRaggruppamento, pianoInvio, PRIORITA_DEL_TIPO, type ConsegnaInCoda } from "../src/lib/radar/notifiche/coda-calcoli";
import { invioEmailAcceso, statoInvioEmail, VARIABILE_INTERRUTTORE_EMAIL } from "../src/lib/radar/notifiche/interruttore";
import { dopoIngressoInLista } from "../src/lib/radar/notifiche/ravvicinata";
import { ambienteDb, fonteAutorizzata, FONTI_RADAR, MOTIVO_ANTEPRIMA, scrittureRadarConsentite } from "../src/lib/radar/ambiente";

// rete bloccata: qualunque fetch fa fallire la verifica
globalThis.fetch = (async () => {
  throw new Error("RETE VIETATA nella verifica B4");
}) as typeof fetch;

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio)}`}`);
}

const IMPRESA = "11111111-1111-4111-8111-111111111111";
const ALTRA = "22222222-2222-4222-8222-222222222222";
const MEMBRO = "33333333-3333-4333-8333-333333333333";
const ESTRANEO = "44444444-4444-4444-8444-444444444444";

const titolare: PersonaImpresa = { impresaId: IMPRESA, userId: IMPRESA, ruolo: "titolare", email: "titolare@prova.test", emailConfermata: true, bloccato: false, membroAttivo: true };
const membro: PersonaImpresa = { impresaId: IMPRESA, userId: MEMBRO, ruolo: "ufficio_gare", email: "ufficio@prova.test", emailConfermata: true, bloccato: false, membroAttivo: true };
const tutteAccese: PreferenzePersona = { nuove_opportunita: true, scadenze: true, rettifiche: true, email_bloccata_il: null, motivo_blocco: null };
const impresaAccesa: StatoImpresaNotifiche = { impresaId: IMPRESA, radarAttivo: true, emailAttive: true, abbonamentoValido: true };

function motivo(p: PersonaImpresa, pref: PreferenzePersona | null, imp: StatoImpresaNotifiche, cat: "scadenze" | "rettifiche" | "nuove_opportunita" = "scadenze") {
  const e = riceve(p, pref, imp, cat);
  return e.riceve ? "riceve" : e.motivo;
}

// ---------- 1. regola «riceve» ----------
controlla("titolare con tutto acceso riceve", motivo(titolare, tutteAccese, impresaAccesa) === "riceve");
controlla("Ufficio Gare attivo con tutto acceso riceve", motivo(membro, tutteAccese, impresaAccesa) === "riceve");
controlla("abbonamento non controllato (null) non blocca", motivo(titolare, tutteAccese, { ...impresaAccesa, abbonamentoValido: null }) === "riceve");
controlla("persona di un'altra impresa", motivo({ ...membro, impresaId: ALTRA }, tutteAccese, impresaAccesa) === "altra_impresa");
controlla("titolare con id diverso dall'impresa = altra impresa", motivo({ ...titolare, userId: ESTRANEO }, tutteAccese, impresaAccesa) === "altra_impresa");
controlla("Ufficio Gare con l'id dell'impresa = incoerente", motivo({ ...membro, userId: IMPRESA }, tutteAccese, impresaAccesa) === "altra_impresa");
controlla("Radar non attivo", motivo(titolare, tutteAccese, { ...impresaAccesa, radarAttivo: false }) === "radar_non_attivo");
controlla("abbonamento non valido", motivo(titolare, tutteAccese, { ...impresaAccesa, abbonamentoValido: false }) === "abbonamento_non_valido");
controlla("email dell'impresa spente", motivo(titolare, tutteAccese, { ...impresaAccesa, emailAttive: false }) === "email_impresa_spente");
controlla("membro sospeso", motivo({ ...membro, membroAttivo: false }, tutteAccese, impresaAccesa) === "membro_disattivato");
controlla("utente bloccato o cancellato", motivo({ ...titolare, bloccato: true }, tutteAccese, impresaAccesa) === "utente_bloccato");
controlla("email mancante", motivo({ ...titolare, email: null }, tutteAccese, impresaAccesa) === "email_mancante");
controlla("email non plausibile = mancante", motivo({ ...titolare, email: "non-una-email" }, tutteAccese, impresaAccesa) === "email_mancante");
controlla("email da verificare", motivo({ ...titolare, emailConfermata: false }, tutteAccese, impresaAccesa) === "email_da_verificare");
controlla("indirizzo bloccato dal provider", motivo(titolare, { ...tutteAccese, email_bloccata_il: "2026-11-19T10:00:00Z", motivo_blocco: "rimbalzo" }, impresaAccesa) === "email_bloccata");
controlla("nessuna preferenza = tutto spento", motivo(titolare, null, impresaAccesa) === "categoria_spenta");
controlla("categoria spenta", motivo(titolare, { ...tutteAccese, scadenze: false }, impresaAccesa, "scadenze") === "categoria_spenta");
controlla("altra categoria accesa", motivo(titolare, { ...tutteAccese, scadenze: false }, impresaAccesa, "rettifiche") === "riceve");
{
  const e = riceve({ ...membro, membroAttivo: false, emailConfermata: false }, null, { ...impresaAccesa, emailAttive: false }, "scadenze");
  controlla("tutti i motivi, nell'ordine stabilito", !e.riceve && JSON.stringify(e.motivi) === JSON.stringify(["email_impresa_spente", "membro_disattivato", "email_da_verificare", "categoria_spenta"]), e);
  controlla("il testo è quello del primo motivo", !e.riceve && e.testo === TESTO_MOTIVO.email_impresa_spente);
}
controlla("ORDINE_MOTIVI copre tutti i testi", ORDINE_MOTIVI.length === Object.keys(TESTO_MOTIVO).length && ORDINE_MOTIVI.every((m) => m in TESTO_MOTIVO));
controlla("nessun testo dice «amministratore»", Object.values(TESTO_MOTIVO).every((t) => !/amministrator/i.test(t)));
{
  const t = riceveTutte(titolare, { ...tutteAccese, nuove_opportunita: false }, impresaAccesa);
  controlla("riceveTutte: tre categorie", Object.keys(t).length === 3 && t.scadenze.riceve && t.rettifiche.riceve && !t.nuove_opportunita.riceve);
}

// ---------- 2. stato dell'indirizzo ----------
controlla("indirizzo verificato", statoIndirizzo(titolare, tutteAccese) === "verificato");
controlla("indirizzo da verificare", statoIndirizzo({ ...titolare, emailConfermata: false }, tutteAccese) === "da_verificare");
controlla("indirizzo bloccato", statoIndirizzo(titolare, { ...tutteAccese, email_bloccata_il: "2026-11-19T10:00:00Z", motivo_blocco: "reclamo" }) === "bloccato");
controlla("utente disattivato (membro sospeso)", statoIndirizzo({ ...membro, membroAttivo: false }, tutteAccese) === "utente_disattivato");
controlla("utente disattivato (bloccato)", statoIndirizzo({ ...titolare, bloccato: true }, tutteAccese) === "utente_disattivato");

// ---------- 3. destinatari per il motore ----------
{
  const pref = new Map<string, PreferenzePersona>([[IMPRESA, tutteAccese], [MEMBRO, { ...tutteAccese, scadenze: false }], [ESTRANEO, tutteAccese]]);
  const estraneo: PersonaImpresa = { ...membro, userId: ESTRANEO, impresaId: ALTRA };
  const scad = destinatariCheRicevono([titolare, membro, estraneo, titolare], pref, impresaAccesa, "scadenze");
  controlla("scadenze: solo il titolare (membro con categoria spenta, estraneo escluso, doppione tolto)", scad.length === 1 && scad[0].userId === IMPRESA, scad.map((x) => x.userId));
  const rett = destinatariCheRicevono([titolare, membro, estraneo], pref, impresaAccesa, "rettifiche");
  controlla("rettifiche: titolare e membro, mai l'estraneo", rett.length === 2 && !rett.some((x) => x.userId === ESTRANEO));
  controlla("impresa spenta: nessuno", destinatariCheRicevono([titolare, membro], pref, { ...impresaAccesa, emailAttive: false }, "rettifiche").length === 0);
}

// ---------- 4. riga della funzione del database ----------
{
  const r = personaDaRiga({ impresa_id: IMPRESA, user_id: MEMBRO, ruolo: "ufficio_gare", email: " Ufficio@Prova.TEST ", email_confermata: true, bloccato: false, membro_attivo: true });
  controlla("riga valida, email in minuscolo e senza spazi", !!r && r.email === "ufficio@prova.test" && r.ruolo === "ufficio_gare");
  controlla("ruolo sconosciuto rifiutato", personaDaRiga({ impresa_id: IMPRESA, user_id: MEMBRO, ruolo: "admin", email: "a@b.it", email_confermata: true, bloccato: false, membro_attivo: true }) === null);
  controlla("id non valido rifiutato", personaDaRiga({ impresa_id: "x", user_id: MEMBRO, ruolo: "titolare" }) === null);
  const incerto = personaDaRiga({ impresa_id: IMPRESA, user_id: IMPRESA, ruolo: "titolare", email: "a@b.it", email_confermata: true, membro_attivo: true });
  controlla("«bloccato» assente = bloccato (prudenza)", !!incerto && incerto.bloccato === true);
  controlla("«email_confermata» assente = da verificare", personaDaRiga({ impresa_id: IMPRESA, user_id: IMPRESA, ruolo: "titolare", email: "a@b.it", bloccato: false, membro_attivo: true })?.emailConfermata === false);
}

// ---------- 5. origine dei collegamenti ----------
const URL_STAGING = "https://ryawdldqiumqsskrnyps.supabase.co";
const URL_PRODUZIONE = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
{
  const prod = origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_PRODUZIONE, VERCEL_ENV: "production" });
  controlla("produzione vera → https://omnia-ai.it", prod.ok && prod.origine === "https://omnia-ai.it");
  controlla("database di produzione su un'anteprima → fermo", !origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_PRODUZIONE, VERCEL_ENV: "preview" }).ok);
  controlla("database di produzione in locale → fermo", !origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_PRODUZIONE }).ok);
  const loc = origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_STAGING });
  controlla("staging senza variabile → localhost", loc.ok && loc.origine === ORIGINE_LOCALE);
  const ant = origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_STAGING, VERCEL_ENV: "preview", RADAR_EMAIL_ORIGINE: "https://omnia-ecommerce-git-anteprima-prova-ufficio-omnia.vercel.app" });
  controlla("anteprima con la sua origine", ant.ok && ant.origine === "https://omnia-ecommerce-git-anteprima-prova-ufficio-omnia.vercel.app");
  controlla("un dominio che solo somiglia a quello di produzione è ammesso", origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_STAGING, RADAR_EMAIL_ORIGINE: "https://notomnia-ai.it" }).ok);
  for (const vietata of ["https://omnia-ai.it", "https://www.omnia-ai.it", "https://app.omniaitalia.com", "https://console.omniaitalia.com", "https://OMNIA-AI.IT", "https://qualunque.sottodominio.omniaitalia.com", "https://omnia-ai.it."]) {
    controlla(`staging con origine di produzione vietata (${vietata})`, !origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_STAGING, RADAR_EMAIL_ORIGINE: vietata }).ok);
  }
  controlla("http fuori da localhost vietato", !origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_STAGING, RADAR_EMAIL_ORIGINE: "http://esempio.vercel.app" }).ok);
  controlla("origine con percorso vietata", !origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_STAGING, RADAR_EMAIL_ORIGINE: "https://esempio.vercel.app/x" }).ok);
  controlla("origine non valida", !origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: URL_STAGING, RADAR_EMAIL_ORIGINE: "non un indirizzo" }).ok);
  controlla("database sconosciuto trattato come non produzione (nessun collegamento alla produzione)", (() => { const o = origineAreaClienti({ NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co", VERCEL_ENV: "production" }); return o.ok && o.origine === ORIGINE_LOCALE; })());
  controlla("percorso delle preferenze dentro Opportunità", urlPreferenze("https://x.vercel.app") === "https://x.vercel.app/dashboard/omnia-ai/opportunita/notifiche" && PERCORSO_PREFERENZE.startsWith("/dashboard/omnia-ai/opportunita/"));
  controlla("«Per te»", urlPerTe("http://localhost:3000") === "http://localhost:3000/dashboard/omnia-ai/opportunita/per-te");
  controlla("scheda di una gara dell'archivio", urlScheda("http://localhost:3000", `p:${IMPRESA}`) === `http://localhost:3000/dashboard/omnia-ai/opportunita/gara/${IMPRESA}`);
  controlla("scheda di una gara aggiunta", urlScheda("http://localhost:3000", `a:${MEMBRO}`) === `http://localhost:3000/dashboard/omnia-ai/opportunita/aggiunta/${MEMBRO}`);
  controlla("chiave di gara non valida", urlScheda("http://localhost:3000", "riepilogo") === null);
}

// ---------- 6. letture per la console (client finto che registra) ----------
type Chiamata = { metodo: string; argomenti: unknown[] };
function clienteFinto(risposte: { dati?: unknown; errore?: { code?: string; message: string } | null }) {
  const chiamate: Chiamata[] = [];
  const costruttore: Record<string, unknown> = {};
  for (const m of ["from", "select", "in", "order", "limit", "or", "eq"]) {
    costruttore[m] = (...argomenti: unknown[]) => {
      chiamate.push({ metodo: m, argomenti });
      return costruttore;
    };
  }
  costruttore.returns = () => Promise.resolve({ data: risposte.dati ?? null, error: risposte.errore ?? null });
  // la funzione del database si attende direttamente (come supabase-js: la chiamata è già una promessa)
  costruttore.rpc = (...argomenti: unknown[]) => {
    chiamate.push({ metodo: "rpc", argomenti });
    return Promise.resolve({ data: risposte.dati ?? null, error: risposte.errore ?? null });
  };
  for (const vietato of ["insert", "update", "upsert", "delete"]) {
    costruttore[vietato] = () => {
      throw new Error(`SCRITTURA VIETATA: ${vietato}`);
    };
  }
  return { cliente: costruttore as never, chiamate };
}

async function provaConsole(): Promise<void> {
  controlla("colonne: nessun indirizzo email", !/email/i.test(COLONNE_PROBLEMI.replace(/omnia_ai_radar_email_consegne/g, "")));
  controlla("colonne: dei dati dell'evento solo la denominazione", COLONNE_PROBLEMI.includes("dati->gara->>denominazione") && !/\bdati\b(?!->)/.test(COLONNE_PROBLEMI));
  controlla("colonne dei giri senza dati di persone", !/email|user|destinatario/i.test(COLONNE_GIRI));

  const c = { aggiornataIl: "2026-11-19T10:00:00.123456+00:00", id: IMPRESA };
  const s = codificaCursore(c);
  controlla("cursore: andata e ritorno", JSON.stringify(decodificaCursore(s)) === JSON.stringify(c));
  controlla("cursore manomesso rifiutato", decodificaCursore(Buffer.from(`x|${IMPRESA}`).toString("base64url")) === null);
  controlla("cursore con iniezione rifiutato", decodificaCursore(Buffer.from(`2026-11-19T10:00:00Z,id.gt.0|${IMPRESA}`).toString("base64url")) === null);
  controlla("cursore vuoto = prima pagina", decodificaCursore("") === null && decodificaCursore(null) === null);
  controlla("filtro del cursore con le virgolette", filtroDopoCursore(c) === `aggiornata_il.lt."${c.aggiornataIl}",and(aggiornata_il.eq."${c.aggiornataIl}",id.lt.${IMPRESA})`);

  // 3 righe con limite 2 → 2 righe e un cursore
  const righe = [0, 1, 2].map((i) => ({ id: `0000000${i}-0000-4000-8000-000000000000`, aggiornata_il: `2026-11-19T10:00:0${i}+00:00`, stato: "fallita" }));
  const f1 = clienteFinto({ dati: righe });
  const p1 = await leggiProblemiEmail(f1.cliente, { limite: 2 });
  controlla("problemi: una sola richiesta, sola lettura", f1.chiamate.filter((x) => x.metodo === "from").length === 1);
  controlla("problemi: tabella e stati giusti", JSON.stringify(f1.chiamate.find((x) => x.metodo === "from")?.argomenti) === JSON.stringify(["omnia_ai_radar_email_consegne"]) && JSON.stringify(f1.chiamate.find((x) => x.metodo === "in")?.argomenti) === JSON.stringify(["stato", [...STATI_PROBLEMA]]));
  controlla("problemi: ordine per data e id, discendente", f1.chiamate.filter((x) => x.metodo === "order").map((x) => x.argomenti[0]).join(",") === "aggiornata_il,id");
  controlla("problemi: chiede limite + 1", JSON.stringify(f1.chiamate.find((x) => x.metodo === "limit")?.argomenti) === "[3]");
  controlla("problemi: 2 righe e il cursore dell'ultima", p1.disponibile && p1.righe.length === 2 && !!p1.prossimo && decodificaCursore(p1.prossimo)?.id === righe[1].id);
  controlla("problemi: prima pagina senza filtro del cursore", !f1.chiamate.some((x) => x.metodo === "or"));

  const f2 = clienteFinto({ dati: righe.slice(0, 1) });
  const p2 = await leggiProblemiEmail(f2.cliente, { cursore: s, limite: 500 });
  controlla("problemi: con il cursore applica il filtro", f2.chiamate.some((x) => x.metodo === "or" && x.argomenti[0] === filtroDopoCursore(c)));
  controlla("problemi: limite al più 100", JSON.stringify(f2.chiamate.find((x) => x.metodo === "limit")?.argomenti) === "[101]");
  controlla("problemi: ultima pagina senza cursore", p2.disponibile && p2.prossimo === null);

  const f3 = clienteFinto({ errore: { code: "42P01", message: "relation does not exist" } });
  const p3 = await leggiProblemiEmail(f3.cliente);
  controlla("problemi: tabelle assenti = non disponibile", !p3.disponibile && p3.motivo === "tabelle_assenti");

  const f4 = clienteFinto({ dati: [{ stato: "inviata", n: "12" }, { stato: "fallita", n: 3 }, { stato: "sconosciuto", n: 9 }] });
  const k = await contaConsegnePerStato(f4.cliente, new Date("2026-11-12T00:00:00Z"));
  controlla("conteggi: una sola chiamata alla funzione", f4.chiamate.filter((x) => x.metodo === "rpc").length === 1 && f4.chiamate[0].argomenti[0] === "radar_email_conteggi");
  controlla("conteggi: valori e zeri, stato sconosciuto ignorato", k.disponibile && k.perStato.inviata === 12 && k.perStato.fallita === 3 && k.perStato.in_coda === 0 && !("sconosciuto" in k.perStato));
  const f5 = clienteFinto({ errore: { code: "PGRST202", message: "function not found" } });
  const k5 = await contaConsegnePerStato(f5.cliente, new Date());
  controlla("conteggi: funzione assente = non disponibile", !k5.disponibile && k5.motivo === "tabelle_assenti");

  const f6 = clienteFinto({ dati: [] });
  const g = await leggiUltimiGiri(f6.cliente, 999);
  controlla("giri: tabella, ordine, limite al più 50", g.disponibile && JSON.stringify(f6.chiamate.find((x) => x.metodo === "from")?.argomenti) === JSON.stringify(["radar_notifiche_giri"]) && JSON.stringify(f6.chiamate.find((x) => x.metodo === "limit")?.argomenti) === "[50]");
}

// ---------- 7. contratto ----------
controlla("ogni tipo ha la sua categoria", TIPI_EVENTO.every((t) => CATEGORIE_NOTIFICA.includes(CATEGORIA_DEL_TIPO[t])));
controlla("scadenze = tipi scadenza_*", TIPI_EVENTO.every((t) => (CATEGORIA_DEL_TIPO[t] === "scadenze") === t.startsWith("scadenza")));
controlla("versione della scadenza: Z e +01:00 dello stesso istante coincidono", versioneScadenza({ giorno: "2026-12-14", istante: "2026-12-14T11:30:00Z" }) === versioneScadenza({ giorno: "2026-12-14", istante: "2026-12-14T12:30:00+01:00" }));
controlla("versione della scadenza: solo giorno", versioneScadenza({ giorno: "2026-12-14", istante: null }) === "2026-12-14");

controlla("contratto alla versione 2", VERSIONE_CONTRATTO_NOTIFICHE === 2);
controlla("urgenti: scadenza a 1 giorno, ravvicinata, proroga, modifica della scadenza, annullamento, rettifica, documenti", ["scadenza_1", "scadenza_ravvicinata", "proroga", "modifica_scadenza", "annullamento", "rettifica", "documenti"].every((t) => urgente(t as never)) && !urgente("scadenza_10") && !urgente("scadenza_5") && !urgente("riepilogo_opportunita"));
controlla("tetto per persona = 15", MASSIMO_EMAIL_SINGOLE_PER_PASSAGGIO === 15);

// ---------- 7-bis. calendario (Europe/Rome, cambi d'ora) ----------
controlla("giorni di calendario attraverso il passaggio all'ora legale 2026", giorniDiCalendario("2026-03-28", "2026-03-30") === 2 && giorniDiCalendario("2026-03-29", "2026-03-30") === 1);
controlla("giorni di calendario attraverso il ritorno all'ora solare 2026", giorniDiCalendario("2026-10-24", "2026-10-26") === 2 && giorniDiCalendario("2026-10-25", "2026-10-26") === 1);
controlla("giorni di calendario attraverso il passaggio all'ora legale 2027", giorniDiCalendario("2027-03-27", "2027-03-29") === 2);
controlla("giorni negativi e zero", giorniDiCalendario("2026-12-10", "2026-12-09") === -1 && giorniDiCalendario("2026-12-10", "2026-12-10") === 0);
controlla("giorno di Roma: 23:30 UTC del 28/03 è già il 29/03", giornoRoma("2026-03-28T23:30:00Z") === "2026-03-29");
controlla("giorno di Roma: 22:30 UTC del 24/10 (ora legale) è già il 25/10", giornoRoma("2026-10-24T22:30:00Z") === "2026-10-25");
controlla("giorno di Roma: 23:30 UTC del 25/10 (ora solare) è il 26/10", giornoRoma("2026-10-25T23:30:00Z") === "2026-10-26");
controlla("giorno di Roma: 21:58 UTC di luglio è ancora lo stesso giorno", giornoRoma("2026-07-01T21:58:00Z") === "2026-07-01");
controlla("ora di Roma d'inverno e d'estate", oraRoma("2026-12-14T11:30:00Z") === "12:30" && oraRoma("2026-07-14T10:30:00Z") === "12:30");
controlla("aggiungiGiorni attraverso il cambio d'ora", aggiungiGiorni("2026-10-20", 10) === "2026-10-30" && aggiungiGiorni("2026-04-05", -10) === "2026-03-26");
controlla("scadenza senza ora indicata: niente ora né istante, anche se l'archivio avesse un istante", (() => { const s = scadenzaNota({ giorno: "2026-12-14", istante: "2026-12-14T11:00:00Z", oraIndicata: false }); return !!s && s.ora === null && s.istante === null; })());
controlla("scadenza con ora indicata: ora di Roma e istante normalizzato", (() => { const s = scadenzaNota({ giorno: "2026-12-14", istante: "2026-12-14T12:30:00+01:00", oraIndicata: true }); return !!s && s.ora === "12:30" && s.istante === "2026-12-14T11:30:00.000Z"; })());

// ---------- 7-ter. gruppi di scadenza per lotto (modifica 2) ----------
{
  const L = (numero: string, cig: string | null, giorno: string | null, istante: string | null = null): LottoArchivio => ({ numero, titolo: null, cig, scadenza: giorno ? { giorno, istante, oraIndicata: !!istante } : null });
  const proc = { giorno: "2026-12-01", istante: "2026-12-01T11:00:00Z", oraIndicata: true };
  const a = gruppiScadenza(proc, [L("1", "AAAAAAAAAA", "2026-12-01", "2026-12-01T11:00:00Z"), L("2", "BBBBBBBBBB", "2026-12-15", "2026-12-15T11:00:00Z"), L("3", "CCCCCCCCCC", "2026-12-01", "2026-12-01T12:00:00+01:00")]);
  controlla("lotti: due scadenze distinte = due gruppi, il più vicino prima", a.gruppi.length === 2 && a.gruppi[0].scadenza.giorno === "2026-12-01" && a.gruppi[1].scadenza.giorno === "2026-12-15");
  controlla("lotti: stessa scadenza (anche scritta Z/+01:00) = stesso gruppo, con i CIG", a.gruppi[0].ambito === "lotti" && a.gruppi[0].lotti.map((l) => l.cig).join(",") === "AAAAAAAAAA,CCCCCCCCCC");
  const b = gruppiScadenza(proc, [L("1", "AAAAAAAAAA", "2026-12-01", "2026-12-01T11:00:00Z"), L("2", "BBBBBBBBBB", null), L("3", null, null)]);
  controlla("lotti senza scadenza: elencati a parte, MAI con la scadenza della procedura o di altri lotti", b.gruppi.length === 1 && b.gruppi[0].lotti.length === 1 && b.lottiSenzaScadenza.length === 2 && !b.gruppi.some((g) => g.lotti.some((l) => l.cig === "BBBBBBBBBB")));
  const c = gruppiScadenza(proc, [L("1", "AAAAAAAAAA", null), L("2", "BBBBBBBBBB", null)]);
  controlla("nessuna scadenza di lotto: un solo gruppo della procedura, senza lotti dichiarati", c.gruppi.length === 1 && c.gruppi[0].ambito === "procedura" && c.gruppi[0].lotti.length === 0 && c.lottiSenzaScadenza.length === 0);
  controlla("nessuna scadenza: nessun gruppo", gruppiScadenza(null, []).gruppi.length === 0);
  controlla("nessuna scadenza né per i lotti né per la procedura: i lotti elencati come «senza scadenza» (come la PVL)", (() => { const x = gruppiScadenza(null, [L("2", "BBBBBBBBBB", null), L("1", "AAAAAAAAAA", null)]); return x.gruppi.length === 0 && x.lottiSenzaScadenza.map((l) => l.numero).join(",") === "1,2"; })());
  const d = gruppiScadenza(null, [L("1", null, "2026-12-01", "2026-12-01T09:00:00Z"), L("2", null, "2026-12-01")]);
  controlla("stesso giorno, uno con l'ora e uno senza: due scadenze distinte, prima quella con l'ora", d.gruppi.length === 2 && d.gruppi[0].scadenza.istante !== null && d.gruppi[1].scadenza.istante === null);
  // proroga di un solo lotto: la vecchia scadenza resta se un altro lotto l'ha ancora
  const prima = gruppiScadenza(null, [L("1", "AAAAAAAAAA", "2026-12-01"), L("2", "BBBBBBBBBB", "2026-12-01")]);
  const dopoUno = gruppiScadenza(null, [L("1", "AAAAAAAAAA", "2026-12-20"), L("2", "BBBBBBBBBB", "2026-12-01")]);
  const dopoTutti = gruppiScadenza(null, [L("1", "AAAAAAAAAA", "2026-12-20"), L("2", "BBBBBBBBBB", "2026-12-20")]);
  const vecchia = versioneScadenza(prima.gruppi[0].scadenza);
  controlla("proroga di un solo lotto: la vecchia versione NON si annulla (un altro lotto l'ha ancora)", versioniDaAnnullare([vecchia], dopoUno.gruppi).length === 0);
  controlla("proroga di tutti i lotti: la vecchia versione si annulla", JSON.stringify(versioniDaAnnullare([vecchia], dopoTutti.gruppi)) === JSON.stringify([vecchia]));

  // promemoria per gruppo
  const due = gruppiScadenza(null, [L("1", "AAAAAAAAAA", "2026-12-11"), L("2", "BBBBBBBBBB", "2026-12-06")]);
  const p = promemoriaDovuti({ oggi: "2026-12-01", gruppi: due.gruppi, entrataInListaIl: "2026-11-20T10:00:00Z", ultimoGiroRiuscito: "2026-11-30", aperta: true });
  controlla("promemoria per OGNI scadenza distinta: 10 giorni per un lotto, 5 per l'altro", p.length === 2 && p.some((x) => x.tipo === "scadenza_10" && x.gruppo.lotti[0].cig === "AAAAAAAAAA") && p.some((x) => x.tipo === "scadenza_5" && x.gruppo.lotti[0].cig === "BBBBBBBBBB"));
  controlla("versione del promemoria = versione della scadenza del gruppo", p.every((x) => x.versione === versioneScadenza(x.gruppo.scadenza)));
  controlla("gara entrata in lista oggi: nessun promemoria (niente recupero)", promemoriaDovuti({ oggi: "2026-12-01", gruppi: due.gruppi, entrataInListaIl: "2026-12-01T06:00:00Z", ultimoGiroRiuscito: "2026-11-30", aperta: true }).length === 0);
  controlla("gara non aperta: nessun promemoria", promemoriaDovuti({ oggi: "2026-12-01", gruppi: due.gruppi, entrataInListaIl: "2026-11-20T10:00:00Z", ultimoGiroRiuscito: "2026-11-30", aperta: false }).length === 0);
  const s1 = gruppiScadenza(null, [L("1", null, "2026-12-02")]);
  controlla("scadenza a 1 giorno", promemoriaDovuti({ oggi: "2026-12-01", gruppi: s1.gruppi, entrataInListaIl: "2026-11-01T10:00:00Z", ultimoGiroRiuscito: "2026-11-30", aperta: true })[0]?.tipo === "scadenza_1");
  controlla("scadenza oggi: nessun promemoria", promemoriaDovuti({ oggi: "2026-12-02", gruppi: s1.gruppi, entrataInListaIl: "2026-11-01T10:00:00Z", ultimoGiroRiuscito: "2026-12-01", aperta: true }).length === 0);
  controlla("scadenza oggi con il giro di ieri saltato: il promemoria a 1 giorno NON si recupera", promemoriaDovuti({ oggi: "2026-12-02", gruppi: s1.gruppi, entrataInListaIl: "2026-11-01T10:00:00Z", ultimoGiroRiuscito: "2026-11-30", aperta: true }).length === 0);
  // giro saltato
  const s4 = gruppiScadenza(null, [L("1", null, "2026-12-05")]);
  const rec = promemoriaDovuti({ oggi: "2026-12-01", gruppi: s4.gruppi, entrataInListaIl: "2026-11-01T10:00:00Z", ultimoGiroRiuscito: "2026-11-29", aperta: true });
  controlla("giro di ieri saltato: si recupera il promemoria a 5 giorni (caduto ieri), segnato come recupero", rec.length === 1 && rec[0].tipo === "scadenza_5" && rec[0].recupero && rec[0].giorniMancanti === 4);
  controlla("giri saltati da più di 2 giorni: nessun recupero", promemoriaDovuti({ oggi: "2026-12-01", gruppi: s4.gruppi, entrataInListaIl: "2026-11-01T10:00:00Z", ultimoGiroRiuscito: "2026-11-27", aperta: true }).length === 0);
  controlla("giro saltato ma gara entrata in lista dopo la soglia: nessun recupero", promemoriaDovuti({ oggi: "2026-12-01", gruppi: s4.gruppi, entrataInListaIl: "2026-11-30T10:00:00Z", ultimoGiroRiuscito: "2026-11-29", aperta: true }).length === 0);
  controlla("nessun giro riuscito in passato: nessun recupero", promemoriaDovuti({ oggi: "2026-12-01", gruppi: s4.gruppi, entrataInListaIl: "2026-11-01T10:00:00Z", ultimoGiroRiuscito: null, aperta: true }).length === 0);
  controlla("promemoria a cavallo del cambio d'ora (25/10): 10 giorni prima del 03/11", promemoriaDovuti({ oggi: "2026-10-24", gruppi: gruppiScadenza(null, [L("1", null, "2026-11-03")]).gruppi, entrataInListaIl: "2026-10-01T10:00:00Z", ultimoGiroRiuscito: "2026-10-23", aperta: true })[0]?.tipo === "scadenza_10");
}

// ---------- 7-quater. piano d'invio per persona (modifica 1) ----------
{
  let n = 0;
  const C = (tipo: ConsegnaInCoda["tipo"], giornoEvento = "2026-12-01"): ConsegnaInCoda => ({ id: `c${String(++n).padStart(3, "0")}`, tipo, creataIl: `2026-12-01T06:${String(n % 60).padStart(2, "0")}:00Z`, giornoEvento });
  const venti = Array.from({ length: 20 }, () => C("scadenza_1"));
  const p1 = pianoInvio(venti, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: null });
  controlla("20 urgenti: 15 singole e 5 RAGGRUPPATE subito, nessuna rinviata", p1.singole.length === 15 && p1.raggruppate.length === 5 && p1.rinviate.length === 0);
  const misti = [...Array.from({ length: 10 }, () => C("scadenza_10")), ...Array.from({ length: 10 }, () => C("rettifica"))];
  const p2 = pianoInvio(misti, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: null });
  controlla("10 rettifiche + 10 promemoria a 10 giorni: tutte le rettifiche singole, 5 promemoria singoli, 5 rinviati", p2.singole.filter((id) => misti.find((c) => c.id === id)?.tipo === "rettifica").length === 10 && p2.singole.length === 15 && p2.rinviate.length === 5 && p2.raggruppate.length === 0);
  const p3 = pianoInvio(misti, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: true, quotaResidua: null });
  controlla("ultimo passaggio del giorno: i non urgenti oltre il tetto si raggruppano, nessuno rinviato", p3.rinviate.length === 0 && p3.raggruppate.length === 5);
  const ieri = Array.from({ length: 17 }, () => C("scadenza_5", "2026-11-30"));
  const p4 = pianoInvio(ieri, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: null });
  controlla("non urgenti di ieri: non aspettano oltre (raggruppati)", p4.raggruppate.length === 2 && p4.rinviate.length === 0);
  const conRiepilogo = [C("riepilogo_opportunita"), ...Array.from({ length: 15 }, () => C("scadenza_10")), C("scadenza_1")];
  const p5 = pianoInvio(conRiepilogo, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: null });
  controlla("la scadenza a 1 giorno passa per prima, il riepilogo per ultimo (rinviato)", p5.singole[0] === conRiepilogo[16].id && p5.rinviate.includes(conRiepilogo[0].id) && !p5.rinviate.includes(conRiepilogo[16].id));
  const p6 = pianoInvio(venti, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: 3 });
  controlla("quota residua 3: 2 singole + 1 raggruppata con tutti gli altri urgenti (3 email)", p6.singole.length === 2 && p6.raggruppate.length === 18 && p6.rinviate.length === 0);
  const p7 = pianoInvio(venti, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: 0 });
  controlla("quota esaurita: nulla parte, nulla si perde (tutto in coda)", p7.singole.length === 0 && p7.raggruppate.length === 0 && p7.rinviate.length === 20);
  const sedici = Array.from({ length: 16 }, () => C("proroga"));
  const p8 = pianoInvio(sedici, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: null });
  controlla("16 urgenti: mai più di 15 singole (la sedicesima va raggruppata)", p8.singole.length === 15 && p8.raggruppate.length === 1);
  const pochi = [C("scadenza_10"), C("rettifica")];
  controlla("sotto il tetto: tutte singole, in ordine di priorità", JSON.stringify(pianoInvio(pochi, { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: null }).singole) === JSON.stringify([pochi[1].id, pochi[0].id]));
  controlla("consegne doppie nella coda contate una volta", pianoInvio([pochi[0], pochi[0]], { oggi: "2026-12-01", ultimoPassaggioDelGiorno: false, quotaResidua: null }).singole.length === 1);
  controlla("ogni consegna esce in UN solo elenco", [p1, p2, p3, p4, p5, p6, p7, p8].every((p) => new Set([...p.singole, ...p.raggruppate, ...p.rinviate]).size === p.singole.length + p.raggruppate.length + p.rinviate.length));
  controlla("gli urgenti non sono mai rinviati quando c'è quota", [p1, p2, p3, p4, p5, p6, p8].every((p) => p.rinviate.every((id) => { const c = [...venti, ...misti, ...ieri, ...conRiepilogo, ...sedici].find((x) => x.id === id); return !!c && !TIPI_URGENTI.includes(c.tipo); })));
  const imp = (s: string) => `#${s.length}:${s}`;
  controlla("chiave del raggruppamento: stessa insieme = stessa chiave, in qualunque ordine", chiaveRaggruppamento("u1", ["b", "a", "a"], imp) === chiaveRaggruppamento("u1", ["a", "b"], imp));
  controlla("priorità: urgenti prima di 5 e 10 giorni e del riepilogo", TIPI_URGENTI.every((t) => PRIORITA_DEL_TIPO[t] < PRIORITA_DEL_TIPO.scadenza_5) && PRIORITA_DEL_TIPO.riepilogo_opportunita === Math.max(...Object.values(PRIORITA_DEL_TIPO)));
}

// ---------- 7-quinquies. interruttore unico del motore e aggancio della «scadenza ravvicinata» ----------
const STAGING_URL = "https://ryawdldqiumqsskrnyps.supabase.co";
const PROD_URL = "https://bihfrzspqxsrzlbqqvqa.supabase.co";
{
  const casi: [Record<string, string | undefined>, boolean, string][] = [
    [{}, false, "spento"],
    [{ NEXT_PUBLIC_SUPABASE_URL: STAGING_URL }, false, "spento"],
    [{ NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, RADAR_NOTIFICHE_EMAIL: "1" }, false, "spento"],
    [{ NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, RADAR_NOTIFICHE_EMAIL: "true" }, false, "spento"],
    [{ NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, RADAR_NOTIFICHE_EMAIL: " attivo" }, false, "spento"],
    [{ NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, RADAR_NOTIFICHE_EMAIL: "attivo" }, true, ""],
    [{ NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, RADAR_NOTIFICHE_EMAIL: "attivo", VERCEL_ENV: "preview" }, false, "anteprima"],
    // pacchetto P (piano 55 §2): in produzione SOLO sul deploy di produzione con la variabile esatta; mai da locale né da un'anteprima
    [{ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, RADAR_NOTIFICHE_EMAIL: "attivo", VERCEL_ENV: "production" }, true, ""],
    [{ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, VERCEL_ENV: "production" }, false, "spento"],
    [{ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, RADAR_NOTIFICHE_EMAIL: "attivo", VERCEL_ENV: "preview" }, false, "anteprima"],
    [{ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, RADAR_NOTIFICHE_EMAIL: "attivo", VERCEL_ENV: "development" }, false, "ambiente_non_autorizzato"],
    [{ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, RADAR_NOTIFICHE_EMAIL: "attivo" }, false, "ambiente_non_autorizzato"],
    [{ NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co", RADAR_NOTIFICHE_EMAIL: "attivo" }, false, "ambiente_non_autorizzato"],
    [{ RADAR_NOTIFICHE_EMAIL: "attivo" }, false, "ambiente_non_autorizzato"],
  ];
  for (const [env, atteso, motivo] of casi) {
    const s = statoInvioEmail(env);
    controlla(`interruttore unico: ${JSON.stringify(env)} → ${atteso ? "acceso" : motivo}`, invioEmailAcceso(env) === atteso && (s.acceso ? atteso : !atteso && s.motivo === motivo), s);
  }
  controlla("interruttore unico: la variabile è RADAR_NOTIFICHE_EMAIL", VARIABILE_INTERRUTTORE_EMAIL === "RADAR_NOTIFICHE_EMAIL");
}

// ---------- 7-sexies. guardia unica delle fonti (L6): fonte × uso × ambiente ----------
{
  // la regola di PRIMA (ambiente.ts fino al 19/11), copiata qui come oracolo: per l'importazione la semantica deve restare IDENTICA
  const vecchia = (fonte: string, env: Record<string, string | undefined>) => {
    const ambiente = ambienteDb(env.NEXT_PUBLIC_SUPABASE_URL);
    if (env.VERCEL_ENV === "preview") return { ok: false, ambiente, motivo: MOTIVO_ANTEPRIMA };
    if (ambiente === "staging") return { ok: true, ambiente };
    if (fonte === "pvl") return { ok: false, ambiente, motivo: "La PVL è autorizzata solo sullo staging: nessuna scrittura in questo database." };
    if (fonte !== "ted") return { ok: false, ambiente, motivo: "Le fonti regionali sono autorizzate solo sullo staging: nessuna scrittura in questo database." };
    if (ambiente === "produzione" && env.VERCEL_ENV === "production") return { ok: true, ambiente };
    return { ok: false, ambiente, motivo: "Scritture nell'archivio di produzione consentite solo dal deploy di produzione." };
  };
  const ambienti: [string, Record<string, string | undefined>][] = [
    ["staging locale", { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL }],
    ["staging, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, VERCEL_ENV: "production" }],
    ["staging, anteprima", { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, VERCEL_ENV: "preview" }],
    ["produzione, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, VERCEL_ENV: "production" }],
    ["produzione, computer locale", { NEXT_PUBLIC_SUPABASE_URL: PROD_URL }],
    ["produzione, anteprima", { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, VERCEL_ENV: "preview" }],
    ["database sconosciuto, deploy di produzione", { NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co", VERCEL_ENV: "production" }],
    ["database sconosciuto, locale", { NEXT_PUBLIC_SUPABASE_URL: "https://altro.supabase.co" }],
    ["nessun database", {}],
    ["staging scritto con una barra finale", { NEXT_PUBLIC_SUPABASE_URL: `${STAGING_URL}/` }],
  ];
  // atteso: [fonte, ambiente] → consentita? (uguale per i due usi)
  const atteso = (fonte: string, nome: string): boolean => {
    if (!(FONTI_RADAR as readonly string[]).includes(fonte) || nome.includes("anteprima")) return false;
    if (nome.startsWith("staging")) return true;
    return fonte === "ted" && nome === "produzione, deploy di produzione";
  };
  let celle = 0;
  for (const fonte of [...FONTI_RADAR, "manuale", "ted2", ""]) {
    for (const [nome, env] of ambienti) {
      for (const uso of ["importazione", "notifiche"] as const) {
        const p = fonteAutorizzata(fonte, uso, env);
        celle++;
        controlla(`fonteAutorizzata(${fonte || "«»"}, ${uso}, ${nome}) = ${atteso(fonte, nome) ? "sì" : "no"}`, p.ok === atteso(fonte, nome) && (p.ok || p.motivo.length > 10), p);
      }
      if ((FONTI_RADAR as readonly string[]).includes(fonte)) {
        const f = fonte as (typeof FONTI_RADAR)[number];
        // dal K8, SENZA le variabili RADAR_<FONTE>_PRODUZIONE, l'esito resta identico in ogni cella; cambia solo il TESTO del motivo di PVL,
        // Sintel e SardegnaCAT sul deploy di produzione (dice quale variabile manca). Con le variabili: verifica-radar-ambiente-k8.ts
        const ora = scrittureRadarConsentite(f, env), prima = vecchia(f, env);
        const soloTesto = f !== "ted" && nome === "produzione, deploy di produzione";
        controlla(`importazione identica alla regola di prima: ${fonte}, ${nome}`, soloTesto ? ora.ok === prima.ok && ora.ambiente === prima.ambiente && !ora.ok && /PRODUZIONE=autorizzata/.test(ora.motivo) : JSON.stringify(ora) === JSON.stringify(prima), [ora, prima]);
      }
    }
  }
  controlla("matrice completa: 7 fonti × 10 ambienti × 2 usi", celle === 140, celle);
  controlla("le notifiche dicono «nessuna notifica», l'importazione «nessuna scrittura»", fonteAutorizzata("pvl", "notifiche", { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, VERCEL_ENV: "production" }).ok === false
    && /nessuna notifica/.test((fonteAutorizzata("pvl", "notifiche", { NEXT_PUBLIC_SUPABASE_URL: PROD_URL }) as { motivo: string }).motivo));
  const testoAmbiente = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "radar", "ambiente.ts"), "utf8");
  // dal K8 (48C §3.7) le variabili di produzione esistono, ma solo nella tabella VARIABILI_PRODUZIONE e mai per TED
  const codiceAmbiente = testoAmbiente.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  controlla("ambiente.ts: le variabili RADAR_<FONTE>_PRODUZIONE solo nella tabella VARIABILI_PRODUZIONE (PVL, Sintel, SardegnaCAT; mai TED)", JSON.stringify(codiceAmbiente.match(/RADAR_[A-Z]+_PRODUZIONE/g)) === JSON.stringify(["RADAR_PVL_PRODUZIONE", "RADAR_SINTEL_PRODUZIONE", "RADAR_SARDEGNACAT_PRODUZIONE"]), codiceAmbiente.match(/RADAR_[A-Z]+_PRODUZIONE/g));
  controlla("ambiente.ts: scrittureRadarConsentite è fonteAutorizzata per l'importazione", /return fonteAutorizzata\(fonte, "importazione", env\)/.test(testoAmbiente));
}

async function provaRavvicinata(): Promise<void> {
  const G = "55555555-5555-4555-8555-555555555555";
  const gara = { impresaId: IMPRESA, proceduraId: G, aggiuntaId: null, autoreId: MEMBRO };
  const acceso = { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, RADAR_NOTIFICHE_EMAIL: "attivo" };
  controlla("ravvicinata: interruttore spento → «spento», nessun accesso", JSON.stringify(await dopoIngressoInLista(gara, { env: {} })) === JSON.stringify({ esito: "spento" }));
  controlla("ravvicinata: anteprima → «spento»", (await dopoIngressoInLista(gara, { env: { ...acceso, VERCEL_ENV: "preview" } })).esito === "spento");
  // pacchetto P: in produzione la ravvicinata vale solo sul deploy di produzione con l'interruttore (provato su statoInvioEmail); senza la
  // variabile o da un computer locale resta spenta, senza nessun accesso
  controlla("ravvicinata: produzione senza la variabile → «spento»", (await dopoIngressoInLista(gara, { env: { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, VERCEL_ENV: "production" } })).esito === "spento");
  controlla("ravvicinata: produzione da un computer locale → «spento»", (await dopoIngressoInLista(gara, { env: { ...acceso, NEXT_PUBLIC_SUPABASE_URL: PROD_URL } })).esito === "spento");
  for (const [nome, g] of [
    ["procedura e aggiunta insieme", { ...gara, aggiuntaId: G }],
    ["né procedura né aggiunta", { ...gara, proceduraId: null }],
    ["impresa non valida", { ...gara, impresaId: "x" }],
    ["procedura non valida", { ...gara, proceduraId: "x" }],
  ] as const) {
    const e = await dopoIngressoInLista(g as typeof gara, { env: acceso });
    controlla(`ravvicinata: ${nome} → «non_dovuta», mai un'eccezione`, e.esito === "non_dovuta", e);
  }
  const strana = await dopoIngressoInLista(null as unknown as typeof gara, { env: acceso });
  controlla("ravvicinata: argomento nullo → esito, mai un'eccezione", strana.esito === "non_dovuta" || strana.esito === "errore", strana);
}

// ---------- 8. testo dei file delle notifiche ----------
{
  const cartella = path.join(__dirname, "..", "src", "lib", "radar", "notifiche");
  // come verifica-scadenza-ora-omnia-ai.ts: i commenti possono CITARE la regola («mai 23:59»), il codice no
  const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  // la parola vietata si compone a pezzi: verifica-scadenza-ora-omnia-ai.ts la cerca in TUTTI gli script, anche dentro una regex
  const oraPresunta = new RegExp(`23:59|${["fineGiorno", "Roma"].join("")}`);
  for (const nome of fs.readdirSync(cartella).filter((n) => n.endsWith(".ts"))) {
    const testo = fs.readFileSync(path.join(cartella, nome), "utf8");
    const codice = senzaCommenti(testo);
    controlla(`${nome}: non importa src/lib/email.ts`, !/from\s+["']@\/lib\/email["']|lib\/email["']/.test(codice));
    controlla(`${nome}: nessuna chiamata di rete diretta`, !/\bfetch\s*\(/.test(codice));
    controlla(`${nome}: nessuna ora presunta`, !oraPresunta.test(codice));
    controlla(`${nome}: righe con LF`, !testo.includes("\r\n"));
  }
  const console_ = fs.readFileSync(path.join(cartella, "console-lettura.ts"), "utf8");
  controlla("console-lettura: nessuna scrittura", !/\.(insert|update|upsert|delete)\s*\(/.test(console_));
  const vercel = fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8");
  controlla("nessun cron dei promemoria in vercel.json", !vercel.includes("radar-promemoria"));
}

Promise.all([provaConsole(), provaRavvicinata()])
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica B4 database e notifiche: ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
