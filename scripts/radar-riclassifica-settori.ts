// Riclassificazione delle gare GIÀ in archivio con le regole correnti di settori.ts (qualità delle gare, 17/11/2026), SOLO contro lo
// staging. Esclusione ≠ cancellazione: cambia solo «settori» e «metodo_settore» delle gare escluse; nulla si cancella; ogni correzione si
// traccia nel registro dei cambiamenti (correzione_dati, campo «settori», mai notificabile) e si può annullare.
//
// Uso (variabili dello staging nell'ambiente, mai quelle di produzione):
//   RADAR_STAGING_REF=<staging> npx tsx scripts/radar-riclassifica-settori.ts prova
//       sola lettura: elenca le gare che cambierebbero settore, nessuna scrittura (non serve autorizzazione)
//   RADAR_STAGING_REF=<staging> npx tsx scripts/radar-riclassifica-settori.ts applica <massimo>
//       scrive le correzioni; si ferma senza scrivere nulla se le correzioni sono più di <massimo>. Solo con il lanciatore
//       esegui-autorizzato.mjs e un'autorizzazione registrata del coordinatore (regola del 17/11/2026)
//   RADAR_STAGING_REF=<staging> npx tsx scripts/radar-riclassifica-settori.ts annulla <massimo>
//       rimette i settori di prima nelle gare corrette con questa versione delle regole (se nel frattempo nessuno li ha cambiati).
//       Stesse condizioni di «applica»
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PROGETTO_PRODUZIONE } from "../src/lib/radar/ambiente";
import { VERSIONE_REGOLE_SETTORI } from "../src/lib/radar/settori";
import {
  notaCorrezione,
  riclassificaGara,
  statoDaRegistro,
  valoreRegistro,
  type GaraDaRiclassificare,
  type LottoDaRiclassificare,
  type StatoSettori,
} from "../src/lib/radar/riclassifica-settori";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const staging = process.env.RADAR_STAGING_REF ?? "";
const FONTE_REGISTRO = "regole_settori";
const PAGINA = 1000;

if (!url || !chiave) {
  console.error("Mancano le variabili del database.");
  process.exit(2);
}
if (url.includes(PROGETTO_PRODUZIONE) || chiave.includes(PROGETTO_PRODUZIONE) || !staging || !url.includes(`${staging}.supabase.co`)) {
  console.error("STOP: questo script gira solo contro lo staging dichiarato in RADAR_STAGING_REF.");
  process.exit(2);
}

async function tutte<T>(db: SupabaseClient, tabella: string, colonne: string): Promise<T[]> {
  const righe: T[] = [];
  for (let da = 0; ; da += PAGINA) {
    const { data, error } = await db.from(tabella).select(colonne).order("id").range(da, da + PAGINA - 1).returns<T[]>();
    if (error) throw new Error(`${tabella}: ${error.message}`);
    righe.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return righe;
  }
}

type Gara = GaraDaRiclassificare & { chiave: string };
type Lotto = LottoDaRiclassificare & { procedura_id: string };
type Correzione = { gara: Gara; prima: StatoSettori; dopo: StatoSettori; idFonte: string; nota: string; regole: string[] };

// Uguaglianza esatta dei settori nella scrittura condizionata: contiene E contenuto (l'ordine non conta).
function stessiSettori<Q extends { contains: (c: string, v: string[]) => Q; containedBy: (c: string, v: string[]) => Q }>(q: Q, settori: string[]): Q {
  return q.contains("settori", settori).containedBy("settori", settori);
}

async function calcola(db: SupabaseClient) {
  const gare = await tutte<Gara>(db, "radar_procedure", "id, chiave, oggetto, cpv_principale, cpv_tutti, settori, metodo_settore, natura_contratto");
  const lotti = await tutte<Lotto>(db, "radar_lotti", "id, procedura_id, oggetto, cpv_principale, cpv_tutti");
  const perGara = new Map<string, Lotto[]>();
  for (const l of lotti) perGara.set(l.procedura_id, [...(perGara.get(l.procedura_id) ?? []), l]);
  const correzioni: Correzione[] = [];
  const daDecidere: { gara: Gara; prima: StatoSettori; dopo: StatoSettori }[] = [];
  for (const g of gare) {
    const r = riclassificaGara(g, perGara.get(g.id) ?? []);
    if (r.tipo === "correzione") correzioni.push({ gara: g, prima: r.prima, dopo: r.dopo, idFonte: r.idFonte, nota: notaCorrezione(r.esclusioni), regole: [...new Set(r.esclusioni.map((e) => `${e.settore}:${e.regola}`))] });
    else if (r.tipo === "da_decidere") daDecidere.push({ gara: g, prima: r.prima, dopo: r.dopo });
  }
  return { gare: gare.length, lotti: lotti.length, correzioni, daDecidere };
}

function stampa(c: Correzione) {
  console.log(`  ${c.gara.chiave.split(":")[0]} ${c.gara.id.slice(0, 8)} ${JSON.stringify(c.prima.settori)} → ${JSON.stringify(c.dopo.settori)} [${c.regole.join(", ") || "parole chiave"}] ${c.gara.oggetto.replace(/\s+/g, " ").slice(0, 110)}`);
}

async function porta() {
  // Regola del 17/11/2026: scritture sullo staging solo con un'autorizzazione registrata del coordinatore.
  const registro = process.env.TI_REGISTRO;
  if (!registro) { console.error("STOP: lanciare con esegui-autorizzato.mjs (autorizzazione registrata del coordinatore)."); process.exit(2); }
  const { controllaPorta } = await import(new URL(`file:///${registro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href);
  try { controllaPorta({ script: "radar-riclassifica-settori.ts" }); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(2); }
}

async function applica(db: SupabaseClient, correzioni: Correzione[]) {
  const iso = new Date().toISOString();
  const esito = { corrette: 0, cambiate_nel_frattempo: 0, errori: 0 };
  for (const c of correzioni) {
    const { data: fatte, error } = await stessiSettori(
      db.from("radar_procedure").update({ settori: c.dopo.settori, metodo_settore: c.dopo.metodo, aggiornata_il: iso }).eq("id", c.gara.id),
      c.prima.settori,
    ).select("id");
    if (error) { esito.errori++; console.error(`  errore su ${c.gara.id.slice(0, 8)}: ${error.message}`); continue; }
    if ((fatte ?? []).length === 0) { esito.cambiate_nel_frattempo++; continue; }
    const { error: e2 } = await db.from("radar_aggiornamenti").upsert(
      { procedura_id: c.gara.id, tipo: "correzione_dati", campo: "settori", valore_precedente: valoreRegistro(c.prima), valore_nuovo: valoreRegistro(c.dopo), fonte: FONTE_REGISTRO, id_fonte: c.idFonte, nota: c.nota, notificabile: false },
      { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
    );
    if (e2) {
      // senza traccia la correzione non resta: si rimette il valore di prima (stessa scrittura condizionata)
      await stessiSettori(db.from("radar_procedure").update({ settori: c.prima.settori, metodo_settore: c.prima.metodo, aggiornata_il: iso }).eq("id", c.gara.id), c.dopo.settori);
      esito.errori++;
      console.error(`  registro non scritto per ${c.gara.id.slice(0, 8)} (${e2.message}): correzione ritirata`);
      continue;
    }
    esito.corrette++;
  }
  return esito;
}

async function annulla(db: SupabaseClient, massimo: number) {
  const { data: tracce, error } = await db
    .from("radar_aggiornamenti")
    .select("procedura_id, valore_precedente, valore_nuovo, id_fonte")
    .eq("tipo", "correzione_dati")
    .eq("campo", "settori")
    .eq("fonte", FONTE_REGISTRO)
    .like("id_fonte", `regole-settori-${VERSIONE_REGOLE_SETTORI}:%`)
    .returns<{ procedura_id: string; valore_precedente: string | null; valore_nuovo: string | null; id_fonte: string }[]>();
  if (error) throw new Error(error.message);
  if ((tracce ?? []).length > massimo) {
    console.error(`STOP: ${tracce?.length} correzioni da annullare, più del massimo ${massimo}. Nessuna scrittura.`);
    process.exit(1);
  }
  const iso = new Date().toISOString();
  const esito = { ripristinate: 0, cambiate_nel_frattempo: 0, illeggibili: 0, errori: 0 };
  for (const t of tracce ?? []) {
    const prima = statoDaRegistro(t.valore_precedente);
    const dopo = statoDaRegistro(t.valore_nuovo);
    if (!prima || !dopo) { esito.illeggibili++; continue; }
    const { data: fatte, error: e1 } = await stessiSettori(
      db.from("radar_procedure").update({ settori: prima.settori, metodo_settore: prima.metodo, aggiornata_il: iso }).eq("id", t.procedura_id),
      dopo.settori,
    ).select("id");
    if (e1) { esito.errori++; continue; }
    if ((fatte ?? []).length === 0) { esito.cambiate_nel_frattempo++; continue; }
    await db.from("radar_aggiornamenti").upsert(
      { procedura_id: t.procedura_id, tipo: "correzione_dati", campo: "settori_ripristinati", valore_precedente: t.valore_nuovo, valore_nuovo: t.valore_precedente, fonte: FONTE_REGISTRO, id_fonte: `annullato:${t.id_fonte}:${iso}`.slice(0, 200), nota: "Correzione dei settori annullata: rimessi i settori di prima", notificabile: false },
      { onConflict: "procedura_id,tipo,campo,id_fonte", ignoreDuplicates: true },
    );
    esito.ripristinate++;
  }
  return esito;
}

async function main() {
  const [modo, m] = process.argv.slice(2);
  if (modo !== "prova" && modo !== "applica" && modo !== "annulla") {
    console.error("Uso: prova | applica <massimo> | annulla <massimo>");
    process.exit(2);
  }
  const massimo = Number(m);
  if (modo !== "prova" && !(Number.isInteger(massimo) && massimo > 0 && massimo <= 500)) {
    console.error("Indicare il numero massimo di gare (da 1 a 500).");
    process.exit(2);
  }
  if (modo !== "prova") await porta();
  const db = createClient(url, chiave, { auth: { persistSession: false, autoRefreshToken: false } });

  if (modo === "annulla") {
    console.log(`Annullamento delle correzioni con le regole ${VERSIONE_REGOLE_SETTORI}…`);
    console.log(JSON.stringify(await annulla(db, massimo)));
    return;
  }

  const { gare, lotti, correzioni, daDecidere } = await calcola(db);
  console.log(`Regole ${VERSIONE_REGOLE_SETTORI}. Archivio: ${gare} gare, ${lotti} lotti.`);
  console.log(`Gare che cambiano settore: ${correzioni.length} (fuori da tutti i settori: ${correzioni.filter((c) => c.dopo.settori.length === 0).length}).`);
  for (const c of correzioni) stampa(c);
  if (daDecidere.length) {
    console.log(`Gare che GUADAGNEREBBERO un settore (non si toccano, da decidere a parte): ${daDecidere.length}`);
    for (const d of daDecidere) console.log(`  ${d.gara.id.slice(0, 8)} ${JSON.stringify(d.prima.settori)} → ${JSON.stringify(d.dopo.settori)} ${d.gara.oggetto.slice(0, 100)}`);
  }
  if (modo === "prova") {
    console.log("Prova a vuoto: nessuna scrittura.");
    return;
  }
  if (correzioni.length > massimo) {
    console.error(`STOP: ${correzioni.length} correzioni, più del massimo autorizzato ${massimo}. Nessuna scrittura.`);
    process.exit(1);
  }
  console.log(JSON.stringify(await applica(db, correzioni)));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
