// Go-live (documento 59, richiesta dell'utente): la pubblicazione del codice NON attiva le acquisizioni senza un'autorizzazione esplicita.
// Configurazione ESATTA di produzione al momento del deploy (documento 57 §2.1 e verbale 56C):
//   - deploy di produzione (VERCEL_ENV=production) sul database di produzione;
//   - i 4 cron accesi (RADAR_<FONTE>_CRON=attivo), i permessi RADAR_<FONTE>_PRODUZIONE=autorizzata, il contatto RADAR_CONTATTO_FONTI;
//   - le 4 fonti come le lasciano le 17 migrazioni: attiva=false, cursore, blocco e date vuoti.
// Si simulano 7 giorni di cron con gli orari del rilascio (CRON_PROPOSTI = vercel.json del ramo di rilascio, documento 51 §3). Controlli:
//   A. a ogni orario che passa la porta, ogni importatore si ferma con «fonte_spenta»: ZERO richieste alla fonte (né la funzione di rete
//      passata né quella globale), nessuna scrittura su radar_fonti_stato (né blocco, né cursore, né aggiornata_il), nessun'altra tabella
//      toccata; l'unica scrittura è UNA riga «inerte» in radar_esecuzioni (più la pulizia oltre i 90 giorni, che non trova nulla);
//   B. la console «Fonti» vede le 4 fonti «spente», SENZA allarmi (né «giro_mancato», né errori, né registro mancante);
//   C. controprova: la stessa simulazione con UNA fonte accesa arriva alla fonte (la prova sa vedere un'acquisizione).
// Nessuna rete, nessun database vero: database in memoria e una funzione di rete che conta e rifiuta.
// Uso: npx tsx scripts/verifica-golive-blocco-iniziale.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbFinto, type Riga } from "./lib/db-finto-motore";
import { eseguiImportazioneTed } from "../src/lib/radar/importa-ted";
import { eseguiImportazionePvl } from "../src/lib/radar/importa-pvl";
import { eseguiImportazioneRegionale } from "../src/lib/radar/importa-regionali";
import { portaGiroProgrammato } from "../src/lib/radar/giro-programmato";
import { CRON_PROPOSTI, cronAttiviDa } from "../src/lib/radar/programmazione-calcoli";
import { allarmiFonti, type RigaEsecuzioneLetta, type RigaStatoFonte } from "../src/lib/radar/stato-fonti-calcoli";
import { FONTI_ESECUZIONI, type FonteEsecuzione } from "../src/lib/radar/esecuzioni-calcoli";

let ok = 0;
const fallimenti: string[] = [];
function controlla(nome: string, condizione: boolean, dettaglio?: unknown) {
  if (condizione) {
    ok++;
    console.log(`ok     ${nome}`);
  } else {
    fallimenti.push(nome);
    console.log(`FALLITO ${nome}${dettaglio === undefined ? "" : ` — ${JSON.stringify(dettaglio).slice(0, 600)}`}`);
  }
}

const PRODUZIONE: Record<string, string> = {
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://bihfrzspqxsrzlbqqvqa.supabase.co",
  RADAR_TED_CRON: "attivo",
  RADAR_PVL_CRON: "attivo",
  RADAR_SINTEL_CRON: "attivo",
  RADAR_SARDEGNACAT_CRON: "attivo",
  RADAR_PVL_PRODUZIONE: "autorizzata",
  RADAR_SINTEL_PRODUZIONE: "autorizzata",
  RADAR_SARDEGNACAT_PRODUZIONE: "autorizzata",
  RADAR_CONTATTO_FONTI: "contatto@esempio.invalid",
};

// le 4 righe come le lasciano 0109, 0112, 0115 e 0120 (+ la riga S1: SardegnaCAT visibile)
const STATO_DOPO_MIGRAZIONI: Riga[] = FONTI_ESECUZIONI.map((fonte) => ({
  fonte,
  attiva: false,
  cursore: null,
  ultimo_avvio_il: null,
  ultimo_successo_il: null,
  ultimo_errore: null,
  ultimo_errore_il: null,
  blocco_fino_a: null,
  dati_aggiornati_al: null,
  conteggi: {},
  nascosta_ai_clienti: false,
  aggiornata_il: "2026-11-24T18:00:00.000Z",
}));

// gli orari UTC dei cron (minuto, ore, giorni della settimana) dentro 7 giorni a partire da lunedì 30/11/2026
function orariDellaSettimana(cron: string): Date[] {
  const [min, ore, , , gs] = cron.split(" ");
  const giorni = gs === "*" ? [0, 1, 2, 3, 4, 5, 6] : gs === "1-5" ? [1, 2, 3, 4, 5] : gs.split(",").map(Number);
  const fuori: Date[] = [];
  for (let d = 0; d < 7; d++) {
    const giorno = new Date(Date.UTC(2026, 10, 30 + d));
    if (!giorni.includes(giorno.getUTCDay())) continue;
    for (const h of ore.split(",").map(Number)) fuori.push(new Date(Date.UTC(2026, 10, 30 + d, h, Number(min))));
  }
  return fuori;
}

// rapido = la controprova: una sola richiesta, nessuna pausa lunga (con la fonte spenta i limiti non contano: il giro si ferma prima)
function giro(fonte: FonteEsecuzione, db: DbFinto, adesso: Date, fetchFn: typeof fetch, rapido = false) {
  const admin = db as unknown as SupabaseClient;
  const comune = { env: PRODUZIONE, adesso: () => adesso, fetchFn };
  const limiti = rapido ? { pausaMs: 0, timeoutMs: 5_000, tentativi: 1, richiesteMassime: 1 } : undefined;
  if (fonte === "ted") return eseguiImportazioneTed(admin, { ...comune, tempoMassimoMs: rapido ? 5_000 : 240_000, pagineMassime: rapido ? 1 : 40, pausaMs: 0 });
  if (fonte === "pvl") return eseguiImportazionePvl(admin, { ...comune, modo: "incrementale", tempoMassimoMs: rapido ? 5_000 : 240_000, ...(limiti ? { limiti } : {}) });
  return eseguiImportazioneRegionale(admin, fonte, { ...comune, tempoMassimoMs: rapido ? 5_000 : 120_000, ...(limiti ? { limiti } : {}) });
}

/** Una settimana di cron su un database nuovo; accese = le fonti con attiva=true (controprova: solo il primo giro). */
async function settimana(accese: readonly FonteEsecuzione[]) {
  const soloIlPrimo = accese.length > 0;
  const db = new DbFinto();
  db.tabelle.radar_fonti_stato = STATO_DOPO_MIGRAZIONI.map((r) => ({ ...r, attiva: accese.includes(r.fonte as FonteEsecuzione) }));
  db.tabelle.radar_esecuzioni = [];
  const prima = JSON.stringify(db.tabelle.radar_fonti_stato);
  const rete: string[] = [];
  const reteVietata = (async (url: string | URL | Request) => {
    rete.push(String(url));
    throw new Error("rete vietata nella prova");
  }) as typeof fetch;
  const globale = globalThis.fetch;
  globalThis.fetch = reteVietata;
  const passaggi: { fonte: FonteEsecuzione; il: Date; motivo: string | null }[] = [];
  const richiesteFuoriPorta: number[] = [];
  try {
    for (const fonte of FONTI_ESECUZIONI) {
      for (const cron of CRON_PROPOSTI[fonte]) {
        for (const il of orariDellaSettimana(cron)) {
          const porta = portaGiroProgrammato(fonte, PRODUZIONE, il);
          const prima = db.richieste.length;
          if (!porta.passa) {
            // la rotta risponde prima di qualunque lettura del database (radar-<fonte>/route.ts)
            richiesteFuoriPorta.push(db.richieste.length - prima);
            continue;
          }
          if (soloIlPrimo && passaggi.some((p) => p.fonte === fonte)) continue;
          const r = (await giro(fonte, db, il, reteVietata, soloIlPrimo)) as { eseguita: boolean; motivo?: string };
          passaggi.push({ fonte, il, motivo: r.eseguita ? null : (r.motivo ?? null) });
        }
      }
    }
  } finally {
    globalThis.fetch = globale;
  }
  return { db, prima, rete, passaggi, richiesteFuoriPorta };
}

async function principale() {
  // ═════ A. fonti spente: nessuna acquisizione ═════
  const s = await settimana([]);
  const attesi = Object.fromEntries(FONTI_ESECUZIONI.map((f) => [f, 0])) as Record<FonteEsecuzione, number>;
  for (const p of s.passaggi) attesi[p.fonte]++;
  controlla(
    "A1. in 7 giorni la porta oraria fa passare i giri di ogni fonte (TED 10 nei feriali, PVL 21, Sintel 14, SardegnaCAT 4×5 + 1×2)",
    attesi.ted === 10 && attesi.pvl === 21 && attesi.sintel === 14 && attesi.sardegnacat === 22,
    attesi,
  );
  controlla("A2. ogni giro si ferma con «fonte_spenta»", s.passaggi.length > 0 && s.passaggi.every((p) => p.motivo === "fonte_spenta"), s.passaggi.filter((p) => p.motivo !== "fonte_spenta"));
  controlla("A3. ZERO richieste alla fonte (funzione di rete del giro e fetch globale)", s.rete.length === 0, s.rete);
  controlla("A4. radar_fonti_stato IDENTICA a prima: nessun blocco, cursore, ultimo_avvio_il o aggiornata_il scritto", JSON.stringify(s.db.tabelle.radar_fonti_stato) === s.prima);
  const scritture = s.db.richieste.filter((r) => r.metodo !== "select");
  const perTabella = (t: string, m: string) => s.db.richieste.filter((r) => r.tabella === t && r.metodo === m).length;
  controlla(
    "A5. le uniche scritture: per ogni giro UNA riga in radar_esecuzioni e la pulizia oltre i 90 giorni; nessun update, upsert o altra tabella",
    scritture.every((r) => r.tabella === "radar_esecuzioni" && (r.metodo === "insert" || r.metodo === "delete")) &&
      perTabella("radar_esecuzioni", "insert") === s.passaggi.length &&
      perTabella("radar_esecuzioni", "delete") === s.passaggi.length,
    scritture.filter((r) => r.tabella !== "radar_esecuzioni"),
  );
  controlla(
    "A6. le sole letture: lo stato della fonte (radar_fonti_stato)",
    s.db.richieste.filter((r) => r.metodo === "select").every((r) => r.tabella === "radar_fonti_stato"),
    [...new Set(s.db.richieste.map((r) => `${r.tabella}:${r.metodo}`))],
  );
  const righe = s.db.t("radar_esecuzioni");
  controlla(
    "A7. il registro: una riga «inerte» per giro, origine «programmato», nessun conteggio di richieste alla fonte",
    righe.length === s.passaggi.length && righe.every((r) => r.esito === "inerte" && (r.finestre as { origine?: string } | null)?.origine === "programmato" && Number(r.fonte_richieste) === 0),
    righe.slice(0, 2),
  );
  controlla("A8. fuori dall'orario la rotta non tocca il database (zero richieste)", s.richiesteFuoriPorta.length > 0 && s.richiesteFuoriPorta.every((n) => n === 0));

  // ═════ B. la console «Fonti» il giorno dopo ═════
  const adesso = new Date("2026-12-07T10:00:00.000Z");
  const situazioni = allarmiFonti(righe as unknown as RigaEsecuzioneLetta[], s.db.tabelle.radar_fonti_stato as unknown as RigaStatoFonte[], adesso, { cronAttivi: cronAttiviDa(PRODUZIONE) });
  controlla("B1. la console vede le 4 fonti «spente»", situazioni.length === 4 && situazioni.every((x) => x.stato === "spenta" && !x.attiva), situazioni.map((x) => [x.fonte, x.stato]));
  controlla("B2. nessun allarme (né «giro_mancato», né errori ripetuti, né registro mancante)", situazioni.every((x) => x.allarmi.length === 0), situazioni.map((x) => [x.fonte, x.allarmi.map((a) => a.codice)]));

  // ═════ C. controprova: con UNA fonte accesa il suo primo giro programmato arriva alla fonte ═════
  for (const fonte of FONTI_ESECUZIONI) {
    const c = await settimana([fonte]);
    const altre = c.passaggi.filter((p) => p.fonte !== fonte);
    controlla(
      `C. controprova ${fonte} accesa: il giro chiede alla fonte (${c.rete.length} richieste rifiutate) e scrive lo stato; le altre restano «fonte_spenta»`,
      c.rete.length > 0 && JSON.stringify(c.db.tabelle.radar_fonti_stato) !== c.prima && altre.every((p) => p.motivo === "fonte_spenta"),
      { rete: c.rete.length, motivi: [...new Set(c.passaggi.map((p) => `${p.fonte}:${p.motivo}`))] },
    );
  }

  console.log(`\nVerifica go-live, blocco iniziale (fonti spente con cron e permessi creati): ${ok} ok, ${fallimenti.length} falliti`);
  if (fallimenti.length > 0) process.exit(1);
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
