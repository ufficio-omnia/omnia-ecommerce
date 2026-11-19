// Verifica della parte PVL della fase B4 di Tender Intelligence: catalogo stabile delle sottocategorie (settori-catalogo.ts) e rilevamento
// delle modifiche tra versioni PVL della stessa procedura (modifiche-pvl.ts). Gratuita, senza rete né database: gira nel livello 1.
//
// Dati: gli avvisi REALI del campione PVL (scripts/dati/radar-pvl-campione.json, soli campi pubblici). L'avviso di rettifica reale
// (idAvviso f906425a…, «tipo» = "rettifica", scadenza 14/12/2026) ha nello staging la versione precedente del 02/11 con la scadenza al
// 30/11/2026 (registrata da TED per la stessa gara, avviso 781699-2026). Le versioni precedenti usate qui sono RICOSTRUZIONI SINTETICHE,
// dichiarate tali: copie dell'avviso reale con identificativo finto e i soli campi cambiati che ogni prova dichiara.
import fs from "fs";
import path from "path";
import { leggiAvvisoPvl, type BandoPvl } from "../src/lib/radar/fonti/pvl-calcoli";
import { classificaGara, SETTORI_RADAR, SOTTOCATEGORIE } from "../src/lib/radar/settori";
import {
  ALIAS_SOTTOCATEGORIE,
  CATALOGO,
  ID_STABILI,
  MASSIMO_PER_SETTORE,
  SOTTOCATEGORIE_RITIRATE,
  normalizzaSottocategorieProfilo,
  problemiDelCatalogo,
  risolviSottocategoria,
  vociCatalogo,
  type CatalogoSottocategorie,
} from "../src/lib/radar/settori-catalogo";
import { collegamentoNormalizzato, fotoDaBandoPvl, fotoPvlValida, rilevaModifichePvl, valoreScadenzaFoto, type FotoVersionePvl, type ModificaPvl } from "../src/lib/radar/modifiche-pvl";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}

const RADICE = path.join(__dirname, "..");
const campione = JSON.parse(fs.readFileSync(path.join(RADICE, "scripts/dati/radar-pvl-campione.json"), "utf8")) as { avvisi: Record<string, unknown>[] };

// ───── 1. catalogo stabile delle sottocategorie ─────

uguale("catalogo: 6 settori e 22 sottocategorie", [Object.keys(ID_STABILI).length, Object.values(ID_STABILI).flat().length], [6, 22]);
uguale("catalogo coerente con le regole (stessi identificativi, stesso ordine, alias e ritirate validi)", problemiDelCatalogo(), []);
uguale(
  "identificativi stabili = quelli delle regole, settore per settore e nello stesso ordine",
  SETTORI_RADAR.map((s) => [s.id, ID_STABILI[s.id]]),
  SETTORI_RADAR.map((s) => [s.id, SOTTOCATEGORIE[s.id].map((x) => x.id)]),
);
uguale("nessun alias e nessuna ritirata al 19/11 (mai un rinomina)", [Object.values(ALIAS_SOTTOCATEGORIE).every((a) => Object.keys(a).length === 0), Object.values(SOTTOCATEGORIE_RITIRATE).every((r) => r.length === 0)], [true, true]);
const voci = vociCatalogo();
uguale("voci: nome leggibile dalle regole", voci.find((v) => v.id === "servizi_sostitutivi_mensa")?.nome, "Servizi sostitutivi di mensa e buoni pasto");
uguale("voci: la prima di ogni settore è la predefinita", voci.filter((v) => v.predefinita).map((v) => v.id), ["pulizia_edifici", "mense", "vigilanza_privata", "traslochi", "facility_management", "ausiliariato"]);
atteso("voci: la nota per «appalti_multiservizi» (assegnata solo dalle regole)", !!voci.find((v) => v.id === "appalti_multiservizi")?.nota && voci.filter((v) => v.nota).length === 1);
uguale("voci di un solo settore", vociCatalogo("multiservizi").map((v) => v.id), ["facility_management", "gestione_impianti"]);

uguale("risolvi: identificativo vivo", risolviSottocategoria("pulizia", "sanificazione"), { id: "sanificazione", daAlias: false });
uguale("risolvi: identificativo di un altro settore = fuori catalogo", risolviSottocategoria("pulizia", "mense"), null);
uguale("risolvi: sconosciuto, vuoto, non testo", [risolviSottocategoria("pulizia", "lavanderia"), risolviSottocategoria("pulizia", ""), risolviSottocategoria("pulizia", 3)], [null, null, null]);
uguale("risolvi: spazi tolti", risolviSottocategoria("ristorazione", " mense "), { id: "mense", daAlias: false });

// un catalogo di prova con un rinomina, un'unione e una ritirata (dati sintetici del test)
const prova: CatalogoSottocategorie = {
  idStabili: { ...ID_STABILI, ristorazione: [...ID_STABILI.ristorazione, "mense_collettive"], pulizia: [...ID_STABILI.pulizia, "vecchia_voce"] },
  alias: { ...ALIAS_SOTTOCATEGORIE, ristorazione: { mensa: "mense_collettive", refezione: "mensa" }, pulizia: { igiene: "sanificazione", giro_a: "giro_b", giro_b: "giro_a" } },
  ritirate: { ...SOTTOCATEGORIE_RITIRATE, pulizia: ["vecchia_voce"] },
};
uguale("alias: rinomina tradotto, anche a catena", [risolviSottocategoria("ristorazione", "mensa", prova), risolviSottocategoria("ristorazione", "refezione", prova)], [{ id: "mense_collettive", daAlias: true }, { id: "mense_collettive", daAlias: true }]);
uguale("alias: un ciclo non porta da nessuna parte", risolviSottocategoria("pulizia", "giro_a", prova), null);
uguale("ritirata: non si risolve", risolviSottocategoria("pulizia", "vecchia_voce", prova), null);
const conProblemi = problemiDelCatalogo({ ...SOTTOCATEGORIE, pulizia: [{ id: "pulizia_edifici" }, { id: "sanificazione_ambienti" }, { id: "disinfestazione" }] }, CATALOGO);
atteso("rinomina SENZA alias: il controllo lo segnala (nuovo id non stabile, vecchio id sparito)", conProblemi.some((p) => /sanificazione_ambienti/.test(p)) && conProblemi.some((p) => /«sanificazione» è stabile/.test(p)), JSON.stringify(conProblemi));
atteso("ordine cambiato: il controllo lo segnala", problemiDelCatalogo({ ...SOTTOCATEGORIE, facchinaggio: [...SOTTOCATEGORIE.facchinaggio].reverse() }).some((p) => /ordine/.test(p)));
atteso("alias in ciclo o verso il nulla: il controllo lo segnala", problemiDelCatalogo({ ...SOTTOCATEGORIE, ristorazione: [...SOTTOCATEGORIE.ristorazione, { id: "mense_collettive" }], pulizia: [...SOTTOCATEGORIE.pulizia, { id: "vecchia_voce" }] }, prova).some((p) => /giro_a/.test(p)));
atteso("alias uguale a un identificativo vivo: il controllo lo segnala", problemiDelCatalogo(SOTTOCATEGORIE, { ...CATALOGO, alias: { ...ALIAS_SOTTOCATEGORIE, pulizia: { sanificazione: "pulizia_edifici" } } }).some((p) => /anche un identificativo stabile/.test(p)));

const n = normalizzaSottocategorieProfilo(
  { pulizia: ["disinfestazione", "pulizia_edifici", "disinfestazione", "lavanderia", 7], ristorazione: ["mense"], vigilanza_portierato: "vigilanza_privata", energia: ["x"] },
  ["pulizia", "vigilanza_portierato"],
);
uguale("profilo: ordine stabile, senza doppioni; un valore singolo vale come elenco", n.sottocategorie, { pulizia: ["pulizia_edifici", "disinfestazione"], vigilanza_portierato: ["vigilanza_privata"] });
uguale(
  "profilo: niente sparisce in silenzio (fuori catalogo, non testo, settore non scelto, settore sconosciuto)",
  n.scartate.map((s) => `${s.settore}/${s.id}/${s.motivo}`),
  ["pulizia/lavanderia/non_nel_catalogo", "pulizia/7/non_testo", "ristorazione/mense/settore_non_scelto", "energia/x/settore_sconosciuto"],
);
const nAlias = normalizzaSottocategorieProfilo({ ristorazione: ["mensa", "mense"], pulizia: ["vecchia_voce", "igiene"] }, ["ristorazione", "pulizia"], prova);
uguale("profilo: alias tradotti e dichiarati, ritirata scartata con il suo motivo", [nAlias.sottocategorie, nAlias.tradotte.map((t) => `${t.da}→${t.a}`), nAlias.scartate.map((s) => s.motivo)], [{ ristorazione: ["mense", "mense_collettive"], pulizia: ["sanificazione"] }, ["mensa→mense_collettive", "igiene→sanificazione"], ["ritirata"]]);
uguale("profilo: forma non valida = vuoto", [normalizzaSottocategorieProfilo(null, ["pulizia"]).sottocategorie, normalizzaSottocategorieProfilo(["pulizia"], ["pulizia"]).sottocategorie], [{}, {}]);
uguale("profilo: limite per settore uguale a quello della 0122", MASSIMO_PER_SETTORE, 30);

// le sottocategorie assegnate dalla classificazione sono sempre identificativi del catalogo (anche quelle che assegnano le regole)
const testiProva = [
  "Servizio sostitutivo di mensa mediante buoni pasto elettronici",
  "Affidamento in global service dei servizi di pulizia, portierato e ristorazione della residenza per anziani",
  "Concessione del servizio bar e punto ristoro presso l'ospedale",
  "Servizio di vigilanza armata e videosorveglianza con centrale operativa",
  "Servizio di trasloco e facchinaggio degli uffici comunali",
  "Servizi di ausiliariato presso le scuole",
  "Servizio di disinfestazione e derattizzazione",
  "Concessione di distributori automatici di alimenti e bevande",
];
const assegnate = testiProva.flatMap((t) => classificaGara({ testo: t }).valutazioni.flatMap((v) => v.sottocategorie.map((s) => [v.settore, s] as const)));
atteso(
  "classificazione: ogni sottocategoria assegnata è nel catalogo del suo settore",
  assegnate.length >= 8 && assegnate.every(([s, id]) => ID_STABILI[s].includes(id)),
  JSON.stringify(assegnate.filter(([s, id]) => !ID_STABILI[s].includes(id))),
);
atteso("classificazione: compaiono anche le sottocategorie assegnate dalle regole", assegnate.some(([, id]) => id === "servizi_sostitutivi_mensa"));

// ───── 2. rilevamento delle modifiche PVL ─────

const ID_RETTIFICA = "f906425a";
const reale = campione.avvisi.find((a) => typeof a.idAvviso === "string" && a.idAvviso.startsWith(ID_RETTIFICA)) as Record<string, unknown>;
atteso("campione: c'è l'avviso reale di rettifica, con «tipo» = rettifica", !!reale && reale.tipo === "rettifica" && reale.nuovoAvviso === null);

type Avviso = Record<string, unknown>;
const clona = (a: Avviso): Avviso => JSON.parse(JSON.stringify(a)) as Avviso;
function sezioneC(a: Avviso): Record<string, unknown>[] {
  const tpl = ((a.templates as Record<string, unknown>[])[0].template ?? {}) as { sections: { name: string; items?: Record<string, unknown>[] }[] };
  return tpl.sections.find((s) => /^SEZ\. C/.test(s.name))?.items ?? [];
}
function metadati(a: Avviso): Record<string, unknown> {
  return ((a.templates as Record<string, unknown>[])[0].template as { metadata: Record<string, unknown> }).metadata;
}
function sezioneB(a: Avviso): Record<string, unknown> {
  const tpl = ((a.templates as Record<string, unknown>[])[0].template ?? {}) as { sections: { name: string; fields?: Record<string, unknown> }[] };
  return tpl.sections.find((s) => /^SEZ\. B/.test(s.name))?.fields ?? {};
}
function bando(a: Avviso): BandoPvl {
  const l = leggiAvvisoPvl(a);
  if (l.tipo !== "bando") throw new Error(`non è un bando: ${l.tipo}`);
  return l;
}
const foto = (a: Avviso): FotoVersionePvl => fotoDaBandoPvl(bando(a), a);
// versione precedente SINTETICA: stesso appalto, identificativo finto, pubblicata il 02/11, «avviso», sostituita dalla rettifica reale
function precedente(modifica: (a: Avviso) => void = () => {}): Avviso {
  const a = clona(reale);
  a.idAvviso = "00000000-0000-4000-8000-000000000001";
  a.dataPubblicazione = "2026-11-02T07:00:00.000+00:00";
  a.tipo = "avviso";
  a.nuovoAvviso = reale.idAvviso;
  a.tipoNuovoAvviso = "rettifica";
  a.attivo = false;
  a.dataScadenza = "2026-11-30T11:30:00.000+00:00";
  for (const l of sezioneC(a)) l.termine_ricezione = "2026-11-30+01:00";
  modifica(a);
  return a;
}
const solo = (r: ReturnType<typeof rilevaModifichePvl>): ModificaPvl[] => (r.confrontabili ? r.modifiche : []);
const sintesi = (r: ReturnType<typeof rilevaModifichePvl>) => solo(r).map((m) => [m.tipo, m.categoria, m.campo, m.lotto, m.prima, m.dopo, m.affidabilita, m.notificabile]);

const fNuova = foto(reale);
uguale("foto della rettifica reale: tipo dichiarato, scadenza con l'ora dalla fonte, 3 lotti con CIG", [fNuova.tipoDichiarato, valoreScadenzaFoto(fNuova.scadenza), fNuova.lotti.length, fNuova.lotti.every((l) => !!l.cig)], ["rettifica", "2026-12-14T11:30:00.000Z", 3, true]);
uguale("foto: serializzabile e riletta identica", fotoPvlValida(JSON.parse(JSON.stringify(fNuova))), fNuova);

// caso reale ricostruito: proroga dal 30/11 al 14/12 (stessa ora), dichiarata due volte (tipo della nuova e collegamento della vecchia)
const caso = rilevaModifichePvl(foto(precedente()), fNuova);
uguale("caso reale: una sola modifica, proroga della scadenza, affidabile e notificabile", sintesi(caso), [["proroga", "scadenza", "scadenza", null, "2026-11-30T11:30:00.000Z", "2026-12-14T11:30:00.000Z", "affidabile", true]]);
atteso(
  "caso reale: evidenza (appalto, avviso precedente e nuovo, pagina pubblica, pubblicazione, dichiarazione, avviso TED, testo della scadenza)",
  caso.confrontabili &&
    caso.rettificaDichiarata &&
    caso.evidenza.idAvvisoPrecedente === "00000000-0000-4000-8000-000000000001" &&
    caso.evidenza.idAvvisoNuovo === reale.idAvviso &&
    caso.evidenza.idAppalto === reale.idAppalto &&
    caso.evidenza.urlAvviso === `https://pubblicitalegale.anticorruzione.it/bandi/${reale.idAvviso}` &&
    caso.evidenza.giornoPubblicazione === "2026-11-11" &&
    caso.evidenza.dichiarazione === "rettifica" &&
    caso.evidenza.numeroTed === "781699-2026" &&
    /2026-11-30/.test(caso.evidenza.scadenzaFontePrecedente ?? "") &&
    /2026-12-14/.test(caso.evidenza.scadenzaFonteNuova ?? ""),
  JSON.stringify(caso),
);
atteso("caso reale: tutti i lotti prorogati allo stesso modo = nessuna riga per lotto in più", !solo(caso).some((m) => m.campo === "scadenza_lotto"));

// dichiarazione: basta una delle due strade; il collegamento deve puntare proprio all'avviso nuovo
const nuovaSenzaTipo = clona(reale);
nuovaSenzaTipo.tipo = "avviso";
uguale("dichiarazione dal solo collegamento della versione vecchia («tipoNuovoAvviso» → avviso nuovo)", rilevaModifichePvl(foto(precedente()), foto(nuovaSenzaTipo)).rettificaDichiarata, true);
uguale(
  "collegamento verso un ALTRO avviso: nessuna dichiarazione",
  rilevaModifichePvl(foto(precedente((a) => (a.nuovoAvviso = "00000000-0000-4000-8000-0000000000ff"))), foto(nuovaSenzaTipo)).rettificaDichiarata,
  false,
);

// formattazione: nessuna modifica
const formattata = clona(reale);
metadati(formattata).titolo = `  ${String(metadati(reale).titolo).toLowerCase()}.  `;
sezioneB(formattata).documenti_di_gara_link = "http://GARDACHIESE.acquistitelematici.it";
for (const l of sezioneC(formattata)) l.documenti_di_gara_link = "http://GARDACHIESE.acquistitelematici.it";
formattata.tipo = "avviso";
const versioneUguale = precedente((a) => {
  a.dataScadenza = reale.dataScadenza;
  for (const l of sezioneC(a)) l.termine_ricezione = "2026-12-14+01:00";
  a.tipoNuovoAvviso = null;
  a.nuovoAvviso = null;
});
uguale("solo formattazione (maiuscole, spazi, punto finale, http/https, maiuscole dell'host, barra finale): nessuna modifica", sintesi(rilevaModifichePvl(foto(versioneUguale), foto(formattata))), []);
// la versione precedente con gli stessi dati della nuova (per le prove di un solo campo)
function fVecchiaUguale(): FotoVersionePvl {
  return foto(versioneUguale);
}
uguale("istante della scadenza normalizzato nel registro (stesso istante, formati diversi)", [valoreScadenzaFoto({ giorno: "2026-12-14", iso: "2026-12-14T12:30:00+01:00" }), valoreScadenzaFoto({ giorno: "2026-12-14", iso: null }), valoreScadenzaFoto(null)], ["2026-12-14T11:30:00.000Z", "2026-12-14", null]);
uguale("importo con un rumore sotto il mezzo centesimo: nessuna modifica", solo(rilevaModifichePvl({ ...fVecchiaUguale(), valore: (fNuova.valore as number) + 0.001 }, fNuova)).filter((m) => m.campo === "valore_stimato"), []);
uguale("stessi CIG in un altro ordine: nessuna modifica dei lotti", solo(rilevaModifichePvl({ ...fVecchiaUguale(), lotti: [...fNuova.lotti].reverse() }, fNuova)).filter((m) => m.campo === "lotti"), []);
uguale("dichiarazione dal solo «tipo» della versione nuova (la vecchia non è stata riletta)", rilevaModifichePvl({ ...fVecchiaUguale(), sostituitoDa: null, tipoSostituzione: null, attivo: true }, fNuova).rettificaDichiarata, true);
uguale("collegamento normalizzato",[collegamentoNormalizzato("https://Host.it/a/"), collegamentoNormalizzato("http://host.it/a"), collegamentoNormalizzato("https://host.it:443/a#x")], ["host.it/a", "host.it/a", "host.it/a"]);
const istanteDiverso = clona(reale);
istanteDiverso.dataScadenza = "2026-12-14T12:30:00+01:00";
uguale("stesso istante scritto in un altro formato: nessuna modifica", sintesi(rilevaModifichePvl(foto(versioneUguale), foto(istanteDiverso))).filter((m) => m[1] === "scadenza"), []);

// rettifica dichiarata senza cambiamenti nei dati letti: una riga, notificabile, senza inventare il cambiamento
uguale("rettifica dichiarata senza cambiamenti nei dati letti: notificabile, senza campo né valori", sintesi(rilevaModifichePvl(foto(precedente((a) => {
  a.dataScadenza = reale.dataScadenza;
  for (const l of sezioneC(a)) l.termine_ricezione = "2026-12-14+01:00";
})), fNuova)), [["rettifica", "rettifica", null, null, null, null, "affidabile", true]]);

// scadenza: anticipo, ora nello stesso giorno, ora comparsa o sparita, dato che sparisce
const anticipata = rilevaModifichePvl(foto(precedente((a) => {
  a.dataScadenza = "2026-12-20T11:30:00.000+00:00";
  for (const l of sezioneC(a)) l.termine_ricezione = "2026-12-20+01:00";
})), fNuova);
uguale("anticipo del giorno: rettifica della scadenza, affidabile, notificabile", sintesi(anticipata), [["rettifica", "scadenza", "scadenza", null, "2026-12-20T11:30:00.000Z", "2026-12-14T11:30:00.000Z", "affidabile", true]]);
atteso("anticipo: il motivo lo dice", /anticipato/.test(solo(anticipata)[0]?.motivo ?? ""));
const piuTardi = rilevaModifichePvl(foto(precedente((a) => {
  a.dataScadenza = "2026-12-14T09:00:00.000+00:00";
  for (const l of sezioneC(a)) l.termine_ricezione = "2026-12-14+01:00";
})), fNuova);
uguale("stesso giorno, ora più tarda (entrambe indicate): proroga notificabile", sintesi(piuTardi), [["proroga", "scadenza", "scadenza", null, "2026-12-14T09:00:00.000Z", "2026-12-14T11:30:00.000Z", "affidabile", true]]);
// ora che compare: la versione precedente con la scadenza dell'avviso a mezzanotte (= ora non indicata)
const senzaOra = (a: Avviso) => {
  a.dataScadenza = "2026-12-13T23:00:00.000+00:00";
  for (const l of sezioneC(a)) l.termine_ricezione = "2026-12-14+01:00";
};
uguale("ora che compare nello stesso giorno, con rettifica dichiarata: notificabile ma parziale", sintesi(rilevaModifichePvl(foto(precedente(senzaOra)), fNuova)), [["rettifica", "scadenza", "scadenza", null, "2026-12-14", "2026-12-14T11:30:00.000Z", "parziale", true]]);
uguale(
  "ora che compare SENZA rettifica dichiarata: si conserva, non si notifica",
  sintesi(rilevaModifichePvl(foto(precedente((a) => { senzaOra(a); a.tipoNuovoAvviso = null; a.nuovoAvviso = null; })), foto(nuovaSenzaTipo))),
  [["rettifica", "scadenza", "scadenza", null, "2026-12-14", "2026-12-14T11:30:00.000Z", "parziale", false]],
);
const nuovaSenzaOra = clona(nuovaSenzaTipo);
senzaOra(nuovaSenzaOra);
uguale(
  "ora che sparisce: non si notifica nemmeno nella rettifica",
  sintesi(rilevaModifichePvl(foto(precedente((a) => { a.dataScadenza = reale.dataScadenza; for (const l of sezioneC(a)) l.termine_ricezione = "2026-12-14+01:00"; })), foto(nuovaSenzaOra))),
  [["rettifica", "scadenza", "scadenza", null, "2026-12-14T11:30:00.000Z", "2026-12-14", "parziale", false], ["rettifica", "rettifica", null, null, null, null, "affidabile", true]],
);
const senzaScadenza = clona(reale);
senzaScadenza.dataScadenza = null;
for (const l of sezioneC(senzaScadenza)) l.termine_ricezione = null;
atteso("scadenza che sparisce: non notificabile", solo(rilevaModifichePvl(foto(precedente()), foto(senzaScadenza))).some((m) => m.categoria === "scadenza" && !m.notificabile && m.dopo === null));

// lotti
const conLottoInPiu = clona(reale);
const lotti4 = sezioneC(conLottoInPiu);
lotti4.push({ ...lotti4[2], cig: "BD920D9999" });
const rLotti = rilevaModifichePvl(foto(precedente()), foto(conLottoInPiu));
atteso("lotto aggiunto (CIG su tutti i lotti): rettifica dei lotti, affidabile, notificabile nella rettifica", solo(rLotti).some((m) => m.campo === "lotti" && m.affidabilita === "affidabile" && m.notificabile && /BD920D9999/.test(m.dopo ?? "") && !/BD920D9999/.test(m.prima ?? "")));
const senzaCig = (a: Avviso) => {
  for (const l of sezioneC(a)) l.cig = null;
};
const nuovaSenzaCig = clona(conLottoInPiu);
senzaCig(nuovaSenzaCig);
atteso("numero di lotti cambiato senza CIG: solo il numero, parziale", solo(rilevaModifichePvl(foto(precedente(senzaCig)), foto(nuovaSenzaCig))).some((m) => m.campo === "n_lotti" && m.affidabilita === "parziale" && m.prima === "3" && m.dopo === "4"));
const unLottoProrogato = clona(reale);
sezioneC(unLottoProrogato)[1].termine_ricezione = "2026-12-21+01:00";
const rUnLotto = rilevaModifichePvl(foto(precedente()), foto(unLottoProrogato));
atteso(
  "un solo lotto con una scadenza diversa: riga del lotto con il CIG, notificabile",
  solo(rUnLotto).some((m) => m.campo === "scadenza_lotto" && m.lotto === "BD920D7140" && m.tipo === "proroga" && m.dopo === "2026-12-21" && m.notificabile),
  JSON.stringify(sintesi(rUnLotto)),
);

// altri campi: notificabili solo dentro una rettifica dichiarata
const altroValore = clona(reale);
sezioneC(altroValore)[0].valore_complessivo_stimato = 150000;
const rValore = rilevaModifichePvl(foto(precedente()), foto(altroValore));
atteso("valore stimato cambiato, rettifica dichiarata: affidabile e notificabile", solo(rValore).some((m) => m.campo === "valore_stimato" && m.affidabilita === "affidabile" && m.notificabile && m.prima === "224164.11" && m.dopo === "244950.43"), JSON.stringify(sintesi(rValore)));
const altroValoreSenza = clona(altroValore);
altroValoreSenza.tipo = "avviso";
const rValoreSenza = rilevaModifichePvl(foto(precedente((a) => { a.tipoNuovoAvviso = null; a.nuovoAvviso = null; })), foto(altroValoreSenza));
atteso(
  "gli stessi cambiamenti SENZA dichiarazione: conservati come evidenza, nessuno notificabile tranne la scadenza",
  solo(rValoreSenza).filter((m) => m.notificabile).every((m) => m.categoria === "scadenza") && solo(rValoreSenza).some((m) => m.campo === "valore_stimato" && !m.notificabile),
  JSON.stringify(sintesi(rValoreSenza)),
);
const altroOggetto = clona(reale);
metadati(altroOggetto).titolo = "Affidamento del servizio di pulizia degli immobili consortili, lotti 1-3 (testo sintetico)";
atteso("oggetto cambiato davvero: parziale, notificabile nella rettifica", solo(rilevaModifichePvl(foto(precedente()), foto(altroOggetto))).some((m) => m.campo === "oggetto" && m.affidabilita === "parziale" && m.notificabile));
const altriDocumenti = clona(reale);
sezioneB(altriDocumenti).documenti_di_gara_link = "https://piattaforma-sintetica.example/gara/123";
for (const l of sezioneC(altriDocumenti)) l.documenti_di_gara_link = "https://piattaforma-sintetica.example/gara/123";
const rDocumenti = rilevaModifichePvl(foto(precedente()), foto(altriDocumenti));
atteso(
  "collegamento ai documenti cambiato: rettifica parziale, mai categoria «documenti» (la PVL non elenca i documenti)",
  solo(rDocumenti).some((m) => m.campo === "url_documenti" && m.categoria === "rettifica" && m.affidabilita === "parziale") && solo(rDocumenti).every((m) => (m.categoria as string) !== "documenti"),
);

// annullamento dichiarato: mai osservato, non si notifica
const rAnnullamento = rilevaModifichePvl(foto(precedente((a) => { a.tipoNuovoAvviso = "annullamento"; })), foto(nuovaSenzaTipo));
atteso("annullamento dichiarato: registrato, parziale, NON notificabile; nessuna rettifica", solo(rAnnullamento).some((m) => m.tipo === "annullamento" && !m.notificabile && m.affidabilita === "parziale") && rAnnullamento.confrontabili && !rAnnullamento.rettificaDichiarata);

// riclassificazione interna: settori, metodo, livelli non entrano nella fotografia
const b1 = bando(reale);
const b2: BandoPvl = { ...b1, settori: ["ristorazione"], metodoSettore: "parole_chiave", record: { ...b1.record, impronta: "diversa" } };
uguale("riclassificazione (settori, metodo, impronta): fotografie identiche", fotoDaBandoPvl(b2, reale), fotoDaBandoPvl(b1, reale));

// guardie
const fVecchia = foto(precedente());
uguale("nessuna versione precedente: non confrontabili, ma la rettifica dichiarata si vede", rilevaModifichePvl(null, fNuova), { confrontabili: false, motivo: "nessuna_versione_precedente", rettificaDichiarata: true });
uguale("stesso avviso riletto: non confrontabili", rilevaModifichePvl(fNuova, fNuova).confrontabili ? "sì" : (rilevaModifichePvl(fNuova, fNuova) as { motivo: string }).motivo, "stesso_avviso");
uguale("versione più vecchia arrivata dopo: non confrontabili (l'ordine lo decide chi chiama)", (rilevaModifichePvl(fNuova, fVecchia) as { motivo: string }).motivo, "versione_non_piu_recente");
uguale("procedure diverse: non confrontabili", (rilevaModifichePvl({ ...fVecchia, idAppalto: "00000000-0000-4000-8000-0000000000aa" }, fNuova) as { motivo: string }).motivo, "appalti_diversi");
uguale("fotografia non valida: non confrontabili, mai un'eccezione", [(rilevaModifichePvl(fVecchia, { ...fNuova, scheda: "x y" }) as { motivo: string }).motivo, (rilevaModifichePvl({ ...fVecchia, versioneFoto: 2 } as unknown as FotoVersionePvl, fNuova) as { motivo: string }).motivo], ["foto_non_valida", "foto_non_valida"]);
uguale(
  "fotografie non valide rifiutate (giorno incoerente con l'istante, CIG malformato, importo negativo)",
  [
    fotoPvlValida({ ...fNuova, scadenza: { giorno: "2026-12-15", iso: "2026-12-14T11:30:00.000Z" } }),
    fotoPvlValida({ ...fNuova, lotti: [{ cig: "corto", valore: 1, scadenza: null }] }),
    fotoPvlValida({ ...fNuova, valore: -1 }),
  ],
  [null, null, null],
);
atteso("stessi dati, stesso risultato (nessun orologio, nessun caso)", JSON.stringify(rilevaModifichePvl(fVecchia, fNuova)) === JSON.stringify(rilevaModifichePvl(foto(precedente()), foto(reale))));
const lungo = clona(reale);
metadati(lungo).titolo = "Affidamento del servizio di pulizia ".repeat(110);
atteso("valori nel registro entro i 2000 caratteri della 0109", solo(rilevaModifichePvl(fVecchia, foto(lungo))).every((m) => (m.prima ?? "").length <= 2000 && (m.dopo ?? "").length <= 2000 && (m.campo ?? "").length <= 60));

// ───── 3. controlli sul codice ─────
const codice = fs.readFileSync(path.join(RADICE, "src/lib/radar/modifiche-pvl.ts"), "utf8") + fs.readFileSync(path.join(RADICE, "src/lib/radar/settori-catalogo.ts"), "utf8");
const senzaCommenti = codice.replace(/\/\/.*$/gm, "");
atteso("codice puro: nessuna rete, database, orologio, caso o modello AI", !/fetch\(|supabase|Date\.now|new Date\(\)|Math\.random|anthropic|openai|process\.env/i.test(senzaCommenti));
atteso("nessun import da importatori, fonti di scrittura o email", !/from "\.\/(importa|email|notifiche)/.test(senzaCommenti));

console.log(fallimenti.length === 0 ? "\nVerifica B4 della PVL: tutto a posto." : `\nVerifica B4 della PVL: ${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
process.exit(fallimenti.length === 0 ? 0 : 1);
