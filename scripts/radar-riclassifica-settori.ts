// SCRIPT UNICO e idempotente di riclassificazione delle gare in archivio e di POPOLAMENTO della 0121 (fase B2b, 17/11/2026; sostituisce la
// riclassificazione della PVL, che toglieva soltanto). SOLO contro lo staging. Calcolo in src/lib/radar/riclassifica-settori.ts, letture e
// scritture in src/lib/radar/riclassificazione.ts.
//
// Per ogni gara (con i lotti), regole correnti: colonna «settori» e «metodo_settore» COERENTI con le righe attive di radar_classificazioni
// (anche AGGIUNGENDO settori), una riga attiva per gara e settore con lo storico, lo stato (classificata / in attesa / fallita). Le gare C
// restano nell'archivio; nulla si cancella. Ogni cambio della colonna è tracciato nel registro (mai notificabile) con l'esecuzione.
// Seconda esecuzione = nessuna scrittura.
//
// Uso (variabili dello staging nell'ambiente, mai quelle di produzione):
//   RADAR_STAGING_REF=<staging> npx tsx scripts/radar-riclassifica-settori.ts prova [--elenco <file.json>]
//       SOLA LETTURA (ogni richiesta che non sia una lettura viene rifiutata prima di partire): il piano completo, nessuna scrittura
//   npx tsx scripts/radar-riclassifica-settori.ts prova --da-file <archivio.json> [--elenco <file.json>]
//       lo stesso calcolo su un'esportazione dell'archivio fatta in una transazione di sola lettura (nessun accesso al database)
//   RADAR_STAGING_REF=<staging> npx tsx scripts/radar-riclassifica-settori.ts applica <massimo> --diario <file.json>
//       scrive il piano; si ferma senza scrivere nulla se le gare da scrivere sono più di <massimo>. Solo con il lanciatore
//       esegui-autorizzato.mjs e un'autorizzazione registrata del coordinatore (regola del 17/11/2026). Il DIARIO (obbligatorio) si salva
//       PRIMA di ogni scrittura; se il file c'è già, l'esecuzione RIPRENDE da lì dopo un'interruzione (stessa esecuzione, stessi id, nessun
//       doppione, stato finale identico: vedi riclassificazione.ts, «recupero sicuro»)
//   RADAR_STAGING_REF=<staging> npx tsx scripts/radar-riclassifica-settori.ts annulla <esecuzione> <massimo>
//       ripristino controllato di un'esecuzione (colonna, righe, stato «in attesa»). Stesse condizioni di «applica»
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PROGETTO_PRODUZIONE } from "../src/lib/radar/ambiente";
import { VERSIONE_REGOLE_SETTORI } from "../src/lib/radar/settori";
import { idEsecuzione, riepilogoPiani, rigaElenco, type GaraArchivio, type LottoDaRiclassificare, type PianoGara } from "../src/lib/radar/riclassifica-settori";
import { annullaEsecuzione, applicaPiani, diarioDaPiani, leggiArchivio, pianiDaArchivio, TroppeGare, type ArchivioLetto, type Diario } from "../src/lib/radar/riclassificazione";
import type { RigaClassificazione, RigaStato } from "../src/lib/radar/classificazioni-calcoli";

const MASSIMO_ASSOLUTO = 2000;

// Sola lettura garantita per la prova: il client può fare solo GET e HEAD (nessun insert, update, upsert, delete né rpc).
export function fetchSoloLettura(f: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const metodo = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (metodo !== "GET" && metodo !== "HEAD") return Promise.reject(new Error(`STOP: richiesta ${metodo} rifiutata, la prova è in sola lettura.`));
    return f(input, init);
  };
}

function ambienteStaging(): { url: string; chiave: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const staging = process.env.RADAR_STAGING_REF ?? "";
  if (!url || !chiave) {
    console.error("Mancano le variabili del database.");
    process.exit(2);
  }
  if (url.includes(PROGETTO_PRODUZIONE) || chiave.includes(PROGETTO_PRODUZIONE) || !staging || !url.includes(`${staging}.supabase.co`)) {
    console.error("STOP: questo script gira solo contro lo staging dichiarato in RADAR_STAGING_REF.");
    process.exit(2);
  }
  return { url, chiave };
}

async function porta() {
  // Regola del 17/11/2026: scritture sullo staging solo con un'autorizzazione registrata del coordinatore.
  const registro = process.env.TI_REGISTRO;
  if (!registro) {
    console.error("STOP: lanciare con esegui-autorizzato.mjs (autorizzazione registrata del coordinatore).");
    process.exit(2);
  }
  const { controllaPorta } = await import(new URL(`file:///${registro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href);
  try {
    controllaPorta({ script: "radar-riclassifica-settori.ts" });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  }
}

// Esportazione dell'archivio (sola lettura): { gare, lotti, classificazioni (solo attive), stati }.
export function archivioDaFile(percorso: string): ArchivioLetto {
  const j = JSON.parse(fs.readFileSync(percorso, "utf8")) as { gare: GaraArchivio[]; lotti: (LottoDaRiclassificare & { procedura_id: string; numero_lotto?: string })[]; classificazioni: RigaClassificazione[] | null; stati: RigaStato[] | null };
  const lotti = new Map<string, LottoDaRiclassificare[]>();
  for (const l of [...j.lotti].sort((a, b) => String(a.numero_lotto ?? "").localeCompare(String(b.numero_lotto ?? "")))) lotti.set(l.procedura_id, [...(lotti.get(l.procedura_id) ?? []), { oggetto: l.oggetto, cpv_principale: l.cpv_principale, cpv_tutti: l.cpv_tutti }]);
  const attive = new Map<string, RigaClassificazione[]>();
  for (const r of j.classificazioni ?? []) if (r.attiva) attive.set(r.procedura_id, [...(attive.get(r.procedura_id) ?? []), r]);
  return { gare: j.gare, lotti, nLotti: j.lotti.length, attive, stati: new Map((j.stati ?? []).map((s) => [s.procedura_id, s])), tabelle0121: j.classificazioni !== null && j.stati !== null };
}

const breve = (p: PianoGara) => `${p.chiave.split(":")[0]} ${p.proceduraId.slice(0, 8)} ${p.oggetto.slice(0, 100)}`;

function stampaPiano(a: ArchivioLetto, piani: PianoGara[], esecuzione: string) {
  const r = riepilogoPiani(piani);
  const daScrivere = piani.filter((p) => p.tipo === "da_scrivere");
  console.log(`Regole ${VERSIONE_REGOLE_SETTORI}. Archivio: ${a.gare.length} gare, ${a.nLotti} lotti, ${[...a.attive.values()].flat().length} classificazioni attive, ${a.stati.size} stati. Esecuzione ${esecuzione}.`);
  console.log(`Gare già classificate con queste regole e non cambiate: ${r.giaClassificate}; da scrivere: ${r.daScrivere}; con righe non valide (fallite): ${r.fallite}; righe con conflitto tra fonti: ${r.conflittiTraFonti}.`);
  console.log(`Categorie: A ${r.categorie.A}, B ${r.categorie.B}, misti A+B ${r.categorie.misti}, C ${r.categorie.C}, nessun settore considerato ${r.categorie.nessun_settore}. Multisettore: ${r.multisettore}.`);
  console.log(`Colonna settori: invariate ${r.colonna.invariate}, cambiano ${r.colonna.cambiate} (perdono ${r.colonna.perdono}, acquisiscono ${r.colonna.acquisiscono}, fuori da tutti ${r.colonna.fuoriDaTutti}, solo metodo ${r.colonna.soloMetodo}).`);
  console.log(`Righe da scrivere: ${JSON.stringify(r.righe)}`);
  const elenco = (titolo: string, v: PianoGara[], f: (p: PianoGara) => string) => {
    console.log(`${titolo}: ${v.length}`);
    for (const p of v) console.log(`  ${breve(p)} ${f(p)}`);
  };
  elenco("Gare che PERDONO settori", daScrivere.filter((p) => p.cambiaSettori && p.ric!.tolti.length), (p) => `${JSON.stringify(p.ric!.prima.settori)} → ${JSON.stringify(p.ric!.dopo.settori)} [${p.ric!.esclusioni.map((e) => e.regola).join(", ")}]`);
  elenco("Gare che ACQUISISCONO settori", daScrivere.filter((p) => p.cambiaSettori && p.ric!.aggiunti.length), (p) => `${JSON.stringify(p.ric!.prima.settori)} → ${JSON.stringify(p.ric!.dopo.settori)}`);
  elenco("Gare che cambiano SOLO il metodo", daScrivere.filter((p) => p.cambiaSettori && p.ric!.soloMetodo), (p) => `${p.ric!.prima.metodo} → ${p.ric!.dopo.metodo}`);
  elenco("Gare MULTISETTORE", daScrivere.filter((p) => p.ric!.dopo.settori.length >= 2), (p) => p.calcolate.map((c) => `${c.settore}=${c.rilevanza}`).join(" "));
  elenco("Gare con righe non valide (fallite)", daScrivere.filter((p) => p.errori.length), (p) => p.errori.join("; "));
}

async function main() {
  const argomenti = process.argv.slice(2);
  const modo = argomenti[0];
  const opzione = (n: string) => {
    const i = argomenti.indexOf(n);
    return i >= 0 ? argomenti[i + 1] : undefined;
  };
  if (modo !== "prova" && modo !== "applica" && modo !== "annulla") {
    console.error("Uso: prova [--da-file <archivio.json>] [--elenco <file.json>] | applica <massimo> --diario <file.json> | annulla <esecuzione> <massimo>");
    process.exit(2);
  }
  const massimo = Number(modo === "annulla" ? argomenti[2] : argomenti[1]);
  if (modo !== "prova" && !(Number.isInteger(massimo) && massimo > 0 && massimo <= MASSIMO_ASSOLUTO)) {
    console.error(`Indicare il numero massimo di gare (da 1 a ${MASSIMO_ASSOLUTO}).`);
    process.exit(2);
  }
  const adessoIso = new Date().toISOString();
  const esecuzione = idEsecuzione(adessoIso);
  const misure = { richiesteDb: 0, msDb: 0 };
  // applica e annulla: la porta delle autorizzazioni PRIMA di ogni accesso al database
  if (modo !== "prova") await porta();

  if (modo === "prova") {
    const daFile = opzione("--da-file");
    let a: ArchivioLetto;
    if (daFile) a = archivioDaFile(daFile);
    else {
      const { url, chiave } = ambienteStaging();
      const lettura = createClient(url, chiave, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchSoloLettura() } });
      a = await leggiArchivio(lettura, misure);
    }
    const piani = pianiDaArchivio(a, esecuzione, adessoIso, randomUUID);
    stampaPiano(a, piani, esecuzione);
    const uscita = opzione("--elenco");
    if (uscita) {
      fs.writeFileSync(uscita, JSON.stringify({ versione: VERSIONE_REGOLE_SETTORI, riepilogo: riepilogoPiani(piani), gare: piani.map(rigaElenco) }, null, 1));
      console.log(`Elenco gara per gara: ${uscita}`);
    }
    console.log(`Prova a vuoto: nessuna scrittura (letture: ${misure.richiesteDb}).`);
    return;
  }

  const { url, chiave } = ambienteStaging();
  const db = createClient(url, chiave, { auth: { persistSession: false, autoRefreshToken: false } });

  if (modo === "annulla") {
    const daAnnullare = argomenti[1] ?? "";
    console.log(`Annullamento dell'esecuzione ${daAnnullare}…`);
    try {
      console.log(JSON.stringify(await annullaEsecuzione(db, daAnnullare, massimo, misure, adessoIso, randomUUID)));
    } catch (e) {
      if (e instanceof TroppeGare) {
        console.error(`STOP: ${e.message}`);
        process.exit(1);
      }
      throw e;
    }
    return;
  }

  const fileDiario = opzione("--diario");
  if (!fileDiario) {
    console.error("STOP: indicare il diario dell'esecuzione (--diario <file.json>): serve a riprendere senza doppioni dopo un'interruzione.");
    process.exit(2);
  }
  let diario: Diario;
  if (fs.existsSync(fileDiario)) {
    // RIPRESA dopo un'interruzione: stesso piano, stessa esecuzione, stesso istante
    diario = JSON.parse(fs.readFileSync(fileDiario, "utf8")) as Diario;
    if (diario.formato !== 1 || diario.versione !== VERSIONE_REGOLE_SETTORI) {
      console.error(`STOP: il diario è di un'altra versione delle regole (${diario.versione}, ora ${VERSIONE_REGOLE_SETTORI}). Nessuna scrittura.`);
      process.exit(1);
    }
    console.log(`RIPRESA dell'esecuzione ${diario.esecuzione} dal diario (${diario.piani.length} gare).`);
  } else {
    const a = await leggiArchivio(db, misure);
    if (!a.tabelle0121) {
      console.error("STOP: le tabelle della 0121 non ci sono in questo database. Nessuna scrittura.");
      process.exit(1);
    }
    const piani = pianiDaArchivio(a, esecuzione, adessoIso, randomUUID);
    stampaPiano(a, piani, esecuzione);
    diario = diarioDaPiani(piani, esecuzione, adessoIso, VERSIONE_REGOLE_SETTORI);
    if (diario.piani.length > massimo) {
      console.error(`STOP: ${diario.piani.length} gare da scrivere, più del massimo autorizzato ${massimo}. Nessuna scrittura.`);
      process.exit(1);
    }
    // il diario si salva PRIMA di ogni scrittura (file temporaneo e poi rinomina: mai un diario a metà)
    fs.writeFileSync(`${fileDiario}.tmp`, JSON.stringify(diario));
    fs.renameSync(`${fileDiario}.tmp`, fileDiario);
  }
  if (diario.piani.length > massimo) {
    console.error(`STOP: ${diario.piani.length} gare nel diario, più del massimo autorizzato ${massimo}. Nessuna scrittura.`);
    process.exit(1);
  }
  console.log(`Esecuzione ${diario.esecuzione} (per l'annullamento: annulla ${diario.esecuzione} <massimo>).`);
  console.log(JSON.stringify(await applicaPiani(db, diario.piani, misure, diario.adessoIso)));
}

if (process.argv[1] && /radar-riclassifica-settori\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
