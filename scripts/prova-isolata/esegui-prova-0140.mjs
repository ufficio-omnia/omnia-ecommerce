// PROVA DELLA 0140 (tipo «consultazione_preliminare», Fase 2, B2, 26/11/2026) SU UN POSTGRES ISOLATO. Autorizzata dal coordinamento il 26/11
// (regola del 23/11: Docker solo per un Postgres usa e getta, poi spento). Immagine postgres:17.11 già sul disco, contenitore --rm con nome
// proprio, --network none, nessuna porta, nessun volume, password casuale mai salvata; nessun dato reale, nessun collegamento a staging o
// produzione. Mai rmi, volume rm o prune.
// La 0140 si legge dal commit indicato (di base HEAD); le colonne tipo_opportunita e partecipazione si creano con le righe ESATTE della 0120
// (stesso vincolo senza nome, quindi lo stesso nome generato da Postgres). Casi, ognuno in un database a parte:
//   A. la 0140 su un vincolo come la 0120, con righe di tutti i valori di oggi: il controllo finale passa; il vincolo ha i 5 valori; il valore
//      nuovo si scrive, uno inventato no; le righe di prima restano;
//   B. riesecuzione della 0140 sullo stesso database: nessun cambiamento (stessa definizione, stesso oid del vincolo);
//   C. un vincolo a cui manca un valore della 0120 (sistema_qualificazione): la 0140 FALLISCE e la transazione si annulla (vincolo di prima
//      intatto, stesso oid);
//   D. nessun vincolo su tipo_opportunita: la 0140 FALLISCE, nulla cambia;
//   E. un vincolo con un valore in più aggiunto dopo la 0120 (ipotetico «valore_successivo»): la 0140 lo CONSERVA.
// Uso: node scripts/prova-isolata/esegui-prova-0140.mjs postgres:17.11 [commit]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.join(QUI, "..", "..");
const immagine = process.argv[2];
const commit = process.argv[3] ?? "HEAD";
if (immagine !== "postgres:17.11") {
  console.error("Uso: node scripts/prova-isolata/esegui-prova-0140.mjs postgres:17.11 [commit] (solo l'immagine già sul disco)");
  process.exit(2);
}
const git = (...a) => spawnSync("git", ["-c", "core.autocrlf=false", ...a], { cwd: RADICE, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
const id = git("rev-parse", commit).stdout.trim();
const M0140 = git("show", `${id}:supabase/migrations/0140_radar_tipo_consultazione_preliminare.sql`).stdout;
const M0120 = git("show", `${id}:supabase/migrations/0120_radar_multifonte.sql`).stdout;
const colonne0120 = M0120.match(/alter table public\.radar_procedure\s+add column if not exists tipo_opportunita[^;]+;\s*alter table public\.radar_procedure\s+add column if not exists partecipazione[^;]+;/)?.[0];
if (!/^[0-9a-f]{40}$/.test(id) || !M0140 || !colonne0120) {
  console.error(`0140 o righe della 0120 non trovate nel commit ${commit}`);
  process.exit(2);
}

const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 20 * 1024 * 1024 });
const nome = `prova-0140-${randomBytes(4).toString("hex")}`;
const avvio = docker(["run", "--rm", "-d", "--name", nome, "--network", "none", "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, immagine]);
if (avvio.status !== 0) {
  console.error(`avvio del contenitore non riuscito: ${(avvio.stderr ?? "").slice(0, 400)}`);
  process.exit(1);
}
const psql = (db, sql) => docker(["exec", "-i", nome, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-f", "-"], sql);
const valore = (db, sql) => psql(db, sql).stdout.trim();
const esiti = [];
const controlla = (nomeControllo, ok, dettaglio) => esiti.push({ nome: nomeControllo, ok: !!ok, dettaglio });
const definizione = (db) => valore(db, "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_procedure'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo_opportunita%' order by conname;");
const oidVincolo = (db) => valore(db, "select string_agg(oid::text || ':' || conname, ',' order by conname) from pg_constraint where conrelid = 'public.radar_procedure'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo_opportunita%';");
const tabella = "create table public.radar_procedure (id serial primary key, chiave text not null unique);\n";

let codice = 0;
try {
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) {
    pronto = docker(["exec", nome, "pg_isready", "-U", "postgres", "-q"]).status === 0 && docker(["exec", nome, "psql", "-U", "postgres", "-tAc", "select 1"]).stdout.trim() === "1";
    if (!pronto) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  console.log(`Contenitore ${nome}: ${valore("postgres", "select version();").slice(0, 60)}; 0140 e 0120 dal commit ${id.slice(0, 7)}`);
  for (const db of ["caso_a", "caso_c", "caso_d", "caso_e"]) psql("postgres", `create database ${db};`);

  // ── A e B
  const prepA = psql("caso_a", `${tabella}${colonne0120}\ninsert into public.radar_procedure (chiave, tipo_opportunita, partecipazione) values ('g1', 'bando', 'libera'), ('g2', 'manifestazione_interesse', 'libera'), ('g3', 'indagine_mercato', 'libera'), ('g4', 'sistema_qualificazione', 'iscrizione'), ('g5', null, null);`);
  const nomeA = valore("caso_a", "select conname from pg_constraint where conrelid = 'public.radar_procedure'::regclass and pg_get_constraintdef(oid) like '%tipo_opportunita%';");
  controlla("A0. preparazione: il vincolo della 0120 nasce col nome generato «radar_procedure_tipo_opportunita_check»", prepA.status === 0 && nomeA === "radar_procedure_tipo_opportunita_check", { nomeA, err: prepA.stderr });
  const a = psql("caso_a", M0140);
  const defA = definizione("caso_a");
  controlla("A1. la 0140 riesce (controllo finale superato)", a.status === 0, a.stderr);
  controlla("A2. un solo vincolo, con i 5 valori nell'ordine (i 4 della 0120 + consultazione_preliminare)", defA === "CHECK (((tipo_opportunita IS NULL) OR (tipo_opportunita = ANY (ARRAY['bando'::text, 'manifestazione_interesse'::text, 'indagine_mercato'::text, 'sistema_qualificazione'::text, 'consultazione_preliminare'::text]))))", defA);
  const scrive = psql("caso_a", "insert into public.radar_procedure (chiave, tipo_opportunita, partecipazione) values ('g6', 'consultazione_preliminare', 'libera');");
  const inventato = psql("caso_a", "insert into public.radar_procedure (chiave, tipo_opportunita) values ('g7', 'inventato');");
  controlla("A3. il valore nuovo si scrive, uno inventato no (il vincolo funziona)", scrive.status === 0 && inventato.status !== 0 && /check constraint/i.test(inventato.stderr ?? ""), { scrive: scrive.stderr, inventato: (inventato.stderr ?? "").slice(0, 200) });
  controlla("A4. le righe di prima restano tutte (nessun dato toccato); il vincolo di partecipazione è intatto", valore("caso_a", "select count(*) from public.radar_procedure;") === "6" && /partecipazione = ANY \(ARRAY\['libera'::text, 'iscrizione'::text\]\)/.test(valore("caso_a", "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.radar_procedure'::regclass and pg_get_constraintdef(oid) like '%partecipazione%';")));
  const oidPrima = oidVincolo("caso_a");
  const b = psql("caso_a", M0140);
  controlla("B. riesecuzione: riesce e NON cambia nulla (stessa definizione, stesso vincolo)", b.status === 0 && definizione("caso_a") === defA && oidVincolo("caso_a") === oidPrima, { b: b.stderr, prima: oidPrima, dopo: oidVincolo("caso_a") });

  // ── C: manca un valore della 0120 → fallisce e si annulla
  const ridotto = colonne0120.replace(", 'sistema_qualificazione'", "");
  psql("caso_c", `${tabella}${ridotto}\ninsert into public.radar_procedure (chiave, tipo_opportunita) values ('g1', 'bando');`);
  const defCprima = definizione("caso_c");
  const oidCprima = oidVincolo("caso_c");
  const c = psql("caso_c", M0140);
  controlla("C. vincolo senza «sistema_qualificazione»: la 0140 FALLISCE con il suo messaggio e la transazione si annulla (vincolo di prima intatto)", c.status !== 0 && /0140: il vincolo non ammette sistema_qualificazione/.test(c.stderr ?? "") && definizione("caso_c") === defCprima && oidVincolo("caso_c") === oidCprima && !defCprima.includes("sistema_qualificazione"), { err: (c.stderr ?? "").slice(0, 300), prima: defCprima, dopo: definizione("caso_c") });

  // ── D: nessun vincolo → fallisce
  psql("caso_d", `${tabella}alter table public.radar_procedure add column tipo_opportunita text;`);
  const d = psql("caso_d", M0140);
  controlla("D. nessun vincolo su tipo_opportunita: la 0140 FALLISCE e non crea nulla", d.status !== 0 && /0140: nessun vincolo su tipo_opportunita trovato/.test(d.stderr ?? "") && definizione("caso_d") === "", (d.stderr ?? "").slice(0, 300));

  // ── E: un valore in più aggiunto dopo la 0120 → conservato
  const conAltro = colonne0120.replace("'sistema_qualificazione')", "'sistema_qualificazione', 'valore_successivo')");
  psql("caso_e", `${tabella}${conAltro}\ninsert into public.radar_procedure (chiave, tipo_opportunita) values ('g1', 'valore_successivo');`);
  const e = psql("caso_e", M0140);
  const defE = definizione("caso_e");
  controlla("E. un valore aggiunto dopo la 0120 NON si perde: il vincolo ricreato lo conserva, più quello nuovo; la riga che lo usa resta valida", e.status === 0 && defE.includes("'valore_successivo'::text") && defE.includes("'consultazione_preliminare'::text") && defE.includes("'sistema_qualificazione'::text"), { err: e.stderr, defE });
} catch (x) {
  controlla("eccezione nella prova", false, x instanceof Error ? x.message : String(x));
} finally {
  docker(["stop", nome]);
}
for (const r of esiti) console.log(`${r.ok ? "ok     " : "FALLITO"} ${r.nome}${r.ok || r.dettaglio === undefined ? "" : ` → ${JSON.stringify(r.dettaglio).slice(0, 500)}`}`);
const falliti = esiti.filter((r) => !r.ok).length;
console.log(`Prova della 0140 su Postgres isolato: ${esiti.length - falliti} ok, ${falliti} falliti`);
codice = falliti ? 1 : 0;
process.exit(codice);
