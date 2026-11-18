// Verifica della fase B3, interfaccia di Tender Intelligence (18/11/2026): i 10 requisiti della ricerca, la scheda, Monitorate, la lettura
// delle classificazioni solo lato server e nella stessa richiesta, il contratto del Radar personalizzato. Solo dati SINTETICI, in memoria:
// nessun database, nessuna rete.
import fs from "node:fs";
import path from "node:path";
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

if (fallimenti.length) {
  console.error(`\n${fallimenti.length} controlli della fase B3 (interfaccia) NON superati.`);
  process.exit(1);
}
console.log("\nTutti i controlli della fase B3 (interfaccia) sono superati.");
