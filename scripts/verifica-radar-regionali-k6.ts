// Verifica di K6 (piano 48C §3.3, S6): fonti regionali. Blocco pari al tempo massimo più un margine; giro fermato dal tempo = non finito;
// completezza di Sintel (righe lette = conteggio della fonte); feed di SardegnaCAT «scivolato» → allarme «buco_possibile». Dati SINTETICI,
// database in memoria, fonti finte, nessuna rete. Uso: npx tsx scripts/verifica-radar-regionali-k6.ts → codice 0 se tutto passa.
import { conteggioSintel, parametriConteggioSintel, parametriSintel } from "../src/lib/radar/fonti/sintel-calcoli";
import { NAMESPACE_AFLINK, bucoPossibileFeed, pubblicazionePiuVecchiaAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { MARGINE_BLOCCO_MS, TEMPO_MASSIMO_REGIONALI_MS, eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { datiGiroRegionale, FONTI_ESECUZIONI, type RisultatoRegionalePerRegistro } from "../src/lib/radar/esecuzioni-calcoli";
import { allarmiFonti } from "../src/lib/radar/stato-fonti-calcoli";
import { DbFinto } from "./lib/db-finto-motore";
import type { SupabaseClient } from "@supabase/supabase-js";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 700)}`}`);
}
globalThis.fetch = (async () => {
  throw new Error("rete vietata nella verifica");
}) as typeof fetch;
// pause minime tra le richieste (1–2 s): l'orologio della prova avanza di 3 s a ogni richiesta, così la prova non aspetta
const adessoVero = Date.now.bind(Date);
let avanti = 0;
Date.now = () => adessoVero() + avanti;

// ═════ regole pure ═════
function provaRegole(): void {
  const c = parametriConteggioSintel("2026-11-23");
  controlla("Sintel, conteggio: stesso filtro della lettura, una sola riga di risposta", c.$where === parametriSintel({ daGiorno: "2026-11-23", limite: 1000, offset: 0 }).$where && c.$select === "count(*) AS n" && !("$limit" in c), c);
  controlla("Sintel, conteggio letto: stringa o numero; formati inattesi → null", conteggioSintel([{ n: "123" }]) === 123 && conteggioSintel([{ n: 7 }]) === 7 && conteggioSintel([]) === null && conteggioSintel([{ x: 1 }]) === null && conteggioSintel("12") === null && conteggioSintel([{ n: "-1" }]) === null && conteggioSintel([{ n: "1" }, { n: "2" }]) === null);
  const el = (d?: string): Record<string, string> => (d ? { DtPubblicazioneTecnical: d } : {});
  controlla("feed: il giorno di pubblicazione più vecchio (gli elementi senza data non contano)", pubblicazionePiuVecchiaAflink([el("2026-11-20T10:00:00"), el(), el("2026-11-12T09:00:00"), el("2026-11-18")]) === "2026-11-12" && pubblicazionePiuVecchiaAflink([el()]) === null);
  controlla("feed scivolato: allarme solo se il più vecchio è DOPO il giorno dell'ultimo giro riuscito", bucoPossibileFeed("2026-11-15", "2026-11-10") && !bucoPossibileFeed("2026-11-10", "2026-11-10") && !bucoPossibileFeed("2026-11-03", "2026-11-10") && !bucoPossibileFeed("2026-11-15", null) && !bucoPossibileFeed(null, "2026-11-10"));
  const base: RisultatoRegionalePerRegistro = { eseguita: true, invariataAllaFonte: false, sospesa: false, errore: null, statistiche: { letti: 3, esclusi: {}, invariati: 0, nuove: 0, aggiornate: 0, suGaraEsistente: {}, rettifiche: 0, annullate: 0, conflitti: 0, proposte: 0, ambiguita: 0, fonte: { richieste: 3, byte: 10, ms: 5 }, db: { richiesteDb: 2, msDb: 1 } } };
  const d = datiGiroRegionale({ ...base, giroFinito: false, dichiarati: 5, allarmi: ["conteggio_diverso"] });
  controlla("registro: giro_finito, dichiarati e allarmi del giro regionale", d?.esito === "ok" && (d.finestre as Record<string, unknown>).giro_finito === false && (d.finestre as Record<string, unknown>).dichiarati === 5 && JSON.stringify(d.allarmi) === '["conteggio_diverso"]', d);
  const situazione = allarmiFonti([{ fonte: "sintel", modo: "incrementale", iniziato_il: "2026-11-23T12:41:00Z", finito_il: "2026-11-23T12:41:20Z", esito: "ok", finestre: {}, fonte_richieste: 3, db_richieste: 2, avvisi: {}, gare_nuove: 0, allarmi: ["conteggio_diverso"], errore: null }], [{ fonte: "sintel", attiva: true, ultimo_avvio_il: null, ultimo_successo_il: "2026-11-23T12:41:20Z", ultimo_errore_il: null, conteggi: null }], new Date("2026-11-23T13:30:00Z"), { cronAttivi: new Set() }).find((s) => s.fonte === "sintel");
  controlla("console (K3): «conteggio_diverso» arriva tra gli allarmi della fonte, come avviso", situazione?.allarmi.some((a) => a.codice === "conteggio_diverso" && a.gravita === "avviso") === true, situazione?.allarmi);
}

// ═════ giri veri in memoria ═════
const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
const T0 = new Date("2026-11-23T12:40:00Z");
function mondo(fonte: "sintel" | "sardegnacat", x: { cursore?: unknown; ultimoSuccesso?: string | null } = {}): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: f === fonte, ultimo_successo_il: f === fonte ? x.ultimoSuccesso ?? null : null, cursore: f === fonte ? x.cursore ?? null : null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false, dati_aggiornati_al: null }));
  return db;
}
const stato = (db: DbFinto, f: string) => db.t("radar_fonti_stato").find((r) => r.fonte === f)!;
const registro = (db: DbFinto) => db.t("radar_esecuzioni").at(-1) as { esito?: string; allarmi?: string[]; finestre?: Record<string, unknown> } | undefined;

// righe Sintel SINTETICHE: fuori settore (lavori stradali) per non scrivere nulla, oppure nel settore (pulizia) per avere bandi da scrivere
function rigaSintel(i: number, nelSettore: boolean): Record<string, unknown> {
  return {
    id_procedura: String(900000100 + i),
    id_lotto: "N/D",
    multilotto: "NO",
    cig: `PRV${String(i).padStart(7, "0")}`,
    codice_cpv: nelSettore ? "90910000-9" : "45233140-2",
    data_inizio_negoziazione: "2026-11-10T00:00:00.000",
    data_fine_negoziazione: "2026-12-15T00:00:00.000",
    modalita_scelta_contraente: "Procedura Aperta",
    ambito_merceologico: nelSettore ? "Procedura per forniture/servizi" : "Procedura per lavori",
    stato_procedura: "Pubblicata",
    stato_lotto: "N/D",
    valore_economico_procedura: "120000",
    cf_stazione_appaltante: "00000000002",
    stazione_appaltante: "COMUNE DI SINTETICO",
    nome_procedura: nelSettore ? `Servizio di pulizia degli uffici ${i} (prova sintetica)` : `Lavori stradali ${i} (prova sintetica)`,
    link_procedura: { url: `http://www.sintel.regione.lombardia.it/eprocdata/auctionDetail.xhtml?id=${900000100 + i}` },
  };
}
function sintelFinta(o: { righe: number; conteggio: number | string; nelSettore?: boolean; caricamento?: number; dopoLaLettura?: () => void }) {
  const richieste: string[] = [];
  const fetchFn = (async (url: string | URL) => {
    avanti += 3_000;
    const u = decodeURIComponent(String(url));
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/api/views/")) {
      richieste.push("metadati");
      return json({ rowsUpdatedAt: o.caricamento ?? 1_763_880_000 });
    }
    if (u.includes("count(*)")) {
      richieste.push("conteggio");
      return json([{ n: String(o.conteggio) }]);
    }
    richieste.push("righe");
    const offset = Number(new URL(String(url)).searchParams.get("$offset"));
    o.dopoLaLettura?.();
    return json(offset === 0 ? Array.from({ length: o.righe }, (_, i) => rigaSintel(i, o.nelSettore ?? false)) : []);
  }) as typeof fetch;
  return { richieste, fetchFn };
}
const giroSintel = (db: DbFinto, fetchFn: typeof fetch, extra: { tempoMassimoMs?: number; adesso?: () => Date } = {}) =>
  eseguiImportazioneRegionale(db as unknown as SupabaseClient, "sintel", { env: STAGING, adesso: extra.adesso ?? (() => T0), fetchFn, origine: "script", limiti: { tentativi: 1 }, ...(extra.tempoMassimoMs ? { tempoMassimoMs: extra.tempoMassimoMs } : {}) });

async function provaSintel(): Promise<void> {
  // completo: conteggio = righe lette
  const db1 = mondo("sintel");
  let bloccoVisto: unknown = null;
  const f1 = sintelFinta({ righe: 3, conteggio: 3, dopoLaLettura: () => (bloccoVisto = stato(db1, "sintel").blocco_fino_a) });
  const r1 = await giroSintel(db1, f1.fetchFn);
  controlla("Sintel, giro completo: metadati, righe, conteggio (3 richieste, dentro il tetto di 6)", f1.richieste.join() === "metadati,righe,conteggio" && r1.eseguita && r1.dichiarati === 3 && r1.giroFinito && r1.allarmi.length === 0, { richieste: f1.richieste, r1 });
  controlla(`blocco = tempo massimo (${TEMPO_MASSIMO_REGIONALI_MS / 60_000} minuti di base) più ${MARGINE_BLOCCO_MS / 60_000} minuti, non più fisso a 10`, bloccoVisto === new Date(T0.getTime() + TEMPO_MASSIMO_REGIONALI_MS + MARGINE_BLOCCO_MS).toISOString(), bloccoVisto);
  const s1 = stato(db1, "sintel");
  controlla("Sintel completo: data dei dati salvata nel cursore e in dati_aggiornati_al, ultimo successo aggiornato, blocco tolto", (s1.cursore as { datiDel?: string })?.datiDel === new Date(1_763_880_000_000).toISOString() && s1.dati_aggiornati_al === new Date(1_763_880_000_000).toISOString() && typeof s1.ultimo_successo_il === "string" && s1.blocco_fino_a === null, s1);
  const db1b = mondo("sintel", { cursore: s1.cursore });
  const f1b = sintelFinta({ righe: 3, conteggio: 3 });
  await giroSintel(db1b, f1b.fetchFn);
  controlla("Sintel, dati invariati alla fonte: una sola richiesta (i metadati), nessun conteggio", f1b.richieste.join() === "metadati", f1b.richieste);

  // conteggio diverso: allarme, la data NON avanza, il giro dopo rilegge
  const db2 = mondo("sintel");
  const f2 = sintelFinta({ righe: 3, conteggio: 5 });
  const r2 = await giroSintel(db2, f2.fetchFn);
  const s2 = stato(db2, "sintel");
  const reg2 = registro(db2);
  controlla("Sintel, conteggio diverso (3 lette, 5 contate): allarme «conteggio_diverso» nel registro, esito «ok»", r2.eseguita && r2.allarmi.includes("conteggio_diverso") && reg2?.esito === "ok" && (reg2.allarmi ?? []).includes("conteggio_diverso") && reg2.finestre?.dichiarati === 5, { r2, reg2 });
  controlla("Sintel, conteggio diverso: la data dei dati NON avanza (né nel cursore né in dati_aggiornati_al)", !(s2.cursore as { datiDel?: string } | null)?.datiDel && s2.dati_aggiornati_al === null, s2);
  const f2b = sintelFinta({ righe: 3, conteggio: 3 });
  await giroSintel(mondo("sintel", { cursore: s2.cursore }), f2b.fetchFn);
  controlla("Sintel, giro dopo un conteggio diverso: rilegge tutto anche con i metadati invariati", f2b.richieste.join() === "metadati,righe,conteggio", f2b.richieste);
  const f3 = sintelFinta({ righe: 3, conteggio: "non-un-numero" });
  const r3 = await giroSintel(mondo("sintel"), f3.fetchFn);
  controlla("Sintel, conteggio illeggibile: non verificabile → stesso allarme, nessuna sospensione", r3.eseguita && r3.allarmi.includes("conteggio_diverso") && !r3.sospesa && r3.dichiarati === null, r3);

  // tempo massimo superato prima di scrivere: giro non finito, nulla scritto, data e ultimo successo invariati
  const db4 = mondo("sintel", { ultimoSuccesso: "2026-11-22T12:41:00.000Z" });
  const f4 = sintelFinta({ righe: 2, conteggio: 2, nelSettore: true });
  let chiamate = 0;
  const orologio = () => new Date(T0.getTime() + (chiamate++ < 2 ? 0 : 10 * 60_000)); // dopo l'avvio, l'orologio salta di 10 minuti
  const r4 = await giroSintel(db4, f4.fetchFn, { adesso: orologio, tempoMassimoMs: 300_000 });
  const s4 = stato(db4, "sintel");
  const scritture = db4.richieste.filter((q) => q.tabella !== "radar_fonti_stato" && q.tabella !== "radar_esecuzioni" && q.metodo !== "select");
  controlla("tempo massimo superato: giro NON finito, nessuna scrittura di gare, data e ultimo successo invariati, registro «giro_finito» false", r4.eseguita && !r4.giroFinito && !r4.errore && scritture.length === 0 && s4.ultimo_successo_il === "2026-11-22T12:41:00.000Z" && !(s4.cursore as { datiDel?: string } | null)?.datiDel && registro(db4)?.finestre?.giro_finito === false, { r4, scritture, s4 });
}

// ═════ SardegnaCAT: feed scivolato ═════
function feedXml(date: string[]): string {
  const item = (d: string, i: number) =>
    `<item><link>https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?getdettaglio=yes&amp;bando=${7000 + i}</link>` +
    `<afs:IdMsg>${7000 + i}</afs:IdMsg><afs:Oggetto>Lavori stradali ${i} (prova sintetica)</afs:Oggetto><afs:DenominazioneEnte>COMUNE DI PROVASINTETICA</afs:DenominazioneEnte>` +
    `<afs:DtScadenzaBandoTecnical>2026-12-10T10:00:00</afs:DtScadenzaBandoTecnical><afs:Tipo>Bando</afs:Tipo><afs:TipoProcedura>Aperta</afs:TipoProcedura>` +
    `<afs:statoFunzionale>PresOfferte</afs:statoFunzionale><afs:dataUltimaModifica>${d}T10:00:00</afs:dataUltimaModifica><afs:Contratto>Lavori</afs:Contratto>` +
    `<afs:CPV>45233140-2 - Lavori stradali</afs:CPV><afs:DtPubblicazioneTecnical>${d}T09:00:00</afs:DtPubblicazioneTecnical></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:afs="${NAMESPACE_AFLINK}"><channel><title>Bandi</title><afs:totRecord>${date.length}</afs:totRecord>${date.map(item).join("")}</channel></rss>`;
}
const feedFinto = (date: string[]) => {
  const c = { n: 0 };
  const fetchFn = (async () => {
    avanti += 3_000;
    c.n++;
    return new Response(feedXml(date), { status: 200, headers: { "content-type": "application/rss+xml" } });
  }) as typeof fetch;
  return { c, fetchFn };
};
const giroSardegna = (db: DbFinto, fetchFn: typeof fetch) => eseguiImportazioneRegionale(db as unknown as SupabaseClient, "sardegnacat", { env: STAGING, adesso: () => T0, fetchFn, origine: "script", limiti: { tentativi: 1 } });

async function provaSardegna(): Promise<void> {
  const casi: [string, string | null, string[], boolean][] = [
    ["feed scivolato (avviso più vecchio del 15/11, ultimo giro riuscito il 10/11)", "2026-11-10T13:21:00.000Z", ["2026-11-20", "2026-11-15", "2026-11-18"], true],
    ["feed che copre il fermo (avviso più vecchio del 03/11)", "2026-11-10T13:21:00.000Z", ["2026-11-20", "2026-11-03"], false],
    ["stesso giorno dell'ultimo giro riuscito", "2026-11-15T07:21:00.000Z", ["2026-11-15", "2026-11-20"], false],
    ["primo giro (nessun giro riuscito prima)", null, ["2026-11-20", "2026-11-15"], false],
  ];
  for (const [nome, successo, date, atteso] of casi) {
    const db = mondo("sardegnacat", { ultimoSuccesso: successo });
    const f = feedFinto(date);
    const r = await giroSardegna(db, f.fetchFn);
    const reg = registro(db);
    controlla(`SardegnaCAT, ${nome}: ${atteso ? "allarme «buco_possibile»" : "nessun allarme"}; una sola lettura del feed`, r.eseguita && !r.errore && f.c.n === 1 && r.allarmi.includes("buco_possibile") === atteso && (reg?.allarmi ?? []).includes("buco_possibile") === atteso, { r, reg });
  }
}

async function principale(): Promise<void> {
  provaRegole();
  await provaSintel();
  await provaSardegna();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica delle fonti regionali (K6): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
