// Verifica di K3 (piano 48C, B2, 23/11/2026): orari dei giri, stato calcolato e allarmi delle fonti (C7 compreso), e la lettura per la
// console. Tutto in memoria, dati SINTETICI, nessuna rete. Uso: npx tsx scripts/verifica-radar-stato-fonti.ts → codice 0 se tutto passa.
import { ORARI_GIRI, cronAttiviDa, eFeriale, istanteDiRoma, orariPrevisti } from "../src/lib/radar/programmazione-calcoli";
import { SOGLIE_ALLARMI, allarmiFonti, statoFonte, tipiSconosciuti, type RigaEsecuzioneLetta, type RigaStatoFonte, type SituazioneFonte } from "../src/lib/radar/stato-fonti-calcoli";
import { leggiSituazioneFonti } from "../src/lib/radar/esecuzioni";
import { DbFinto } from "./lib/db-finto-motore";
import type { SupabaseClient } from "@supabase/supabase-js";

let ok = 0;
const falliti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown): void {
  if (condizione) ok++;
  else falliti.push(`${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 500)}`}`);
}
const iso = (d: Date) => d.toISOString();

// ═════ orari dei giri ═════
function provaOrari(): void {
  controlla("Roma d'inverno (+1): 08:05 del 01/12 = 07:05 UTC", iso(istanteDiRoma("2026-12-01", "08:05")) === "2026-12-01T07:05:00.000Z");
  controlla("Roma d'estate (+2): 08:05 del 01/07 = 06:05 UTC", iso(istanteDiRoma("2026-07-01", "08:05")) === "2026-07-01T06:05:00.000Z");
  controlla("giorni del cambio dell'ora (29/03 e 25/10/2026): l'ora di Roma giusta", iso(istanteDiRoma("2026-03-29", "08:05")) === "2026-03-29T06:05:00.000Z" && iso(istanteDiRoma("2026-10-25", "08:05")) === "2026-10-25T07:05:00.000Z");
  controlla("orari approvati (D2, D5): PVL 3 al giorno tutti i giorni; TED 2 feriali; Sintel 2; SardegnaCAT 4 feriali + 1 nel fine settimana",
    ORARI_GIRI.pvl.map((o) => o.ora).join() === "08:05,13:05,18:05" && ORARI_GIRI.pvl.every((o) => o.giorni === "tutti") && ORARI_GIRI.ted.map((o) => `${o.ora}/${o.giorni}`).join() === "10:15/feriali,16:15/feriali" && ORARI_GIRI.sintel.map((o) => o.ora).join() === "07:40,13:40" && ORARI_GIRI.sardegnacat.filter((o) => o.giorni === "feriali").length === 4 && ORARI_GIRI.sardegnacat.some((o) => o.ora === "12:20" && o.giorni === "fine_settimana"));
  const giorno = (g: string) => [new Date(`${g}T00:00:00+01:00`), new Date(`${g}T23:59:00+01:00`)] as const;
  controlla("PVL sabato 21/11: 3 giri", orariPrevisti("pvl", ...giorno("2026-11-21")).length === 3);
  controlla("TED sabato 0, lunedì 2", orariPrevisti("ted", ...giorno("2026-11-21")).length === 0 && orariPrevisti("ted", ...giorno("2026-11-23")).length === 2);
  controlla("SardegnaCAT lunedì 4 (08:20…17:20), domenica 1 (12:20)", orariPrevisti("sardegnacat", ...giorno("2026-11-23")).length === 4 && orariPrevisti("sardegnacat", ...giorno("2026-11-22")).map((d) => iso(d)).join() === "2026-11-22T11:20:00.000Z");
  const t = istanteDiRoma("2026-11-23", "13:05");
  controlla("finestra: inizio escluso, fine compresa", orariPrevisti("pvl", t, new Date(t.getTime() + 1)).length === 0 && orariPrevisti("pvl", new Date(t.getTime() - 1), t).length === 1);
  controlla("feriali: lunedì–venerdì", eFeriale("2026-11-23") && eFeriale("2026-11-27") && !eFeriale("2026-11-28") && !eFeriale("2026-11-29"));
  const c = cronAttiviDa({ RADAR_PVL_CRON: "attivo" });
  controlla("cron accesi dall'ambiente: TED sempre (oggi senza interruttore), PVL con RADAR_PVL_CRON, regionali con RADAR_REGIONALI_CRON", c.has("ted") && c.has("pvl") && !c.has("sintel") && cronAttiviDa({ RADAR_REGIONALI_CRON: "attivo" }).has("sardegnacat") && !cronAttiviDa({}).has("pvl"));
}

// ═════ stato calcolato (L2) ═════
const fonte = (x: Partial<RigaStatoFonte> & { fonte: string }): RigaStatoFonte => ({ attiva: true, ultimo_avvio_il: null, ultimo_successo_il: null, ultimo_errore_il: null, conteggi: null, ...x });
function provaStato(): void {
  controlla("stato: accesa, nessun errore → ok", statoFonte(fonte({ fonte: "ted", ultimo_successo_il: "2026-11-23T09:00:00Z" })) === "ok");
  controlla("stato: errore PIÙ RECENTE dell'ultimo successo → in errore", statoFonte(fonte({ fonte: "ted", ultimo_successo_il: "2026-11-23T09:00:00Z", ultimo_errore_il: "2026-11-23T10:00:00Z" })) === "in_errore");
  controlla("stato: errore VECCHIO (prima dell'ultimo successo) → ok, lo storico resta", statoFonte(fonte({ fonte: "ted", ultimo_successo_il: "2026-11-23T11:00:00Z", ultimo_errore_il: "2026-11-23T10:00:00Z" })) === "ok");
  controlla("stato: spenta con una sospensione più recente del successo → sospesa", statoFonte(fonte({ fonte: "pvl", attiva: false, ultimo_successo_il: "2026-11-22T09:00:00Z", conteggi: { sospensione: { il: "2026-11-23T08:05:00Z", motivo: "HTTP 429" } } })) === "sospesa");
  controlla("stato: spenta con una sospensione VECCHIA (poi riaccesa e riuscita) → spenta dalla console", statoFonte(fonte({ fonte: "pvl", attiva: false, ultimo_successo_il: "2026-11-23T09:00:00Z", conteggi: { sospensione: { il: "2026-11-20T08:05:00Z" } } })) === "spenta");
  controlla("stato: spenta senza sospensione → spenta", statoFonte(fonte({ fonte: "sintel", attiva: false })) === "spenta");
}

// ═════ allarmi ═════
const ADESSO = new Date("2026-11-23T13:30:00Z"); // lunedì 23/11, 14:30 a Roma
const riga = (f: string, iniziato: string, esito: string, x: Partial<RigaEsecuzioneLetta> = {}): RigaEsecuzioneLetta => ({
  fonte: f,
  modo: "incrementale",
  iniziato_il: iniziato,
  finito_il: new Date(Date.parse(iniziato) + 20_000).toISOString(),
  esito,
  finestre: { giro_finito: true },
  fonte_richieste: 1,
  db_richieste: 6,
  avvisi: {},
  gare_nuove: 1,
  allarmi: [],
  errore: esito === "errore" ? "rete non raggiungibile" : null,
  ...x,
});
const di = (s: SituazioneFonte[], f: string) => s.find((x) => x.fonte === f)!;
const codici = (s: SituazioneFonte) => s.allarmi.map((a) => a.codice);
const stati = (x: Partial<Record<string, Partial<RigaStatoFonte>>> = {}) => ["ted", "pvl", "sintel", "sardegnacat"].map((f) => fonte({ fonte: f, ultimo_successo_il: "2026-11-23T07:06:00Z", ...(x[f] ?? {}) }));

function provaAllarmi(): void {
  const vuoto = allarmiFonti([], [], ADESSO);
  controlla("sempre le quattro fonti, in ordine; senza righe di stato: spente, nessun allarme", vuoto.map((s) => `${s.fonte}:${s.stato}:${s.allarmi.length}`).join() === "ted:spenta:0,pvl:spenta:0,sintel:spenta:0,sardegnacat:spenta:0");

  // sospesa
  const sosp = di(allarmiFonti([], stati({ pvl: { attiva: false, conteggi: { sospensione: { il: "2026-11-23T08:06:00Z", motivo: "HTTP 429 dalla PVL" } } } }), ADESSO), "pvl");
  controlla("sospesa: allarme «errore» con il motivo, si riaccende solo dalla console", sosp.stato === "sospesa" && sosp.allarmi[0]?.codice === "sospesa" && sosp.allarmi[0].gravita === "errore" && /429/.test(sosp.allarmi[0].messaggio) && /console/.test(sosp.allarmi[0].messaggio), sosp.allarmi);

  // errori ripetuti
  const er = (righe: RigaEsecuzioneLetta[]) => di(allarmiFonti(righe, stati(), ADESSO, { cronAttivi: new Set() }), "ted");
  controlla("errori ripetuti: 2 giri di fila in errore → allarme, con il conteggio", codici(er([riga("ted", "2026-11-23T09:15:00Z", "errore"), riga("ted", "2026-11-20T09:15:00Z", "errore"), riga("ted", "2026-11-19T09:15:00Z", "ok")])).includes("errori_ripetuti"));
  controlla("errori ripetuti: un errore solo → nessun allarme", !codici(er([riga("ted", "2026-11-23T09:15:00Z", "errore"), riga("ted", "2026-11-20T09:15:00Z", "ok")])).includes("errori_ripetuti"));
  const occ = er([riga("ted", "2026-11-23T09:20:00Z", "errore"), riga("ted", "2026-11-23T09:16:00Z", "occupata"), riga("ted", "2026-11-23T09:15:00Z", "inerte"), riga("ted", "2026-11-20T09:15:00Z", "errore")]);
  controlla("errori ripetuti: «occupata» e «inerte» non sono giri (non interrompono né contano)", occ.erroriConsecutivi === 2 && codici(occ).includes("errori_ripetuti"), occ);

  // giro mancato (PVL: 08:05 riuscito, 13:05 nessun giro; adesso 14:30)
  const pvl = (righe: RigaEsecuzioneLetta[], adesso = ADESSO, cron?: Set<"ted" | "pvl" | "sintel" | "sardegnacat">, st = stati()) => di(allarmiFonti(righe, st, adesso, cron ? { cronAttivi: cron } : {}), "pvl");
  const solo08 = [riga("pvl", "2026-11-23T07:06:00Z", "ok")];
  const gm = pvl(solo08);
  controlla("giro mancato: il giro delle 13:05 senza un giro riuscito entro 60 minuti → allarme «errore» con l'orario", codici(gm).includes("giro_mancato") && gm.allarmi.find((a) => a.codice === "giro_mancato")?.dal === "2026-11-23T12:05:00.000Z", gm.allarmi);
  controlla("giro mancato: alle 14:00 (55 minuti dopo le 13:05) ancora no", !codici(pvl(solo08, new Date("2026-11-23T13:00:00Z"))).includes("giro_mancato"));
  controlla("giro mancato: con il giro delle 13:06 riuscito → nessun allarme", !codici(pvl([...solo08, riga("pvl", "2026-11-23T12:06:00Z", "ok")])).includes("giro_mancato"));
  controlla("giro mancato: un doppio richiamo «gia_eseguito» vale come riuscito", !codici(pvl([...solo08, riga("pvl", "2026-11-23T12:07:00Z", "gia_eseguito")])).includes("giro_mancato"));
  controlla("giro mancato: un giro delle 13:06 in ERRORE non basta (nessun giro riuscito)", codici(pvl([...solo08, riga("pvl", "2026-11-23T12:06:00Z", "errore")])).includes("giro_mancato"));
  controlla("giro mancato: un giro riuscito 2 ore dopo l'orario non lo copre", codici(pvl([...solo08, riga("pvl", "2026-11-23T14:30:00Z", "ok")], new Date("2026-11-23T15:00:00Z"))).includes("giro_mancato"));
  controlla("giro mancato: cron della fonte spento → nessun allarme", !codici(pvl(solo08, ADESSO, new Set(["ted"]))).includes("giro_mancato"));
  controlla("giro mancato: fonte spenta → nessun allarme", !codici(pvl(solo08, ADESSO, undefined, stati({ pvl: { attiva: false } }))).includes("giro_mancato"));
  controlla("giro mancato: nessun giro registrato (registro vuoto, fonte appena accesa) → nessun allarme", !codici(pvl([])).includes("giro_mancato"));
  controlla("giro mancato: si contano solo gli orari DOPO il primo giro registrato (le 18:05 di ieri non contano)", (pvl(solo08).allarmi.find((a) => a.codice === "giro_mancato")?.dettagli?.mancati as string[]).length === 1);
  controlla("giro mancato: TED la domenica non ha orari → nessun allarme", !codici(di(allarmiFonti([riga("ted", "2026-11-20T09:16:00Z", "ok")], stati(), new Date("2026-11-22T18:00:00Z")), "ted")).includes("giro_mancato"));
  // cambio dell'ora (25/10/2026): l'08:05 di Roma è alle 07:05 UTC
  const cambio = (inizio: string) => codici(di(allarmiFonti([riga("pvl", "2026-10-25T05:00:00Z", "ok", { esito: "inerte" }), riga("pvl", inizio, "ok")], stati(), new Date("2026-10-25T10:00:00Z")), "pvl"));
  controlla("giro mancato il giorno del cambio dell'ora: giro alle 07:06 UTC = 08:06 a Roma copre l'08:05; alle 06:06 UTC no", !cambio("2026-10-25T07:06:00Z").includes("giro_mancato") && cambio("2026-10-25T06:06:00Z").includes("giro_mancato"));

  // tetto ripetuto
  const tetto = (modo: string) => codici(di(allarmiFonti([1, 2, 3].map((h) => riga("pvl", `2026-11-23T0${h}:00:00Z`, "ok", { modo, finestre: { giro_finito: false } })), stati(), ADESSO, { cronAttivi: new Set() }), "pvl"));
  controlla("tetto ripetuto: 3 giri incrementali di fila non finiti → avviso", tetto("incrementale").includes("tetto_ripetuto"));
  controlla("tetto ripetuto: nel recupero è normale → nessun avviso", !tetto("recupero").includes("tetto_ripetuto"));

  // giorni lavorativi senza bandi (lunedì 23/11: gli ultimi due lavorativi conclusi sono venerdì 20 e giovedì 19)
  const bandi = (n20: number | null, n19: number | null) => codici(di(allarmiFonti([...(n20 === null ? [] : [riga("pvl", "2026-11-20T07:06:00Z", "ok", { avvisi: { bandi: n20 } })]), ...(n19 === null ? [] : [riga("pvl", "2026-11-19T07:06:00Z", "ok", { avvisi: { bandi: n19 } })])], stati(), ADESSO, { cronAttivi: new Set() }), "pvl"));
  controlla("PVL: 2 giorni lavorativi con giri riusciti e 0 bandi → informazione", bandi(0, 0).includes("giorno_lavorativo_senza_bandi"));
  controlla("PVL: un giorno con bandi → nulla; un giorno senza giri → nulla (lo dice «giro mancato»)", !bandi(3, 0).includes("giorno_lavorativo_senza_bandi") && !bandi(0, null).includes("giorno_lavorativo_senza_bandi"));
  const tedBandi = codici(di(allarmiFonti([riga("ted", "2026-11-20T09:16:00Z", "ok", { avvisi: { bandi: { letti: 0 } } }), riga("ted", "2026-11-19T09:16:00Z", "ok", { avvisi: { bandi: { letti: 0 } } })], stati(), ADESSO, { cronAttivi: new Set() }), "ted"));
  controlla("TED: stessa regola sui bandi letti", tedBandi.includes("giorno_lavorativo_senza_bandi"));

  // volume anomalo
  const vol = (ultimo: number, precedenti = 6) => codici(di(allarmiFonti([riga("sintel", "2026-11-23T12:41:00Z", "ok", { gare_nuove: ultimo }), ...Array.from({ length: precedenti }, (_, i) => riga("sintel", `2026-11-2${2 - Math.floor(i / 2)}T${i % 2 ? "12" : "06"}:41:00Z`, "ok", { gare_nuove: 2 }))], stati(), ADESSO, { cronAttivi: new Set() }), "sintel"));
  controlla("volume anomalo: 30 gare nuove con una media di 2 → avviso", vol(30).includes("volume_anomalo"));
  controlla("volume anomalo: 5 gare nuove (sotto il minimo) o pochi giri precedenti → nulla", !vol(5).includes("volume_anomalo") && !vol(30, 3).includes("volume_anomalo"));

  // risorse
  const ris = (x: Partial<RigaEsecuzioneLetta>) => codici(di(allarmiFonti([riga("ted", "2026-11-23T09:16:00Z", "ok", x)], stati(), ADESSO, { cronAttivi: new Set() }), "ted"));
  controlla("risorse: oltre 300 richieste al database → avviso", ris({ db_richieste: 350 }).includes("risorse"));
  controlla("risorse: oltre 120 secondi → avviso; un giro normale → nulla", ris({ finito_il: "2026-11-23T09:18:30Z" }).includes("risorse") && !ris({}).includes("risorse"));

  // C7: tipi sconosciuti
  controlla("C7 PVL: solo i codici NUOVI (non bandi, esiti, P7/P8, affidamenti, modifiche, qualificazione P*_15, concorsi P*_23/24)",
    JSON.stringify(tipiSconosciuti("pvl", { per_scheda: { P1_16: 3, X9_99: 1, P1_15: 1, P2_23: 1, P7_1_3: 2, P8: 1, AD2_25: 1, M2: 1, A1_29: 1, NAG: 1, E1: 2 } })) === '["E1","X9_99"]');
  controlla("C7 Sintel: modalità sconosciute; SardegnaCAT: tipi sconosciuti; TED: nessuno", tipiSconosciuti("sintel", { esclusi: { modalita_sconosciuta: 2 } }).length === 1 && tipiSconosciuti("sardegnacat", { esclusi: { tipo_sconosciuto: 1 } }).length === 1 && tipiSconosciuti("ted", { esclusi: { x: 1 } }).length === 0 && tipiSconosciuti("sintel", { esclusi: { fuori_settore: 9 } }).length === 0);
  const c7 = di(allarmiFonti([riga("pvl", "2026-11-23T12:06:00Z", "ok", { avvisi: { per_scheda: { P1_16: 1, Z1_01: 2 } } })], stati(), ADESSO, { cronAttivi: new Set() }), "pvl");
  controlla("C7: allarme «tipo_sconosciuto» con i codici, dall'ultimo giro riuscito", codici(c7).includes("tipo_sconosciuto") && JSON.stringify(c7.allarmi.find((a) => a.codice === "tipo_sconosciuto")?.dettagli?.codici) === '["Z1_01"]', c7.allarmi);
  controlla("C7: un giro più vecchio con codici nuovi non conta (vale l'ultimo giro riuscito)", !codici(di(allarmiFonti([riga("pvl", "2026-11-23T12:06:00Z", "ok"), riga("pvl", "2026-11-23T07:06:00Z", "ok", { avvisi: { per_scheda: { Z1_01: 2 } } })], stati(), ADESSO, { cronAttivi: new Set() }), "pvl")).includes("tipo_sconosciuto"));

  // registro mancante
  const reg = (avvio: string, righe: RigaEsecuzioneLetta[]) => codici(di(allarmiFonti(righe, stati({ ted: { ultimo_avvio_il: avvio } }), ADESSO, { cronAttivi: new Set() }), "ted"));
  controlla("registro mancante: giro avviato 20 minuti fa senza riga (l'ultima è di ieri) → avviso", reg("2026-11-23T13:10:00Z", [riga("ted", "2026-11-22T09:16:00Z", "ok")]).includes("registro_mancante"));
  controlla("registro mancante: con la riga del giro → nulla; avviato 5 minuti fa (forse ancora in corso) → nulla", !reg("2026-11-23T13:10:00Z", [riga("ted", "2026-11-23T13:09:58Z", "ok")]).includes("registro_mancante") && !reg("2026-11-23T13:25:00Z", []).includes("registro_mancante"));

  // segnalati dal giro e ordine
  const dalGiro = di(allarmiFonti([riga("sardegnacat", "2026-11-23T13:21:00Z", "ok", { allarmi: ["buco_possibile", "sospesa", "nome_sconosciuto"] })], stati(), ADESSO, { cronAttivi: new Set() }), "sardegnacat");
  controlla("allarmi segnalati dal giro: quelli noti passano (buco_possibile), gli altri no", codici(dalGiro).join() === "buco_possibile", dalGiro.allarmi);
  const misti = di(allarmiFonti([riga("ted", "2026-11-23T09:16:00Z", "ok", { db_richieste: 400 }), riga("ted", "2026-11-23T09:15:00Z", "errore"), riga("ted", "2026-11-22T09:15:00Z", "errore")], stati({ ted: { attiva: false, conteggi: { sospensione: { il: "2026-11-23T10:00:00Z", motivo: "x" } } } }), ADESSO, { cronAttivi: new Set() }), "ted");
  controlla("ordine: prima gli «errore», poi gli «avviso», poi le «informazione»", misti.allarmi.every((a, i, v) => i === 0 || ["errore", "avviso", "informazione"].indexOf(v[i - 1].gravita) <= ["errore", "avviso", "informazione"].indexOf(a.gravita)) && misti.allarmi[0].gravita === "errore", misti.allarmi);
  controlla("soglie del 48C §3.5 (approvate)", SOGLIE_ALLARMI.giroMancatoMinuti === 60 && SOGLIE_ALLARMI.erroriRipetuti === 2 && SOGLIE_ALLARMI.tettoRipetuto === 3 && SOGLIE_ALLARMI.volumeFattore === 3 && SOGLIE_ALLARMI.risorseRichiesteDb === 300 && SOGLIE_ALLARMI.risorseSecondi === 120);
}

// ═════ lettura per la console ═════
async function provaLettura(): Promise<void> {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = stati();
  db.tabelle.radar_esecuzioni = [riga("pvl", "2026-11-23T07:06:00Z", "ok"), riga("pvl", "2026-10-01T07:06:00Z", "errore")];
  const r = await leggiSituazioneFonti(db as unknown as SupabaseClient, ADESSO, { RADAR_PVL_CRON: "attivo" });
  controlla("lettura: due letture (stato e registro), nessuna scrittura; quattro fonti; giro mancato della PVL (cron acceso)", db.richieste.length === 2 && db.richieste.every((q) => q.metodo === "select") && r.situazioni.length === 4 && codici(di(r.situazioni, "pvl")).includes("giro_mancato") && r.errore === null && !r.registroAssente, { r: r.situazioni.map((s) => [s.fonte, s.stato, codici(s)]), richieste: db.richieste });
  controlla("lettura: solo gli ultimi 30 giorni del registro (la riga di ottobre non conta)", di(r.situazioni, "pvl").erroriConsecutivi === 0);
  const db2 = new DbFinto();
  db2.tabelle.radar_fonti_stato = stati();
  db2.guasti.set("radar_fonti_stato|select", 1);
  const r2 = await leggiSituazioneFonti(db2 as unknown as SupabaseClient, ADESSO, {});
  controlla("lettura: stato delle fonti non leggibile → errore e nessuna situazione inventata", r2.situazioni.length === 0 && /stato delle fonti/.test(r2.errore ?? ""));
}

async function principale(): Promise<void> {
  provaOrari();
  provaStato();
  provaAllarmi();
  await provaLettura();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica dello stato e degli allarmi delle fonti (K3): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
