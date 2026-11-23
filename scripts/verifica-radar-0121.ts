// Verifica LOCALE della migrazione 0121 (PROGETTO, mai applicata) e delle prove chieste dall'utente il 17/11/2026 (punto F): unioni,
// annullamenti, eliminazione dei collegamenti, provenienze spostate, 3 o più fonti, rettifiche TED su gare unite. Database IN MEMORIA, nessuna
// rete, dati SINTETICI. La prova della funzione delle fonti su un Postgres VERO e isolato è separata (documento 14) e aspetta l'approvazione
// dell'utente: qui la regola è emulata in scripts/lib/db-in-memoria.ts ({ fonti: "0121" }).
//   A. il file SQL: additivo, permessi, chiavi esterne, indici, nessun cambio di «settori»;
//   B. fonti della gara sempre uguali alle provenienze (destinazione E origine);
//   C. righe di classificazione: più settori, più sottocategorie, livello per settore, versione, storico, decisioni protette, ripristino;
//   D. rettifiche, proroghe ed esiti TED su gare unite e dopo l'annullamento dell'unione.
import fs from "fs";
import path from "path";
import { databaseInMemoria, type RigaMem } from "./lib/db-in-memoria";
import { SETTORI_RADAR, VERSIONE_REGOLE_SETTORI, vociCpv } from "../src/lib/radar/settori";
import { ambiguitaTraFonti, classificaPerArchivio, type ClassificazioneArchivio, type ValutazioneSettore } from "../src/lib/radar/classificazione-unita";
import { aggiornamentoClassificazioni, conservaComeNonPertinente, decisioneAmministratore, erroriRiga, etichettaRilevanza, gareSuggeribili, motiviPerRegole, righeDaClassificazione, righeDaRipristinare, righeDopoUnione, situazioneGara, stessaClassificazione, type RigaClassificazione, type RigaStato } from "../src/lib/radar/classificazioni-calcoli";
import { scriviClassificazioni, segnaInAttesa } from "../src/lib/radar/classificazioni";
import { collegaGare, scollegaGara } from "../src/lib/radar/collegamenti";
import { applicaPaginaBandi, applicaPaginaEsiti } from "../src/lib/radar/importa";
import { applicaPaginaBandiRegionali } from "../src/lib/radar/importa-regionali-pagina";
import { bandoDaAflink, statisticheRegionaliVuote, type BandoRegionale } from "../src/lib/radar/importa-regionali-calcoli";
import { leggiElementoAflink, type BandoAflink } from "../src/lib/radar/fonti/aflink-calcoli";
import { eEsclusione, leggiBandoTed, leggiEsitoTed, type EsitoTed } from "../src/lib/radar/fonti/ted-calcoli";

const RADICE = path.join(__dirname, "..");
const leggi = (r: string) => fs.readFileSync(path.join(RADICE, r), "utf8");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, reale: unknown, previsto: unknown) {
  const a = JSON.stringify(reale);
  const b = JSON.stringify(previsto);
  atteso(nome, a === b, `atteso ${b}, ottenuto ${a}`);
}

const OGGI = "2026-11-17";
const ADESSO = new Date("2026-11-17T12:00:00Z");
const ISO = ADESSO.toISOString();
const misure = () => ({ richiesteDb: 0, msDb: 0 });
let n = 0;
const nuovoId = () => `cls-${++n}`;

// ───── dati SINTETICI ─────
function gara(id: string, p: Partial<RigaMem> = {}): RigaMem {
  return {
    id,
    chiave: `ted:proc-${id}`,
    oggetto: "Servizio di ristorazione scolastica (prova sintetica)",
    oggetto_breve: "Ristorazione scolastica",
    descrizione: null,
    sa_codice_fiscale: "00000000001",
    sa_denominazione: "COMUNE DI PROVASINTETICA",
    sa_comune: null,
    sa_provincia: null,
    sa_regione: "sardegna",
    codice_nuts: null,
    luogo_regioni: ["sardegna"],
    ente_tipo: null,
    tipo_avviso: "cn-standard",
    tipo_procedura: "Procedura aperta",
    criterio_aggiudicazione: null,
    natura_contratto: "servizi",
    settori_speciali: false,
    data_pubblicazione: "2026-11-01",
    scadenza_giorno: "2026-12-10",
    scadenza_offerte: "2026-12-10T09:00:00.000Z",
    scadenza_ora_indicata: true,
    scadenza_fonte: "2026-12-10+01:00 10:00:00+01:00",
    valore_stimato: 2000000,
    durata_mesi: null,
    n_lotti: 1,
    stato: "aperta",
    rettificata: false,
    url_avviso: null,
    url_documenti: null,
    piattaforma_host: null,
    cpv_principale: "55524000",
    cpv_tutti: ["55524000"],
    settori: ["ristorazione"],
    metodo_settore: "cpv",
    ultima_versione_il: "2026-11-01",
    ultima_versione_id: "700001-2026",
    ultima_rilevazione_il: "2026-11-01T08:00:00.000Z",
    aggiornata_il: "2026-11-01T08:00:00.000Z",
    valore_base: null,
    piattaforma_id: null,
    tipo_opportunita: "bando",
    partecipazione: "libera",
    provenienza_campi: {},
    unita_a: null,
    unita_il: null,
    unita_motivo: null,
    unita_esclusa_con: [],
    fonti: ["ted"],
    prima_rilevazione_il: "2026-11-01T08:00:00.000Z",
    ...p,
  };
}
const lotto = (procedura_id: string, p: Partial<RigaMem> = {}): RigaMem => ({ procedura_id, numero_lotto: "LOT-0001", cig: null, oggetto: null, cpv_principale: "55524000", cpv_tutti: ["55524000"], valore_stimato: 2000000, durata_mesi: null, scadenza_giorno: "2026-12-10", scadenza_offerte: "2026-12-10T09:00:00.000Z", scadenza_ora_indicata: true, scadenza_fonte: null, url_documenti: null, ...p });
const prov = (procedura_id: string, fonte: string, id_fonte: string, p: Partial<RigaMem> = {}): RigaMem => ({ procedura_id, fonte, id_fonte, impronta: `imp-${id_fonte}`, id_procedura_fonte: id_fonte, rif_ted: null, ...p });

type Mem = ReturnType<typeof databaseInMemoria>;
// l'invariante della 0121: per OGNI gara le fonti sono esattamente l'insieme delle fonti delle sue provenienze (vuoto se non ne ha)
function fontiObsolete(mem: Mem): string[] {
  return mem.tabelle.radar_procedure
    .filter((g) => {
      const attese = [...new Set((mem.tabelle.radar_procedure_fonti ?? []).filter((p) => p.procedura_id === g.id).map((p) => p.fonte as string))].sort();
      const ora = [...new Set((g.fonti as string[]) ?? [])].sort();
      return JSON.stringify(attese) !== JSON.stringify(ora);
    })
    .map((g) => `${g.id}: ${JSON.stringify(g.fonti)}`);
}
const fontiDi = (mem: Mem, id: string) => [...((mem.tabelle.radar_procedure.find((g) => g.id === id)?.fonti as string[]) ?? [])].sort();
const garaDi = (mem: Mem, id: string) => mem.tabelle.radar_procedure.find((g) => g.id === id) as RigaMem;

function elementoSardegna(id: string, p: Record<string, string> = {}): Record<string, string> {
  return {
    link: `https://sardegnacat.regione.sardegna.it/portale/index.php/bandi?getdettaglio=yes&bando=${id}&scadenzaBando=2026-12-10T10:00:00`,
    Oggetto: "Servizio di ristorazione scolastica (prova sintetica)",
    Tipo: "Bando",
    DenominazioneEnte: "COMUNE DI PROVASINTETICA",
    Contratto: "Servizi",
    a_base_asta: "1.900.000,00",
    DtScadenzaBandoTecnical: "2026-12-10T10:00:00",
    CIG: "",
    TipoProcedura: "Aperta",
    statoFunzionale: "PresOfferte",
    IdMsg: id,
    TitoloDocumento: "Prova sintetica",
    dataUltimaModifica: "2026-11-05T10:00:00",
    CPV: "55524000-9 - Servizi di ristorazione scolastica",
    DtPubblicazioneTecnical: "2026-11-03T11:00:00",
    ...p,
  };
}
const bandoSardegna = (id: string, p: Record<string, string> = {}): BandoRegionale => bandoDaAflink(leggiElementoAflink("sardegnacat", elementoSardegna(id, p), ADESSO) as BandoAflink, OGGI) as BandoRegionale;
async function importaSardegna(mem: Mem, bandi: BandoRegionale[]) {
  const stat = statisticheRegionaliVuote();
  await applicaPaginaBandiRegionali(mem.client, bandi, { fonte: "sardegnacat", modo: "incrementale", adesso: ADESSO, misure: misure(), stat, nascoste: new Set(), proponi: false });
  return stat;
}

async function principale() {
  // ═════ A. il file della 0121 ═════
  {
    const sql = leggi("supabase/migrations/0121_radar_classificazioni.sql");
    const codice = sql.replace(/--[^\n]*/g, "");
    atteso("A. 0121 dichiarata PROGETTO, mai applicata (decisione dell'utente del 17/11)", /PROGETTO, MAI APPLICATO/.test(sql));
    atteso("A. due tabelle nuove (classificazioni e stato della classificazione), idempotenti, e nessun'altra", (codice.match(/create table/gi) ?? []).length === 2 && /create table if not exists public\.radar_classificazioni \(/.test(codice) && /create table if not exists public\.radar_classificazioni_stato \(/.test(codice));
    atteso("A. RLS attiva su entrambe", /alter table public\.radar_classificazioni enable row level security/.test(codice) && /alter table public\.radar_classificazioni_stato enable row level security/.test(codice));
    atteso(
      "A. permessi: tolti a tutti, poi solo service_role (classificazioni: lettura, inserimento e aggiornamento solo dello stato della riga; stato: lettura, inserimento, aggiornamento); niente ad anon e authenticated, nessuna cancellazione",
      /revoke all on public\.radar_classificazioni from public, anon, authenticated, service_role;/.test(codice) && /grant select, insert on public\.radar_classificazioni to service_role;/.test(codice) && /grant update \(attiva, sostituita_il, sostituita_da\) on public\.radar_classificazioni to service_role;/.test(codice) &&
        /revoke all on public\.radar_classificazioni_stato from public, anon, authenticated, service_role;/.test(codice) && /grant select, insert, update on public\.radar_classificazioni_stato to service_role;/.test(codice) &&
        !/grant[^;]*to[^;]*\b(anon|authenticated)\b/i.test(codice) && !/grant[^;]*delete[^;]*radar_classificazioni/i.test(codice),
    );
    atteso("A. una sola chiave esterna per tabella (la gara, con cancellazione a catena); nessuna sulle colonne di traccia", (codice.match(/references/gi) ?? []).length === 2 && /procedura_id uuid not null references public\.radar_procedure \(id\) on delete cascade/.test(codice) && /procedura_id uuid primary key references public\.radar_procedure \(id\) on delete cascade/.test(codice) && !/sostituita_da uuid[^,\n]*references/.test(codice) && !/autore text[^,\n]*references/.test(codice));
    atteso("A. una sola classificazione attiva per gara e settore (indice unico parziale), indice per settore e rilevanza, indice delle gare da classificare", /create unique index if not exists radar_classificazioni_attiva_uidx on public\.radar_classificazioni \(procedura_id, settore\) where attiva/.test(codice) && /radar_classificazioni_settore_rilevanza_idx on public\.radar_classificazioni \(settore, rilevanza\) where attiva/.test(codice) && /radar_classificazioni_stato_da_fare_idx on public\.radar_classificazioni_stato \(stato, aggiornata_il\) where stato <> 'classificata'/.test(codice));
    const settori = (codice.match(/settore text not null check \(settore in \(([^)]*)\)\)/)?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, ""));
    uguale("A. i settori ammessi sono esattamente quelli di settori.ts", settori, SETTORI_RADAR.map((s) => s.id));
    atteso("A. D3: la colonna si chiama «rilevanza» (non ammissibilità, scritto nel file); nessuna colonna «livello» né «ammissibil…»", /rilevanza text not null check \(rilevanza in \('A', 'B', 'C'\)\)/.test(codice) && !/\blivello\b/i.test(codice) && !/ammissibil/i.test(codice) && /RILEVANZA, NON AMMISSIBILITÀ/.test(sql));
    atteso("A. D1: un motivo per ogni regola, nessuno vuoto o fatto di soli spazi (vincolo nel database)", /cardinality\(motivi\) = cardinality\(regole\)/.test(codice) && /cardinality\(regole\) between 1 and 10/.test(codice) && /!~ E'\\x01\[\[:space:\]\]\*\\x01'/.test(codice) && /motivi text\[\] not null,/.test(codice));
    atteso("A. D1: la nota non è mai vuota né fatta di soli spazi; obbligatoria per l'amministratore", /nota is null or \(char_length\(nota\) <= 1000 and btrim\(nota\) <> ''\)/.test(codice) && /origine <> 'amministratore' or nota is not null/.test(codice));
    atteso("A. D3: provenienze per fonte (oggetto con soli valori A, B, C) e conflitti («ambigua»)", /per_fonte jsonb not null default '\{\}'::jsonb/.test(codice) && /jsonb_path_exists\(per_fonte, '\$\.\* \? \(@ != "A" && @ != "B" && @ != "C"\)'\)/.test(codice) && /ambigua boolean not null default false/.test(codice));
    atteso("A. sottocategorie multiple con solo la forma controllata; C senza sottocategorie; stato della riga coerente", /sottocategorie text\[\] not null default '\{\}'/.test(codice) && /rilevanza <> 'C' or cardinality\(sottocategorie\) = 0/.test(codice) && /\(attiva and sostituita_il is null and sostituita_da is null\) or \(not attiva and sostituita_il is not null\)/.test(codice));
    atteso(
      "A. D2: stato per gara in_attesa / classificata / fallita; errore pieno solo se fallita; classificata con versione e data; tentativo registrato",
      /stato text not null check \(stato in \('in_attesa', 'classificata', 'fallita'\)\)/.test(codice) && /\(stato = 'fallita'\) = \(errore is not null\)/.test(codice) && /errore is null or \(char_length\(errore\) <= 1000 and btrim\(errore\) <> ''\)/.test(codice) && /stato <> 'classificata' or \(versione_regole is not null and classificata_il is not null\)/.test(codice) && /stato = 'in_attesa' or tentativo_il is not null/.test(codice),
    );
    atteso("A. «settori», «metodo_settore» e le colonne della gara non cambiano: nessun alter di radar_procedure, nessun aggiornamento dei settori", !/alter table public\.radar_procedure\b/i.test(codice) && !/set\s+settori/i.test(codice) && !/metodo_settore/i.test(codice));
    const aggiornamenti = codice.match(/^update public\.radar_procedure[^;]*;/gim) ?? [];
    const tutti = codice.match(/update public\.radar_procedure[^;]*;/gi) ?? [];
    atteso(
      "A. le sole scritture sulle gare (2 nel riallineamento, 2 nella funzione) sono sulla colonna «fonti»; il riallineamento solo dove è diversa dalle provenienze",
      aggiornamenti.length === 2 && tutti.length === 4 && tutti.every((u) => /set fonti = /.test(u) && !/set fonti = [^;]*,\s*\w+\s*=/.test(u)) && /not \(p\.fonti @> r\.fonti and p\.fonti <@ r\.fonti\)/.test(aggiornamenti[0]) && /not exists \(select 1 from public\.radar_procedure_fonti/.test(aggiornamenti[1]),
    );
    atteso("A. funzione delle fonti con lo STESSO NOME della 0120, riscritta (create or replace): security invoker, search_path fisso, EXECUTE solo a service_role", /create or replace function public\.radar_aggiungi_fonte_alla_gara\(\) returns trigger\s+language plpgsql\s+security invoker\s+set search_path = public/.test(codice) && /revoke all on function public\.radar_aggiungi_fonte_alla_gara\(\) from public, anon, authenticated;/.test(codice) && /grant execute on function public\.radar_aggiungi_fonte_alla_gara\(\) to service_role;/.test(codice) && (codice.match(/create or replace function/gi) ?? []).length === 1);
    atteso("A. funzione: destinazione (aggiunge se manca) E origine (su cambio di gara o di fonte, e su cancellazione, ricalcolo dalle provenienze, scritto solo se cambia)", /tg_op in \('INSERT', 'UPDATE'\)/.test(codice) && /tg_op = 'DELETE' or \(tg_op = 'UPDATE' and \(old\.procedura_id is distinct from new\.procedura_id or old\.fonte is distinct from new\.fonte\)\)/.test(codice) && /where f\.procedura_id = old\.procedura_id/.test(codice));
    atteso("A. lo STESSO trigger della 0120 aggiornato sul posto (create or replace) con un evento in più, la cancellazione", /create or replace trigger radar_procedure_fonti_aggiunge_fonte\s+after insert or update of procedura_id, fonte or delete on public\.radar_procedure_fonti\s+for each row execute function public\.radar_aggiungi_fonte_alla_gara\(\);/.test(codice) && (codice.match(/create (or replace )?trigger/gi) ?? []).length === 1);
    atteso("A. migrazione NON distruttiva: nessun DROP di alcun tipo, nessuna cancellazione o troncamento di dati", !/\bdrop\b/i.test(codice) && !/\bdelete from\b|\btruncate\b/i.test(codice));
    const migrazioni = fs.readdirSync(path.join(RADICE, "supabase/migrations")).filter((f) => /^01[2-9]\d_/.test(f));
    // fase B4 (19/11): dopo la 0121 solo le B4 0122–0125 del 26B; Z5 (21/11): più la 0128 (registro dei giri); 49A (23/11, sessione PVL):
    // più la 0133 (stato «da_verificare», schema S4, numero assegnato dal coordinamento), esattamente queste
    uguale("A. dopo la 0120 c'è solo la 0121 (0118 e 0119 riservate alla PVL, non nel ramo), poi le sole B4 0122–0125, la 0128 e la 0133", migrazioni, ["0120_radar_multifonte.sql", "0121_radar_classificazioni.sql", "0122_radar_profili_per_te.sql", "0123_radar_aggiornamenti_evidenza.sql", "0124_radar_avvisi_preferenze.sql", "0125_radar_avvisi_eventi_coda.sql", "0128_radar_esecuzioni.sql", "0133_radar_classificazioni_da_verificare.sql"]);
  }

  // ═════ A bis. strumenti della prova su un Postgres isolato (si eseguono solo dopo l'approvazione dell'utente) ═════
  {
    const esegui = leggi("scripts/prova-isolata/esegui-prova-isolata.mjs");
    const avvio = esegui.match(/docker\(\["run",[^\]]*\]\)/)?.[0] ?? "";
    atteso("A bis. contenitore usa e getta, senza rete né porte pubblicate, senza volumi", /"run", "--rm", "-d", "--name", nome, "--network", "none"/.test(avvio) && !/"-p"|--publish|"-v"|--volume|--mount/.test(avvio) && (esegui.match(/docker\(\["run"/g) ?? []).length === 1);
    atteso("A bis. nessuna variabile d'ambiente del progetto letta o passata (password casuale mai salvata)", !/process\.env/.test(esegui) && /POSTGRES_PASSWORD=\$\{randomBytes/.test(esegui));
    atteso("A bis. solo immagini ufficiali postgres con versione esplicita", /\^postgres:\\d\{2\}/.test(esegui));
    atteso("A bis. ordine: prerequisiti, 0109–0117 e 0120, dati scritti con la 0120, 0121 due volte (idempotenza), prove", /"0109", "0110", "0111", "0112", "0113", "0114", "0115", "0116", "0117", "0120"/.test(esegui) && /migrazione 0121 di nuovo \(idempotenza\)/.test(esegui));
    for (const f of ["00_prerequisiti.sql", "10_dati_prima_della_0121.sql", "20_prova_0121.sql"]) atteso(`A bis. ${f}: dichiarato solo per la prova isolata, fuori dalle migrazioni`, leggi(`scripts/prova-isolata/${f}`).includes("SOLO PER LA PROVA ISOLATA") && !fs.existsSync(path.join(RADICE, "supabase/migrations", f)));
    const prove = leggi("scripts/prova-isolata/20_prova_0121.sql");
    atteso("A bis. le prove reali coprono unione, spostamento, annullamento, 3 fonti, cambio di fonte, cancellazioni, upsert identico, permessi, vincoli, storico", ["unione:", "provenienza spostata", "annullamento:", "tre fonti", "cambia fonte", "cancellata", "upsert identico", "permessi:", "vincoli:", "storico:", "gara cancellata"].every((k) => prove.includes(k)));
  }

  // ═════ B. fonti della gara = provenienze (destinazione E origine) ═════
  {
    // provenienza spostata da una gara a un'altra: con la regola della 0120 la gara di origine resta con la fonte (riferimento obsoleto)
    const iniziali = () => ({
      radar_procedure: [gara("T", { fonti: ["ted"] }), gara("S", { chiave: "sardegnacat:700001", fonti: ["sardegnacat"] })],
      radar_procedure_fonti: [prov("T", "ted", "700001-2026"), prov("S", "sardegnacat", "700001")],
    });
    const vecchia = databaseInMemoria(iniziali());
    await vecchia.client.from("radar_procedure_fonti").upsert([{ ...prov("T", "sardegnacat", "700001"), impronta: "nuova" }], { onConflict: "fonte,id_fonte" });
    uguale("B. con la funzione della 0120 la gara di origine conserva una fonte che non ha più (il difetto che la 0121 corregge)", fontiObsolete(vecchia), ["S: [\"sardegnacat\"]"]);
    const mem = databaseInMemoria(iniziali(), { fonti: "0121" });
    await mem.client.from("radar_procedure_fonti").upsert([{ ...prov("T", "sardegnacat", "700001"), impronta: "nuova" }], { onConflict: "fonte,id_fonte" });
    uguale("B. con la 0121: la destinazione guadagna la fonte, l'origine la perde, nessun riferimento obsoleto", [fontiDi(mem, "T"), fontiDi(mem, "S"), fontiObsolete(mem)], [["sardegnacat", "ted"], [], []]);
    const scritture = mem.scrittureGareDelTrigger();
    await mem.client.from("radar_procedure_fonti").upsert([{ ...prov("T", "sardegnacat", "700001"), impronta: "nuova" }], { onConflict: "fonte,id_fonte" });
    uguale("B. un upsert identico non scrive nulla sulle gare", mem.scrittureGareDelTrigger() - scritture, 0);
  }
  {
    // 3 o più fonti: la gara perde solo la fonte che non ha più; le altre restano
    const mem = databaseInMemoria(
      {
        radar_procedure: [gara("G", { fonti: ["ted", "pvl", "sintel"] }), gara("H", { chiave: "sintel:9", fonti: [] })],
        radar_procedure_fonti: [prov("G", "ted", "700010-2026"), prov("G", "pvl", "av-10"), prov("G", "pvl", "av-11"), prov("G", "sintel", "900010")],
      },
      { fonti: "0121" },
    );
    await mem.client.from("radar_procedure_fonti").update({ procedura_id: "H" }).eq("fonte", "sintel").eq("id_fonte", "900010");
    uguale("B. tre fonti, una provenienza Sintel spostata: G tiene TED e PVL, H prende Sintel", [fontiDi(mem, "G"), fontiDi(mem, "H"), fontiObsolete(mem)], [["pvl", "ted"], ["sintel"], []]);
    await mem.client.from("radar_procedure_fonti").delete().eq("fonte", "pvl").eq("id_fonte", "av-10");
    uguale("B. cancellata una sola delle due provenienze PVL: la fonte PVL resta (c'è ancora l'altra)", fontiDi(mem, "G"), ["pvl", "ted"]);
    await mem.client.from("radar_procedure_fonti").delete().eq("fonte", "pvl").eq("id_fonte", "av-11");
    uguale("B. cancellata anche l'ultima provenienza PVL: la fonte PVL sparisce", [fontiDi(mem, "G"), fontiObsolete(mem)], [["ted"], []]);
    await mem.client.from("radar_procedure_fonti").update({ fonte: "pvl" }).eq("fonte", "sintel").eq("id_fonte", "900010");
    uguale("B. una provenienza che cambia fonte sulla stessa gara: la fonte vecchia sparisce, la nuova compare", [fontiDi(mem, "H"), fontiObsolete(mem)], [["pvl"], []]);
    await mem.client.from("radar_procedure").delete().eq("id", "H");
    uguale("B. gara cancellata: provenienze, lotti e classificazioni se ne vanno con lei (cascata); nessuna fonte obsoleta altrove", [(mem.tabelle.radar_procedure_fonti ?? []).filter((p) => p.procedura_id === "H").length, fontiObsolete(mem)], [0, []]);
  }
  {
    // unione (0117), provenienza spostata dalla nuova lettura, annullamento: nessun riferimento obsoleto in nessun momento
    const mem = databaseInMemoria(
      {
        radar_procedure: [gara("T", { fonti: ["ted"] }), gara("S", { chiave: "sardegnacat:700001", fonti: ["sardegnacat"], scadenza_offerte: "2026-12-10T09:00:00.000Z" })],
        radar_lotti: [lotto("T")],
        radar_procedure_fonti: [prov("T", "ted", "700001-2026"), prov("S", "sardegnacat", "700001", { impronta: "vecchia" })],
        radar_aggiornamenti: [],
        omnia_ai_radar_gare_aggiunte: [],
      },
      { fonti: "0121" },
    );
    const u = await collegaGare(mem.client, [{ a: "S", b: "T", motivo: "stesso CIG (prova sintetica)", traccia: "prova", fonte: "sardegnacat" }], ISO, misure());
    uguale("B. unione: nessuna provenienza si sposta, le fonti di entrambe restano come prima", [u.collegate, garaDi(mem, "S").unita_a, fontiDi(mem, "T"), fontiDi(mem, "S"), fontiObsolete(mem)], [1, "T", ["ted"], ["sardegnacat"], []]);
    await importaSardegna(mem, [bandoSardegna("700001", { DtScadenzaBandoTecnical: "2026-12-18T12:00:00", dataUltimaModifica: "2026-11-16T09:00:00" })]);
    uguale("B. nuova lettura dopo l'unione: la provenienza va alla gara che resta, la copia perde la fonte, nessun riferimento obsoleto", [mem.tabelle.radar_procedure_fonti.find((p) => p.id_fonte === "700001")?.procedura_id, fontiDi(mem, "T"), fontiDi(mem, "S"), fontiObsolete(mem)], ["T", ["sardegnacat", "ted"], [], []]);
    const a = await scollegaGara(mem.client, "S", "2026-11-17T13:00:00.000Z");
    uguale("B. annullamento dell'unione: le due gare tornano separate, fonti sempre uguali alle provenienze", [a.ok, garaDi(mem, "S").unita_a, fontiObsolete(mem)], [true, null, []]);
    // eliminazione del collegamento con esclusione definitiva: la coppia non si riunisce da sola, le fonti restano coerenti
    atteso("B. dopo l'annullamento la coppia è esclusa per sempre dalle unioni automatiche", ((garaDi(mem, "S").unita_esclusa_con as string[]) ?? []).includes("T") || ((garaDi(mem, "T").unita_esclusa_con as string[]) ?? []).includes("S"));
    const di = await collegaGare(mem.client, [{ a: "S", b: "T", motivo: "stesso CIG (prova sintetica)", traccia: "prova-2", fonte: "sardegnacat" }], ISO, misure());
    uguale("B. una nuova richiesta di unione automatica non la rifà; fonti coerenti", [di.collegate, fontiObsolete(mem)], [0, []]);
  }

  // ═════ C. righe di classificazione (0121) ═════
  {
    const BAR = classificaPerArchivio({ oggetto: "Concessione della gestione del bar e punto ristoro del parco comunale (prova sintetica)", cpv_principale: "55300000", cpv_tutti: ["55300000"], natura_contratto: "servizi" }, []);
    const RSA = classificaPerArchivio({ oggetto: "Gestione dei servizi socio-assistenziali e di ristorazione della residenza per anziani (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    const CASONE = classificaPerArchivio({ oggetto: "Affidamento in concessione del casone “Paduli” per la durata di sette anni (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    const ctx = (p: Partial<Parameters<typeof righeDaClassificazione>[1]> = {}) => ({ proceduraId: "G", origine: "importazione" as const, fonti: ["ted"], autore: "importazione:ted", adessoIso: ISO, nuovoId, ...p });
    const rBar = righeDaClassificazione(BAR, ctx({ settoriColonna: ["ristorazione"] }));
    // regole 2026-11-17c della PVL (interfaccia reale): «bar e punto ristoro» ha DUE sottocategorie nello stesso settore, e i CPV del settore
    uguale(
      "C. concessione del bar e punto ristoro: una riga, ristorazione A, due sottocategorie in ordine (dal classificatore vero), regola, CPV, versione, non ambigua",
      rBar.map((r) => [r.settore, r.rilevanza, r.sottocategorie, r.regole[0], r.cpv, r.versione_regole, r.ambigua]),
      [["ristorazione", "A", ["concessione_bar", "concessione_punto_ristoro"], "cpv_principale", ["55300000"], BAR.versione, false]],
    );
    atteso("C. la versione delle regole viene da classificaGara (interfaccia della PVL)", BAR.versione === VERSIONE_REGOLE_SETTORI && /^\d{4}-\d{2}-\d{2}[a-z]?$/.test(BAR.versione));
    const rCas = righeDaClassificazione(CASONE, ctx({ settoriColonna: ["ristorazione"] }));
    // regole 23a (S4 del 49C): la concessione di un immobile con un CPV di ristorazione è «da verificare»: la riga C comincia con la regola
    // «da_verificare» e conserva quella di prima (e la gara va nello stato «da_verificare», CASONE.daVerificare)
    uguale("C. casone: ristorazione C senza sottocategorie, «da_verificare» più la regola di prima; la colonna lo ha ancora → ambigua (da decidere, non cambiata)", [rCas.map((r) => [r.rilevanza, r.sottocategorie, r.regole, r.ambigua]), CASONE.daVerificare?.map((d) => [d.settore, d.caso])], [[["C", [], ["da_verificare", "concessione_di_immobili"], true]], [["ristorazione", "immobile_con_cpv_ristorazione"]]]);
    // D1: un motivo per ogni regola, mai vuoto
    atteso("D1. classificatore vero: un motivo per ogni regola, nessuno vuoto, riga valida per i vincoli della 0121", [...rBar, ...rCas].every((r) => r.motivi.length === r.regole.length && r.motivi.every((m) => m.trim().length > 0) && erroriRiga(r).length === 0));
    uguale("D1. motivi mancanti o fatti di soli spazi: ricavati dalla regola e dalla versione, mai vuoti; motivi in più tolti", motiviPerRegole(["cpv_principale", "oggetto", "parole_chiave"], ["  CPV principale  ", "   "], "2026-11-17c"), ["CPV principale", "Regola «oggetto» (regole 2026-11-17c)", "Regola «parole_chiave» (regole 2026-11-17c)"]);
    const rotta = { ...rBar[0], motivi: ["   "] };
    uguale("D1. il codice rifiuta come la 0121: motivo di soli spazi, motivi diversi dalle regole, nota vuota, amministratore senza nota", [erroriRiga(rotta).includes("motivi: nessuno vuoto"), erroriRiga({ ...rBar[0], motivi: [] }).includes("motivi: uno per regola"), erroriRiga({ ...rBar[0], nota: "  " }).length > 0, erroriRiga({ ...rBar[0], origine: "amministratore", nota: null }).length > 0], [true, true, true, true]);
    // multisettore e multisottocategoria: la forma dell'interfaccia della PVL (sottocategorie[], regole[], cpv[])
    const v = (p: Partial<ValutazioneSettore>): ValutazioneSettore => ({ livello: "A", sottocategoria: null, regola: "cpv_principale", sottocategorie: [], regole: ["cpv_principale"], motivi: ["motivo sintetico"], da: "cpv", cpv: [], ...p });
    const MULTI: ClassificazioneArchivio = {
      settori: ["ristorazione", "pulizia"],
      metodo: "cpv",
      livello: "A",
      versione: "2026-11-17c",
      perSettore: {
        ristorazione: v({ sottocategorie: ["concessione_bar", "concessione_ristorante"], sottocategoria: "concessione_bar", cpv: ["55300000", "55410000"] }),
        pulizia: v({ livello: "B", sottocategorie: ["pulizia_edifici"], sottocategoria: "pulizia_edifici", regole: ["gestione_integrata", "cpv_secondario"], motivi: ["gestione integrata (sintetico)", "CPV secondario (sintetico)"], regola: "gestione_integrata", cpv: ["90910000"] }),
        vigilanza_portierato: v({ livello: "C", sottocategorie: [], regole: ["videosorveglianza_fornitura"], regola: "videosorveglianza_fornitura", da: "cpv", cpv: ["79711000"] }),
      },
    };
    const rMulti = righeDaClassificazione(MULTI, ctx({ settoriColonna: ["ristorazione", "pulizia"] }));
    uguale(
      "C. multisettore: una riga per settore, rilevanza per settore (A, B, C), più sottocategorie nello stesso settore in ordine, regole e CPV",
      rMulti.map((r) => [r.settore, r.rilevanza, r.sottocategorie, r.regole, r.cpv, r.versione_regole]),
      [
        ["pulizia", "B", ["pulizia_edifici"], ["gestione_integrata", "cpv_secondario"], ["90910000"], "2026-11-17c"],
        ["ristorazione", "A", ["concessione_bar", "concessione_ristorante"], ["cpv_principale"], ["55300000", "55410000"], "2026-11-17c"],
        ["vigilanza_portierato", "C", [], ["videosorveglianza_fornitura"], ["79711000"], "2026-11-17c"],
      ],
    );
    // D3: gara di più fonti: la rilevanza migliore tra dati uniti e fonti, provenienze conservate, ambigua se non sono d'accordo
    const r2 = righeDaClassificazione(RSA, ctx({ fonti: ["pvl", "ted"], perFonte: [{ fonte: "ted", classificazione: BAR }], settoriColonna: ["ristorazione"] }));
    uguale("D3. più fonti: rilevanza migliore (A da TED, B dai dati uniti), sottocategorie della fonte che la dà, provenienze conservate, riga ambigua", r2.map((r) => [r.rilevanza, r.sottocategorie, r.fonti, r.per_fonte, r.ambigua]), [["A", ["concessione_bar", "concessione_punto_ristoro"], ["pvl", "ted"], { dati_uniti: "B", ted: "A" }, true]]);
    atteso("D3. «rilevanza», non ammissibilità: scritto nei commenti e nei nomi del codice", leggi("src/lib/radar/classificazioni-calcoli.ts").includes("RILEVANZA, NON AMMISSIBILITÀ") && leggi("src/lib/radar/classificazioni.ts").includes("NON ammissibilità") && !/ammissibil[a-z]*\s*[:=]/i.test(leggi("src/lib/radar/classificazioni-calcoli.ts")));
    // storico: uguale = niente; cambiata = disattiva + inserisce; settore sparito = disattiva; amministratore protetto
    const attive: RigaClassificazione[] = rMulti.map((r) => ({ ...r }));
    const ancora = righeDaClassificazione(MULTI, ctx({ settoriColonna: ["ristorazione", "pulizia"], fonti: ["ted", "pvl"], autore: "importazione:pvl" }));
    uguale("C. stessa classificazione (cambiano solo fonti e autore): nessuna scrittura", [aggiornamentoClassificazioni(attive, ancora, ISO).inserisci.length, aggiornamentoClassificazioni(attive, ancora, ISO).disattiva.length], [0, 0]);
    const cambiata: ClassificazioneArchivio = { ...MULTI, perSettore: { ...MULTI.perSettore, pulizia: v({ livello: "A", sottocategorie: ["pulizia_edifici"], sottocategoria: "pulizia_edifici", cpv: ["90910000"] }) } };
    delete (cambiata.perSettore as Record<string, unknown>).vigilanza_portierato;
    const agg = aggiornamentoClassificazioni(attive, righeDaClassificazione(cambiata, ctx({ settoriColonna: ["ristorazione", "pulizia"] })), ISO);
    const pul = attive.find((r) => r.settore === "pulizia") as RigaClassificazione;
    const vig = attive.find((r) => r.settore === "vigilanza_portierato") as RigaClassificazione;
    uguale(
      "C. pulizia da B ad A: la riga vecchia si disattiva puntando alla nuova; vigilanza non più considerata: si chiude senza sostituta; ristorazione invariata",
      [agg.inserisci.map((r) => [r.settore, r.rilevanza]), agg.disattiva.map((d) => [d.id === pul.id ? "pulizia" : d.id === vig.id ? "vigilanza" : "?", d.sostituita_da === agg.inserisci[0]?.id ? "nuova" : d.sostituita_da]), agg.invariate],
      [[["pulizia", "A"]], [["pulizia", "nuova"], ["vigilanza", null]], 1],
    );
    const decisa = decisioneAmministratore(attive.find((r) => r.settore === "ristorazione") ?? null, { proceduraId: "G", settore: "ristorazione", rilevanza: "B", sottocategorie: ["concessione_bar"], nota: "Bar dentro la gestione dell'intero parco: correlata (prova sintetica).", autore: "console:admin-sintetico", versione: MULTI.versione, adessoIso: ISO, nuovoId });
    atteso("D1. la decisione dell'amministratore ha una regola, un motivo pieno (la nota) e una nota piena", decisa.inserisci.every((r) => erroriRiga(r).length === 0 && r.motivi.length === 1 && !!r.nota?.trim()));
    const conDecisione = [...attive.filter((r) => r.settore !== "ristorazione"), ...decisa.inserisci];
    const dopo = aggiornamentoClassificazioni(conDecisione, rMulti, ISO);
    uguale("C. la decisione dell'amministratore non viene sostituita dal calcolo automatico: resta, e il calcolo diverso è solo segnalato", [dopo.inserisci.filter((r) => r.settore === "ristorazione").length, dopo.protette.map((p) => [p.settore, p.decisione.rilevanza, p.calcolata.rilevanza])], [0, [["ristorazione", "B", "A"]]]);
    let senzaNota = 0;
    for (const nota of ["", "  ", "\t\n "]) {
      try {
        decisioneAmministratore(null, { proceduraId: "G", settore: "ristorazione", rilevanza: "B", sottocategorie: [], nota, autore: "console:x", versione: "v", adessoIso: ISO, nuovoId });
      } catch {
        senzaNota++;
      }
    }
    uguale("D1. una decisione dell'amministratore con nota vuota o fatta di soli spazi è rifiutata (come il vincolo della 0121)", senzaNota, 3);
    const storico: RigaClassificazione[] = [...rMulti.map((r) => ({ ...r, attiva: false, sostituita_il: ISO })), ...agg.inserisci];
    const rip = righeDaRipristinare(storico, "2026-11-17c", { autore: "riclassificazione:prova", adessoIso: "2026-11-18T08:00:00.000Z", nuovoId });
    uguale("C. ripristino di una versione: le righe tornano come righe NUOVE (lo storico resta intero), con una nota", [rip.length, rip.every((r) => r.origine === "riclassificazione" && !!r.nota && r.attiva && !storico.some((s) => s.id === r.id))], [3, true]);
    atteso("C. due righe uguali per contenuto sono «la stessa classificazione» anche con origine e motivi diversi", stessaClassificazione(rBar[0], { ...rBar[0], origine: "riclassificazione", motivi: ["altro testo"], fonti: ["pvl"] }));
  }
  {
    // scrittura sul database (in memoria): prima volta inserisce; uguale non scrive; cambiata disattiva e inserisce; settori mai toccati; stato
    const mem = databaseInMemoria({ radar_procedure: [gara("G", { settori: ["ristorazione"] })], radar_classificazioni: [], radar_classificazioni_stato: [] }, { fonti: "0121" });
    const colonna = JSON.stringify(garaDi(mem, "G"));
    const calcola = (c: ClassificazioneArchivio) => righeDaClassificazione(c, { proceduraId: "G", origine: "riclassificazione", fonti: ["ted"], autore: "riclassificazione:prova", adessoIso: ISO, nuovoId, settoriColonna: ["ristorazione"] });
    const RSA = classificaPerArchivio({ oggetto: "Gestione dei servizi socio-assistenziali e di ristorazione della residenza per anziani (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    const MENSA = classificaPerArchivio({ oggetto: "Servizio di ristorazione scolastica (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    const voce = (c: ClassificazioneArchivio) => ({ proceduraId: "G", versione: c.versione, calcolate: calcola(c) });
    const stato = () => mem.tabelle.radar_classificazioni_stato.find((s) => s.procedura_id === "G");
    uguale("D2. prima della classificazione: nessuno stato → la gara è «non classificata», mai non pertinente", situazioneGara(null, []).tipo, "non_classificata");
    await segnaInAttesa(mem.client, ["G"], misure(), ISO);
    uguale("D2. gara nuova o cambiata: stato «in_attesa»", [stato()?.stato, situazioneGara(stato() as RigaStato, []).tipo], ["in_attesa", "in_attesa"]);
    const e1 = await scriviClassificazioni(mem.client, [voce(MENSA)], misure(), ISO);
    uguale("D2. classificata: stato «classificata» con versione e data, un tentativo", [e1.classificate, stato()?.stato, stato()?.versione_regole, stato()?.tentativi, stato()?.errore], [1, "classificata", MENSA.versione, 1, null]);
    const e2 = await scriviClassificazioni(mem.client, [voce(MENSA)], misure(), ISO);
    const e3 = await scriviClassificazioni(mem.client, [voce(RSA)], misure(), "2026-11-18T08:00:00.000Z");
    const righe = mem.tabelle.radar_classificazioni;
    uguale("C. scrittura: 1 riga la prima volta, nessuna la seconda, poi 1 disattivata e 1 nuova", [e1.inserite, e2.inserite + e2.disattivate, e3.disattivate, e3.inserite], [1, 0, 1, 1]);
    uguale("F3. storico integro: una sola riga attiva per gara e settore; la vecchia punta alla nuova; nessuna riga cancellata", [righe.filter((r) => r.attiva).length, righe.find((r) => !r.attiva)?.sostituita_da === righe.find((r) => r.attiva)?.id, righe.length], [1, true, 2]);
    uguale("C. la colonna «settori» e tutta la riga della gara non cambiano", JSON.stringify(garaDi(mem, "G")) === colonna, true);
    // classificazione fallita: righe non valide → stato «fallita» con l'errore, righe attive precedenti intatte
    const rotte = calcola(MENSA).map((r) => ({ ...r, motivi: ["   "] }));
    const prima = JSON.stringify(righe);
    const e4 = await scriviClassificazioni(mem.client, [{ proceduraId: "G", versione: MENSA.versione, calcolate: rotte }], misure(), "2026-11-18T09:00:00.000Z");
    uguale("D2. righe non valide (motivo vuoto): nessuna scrittura, stato «fallita» con l'errore, righe precedenti intatte", [e4.fallite, stato()?.stato, /motivi: nessuno vuoto/.test(String(stato()?.errore)), JSON.stringify(mem.tabelle.radar_classificazioni) === prima], [1, "fallita", true, true]);
    const sit = situazioneGara(stato() as RigaStato, righe as RigaClassificazione[]);
    uguale("D2. con la classificazione fallita la gara NON è non pertinente: «da verificare», e non entra nei suggerimenti", [sit.tipo, etichettaRilevanza(sit), gareSuggeribili(righe as RigaClassificazione[], new Map([["G", stato() as RigaStato]]), ["ristorazione"])], ["fallita", "Classificazione da verificare", []]);
    const finto = { from: () => ({ select: () => ({ in: () => ({ eq: () => ({ returns: () => Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table" } }) }) }) }) }) } as unknown as Parameters<typeof scriviClassificazioni>[0];
    uguale("C. senza la 0121 (tabelle assenti) la scrittura non fa nulla e non dà errore", (await scriviClassificazioni(finto, [voce(MENSA)], misure(), ISO)).saltata, true);
    // fase B2b: gli importatori scrivono le classificazioni SOLO con l'interruttore acceso (spento di base): prove in verifica-radar-popolamento
    atteso("C. gli importatori scrivono le classificazioni solo dentro «if (opzioni.classificazioni)» / «if (o.classificazioni)»", [["src/lib/radar/importa.ts", "opzioni.classificazioni"], ["src/lib/radar/importa-fonti-pagina.ts", "o.classificazioni"]].every(([f, k]) => { const t = leggi(f); const i = t.indexOf("scriviClassificazioni(admin"); return i > 0 && t.lastIndexOf(`if (${k})`, i) > 0; }) && ["src/lib/radar/importa-pvl-pagina.ts", "src/lib/radar/importa-regionali.ts"].every((f) => !/scriviClassificazioni|segnaInAttesa/.test(leggi(f))));
  }
  {
    // D3: l'arrivo di una NUOVA FONTE su una gara esistente aggiorna la classificazione con lo storico e segnala il conflitto
    const mem = databaseInMemoria({ radar_procedure: [gara("G", { settori: ["ristorazione"] })], radar_classificazioni: [], radar_classificazioni_stato: [] }, { fonti: "0121" });
    const MENSA = classificaPerArchivio({ oggetto: "Servizio di ristorazione scolastica (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    const RSA = classificaPerArchivio({ oggetto: "Gestione dei servizi socio-assistenziali e di ristorazione della residenza per anziani (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    // gara nata da TED: classificata da sola
    const soloTed = righeDaClassificazione(MENSA, { proceduraId: "G", origine: "importazione", fonti: ["ted"], autore: "importazione:ted", adessoIso: ISO, nuovoId, settoriColonna: ["ristorazione"] });
    await scriviClassificazioni(mem.client, [{ proceduraId: "G", versione: MENSA.versione, calcolate: soloTed }], misure(), ISO);
    const primaRiga = mem.tabelle.radar_classificazioni.find((r) => r.attiva) as RigaClassificazione;
    // arriva la PVL con un oggetto da gestione complessa (B): dati uniti = testo della PVL (precedenza ai dati descrittivi)
    const amb = ambiguitaTraFonti({ fonte: "pvl", altreFonti: ["ted"], daFonte: RSA, altre: MENSA, unita: RSA });
    const dopoUnione = righeDopoUnione({ proceduraId: "G", fonte: "pvl", altreFonti: ["ted"], daFonte: RSA, altre: MENSA, unita: RSA, settoriColonna: ["ristorazione"], autore: "importazione:pvl", adessoIso: "2026-11-18T08:00:00.000Z", nuovoId });
    const e = await scriviClassificazioni(mem.client, [{ proceduraId: "G", versione: RSA.versione, calcolate: dopoUnione }], misure(), "2026-11-18T08:00:00.000Z");
    const nuova = mem.tabelle.radar_classificazioni.find((r) => r.attiva) as RigaClassificazione;
    const vecchia = mem.tabelle.radar_classificazioni.find((r) => r.id === primaRiga.id) as RigaClassificazione;
    uguale(
      "D3. nuova fonte su una gara esistente: la riga di prima (solo TED) si disattiva puntando alla nuova; la nuova è attiva con le due fonti",
      [e.disattivate, e.inserite, vecchia.attiva, vecchia.sostituita_da === nuova.id, nuova.fonti, mem.tabelle.radar_classificazioni.length],
      [1, 1, false, true, ["pvl", "ted"], 2],
    );
    uguale("D3. rilevanza migliore per settore (A da TED), provenienze conservate per fonte e per i dati uniti, conflitto segnato «ambigua»", [nuova.rilevanza, nuova.per_fonte, nuova.ambigua], ["A", { dati_uniti: "B", pvl: "B", ted: "A" }, true]);
    atteso("D3. il conflitto è segnalato anche nel registro (classificatore unico: rilevanza diversa per lo stesso settore)", !!amb && amb.motivi.some((m) => m.startsWith("Livello diverso per ristorazione collettiva: PVL ANAC B")));
    uguale("D3. la colonna «settori» non cambia con la nuova fonte", garaDi(mem, "G").settori, ["ristorazione"]);
    const ancora = righeDopoUnione({ proceduraId: "G", fonte: "pvl", altreFonti: ["ted"], daFonte: RSA, altre: MENSA, unita: RSA, settoriColonna: ["ristorazione"], autore: "importazione:pvl", adessoIso: "2026-11-18T09:00:00.000Z", nuovoId });
    const e2 = await scriviClassificazioni(mem.client, [{ proceduraId: "G", versione: RSA.versione, calcolate: ancora }], misure(), "2026-11-18T09:00:00.000Z");
    uguale("D3. la stessa unione riletta non scrive righe nuove", [e2.inserite, e2.disattivate], [0, 0]);
  }
  {
    // E. le gare non pertinenti: mai nei suggerimenti; visibili nella ricerca generale con «fuori dai settori monitorati»; l'assenza di righe
    // non vale mai C
    const r = (procedura_id: string, settore: string, rilevanza: "A" | "B" | "C", attiva = true) => ({ procedura_id, settore: settore as RigaClassificazione["settore"], rilevanza, attiva });
    const righe = [r("P1", "ristorazione", "A"), r("P2", "ristorazione", "B"), r("P3", "ristorazione", "C"), r("P4", "pulizia", "A"), r("P5", "ristorazione", "A", false), r("P6", "ristorazione", "C"), r("P6", "pulizia", "A"), r("P7", "ristorazione", "A")];
    const st = (s: "in_attesa" | "classificata" | "fallita") => ({ stato: s });
    const stati = new Map([["P1", st("classificata")], ["P2", st("classificata")], ["P3", st("classificata")], ["P4", st("classificata")], ["P5", st("classificata")], ["P6", st("classificata")], ["P7", st("fallita")]]);
    uguale("E. suggerimenti: solo gare CLASSIFICATE con una riga ATTIVA di rilevanza A nei settori dell'impresa (mai B, C, righe storiche, gare fallite)", gareSuggeribili(righe, stati, ["ristorazione"]), ["P1"]);
    uguale("E. una gara C in un settore e A in un altro si suggerisce solo per il settore in cui è A", [gareSuggeribili(righe, stati, ["pulizia"]), gareSuggeribili(righe, stati, ["ristorazione"]).includes("P6")], [["P4", "P6"], false]);
    uguale("E. senza stato nessun suggerimento, anche con una riga A", gareSuggeribili([r("P9", "ristorazione", "A")], new Map(), ["ristorazione"]), []);
    const sC = situazioneGara({ stato: "classificata", versione_regole: "2026-11-17c", errore: null }, [r("P3", "ristorazione", "C")]);
    const sVuota = situazioneGara({ stato: "classificata", versione_regole: "2026-11-17c", errore: null }, []);
    uguale(
      "E. ricerca generale: «Fuori dai settori monitorati» SOLO per una gara classificata con righe C e nessuna A o B; mai per una gara senza righe, in attesa o senza stato",
      [etichettaRilevanza(sC), etichettaRilevanza(sVuota), etichettaRilevanza(situazioneGara({ stato: "in_attesa", versione_regole: null, errore: null }, [])), etichettaRilevanza(situazioneGara(null, [r("P3", "ristorazione", "C")]))],
      ["Fuori dai settori monitorati", null, null, null],
    );
    uguale("E. una gara correlata (solo B) ha la sua etichetta, una pertinente nessuna", [etichettaRilevanza(situazioneGara({ stato: "classificata", versione_regole: "v", errore: null }, [r("P2", "ristorazione", "B")])), etichettaRilevanza(situazioneGara({ stato: "classificata", versione_regole: "v", errore: null }, [r("P1", "ristorazione", "A")]))], ["Correlata ai settori monitorati (appalto misto o gestione complessa)", null]);
    const CASONE = classificaPerArchivio({ oggetto: "Affidamento in concessione del casone “Paduli” per la durata di sette anni (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    uguale("E. una gara non pertinente ha «settori» vuoto: ogni filtro per settore già esistente (Cerca, Monitorate) la esclude", CASONE.settori, []);
    // conservazione: TED e PVL (query già filtrate per CPV) sì; regionali solo con almeno un CPV del file; mai senza alcun settore considerato
    const cpvDelFile = new Set(vociCpv().map((x) => x.cpv));
    const NULLA = classificaPerArchivio({ oggetto: "Fornitura di carta per fotocopiatrici (prova sintetica)", cpv_principale: "30197630", cpv_tutti: ["30197630"], natura_contratto: "forniture" }, []);
    uguale(
      "E. conservazione: TED e PVL sì per una C; Sintel/SardegnaCAT solo con un CPV del file; mai una gara pertinente né una senza alcun settore considerato",
      [
        conservaComeNonPertinente({ fonte: "ted", classificazione: CASONE, cpvTutti: ["55524000"], cpvDelFile }),
        conservaComeNonPertinente({ fonte: "pvl", classificazione: CASONE, cpvTutti: ["55524000"], cpvDelFile }),
        conservaComeNonPertinente({ fonte: "sintel", classificazione: CASONE, cpvTutti: ["55524000"], cpvDelFile }),
        conservaComeNonPertinente({ fonte: "sardegnacat", classificazione: CASONE, cpvTutti: ["45000000"], cpvDelFile }),
        conservaComeNonPertinente({ fonte: "ted", classificazione: classificaPerArchivio({ oggetto: "Servizio di ristorazione scolastica (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []), cpvTutti: ["55524000"], cpvDelFile }),
        conservaComeNonPertinente({ fonte: "ted", classificazione: NULLA, cpvTutti: ["30197630"], cpvDelFile }),
      ],
      [true, true, true, false, false, false],
    );
    atteso("E. il codice della conservazione resta spento: nessun importatore lo usa finché non c'è la 0121", ["src/lib/radar/importa.ts", "src/lib/radar/importa-fonti-pagina.ts", "src/lib/radar/fonti/ted-calcoli.ts", "src/lib/radar/fonti/pvl-calcoli.ts", "src/lib/radar/fonti/sintel-calcoli.ts", "src/lib/radar/fonti/aflink-calcoli.ts"].every((f) => !leggi(f).includes("conservaComeNonPertinente")));
  }

  // ═════ D. rettifiche, proroghe ed esiti TED su gare unite, e dopo l'annullamento ═════
  {
    const avviso = (numero: string, proc: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
      "publication-number": numero,
      "notice-identifier": `sintetico-${numero}`,
      "notice-version": 1,
      "notice-type": "cn-standard",
      "publication-date": "2026-11-10+01:00",
      "procedure-identifier": proc,
      "buyer-name": { ita: ["COMUNE DI PROVASINTETICA"] },
      "organisation-identifier-buyer": ["00000000001"],
      "buyer-country-sub": ["ITG2B"],
      "title-proc": { ita: "Servizio di ristorazione scolastica (prova sintetica)" },
      "title-lot": { ita: ["Ristorazione (prova sintetica)"] },
      "identifier-lot": ["LOT-0001"],
      "main-classification-proc": ["55524000"],
      "main-classification-lot": ["55524000"],
      "classification-cpv": ["55524000"],
      "estimated-value-proc": "2000000.00",
      "estimated-value-cur-proc": "EUR",
      "estimated-value-lot": ["2000000.00"],
      "estimated-value-cur-lot": ["EUR"],
      "deadline-receipt-tender-date-lot": ["2026-12-20+01:00"],
      "deadline-receipt-tender-time-lot": ["10:00:00+01:00"],
      "procedure-type": "open",
      "contract-nature-main-proc": "services",
      ...p,
    });
    const mem = databaseInMemoria(
      {
        radar_procedure: [gara("A", { chiave: "ted:proc-A" }), gara("P", { chiave: "pvl:av-P", fonti: ["pvl"] }), gara("X", { chiave: "ted:proc-X" })],
        radar_lotti: [lotto("A", { cig: "PRV00000A1" }), lotto("X", { cig: "PRV00000X1" })],
        radar_procedure_fonti: [prov("A", "ted", "700001-2026", { id_procedura_fonte: "proc-A" }), prov("P", "pvl", "av-P"), prov("X", "ted", "700400-2026", { id_procedura_fonte: "proc-X" })],
        radar_aggiornamenti: [],
        omnia_ai_radar_gare_aggiunte: [],
      },
      { fonti: "0121" },
    );
    // la gara PVL e la gara TED X vengono unite ad A (resta A, TED)
    await collegaGare(mem.client, [{ a: "P", b: "A", motivo: "avviso TED citato (prova sintetica)", traccia: "t1", fonte: "pvl", restaPreferita: "A" }, { a: "X", b: "A", motivo: "stesso CIG (prova sintetica)", traccia: "t2", fonte: "sintel" }], ISO, misure());
    uguale("D. (preparazione) P e X unite ad A", [garaDi(mem, "P").unita_a, garaDi(mem, "X").unita_a], ["A", "A"]);
    // rettifica TED del valore (non proroga) sulla procedura della gara assorbita X
    const rett = leggiBandoTed(avviso("700402-2026", "proc-X", { "deadline-receipt-tender-date-lot": ["2026-12-10+01:00"], "deadline-receipt-tender-time-lot": ["10:00:00+01:00"], "estimated-value-proc": "2400000.00", "estimated-value-lot": ["2400000.00"] }));
    atteso("D. (preparazione) avviso di rettifica sintetico valido", !eEsclusione(rett));
    await applicaPaginaBandi(mem.client, [rett], "incrementale", ADESSO, misure());
    const rettifiche = mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "rettifica" && a.campo === "valore_stimato");
    uguale("D. rettifica TED (valore) su una gara assorbita: registrata sulla gara che resta, notificabile; la copia non cambia valore", [garaDi(mem, "A").valore_stimato, rettifiche.map((r) => [r.procedura_id, r.notificabile]), garaDi(mem, "X").valore_stimato], [2400000, [["A", true]], 2000000]);
    uguale("D. fonti sempre uguali alle provenienze dopo la rettifica", fontiObsolete(mem), []);
    // proroga TED sulla procedura della gara che resta: come sempre
    const proroga = leggiBandoTed(avviso("700403-2026", "proc-A", { "deadline-receipt-tender-date-lot": ["2026-12-22+01:00"], "estimated-value-proc": "2400000.00", "estimated-value-lot": ["2400000.00"] }));
    await applicaPaginaBandi(mem.client, [proroga], "incrementale", ADESSO, misure());
    uguale("D. proroga TED sulla gara che resta (con gare unite): registrata lì una volta, notificabile", [garaDi(mem, "A").scadenza_giorno, mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "proroga").map((a) => [a.procedura_id, a.notificabile])], ["2026-12-22", [["A", true]]]);
    // annullamento dell'unione di X: da qui le versioni della procedura di X tornano a X
    await scollegaGara(mem.client, "X", "2026-11-17T13:00:00.000Z");
    const dopoAnnullamento = leggiBandoTed(avviso("700404-2026", "proc-X", { "publication-date": "2026-11-12+01:00", "deadline-receipt-tender-date-lot": ["2026-12-28+01:00"] }));
    await applicaPaginaBandi(mem.client, [dopoAnnullamento], "incrementale", ADESSO, misure());
    const prorogheX = mem.tabelle.radar_aggiornamenti.filter((a) => a.tipo === "proroga" && a.procedura_id === "X");
    uguale("D. dopo l'annullamento dell'unione la proroga della procedura di X va a X (non più ad A), notificabile; A non cambia", [garaDi(mem, "X").unita_a, garaDi(mem, "X").scadenza_giorno, prorogheX.map((a) => a.notificabile), garaDi(mem, "A").scadenza_giorno], [null, "2026-12-28", [true], "2026-12-22"]);
    const esito = leggiEsitoTed(avviso("700405-2026", "proc-X", { "notice-type": "can-standard", "winner-selection-status": ["selec-w"] })) as EsitoTed;
    await applicaPaginaEsiti(mem.client, [esito], "incrementale", ADESSO, misure());
    uguale("D. esito TED della procedura di X dopo l'annullamento: su X; A resta aperta", [garaDi(mem, "X").stato, garaDi(mem, "A").stato], ["aggiudicata", "aperta"]);
    uguale("D. nessun riferimento obsoleto nelle fonti, in nessuna gara", fontiObsolete(mem), []);
    // una gara PVL assorbita da TED: la versione TED della procedura di A resta su A anche se P è collegata
    uguale("D. la gara PVL assorbita non riceve nulla dalle versioni TED", [garaDi(mem, "P").unita_a, mem.tabelle.radar_aggiornamenti.filter((a) => a.procedura_id === "P" && (a.tipo === "proroga" || a.tipo === "rettifica")).length], ["A", 0]);
  }

  console.log("");
  if (fallimenti.length) {
    console.log(`Verifica 0121 (progetto) e prove del punto F: ${fallimenti.length} controlli falliti:`);
    for (const f of fallimenti) console.log(` - ${f}`);
    process.exit(1);
  }
  console.log("Verifica 0121 (progetto, mai applicata) e prove del punto F: tutto a posto.");
}

principale().catch((e) => {
  console.error(e);
  process.exit(1);
});
