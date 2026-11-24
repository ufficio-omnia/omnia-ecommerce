// Verifica di K4 (piano 48C; L1 del piano 36 v2; riduzione della rilettura del 49C §4): cursore PVL v2, recupero dei 90 giorni, buchi,
// completezza dei blocchi, tetto = giro incompleto (S3). Tutto in memoria, dati SINTETICI, nessuna rete.
// Uso: npx tsx scripts/verifica-radar-pvl-recupero.ts → codice 0 se tutto passa.
import {
  CONTEGGIO_ATTENDIBILE,
  GIORNI_OBIETTIVO_RECUPERO,
  MASSIMO_BUCHI,
  RICHIESTE_RECUPERO_PER_GIRO,
  TENTATIVI_BLOCCO,
  aggiungiBuco,
  allarmiCursorePvl,
  bloccoDaLeggere,
  conFinestra,
  conIncrementale,
  dopoPaginaFinestra,
  cursorePvlDaSalvato,
  cursorePvlNuovo,
  cursorePvlV2Valido,
  dopoPaginaIncrementale,
  dopoPaginaRecupero,
  giorniNeiBuchi,
  giorniObiettivoResidui,
  riprendiRecupero,
  togliDaiBuchi,
  type BucoPvl,
  type CursorePvlV2,
} from "../src/lib/radar/importa-pvl-cursore";
import { aggiungiGiorni } from "../src/lib/radar/importa-ted-calcoli";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { FONTI_ESECUZIONI } from "../src/lib/radar/esecuzioni-calcoli";
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

const I = "2026-11-23T07:05:00.000Z";
const giorni = (da: string, a: string) => {
  const out: string[] = [];
  for (let g = da; g <= a; g = aggiungiGiorni(g, 1)) out.push(g);
  return out;
};

// ═════ regole pure ═════
function provaRegole(): void {
  const n = cursorePvlNuovo("2026-11-23");
  controlla("cursore nuovo: obiettivo dei 90 giorni = da oggi meno 89 a oggi meno 2 (ieri e oggi li legge l'incrementale)", n.recupero.obiettivoDa === "2026-08-26" && n.recupero.prossimoA === "2026-11-21" && GIORNI_OBIETTIVO_RECUPERO === 90 && giorniObiettivoResidui(n) === 88, n.recupero);
  controlla("cursore nuovo: valido per la propria validazione, anche dopo JSON (come nel database)", cursorePvlV2Valido(JSON.parse(JSON.stringify(n))) !== null);

  // conversione dalla v1
  const v1 = { versione: 1, modo: "incrementale", inCorso: true, da: "2026-11-21", a: "2026-11-23", token: "T9", pagine: 2, ultimoGiorno: "2026-11-22" };
  const conv = cursorePvlDaSalvato(v1, "2026-11-23");
  controlla("conversione dalla v1: ultimoGiorno conservato, incrementale a metà conservato col suo token, obiettivo dei 90 giorni", conv.versione === 2 && conv.ultimoGiorno === "2026-11-22" && conv.incrementale?.token === "T9" && conv.incrementale.pagine === 2 && conv.inCorso && conv.recupero.obiettivoDa === "2026-08-26", conv);
  const convF = cursorePvlDaSalvato({ ...v1, modo: "finestra" }, "2026-11-23");
  controlla("conversione dalla v1: finestra a metà conservata come finestra", convF.finestra?.token === "T9" && convF.incrementale === null);
  const convFinito = cursorePvlDaSalvato({ ...v1, inCorso: false, token: null }, "2026-11-23");
  controlla("conversione dalla v1: giro finito → nessuna lettura a metà, ultimoGiorno conservato", !convFinito.inCorso && convFinito.ultimoGiorno === "2026-11-22");
  controlla("cursore illeggibile o assente → nuovo", cursorePvlDaSalvato(null, "2026-11-23").ultimoGiorno === null && cursorePvlDaSalvato({ versione: 7 }, "2026-11-23").recupero.obiettivoDa === "2026-08-26");
  const rotti: [string, (c: CursorePvlV2) => unknown][] = [
    ["data impossibile", (c) => ({ ...c, ultimoGiorno: "2026-13-40" })],
    ["obiettivo senza prossimoA", (c) => ({ ...c, recupero: { ...c.recupero, prossimoA: null } })],
    ["blocco al terzo tentativo", (c) => ({ ...c, recupero: { ...c.recupero, blocco: { da: "2026-11-01", a: "2026-11-07", token: null, pagine: 0, dichiarati: null, letti: 0, origine: "obiettivo", tentativi: TENTATIVI_BLOCCO } } })],
    ["troppi buchi", (c) => ({ ...c, buchi: Array.from({ length: MASSIMO_BUCHI + 1 }, () => ({ da: "2026-01-01", a: "2026-01-01", motivo: "fermo", rilevato_il: I })) })],
    ["token troppo lungo", (c) => ({ ...c, incrementale: { da: "2026-11-22", a: "2026-11-23", token: "x".repeat(501), pagine: 1, dichiarati: 1, letti: 1 } })],
    ["intervallo rovesciato", (c) => ({ ...c, buchi: [{ da: "2026-11-05", a: "2026-11-01", motivo: "fermo", rilevato_il: I }] })],
  ];
  for (const [nome, rompi] of rotti) controlla(`validazione v2: «${nome}» → non valido (si riparte con un cursore nuovo)`, cursorePvlV2Valido(rompi(n)) === null);

  // incrementale e riduzione della rilettura (49C §4, con la condizione del coordinamento)
  const ieri = { ...n, ultimoGiorno: "2026-11-22" };
  controlla("primo giro del giorno: dall'ultimo giorno letto MENO UNO a oggi (sovrapposizione per gli avvisi pubblicati in ritardo)", conIncrementale(ieri, "2026-11-23", I).incrementale?.da === "2026-11-21");
  controlla("giri dopo, nello stesso giorno (un giro di oggi è già finito): solo il giorno in corso", conIncrementale({ ...n, ultimoGiorno: "2026-11-23" }, "2026-11-23", I).incrementale?.da === "2026-11-23");
  const g = (u: string | null) => conIncrementale({ ...n, ultimoGiorno: u }, "2026-11-23", I);
  controlla("dopo 7 giorni di fermo: ancora tutto nell'incrementale, nessun buco", g("2026-11-17").incrementale?.da === "2026-11-16" && g("2026-11-17").buchi.length === 0);
  const otto = g("2026-11-15");
  controlla("dopo 8 giorni di fermo: incrementale da oggi meno 7, il giorno in più nei buchi («fermo»)", otto.incrementale?.da === "2026-11-16" && JSON.stringify(otto.buchi.map((b) => [b.da, b.a, b.motivo])) === '[["2026-11-14","2026-11-15","fermo"]]', otto.buchi);
  controlla("incrementale a metà: continua col suo token, senza buchi nuovi", conIncrementale({ ...otto, ultimoGiorno: "2026-01-01" }, "2026-11-23", I).buchi.length === 1);
  const fine = dopoPaginaIncrementale(conIncrementale(ieri, "2026-11-23", I), 7, 7, null, 100);
  controlla("incrementale finito: ultimoGiorno = oggi, nessuna lettura a metà", fine.ultimoGiorno === "2026-11-23" && fine.incrementale === null && !fine.inCorso);
  const finestraLontana = dopoPaginaFinestra(conFinestra({ ...n, ultimoGiorno: "2026-10-01" }, "2026-11-01", "2026-11-05"), 3, 3, null, 100);
  const finestraContigua = dopoPaginaFinestra(conFinestra({ ...n, ultimoGiorno: "2026-10-31" }, "2026-11-01", "2026-11-05"), 3, 3, null, 100);
  controlla("finestra controllata NON contigua: non sposta l'ultimo giorno letto (il salto lo coprono buchi e obiettivo); contigua sì", finestraLontana.ultimoGiorno === "2026-10-01" && finestraContigua.ultimoGiorno === "2026-11-05" && finestraLontana.finestra === null, [finestraLontana.ultimoGiorno, finestraContigua.ultimoGiorno]);

  // buchi
  const b = (da: string, a: string, motivo: BucoPvl["motivo"] = "fermo"): BucoPvl => ({ da, a, motivo, rilevato_il: I });
  controlla("buchi: si uniscono se si toccano o si sovrappongono; un blocco incompleto prevale nel motivo", JSON.stringify(aggiungiBuco([b("2026-11-01", "2026-11-03")], b("2026-11-04", "2026-11-06", "blocco_incompleto")).map((x) => [x.da, x.a, x.motivo])) === '[["2026-11-01","2026-11-06","blocco_incompleto"]]');
  controlla("buchi: separati restano separati, in ordine", aggiungiBuco([b("2026-11-10", "2026-11-12")], b("2026-11-01", "2026-11-03")).map((x) => x.da).join() === "2026-11-01,2026-11-10");
  let molti: BucoPvl[] = [];
  for (let i = 0; i < 60; i++) molti = aggiungiBuco(molti, b(aggiungiGiorni("2026-01-01", i * 3), aggiungiGiorni("2026-01-01", i * 3)));
  const giorniPrima = new Set(Array.from({ length: 60 }, (_, i) => aggiungiGiorni("2026-01-01", i * 3)));
  controlla("buchi: al massimo 50; oltre si uniscono i più vicini, senza perdere nessun giorno", molti.length === MASSIMO_BUCHI && [...giorniPrima].every((d) => molti.some((x) => x.da <= d && d <= x.a)), molti.length);
  controlla("buchi: un periodo letto si toglie (anche a metà di un buco, che si divide in due)", JSON.stringify(togliDaiBuchi([b("2026-11-01", "2026-11-10")], "2026-11-04", "2026-11-06").map((x) => [x.da, x.a])) === '[["2026-11-01","2026-11-03"],["2026-11-07","2026-11-10"]]');

  // blocchi di recupero
  const conBuchi = { ...n, buchi: [b("2026-10-01", "2026-10-03"), b("2026-11-01", "2026-11-20")] };
  const primoBlocco = bloccoDaLeggere(conBuchi);
  controlla("recupero: prima i buchi, dal più recente; blocchi di 7 giorni", primoBlocco?.origine === "buco" && primoBlocco.da === "2026-11-14" && primoBlocco.a === "2026-11-20", primoBlocco);
  const ob = bloccoDaLeggere(n);
  controlla("recupero: poi l'obiettivo, dal giorno più recente", ob?.origine === "obiettivo" && ob.da === "2026-11-15" && ob.a === "2026-11-21", ob);
  const conBlocco = (c: CursorePvlV2) => ({ ...c, recupero: { ...c.recupero, blocco: bloccoDaLeggere(c) } });
  const c0 = conBlocco(n);
  const completo = dopoPaginaRecupero(c0, c0.recupero.blocco!, 40, 40, null, 100, I);
  controlla("blocco completo (letti = dichiarati): l'obiettivo avanza all'indietro, esito registrato", completo.esito === "completo" && completo.cursore.recupero.prossimoA === "2026-11-14" && completo.cursore.recupero.blocco === null && completo.bloccoLetto?.completo === true && completo.cursore.completezza.length === 1, completo.cursore.recupero);
  const incompleto = dopoPaginaRecupero(c0, c0.recupero.blocco!, 38, 40, null, 100, I);
  controlla("blocco incompleto (letti ≠ dichiarati): NON segnato come fatto, si ritenta da capo (tentativi 1)", incompleto.esito === "incompleto" && incompleto.cursore.recupero.prossimoA === "2026-11-21" && incompleto.cursore.recupero.blocco?.tentativi === 1 && incompleto.cursore.recupero.blocco.token === null && incompleto.bloccoLetto?.completo === false);
  const senzaConteggio = dopoPaginaRecupero(c0, c0.recupero.blocco!, 40, null, null, 100, I);
  controlla("blocco senza conteggio dichiarato: non verificabile → incompleto", senzaConteggio.esito === "incompleto");
  let t = incompleto.cursore;
  for (let i = 1; i < TENTATIVI_BLOCCO; i++) t = dopoPaginaRecupero(t, t.recupero.blocco!, 38, 40, null, 100, I).cursore;
  controlla("terzo tentativo incompleto: il blocco resta tra i buchi («blocco_incompleto»), il recupero si FERMA, l'obiettivo va oltre", t.recupero.fermo !== null && t.recupero.blocco === null && t.buchi.some((x) => x.da === "2026-11-15" && x.a === "2026-11-21" && x.motivo === "blocco_incompleto") && t.recupero.prossimoA === "2026-11-14" && bloccoDaLeggere(t) === null, t);
  controlla("allarmi del cursore: buco_in_recupero e blocco_incompleto", JSON.stringify(allarmiCursorePvl(t)) === '["buco_in_recupero","blocco_incompleto"]' && allarmiCursorePvl(n).length === 0);
  const ripreso = riprendiRecupero(t);
  controlla("ripresa esplicita: si ritenta il blocco tra i buchi", ripreso.recupero.fermo === null && bloccoDaLeggere(ripreso)?.da === "2026-11-15");
  const pieno = dopoPaginaRecupero(c0, c0.recupero.blocco!, 100, 1500, "TK", 100, I);
  controlla(`prima pagina con ${CONTEGGIO_ATTENDIBILE} o più avvisi dichiarati: il blocco si DIMEZZA (resta la metà più recente; il resto resta da leggere)`, pieno.esito === "dimezzato" && pieno.cursore.recupero.blocco?.da === "2026-11-18" && pieno.cursore.recupero.blocco.a === "2026-11-21" && pieno.cursore.recupero.blocco.token === null && pieno.cursore.recupero.prossimoA === "2026-11-21", pieno.cursore.recupero);
  const continua = dopoPaginaRecupero(c0, c0.recupero.blocco!, 100, 150, "TK", 100, I);
  controlla("pagina piena con token: il blocco continua dal token", continua.esito === "continua" && continua.cursore.recupero.blocco?.token === "TK" && continua.cursore.recupero.blocco.letti === 100);
  const buco = conBlocco(conBuchi);
  const bucoFatto = dopoPaginaRecupero(buco, buco.recupero.blocco!, 5, 5, null, 100, I).cursore;
  controlla("blocco di un buco completo: il buco si accorcia, l'obiettivo NON si muove", JSON.stringify(bucoFatto.buchi.map((x) => [x.da, x.a])) === '[["2026-10-01","2026-10-03"],["2026-11-01","2026-11-13"]]' && bucoFatto.recupero.prossimoA === "2026-11-21");
  let ultimo = conBlocco({ ...n, recupero: { ...n.recupero, prossimoA: "2026-08-28" } });
  ultimo = dopoPaginaRecupero(ultimo, ultimo.recupero.blocco!, 1, 1, null, 100, I).cursore;
  controlla("ultimo blocco dell'obiettivo: obiettivo finito", ultimo.recupero.obiettivoDa === null && ultimo.recupero.prossimoA === null && bloccoDaLeggere(ultimo) === null && giorniObiettivoResidui(ultimo) === 0);
}

// ═════ proprietà: nessun giorno perso (fermi di 3, 7, 8, 30, 120 giorni, date casuali) ═════
function casuale(seme: number) {
  let s = seme >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function provaProprieta(): void {
  const rnd = casuale(20261123);
  const violazioni: string[] = [];
  let simulazioni = 0;
  for (const fermo of [3, 7, 8, 30, 120]) {
    for (let k = 0; k < 12; k++) {
      simulazioni++;
      const inizio = aggiungiGiorni("2026-01-01", Math.floor(rnd() * 600));
      const pIncompleto = k % 2 === 0 ? 0 : 0.15; // metà delle simulazioni con blocchi incompleti
      let c = cursorePvlNuovo(inizio);
      const letti = new Set<string>();
      const giorniSim = 10 + fermo + 120;
      for (let d = 0; d < giorniSim; d++) {
        const oggi = aggiungiGiorni(inizio, d);
        if (d >= 10 && d < 10 + fermo) continue; // fermo: nessun giro
        for (let giro = 0; giro < 3; giro++) {
          if (rnd() < 0.1) continue; // giro saltato
          c = conIncrementale(c, oggi, `${oggi}T07:05:00.000Z`);
          const inc = c.incrementale!;
          c = dopoPaginaIncrementale(c, 1, 1, null, 100);
          for (const x of giorni(inc.da, inc.a)) letti.add(x);
          let richieste = 0;
          while (richieste < RICHIESTE_RECUPERO_PER_GIRO) {
            const b = bloccoDaLeggere(c);
            if (!b) break;
            c = { ...c, recupero: { ...c.recupero, blocco: b } };
            richieste++;
            const incompleto = rnd() < pIncompleto;
            const r = dopoPaginaRecupero(c, b, incompleto ? 2 : 3, 3, null, 100, `${oggi}T07:05:00.000Z`);
            c = r.cursore;
            if (r.esito === "completo") for (const x of giorni(b.da, b.a)) letti.add(x);
            if (r.esito === "incompleto" || r.esito === "fermo") break;
          }
          if (richieste > RICHIESTE_RECUPERO_PER_GIRO) violazioni.push(`budget superato ${richieste}`);
          // invariante: ogni giorno dall'inizio dell'obiettivo a oggi è letto, oppure tra i buchi, oppure nell'obiettivo residuo, oppure nel blocco in corso
          const residuo = c.recupero.obiettivoDa && c.recupero.prossimoA ? [c.recupero.obiettivoDa, c.recupero.prossimoA] : null;
          const bl = c.recupero.blocco;
          for (const x of giorni(aggiungiGiorni(inizio, -(GIORNI_OBIETTIVO_RECUPERO - 1)), oggi)) {
            const coperto = letti.has(x) || c.buchi.some((y) => y.da <= x && x <= y.a) || (residuo && residuo[0] <= x && x <= residuo[1]) || (bl && bl.da <= x && x <= bl.a);
            if (!coperto && violazioni.length < 5) violazioni.push(`fermo ${fermo}, inizio ${inizio}, oggi ${oggi}: giorno ${x} PERSO`);
          }
          if (!cursorePvlV2Valido(JSON.parse(JSON.stringify(c))) && violazioni.length < 5) violazioni.push(`cursore non valido il ${oggi}`);
        }
        if (c.recupero.fermo && pIncompleto > 0) c = riprendiRecupero(c); // la console riprende il recupero (in pratica: dopo una verifica)
      }
      if (pIncompleto === 0) {
        const fineSim = aggiungiGiorni(inizio, giorniSim - 1);
        const mancanti = giorni(aggiungiGiorni(inizio, -(GIORNI_OBIETTIVO_RECUPERO - 1)), fineSim).filter((x) => !letti.has(x));
        if (mancanti.length && violazioni.length < 5) violazioni.push(`fermo ${fermo}, inizio ${inizio}: a fine simulazione non letti ${mancanti.length} giorni (${mancanti.slice(0, 3).join(",")}…), buchi ${giorniNeiBuchi(c)}, obiettivo ${giorniObiettivoResidui(c)}`);
      }
    }
  }
  controlla(`proprietà L1 su ${simulazioni} simulazioni (fermi di 3, 7, 8, 30, 120 giorni, date casuali, giri saltati, blocchi incompleti): nessun giorno perso; budget mai superato; senza blocchi incompleti alla fine è tutto letto`, violazioni.length === 0, violazioni);
}

// ═════ giri PVL veri in memoria, con una PVL finta ═════
const STAGING = { NEXT_PUBLIC_SUPABASE_URL: "https://ryawdldqiumqsskrnyps.supabase.co" };
// la pausa minima tra le richieste PVL è di 2 s: l'orologio della prova avanza di 3 s a ogni richiesta, così la prova non aspetta
const adessoVero = Date.now.bind(Date);
let avanti = 0;
Date.now = () => adessoVero() + avanti;

type Richiesta = { da: string; a: string; token: string | null };
function pvlFinta(opzioni: { perGiorno?: number; mancanti?: (r: Richiesta) => number; dichiaratiExtra?: (r: Richiesta) => number; pagineInfinite?: boolean } = {}) {
  const richieste: Richiesta[] = [];
  const perGiorno = opzioni.perGiorno ?? 1;
  const g = (s: string | null) => (s ? `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}` : "");
  const fetchFn = (async (url: string | URL) => {
    avanti += 3_000;
    const p = new URL(String(url)).searchParams;
    const r: Richiesta = { da: g(p.get("dataPubblicazioneStart")), a: g(p.get("dataPubblicazioneEnd")), token: p.get("tokenPaginazione") };
    richieste.push(r);
    const dimensione = Number(p.get("pageSize"));
    if (opzioni.pagineInfinite) return new Response(JSON.stringify({ content: Array.from({ length: dimensione }, (_, i) => ({ idAvviso: `inf-${richieste.length}-${i}` })), count: null, lastPaginationToken: `t${richieste.length}` }), { status: 200, headers: { "content-type": "application/json" } });
    const tutti = giorni(r.da, r.a).flatMap((d) => Array.from({ length: perGiorno }, (_, i) => ({ idAvviso: `sint-${d}-${i}` })));
    const offset = r.token ? Number(r.token.slice(1)) : 0;
    const pagina = tutti.slice(offset, offset + dimensione).slice(0, Math.max(0, Math.min(dimensione, tutti.length - offset) - (opzioni.mancanti?.(r) ?? 0)));
    const token = offset + dimensione < tutti.length ? `o${offset + dimensione}` : null;
    return new Response(JSON.stringify({ content: pagina, count: tutti.length + (opzioni.dichiaratiExtra?.(r) ?? 0), lastPaginationToken: token }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { richieste, fetchFn };
}
function mondo(cursore: unknown = null, ultimoSuccesso: string | null = null): DbFinto {
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = FONTI_ESECUZIONI.map((f) => ({ fonte: f, attiva: f === "pvl", ultimo_successo_il: f === "pvl" ? ultimoSuccesso : null, cursore: f === "pvl" ? cursore : null, blocco_fino_a: null, conteggi: {}, nascosta_ai_clienti: false }));
  return db;
}
const statoPvl = (db: DbFinto) => db.t("radar_fonti_stato").find((r) => r.fonte === "pvl")!;
const cursoreDb = (db: DbFinto) => cursorePvlV2Valido(JSON.parse(JSON.stringify(statoPvl(db).cursore)));
const T0 = new Date("2026-11-23T07:05:00Z");
async function giro(db: DbFinto, fetchFn: typeof fetch, extra: { richiesteMassime?: number; adesso?: Date } = {}) {
  const adesso = extra.adesso ?? T0;
  return eseguiImportazionePvl(db as unknown as SupabaseClient, { modo: "incrementale", tempoMassimoMs: 600_000, env: STAGING, adesso: () => adesso, fetchFn, origine: "script", limiti: { avvisiPerPagina: 10, ...(extra.richiesteMassime ? { richiesteMassime: extra.richiesteMassime } : {}) } });
}
const chiave = (r: Richiesta) => `${r.da}/${r.a}${r.token ? `@${r.token}` : ""}`;

async function provaGiri(): Promise<void> {
  // A. cursore nuovo: incrementale per primo, poi 5 richieste di recupero dal più recente
  const dbA = mondo();
  const pA = pvlFinta();
  const rA = await giro(dbA, pA.fetchFn);
  const attese = ["2026-11-22/2026-11-23", "2026-11-15/2026-11-21", "2026-11-08/2026-11-14", "2026-11-01/2026-11-07", "2026-10-25/2026-10-31", "2026-10-18/2026-10-24"];
  controlla("giro con cursore nuovo: PRIMA l'incrementale (ieri e oggi), POI 5 richieste di recupero a blocchi di 7 giorni dal più recente", JSON.stringify(pA.richieste.map(chiave)) === JSON.stringify(attese), pA.richieste.map(chiave));
  const cA = cursoreDb(dbA);
  controlla("dopo il giro: cursore v2 valido nel database, obiettivo avanzato a 10-17, 5 blocchi completi", !!cA && cA.recupero.prossimoA === "2026-10-17" && cA.completezza.length === 5 && cA.completezza.every((x) => x.completo) && cA.ultimoGiorno === "2026-11-23", cA);
  const regA = dbA.t("radar_esecuzioni")[0] as { esito?: string; allarmi?: string[]; finestre?: { recupero?: { richieste: number; giorni_obiettivo: number }; giro_finito?: boolean } };
  controlla("registro: esito «ok», giro finito, recupero con 5 richieste e i giorni dell'obiettivo rimasti; nessun allarme", rA.eseguita && regA.esito === "ok" && regA.finestre?.giro_finito === true && regA.finestre?.recupero?.richieste === 5 && regA.finestre?.recupero?.giorni_obiettivo === 53 && (regA.allarmi ?? []).length === 0, regA);
  controlla("giro finito: ultimo successo aggiornato", typeof statoPvl(dbA).ultimo_successo_il === "string");

  // A2. secondo giro dello stesso giorno: solo oggi (49C), poi il recupero continua da dove era
  const pA2 = pvlFinta();
  await giro(dbA, pA2.fetchFn, { adesso: new Date("2026-11-23T12:05:00Z") });
  controlla("secondo giro dello stesso giorno: incrementale SOLO oggi (49C §4), poi il recupero continua dal blocco dopo", pA2.richieste[0] && chiave(pA2.richieste[0]) === "2026-11-23/2026-11-23" && chiave(pA2.richieste[1]) === "2026-10-11/2026-10-17", pA2.richieste.map(chiave));
  // fino alla fine dell'obiettivo: 88 giorni = 13 blocchi in tutto
  const pA3 = pvlFinta();
  await giro(dbA, pA3.fetchFn, { adesso: new Date("2026-11-23T17:05:00Z") });
  const cA3 = cursoreDb(dbA);
  const recuperoTotale = 5 + (pA2.richieste.length - 1) + (pA3.richieste.length - 1);
  controlla("obiettivo dei 90 giorni finito in 3 giri, con 13 richieste di recupero (≈ 15 del piano)", cA3?.recupero.obiettivoDa === null && recuperoTotale === 13 && giorniObiettivoResidui(cA3!) === 0, { recuperoTotale, recupero: cA3?.recupero });

  // B. fermo di 20 giorni (cursore v1 dello staging): buco, allarme, recupero dei buchi prima dell'obiettivo
  const v1 = { versione: 1, modo: "incrementale", inCorso: false, da: "2026-11-02", a: "2026-11-03", token: null, pagine: 1, ultimoGiorno: "2026-11-03" };
  const dbB = mondo(v1);
  const pB = pvlFinta();
  await giro(dbB, pB.fetchFn);
  const cB = cursoreDb(dbB);
  controlla("fermo di 20 giorni: incrementale degli ultimi 8 giorni, poi i due blocchi del buco (dal più recente), poi l'obiettivo", JSON.stringify(pB.richieste.slice(0, 4).map(chiave)) === JSON.stringify(["2026-11-16/2026-11-23", "2026-11-09/2026-11-15", "2026-11-02/2026-11-08", "2026-11-15/2026-11-21"]), pB.richieste.map(chiave));
  const regB = dbB.t("radar_esecuzioni")[0] as { allarmi?: string[] };
  controlla("fermo: il buco è segnalato nel registro («buco_in_recupero») anche se recuperato nello stesso giro; buchi vuoti alla fine", (regB.allarmi ?? []).includes("buco_in_recupero") && cB?.buchi.length === 0 && cB.ultimoGiorno === "2026-11-23", { allarmi: regB.allarmi, buchi: cB?.buchi });

  // C. tetto del giro durante il recupero: nessun errore, il recupero si ferma al tetto
  const dbC = mondo();
  const pC = pvlFinta();
  const rC = await giro(dbC, pC.fetchFn, { richiesteMassime: 3 });
  controlla("tetto di 3 richieste: 1 incrementale + 2 di recupero, giro finito senza errori (il recupero non supera mai il tetto)", pC.richieste.length === 3 && rC.eseguita && rC.giroFinito && !rC.errore, { n: pC.richieste.length, rC });

  // D. tetto durante l'incrementale (S3): ok ma incompleto, ultimo successo NON aggiornato, ripresa dal token
  const dbD = mondo(null, "2026-11-22T17:06:00.000Z");
  const pD = pvlFinta({ pagineInfinite: true });
  const rD = await giro(dbD, pD.fetchFn, { richiesteMassime: 2 });
  const regD = dbD.t("radar_esecuzioni")[0] as { esito?: string; finestre?: { giro_finito?: boolean } };
  controlla("S3: giro fermato dal tetto → esito «ok», giro NON finito, nessuna richiesta di recupero, ultimo successo invariato, token salvato", rD.eseguita && !rD.errore && !rD.giroFinito && pD.richieste.length === 2 && regD.esito === "ok" && regD.finestre?.giro_finito === false && statoPvl(dbD).ultimo_successo_il === "2026-11-22T17:06:00.000Z" && !!cursoreDb(dbD)?.incrementale?.token, { rD, reg: regD, cursore: cursoreDb(dbD) });

  // E. blocco incompleto per 3 giri: si ritenta al giro dopo, poi resta tra i buchi e il recupero si ferma; l'incrementale continua
  const manca = (r: Richiesta) => (r.da === "2026-11-15" && r.a === "2026-11-21" ? 1 : 0);
  const dbE = mondo();
  const esitiE: string[] = [];
  for (let i = 0; i < 4; i++) {
    const p = pvlFinta({ mancanti: manca });
    await giro(dbE, p.fetchFn, { adesso: new Date(T0.getTime() + i * 5 * 3_600_000) });
    esitiE.push(p.richieste.map(chiave).join(" "));
  }
  const cE = cursoreDb(dbE);
  const regE = dbE.t("radar_esecuzioni").at(-1) as { allarmi?: string[] };
  controlla("blocco incompleto: ritentato nei giri 2 e 3, poi tra i buchi e recupero FERMO; il giro 4 fa solo l'incrementale", esitiE[0].endsWith("2026-11-15/2026-11-21") && esitiE[1].endsWith("2026-11-15/2026-11-21") && esitiE[2].endsWith("2026-11-15/2026-11-21") && esitiE[3].split(" ").length === 1 && !!cE && cE.recupero.fermo !== null && cE.buchi.some((b) => b.motivo === "blocco_incompleto"), { esitiE, recupero: cE?.recupero, buchi: cE?.buchi });
  controlla("blocco incompleto: il registro lo segnala («blocco_incompleto», «buco_in_recupero»)", ["blocco_incompleto", "buco_in_recupero"].every((a) => (regE.allarmi ?? []).includes(a)), regE.allarmi);

  // F. conteggio da 1.000 in su: il blocco si dimezza e si rilegge la metà più recente
  const dbF = mondo();
  const pF = pvlFinta({ dichiaratiExtra: (r) => (r.da === "2026-11-15" && r.a === "2026-11-21" ? 1_200 : 0) });
  await giro(dbF, pF.fetchFn);
  controlla("1.000 avvisi dichiarati o più: blocco dimezzato (4 giorni più recenti), poi i 3 giorni rimasti", JSON.stringify(pF.richieste.slice(1, 4).map(chiave)) === JSON.stringify(["2026-11-15/2026-11-21", "2026-11-18/2026-11-21", "2026-11-11/2026-11-17"]), pF.richieste.map(chiave));

  // G. blocco di recupero a metà e giro nuovo: l'incrementale passa comunque per primo
  const aMeta = cursorePvlNuovo("2026-11-23", "2026-11-22");
  const conBlocco = { ...aMeta, recupero: { ...aMeta.recupero, blocco: { da: "2026-11-15", a: "2026-11-21", token: "o10", pagine: 1, dichiarati: 14, letti: 10, origine: "obiettivo" as const, tentativi: 0 } } };
  const dbG = mondo(conBlocco);
  const pG = pvlFinta();
  await giro(dbG, pG.fetchFn);
  controlla("blocco di recupero a metà: prima l'incrementale, poi il blocco riprende dal SUO token", chiave(pG.richieste[0]) === "2026-11-21/2026-11-23" && chiave(pG.richieste[1]) === "2026-11-15/2026-11-21@o10", pG.richieste.map(chiave));
}

async function principale(): Promise<void> {
  provaRegole();
  provaProprieta();
  await provaGiri();
}
principale()
  .catch((e) => falliti.push(`eccezione: ${e instanceof Error ? e.stack ?? e.message : String(e)}`))
  .finally(() => {
    console.log(`Verifica del cursore PVL v2 e del recupero (K4): ${ok} ok, ${falliti.length} falliti`);
    for (const f of falliti) console.log(`  FALLITO: ${f}`);
    process.exit(falliti.length ? 1 : 0);
  });
