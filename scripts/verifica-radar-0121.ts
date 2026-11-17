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
import { SETTORI_RADAR } from "../src/lib/radar/settori";
import { classificaPerArchivio, type ClassificazioneArchivio, type ValutazioneSettore } from "../src/lib/radar/classificazione-unita";
import { aggiornamentoClassificazioni, decisioneAmministratore, gareSuggeribili, righeDaClassificazione, righeDaRipristinare, stessaClassificazione, type RigaClassificazione } from "../src/lib/radar/classificazioni-calcoli";
import { scriviClassificazioni } from "../src/lib/radar/classificazioni";
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
    atteso("A. una sola tabella nuova, radar_classificazioni, idempotente", (codice.match(/create table/gi) ?? []).length === 1 && /create table if not exists public\.radar_classificazioni/.test(codice));
    atteso("A. RLS attiva", /alter table public\.radar_classificazioni enable row level security/.test(codice));
    atteso("A. permessi: tolti a tutti, poi solo service_role (lettura e inserimento; aggiornamento solo dello stato); niente ad anon e authenticated, nessuna cancellazione", /revoke all on public\.radar_classificazioni from public, anon, authenticated, service_role;/.test(codice) && /grant select, insert on public\.radar_classificazioni to service_role;/.test(codice) && /grant update \(attiva, sostituita_il, sostituita_da\) on public\.radar_classificazioni to service_role;/.test(codice) && !/grant[^;]*to[^;]*\b(anon|authenticated)\b/i.test(codice) && !/grant[^;]*delete[^;]*radar_classificazioni/i.test(codice));
    atteso("A. una sola chiave esterna (la gara, con cancellazione a catena); nessuna sulle colonne di traccia", (codice.match(/references/gi) ?? []).length === 1 && /procedura_id uuid not null references public\.radar_procedure \(id\) on delete cascade/.test(codice) && !/sostituita_da uuid[^,\n]*references/.test(codice) && !/autore text[^,\n]*references/.test(codice));
    atteso("A. una sola classificazione attiva per gara e settore (indice unico parziale) e indice per settore e livello", /create unique index if not exists radar_classificazioni_attiva_uidx on public\.radar_classificazioni \(procedura_id, settore\) where attiva/.test(codice) && /radar_classificazioni_settore_livello_idx on public\.radar_classificazioni \(settore, livello\) where attiva/.test(codice));
    const settori = (codice.match(/settore text not null check \(settore in \(([^)]*)\)\)/)?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, ""));
    uguale("A. i settori ammessi sono esattamente quelli di settori.ts", settori, SETTORI_RADAR.map((s) => s.id));
    atteso("A. livelli A, B, C; sottocategorie multiple con solo la forma controllata; C senza sottocategorie; amministratore sempre con nota; stato coerente", /livello in \('A', 'B', 'C'\)/.test(codice) && /sottocategorie text\[\] not null default '\{\}'/.test(codice) && /livello <> 'C' or cardinality\(sottocategorie\) = 0/.test(codice) && /origine <> 'amministratore' or nota is not null/.test(codice) && /\(attiva and sostituita_il is null and sostituita_da is null\) or \(not attiva and sostituita_il is not null\)/.test(codice));
    atteso("A. «settori», «metodo_settore» e le colonne della gara non cambiano: nessun alter di radar_procedure, nessun aggiornamento dei settori", !/alter table public\.radar_procedure\b/i.test(codice) && !/set\s+settori/i.test(codice) && !/metodo_settore/i.test(codice));
    const aggiornamenti = codice.match(/^update public\.radar_procedure[^;]*;/gim) ?? [];
    const tutti = codice.match(/update public\.radar_procedure[^;]*;/gi) ?? [];
    atteso(
      "A. le sole scritture sulle gare (2 nel riallineamento, 2 nella funzione) sono sulla colonna «fonti»; il riallineamento solo dove è diversa dalle provenienze",
      aggiornamenti.length === 2 && tutti.length === 4 && tutti.every((u) => /set fonti = /.test(u) && !/set fonti = [^;]*,\s*\w+\s*=/.test(u)) && /not \(p\.fonti @> r\.fonti and p\.fonti <@ r\.fonti\)/.test(aggiornamenti[0]) && /not exists \(select 1 from public\.radar_procedure_fonti/.test(aggiornamenti[1]),
    );
    atteso("A. funzione delle fonti: security invoker, search_path fisso, EXECUTE solo a service_role", /function public\.radar_allinea_fonti_della_gara\(\) returns trigger\s+language plpgsql\s+security invoker\s+set search_path = public/.test(codice) && /revoke all on function public\.radar_allinea_fonti_della_gara\(\) from public, anon, authenticated;/.test(codice) && /grant execute on function public\.radar_allinea_fonti_della_gara\(\) to service_role;/.test(codice));
    atteso("A. funzione: destinazione (aggiunge se manca) E origine (su cambio di gara o di fonte, e su cancellazione, ricalcolo dalle provenienze, scritto solo se cambia)", /tg_op in \('INSERT', 'UPDATE'\)/.test(codice) && /tg_op = 'DELETE' or \(tg_op = 'UPDATE' and \(old\.procedura_id is distinct from new\.procedura_id or old\.fonte is distinct from new\.fonte\)\)/.test(codice) && /where f\.procedura_id = old\.procedura_id/.test(codice));
    atteso("A. trigger nuovo anche sulla cancellazione, al posto di quello della 0120, nella stessa transazione", /after insert or update of procedura_id, fonte or delete on public\.radar_procedure_fonti/.test(codice) && /drop trigger radar_procedure_fonti_aggiunge_fonte on public\.radar_procedure_fonti/.test(codice));
    atteso("A. nessuna cancellazione di dati: si tolgono solo il trigger e la funzione della 0120 (codice)", (codice.match(/\bdrop\b/gi) ?? []).length === 2 && !/drop (table|column|index|schema)/i.test(codice) && !/\bdelete from\b|\btruncate\b/i.test(codice));
    const migrazioni = fs.readdirSync(path.join(RADICE, "supabase/migrations")).filter((f) => /^01[2-9]\d_/.test(f));
    uguale("A. dopo la 0120 c'è solo la 0121 (0118 e 0119 riservate alla PVL, non nel ramo)", migrazioni, ["0120_radar_multifonte.sql", "0121_radar_classificazioni.sql"]);
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
    uguale("C. concessione del bar: una riga, ristorazione A, sottocategoria concessione_bar, regola, versione, non ambigua", rBar.map((r) => [r.settore, r.livello, r.sottocategorie, r.regole[0], r.versione_regole, r.ambigua]), [["ristorazione", "A", ["concessione_bar"], "cpv_principale", BAR.versione, false]]);
    const rCas = righeDaClassificazione(CASONE, ctx({ settoriColonna: ["ristorazione"] }));
    uguale("C. casone: ristorazione C senza sottocategorie, con la regola; la colonna lo ha ancora → ambigua (da decidere, non cambiata)", rCas.map((r) => [r.livello, r.sottocategorie, r.regole, r.ambigua]), [["C", [], ["concessione_di_immobili"], true]]);
    atteso("C. i motivi si salvano (spiegano la riga anche se le regole cambieranno)", rBar[0].motivi.length > 0 && rCas[0].motivi.length > 0);
    // multisettore e multisottocategoria: la forma dell'interfaccia della PVL (sottocategorie[], regole[], cpv[])
    const v = (p: Partial<ValutazioneSettore>): ValutazioneSettore => ({ livello: "A", sottocategoria: null, regola: "cpv_principale", sottocategorie: [], regole: ["cpv_principale"], motivi: ["motivo sintetico"], da: "cpv", cpv: [], ...p });
    const MULTI: ClassificazioneArchivio = {
      settori: ["ristorazione", "pulizia"],
      metodo: "cpv",
      livello: "A",
      versione: "2026-11-17c",
      perSettore: {
        ristorazione: v({ sottocategorie: ["concessione_bar", "concessione_ristorante"], sottocategoria: "concessione_bar", cpv: ["55300000", "55410000"] }),
        pulizia: v({ livello: "B", sottocategorie: ["pulizia_edifici"], sottocategoria: "pulizia_edifici", regole: ["gestione_integrata", "cpv_secondario"], regola: "gestione_integrata", cpv: ["90910000"] }),
        vigilanza_portierato: v({ livello: "C", sottocategorie: [], regole: ["videosorveglianza_senza_vigilanza"], regola: "videosorveglianza_senza_vigilanza", da: "cpv", cpv: ["79711000"] }),
      },
    };
    const rMulti = righeDaClassificazione(MULTI, ctx({ settoriColonna: ["ristorazione", "pulizia"] }));
    uguale(
      "C. multisettore: una riga per settore, livello per settore (A, B, C), più sottocategorie nello stesso settore in ordine, regole e CPV",
      rMulti.map((r) => [r.settore, r.livello, r.sottocategorie, r.regole, r.cpv, r.versione_regole]),
      [
        ["pulizia", "B", ["pulizia_edifici"], ["gestione_integrata", "cpv_secondario"], ["90910000"], "2026-11-17c"],
        ["ristorazione", "A", ["concessione_bar", "concessione_ristorante"], ["cpv_principale"], ["55300000", "55410000"], "2026-11-17c"],
        ["vigilanza_portierato", "C", [], ["videosorveglianza_senza_vigilanza"], ["79711000"], "2026-11-17c"],
      ],
    );
    // gara di più fonti: il livello migliore tra dati uniti e fonti, ambigua se non sono d'accordo
    const r2 = righeDaClassificazione(RSA, ctx({ fonti: ["pvl", "ted"], perFonte: [BAR], settoriColonna: ["ristorazione"] }));
    uguale("C. più fonti: livello migliore (A dalla fonte, B dai dati uniti), sottocategoria della fonte che lo dà, riga ambigua", r2.map((r) => [r.livello, r.sottocategorie, r.fonti, r.ambigua]), [["A", ["concessione_bar"], ["pvl", "ted"], true]]);
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
      [agg.inserisci.map((r) => [r.settore, r.livello]), agg.disattiva.map((d) => [d.id === pul.id ? "pulizia" : d.id === vig.id ? "vigilanza" : "?", d.sostituita_da === agg.inserisci[0]?.id ? "nuova" : d.sostituita_da]), agg.invariate],
      [[["pulizia", "A"]], [["pulizia", "nuova"], ["vigilanza", null]], 1],
    );
    const decisa = decisioneAmministratore(attive.find((r) => r.settore === "ristorazione") ?? null, { proceduraId: "G", settore: "ristorazione", livello: "B", sottocategorie: ["concessione_bar"], nota: "Bar dentro la gestione dell'intero parco: correlata (prova sintetica).", autore: "console:admin-sintetico", versione: MULTI.versione, adessoIso: ISO, nuovoId });
    const conDecisione = [...attive.filter((r) => r.settore !== "ristorazione"), ...decisa.inserisci];
    const dopo = aggiornamentoClassificazioni(conDecisione, rMulti, ISO);
    uguale("C. la decisione dell'amministratore non viene sostituita dal calcolo automatico: resta, e il calcolo diverso è solo segnalato", [dopo.inserisci.filter((r) => r.settore === "ristorazione").length, dopo.protette.map((p) => [p.settore, p.decisione.livello, p.calcolata.livello])], [0, [["ristorazione", "B", "A"]]]);
    let senzaNota = false;
    try {
      decisioneAmministratore(null, { proceduraId: "G", settore: "ristorazione", livello: "B", sottocategorie: [], nota: "  ", autore: "console:x", versione: "v", adessoIso: ISO, nuovoId });
    } catch {
      senzaNota = true;
    }
    atteso("C. una decisione dell'amministratore senza nota è rifiutata (come il vincolo della 0121)", senzaNota);
    const storico: RigaClassificazione[] = [...rMulti.map((r) => ({ ...r, attiva: false, sostituita_il: ISO })), ...agg.inserisci];
    const rip = righeDaRipristinare(storico, "2026-11-17c", { autore: "riclassificazione:prova", adessoIso: "2026-11-18T08:00:00.000Z", nuovoId });
    uguale("C. ripristino di una versione: le righe tornano come righe NUOVE (lo storico resta intero), con una nota", [rip.length, rip.every((r) => r.origine === "riclassificazione" && !!r.nota && r.attiva && !storico.some((s) => s.id === r.id))], [3, true]);
    atteso("C. due righe uguali per contenuto sono «la stessa classificazione» anche con origine e motivi diversi", stessaClassificazione(rBar[0], { ...rBar[0], origine: "riclassificazione", motivi: ["altro testo"], fonti: ["pvl"] }));
  }
  {
    // scrittura sul database (in memoria): prima volta inserisce; uguale non scrive; cambiata disattiva e inserisce; settori mai toccati
    const mem = databaseInMemoria({ radar_procedure: [gara("G", { settori: ["ristorazione"] })], radar_classificazioni: [] }, { fonti: "0121" });
    const colonna = JSON.stringify(garaDi(mem, "G"));
    const calcola = (c: ClassificazioneArchivio) => righeDaClassificazione(c, { proceduraId: "G", origine: "riclassificazione", fonti: ["ted"], autore: "riclassificazione:prova", adessoIso: ISO, nuovoId, settoriColonna: ["ristorazione"] });
    const RSA = classificaPerArchivio({ oggetto: "Gestione dei servizi socio-assistenziali e di ristorazione della residenza per anziani (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    const MENSA = classificaPerArchivio({ oggetto: "Servizio di ristorazione scolastica (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    const e1 = await scriviClassificazioni(mem.client, [{ proceduraId: "G", calcolate: calcola(MENSA) }], misure(), ISO);
    const e2 = await scriviClassificazioni(mem.client, [{ proceduraId: "G", calcolate: calcola(MENSA) }], misure(), ISO);
    const e3 = await scriviClassificazioni(mem.client, [{ proceduraId: "G", calcolate: calcola(RSA) }], misure(), "2026-11-18T08:00:00.000Z");
    const righe = mem.tabelle.radar_classificazioni;
    uguale("C. scrittura: 1 riga la prima volta, nessuna la seconda, poi 1 disattivata e 1 nuova", [e1.inserite, e2.inserite + e2.disattivate, e3.disattivate, e3.inserite], [1, 0, 1, 1]);
    uguale("C. storico: una sola riga attiva per gara e settore; la vecchia punta alla nuova", [righe.filter((r) => r.attiva).length, righe.find((r) => !r.attiva)?.sostituita_da === righe.find((r) => r.attiva)?.id], [1, true]);
    uguale("C. la colonna «settori» e tutta la riga della gara non cambiano", JSON.stringify(garaDi(mem, "G")) === colonna, true);
    const finto = { from: () => ({ select: () => ({ in: () => ({ eq: () => ({ returns: () => Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table" } }) }) }) }) }) } as unknown as Parameters<typeof scriviClassificazioni>[0];
    uguale("C. senza la 0121 (tabella assente) la scrittura non fa nulla e non dà errore", (await scriviClassificazioni(finto, [{ proceduraId: "G", calcolate: calcola(MENSA) }], misure(), ISO)).saltata, true);
    atteso("C. nessun importatore scrive ancora le classificazioni (0121 non approvata)", ["src/lib/radar/importa.ts", "src/lib/radar/importa-fonti-pagina.ts", "src/lib/radar/importa-pvl-pagina.ts", "src/lib/radar/importa-regionali.ts"].every((f) => !leggi(f).includes("scriviClassificazioni")));
  }
  {
    // E. le gare non pertinenti non finiscono MAI nei suggerimenti alle imprese
    const r = (procedura_id: string, settore: string, livello: "A" | "B" | "C", attiva = true) => ({ procedura_id, settore: settore as RigaClassificazione["settore"], livello, attiva });
    const righe = [r("P1", "ristorazione", "A"), r("P2", "ristorazione", "B"), r("P3", "ristorazione", "C"), r("P4", "pulizia", "A"), r("P5", "ristorazione", "A", false), r("P6", "ristorazione", "C"), r("P6", "pulizia", "A")];
    uguale("E. suggerimenti: solo righe ATTIVE di livello A nei settori dell'impresa (mai B, mai C, mai righe storiche)", gareSuggeribili(righe, ["ristorazione"]), ["P1"]);
    uguale("E. una gara C in un settore e A in un altro si suggerisce solo per il settore in cui è A", [gareSuggeribili(righe, ["pulizia"]), gareSuggeribili(righe, ["ristorazione"]).includes("P6")], [["P4", "P6"], false]);
    const CASONE = classificaPerArchivio({ oggetto: "Affidamento in concessione del casone “Paduli” per la durata di sette anni (prova sintetica)", cpv_principale: "55524000", cpv_tutti: ["55524000"], natura_contratto: "servizi" }, []);
    uguale("E. una gara non pertinente ha «settori» vuoto: ogni filtro per settore già esistente (Cerca, Monitorate) la esclude", CASONE.settori, []);
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
