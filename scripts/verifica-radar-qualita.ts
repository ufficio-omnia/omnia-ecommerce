// Autotest della QUALITÀ DELLE GARE di Tender Intelligence (17/11/2026). Gratuito, nessun database né rete: gira nel livello 1.
// Gli oggetti usati sono quelli dei bandi pubblici (TED e PVL) visti nell'archivio dello staging: nessun dato di clienti.
//   - le 8 gare PVL dubbie: perché entravano, quali escono e quali restano (pertinenti in parte);
//   - ogni regola di esclusione per oggetto: ben formata, provata sui suoi casi reali;
//   - salvaguardie: le gare pertinenti dei sei settori non si escludono (casi reali vicini alle regole);
//   - esclusione ≠ cancellazione: la classificazione riporta settore tolto, regola e motivo; nessuna funzione cancella;
//   - stesse regole per tutte le fonti (TED, PVL e le fonti nuove chiamano classificaGara);
//   - riclassificazione delle gare già in archivio: toglie soltanto, si traccia, si annulla; script con porta, tetto e scritture condizionate.
import fs from "fs";
import path from "path";
import {
  ESCLUSIONI_OGGETTO,
  REGOLE_PAROLE,
  SETTORI_RADAR,
  VERSIONE_REGOLE_SETTORI,
  classificaGara,
  descriviCorrezioneSettori,
  esclusioniOggetto,
  idFonteCorrezioneSettori,
  settoriDaParole,
  testoPerConfronto,
  type SettoreRadar,
} from "../src/lib/radar/settori";
import { notaCorrezione, riclassificaGara, statoDaRegistro, valoreRegistro } from "../src/lib/radar/riclassifica-settori";

const RADICE = path.join(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(RADICE, relativo), "utf-8").replace(/\r\n/g, "\n");
const SETTORI_CPV: SettoreRadar[] = ["pulizia", "ristorazione", "vigilanza_portierato", "facchinaggio", "multiservizi"];

// ───── 1. le 8 gare PVL dubbie (17/11/2026) ─────
type Caso = { nome: string; cpv: string[]; testo: string; settori: SettoreRadar[]; regola?: string };
const DUBBIE: Caso[] = [
  {
    nome: "ZTL e logistica urbana (Comune di Pizzo, CPV 63100000 → facchinaggio)",
    cpv: ["63100000"],
    testo: "CONCESSIONE DEL SERVIZIO INTEGRATO DI GESTIONE TECNOLOGICA DELLE ZTL, LOGISTICA URBANA LAST-MILE A ZERO EMISSIONI ED AUSILIO ALLA GESTIONE DEL PROCEDIMENTO SANZIONATORIO – HUB PARRERA",
    settori: [],
    regola: "mobilita_e_sanzioni",
  },
  {
    nome: "mattatoio comunale (Comune di Corinaldo, CPV 79993100 → multiservizi)",
    cpv: ["79993100"],
    testo: "PROCEDURA TELEMATICA APERTA PER L’AFFIDAMENTO IN CONCESSIONE DEL SERVIZIO DI GESTIONE DEL MATTATOIO COMUNALE DI CORINALDO",
    settori: [],
    regola: "impianti_di_altri_mestieri",
  },
  {
    nome: "casone in concessione (Comune di Accadia, CPV 55300000 → ristorazione)",
    cpv: ["55300000"],
    testo: "AFFIDAMENTO IN CONCESSIONE DEL CASONE “PADULI” PER LA DURATA DI SETTE ANNI",
    settori: [],
    regola: "concessione_di_immobili",
  },
  {
    nome: "stabile comunale con mensa della scuola dell'infanzia (Valprato Soana): pertinente in parte, RESTA ristorazione",
    cpv: ["55300000"],
    testo:
      "CONCESSIONE IN GESTIONE DELLO STABILE COMUNALE SITO IN FRAZIONE CAMPIGLIA COSTITUITO DA BAR, RISTORANTE, PIZZERIA, NEGOZIO ALIMENTARI E SERVIZIO MENSA PER LA SCUOLA DELL’INFANZIA COMUNALE",
    settori: ["ristorazione"],
  },
  {
    nome: "punti ristoro e distributori automatici (Liceo Orazio, CPV 55524000 → ristorazione)",
    cpv: ["55524000"],
    testo:
      "PA ESF35/26/SUA - Affidamento della gestione del servizio di: n. 1 punto ristoro, n. 2 punti ristoro volanti e n. 6 distributori automatici di bevande calde/fredde e snack e n. 3 distributori di acqua di rete interni alle sedi del Liceo Ginnasio Statale “Orazio”",
    settori: [],
    regola: "ristorazione_commerciale",
  },
  {
    nome: "distribuzione di panini (IIS Majorana, CPV 55524000 → ristorazione)",
    cpv: ["55524000"],
    testo: "AFFIDAMENTO IN CONCESSIONE DEL SERVIZIO DI DISTRIBUZIONE DI PANINI E PRODOTTI DA FORNO",
    settori: [],
    regola: "prodotti_da_banco",
  },
  { nome: "fornitura di pizza (IC Ugo Betti, CPV 55524000 → ristorazione)", cpv: ["55524000"], testo: "Fornitura pizza scuole Betti", settori: [], regola: "prodotti_da_banco" },
  {
    nome: "videosorveglianza dei siti sensibili e trasporto valori (Valle Umbra Servizi): pertinente, RESTA vigilanza",
    cpv: ["79711000"],
    testo: "SERVIZIO DI GESTIONE DEL SISTEMA DI VIDEO SORVEGLIANZA DEI SITI SENSIBILI E SERVIZIO DI RITIRO, TRASPORTO, CONTAZIONE E DEPOSITO DI VALORI",
    settori: ["vigilanza_portierato"],
  },
];
for (const c of DUBBIE) {
  const prima = classificaGara({ cpvPrincipale: c.cpv[0], cpvTutti: c.cpv, testo: null });
  atteso(`${c.nome}: entrava per CPV del file approvato`, prima.metodo === "cpv" && prima.settori.length === 1);
  const r = classificaGara({ cpvPrincipale: c.cpv[0], cpvTutti: c.cpv, testo: c.testo });
  uguale(`${c.nome}: settori dopo le regole`, r.settori, c.settori);
  if (c.regola) uguale(`${c.nome}: esclusa con la regola giusta, motivo tracciato`, r.esclusioni.map((e) => [e.settore, e.regola, !!e.motivo]), [[prima.settori[0], c.regola, true]]);
  else uguale(`${c.nome}: nessuna esclusione`, r.esclusioni, []);
}

// ───── 2. regole ben formate e provate sui loro casi ─────
uguale("id delle regole unici", new Set(ESCLUSIONI_OGGETTO.map((r) => r.id)).size, ESCLUSIONI_OGGETTO.length);
for (const r of ESCLUSIONI_OGGETTO) {
  atteso(`${r.id}: motivo in parole semplici e almeno un caso reale`, r.motivo.length > 20 && r.casi.length > 0);
  atteso(`${r.id}: espressioni senza stato (né g né y)`, !/[gy]/.test(r.cerca.flags) && !(r.salvo && /[gy]/.test(r.salvo.flags)));
  atteso(`${r.id}: settori noti`, r.settori === "tutti" || r.settori.every((s) => SETTORI_RADAR.some((x) => x.id === s)));
  atteso(`${r.id}: mai sull'ausiliariato (non ha CPV)`, r.settori === "tutti" || !r.settori.includes("ausiliariato"));
  for (const caso of r.casi) {
    const settori = r.settori === "tutti" ? SETTORI_CPV : r.settori;
    const e = esclusioniOggetto(testoPerConfronto(caso), settori);
    atteso(`${r.id}: esclude il caso «${caso.slice(0, 70)}…»`, e.some((x) => x.regola === r.id), JSON.stringify(e));
  }
}
for (const r of REGOLE_PAROLE) atteso(`parole chiave ${r.settore}: espressioni senza stato`, !/[gy]/.test(r.cerca.flags) && !(r.escludi && /[gy]/.test(r.escludi.flags)));

// ───── 3. salvaguardie: gare pertinenti (casi reali vicini alle regole) ─────
const PERTINENTI: Caso[] = [
  { nome: "refezione scolastica", cpv: ["55524000"], testo: "Affidamento del servizio di refezione scolastica della scuola dell’infanzia del Comune di Amato", settori: ["ristorazione"] },
  { nome: "pausa pranzo e bar (mensa aziendale)", cpv: ["55511000"], testo: "Servizi di pausa pranzo e bar", settori: ["ristorazione"] },
  { nome: "bar e mensa (parola approvata)", cpv: ["55300000"], testo: "Concessione del servizio bar e mensa dell'ospedale", settori: ["ristorazione"] },
  { nome: "ristorante aziendale", cpv: ["55510000"], testo: "Gestione del ristorante aziendale e della caffetteria", settori: ["ristorazione"] },
  { nome: "fornitura di servizi di catering", cpv: ["55520000"], testo: "Accordo quadro multisourcing per la fornitura di servizi di catering per le strutture dell'Università", settori: ["ristorazione"] },
  {
    nome: "centri di accoglienza con vitto e pulizie (famiglia da decidere: invariata)",
    cpv: ["85311000", "55300000", "90911000"],
    testo: "SERVIZI GESTIONE CENTRI ACCOGLIENZA STRAORDINARI. FORNITURA DI BENI ED EROGAZIONE SERVIZI DI ACCOGLIENZA PER COMPLESSIVI 200 POSTI",
    settori: ["ristorazione", "pulizia"],
  },
  {
    nome: "centro di accoglienza presso una struttura demaniale (invariata)",
    cpv: ["55300000", "90911100"],
    testo: "Gara europea per i servizi di gestione e funzionamento del centro di accoglienza collettivo presso la struttura demaniale Caserma Mancini",
    settori: ["ristorazione", "pulizia"],
  },
  { nome: "facchinaggio dei RAEE", cpv: ["63100000"], testo: "SERVIZIO DI FACCHINAGGIO RAEE E PULIZIA CCR", settori: ["facchinaggio"] },
  { nome: "facchinaggio negli impianti sportivi", cpv: ["63100000"], testo: "PA servizio di facchinaggio da espletarsi presso gli immobili e gli impianti sportivi durante i Giochi del Mediterraneo", settori: ["facchinaggio"] },
  { nome: "logistica integrata del farmaco", cpv: ["63110000"], testo: "Servizio logistica integrata del farmaco per le aziende del SSR", settori: ["facchinaggio"] },
  { nome: "trasloco con fornitura di imballaggi", cpv: ["98392000"], testo: "Servizio di trasloco con fornitura di imballaggi", settori: ["facchinaggio"] },
  { nome: "pulizia con fornitura di materiali", cpv: ["90911200"], testo: "Servizio di pulizia degli edifici comunali con fornitura di materiali e prodotti di consumo", settori: ["pulizia"] },
  { nome: "pulizia e raccolta dei rifiuti negli uffici", cpv: ["90919200"], testo: "Servizio di pulizia degli uffici e raccolta dei rifiuti", settori: ["pulizia"] },
  {
    nome: "custodia, sicurezza e pulizia degli impianti sportivi",
    cpv: ["90910000", "98341130"],
    testo: "SERVIZIO DI CUSTODIA, SICUREZZA E PULIZIA AMBIENTALE DEGLI IMPIANTI SPORTIVI AFFIDATI IN GESTIONE",
    settori: ["pulizia", "vigilanza_portierato"],
  },
  { nome: "front office dei centri natatori", cpv: ["79992000"], testo: "Servizio global service per attività di front-office e back-office per la gestione delle segreterie dei centri natatori comunali", settori: ["vigilanza_portierato"] },
  { nome: "centralino e front office", cpv: ["79992000"], testo: "SERVIZIO DI SPOLA E CENTRALINO-FRONT OFFICE PER LA SEDE ISTITUZIONALE", settori: ["vigilanza_portierato"] },
  { nome: "vigilanza armata con telecamere", cpv: ["98341140"], testo: "Servizio di vigilanza armata e di controllo delle telecamere", settori: ["vigilanza_portierato"] },
  { nome: "gestione di impianti tecnologici degli edifici", cpv: ["79993100"], testo: "Servizio di conduzione e manutenzione impianti tecnologici", settori: ["multiservizi"] },
  { nome: "multiservizi presso i soggiorni militari", cpv: [], testo: "Concessione di Multiservizi da erogare presso i Soggiorni Militari di Forza Armata", settori: ["multiservizi"] },
  { nome: "manutenzione degli immobili in servizi integrati", cpv: [], testo: "SERVIZI INTEGRATI, GESTIONALI ED OPERATIVI DI MANUTENZIONE DA ESEGUIRSI PRESSO GLI IMMOBILI DELLA ASL ROMA 2", settori: ["multiservizi"] },
  { nome: "ausiliariato", cpv: [], testo: "Servizio di ausiliariato specializzato occorrente all’ASP di Catania", settori: ["ausiliariato"] },
  { nome: "pulizia di mezzi di trasporto (non è manutenzione di veicoli)", cpv: ["90917000"], testo: "Servizio di pulizia e lavaggio dei veicoli del parco mezzi", settori: ["pulizia"] },
];
for (const c of PERTINENTI) {
  const r = classificaGara({ cpvPrincipale: c.cpv[0] ?? null, cpvTutti: c.cpv, testo: c.testo });
  uguale(`pertinente, resta: ${c.nome}`, r.settori, c.settori);
}

// parole chiave: errori corretti (casi reali di TED nell'archivio dello staging)
const PAROLE_FUORI = [
  "Procedura aperta per l'affidamento del servizio di coperture assicurative di Marche Multiservizi SPA",
  "Individuazione di un nuovo socio privato della Società Levante Multiservizi s.r.l.",
  "Servizi integrati di gestione documentale: ricevimento, profilazione, postalizzazione",
  "Servizi integrati per la gestione e manutenzione delle apparecchiature biomediche",
  "Gara europea per servizi integrati di formazione e supporto specialistico per il potenziamento delle Soft Skill",
  "Servizi integrati di biblioteca presso le strutture dell'Università",
  "Procedura aperta per l'affidamento in concessione del servizio ausiliario al rilascio di visti di circolazione e soggiorno",
];
for (const t of PAROLE_FUORI) uguale(`parole chiave: fuori «${t.slice(0, 60)}…»`, settoriDaParole(t), []);
uguale("parole chiave: «multiservizi» come servizio resta", settoriDaParole("Affidamento del servizio multiservizi presso le sedi comunali"), ["multiservizi"]);

// ───── 4. esclusione ≠ cancellazione: cosa riporta la classificazione ─────
const misto = classificaGara({ cpvPrincipale: "55300000", cpvTutti: ["55300000", "90911200"], testo: "Concessione del bar e pulizia dei locali del museo" });
uguale("bar con pulizie: tolta la ristorazione, resta la pulizia", misto.settori, ["pulizia"]);
uguale("settore principale mai un settore escluso", misto.settorePrincipale, "pulizia");
atteso("motivi solo dei settori che restano", misto.motivi.every((m) => !m.includes("55300000")) && misto.motivi.some((m) => m.includes("90911200")));
uguale("il settore tolto resta scritto con regola e motivo", misto.esclusioni.map((e) => [e.settore, e.regola]), [["ristorazione", "ristorazione_commerciale"]]);
const soloParole = classificaGara({ cpvPrincipale: "55300000", cpvTutti: ["55300000"], testo: "Concessione del bar con servizio di pulizia dei locali" });
uguale("tutti i settori dei CPV esclusi: decidono le parole chiave, come per le altre gare", [soloParole.settori, soloParole.metodo], [["pulizia"], "parole_chiave"]);
const nessuno = classificaGara({ cpvPrincipale: "55524000", cpvTutti: ["55524000"], testo: "Fornitura pizza scuole Betti" });
atteso("gara esclusa: nessun settore ma esclusione tracciata", nessuno.settori.length === 0 && nessuno.metodo === null && nessuno.esclusioni.length === 1);
uguale("senza testo nessuna esclusione (classificazione di prima)", classificaGara({ cpvPrincipale: "55524000", cpvTutti: ["55524000"], testo: null }).settori, ["ristorazione"]);
for (const r of REGOLE_PAROLE) {
  // chi contiene le parole approvate del settore non si esclude mai: provato sugli esempi della regola
  const esempio = r.esempio.split(",")[0].trim();
  const conTutto = `${esempio} ${ESCLUSIONI_OGGETTO.flatMap((x) => x.casi).join(" ")}`;
  if (r.settore !== "ausiliariato") uguale(`nucleo ${r.settore}: con «${esempio}» il settore non si esclude mai`, esclusioniOggetto(testoPerConfronto(conTutto), [r.settore]), []);
}

// ───── 5. stesse regole per tutte le fonti ─────
for (const f of ["src/lib/radar/fonti/ted-calcoli.ts", "src/lib/radar/fonti/pvl-calcoli.ts", "src/lib/radar/fonti/sintel-calcoli.ts", "src/lib/radar/fonti/aflink-calcoli.ts"]) {
  if (!fs.existsSync(path.join(RADICE, f))) {
    console.log(`(salto ${f}: non è su questo ramo)`);
    continue;
  }
  const t = leggi(f);
  if (!/classificaGara/.test(t)) {
    console.log(`(salto ${f}: non classifica ancora)`);
    continue;
  }
  atteso(`${f}: classifica con classificaGara di settori.ts`, /import \{[^}]*classificaGara[^}]*\} from "\.\.\/settori"/.test(t));
  atteso(`${f}: nessuna regola di esclusione propria`, !/ESCLUSIONI_OGGETTO\s*=|REGOLE_PAROLE\s*=/.test(t));
}

// ───── 6. riclassificazione delle gare già in archivio ─────
const base = { id: "00000000-0000-0000-0000-000000000001", cpv_tutti: null, natura_contratto: "servizi" };
uguale(
  "riclassificazione: gara pertinente invariata",
  riclassificaGara({ ...base, oggetto: "Servizio di refezione scolastica", cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "cpv" }, []).tipo,
  "invariata",
);
const corr = riclassificaGara({ ...base, oggetto: "Fornitura pizza scuole Betti", cpv_principale: "55524000", settori: ["ristorazione"], metodo_settore: "cpv" }, []);
atteso(
  "riclassificazione: gara esclusa → correzione che toglie e basta",
  corr.tipo === "correzione" && corr.dopo.settori.length === 0 && corr.dopo.metodo === null && corr.idFonte === `regole-settori-${VERSIONE_REGOLE_SETTORI}:prodotti_da_banco`,
  JSON.stringify(corr),
);
const lotti = riclassificaGara({ ...base, oggetto: "lotto1", cpv_principale: "90910000", cpv_tutti: ["90910000", "98341130"], settori: ["pulizia", "vigilanza_portierato"], metodo_settore: "cpv" }, [
  { oggetto: "SERVIZIO DI CUSTODIA, SICUREZZA E PULIZIA AMBIENTALE DEGLI IMPIANTI SPORTIVI", cpv_principale: "90910000", cpv_tutti: null },
]);
uguale("riclassificazione: legge anche gli oggetti dei lotti (come gli importatori)", lotti.tipo, "invariata");
uguale(
  "riclassificazione: una gara che guadagnerebbe un settore non si tocca",
  riclassificaGara({ ...base, oggetto: "Servizio di refezione scolastica", cpv_principale: "55524000", settori: [], metodo_settore: null }, []).tipo,
  "da_decidere",
);
uguale(
  "riclassificazione: parola chiave su una fornitura → fuori (regola degli importatori)",
  (() => {
    const r = riclassificaGara({ ...base, oggetto: "Fornitura di attrezzature per la pulizia con servizio di pulizia", cpv_principale: "39000000", settori: ["pulizia"], metodo_settore: "parole_chiave", natura_contratto: "forniture" }, []);
    return r.tipo === "correzione" ? r.dopo.settori : r.tipo;
  })(),
  [],
);
const stato = { settori: ["ristorazione", "pulizia"], metodo: "cpv" };
uguale("registro: valore di prima leggibile per il ripristino", statoDaRegistro(valoreRegistro(stato)), stato);
uguale("registro: forma breve (solo settori)", statoDaRegistro('["pulizia"]'), { settori: ["pulizia"], metodo: null });
uguale("registro: valore illeggibile = nessun ripristino", statoDaRegistro("{rotto"), null);
atteso("nota del registro entro 1000 caratteri", notaCorrezione(Array.from({ length: 50 }, () => ({ settore: "ristorazione" as const, regola: "x", motivo: "m".repeat(80) }))).length <= 1000);
atteso("identificativo della correzione entro 200 caratteri", idFonteCorrezioneSettori(ESCLUSIONI_OGGETTO.map((r) => ({ settore: "pulizia" as const, regola: r.id, motivo: "" }))).length <= 200);
uguale(
  "frase per il cliente nella scheda",
  descriviCorrezioneSettori("17/11/2026", valoreRegistro({ settori: ["ristorazione"], metodo: "cpv" }), valoreRegistro({ settori: [], metodo: null }), `regole-settori-${VERSIONE_REGOLE_SETTORI}:prodotti_da_banco`),
  "Il 17/11/2026 abbiamo tolto la gara da: ristorazione collettiva (Vendita o fornitura di panini, pizza o merende: non è un servizio di ristorazione collettiva). Resta consultabile nell'archivio.",
);

// ───── 7. script di riclassificazione: porta, tetto, nessuna cancellazione ─────
const script = leggi("scripts/radar-riclassifica-settori.ts");
atteso("script: porta delle autorizzazioni con il suo nome", script.includes('controllaPorta({ script: "radar-riclassifica-settori.ts" })'));
atteso("script: la porta viene prima di ogni accesso al database per applica e annulla", script.indexOf('if (modo !== "prova") await porta();') > 0 && script.indexOf('if (modo !== "prova") await porta();') < script.indexOf("const db = createClient"));
atteso("script: solo staging, mai produzione", script.includes("PROGETTO_PRODUZIONE") && script.includes("RADAR_STAGING_REF"));
atteso("script: nessuna cancellazione né funzione del database", !/\.delete\(|\.rpc\(|truncate|drop /i.test(script));
atteso("script: scritture condizionate ai settori trovati (contiene E contenuto)", /contains\("settori"/.test(script) && /containedBy\("settori"/.test(script));
atteso("script: tetto di gare, si ferma prima di scrivere", script.includes("più del massimo autorizzato") && script.includes("massimo <= 500"));
atteso("script: registro mai notificabile", (script.match(/notificabile: false/g) ?? []).length === 2 && !script.includes("notificabile: true"));
atteso("script: cambia solo settori, metodo e data di aggiornamento", (script.match(/\.update\(\{[^}]*\}/g) ?? []).every((u) => /^\.update\(\{ settori: [^,]+, metodo_settore: [^,]+, aggiornata_il: iso \}$/.test(u)));
const scheda = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/gara/[id]/page.tsx");
atteso("scheda della gara: la correzione dei settori ha la sua frase (non «Rettifica»)", scheda.includes("descriviCorrezioneSettori(quando, a.valore_precedente, a.valore_nuovo, a.id_fonte)"));

if (fallimenti.length) {
  console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nTutti i controlli sulla qualità delle gare sono superati.");
