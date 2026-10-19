// Autotest di «chat e caricamento documenti spenti per una gara che non spetta al cliente»:
// chi ha finito le gare del piano, i crediti e le gare gratuite non può caricare (né far indicizzare)
// documenti né usare la chat su una gara che non ha mai consumato una gara. Si provano le regole con
// un database finto (nessuna rete), che le letture rispecchino il consumo vero (gara-consumo.ts), che
// il blocco stia PRIMA di ogni scrittura e di ogni chiamata al modello, e la vista.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PIANI } from "../src/lib/omnia-ai-plans";
import { verificaDirittoGara } from "../src/lib/gara-diritto";
import {
  MESSAGGIO_GARA_BLOCCATA_GRATUITE,
  MESSAGGIO_GARA_BLOCCATA_QUOTA,
  MESSAGGIO_VERIFICA_GARE_NON_RIUSCITA,
  dirittoDaFonti,
  fonteQuotaDisponibile,
} from "../src/lib/gara-diritto-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(b) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);
const corpo = (sorgente: string, da: string, a?: string) => {
  const i = sorgente.indexOf(da);
  if (i === -1) return "";
  const f = a ? sorgente.indexOf(a, i + da.length) : -1;
  return sorgente.slice(i, f === -1 ? undefined : f);
};

// ───── database finto: tabelle in memoria, con i soli metodi che la lettura usa ─────
type Riga = Record<string, unknown>;
type Tabelle = Record<string, Riga[]>;
function clienteFinto(tabelle: Tabelle, tabelleInErrore: string[] = []): SupabaseClient {
  return {
    from: (tabella: string) => {
      const filtri: ((r: Riga) => boolean)[] = [];
      let ordine: { colonna: string; crescente: boolean } | null = null;
      let massimo: number | null = null;
      let soloConteggio = false;
      const esegui = () => {
        if (tabelleInErrore.includes(tabella)) return { righe: [] as Riga[], error: { code: "XX000", message: "guasto" } };
        let righe = (tabelle[tabella] ?? []).filter((r) => filtri.every((f) => f(r)));
        if (ordine) {
          const { colonna, crescente } = ordine;
          righe = [...righe].sort((a, b) => (String(a[colonna]) < String(b[colonna]) ? -1 : 1) * (crescente ? 1 : -1));
        }
        if (massimo !== null) righe = righe.slice(0, massimo);
        return { righe, error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: (_colonne?: string, opzioni?: { head?: boolean }) => {
          if (opzioni?.head) soloConteggio = true;
          return q;
        },
        eq: (colonna: string, valore: unknown) => {
          filtri.push((r) => r[colonna] === valore);
          return q;
        },
        gte: (colonna: string, valore: unknown) => {
          filtri.push((r) => String(r[colonna]) >= String(valore));
          return q;
        },
        order: (colonna: string, opzioni?: { ascending?: boolean }) => {
          ordine = { colonna, crescente: opzioni?.ascending !== false };
          return q;
        },
        limit: (n: number) => {
          massimo = n;
          return q;
        },
        maybeSingle: async () => {
          const e = esegui();
          return { data: e.error ? null : (e.righe[0] ?? null), error: e.error };
        },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          const e = esegui();
          return Promise.resolve({ data: soloConteggio ? null : e.righe, count: e.righe.length, error: e.error }).then(ok, ko);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const GARA = "g1";
const UTENTE = "u1";
const GIORNO = 24 * 60 * 60 * 1000;
const FUTURO = new Date(Date.now() + 20 * GIORNO).toISOString();
const PASSATO = new Date(Date.now() - 2 * GIORNO).toISOString();
const INIZIO_PERIODO = new Date(Date.now() - 10 * GIORNO).toISOString();
const PRIMA_DEL_PERIODO = new Date(Date.now() - 40 * GIORNO).toISOString();
const ADESSO = new Date().toISOString();

const garaDaAnalizzare = { id: GARA, estrazione_stato: "non_avviata", criteri_valutazione: null };
const abbonamento = (extra: Riga = {}): Riga => ({ id: "s1", user_id: UTENTE, plan: "starter", status: "attivo", current_period_start: INIZIO_PERIODO, current_period_end: FUTURO, created_at: INIZIO_PERIODO, ...extra });
const consumi = (n: number, tipo = "piano", quando = ADESSO): Riga[] => Array.from({ length: n }, (_, i) => ({ id: `c${tipo}${i}${quando}`, gara_id: `altra-${tipo}-${i}`, user_id: UTENTE, tipo, created_at: quando }));
const crediti = (balance: number): Riga[] => [{ user_id: UTENTE, balance }];
const gratuite = (assegnate: number, usate: number): Riga[] => [{ user_id: UTENTE, assegnate, usate }];

async function esito(tabelle: Tabelle, tabelleInErrore: string[] = []) {
  const completo: Tabelle = { gare: [garaDaAnalizzare], ...tabelle };
  return verificaDirittoGara({ garaId: GARA, userId: UTENTE, client: clienteFinto(completo, tabelleInErrore) });
}
const motivo = (d: Awaited<ReturnType<typeof esito>>) => (d.consentito ? `ok:${d.motivo}` : `no:${d.motivo}`);

async function main() {
  const GARE_STARTER = PIANI.starter.gareIncluse;

  console.log("--- Da dove si consuma la prossima gara (calcolo puro) ---");
  uguale("piano con gare residue", fonteQuotaDisponibile({ piano: { gareIncluse: 3, consumate: 2 }, crediti: 0, gratuite: null }), "piano");
  uguale("piano esaurito, nessun credito", fonteQuotaDisponibile({ piano: { gareIncluse: 3, consumate: 3 }, crediti: 0, gratuite: null }), null);
  uguale("piano esaurito ma un credito", fonteQuotaDisponibile({ piano: { gareIncluse: 3, consumate: 3 }, crediti: 1, gratuite: null }), "credito");
  uguale("nessun piano, un credito", fonteQuotaDisponibile({ piano: null, crediti: 1, gratuite: null }), "credito");
  uguale("nessun piano, gare gratuite residue", fonteQuotaDisponibile({ piano: null, crediti: 0, gratuite: { rimanenti: 1 } }), "gratuita");
  uguale("gare gratuite a zero", fonteQuotaDisponibile({ piano: null, crediti: 0, gratuite: { rimanenti: 0 } }), null);
  uguale("un piano con zero gare incluse non dà diritto", fonteQuotaDisponibile({ piano: { gareIncluse: 0, consumate: 0 }, crediti: 0, gratuite: null }), null);
  uguale("crediti negativi non danno diritto", fonteQuotaDisponibile({ piano: null, crediti: -1, gratuite: null }), null);
  uguale("a zero con il contatore gratuito: invito ad abbonarsi", dirittoDaFonti({ piano: null, crediti: 0, gratuite: { rimanenti: 0 } }), { consentito: false, motivo: "gratuite_esaurite", messaggio: MESSAGGIO_GARA_BLOCCATA_GRATUITE });
  uguale("a zero senza contatore gratuito: crediti o rinnovo", dirittoDaFonti({ piano: { gareIncluse: 3, consumate: 3 }, crediti: 0, gratuite: null }), { consentito: false, motivo: "quota_esaurita", messaggio: MESSAGGIO_GARA_BLOCCATA_QUOTA });
  atteso("i messaggi dicono che chat e caricamento sono disattivati", [MESSAGGIO_GARA_BLOCCATA_QUOTA, MESSAGGIO_GARA_BLOCCATA_GRATUITE].every((m) => /chat con OMNIA AI/.test(m) && /caricamento dei documenti/.test(m) && /disattivati/.test(m)));
  atteso("i messaggi rassicurano: le gare già avviate restano consultabili", [MESSAGGIO_GARA_BLOCCATA_QUOTA, MESSAGGIO_GARA_BLOCCATA_GRATUITE].every((m) => /già avviate restano consultabili/.test(m)));
  atteso("il messaggio per chi è in prova rimanda alla pagina Abbonamento, l'altro a crediti e rinnovo", /«Abbonamento»/.test(MESSAGGIO_GARA_BLOCCATA_GRATUITE) && /crediti/.test(MESSAGGIO_GARA_BLOCCATA_QUOTA) && /rinnovo/.test(MESSAGGIO_GARA_BLOCCATA_QUOTA));

  console.log("--- Gara già pagata: chat e documenti restano aperti, anche a gare finite ---");
  uguale("la gara ha già consumato una gara (registro dei consumi)", motivo(await esito({ gara_consumi: [{ id: "x", gara_id: GARA, user_id: UTENTE, tipo: "gratuita", created_at: ADESSO }] })), "ok:gia_consumata");
  uguale("la gara è già stata analizzata (senza riga nel registro, come nel consumo)", motivo(await esito({ gare: [{ id: GARA, estrazione_stato: "completata", criteri_valutazione: null }] })), "ok:gia_analizzata");
  uguale("la gara ha già i criteri estratti", motivo(await esito({ gare: [{ id: GARA, estrazione_stato: "errore", criteri_valutazione: "Criterio 1…" }] })), "ok:gia_analizzata");
  uguale("il consumo di UN'ALTRA gara non copre questa", motivo(await esito({ gara_consumi: consumi(2, "piano") })), "no:quota_esaurita");

  console.log("--- Piano ---");
  const sub = { subscriptions: [abbonamento()] };
  uguale(`piano Starter con ${GARE_STARTER - 1} gare su ${GARE_STARTER} usate: c'è ancora una gara`, motivo(await esito({ ...sub, gara_consumi: consumi(GARE_STARTER - 1) })), "ok:quota_disponibile");
  uguale(`piano Starter con tutte le ${GARE_STARTER} gare usate: spento`, motivo(await esito({ ...sub, gara_consumi: consumi(GARE_STARTER) })), "no:quota_esaurita");
  uguale("gare di piano consumate PRIMA di questo periodo non contano", motivo(await esito({ ...sub, gara_consumi: consumi(GARE_STARTER, "piano", PRIMA_DEL_PERIODO) })), "ok:quota_disponibile");
  uguale("i consumi da credito non scalano le gare del piano", motivo(await esito({ ...sub, gara_consumi: consumi(GARE_STARTER, "credito") })), "ok:quota_disponibile");
  uguale("piano esaurito ma un credito: aperto", motivo(await esito({ ...sub, gara_consumi: consumi(GARE_STARTER), credits: crediti(1) })), "ok:quota_disponibile");
  uguale("piano esaurito e crediti a zero: spento", motivo(await esito({ ...sub, gara_consumi: consumi(GARE_STARTER), credits: crediti(0) })), "no:quota_esaurita");
  uguale("il nome del piano scritto a mano con maiuscole è riconosciuto (Enterprise ha più gare)", motivo(await esito({ subscriptions: [abbonamento({ plan: " Enterprise " })], gara_consumi: consumi(GARE_STARTER) })), "ok:quota_disponibile");
  uguale("un piano sconosciuto vale zero gare incluse", motivo(await esito({ subscriptions: [abbonamento({ plan: "boh" })] })), "no:quota_esaurita");
  uguale("un piano sconosciuto con un credito: aperto", motivo(await esito({ subscriptions: [abbonamento({ plan: "boh" })], credits: crediti(2) })), "ok:quota_disponibile");
  uguale("abbonamento con il periodo già finito: le gare incluse non contano", motivo(await esito({ subscriptions: [abbonamento({ current_period_end: PASSATO })] })), "no:quota_esaurita");
  uguale("abbonamento senza fine periodo (creato a mano): vale", motivo(await esito({ subscriptions: [abbonamento({ current_period_end: null })] })), "ok:quota_disponibile");
  uguale("senza current_period_start si parte da created_at", motivo(await esito({ subscriptions: [abbonamento({ current_period_start: null })], gara_consumi: consumi(GARE_STARTER, "piano", PRIMA_DEL_PERIODO) })), "ok:quota_disponibile");
  uguale("i consumi di un altro cliente non si contano", motivo(await esito({ ...sub, gara_consumi: consumi(GARE_STARTER).map((r) => ({ ...r, user_id: "altro" })) })), "ok:quota_disponibile");

  console.log("--- Gare gratuite (cliente mai abbonato) ---");
  uguale("2 gare gratuite assegnate, 1 usata: aperto", motivo(await esito({ omnia_ai_gare_gratuite: gratuite(2, 1) })), "ok:quota_disponibile");
  const finite = await esito({ omnia_ai_gare_gratuite: gratuite(2, 2) });
  uguale("2 gare gratuite assegnate, 2 usate: spento, con l'invito ad abbonarsi", [motivo(finite), finite.consentito ? "" : finite.messaggio], ["no:gratuite_esaurite", MESSAGGIO_GARA_BLOCCATA_GRATUITE]);
  uguale("gare gratuite finite ma un credito: aperto", motivo(await esito({ omnia_ai_gare_gratuite: gratuite(2, 2), credits: crediti(1) })), "ok:quota_disponibile");
  uguale("chi ha già avuto un abbonamento non usa le gare gratuite, anche se il contatore ne ha", motivo(await esito({ subscriptions: [abbonamento({ status: "scaduto" })], omnia_ai_gare_gratuite: gratuite(5, 0) })), "no:quota_esaurita");
  uguale("nessun abbonamento e nessun contatore: spento", motivo(await esito({})), "no:quota_esaurita");
  uguale("la gara già consumata resta aperta anche a gare gratuite finite", motivo(await esito({ omnia_ai_gare_gratuite: gratuite(1, 1), gara_consumi: [{ id: "x", gara_id: GARA, user_id: UTENTE, tipo: "gratuita", created_at: ADESSO }] })), "ok:gia_consumata");

  console.log("--- Un guasto nella lettura non blocca per sbaglio né concede per sbaglio ---");
  // la lettura delle gare gratuite scrive l'errore nel registro del server: qui è atteso, si tace
  const erroreOriginale = console.error;
  console.error = () => {};
  try {
    for (const tabella of ["gara_consumi", "gare", "subscriptions", "credits", "omnia_ai_gare_gratuite"]) {
      const d = await esito({ subscriptions: [], omnia_ai_gare_gratuite: gratuite(3, 0) }, [tabella]);
      uguale(`lettura di «${tabella}» in errore: né sì né no, «riprova tra poco»`, [motivo(d), d.consentito ? "" : d.messaggio], ["no:verifica_non_riuscita", MESSAGGIO_VERIFICA_GARE_NON_RIUSCITA]);
    }
  } finally {
    console.error = erroreOriginale;
  }
  // il guasto sul registro dei consumi non fa passare nemmeno chi avrebbe gare residue: «riprova», mai «aperto»
  uguale("guasto sul registro: non concede nemmeno a chi avrebbe gare residue", motivo(await esito({ ...sub }, ["gara_consumi"])), "no:verifica_non_riuscita");

  console.log("--- La lettura non scrive nulla e rispecchia il consumo vero ---");
  const diritto = leggi("src/lib/gara-diritto.ts");
  const consumo = leggi("src/lib/gara-consumo.ts");
  atteso("gara-diritto.ts non scrive mai (nessun insert/update/delete/upsert/rpc) e non crea notifiche", !/\.(insert|update|delete|upsert|rpc)\(/.test(diritto) && !/creaNotifica/.test(diritto));
  for (const regola of [
    '.eq("status", "attivo")',
    '.eq("tipo", "piano")',
    '.gte("created_at", inizioPeriodo)',
    // il piano si riconosce e le gare incluse si decidono (piano o offerta pilot) in un solo punto, usato da entrambi
    "gareInclusePerAbbonamento({ userId, piano: subscription.plan, stripeSubscriptionId: subscription.stripe_subscription_id",
    'from("credits")',
    "(abbonamentiAvuti ?? 0) === 0",
    "subscription.current_period_start ?? subscription.created_at",
    "new Date(subscription.current_period_end).getTime() > Date.now()",
  ]) {
    atteso(`stessa regola nel consumo e nel controllo: ${regola}`, consumo.includes(regola) && diritto.includes(regola), "manca in uno dei due file");
  }
  atteso("il consumo vero resta in gara-consumo.ts (la gara si consuma ancora all'avvio dell'analisi)", /consumeGaraQuotaIfNeeded\(\{ garaId, userId: contesto\.accountId \}\)/.test(leggi("src/app/actions/gara-extraction.ts")));

  console.log("--- Il blocco sta prima di ogni scrittura e di ogni chiamata al modello ---");
  const chat = leggi("src/app/actions/gara-chat.ts");
  const invio = corpo(chat, "export async function sendGaraMessage");
  atteso("chat: il controllo c'è e rifiuta con il suo messaggio", /const diritto = await dirittoGaraPerAccount\(\{ contesto, user, garaId \}\);\n\s*if \(!diritto\.consentito\) return \{ error: diritto\.messaggio \};/.test(invio));
  atteso("chat: dopo la verifica che la gara sia del cliente", primaDi(invio, 'if (!gara) return { error: "Gara non trovata." };', "dirittoGaraPerAccount("));
  atteso("chat: prima di salvare qualsiasi messaggio", primaDi(invio, "dirittoGaraPerAccount(", 'from("gara_messaggi")'));
  atteso("chat: prima del caricamento degli allegati", primaDi(invio, "dirittoGaraPerAccount(", "admin.storage"));
  atteso("chat: prima della ricerca nei documenti e di ogni chiamata al modello", primaDi(invio, "dirittoGaraPerAccount(", "embedQuery(") && primaDi(invio, "dirittoGaraPerAccount(", "createAnthropicClient()"));
  atteso("chat: l'accesso in scrittura (sola lettura/cessato) resta controllato prima", primaDi(invio, "accessoNegatoPerAccount(", "dirittoGaraPerAccount("));
  const gare = leggi("src/app/actions/gare.ts");
  const carica = corpo(gare, "export async function uploadGaraDocumento", "export async function removeGaraDocumento");
  atteso("documenti: il controllo c'è e rifiuta con il suo messaggio", /const diritto = await dirittoGaraPerAccount\(\{ contesto, user, garaId \}\);\n\s*if \(!diritto\.consentito\) return \{ error: diritto\.messaggio \};/.test(carica));
  atteso("documenti: dopo la verifica che la gara sia del cliente", primaDi(carica, 'if (!gara) return { error: "Gara non trovata." };', "dirittoGaraPerAccount("));
  atteso("documenti: prima di toccare lo storage", primaDi(carica, "dirittoGaraPerAccount(", "admin.storage"));
  atteso("documenti: prima di registrare il documento e prima dell'indicizzazione", primaDi(carica, "dirittoGaraPerAccount(", 'from("gara_documenti")') && primaDi(carica, "dirittoGaraPerAccount(", "indexGaraDocumento("));
  atteso("l'indicizzazione dei documenti parte solo dal caricamento (nessun altro punto la richiama)", !fs
    .readdirSync(path.join(__dirname, "..", "src/app/actions"))
    .filter((f) => f !== "gare.ts")
    .some((f) => /indexGaraDocumento\(/.test(leggi(`src/app/actions/${f}`))));
  atteso("l'assistente di supporto (abbonamento, crediti, fatture) resta acceso: serve proprio a chi deve acquistare", !/gara-diritto/.test(leggi("src/app/actions/assistenza-chat.ts")));

  console.log("--- La vista ---");
  const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
  atteso("la pagina della gara calcola il diritto con lo stesso controllo delle azioni", /await dirittoGaraPerAccount\(\{ contesto, user, garaId: gara\.id \}\)/.test(pagina));
  atteso("a chat spenta la pagina mostra un solo avviso in alto", /\{!diritto\.consentito && \(\s*<GaraBloccataAvviso/.test(pagina) && /messaggio=\{diritto\.messaggio\}/.test(pagina) && /motivo=\{diritto\.motivo\}/.test(pagina));
  atteso("il modulo di caricamento documenti non si mostra se spento", /\{diritto\.consentito \? \(\s*<UploadDocumentoForm garaId=\{gara\.id\} \/>/.test(pagina));
  atteso("alla chat arriva spenta={!diritto.consentito}", /spenta=\{!diritto\.consentito\}/.test(pagina));
  const sezioneChat = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/chat-section.tsx");
  atteso("la chat spenta non mostra il modulo di invio (né il pulsante né l'allegato)", /\{!spenta && <form ref=\{formRef\}/.test(sezioneChat));
  atteso("la chat spenta lo dice con un'etichetta «Disattivata» e lascia leggere i messaggi già scambiati", /\{spenta && \(\s*<span className="omnia-badge ambra"[^>]*>\s*Disattivata/.test(sezioneChat) && /\(!spenta \|\| messaggi\.length > 0\) && <div ref=\{scrollRef\}/.test(sezioneChat));
  const avviso = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/gara-bloccata-avviso.tsx");
  atteso("l'avviso porta alla pagina Abbonamento (gare gratuite) o al confronto crediti/piani", /motivo === "gratuite_esaurite"/.test(avviso) && /\/dashboard\/omnia-ai\/abbonamento/.test(avviso) && /motivo === "quota_esaurita" && <QuotaEsauritaConfronto/.test(avviso));
  atteso("l'avviso non offre nessun pulsante se la verifica non è riuscita", !/verifica_non_riuscita/.test(avviso.slice(avviso.indexOf("motivo ==="))));
  atteso("l'area cliente non rimanda alla console", ![diritto, avviso, pagina, sezioneChat, leggi("src/lib/gara-diritto-calcoli.ts")].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
