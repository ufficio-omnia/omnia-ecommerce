// PROVA della PULIZIA delle righe di Z8 (documento 46C, B2, 23/11/2026) su un POSTGRES ISOLATO: postgres:17.11, --rm, --network none, nessuna
// porta né volume, password casuale mai salvata. Mai rmi, volume rm o prune; mai il Supabase locale; nessun database reale.
// Base = migrazioni dello staging di oggi (commit della 0123: fino alla 0125, più 0128 e 0123) con i permessi predefiniti di Supabase; righe
// «di prima» (95_…), fotografia; righe come quelle di Z8 (96_…), fotografia; poi lo SQL VERO dello script (scripts/collaudo-z8/pulizia-z8.mjs):
// prova a vuoto, 5 mutazioni che devono essere ANNULLATE senza cancellare nulla, la pulizia giusta (tutto torna IDENTICO a prima di Z8) e
// una ripetizione (annullata).
// Uso: node scripts/prova-isolata/esegui-prova-pulizia-z8.mjs postgres:17.11
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sqlProva, sqlPulizia } from "../collaudo-z8/pulizia-z8.mjs";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.join(QUI, "..", "..");
if (process.argv[2] !== "postgres:17.11") { console.error("Uso: node scripts/prova-isolata/esegui-prova-pulizia-z8.mjs postgres:17.11"); process.exit(2); }
const COMMIT = "migrazione/tender-intelligence-0123";
const git = (...a) => spawnSync("git", ["-c", "core.autocrlf=false", ...a], { cwd: RADICE, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const elencoMig = git("ls-tree", "--name-only", COMMIT, "supabase/migrations/").stdout.split("\n").filter(Boolean);
const mig = (v) => git("show", `${COMMIT}:${elencoMig.find((n) => path.basename(n).startsWith(`${v}_`))}`).stdout;
const leggi = (f) => fs.readFileSync(path.join(QUI, f), "utf8");
const T1 = "11111111-1111-4111-8111-111111111111", T2 = "22222222-2222-4222-8222-222222222222", M1 = "33333333-3333-4333-8333-333333333333";
const id = (p, n) => `${p}-0000-4000-8000-00000000000${n}`;
const ELENCO = {
  consegne: [1, 2, 3, 4, 5, 6].map((n) => id("c8000000", n)),
  eventi: [1, 2, 3, 4].map((n) => id("e8000000", n)),
  giri: [1, 2].map((n) => id("98000000", n)),
  salvate: [1, 2, 3].map((n) => id("85000000", n)),
  aggiunte: [1, 2, 3].map((n) => id("8a000000", n)),
};
const con = (cambi) => ({ ...ELENCO, ...cambi });

const nome = `omnia-prova-pulizia-z8-${randomBytes(4).toString("hex")}`;
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 50 * 1024 * 1024 });
const psql = (testo, tA = false) => docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", ...(tA ? ["-tA"] : []), "-f", "-"], testo);
const passo = (etichetta, testo) => { const r = psql(testo); if (r.status !== 0) throw new Error(`${etichetta}: ${r.stderr.slice(0, 600)}`); };
const valore = (sql) => { const r = psql(sql, true); if (r.status !== 0) throw new Error(r.stderr.slice(0, 400)); return r.stdout.trim(); };
const identiche = (a, b) => valore(`select bool_and(prova.elenco_differenze('${a}', '${b}', t) = '{}') from unnest(array['oggetto', 'righe', 'impronta', 'permesso', 'colonna', 'execute', 'regola', 'rls', 'file']) t;`) === "t";
const esiti = [];
const atteso = (n, ok, dettaglio) => { esiti.push(ok); console.log(`${ok ? "ok      " : "FALLITO "} ${n}${!ok && dettaglio ? ` → ${String(dettaglio).slice(0, 300)}` : ""}`); };

const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, "postgres:17.11"]);
if (avvio.status !== 0) { console.error(avvio.stderr); process.exit(2); }
let codice = 0;
try {
  for (let i = 0; i < 60; i++) {
    if (docker(["exec", nome, "pg_isready", "-U", "postgres", "-q"]).status === 0 && docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout.trim() === "1") break;
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  passo("prerequisiti", leggi("00_prerequisiti.sql"));
  passo("permessi predefiniti", leggi("05_privilegi_predefiniti_supabase.sql"));
  for (const v of ["0109", "0110", "0111", "0112", "0113", "0114", "0115", "0116", "0117", "0120", "0121"]) passo(v, mig(v));
  passo("prerequisiti B4", leggi("30_prerequisiti_b4.sql"));
  passo("dati B4", leggi("35_dati_b4.sql"));
  for (const v of ["0122", "0124"]) passo(v, mig(v));
  passo("preferenze", `insert into public.omnia_ai_radar_notifiche_impresa (impresa_id, email_attive) values ('${T1}', true), ('${T2}', false);
insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id, nuove_opportunita, scadenze, rettifiche) values ('${T1}', '${T1}', true, true, true), ('${T1}', '${M1}', false, true, false), ('${T2}', '${T2}', false, false, false);`);
  for (const v of ["0125", "0128", "0123"]) passo(v, mig(v));
  passo("fotografia", leggi("68_fotografia_z5.sql"));
  passo("righe di prima", leggi("95_dati_pulizia_z8.sql"));
  passo("fotografia «prima_z8»", "select prova.fotografa('prima_z8');");
  passo("righe di Z8", leggi("96_righe_z8.sql"));
  passo("fotografia «con_z8»", "select prova.fotografa('con_z8');");

  // prova a vuoto
  const p = JSON.parse(valore(sqlProva(ELENCO)));
  atteso("prova a vuoto: cancellerebbe esattamente l'elenco (consegne 6, eventi 4, giri 2, salvate 3 in cascata, gare aggiunte 3), nulla fuori elenco",
    p.consegne === 6 && p.eventi === 4 && p.giri === 2 && p.salvate === 3 && p.salvate_in_cascata === 3 && p.aggiunte === 3 && p.motore_fuori_elenco === 0 && p.consegne_di_eventi_in_elenco_fuori_elenco === 0, JSON.stringify(p));

  // mutazioni: ognuna ANNULLATA, nulla cancellato
  const annullata = (nomeMut, elenco, prima = "", dopo = "") => {
    if (prima) passo(`preparazione ${nomeMut}`, prima);
    const r = psql(sqlPulizia(elenco));
    if (dopo) passo(`ripristino ${nomeMut}`, dopo);
    passo("fotografia", `select prova.fotografa('dopo_mutazione');`);
    atteso(`mutazione ${nomeMut}: ANNULLATA, nulla cancellato (tutto identico a «con Z8»)`, r.status !== 0 && /PULIZIA Z8 ANNULLATA/.test(r.stderr) && identiche("con_z8", "dopo_mutazione"), r.stderr);
  };
  annullata("identificativo estraneo (una gara aggiunta NON di Z8 nell'elenco)", con({ aggiunte: [...ELENCO.aggiunte, "a0000000-0000-4000-8000-000000000001"] }));
  annullata("identificativo inesistente tra gli eventi", con({ eventi: [...ELENCO.eventi, "e8000000-0000-4000-8000-00000000000f"] }));
  annullata("una consegna in meno nell'elenco (resterebbe orfana)", con({ consegne: ELENCO.consegne.slice(1) }));
  annullata("un evento NON di Z8 nel motore",
    ELENCO,
    `insert into public.omnia_ai_radar_eventi (id, impresa_id, categoria, tipo, gara_chiave, versione, dati) values ('ee000000-0000-4000-8000-000000000001', '${T2}', 'scadenze', 'scadenza_10', 'p:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'estraneo', '{}');`,
    "delete from public.omnia_ai_radar_eventi where id = 'ee000000-0000-4000-8000-000000000001';");
  annullata("una salvata NON di Z8 legata a una gara di Z8 (la cascata la porterebbe via)",
    ELENCO,
    `insert into public.omnia_ai_radar_salvate (id, user_id, procedura_id, aggiunta_id, monitorata) values ('5e000000-0000-4000-8000-000000000001', '${T2}', null, '8a000000-0000-4000-8000-000000000001', false);`,
    "delete from public.omnia_ai_radar_salvate where id = '5e000000-0000-4000-8000-000000000001';");

  // la pulizia giusta
  const r = psql(sqlPulizia(ELENCO));
  passo("fotografia «dopo_pulizia»", "select prova.fotografa('dopo_pulizia');");
  atteso("pulizia giusta: riuscita", r.status === 0 && /PULIZIA Z8 FATTA: consegne 6, eventi 4, giri 2, salvate 3 \(in cascata\), gare aggiunte 3/.test(r.stderr + r.stdout), r.stderr);
  atteso("dopo la pulizia TUTTO IDENTICO a prima di Z8 (oggetti, righe, impronte di ogni tabella, permessi, regole, file)", identiche("prima_z8", "dopo_pulizia"));
  atteso("motore vuoto; gare aggiunte e salvate di prima intatte (2 e 3)",
    valore("select (select count(*) from public.omnia_ai_radar_eventi) + (select count(*) from public.omnia_ai_radar_email_consegne) + (select count(*) from public.radar_notifiche_giri);") === "0"
    && valore("select count(*) from public.omnia_ai_radar_gare_aggiunte;") === "2" && valore("select count(*) from public.omnia_ai_radar_salvate;") === "3");
  const r2 = psql(sqlPulizia(ELENCO));
  passo("fotografia", "select prova.fotografa('dopo_ripetuta');");
  atteso("ripetuta: ANNULLATA (0 righe invece di 6), nulla cambia", r2.status !== 0 && /consegne cancellate 0 invece di 6/.test(r2.stderr) && identiche("dopo_pulizia", "dopo_ripetuta"), r2.stderr);
  codice = esiti.every(Boolean) ? 0 : 1;
} catch (e) {
  console.log(`ERRORE: ${e instanceof Error ? e.message : String(e)}`);
  codice = 1;
} finally {
  docker(["stop", nome]);
}
console.log(codice === 0 ? `Prova isolata della pulizia Z8: TUTTO SUPERATO (${esiti.length}/${esiti.length})` : "Prova isolata della pulizia Z8: FALLITA");
process.exit(codice);
