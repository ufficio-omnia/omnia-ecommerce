// PROVA DELLE MIGRAZIONI 0128 E 0123 (dossier Z5, documento 45, 21/11/2026) SU UN POSTGRES ISOLATO. Docker autorizzato dall'utente SOLO per
// prove su un PostgreSQL isolato: immagine postgres:17.11 già sul disco, contenitore temporaneo --rm con nome proprio, --network none, nessuna
// porta, nessun volume, password casuale mai salvata. Mai rmi, volume rm o prune; mai il Supabase locale; nessun database reale.
//
// Le migrazioni si leggono dal COMMIT DEDICATO della 0123 (git show), figlio di quello della 0128, a sua volta figlio dello stato dello
// staging dopo Z4: cioè esattamente ciò che si applicherebbe allo staging. Sequenza:
//   base = permessi predefiniti di Supabase (come sullo staging) + Radar fino alla 0125 (senza 0123 e 0128) + 5 preferenze sintetiche +
//          dati sintetici col volume dello staging (2.056 righe del registro, 1.947 provenienze);
//   0128: arresto e recupero (0128 + un errore in una sola transazione, come la CLI: nulla resta), poi 0128 DUE volte (con durata), controlli;
//   0123: arresto e recupero, sonda dei blocchi (un'altra sessione durante la migrazione), poi 0123 DUE volte (con durata e blocchi),
//         controlli, regressione con le righe VERE degli importatori TED, PVL, Sintel e SardegnaCAT;
//   EXECUTE delle funzioni dei trigger: stato di oggi, poi la proposta di igiene DUE volte e i controlli.
// Uso: node scripts/prova-isolata/esegui-prova-isolata-z5.mjs postgres:17.11 [commit, di base il ramo migrazione/tender-intelligence-0123]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.join(QUI, "..", "..");
const immagine = process.argv[2];
const commit = process.argv[3] ?? "migrazione/tender-intelligence-0123";
if (immagine !== "postgres:17.11") {
  console.error("Uso: node scripts/prova-isolata/esegui-prova-isolata-z5.mjs postgres:17.11 [commit] (solo l'immagine già sul disco)");
  process.exit(2);
}
const git = (...a) => spawnSync("git", ["-c", "core.autocrlf=false", ...a], { cwd: RADICE, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const id = git("rev-parse", commit).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(id)) {
  console.error(`Commit non trovato: ${commit}`);
  process.exit(2);
}
const elenco = git("ls-tree", "--name-only", id, "supabase/migrations/").stdout.split("\n").filter(Boolean);
for (const v of ["0128", "0123", "0125", "0124"]) {
  if (!elenco.some((f) => path.basename(f).startsWith(`${v}_`))) {
    console.error(`FERMO: il commit ${id} non contiene la ${v}`);
    process.exit(2);
  }
}
const dalCommit = (v) => {
  const f = elenco.find((n) => path.basename(n).startsWith(`${v}_`));
  if (!f) throw new Error(`migrazione ${v} assente dal commit ${id}`);
  const r = git("show", `${id}:${f}`);
  if (r.status !== 0) throw new Error(`lettura di ${f} non riuscita`);
  return r.stdout;
};
const leggi = (nome) => fs.readFileSync(path.join(QUI, nome), "utf8");
const T1 = "11111111-1111-4111-8111-111111111111", T2 = "22222222-2222-4222-8222-222222222222", M1 = "33333333-3333-4333-8333-333333333333";
// SOLO per le prove di MUTAZIONE (i controlli devono accorgersi di uno SQL guastato): PROVA_Z5_MUTANTE_0128 / _0123 / _IGIENE = file con il
// testo guastato. La prova vera legge SEMPRE dal commit e non imposta queste variabili.
const mutante = (v) => process.env[`PROVA_Z5_MUTANTE_${v}`];
for (const v of ["0128", "0123", "IGIENE"]) if (mutante(v)) console.log(`ATTENZIONE: prova di MUTAZIONE, ${v} letta da ${path.basename(mutante(v))} (NON dal commit)`);
const M0128 = mutante("0128") ? fs.readFileSync(mutante("0128"), "utf8") : dalCommit("0128");
const M0123 = mutante("0123") ? fs.readFileSync(mutante("0123"), "utf8") : dalCommit("0123");
const IGIENE = mutante("IGIENE") ? fs.readFileSync(mutante("IGIENE"), "utf8") : null;

// righe VERE degli importatori: la batteria dei connettori, senza rete, le scrive in un file temporaneo
const lavoro = fs.mkdtempSync(path.join(os.tmpdir(), "z5-righe-"));
const fileRighe = path.join(lavoro, "righe.json");
const batteria = spawnSync("npx tsx scripts/verifica-radar-b4-db-connettori.ts", { cwd: RADICE, shell: true, encoding: "utf8", env: { ...process.env, RADAR_RIGHE_PER_POSTGRES: fileRighe }, maxBuffer: 20 * 1024 * 1024 });
if (batteria.status !== 0 || !fs.existsSync(fileRighe)) {
  console.error(`FERMO: la batteria dei connettori non è passata o non ha scritto le righe:\n${(batteria.stdout ?? "").slice(-1500)}`);
  process.exit(2);
}
const righe = fs.readFileSync(fileRighe, "utf8");
fs.rmSync(lavoro, { recursive: true, force: true });
if (righe.includes("$righe$")) throw new Error("righe con il delimitatore");
console.log(`Batteria dei connettori: ${(batteria.stdout.match(/\d+ ok, \d+ falliti/) ?? ["?"])[0]}; righe degli importatori pronte`);

// una migrazione come la applica la CLI di Supabase: UNA transazione; con la durata e (facoltativi) i blocchi tenuti alla fine
const comeLaCli = (testo, etichetta, blocchi) => `select set_config('prova.t0', clock_timestamp()::text, true);
${testo}
do $z5$
begin
  raise notice 'piano  durata di % (una transazione): % ms', ${JSON.stringify(etichetta).replace(/"/g, "'")}, round(extract(epoch from clock_timestamp() - current_setting('prova.t0')::timestamptz)::numeric * 1000, 1);
  ${blocchi ? `raise notice 'piano  blocchi tenuti fino alla fine della transazione: %', (select string_agg(c.relname || ' ' || l.mode, ', ' order by c.relname, l.mode) from pg_locks l join pg_class c on c.oid = l.relation where l.pid = pg_backend_pid() and l.locktype = 'relation' and c.relnamespace = 'public'::regnamespace and c.relkind = 'r');` : ""}
end $z5$;`;
const tutteUguali = (a, b, nome) => `select prova.verifica(${JSON.stringify(nome).replace(/'/g, "''").replace(/^"|"$/g, "'")},
  (select bool_and(prova.elenco_differenze('${a}', '${b}', t) = '{}') from unnest(array['oggetto', 'righe', 'impronta', 'vecchie', 'permesso', 'colonna', 'execute', 'regola', 'rls']) t));`;

const passi = [
  { etichetta: "prerequisiti minimi", testo: leggi("00_prerequisiti.sql") },
  { etichetta: "permessi predefiniti di Supabase (come sullo staging)", testo: leggi("05_privilegi_predefiniti_supabase.sql") },
  ...["0109", "0110", "0111", "0112", "0113", "0114", "0115", "0116", "0117", "0120", "0121"].map((v) => ({ etichetta: `${v} (dal commit)`, testo: dalCommit(v) })),
  { etichetta: "prerequisiti B4 (auth, Ufficio Gare)", testo: leggi("30_prerequisiti_b4.sql") },
  { etichetta: "dati sintetici B4", testo: leggi("35_dati_b4.sql") },
  { etichetta: "0122 (dal commit)", testo: dalCommit("0122") },
  { etichetta: "0124 (dal commit)", testo: dalCommit("0124") },
  {
    etichetta: "5 righe sintetiche delle preferenze (come lo staging dopo Z3)",
    testo: `insert into public.omnia_ai_radar_notifiche_impresa (impresa_id, email_attive) values ('${T1}', true), ('${T2}', false);
insert into public.omnia_ai_radar_notifiche_persone (impresa_id, user_id, nuove_opportunita, scadenze, rettifiche) values ('${T1}', '${T1}', true, true, true), ('${T1}', '${M1}', false, true, false), ('${T2}', '${T2}', false, false, false);`,
  },
  { etichetta: "0125 (dal commit)", testo: dalCommit("0125") },
  { etichetta: "dati sintetici col volume dello staging", testo: leggi("65_dati_z5.sql") },
  { etichetta: "fotografia: funzioni, dblink nello schema prova", testo: `create extension if not exists dblink schema prova;\n${leggi("68_fotografia_z5.sql")}` },
  { etichetta: "fotografia «prima_0128»", testo: "select prova.fotografa('prima_0128');" },
  // ── 0128 ──
  { etichetta: "ARRESTO 0128: la 0128 seguita da un errore, in una sola transazione (come la CLI)", testo: `${M0128}\nselect 1 / 0;`, unaTransazione: true, erroreAtteso: /division by zero|divisione per zero/ },
  {
    etichetta: "RECUPERO 0128: dopo l'errore nulla è rimasto",
    testo: `select prova.fotografa('dopo_arresto_0128');
select prova.verifica('0128 arresto: dopo un errore la tabella NON esiste', to_regclass('public.radar_esecuzioni') is null);
${tutteUguali("prima_0128", "dopo_arresto_0128", "0128 arresto: schema, righe, impronte, permessi e regole IDENTICI a prima (nessun residuo)")}`,
  },
  { etichetta: "0128 (dal commit), come la CLI", testo: comeLaCli(M0128, "0128", false), unaTransazione: true },
  { etichetta: "0128 di nuovo (idempotenza)", testo: comeLaCli(M0128, "0128 ripetuta", false), unaTransazione: true },
  { etichetta: "fotografia «dopo_0128»", testo: "select prova.fotografa('dopo_0128');" },
  { etichetta: "controlli della 0128", testo: leggi("70_prova_z5_0128.sql") },
  // ── 0123 ──
  { etichetta: "fotografia «prima_0123»", testo: "select prova.fotografa('prima_0123');" },
  { etichetta: "ARRESTO 0123: la 0123 seguita da un errore, in una sola transazione (come la CLI)", testo: `${M0123}\nselect 1 / 0;`, unaTransazione: true, erroreAtteso: /division by zero|divisione per zero/ },
  {
    etichetta: "RECUPERO 0123: dopo l'errore nulla è rimasto",
    testo: `select prova.fotografa('dopo_arresto_0123');
select prova.verifica('0123 arresto: dopo un errore nessuna colonna nuova', not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name in ('notifica_email', 'foto')));
${tutteUguali("prima_0123", "dopo_arresto_0123", "0123 arresto: schema, righe, impronte, permessi e regole IDENTICI a prima (nessun residuo)")}`,
  },
  {
    etichetta: "SONDA 0123: un'altra sessione durante la migrazione (transazione poi annullata)",
    testo: `begin;
${M0123}
select prova.dblink_connect('sonda', 'dbname=postgres user=postgres');
select prova.dblink_exec('sonda', 'set lock_timeout = ''300ms''');
select count(*) from prova.dblink('sonda', 'select count(*) from public.radar_aggiornamenti', false) as t (n bigint);
select prova.verifica('0123 sonda: DURANTE la migrazione una lettura del registro dei cambiamenti da un''altra sessione ASPETTA la fine (blocco esclusivo)', prova.dblink_error_message('sonda') ~* 'lock timeout');
select count(*) from prova.dblink('sonda', 'select count(*) from public.radar_procedure_fonti', false) as t (n bigint);
select prova.verifica('0123 sonda: anche la lettura delle provenienze aspetta', prova.dblink_error_message('sonda') ~* 'lock timeout');
select count(*) from prova.dblink('sonda', 'select count(*) from public.radar_procedure', false) as t (n bigint);
select prova.verifica('0123 sonda: le ALTRE tabelle (gare) si leggono normalmente', prova.dblink_error_message('sonda') = 'OK');
select count(*) from prova.dblink('sonda', 'select count(*) from public.radar_esecuzioni', false) as t (n bigint);
select prova.verifica('0123 sonda: il registro dei giri (0128) si legge normalmente', prova.dblink_error_message('sonda') = 'OK');
select prova.dblink_disconnect('sonda');
rollback;
select prova.fotografa('dopo_sonda_0123');
${tutteUguali("prima_0123", "dopo_sonda_0123", "0123 sonda: dopo l'annullamento tutto IDENTICO a prima")}`,
  },
  { etichetta: "0123 (dal commit), come la CLI", testo: comeLaCli(M0123, "0123", true), unaTransazione: true },
  { etichetta: "0123 di nuovo (idempotenza)", testo: comeLaCli(M0123, "0123 ripetuta", false), unaTransazione: true },
  { etichetta: "fotografia «dopo_0123»", testo: "select prova.fotografa('dopo_0123');" },
  { etichetta: "controlli della 0123", testo: leggi("75_prova_z5_0123.sql") },
  {
    etichetta: "regressione: righe VERE degli importatori TED, PVL, Sintel e SardegnaCAT con i vincoli della 0123",
    testo: `${leggi("90_righe_importatori_z5.sql")}
create table prova.dati_importatori as select $righe$${righe}$righe$::jsonb as dati;
grant select on prova.dati_importatori to service_role;
set role service_role;
insert into prova.esito_importatori select prova.carica_righe_importatori((select dati from prova.dati_importatori));
reset role;
do $z5$ begin raise notice 'piano  righe degli importatori: %', (select esito from prova.esito_importatori); end $z5$;
select prova.verifica('regressione: OGNI colonna scritta dagli importatori esiste dopo la 0123 (nessuna colonna sconosciuta)', (select esito -> 'colonne_sconosciute' = '[]'::jsonb from prova.esito_importatori));
select prova.verifica('regressione: TUTTE le righe degli importatori entrano (registro e provenienze), nessun vincolo violato',
  (select (esito ->> 'registro')::int = (select sum(jsonb_array_length(g -> 'radar_aggiornamenti')) from prova.dati_importatori, jsonb_array_elements(dati -> 'gruppi') g)
      and (esito ->> 'provenienze')::int = (select sum(jsonb_array_length(g -> 'radar_procedure_fonti')) from prova.dati_importatori, jsonb_array_elements(dati -> 'gruppi') g)
     from prova.esito_importatori));
select prova.verifica('regressione: righe delle QUATTRO fonti (ted, pvl, sintel, sardegnacat)', (select esito -> 'per_fonte' ?& array['ted', 'pvl', 'sintel', 'sardegnacat'] from prova.esito_importatori));
select prova.verifica('regressione: righe scritte con l''evidenza ACCESA e SPENTA (com''è oggi), fotografie della PVL e identificativo del giro',
  (select (esito ->> 'con_evidenza')::int > 0 and (esito ->> 'senza_evidenza')::int > 0 and (esito ->> 'fotografie')::int > 0 and (esito ->> 'con_giro')::int > 0 from prova.esito_importatori));
select prova.verifica('regressione: email possibili SOLO da TED, PVL e Sintel (lotti); SardegnaCAT MAI',
  (select esito -> 'email_per_fonte' ?& array['ted', 'pvl', 'sintel'] and not (esito -> 'email_per_fonte' ? 'sardegnacat') from prova.esito_importatori));
select prova.verifica('regressione: ogni gruppo annullato, nessuna riga rimasta (registro 2.056, provenienze 1.947)',
  (select count(*) from public.radar_aggiornamenti) = 2056 and (select count(*) from public.radar_procedure_fonti) = 1947 and not exists (select 1 from public.radar_procedure where chiave like 'prova:z5:importatori:%'));`,
  },
  // ── EXECUTE delle funzioni dei trigger ──
  { etichetta: "EXECUTE: stato di oggi", testo: leggi("80_prova_z5_execute.sql") },
  { etichetta: "fotografia «prima_igiene»", testo: "select prova.fotografa('prima_igiene');" },
  { etichetta: "proposta di igiene dei permessi", testo: IGIENE ?? leggi("85_proposta_igiene_permessi.sql"), unaTransazione: true },
  { etichetta: "proposta di igiene di nuovo (idempotenza)", testo: IGIENE ?? leggi("85_proposta_igiene_permessi.sql"), unaTransazione: true },
  { etichetta: "fotografia «dopo_igiene»", testo: "select prova.fotografa('dopo_igiene');" },
  { etichetta: "controlli dopo la proposta di igiene", testo: leggi("86_prova_z5_igiene.sql") },
];

const nome = `omnia-prova-z5-${randomBytes(4).toString("hex")}`;
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 80 * 1024 * 1024 });
const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, immagine]);
if (avvio.status !== 0) {
  console.error(`Contenitore non avviato: ${avvio.stderr.trim()}`);
  process.exit(2);
}
console.log(`Commit provato: ${id} (${elenco.length} migrazioni nell'albero)`);
let codice = 0;
let ok = 0;
try {
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) {
    pronto = docker(["exec", nome, "pg_isready", "-U", "postgres", "-q"]).status === 0 && docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout.trim() === "1";
    if (!pronto) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  if (!pronto) throw new Error("Postgres non è pronto");
  console.log(`Contenitore ${nome}: ${docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select version()"]).stdout.trim().slice(0, 60)}`);
  for (const { etichetta, testo, unaTransazione, erroreAtteso } of passi) {
    const r = docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", ...(unaTransazione ? ["--single-transaction"] : []), "-f", "-"], testo);
    const uscita = `${r.stdout}\n${r.stderr}`;
    const righeUtili = uscita.split("\n").map((x) => x.replace(/^psql:[^:]*:\d+:\s*/, "").replace(/^(NOTICE|AVVISO):\s*/, "")).filter((x) => /^(ok|FALLITO|piano)\s/.test(x) || /ERROR|ERRORE/.test(x));
    for (const x of righeUtili) {
      console.log(`  ${x.length > 900 ? `${x.slice(0, 900)}…` : x}`);
      if (/^ok\s/.test(x)) ok++;
    }
    if (erroreAtteso) {
      if (r.status === 0 || !erroreAtteso.test(uscita)) {
        console.log(`FALLITO ${etichetta}: atteso un errore che annulla tutto, ottenuto codice ${r.status}`);
        codice = 1;
        break;
      }
      ok++;
      console.log(`  ok     ${etichetta}: errore come atteso, transazione annullata`);
      continue;
    }
    if (r.status !== 0) {
      console.log(`FALLITO ${etichetta}: psql ha chiuso con codice ${r.status}`);
      codice = 1;
      break;
    }
    console.log(`passo superato: ${etichetta}`);
  }
} catch (e) {
  console.log(`FALLITO: ${e instanceof Error ? e.message : String(e)}`);
  codice = 1;
} finally {
  docker(["stop", nome]);
}
console.log(codice === 0 ? `Prova isolata Z5 (0128, 0123, EXECUTE): TUTTO SUPERATO (${ok} controlli ok)` : `Prova isolata Z5: FALLITA (${ok} controlli ok prima dell'errore)`);
process.exit(codice);
