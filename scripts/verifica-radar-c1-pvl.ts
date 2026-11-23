// Verifica di C1 (decisione dell'utente del 23/11, «Sì, ammetterle»; analisi 49 §3.4 e §5): la PVL ammette le indagini di mercato sotto
// soglia (P7_1_3) come INDAGINE DI MERCATO (candidatura, mai gara aperta) e gli avvisi di costituzione di elenchi (P7_3) come ISCRIZIONE;
// P7_1_1, P7_1_2, P7_2 e P8 restano esclusi. Le notifiche mostrano il tipo come le liste (tipoDellaGara). Nessuna rete, nessun database:
// l'avviso P7_1_3 è quello reale del campione (scripts/dati/radar-pvl-campione.json, solo campi pubblici); P7_3 è lo stesso avviso con la
// scheda cambiata (DATI SINTETICI: nessun avviso P7_3 reale ancora visto). Uso: npx tsx scripts/verifica-radar-c1-pvl.ts
import fs from "fs";
import path from "path";
import { leggiAvvisoPvl, SCHEDE_BANDO_PVL, SCHEDE_CANDIDATURA_ISCRIZIONE_PVL, type BandoPvl } from "../src/lib/radar/fonti/pvl-calcoli";
import { opportunitaDaTipoAvviso } from "../src/lib/radar/opportunita-calcoli";
import { rigaDaBandoPvl } from "../src/lib/radar/importa-pvl-calcoli";
import { garaEmailDaArchivio, COLONNE_GARA, type RigaGara } from "../src/lib/radar/notifiche/eventi-calcoli";

const falliti: string[] = [];
let ok = 0;
const atteso = (nome: string, cond: boolean, dettaglio?: unknown) => {
  if (cond) ok++;
  else {
    falliti.push(nome);
    console.log(`FALLITO ${nome}${dettaglio === undefined ? "" : ` → ${JSON.stringify(dettaglio).slice(0, 400)}`}`);
  }
};
const uguale = (nome: string, reale: unknown, previsto: unknown) => atteso(nome, JSON.stringify(reale) === JSON.stringify(previsto), { previsto, reale });

const RADICE = path.resolve(__dirname, "..");
const campione = JSON.parse(fs.readFileSync(path.join(RADICE, "scripts/dati/radar-pvl-campione.json"), "utf8")) as { avvisi: Record<string, unknown>[] };
const indagineReale = campione.avvisi.find((a) => a.codiceScheda === "P7_1_3") as Record<string, unknown>;
const lotto0 = (a: Record<string, unknown>) => ((((a.templates as Record<string, unknown>[])[0].template as Record<string, unknown>).sections as Record<string, unknown>[]).find((s) => /^SEZ\.\s*C/.test(String(s.name)))!.items as Record<string, unknown>[])[0];
const conScheda = (scheda: string, cambia?: (a: Record<string, unknown>) => void) => {
  const a = structuredClone(indagineReale);
  a.codiceScheda = scheda;
  cambia?.(a);
  return a;
};
const ADESSO = new Date("2026-11-17T08:00:00Z");

// ───── 1. regole delle schede ─────
uguale("schede ammesse da C1: solo P7_1_3 e P7_3", ["P7_1_3", "P7_3", "P7_1_1", "P7_1_2", "P7_2", "P8", "P7_31", "XP7_3", "P7_1_30"].map((s) => SCHEDE_CANDIDATURA_ISCRIZIONE_PVL.test(s)), [true, true, false, false, false, false, false, false, false]);
atteso("le schede di bando non cambiano (P7 non è un bando)", !SCHEDE_BANDO_PVL.test("P7_1_3") && !SCHEDE_BANDO_PVL.test("P7_3") && SCHEDE_BANDO_PVL.test("P1_16") && SCHEDE_BANDO_PVL.test("P2_19"));
uguale("tipo dell'opportunità: P7_1_3 indagine di mercato (libera, candidatura); P7_3 iscrizione; le altre P7 e P8 senza tipo; i bandi come prima",
  ["P7_1_3", "P7_3", "P7_1_1", "P7_1_2", "P7_2", "P8", "P1_16", "qu-sy", "P7_1_3x"].map((t) => opportunitaDaTipoAvviso(t)),
  [{ tipo: "indagine_mercato", partecipazione: "libera" }, { tipo: "sistema_qualificazione", partecipazione: "iscrizione" }, null, null, null, null, { tipo: "bando", partecipazione: "libera" }, { tipo: "sistema_qualificazione", partecipazione: "iscrizione" }, null]);

// ───── 2. l'indagine reale del campione (Accademia Navale, pulizie, 16/11) ─────
const letta = leggiAvvisoPvl(indagineReale);
atteso("P7_1_3 reale: ammessa (non più «indagine_o_negoziata»)", letta.tipo === "bando", letta);
const b = letta as BandoPvl;
uguale("P7_1_3: il tipo dell'avviso resta la scheda (da lì il tipo dell'opportunità)", b.record.tipoAvviso, "P7_1_3");
uguale("P7_1_3: scadenza = termine delle candidature («termine_invito», con l'ora), giorno di Roma", [b.record.scadenzaGiorno, b.record.scadenzaOfferte, b.record.scadenzaOraIndicata, b.scadenzaFonte], ["2026-12-04", "2026-12-04T10:00:00.000Z", true, "2026-12-04T10:00:00Z"]);
uguale("P7_1_3: oggetto dalla descrizione (manca il titolo), CIG, valore, settore", [b.record.oggetto.startsWith("Servizio di pulizia scale e delle aree comuni"), b.record.lotti.map((l) => l.cig), b.record.valoreStimato, b.settori], [true, ["BDCE3FF399"], 10000, ["pulizia"]]);
uguale("P7_1_3: collegamenti all'avviso ufficiale e ai documenti", [(b.record.urlAvviso ?? "").startsWith("https://pubblicitalegale.anticorruzione.it/bandi/"), !!b.record.urlDocumenti], [true, true]);
const riga = rigaDaBandoPvl(b, ADESSO);
uguale("archivio: P7_1_3 entra come «indagine_mercato», partecipazione «libera» (colonne della 0120, nessuna migrazione)", [riga.tipo_opportunita, riga.partecipazione], ["indagine_mercato", "libera"]);

// ───── 3. le altre schede P7 e P8 restano escluse ─────
for (const s of ["P7_1_1", "P7_1_2", "P7_2", "P8"]) {
  const x = leggiAvvisoPvl(conScheda(s));
  uguale(`${s}: resta esclusa come «indagine_o_negoziata» (riservata agli invitati)`, x.tipo === "esclusione" ? x.motivo : x.tipo, "indagine_o_negoziata");
}

// ───── 4. P7_3 (DATI SINTETICI: lo stesso avviso con la scheda P7_3) ─────
const elenco = leggiAvvisoPvl(conScheda("P7_3"));
atteso("P7_3: ammessa", elenco.tipo === "bando", elenco);
const rElenco = rigaDaBandoPvl(elenco as BandoPvl, ADESSO);
uguale("P7_3: entra come «sistema_qualificazione», partecipazione «iscrizione»", [rElenco.tipo_opportunita, rElenco.partecipazione], ["sistema_qualificazione", "iscrizione"]);
const senzaTermine = leggiAvvisoPvl(conScheda("P7_3", (a) => { delete lotto0(a).termine_invito; })) as BandoPvl;
uguale("senza «termine_invito»: la regola di sempre su «dataScadenza» (mai un'ora presunta)", [senzaTermine.record.scadenzaGiorno, senzaTermine.record.scadenzaOfferte, senzaTermine.record.scadenzaOraIndicata], ["2026-12-04", "2026-12-04T10:00:00.000Z", true]);
const senzaNiente = leggiAvvisoPvl(conScheda("P7_3", (a) => { delete lotto0(a).termine_invito; a.dataScadenza = null; })) as BandoPvl;
uguale("senza termine e senza dataScadenza: nessuna scadenza inventata, «scadenza» tra i dati mancanti", [senzaNiente.record.scadenzaGiorno, senzaNiente.record.scadenzaOfferte, senzaNiente.mancanti.includes("scadenza")], [null, null, true]);
const conRicezione = leggiAvvisoPvl(conScheda("P7_1_3", (a) => { lotto0(a).termine_ricezione = "2026-12-05T12:00:00+01:00"; })) as BandoPvl;
uguale("se ci fossero tutti e due, vale il termine di ricezione (come per i bandi)", conRicezione.record.scadenzaOfferte, "2026-12-05T11:00:00.000Z");
const fuoriSettore = leggiAvvisoPvl(conScheda("P7_1_3", (a) => {
  const l = lotto0(a);
  l.cpv = "Servizi di consulenza informatica";
  l.descrizione = "Indagine di mercato per software gestionale";
  (((a.templates as Record<string, unknown>[])[0].template as Record<string, unknown>).metadata as Record<string, unknown>).descrizione = "Indagine di mercato per software gestionale";
}));
uguale("un'indagine fuori dai settori resta fuori (il classificatore decide come per i bandi)", fuoriSettore.tipo === "esclusione" ? fuoriSettore.motivo : fuoriSettore.tipo, "fuori_settore");

// ───── 5. notifiche: il tipo come nelle liste (tipoDellaGara) ─────
atteso("notifiche: il motore legge anche «tipo_avviso» (per il tipo quando la colonna è vuota)", /\btipo_avviso\b/.test(COLONNE_GARA));
const gara = (tipo_opportunita: string | null, tipo_avviso: string | null): RigaGara => ({
  id: "g1", chiave: "pvl:x", oggetto: "Servizio di pulizia (DATI SINTETICI)", sa_denominazione: null, luogo_regioni: [], tipo_opportunita, tipo_avviso, tipo_procedura: null,
  valore_stimato: null, data_pubblicazione: "2026-11-16", scadenza_giorno: "2026-12-04", scadenza_offerte: "2026-12-04T10:00:00.000Z", scadenza_ora_indicata: true, stato: "aperta",
  unita_a: null, url_avviso: null, url_documenti: null, prima_rilevazione_il: "2026-11-16T08:00:00Z", ultima_rilevazione_il: "2026-11-16T08:00:00Z", fonti: ["pvl"],
} as RigaGara);
const tipoEmail = (t: string | null, a: string | null) => garaEmailDaArchivio(gara(t, a), [], new Set(), "https://esempio.invalid").tipoAvviso;
uguale("notifiche: indagine (colonna o solo scheda P7_1_3) → «Indagine di mercato», mai «Bando di gara»", [tipoEmail("indagine_mercato", "P7_1_3"), tipoEmail(null, "P7_1_3")], ["Indagine di mercato", "Indagine di mercato"]);
uguale("notifiche: elenco P7_3 → «Iscrizione a elenco o sistema di qualificazione»", [tipoEmail("sistema_qualificazione", "P7_3"), tipoEmail(null, "P7_3")], ["Iscrizione a elenco o sistema di qualificazione", "Iscrizione a elenco o sistema di qualificazione"]);
uguale("notifiche: bando «Bando di gara»; preinformazione con indizione «Avviso di preinformazione» (C11); scheda sconosciuta senza tipo",
  [tipoEmail("bando", "P1_16"), tipoEmail(null, "cn-standard"), tipoEmail("bando", "pin-cfc-standard"), tipoEmail(null, "P2_12"), tipoEmail(null, "P7_1_1"), tipoEmail("valore_strano", "P1_16")],
  ["Bando di gara", "Bando di gara", "Avviso di preinformazione", "Avviso di preinformazione", null, null]);

console.log(falliti.length ? `Verifica C1 PVL (indagini e iscrizioni): ${ok} ok, ${falliti.length} falliti` : `Verifica C1 PVL (indagini e iscrizioni): ${ok} ok, 0 falliti`);
process.exit(falliti.length ? 1 : 0);
