// PULIZIA CONTROLLATA delle righe del collaudo Z8 sullo STAGING (documento 46C, B2, 23/11/2026). SOLO le righe scritte da Z8, PER
// IDENTIFICATIVO, in UN SOLO blocco SQL atomico: se un conteggio non coincide con l'elenco, Postgres annulla tutto e non resta nulla.
// Modi:
//   elenco --giro <esito.json del giro> --uscita <file>   SOLA LETTURA: rilegge le righe, le confronta con l'esito del giro, scrive l'elenco
//   prova --elenco <file>                                 SOLA LETTURA: che cosa cancellerebbe, per tabella (deve coincidere con l'elenco)
//   applica --elenco <file>                               SOLO con esegui-autorizzato.mjs: l'impronta dell'elenco deve essere quella
//                                                          dell'autorizzazione (ELENCO_SHA256 nel suo ambiente)
// Cascate VERE (lette dal database il 23/11): omnia_ai_radar_salvate.aggiunta_id → gare aggiunte ON DELETE CASCADE (le 3 salvate se ne
// vanno con le gare); consegne.evento_id → eventi ON DELETE CASCADE (qui le consegne si cancellano PRIMA, per identificativo); eventi e
// giri senza chiavi esterne verso le gare aggiunte.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export const ETICHETTA = "SINTETICA — Z8";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TABELLE = ["consegne", "eventi", "giri", "salvate", "aggiunte"];

/** L'elenco in forma canonica (identificativi ordinati), con i conteggi attesi. */
export function canonico(elenco) {
  const e = {};
  for (const t of TABELLE) {
    const ids = [...new Set((elenco[t] ?? []).map(String))].sort();
    if (!ids.every((x) => UUID.test(x))) throw new Error(`elenco: identificativo non valido in ${t}`);
    e[t] = ids;
  }
  return e;
}
export function impronta(elenco) {
  return createHash("sha256").update(JSON.stringify(canonico(elenco))).digest("hex");
}
const lista = (ids) => `'{${ids.join(",")}}'::uuid[]`;

/** SOLA LETTURA: che cosa cancellerebbe il blocco, con le stesse condizioni. */
export function sqlProva(elenco) {
  const e = canonico(elenco);
  return `select json_build_object(
 'consegne', (select count(*) from public.omnia_ai_radar_email_consegne where id = any (${lista(e.consegne)}) and provider = 'finto'),
 'eventi', (select count(*) from public.omnia_ai_radar_eventi where id = any (${lista(e.eventi)})),
 'giri', (select count(*) from public.radar_notifiche_giri where id = any (${lista(e.giri)}) and provider = 'finto'),
 'salvate', (select count(*) from public.omnia_ai_radar_salvate where id = any (${lista(e.salvate)}) and aggiunta_id = any (${lista(e.aggiunte)})),
 'salvate_in_cascata', (select count(*) from public.omnia_ai_radar_salvate where aggiunta_id = any (${lista(e.aggiunte)})),
 'aggiunte', (select count(*) from public.omnia_ai_radar_gare_aggiunte where id = any (${lista(e.aggiunte)}) and oggetto like '${ETICHETTA}%'),
 'motore_fuori_elenco', (select count(*) from public.omnia_ai_radar_eventi where id <> all (${lista(e.eventi)}))
     + (select count(*) from public.omnia_ai_radar_email_consegne where id <> all (${lista(e.consegne)}))
     + (select count(*) from public.radar_notifiche_giri where id <> all (${lista(e.giri)})),
 'consegne_di_eventi_in_elenco_fuori_elenco', (select count(*) from public.omnia_ai_radar_email_consegne where evento_id = any (${lista(e.eventi)}) and id <> all (${lista(e.consegne)}))
) as esito`;
}

/** Il blocco di cancellazione: atomico; ogni conteggio diverso dall'elenco = eccezione = NULLA cancellato. */
export function sqlPulizia(elenco) {
  const e = canonico(elenco);
  const n = Object.fromEntries(TABELLE.map((t) => [t, e[t].length]));
  const controllo = (cosa, atteso) => `  get diagnostics n = row_count;
  if n <> ${atteso} then raise exception 'PULIZIA Z8 ANNULLATA: ${cosa} % invece di ${atteso}', n; end if;`;
  return `do $pulizia_z8$
declare
  n bigint;
begin
  -- nessuna consegna fuori elenco legata agli eventi dell'elenco (la cascata la porterebbe via)
  select count(*) into n from public.omnia_ai_radar_email_consegne where evento_id = any (${lista(e.eventi)}) and id <> all (${lista(e.consegne)});
  if n <> 0 then raise exception 'PULIZIA Z8 ANNULLATA: % consegne fuori elenco legate agli eventi dell''elenco', n; end if;
  -- nessuna salvata fuori elenco legata alle gare dell'elenco (la cascata la porterebbe via)
  select count(*) into n from public.omnia_ai_radar_salvate where aggiunta_id = any (${lista(e.aggiunte)}) and id <> all (${lista(e.salvate)});
  if n <> 0 then raise exception 'PULIZIA Z8 ANNULLATA: % salvate fuori elenco legate alle gare dell''elenco', n; end if;
  -- 1) consegne (provider finto)
  delete from public.omnia_ai_radar_email_consegne where id = any (${lista(e.consegne)}) and provider = 'finto';
${controllo("consegne cancellate", n.consegne)}
  -- 2) eventi
  delete from public.omnia_ai_radar_eventi where id = any (${lista(e.eventi)});
${controllo("eventi cancellati", n.eventi)}
  -- 3) giri (provider finto)
  delete from public.radar_notifiche_giri where id = any (${lista(e.giri)}) and provider = 'finto';
${controllo("giri cancellati", n.giri)}
  -- 4) le salvate dell'elenco, contate PRIMA della cascata
  select count(*) into n from public.omnia_ai_radar_salvate where id = any (${lista(e.salvate)}) and aggiunta_id = any (${lista(e.aggiunte)});
  if n <> ${n.salvate} then raise exception 'PULIZIA Z8 ANNULLATA: salvate dell''elenco % invece di ${n.salvate}', n; end if;
  -- 5) gare aggiunte sintetiche: le salvate se ne vanno in cascata (omnia_ai_radar_salvate_aggiunta_id_fkey ON DELETE CASCADE)
  delete from public.omnia_ai_radar_gare_aggiunte where id = any (${lista(e.aggiunte)}) and oggetto like '${ETICHETTA}%';
${controllo("gare aggiunte cancellate", n.aggiunte)}
  select count(*) into n from public.omnia_ai_radar_salvate where id = any (${lista(e.salvate)});
  if n <> 0 then raise exception 'PULIZIA Z8 ANNULLATA: % salvate rimaste (cascata non avvenuta)', n; end if;
  -- 6) stato finale: il motore era VUOTO prima di Z8 e deve tornare vuoto
  if exists (select 1 from public.omnia_ai_radar_eventi) or exists (select 1 from public.omnia_ai_radar_email_consegne) or exists (select 1 from public.radar_notifiche_giri) then
    raise exception 'PULIZIA Z8 ANNULLATA: nel motore restano righe che non sono di Z8';
  end if;
  raise notice 'PULIZIA Z8 FATTA: consegne ${n.consegne}, eventi ${n.eventi}, giri ${n.giri}, salvate ${n.salvate} (in cascata), gare aggiunte ${n.aggiunte}';
end
$pulizia_z8$;`;
}

// ═══════════════════════════ uso dallo staging ═══════════════════════════
const CLI = "C:/Users/Dell/AppData/Local/Temp/claude/abcfdf0028fd8393/e334def8-d832-4558-942a-9241c500a45d/scratchpad/staging/node_modules/supabase/dist/supabase.js";
const GUARDIA = "file:///C:/Users/Dell/AppData/Local/Temp/claude/abcfdf0028fd8393/e334def8-d832-4558-942a-9241c500a45d/scratchpad/staging/guardia-staging.mjs";
const argomento = (nome) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : null; };

async function staging() {
  const { caricaStaging, oscura } = await import(GUARDIA);
  const v = caricaStaging();
  if (v.STAGING_PROJECT_REF !== "ryawdldqiumqsskrnyps" || !v.STAGING_DB_URL.includes("ryawdldqiumqsskrnyps")) throw new Error("STOP: non è lo staging");
  return { v, oscura };
}
function query(v, oscura, sql, solaLettura) {
  const lavoro = fs.mkdtempSync(path.join(os.tmpdir(), "z8p-"));
  fs.mkdirSync(path.join(lavoro, "supabase"));
  try {
    // la CLI, lanciata da un agente, NON esegue un'istruzione che modifica dati senza il consenso esplicito «--yes» (errore
    // HostedMutationConsentRequiredError, «Nothing was changed»: primo lancio del 23/11 alle 10:33Z). Il consenso qui è l'autorizzazione
    // registrata (controllaPorta) più la conferma dell'utente; le letture restano «--read-only».
    const r = spawnSync(process.execPath, [CLI, "db", "query", ...(solaLettura ? ["--read-only"] : ["--yes"]), `--remote=${v.STAGING_DB_URL}`, "--workdir", lavoro, sql, "--output-format", "json"], { encoding: "utf8", timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
    return { codice: r.status, uscita: oscura(`${r.stdout ?? ""}${r.stderr ?? ""}`, v), dati: oscura(`${r.stdout ?? ""}`, v) };
  } finally { fs.rmSync(lavoro, { recursive: true, force: true }); }
}
const esitoDi = (uscita) => {
  const d = JSON.parse(uscita.slice(Math.min(...["[", "{"].map((c) => uscita.indexOf(c)).filter((n) => n >= 0))));
  const riga = Array.isArray(d) ? d[0] : (d.rows?.[0] ?? d);
  return typeof riga.esito === "string" ? JSON.parse(riga.esito) : riga.esito;
};

async function principale() {
  const modo = process.argv[2];
  if (modo === "elenco") {
    const giro = JSON.parse(fs.readFileSync(argomento("--giro"), "utf8"));
    const uscita = argomento("--uscita");
    const { v, oscura } = await staging();
    const r = query(v, oscura, `select json_build_object(
 'aggiunte', (select coalesce(json_agg(id), '[]') from public.omnia_ai_radar_gare_aggiunte where oggetto like '${ETICHETTA}%'),
 'salvate', (select coalesce(json_agg(s.id), '[]') from public.omnia_ai_radar_salvate s join public.omnia_ai_radar_gare_aggiunte a on a.id = s.aggiunta_id where a.oggetto like '${ETICHETTA}%'),
 'eventi', (select coalesce(json_agg(id), '[]') from public.omnia_ai_radar_eventi),
 'eventi_tipi', (select coalesce(json_object_agg(tipo, n), '{}') from (select tipo, count(*) n from public.omnia_ai_radar_eventi group by tipo) x),
 'consegne', (select coalesce(json_agg(id), '[]') from public.omnia_ai_radar_email_consegne),
 'consegne_finte_inviate', (select count(*) from public.omnia_ai_radar_email_consegne where provider = 'finto' and stato = 'inviata'),
 'giri', (select coalesce(json_agg(id), '[]') from public.radar_notifiche_giri)
) as esito`, true);
    if (r.codice !== 0) throw new Error(`lettura: ${r.uscita.slice(0, 500)}`);
    const l = esitoDi(r.dati);
    const tipiGiro = {};
    for (const [k, x] of Object.entries(giro.eventi)) { const t = k.split("|")[1]; tipiGiro[t] = (tipiGiro[t] ?? 0) + x; }
    const ordina = (o) => JSON.stringify(Object.entries(o).sort());
    const controlli = [
      ["conteggi uguali all'esito del giro (eventi, consegne, giri, gare aggiunte, salvate)", l.eventi.length === giro.dopo2.eventi && l.consegne.length === giro.dopo2.consegne && l.giri.length === giro.dopo2.giri && l.aggiunte.length === giro.dopo2.aggiunte && l.salvate.length === giro.dopo2.salvate],
      ["tipi degli eventi uguali all'esito del giro", ordina(l.eventi_tipi) === ordina(tipiGiro)],
      ["consegne tutte «inviata» col finto", l.consegne_finte_inviate === l.consegne.length],
    ];
    for (const [nome, ok] of controlli) console.log(`${ok ? "ok      " : "FALLITO "} ${nome}`);
    if (controlli.some(([, ok]) => !ok)) return 1;
    const elenco = canonico(l);
    fs.writeFileSync(uscita, JSON.stringify({ letto_il: new Date().toISOString(), etichetta: ETICHETTA, elenco, conteggi: Object.fromEntries(TABELLE.map((t) => [t, elenco[t].length])), impronta: impronta(elenco) }, null, 1));
    console.log(`elenco scritto in ${uscita}: ${TABELLE.map((t) => `${t} ${elenco[t].length}`).join(", ")}; impronta ${impronta(elenco)}`);
    return 0;
  }
  const file = argomento("--elenco");
  if (!file || !fs.existsSync(file)) { console.error("uso: pulizia-z8.mjs elenco --giro F --uscita F | prova --elenco F | applica --elenco F"); return 2; }
  const dati = JSON.parse(fs.readFileSync(file, "utf8"));
  const elenco = canonico(dati.elenco);
  if (impronta(elenco) !== dati.impronta) { console.error("STOP: l'elenco non corrisponde alla sua impronta"); return 2; }
  if (modo === "prova") {
    const { v, oscura } = await staging();
    const r = query(v, oscura, sqlProva(elenco), true);
    if (r.codice !== 0) throw new Error(`lettura: ${r.uscita.slice(0, 500)}`);
    const e = esitoDi(r.dati);
    console.log(JSON.stringify(e));
    const ok = e.consegne === elenco.consegne.length && e.eventi === elenco.eventi.length && e.giri === elenco.giri.length && e.salvate === elenco.salvate.length
      && e.salvate_in_cascata === elenco.salvate.length && e.aggiunte === elenco.aggiunte.length && e.motore_fuori_elenco === 0 && e.consegne_di_eventi_in_elenco_fuori_elenco === 0;
    console.log(`${ok ? "ok      " : "FALLITO "} prova a vuoto: cancellerebbe ESATTAMENTE l'elenco (${TABELLE.map((t) => `${t} ${elenco[t].length}`).join(", ")}), nessuna riga fuori elenco nel motore`);
    return ok ? 0 : 1;
  }
  if (modo === "applica") {
    const registro = process.env.TI_REGISTRO;
    if (!registro) { console.error("STOP: cancella sullo staging: solo con esegui-autorizzato.mjs e un'autorizzazione registrata"); return 2; }
    const { controllaPorta } = await import(new URL(`file:///${registro.replace(/\\/g, "/").replace(/^\/+/, "")}/registro.mjs`).href);
    controllaPorta({ script: "pulizia-z8.mjs" });
    if (process.env.ELENCO_SHA256 !== dati.impronta) { console.error("STOP: l'impronta dell'elenco non è quella dell'autorizzazione"); return 2; }
    const { v, oscura } = await staging();
    const r = query(v, oscura, sqlPulizia(elenco), false);
    console.log(r.uscita.split("\n").filter((x) => /PULIZIA Z8|error|ERROR/.test(x)).join("\n") || r.uscita.slice(-400));
    console.log(r.codice === 0 ? "PULIZIA: RIUSCITA" : `PULIZIA: ANNULLATA (codice ${r.codice}), nulla cancellato`);
    return r.codice === 0 ? 0 : 1;
  }
  console.error("modo sconosciuto");
  return 2;
}

// solo quando è lanciato direttamente (non quando lo importa la prova isolata, il cui nome finisce allo stesso modo)
if (process.argv[1] && /(^|\/)pulizia-z8\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  principale().then((c) => process.exit(c)).catch((e) => { console.error(`FERMATO: ${e instanceof Error ? e.message : String(e)}`); process.exit(3); });
}
