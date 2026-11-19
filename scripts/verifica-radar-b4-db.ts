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
import { CATEGORIA_DEL_TIPO, CATEGORIE_NOTIFICA, TIPI_EVENTO, versioneScadenza } from "../src/lib/radar/notifiche/tipi";

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
  for (const vietata of ["https://omnia-ai.it", "https://www.omnia-ai.it", "https://app.omniaitalia.com", "https://console.omniaitalia.com", "https://OMNIA-AI.IT"]) {
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
  for (const m of ["from", "select", "in", "order", "limit", "or", "eq", "rpc"]) {
    costruttore[m] = (...argomenti: unknown[]) => {
      chiamate.push({ metodo: m, argomenti });
      return costruttore;
    };
  }
  costruttore.returns = () => Promise.resolve({ data: risposte.dati ?? null, error: risposte.errore ?? null });
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

provaConsole()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica B4 database e notifiche: ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
