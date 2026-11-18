// Verifica della fase B3, interfaccia di Tender Intelligence (18/11/2026): i 10 requisiti della ricerca, la scheda, Monitorate, la lettura
// delle classificazioni solo lato server e nella stessa richiesta, il contratto del Radar personalizzato. Solo dati SINTETICI, in memoria:
// nessun database, nessuna rete.
import "./lib/senza-cache-next";
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cercaGare } from "../src/lib/radar/ricerca";
import { filtriDaParametri } from "../src/lib/radar/ricerca-calcoli";
import { CLASSIFICAZIONI_ELENCO, CLASSIFICAZIONI_SCHEDA, classificazioneDaRiga, messaggioStato, rilevanzaPerRicerca } from "../src/lib/radar/classificazioni-lettura";
import { COLONNE_RISULTATO, colonneElenco, conRilevanza } from "../src/lib/radar/ricerca";
import {
  analizzaDomanda,
  coerenteConFiltroSettori,
  etichettaRicerca,
  etichettaStatoClassificazione,
  fasciaRilevanza,
  ordinaCandidati,
  punteggioRilevanza,
  settoriDellaRiga,
  type CandidatoRicerca,
} from "../src/lib/radar/ricerca-calcoli";
import { daNotificare, gareDaRivalutare, opportunitaPerImpresa, type GaraPerRadar, type ProfiloRadar } from "../src/lib/radar/radar-personalizzato-contratto";
import { nomeSottocategoria } from "../src/lib/radar/settori";

const RADICE = path.resolve(__dirname, "..");
const leggi = (p: string) => fs.readFileSync(path.join(RADICE, p), "utf8");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const uguale = (nome: string, a: unknown, b: unknown) => atteso(nome, JSON.stringify(a) === JSON.stringify(b), `atteso ${JSON.stringify(b)}, ottenuto ${JSON.stringify(a)}`);

// ───── gare sintetiche, come arrivano dalla richiesta con le colonne incorporate ─────
type Riga = CandidatoRicerca & Parameters<typeof conRilevanza>[0];
const base = { oggetto_breve: null, sa_denominazione: "Comune sintetico", metodo_settore: "cpv", scadenza_offerte: null, valore_stimato: 100000, rettificata: false };
const riga = (id: string, o: Partial<Riga> & { stato?: "classificata" | "in_attesa" | "fallita" | null; righe?: { settore: string; rilevanza: "A" | "B" | "C"; sottocategorie?: string[] }[] }): CandidatoRicerca => {
  const { stato, righe, ...resto } = o;
  return conRilevanza({
    ...base,
    id,
    oggetto: `Servizio sintetico ${id}`,
    settori: (righe ?? []).filter((r) => r.rilevanza !== "C").map((r) => r.settore),
    scadenza_giorno: "2026-12-20",
    data_pubblicazione: "2026-11-10",
    ...resto,
    classificazione_stato: stato === null || stato === undefined ? null : { stato, versione_regole: "2026-11-18e", errore: stato === "fallita" ? "errore sintetico" : null },
    classificazioni: (righe ?? []).map((r) => ({ settore: r.settore, rilevanza: r.rilevanza, sottocategorie: r.sottocategorie ?? [], attiva: true })),
  } as Riga);
};
const gA = riga("A", { stato: "classificata", righe: [{ settore: "pulizia", rilevanza: "A", sottocategorie: ["pulizia_uffici"] }], data_pubblicazione: "2026-11-01", scadenza_giorno: "2026-12-30" });
const gB = riga("B", { stato: "classificata", righe: [{ settore: "pulizia", rilevanza: "B" }], data_pubblicazione: "2026-11-15", scadenza_giorno: "2026-12-05" });
const gC = riga("C", { stato: "classificata", righe: [{ settore: "pulizia", rilevanza: "C" }], data_pubblicazione: "2026-11-16", scadenza_giorno: "2026-12-01" });
const gMulti = riga("M", { stato: "classificata", righe: [{ settore: "ristorazione", rilevanza: "A", sottocategorie: ["concessione_bar", "concessione_ristorante", "punto_ristoro"] }, { settore: "pulizia", rilevanza: "B" }, { settore: "vigilanza_portierato", rilevanza: "C" }] });
const gAttesa = riga("W", { stato: "in_attesa", righe: [{ settore: "pulizia", rilevanza: "A" }] });
const gFallita = riga("F", { stato: "fallita", righe: [] });
const gSenzaStato = riga("N", { stato: null, settori: ["pulizia"] });
const gSenzaRighe = riga("V", { stato: "classificata", righe: [] });
const tutte = [gA, gB, gC, gMulti, gAttesa, gFallita, gSenzaStato, gSenzaRighe];
const adesso = new Date("2026-11-18T10:00:00Z");
const domanda = analizzaDomanda("");
const conPunti = (filtri: Parameters<typeof punteggioRilevanza>[2]) => tutte.map((c) => ({ ...c, punteggio: punteggioRilevanza(c, domanda, filtri, adesso) }));
const filtriBase = { q: "", settori: [] as never[], regioni: [], importoMin: null, importoMax: null, scadenzaEntroGiorni: null, pubblicataNegliUltimiGiorni: null, procedure: [], stato: "aperte" as const, ordina: "rilevanza" as const, pagina: 1 };
const filtriPulizia = { ...filtriBase, settori: ["pulizia"] as never[] };

// R1 — le gare A si mostrano, senza etichetta di «correlata» o «fuori»
uguale("R1. una gara pertinente (A) non ha etichette di rilevanza e conta come pertinente", [etichettaRicerca(gA, filtriPulizia), punteggioRilevanza(gA, domanda, filtriPulizia, adesso).motivi.includes("pertinente al settore")], [null, true]);

// R2 — B distinte e dopo le A nella rilevanza settoriale
const ordinePulizia = ordinaCandidati(conPunti(filtriPulizia).filter((c) => coerenteConFiltroSettori(c, filtriPulizia)), "rilevanza", filtriPulizia).map((c) => c.id);
atteso("R2. per rilevanza con il filtro pulizia: la correlata B viene dopo la pertinente A", ordinePulizia.indexOf("A") < ordinePulizia.indexOf("B"), ordinePulizia.join(","));
uguale("R2. la correlata ha l'etichetta «Correlata…» e la fascia 1 (titoletto «Gare correlate»)", [etichettaRicerca(gB, filtriPulizia), fasciaRilevanza(gB, filtriPulizia)], ["Correlata: appalto misto o servizio accessorio", 1]);

// R3 — C solo nella ricerca generale, mai come pertinenti
atteso("R3. con il filtro del settore la gara C non passa il controllo di coerenza (e la colonna non la contiene)", !coerenteConFiltroSettori(gC, filtriPulizia) && !gC.settori.includes("pulizia"));
uguale("R3. nella ricerca generale la C resta, con «Fuori dai settori monitorati» e la fascia 2, senza punti di settore", [coerenteConFiltroSettori(gC, filtriBase), etichettaRicerca(gC, filtriBase), fasciaRilevanza(gC, filtriBase), punteggioRilevanza(gC, domanda, filtriBase, adesso).motivi.some((m) => /settore/.test(m))], [true, "Fuori dai settori monitorati", 2, false]);
const ordineGenerale = ordinaCandidati(conPunti(filtriBase), "rilevanza", filtriBase).map((c) => c.id);
atteso("R3. nella ricerca generale per rilevanza la C viene dopo tutte le altre", ordineGenerale[ordineGenerale.length - 1] === "C" || ordineGenerale.indexOf("C") > ordineGenerale.indexOf("A"), ordineGenerale.join(","));

// R4 — non pertinente, in attesa, fallita e non classificata distinti; senza righe mai C
uguale(
  "R4. stati distinti: in attesa «Classificazione in corso», fallita «Classificazione da verificare», senza stato «Non ancora classificata»",
  [etichettaStatoClassificazione(gAttesa), etichettaRicerca(gFallita, filtriBase), etichettaStatoClassificazione(gSenzaStato), etichettaStatoClassificazione(gA)],
  ["Classificazione in corso", "Classificazione da verificare", "Non ancora classificata", null],
);
uguale("R4. una gara classificata SENZA righe non è mai «fuori dai settori» (né C)", [etichettaRicerca(gSenzaRighe, filtriBase), fasciaRilevanza(gSenzaRighe, filtriBase)], [null, 0]);
uguale("R4. senza stato: «non_classificata», nessun settore dalla classificazione, messaggio della scheda che non dice «non pertinente»", [classificazioneDaRiga({ classificazione_stato: null, classificazioni: [{ settore: "pulizia", rilevanza: "C", sottocategorie: [], attiva: true }] }).stato, classificazioneDaRiga({ classificazione_stato: null, classificazioni: [] }).settori.length, /non pertinente/i.test(messaggioStato({ stato: "non_classificata", errore: null }) ?? "")], ["non_classificata", 0, false]);
atteso("R4. in attesa e non classificate restano nel filtro del settore (non sono C)", coerenteConFiltroSettori(gAttesa, filtriPulizia) && coerenteConFiltroSettori(gSenzaStato, filtriPulizia));

// R5 — filtri per settore rispettati
uguale("R5. filtro pulizia: passano A, B, in attesa e non classificate; non passa la C", tutte.filter((c) => coerenteConFiltroSettori(c, filtriPulizia)).map((c) => c.id), ["A", "B", "M", "W", "F", "N", "V"]);
atteso("R5. la ricerca filtra sulla colonna «settori» (coerente con le righe A/B, verificato sullo staging il 18/11) e poi controlla la coerenza", /if \(filtri\.settori\.length\) q = q\.overlaps\("settori", filtri\.settori\)/.test(leggi("src/lib/radar/ricerca.ts")) && leggi("src/lib/radar/ricerca.ts").includes("letti.filter((r) => coerenteConFiltroSettori(r, filtri))"));

// R6 — multisettore
uguale("R6. multisettore: prima i pertinenti poi i correlati, i C non si mostrano", settoriDellaRiga(gMulti).map((s) => `${s.settore}:${s.livello}`), ["ristorazione:A", "pulizia:B"]);
atteso("R6. multisettore con filtro su un settore correlato: «Correlata»; su quello pertinente: nessuna etichetta", etichettaRicerca(gMulti, { settori: ["pulizia"] }) === "Correlata: appalto misto o servizio accessorio" && etichettaRicerca(gMulti, { settori: ["ristorazione"] }) === null);

// R7 — sottocategorie
const cMulti = classificazioneDaRiga({ classificazione_stato: { stato: "classificata", versione_regole: "2026-11-18e" }, classificazioni: [{ settore: "ristorazione", rilevanza: "A", sottocategorie: ["sconosciuta_sintetica"], attiva: true }, { settore: "pulizia", rilevanza: "C", sottocategorie: [], attiva: true }] });
uguale("R7. sottocategorie: nome leggibile (anche per un identificativo sconosciuto), nessuna per i settori C", [cMulti.settori[0].sottocategorie[0].nome, cMulti.settori[1].sottocategorie.length], ["sconosciuta sintetica", 0]);
atteso("R7. la riga mostra le sottocategorie dei settori A e B", settoriDellaRiga(gA)[0].sottocategorie.length === 1 && leggi("src/components/omnia-ai/opportunita/riga-gara.tsx").includes("settoreLeggibile(s)"));
uguale("R7. le righe non attive non contano", classificazioneDaRiga({ classificazione_stato: { stato: "classificata" }, classificazioni: [{ settore: "pulizia", rilevanza: "A", sottocategorie: [], attiva: false }] }).settori.length, 0);

// R8 — nessun doppione multifonte
const ric = leggi("src/lib/radar/ricerca.ts");
atteso("R8. la ricerca esclude le copie collegate (.is(\"unita_a\", null)) e le gare con sole fonti nascoste", ric.includes('.is("unita_a", null)') && ric.includes('.overlaps("fonti", visibili)'));
atteso("R8. la scheda di una copia collegata porta alla gara che resta; Monitorate una riga per gara mostrata", /if \(g\.unita_a\) redirect\(/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx")) && /unoPerGaraMostrata\(salvate,/.test(leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/monitorate/page.tsx")));

// R9 — CIG, scadenze, lotti, salvate e monitorate invariati
atteso("R9. la ricerca per CIG legge ancora i lotti e porta alla gara che resta", ric.includes('admin.from("radar_lotti").select("procedura_id").eq("cig", domanda.cig)') && ric.includes("collegate?.find((c) => c.id === id)?.unita_a ?? id"));
atteso("R9. le colonne dell'elenco con le classificazioni SPENTE sono esattamente quelle di prima", colonneElenco(false) === COLONNE_RISULTATO);
atteso("R9. scadenze, lotti, salvate e monitorate restano nelle colonne e nelle pagine", COLONNE_RISULTATO.includes("scadenza_giorno") && COLONNE_RISULTATO.includes("n_lotti") && leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/cerca/page.tsx").includes("monitorata: !!s?.monitorata"));

// R10 — ordinamenti cronologici non alterati dalla classificazione
const senzaClassificazione = tutte.map((c) => ({ ...c, rilevanza: undefined }));
for (const ordina of ["recenti", "scadenza", "importo"] as const) {
  const con = ordinaCandidati(conPunti(filtriBase), ordina, filtriBase).map((c) => c.id);
  const senza = ordinaCandidati(senzaClassificazione.map((c) => ({ ...c, punteggio: punteggioRilevanza(c, domanda, filtriBase, adesso) })), ordina, filtriBase).map((c) => c.id);
  uguale(`R10. ordinamento «${ordina}» identico con e senza classificazione`, con, senza);
}

// ───── lettura delle classificazioni: solo server, solo con l'interruttore, nella stessa richiesta ─────
atteso("L1. con l'interruttore acceso la ricerca chiede stato e righe nella STESSA richiesta, e solo righe attive", colonneElenco(true).startsWith(COLONNE_RISULTATO) && colonneElenco(true).includes(CLASSIFICAZIONI_ELENCO) && ric.includes("if (conClassificazioni) q = q.eq(COLONNA_RIGHE_ATTIVE, true)"));
atteso("L2. la ricerca non usa più le letture separate per blocchi (leggiRilevanze)", !ric.includes("leggiRilevanze("));
atteso("L3. tabelle non leggibili: la ricerca e la scheda tornano come prima", ric.includes("({ data, error } = await interroga(false))") && leggi("src/lib/radar/gara.ts").includes("({ data: letta, error } = await leggi(false))"));
const gara = leggi("src/lib/radar/gara.ts");
atteso("L4. la scheda legge le classificazioni nella stessa richiesta della gara, solo se accese", gara.includes("select(`${COLONNE_GARA}, ${CLASSIFICAZIONI_SCHEDA}`)") && gara.includes("let conClassificazioni = opzioni.classificazioni === true"));
atteso("L5. le tre pagine passano l'interruttore dall'ambiente (classificazioniAttive, spento di base e solo sullo staging)", ["cerca/page.tsx", "gara/[id]/page.tsx", "monitorate/page.tsx"].every((p) => leggi(`src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/${p}`).includes("classificazioniAttive(process.env)")));
const daCliente: string[] = [];
const cartella = (d: string) => {
  for (const f of fs.readdirSync(path.join(RADICE, d), { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) cartella(p);
    else if (/\.(tsx?|jsx?)$/.test(f.name)) {
      const t = leggi(p);
      if (/^["']use client["']/m.test(t) && /classificazioni-lettura|radar-personalizzato-contratto|lib\/radar\/ricerca"|lib\/radar\/gara"/.test(t)) daCliente.push(p);
    }
  }
};
cartella("src");
atteso("L6. nessun componente del browser («use client») importa la lettura delle classificazioni, la ricerca o la scheda", daCliente.length === 0, daCliente.join(", "));
atteso("L7. le colonne della scheda includono motivi, regole e versione; quelle dell'elenco solo livello e sottocategorie", CLASSIFICAZIONI_SCHEDA.includes("motivi") && CLASSIFICAZIONI_SCHEDA.includes("versione_regole") && !CLASSIFICAZIONI_ELENCO.includes("motivi"));
const pagine = ["cerca/page.tsx", "gara/[id]/page.tsx", "monitorate/page.tsx"].map((p) => leggi(`src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/${p}`)).join("\n") + leggi("src/components/omnia-ai/opportunita/classificazione-gara.tsx") + leggi("src/components/omnia-ai/opportunita/riga-gara.tsx");
atteso("L8. nessuna interrogazione periodica nuova (setInterval, setTimeout, router.refresh) nelle pagine e nei componenti toccati", !/setInterval|setTimeout|router\.refresh|revalidate\s*=/.test(pagine));
uguale("L9. rilevanzaPerRicerca: livello per settore e sottocategorie (nome leggibile) dei soli A e B", rilevanzaPerRicerca(classificazioneDaRiga({ classificazione_stato: { stato: "classificata" }, classificazioni: [{ settore: "pulizia", rilevanza: "A", sottocategorie: ["sanificazione"], attiva: true }, { settore: "ristorazione", rilevanza: "C", sottocategorie: [], attiva: true }] })), { stato: "classificata", perSettore: { pulizia: "A", ristorazione: "C" }, sottocategorie: { pulizia: [nomeSottocategoria("pulizia", "sanificazione")] } });

// ───── comportamento: un client finto registra le richieste della ricerca vera (nessuna rete) ─────
type Chiamata = { tabella: string; passi: { metodo: string; argomenti: unknown[] }[] };
function clienteFinto(chiamate: Chiamata[]): SupabaseClient {
  const costruttore = (c: Chiamata): unknown =>
    new Proxy(
      {},
      {
        get(_t, nome: string) {
          if (nome === "then") return (risolvi: (v: unknown) => void) => risolvi({ data: [], error: null });
          return (...argomenti: unknown[]) => {
            c.passi.push({ metodo: nome, argomenti });
            return costruttore(c);
          };
        },
      },
    );
  return {
    from(tabella: string) {
      const c: Chiamata = { tabella, passi: [] };
      chiamate.push(c);
      return costruttore(c);
    },
  } as unknown as SupabaseClient;
}
async function richiesteDellaRicerca(accese: boolean, parametri: Record<string, string> = {}): Promise<Chiamata[]> {
  const chiamate: Chiamata[] = [];
  await cercaGare(clienteFinto(chiamate), filtriDaParametri(parametri), adesso, { classificazioni: accese });
  return chiamate;
}
async function provaComportamento() {
  for (const [nome, parametri] of [["senza filtri", {}], ["con il filtro pulizia", { settore: "pulizia" }]] as const) {
    const spente = await richiesteDellaRicerca(false, parametri);
    const accese = await richiesteDellaRicerca(true, parametri);
    const select = (c: Chiamata[]) => String(c[0]?.passi.find((p) => p.metodo === "select")?.argomenti[0] ?? "");
    const filtroRighe = (c: Chiamata[]) => c[0]?.passi.some((p) => p.metodo === "eq" && p.argomenti[0] === "classificazioni.attiva") ?? false;
    uguale(`C1. ${nome}: UNA sola richiesta (radar_procedure) con l'interruttore spento e acceso`, [spente.map((c) => c.tabella), accese.map((c) => c.tabella)], [["radar_procedure"], ["radar_procedure"]]);
    atteso(`C2. ${nome}, spento: nessun incorporamento di radar_classificazioni né filtro sulle righe attive`, !select(spente).includes("radar_classificazioni") && !filtroRighe(spente) && select(spente) === COLONNE_RISULTATO);
    atteso(`C3. ${nome}, acceso: stato e righe incorporati e filtro sulle sole righe attive, nella stessa richiesta`, select(accese).includes("radar_classificazioni_stato") && select(accese).includes("radar_classificazioni(") && filtroRighe(accese));
    atteso(`C4. ${nome}: copie collegate escluse in entrambi i casi`, [spente, accese].every((c) => c[0]?.passi.some((p) => p.metodo === "is" && p.argomenti[0] === "unita_a" && p.argomenti[1] === null)));
  }
}

// ───── script del collaudo con accesso: SOLO prove a secco (porta e fetch finti, nessuna rete esterna, nessuno staging) ─────
async function provaCollaudo() {
  const ca = await import("./collaudo-accesso-b3.mjs");
  const { createServerClient } = await import("@supabase/ssr");
  const http = await import("node:http");
  const os = await import("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "b3-collaudo-"));
  const progetto = path.join(tmp, "progetto");
  fs.mkdirSync(path.join(progetto, "scripts"), { recursive: true });
  const variabiliValide = ["NEXT_PUBLIC_SUPABASE_URL=https://ryawdldqiumqsskrnyps.supabase.co", "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_SINTETICA", "SUPABASE_SERVICE_ROLE_KEY=sb_secret_SINTETICA_DA_NON_STAMPARE"].join("\n");
  const fileFuori = path.join(tmp, "variabili.txt");
  fs.writeFileSync(fileFuori, variabiliValide);
  const fileDentro = path.join(progetto, "variabili.txt");
  fs.writeFileSync(fileDentro, variabiliValide);
  const fileProd = path.join(tmp, "variabili-prod.txt");
  fs.writeFileSync(fileProd, variabiliValide.replace("ryawdldqiumqsskrnyps", "bihfrzspqxsrzlbqqvqa"));
  const COOKIE: string = ca.COOKIE_SESSIONE;
  // Token d'accesso lungo apposta: la libreria divide il cookie in due parti (.0 e .1), come succede con i token veri.
  const ACCESSO = `ACCESSO_SINTETICO_${"x".repeat(3000)}`;
  const chiamate: { url: string; metodo: string; corpo: string }[] = [];
  let verificaFallisce = false;
  const json = { "Content-Type": "application/json" };
  const fetchFinto = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    chiamate.push({ url: u, metodo: init?.method ?? "GET", corpo: String(init?.body ?? "") });
    if (u === "https://ryawdldqiumqsskrnyps.supabase.co/auth/v1/admin/generate_link") return new Response(JSON.stringify({ hashed_token: `TOKEN_SINTETICO_${chiamate.length}` }), { status: 200, headers: json });
    if (u === "https://ryawdldqiumqsskrnyps.supabase.co/auth/v1/verify") {
      if (verificaFallisce) return new Response(JSON.stringify({ code: 403, error_code: "otp_expired", msg: "scaduto" }), { status: 403, headers: json });
      const utente = { id: "00000000-0000-4000-8000-0000000000aa", aud: "authenticated", role: "authenticated", email: "sintetico@prova.test", app_metadata: {}, user_metadata: {} };
      return new Response(JSON.stringify({ access_token: ACCESSO, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "RINNOVO_SINTETICO", user: utente }), { status: 200, headers: json });
    }
    return new Response("{}", { status: 404, headers: json });
  }) as unknown as typeof fetch;
  const portaOk = () => ({ id: "AUT-SINTETICA", uso: "U1" });
  const ferma = async (nome: string, argv: string[], opzioni: Record<string, unknown>) => {
    const prima = chiamate.length;
    let fermato = "";
    try {
      await ca.collaudo(argv, {}, { cartella: progetto, fetchFn: fetchFinto, portaAccesso: 0, ...opzioni });
    } catch (e) {
      fermato = e instanceof ca.Fermo ? e.message : `errore inatteso: ${e}`;
    }
    atteso(nome, fermato !== "" && !fermato.startsWith("errore inatteso") && chiamate.length === prima && !/SINTETICA_DA_NON_STAMPARE|bihfrzspqxsrzlbqqvqa\.supabase/.test(fermato), fermato || "non si è fermato");
  };
  // una richiesta con un Host scelto (DNS rebinding): fetch non lo permette, node:http sì
  const conHost = (porta: number, percorso: string, host: string) =>
    new Promise<number>((risolvi, rifiuta) => {
      const r = http.request({ host: "localhost", port: porta, path: percorso, method: "GET", headers: { Host: host } }, (res) => {
        res.resume();
        risolvi(res.statusCode ?? 0);
      });
      r.on("error", rifiuta);
      r.end();
    });
  try {
    await ferma("CA1. senza il lanciatore delle autorizzazioni (TI_REGISTRO assente) si ferma prima di qualunque rete", [fileFuori, "3110"], {});
    await ferma("CA2. porta che nega l'esecuzione → fermo, nessuna rete", [fileFuori, "3110"], { controllaPorta: () => { throw new Error("autorizzazione inesistente"); } });
    await ferma("CA3. file delle variabili dentro il progetto → fermo", [fileDentro, "3110"], { controllaPorta: portaOk, avvia: async () => 0 });
    await ferma("CA4. variabili di produzione → fermo, i messaggi non riportano valori", [fileProd, "3110"], { controllaPorta: portaOk, avvia: async () => 0 });
    await ferma("CA5. lanciatore dell'anteprima mancante → fermo prima di avviare qualunque server", [fileFuori, "3110"], { controllaPorta: portaOk });

    // giro completo a secco: il «browser» chiede /pronto, prova le strade sbagliate, poi preme i pulsanti
    const stampato: string[] = [];
    const logOriginale = console.log;
    console.log = (...a: unknown[]) => stampato.push(a.map(String).join(" "));
    const esiti: Record<string, unknown> = {};
    let portaUsata = 0;
    let codice: number | null = null;
    try {
      codice = await ca.collaudo([fileFuori, "3110"], {}, {
        cartella: progetto,
        fetchFn: fetchFinto,
        controllaPorta: portaOk,
        portaAccesso: 0,
        avvia: async ({ portaAccesso }: { portaAccesso: number }) => {
          portaUsata = portaAccesso;
          const base = `http://localhost:${portaAccesso}`;
          esiti.chiamateAllAvvio = chiamate.length;
          const pronto = await fetch(`${base}/pronto`);
          const html = await pronto.text();
          esiti.pronto = { stato: pronto.status, cache: pronto.headers.get("cache-control"), referrer: pronto.headers.get("referrer-policy"), cornici: pronto.headers.get("x-frame-options"), csp: pronto.headers.get("content-security-policy") ?? "", html };
          const via = (html.match(/name="via" value="([^"]+)"/) ?? [])[1] ?? "";
          const invia = (p: string, campi: Record<string, string>, extra: Record<string, string> = {}) =>
            fetch(`${base}${p}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, ...extra }, body: new URLSearchParams(campi).toString() });
          esiti.strade = [
            (await fetch(`${base}/accesso/ti-titolare`, { redirect: "manual" })).status,
            (await invia("/accesso/ti-titolare", {})).status,
            (await invia("/accesso/ti-titolare", { via: "codice-sbagliato" })).status,
            (await invia("/accesso/ti-titolare", { via }, { Origin: "http://altro-sito.test" })).status,
            (await invia("/accesso/ti-titolare", { via }, { Origin: "null" })).status,
            await conHost(portaAccesso, "/pronto", "altro-sito.test"),
            await conHost(portaAccesso, "/accesso/ti-titolare", `127.0.0.1:${portaAccesso}`),
          ];
          esiti.chiamatePrimaDelVia = chiamate.length;
          const titolare = await invia("/accesso/ti-titolare", { via }, { Cookie: `${COOKIE}=vecchio-non-diviso; altro=1` });
          esiti.titolare = { stato: titolare.status, location: titolare.headers.get("location") ?? "", cache: titolare.headers.get("cache-control"), referrer: titolare.headers.get("referrer-policy"), cookie: titolare.headers.getSetCookie() };
          esiti.chiamateTitolare = chiamate.slice(esiti.chiamatePrimaDelVia as number);
          const ripetuto = await invia("/accesso/ti-titolare", { via });
          esiti.ripetuto = [ripetuto.status, chiamate.length];
          const admin = await invia("/accesso/ti-admin", { via });
          esiti.admin = [admin.status, admin.headers.get("location") ?? ""];
          verificaFallisce = true;
          const fallito = await invia("/accesso/ti-titolare2", { via });
          esiti.fallito = [fallito.status, fallito.headers.getSetCookie().length, (await invia("/accesso/ti-titolare2", { via })).status];
          esiti.ignoto = (await invia("/accesso/qualcuno", { via })).status;
          esiti.prontoDopo = await (await fetch(`${base}/pronto`)).text();
          return 0;
        },
      });
    } finally {
      console.log = logOriginale;
      verificaFallisce = false;
    }
    const pronto = esiti.pronto as { stato: number; cache: string; referrer: string; cornici: string; csp: string; html: string };
    uguale("CA6. all'avvio NESSUN collegamento: zero chiamate allo staging finché non si preme un pulsante (anche con GET, codice, origine o host sbagliati)", [esiti.chiamateAllAvvio, esiti.chiamatePrimaDelVia], [0, 0]);
    atteso("CA7. /pronto: 200 senza token né cache, referer solo verso sé stessa (con «no-referrer» il browser manderebbe Origin: null e i pulsanti verrebbero respinti), non incorniciabile, un pulsante POST per ciascuno dei 3 utenti", pronto.stato === 200 && pronto.cache === "no-store" && pronto.referrer === "same-origin" && pronto.html.includes('<meta name="referrer" content="same-origin">') && pronto.cornici === "DENY" && pronto.csp.includes("frame-ancestors 'none'") && ["ti-admin", "ti-titolare", "ti-titolare2"].every((u) => pronto.html.includes(`<form method="post" action="/accesso/${u}">`)) && !/TOKEN_SINTETICO|token_hash|ACCESSO_SINTETICO/.test(pronto.html));
    uguale("CA8. strade sbagliate respinte: GET 405, senza codice 403, codice sbagliato 403, altra origine o «null» 403, host estraneo o numerico 403", esiti.strade, [405, 403, 403, 403, 403, 403, 403]);
    const t = esiti.titolare as { stato: number; location: string; cache: string; referrer: string; cookie: string[] };
    const ct = esiti.chiamateTitolare as { url: string; metodo: string; corpo: string }[];
    atteso(
      "CA9. pulsante di ti-titolare: un collegamento generato e verificato SUBITO lato server (2 chiamate), poi 303 all'app su localhost senza token nell'indirizzo",
      t.stato === 303 && t.location === "http://localhost:3110/dashboard/omnia-ai/opportunita/cerca?__zone=omnia-ai" && t.cache === "no-store" && t.referrer === "no-referrer" &&
        ct.length === 2 && ct[0].url.endsWith("/auth/v1/admin/generate_link") && JSON.parse(ct[0].corpo).email === "ti-titolare@prova.test" && JSON.parse(ct[0].corpo).type === "magiclink" &&
        ct[1].url.endsWith("/auth/v1/verify") && ct[1].metodo === "POST" && JSON.parse(ct[1].corpo).token_hash === "TOKEN_SINTETICO_1" && JSON.parse(ct[1].corpo).type === "magiclink" &&
        !ct.some((c) => /TOKEN_SINTETICO/.test(c.url)),
      JSON.stringify({ stato: t.stato, location: t.location, chiamate: ct.map((c) => c.url) }),
    );
    const impostati = t.cookie.filter((c) => !/Max-Age=0/.test(c)).map((c) => c.split(";")[0]);
    const scaduti = t.cookie.filter((c) => /Max-Age=0/.test(c)).map((c) => c.split("=")[0]);
    atteso("CA10. cookie di sessione per «localhost»: diviso in .0 e .1, Path=/, SameSite=Lax, mai Domain; il vecchio cookie non diviso scade, gli altri restano", impostati.map((c) => c.split("=")[0]).join(",") === `${COOKIE}.0,${COOKIE}.1` && t.cookie.every((c) => /; Path=\//.test(c) && /SameSite=Lax/.test(c) && !/Domain=/i.test(c)) && scaduti.join(",") === COOKIE);
    const letti = impostati.map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1) }));
    const lettore = createServerClient("https://ryawdldqiumqsskrnyps.supabase.co", "sb_publishable_SINTETICA", { cookies: { getAll: () => letti, setAll: () => {} }, global: { fetch: fetchFinto } });
    const primaLettura = chiamate.length;
    const { data: sessioneLetta } = await lettore.auth.getSession();
    atteso("CA11. l'app legge quei cookie con la sua libreria (@supabase/ssr): stessa sessione, senza alcuna chiamata", sessioneLetta.session?.access_token === ACCESSO && chiamate.length === primaLettura);
    uguale("CA12. lo stesso pulsante la seconda volta: 410 e nessuna nuova chiamata", esiti.ripetuto, [410, 2]);
    uguale("CA13. pulsante di ti-admin: 303 alla console su localhost", esiti.admin, [303, "http://localhost:3110/?__zone=console"]);
    uguale("CA14. verifica rifiutata: 502 senza cookie, poi 410 (un solo tentativo per utente); utente sconosciuto 404", [esiti.fallito, esiti.ignoto], [[502, 0, 410], 404]);
    atteso("CA15. /pronto dopo gli accessi: i pulsanti usati risultano «già usato» e disattivati", ((esiti.prontoDopo as string).match(/disabled>Entra come/g) ?? []).length === 3 && (esiti.prontoDopo as string).includes("già usato"));
    let chiuso = false;
    try {
      await fetch(`http://localhost:${portaUsata}/pronto`, { signal: AbortSignal.timeout(2000) });
    } catch {
      chiuso = true;
    }
    atteso("CA16. allo spegnimento dell'app il server d'accesso è chiuso e il codice d'uscita è quello dell'app", chiuso && codice === 0);
    atteso(
      "CA17. nell'uscita nessun token, chiave, cookie o collegamento (solo /pronto su localhost e l'esito per utente)",
      stampato.some((r) => r.includes(`http://localhost:${portaUsata}/pronto`)) && stampato.some((r) => r.includes("Accesso di ti-titolare: sessione impostata")) && stampato.some((r) => r.includes("Accesso di ti-titolare2 NON riuscito")) &&
        !stampato.some((r) => /TOKEN_SINTETICO|ACCESSO_SINTETICO|RINNOVO_SINTETICO|sb_secret_|token_hash|base64-|127\.0\.0\.1/.test(r)),
    );
    atteso("CA18. nessun file scritto nel progetto (e nessuna scrittura su file nello script: CA23)", fs.readdirSync(progetto).every((f) => f === "scripts" || f === "variabili.txt"));
    // l'app cade: il server d'accesso si chiude lo stesso
    let portaCaduta = 0;
    try {
      await ca.collaudo([fileFuori, "3110"], {}, { cartella: progetto, fetchFn: fetchFinto, controllaPorta: portaOk, portaAccesso: 0, avvia: async ({ portaAccesso }: { portaAccesso: number }) => { portaCaduta = portaAccesso; throw new Error("server caduto"); } });
    } catch {
      // atteso
    }
    let chiusoDopoErrore = false;
    try {
      await fetch(`http://localhost:${portaCaduta}/pronto`, { signal: AbortSignal.timeout(2000) });
    } catch {
      chiusoDopoErrore = true;
    }
    atteso("CA19. se l'app cade, il server d'accesso si chiude lo stesso", portaCaduta > 0 && chiusoDopoErrore);

    // controllo preliminare: nessuna autorizzazione, nessun file, nessuna rete
    const primaPreliminare = chiamate.length;
    const stampatoPre: string[] = [];
    console.log = (...a: unknown[]) => stampatoPre.push(a.map(String).join(" "));
    let pre: { html: string; post: number; portaAccesso: number } = { html: "", post: 0, portaAccesso: 0 };
    let codicePre: number | null = null;
    try {
      codicePre = await ca.collaudo(["--preliminare", "3110"], {}, {
        fetchFn: fetchFinto,
        portaAccesso: 0,
        attendi: async ({ portaAccesso }: { portaAccesso: number }) => {
          const base = `http://localhost:${portaAccesso}`;
          const html = await (await fetch(`${base}/pronto`)).text();
          const via = (html.match(/name="via" value="([^"]+)"/) ?? [])[1] ?? "";
          const post = await fetch(`${base}/accesso/ti-admin`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base }, body: new URLSearchParams({ via }).toString() });
          pre = { html, post: post.status, portaAccesso };
        },
      });
    } finally {
      console.log = logOriginale;
    }
    let chiusoPre = false;
    try {
      await fetch(`http://localhost:${pre.portaAccesso}/pronto`, { signal: AbortSignal.timeout(2000) });
    } catch {
      chiusoPre = true;
    }
    atteso(
      "CA20. --preliminare: senza autorizzazione né variabili, /pronto in modalità preliminare con i 3 pulsanti bloccati, un POST valido riceve 409 e nessuna chiamata; poi si chiude",
      codicePre === 0 && pre.html.includes("MODALITÀ PRELIMINARE") && (pre.html.match(/disabled>Entra come/g) ?? []).length === 3 && pre.post === 409 && chiamate.length === primaPreliminare && chiusoPre && stampatoPre.some((r) => r.includes(`http://localhost:${pre.portaAccesso}/pronto`)),
    );
    const server = ca.serverAccesso({ portaApp: "3110", accedi: async () => [] });
    const indirizzo = await ca.ascoltaSoloLocale(server, 0);
    atteso("CA21. il server d'accesso ascolta SOLO sul loopback (nome «localhost»)", ["::1", "127.0.0.1"].includes(indirizzo.address), indirizzo.address);
    await ca.chiudi(server);
    uguale("CA22. utenti del collaudo: solo amministratore e due titolari di imprese diverse, tutti @prova.test", ca.UTENTI_COLLAUDO.map((u: { email: string }) => u.email), ["ti-admin@prova.test", "ti-titolare@prova.test", "ti-titolare2@prova.test"]);
    const codiceScript = leggi("scripts/collaudo-accesso-b3.mjs");
    atteso(
      "CA23. lo script: porta delle autorizzazioni prima della guardia, guardia prima del server; collegamenti generati SOLO dentro il pulsante; nessun file scritto; solo «localhost», mai l'indirizzo numerico",
      codiceScript.indexOf("controllaPorta({ script: NOME_SCRIPT })") < codiceScript.indexOf("erroriAmbiente(variabili)") &&
        codiceScript.indexOf("erroriAmbiente(variabili)") < codiceScript.indexOf("serverAccesso({ portaApp: porta, accedi, dopoAccesso })") &&
        (codiceScript.match(/await generaCollegamento\(/g) ?? []).length === 1 && codiceScript.indexOf("await generaCollegamento(") > codiceScript.indexOf("const accedi = async (utente) =>") &&
        (codiceScript.match(/await accedi\(utente\)/g) ?? []).length === 1 &&
        !/writeFileSync|appendFileSync/.test(codiceScript) && codiceScript.includes('SOLO_LOCALE = "localhost"') && !/http:\/\/127\.0\.0\.1|SOLO_LOCALE = "127/.test(codiceScript),
    );

    // ───── verifica dell'isolamento lato server (impresa 2): solo GET, solo conteggi ─────
    const ID_IMPRESA1 = "00000000-0000-4000-8000-000000000111";
    const ID_IMPRESA2 = "00000000-0000-4000-8000-000000000222";
    const SEGRETA = "Bearer sb_secret_SINTETICA_DA_NON_STAMPARE";
    const vistePerTabella: Record<string, number> = {};
    const chiamateIso: { metodo: string; auth: string }[] = [];
    const fetchIsolamento = (async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      chiamateIso.push({ metodo: init?.method ?? "GET", auth });
      if (u.pathname === "/auth/v1/user") return auth === `Bearer ${ACCESSO}` ? new Response(JSON.stringify({ id: ID_IMPRESA2, email: "ti-titolare2@prova.test" }), { status: 200, headers: json }) : new Response("{}", { status: 401, headers: json });
      if (u.pathname === "/rest/v1/users") return new Response(JSON.stringify(auth === SEGRETA ? [{ id: ID_IMPRESA1 }] : []), { status: 200, headers: json });
      const tabella = u.pathname.replace("/rest/v1/", "");
      const filtro = u.searchParams.get("user_id") ?? "";
      const n = auth === SEGRETA ? (filtro === `eq.${ID_IMPRESA1}` && tabella !== "omnia_ai_notifiche" ? 5 : 0) : filtro === `eq.${ID_IMPRESA2}` ? 1 : (vistePerTabella[tabella] ?? 0);
      return new Response("[]", { status: 200, headers: { ...json, "Content-Range": n ? `0-0/${n}` : "*/0" } });
    }) as unknown as typeof fetch;
    const variabiliIso = { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_SINTETICA_DA_NON_STAMPARE", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_SINTETICA" };
    const argomentiIso = { variabili: variabiliIso, accessToken: ACCESSO, emailUtente: "ti-titolare2@prova.test", emailAltraImpresa: "ti-titolare@prova.test", fetchFn: fetchIsolamento };
    const tabelleIso: string[] = ca.TABELLE_ISOLAMENTO;
    const iso = await ca.verificaIsolamento(argomentiIso);
    atteso(
      "CA24. isolamento: controllo positivo sulla propria riga, poi 0 righe dell'impresa 1 viste con la sessione dell'impresa 2 in ogni tabella che ne ha; «non eseguita» dove l'impresa 1 non ha righe",
      iso.ok && iso.righe.some((r: string) => r.includes("controllo positivo") && r.endsWith("→ ok")) && iso.righe.filter((r: string) => / → ok$/.test(r) && !r.includes("controllo positivo")).length === tabelleIso.length - 1 && iso.righe.some((r: string) => r.includes("omnia_ai_notifiche") && r.includes("non eseguita")) && !iso.righe.some((r: string) => r.includes("VIOLAZIONE")) && iso.righe[iso.righe.length - 1].includes("nessuna violazione"),
      iso.righe.join(" | "),
    );
    atteso(
      "CA25. isolamento: solo GET; la sessione dell'utente per le righe viste, la chiave di servizio solo per i confronti; nell'uscita nessun token, chiave o id completo",
      chiamateIso.every((c) => c.metodo === "GET") && chiamateIso.filter((c) => c.auth === `Bearer ${ACCESSO}`).length === tabelleIso.length + 2 && chiamateIso.filter((c) => c.auth === SEGRETA).length === tabelleIso.length + 1 && !iso.righe.some((r: string) => /ACCESSO_SINTETICO|sb_secret_|sb_publishable_|000000000111|000000000222/.test(r)),
    );
    vistePerTabella.omnia_ai_radar_salvate = 2;
    const violata = await ca.verificaIsolamento(argomentiIso);
    vistePerTabella.omnia_ai_radar_salvate = 0;
    atteso("CA26. una riga dell'altra impresa vista con la sessione → «VIOLAZIONE» e STOP", !violata.ok && violata.righe.some((r: string) => r.includes("omnia_ai_radar_salvate") && r.includes("VIOLAZIONE")) && violata.righe[violata.righe.length - 1].includes("STOP"));
    const estranea = await ca.verificaIsolamento({ ...argomentiIso, accessToken: "TOKEN_ESTRANEO" });
    atteso("CA27. sessione non riconosciuta → verifica NON eseguita, mai «ok» per difetto", !estranea.ok && estranea.righe.length === 1 && estranea.righe[0].includes("NON eseguita"));
    const stampatoIso: string[] = [];
    console.log = (...a: unknown[]) => stampatoIso.push(a.map(String).join(" "));
    try {
      await ca.collaudo([fileFuori, "3110"], {}, {
        cartella: progetto,
        controllaPorta: portaOk,
        portaAccesso: 0,
        fetchFn: (async (url: string, init?: RequestInit) => (/generate_link|\/auth\/v1\/verify/.test(String(url)) ? fetchFinto(url, init) : fetchIsolamento(url, init))) as unknown as typeof fetch,
        avvia: async ({ portaAccesso }: { portaAccesso: number }) => {
          const base = `http://localhost:${portaAccesso}`;
          const via = ((await (await fetch(`${base}/pronto`)).text()).match(/name="via" value="([^"]+)"/) ?? [])[1] ?? "";
          await fetch(`${base}/accesso/ti-titolare2`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base }, body: new URLSearchParams({ via }).toString() });
          return 0;
        },
      });
    } finally {
      console.log = logOriginale;
    }
    atteso(
      "CA28. dopo l'accesso di ti-titolare2 lo script esegue da solo la verifica dell'isolamento e ne stampa solo i conteggi",
      stampatoIso.some((r) => r.includes("Isolamento di ti-titolare2: nessuna violazione")) && !stampatoIso.some((r) => /ACCESSO_SINTETICO|TOKEN_SINTETICO|sb_secret_|000000000111/.test(r)),
      stampatoIso.join(" | "),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ───── Radar personalizzato: SOLO il contratto (non collegato a nulla) ─────
const profilo: ProfiloRadar = { impresaId: "I1", settori: ["pulizia", "ristorazione"], sottocategorie: {}, procedure: [], regioni: [], importoMin: null, importoMax: null, vedereCorrelate: false };
const gr = (id: string, righe: GaraPerRadar["righe"], extra: Partial<GaraPerRadar> = {}): GaraPerRadar => ({ id, unitaA: null, statoClassificazione: "classificata", righe, tipoProcedura: "aperta", regioni: ["ITF2"], valore: 200000, aperta: true, ...extra });
const r = (settore: string, rilevanza: "A" | "B" | "C", sottocategorie: string[] = []) => ({ settore, rilevanza, sottocategorie, attiva: true });
const gareRadar = [
  gr("P1", [r("pulizia", "A")]),
  gr("P2", [r("pulizia", "B")]),
  gr("P3", [r("pulizia", "C")]),
  gr("P4", [r("pulizia", "A"), r("ristorazione", "A")]),
  gr("P5", [r("pulizia", "A")], { unitaA: "P1" }),
  gr("P6", [r("pulizia", "A")], { statoClassificazione: "in_attesa" }),
  gr("P7", [r("vigilanza_portierato", "A")]),
  gr("P8", [r("pulizia", "A")], { aperta: false }),
  gr("P1", [r("pulizia", "A")]),
];
uguale("RP1. solo pertinenti nei settori dell'impresa, una volta sola (multisettore unite, copie collegate, in attesa, altri settori e chiuse escluse)", opportunitaPerImpresa(gareRadar, profilo).map((o) => `${o.proceduraId}:${o.tipo}:${o.settori.map((s) => s.settore).join("+")}`), ["P1:pertinente:pulizia", "P4:pertinente:pulizia+ristorazione"]);
uguale("RP2. le correlate solo se l'impresa lo chiede, dopo le pertinenti, e mai notificate", [opportunitaPerImpresa(gareRadar, { ...profilo, vedereCorrelate: true }).map((o) => o.proceduraId), daNotificare(opportunitaPerImpresa(gareRadar, { ...profilo, vedereCorrelate: true }), new Set())], [["P1", "P4", "P2"], ["P1", "P4"]]);
uguale("RP3. si notificano solo le pertinenti nuove per l'impresa", daNotificare(opportunitaPerImpresa(gareRadar, profilo), new Set(["P1"])), ["P4"]);
uguale("RP4. le preferenze restringono (sottocategorie, procedure, regioni, importi)", [
  opportunitaPerImpresa([gr("S1", [r("pulizia", "A", ["sanificazione"])])], { ...profilo, sottocategorie: { pulizia: ["pulizia_uffici"] } }).length,
  opportunitaPerImpresa([gr("S2", [r("pulizia", "A")], { tipoProcedura: "negoziata" })], { ...profilo, procedure: ["aperta"] }).length,
  opportunitaPerImpresa([gr("S3", [r("pulizia", "A")])], { ...profilo, regioni: ["ITC4"] }).length,
  opportunitaPerImpresa([gr("S4", [r("pulizia", "A")], { valore: 50000 })], { ...profilo, importoMin: 100000 }).length,
], [0, 0, 0, 0]);
uguale("RP5. da rivalutare dopo un giro: solo le gare cambiate, classificate, aperte e non collegate (nessuna scansione dell'archivio)", gareDaRivalutare(gareRadar.slice(0, 8)), ["P1", "P2", "P3", "P4", "P7"]);
atteso("RP6. il contratto del Radar non è usato da nessuna pagina, azione o cron (solo predisposto)", !fs.readdirSync(path.join(RADICE, "src/app"), { recursive: true }).some((f) => /\.(tsx?)$/.test(String(f)) && leggi(path.join("src/app", String(f))).includes("radar-personalizzato-contratto")));

provaComportamento()
  .then(provaCollaudo)
  .catch((e) => atteso("C. prova di comportamento eseguita", false, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    if (fallimenti.length) {
      console.error(`\n${fallimenti.length} controlli della fase B3 (interfaccia) NON superati.`);
      process.exit(1);
    }
    console.log("\nTutti i controlli della fase B3 (interfaccia) sono superati.");
  });
