// Autotest della garanzia R8 (nessun riferimento all'offerta economica):
// gratuito, nessuna chiamata a modelli (la riformulazione usa un modello
// FINTO), gira insieme al livello 1 (npm run verifica:livello1, quindi in
// prebuild).
//
// Un riferimento economico in un'offerta tecnica può costare l'esclusione
// dalla gara. Qui si prova: che il rilevatore trovi le formule vietate anche
// nelle forme indirette e spezzate dalla formattazione; che NON segnali testo
// legittimo (falsi allarmi = riformulazioni inutili); che il ciclo
// rileva → riformula → controlla → riprova → avvisa funzioni; che nessun
// documento esca in silenzio; e che la garanzia sia davvero collegata ai punti
// di produzione in cui il testo diventa documento.
import fs from "fs";
import path from "path";
import {
  estrattoIntorno,
  haRiferimentiEconomici,
  testoAvvisoEconomico,
  trovaRigheConRiferimentiEconomici,
  trovaRiferimentiEconomici,
} from "../src/lib/riferimenti-economici";
import {
  garantisciSenzaRiferimentiEconomici,
  validaRiformulazione,
  type FunzioneRiformulazione,
} from "../src/lib/garanzia-senza-economico";
import { ISTRUZIONI_RIFORMULAZIONE_SENZA_ECONOMICO, REGOLE_OMNIA } from "../src/lib/prompts";
import { eseguiControlliStrutturali, type FixtureRelazione } from "./lib/controlli-relazione";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const radice = path.join(__dirname, "..");
const leggi = (relativo: string) => fs.readFileSync(path.join(radice, relativo), "utf-8").replace(/\r\n/g, "\n");

// --- 1. Formule vietate: l'elenco della richiesta e le forme indirette ---
const DEVONO_ESSERE_TROVATE: [string, string][] = [
  // L'elenco indicato esplicitamente.
  ["senza oneri aggiuntivi", "Il servizio è svolto senza oneri aggiuntivi per la stazione appaltante."],
  ["a titolo gratuito", "La formazione è erogata a titolo gratuito a tutto il personale."],
  ["gratuitamente", "L'intervento è fornito gratuitamente."],
  ["senza costi", "L'attività viene svolta senza costi per l'Amministrazione."],
  ["compreso nel prezzo", "Il monitoraggio è compreso nel prezzo."],
  ["a costo zero", "La sanificazione straordinaria è offerta a costo zero."],
  ["nessun onere", "Per l'ente non è previsto nessun onere."],
  ["importi", "Gli importi delle migliorie sono indicati a parte."],
  ["percentuali di ribasso", "Le percentuali di ribasso offerte sono dettagliate altrove."],
  ["€", "Il valore della dotazione è di 12.000 €."],
  ["euro", "La dotazione vale circa 12.000 euro."],
  ["EUR", "Valore stimato: EUR 5.000."],
  // Il caso reale che ha fatto fallire il livello 2.
  ["senza oneri (reale)", "è previsto un passaggio di verifica intermedio a cadenza quindicinale senza oneri aggiuntivi di orario per l'Amministrazione, per intercettare tempestivamente eventuali criticità igieniche"],
  // Formulazioni indirette.
  ["aggravio di spesa", "Il servizio è garantito senza alcun aggravio di spesa per l'ente."],
  ["ulteriori costi", "Le attività extra sono svolte senza ulteriori costi."],
  ["nessuna spesa aggiuntiva", "Non comporta nessuna spesa aggiuntiva."],
  ["senza maggiorazioni", "Il servizio festivo è svolto senza maggiorazioni."],
  ["già incluso nel canone", "Il presidio è già incluso nel canone."],
  ["incluse nel corrispettivo", "Le forniture sono incluse nel corrispettivo."],
  ["a proprie spese", "L'impresa sostituisce i macchinari a proprie spese."],
  ["a spese dell'impresa", "Il ripristino è eseguito a spese dell'impresa."],
  ["a carico dell'appaltatore", "I materiali di consumo sono a carico dell'appaltatore."],
  ["a titolo non oneroso", "La consulenza è prestata a titolo non oneroso."],
  ["privo di oneri", "Il servizio di reperibilità è privo di oneri."],
  ["in omaggio", "Si fornisce in omaggio un kit di sanificazione."],
  ["sconto", "Si applica uno sconto del 5% sul secondo anno."],
  ["costo orario", "Il costo orario del personale resta invariato."],
  ["gratis", "Il sopralluogo è gratis."],
  ["zero costi", "Soluzione a zero costi per la committenza."],
  ["offerta economica", "Come indicato nell'offerta economica, il servizio è esteso."],
  // Maiuscole e formattazione che spezza la formula.
  ["MAIUSCOLO", "SENZA ONERI AGGIUNTIVI PER L'ENTE"],
  ["grassetto nella formula", "Il servizio è svolto senza **oneri** aggiuntivi."],
  ["evidenziazione nella formula", "Il servizio è svolto senza !!oneri!! aggiuntivi."],
  ["in cella di tabella", "| [C]Sopralluogo | [G]gratuito per la stazione appaltante |"],
  ["in titolo", "## 1.3 Servizi gratuiti per l'utenza"],
  ["in voce di elenco con tag", "- [ICONA:qualita] **Intervento** senza costi aggiuntivi"],
];

for (const [nome, testo] of DEVONO_ESSERE_TROVATE) {
  atteso(`rilevata: ${nome}`, haRiferimentiEconomici(testo), `non trovata in «${testo}»`);
}

// --- 2. Testo legittimo: nessun falso allarme ---
const NON_DEVONO_ESSERE_TROVATI: [string, string][] = [
  ["classe di emissione Euro 6", "Gli automezzi sono di classe Euro 6."],
  ["classe di emissione Euro 5", "Mezzi con motorizzazione euro 5 o superiore."],
  ["Via Europa", "Biblioteca Viale Europa, sede a frequenza settimanale."],
  ["Unione Europea", "Il marchio Ecolabel dell'Unione Europea certifica i detergenti."],
  ["norma europea", "In conformità alla norma europea UNI EN 13549."],
  ["extra-canone", "Richiesta intervento extra-canone: presa in carico entro 48 ore."],
  ["senza interruzioni", "Il servizio è garantito senza interruzioni nei giorni di apertura."],
  ["senza ritardi", "Le segnalazioni sono gestite senza ritardi."],
  ["senza dubbio", "Senza dubbio la formazione è il punto di forza."],
  ["personale aggiuntivo", "Si impiega personale aggiuntivo nei periodi di picco."],
  ["importante", "È importante verificare la dotazione di inizio turno."],
  ["importanza", "Si dà importanza alla tracciabilità degli interventi."],
  ["prezioso", "Il confronto con il referente è un momento prezioso."],
  ["formazione in orario di servizio", "La formazione è svolta in orario di servizio con frequenza annuale."],
  ["riga di tabella normale", "| [C]Spolveratura superfici | [G]Quotidiana in tutte le aree comuni | [C]Caposquadra |"],
  ["valori con asterisco", "| [C]Monte ore settimanale | [C]**144,5 ore** * |"],
  ["separatore di tabella", "|---|---|"],
];
for (const [nome, testo] of NON_DEVONO_ESSERE_TROVATI) {
  const trovati = trovaRiferimentiEconomici(testo);
  atteso(`non segnalata: ${nome}`, trovati.length === 0, trovati.map((t) => `«${t.formula}»`).join(", "));
}

// Una formula non può nascere a cavallo di due celle di tabella.
atteso("formula spezzata fra due celle: non è una formula", !haRiferimentiEconomici("| senza | oneri aggiuntivi |"), "");

// Il riferimento anonimizzato di livello 1 (testo reale già approvato) non contiene nulla.
{
  const fixture: FixtureRelazione = JSON.parse(leggi("test/fixtures/relazione-riferimento.json"));
  const righe = fixture.sezioni.flatMap((s) => trovaRigheConRiferimentiEconomici(s.contenuto));
  atteso("riferimento approvato di livello 1: nessun riferimento economico", righe.length === 0, righe.map((r) => r.riga.slice(0, 80)).join(" / "));
}

// --- 3. Posizione e descrizione ---
{
  const testo = "## 1.2 Verifiche\n\nParagrafo normale.\n\nIl passaggio è svolto senza oneri aggiuntivi per l'ente.\n\n|---|---|";
  const righe = trovaRigheConRiferimentiEconomici(testo);
  atteso("righe interessate: solo quella con la formula, con il suo indice", righe.length === 1 && righe[0].indiceRiga === 4, JSON.stringify(righe.map((r) => r.indiceRiga)));
  const estratto = estrattoIntorno(righe[0].riga, righe[0].riferimenti[0], 20);
  atteso("estratto: la frase intorno al punto", /senza oneri/.test(estratto) && estratto.length < righe[0].riga.length + 4, estratto);
}

// --- 4. Ciclo di riformulazione con un modello finto ---
const SEZIONE = `## 1.1 Organizzazione

Il responsabile coordina le squadre e verifica gli interventi ogni giorno.

## 1.2 Verifiche periodiche

Il controllo intermedio ha cadenza quindicinale senza oneri aggiuntivi di orario per l'Amministrazione.

| Attività | Frequenza |
|---|---|
| [C]Sopralluogo | [C]Mensile |
| [C]Formazione | [G]Erogata gratuitamente a tutto il personale **operativo** * |

- [ICONA:qualita] Report **mensile** consegnato al referente.`;

const RIGA_PARAGRAFO = "Il controllo intermedio ha cadenza quindicinale senza oneri aggiuntivi di orario per l'Amministrazione.";
const RIGA_TABELLA = "| [C]Formazione | [G]Erogata gratuitamente a tutto il personale **operativo** * |";

type Chiamata = Parameters<FunzioneRiformulazione>[0];
function modello(risposte: ((c: Chiamata, n: number) => Map<number, string>)[]): { riformula: FunzioneRiformulazione; chiamate: Chiamata[] } {
  const chiamate: Chiamata[] = [];
  return {
    chiamate,
    riformula: async (c) => {
      chiamate.push(c);
      const f = risposte[Math.min(chiamate.length - 1, risposte.length - 1)];
      return f(c, chiamate.length);
    },
  };
}
const ctx = { userId: null, garaId: null };

async function main() {
  // 4.1 Testo pulito: nessuna chiamata, testo identico byte per byte.
  {
    const m = modello([() => new Map()]);
    const pulito = SEZIONE.replace(/ senza oneri aggiuntivi di orario per l'Amministrazione/, "").replace("gratuitamente a tutto", "a tutto");
    const r = await garantisciSenzaRiferimentiEconomici(pulito, { titoloSezione: "1. Prova", context: ctx, riformula: m.riformula });
    atteso("testo pulito: nessuna chiamata al modello e testo identico", m.chiamate.length === 0 && r.testo === pulito && r.avvisi.length === 0, `chiamate ${m.chiamate.length}`);
  }

  // 4.2 Una riga con la formula, riformulata al primo tentativo: cambia solo quella riga.
  {
    const m = modello([(c) => new Map(c.righe.map((x) => [x.indice, x.riga.replace(" senza oneri aggiuntivi di orario per l'Amministrazione", "").replace(" gratuitamente", "")]))]);
    const r = await garantisciSenzaRiferimentiEconomici(SEZIONE, { titoloSezione: "1. Prova", context: ctx, riformula: m.riformula });
    const originali = SEZIONE.split("\n");
    const nuovi = r.testo.split("\n");
    const cambiate = originali.map((riga, i) => (riga !== nuovi[i] ? i : -1)).filter((i) => i >= 0);
    atteso("riformulazione al primo tentativo: nessuna formula residua, nessun avviso", !haRiferimentiEconomici(r.testo) && r.avvisi.length === 0, r.avvisi.map((a) => a.formula).join(", "));
    atteso("riformulazione al primo tentativo: una sola chiamata che porta entrambe le righe", m.chiamate.length === 1 && m.chiamate[0].righe.length === 2, `chiamate ${m.chiamate.length}, righe ${m.chiamate[0]?.righe.length}`);
    atteso("riformulazione al primo tentativo: cambiano SOLO le due righe interessate", cambiate.length === 2 && nuovi.length === originali.length, `righe cambiate: ${cambiate.join(", ")}`);
    atteso("riformulazione: la riga di tabella mantiene celle, tag, grassetto e asterisco", /^\| \[C\]Formazione \| \[G\]Erogata a tutto il personale \*\*operativo\*\* \* \|$/.test(nuovi[originali.indexOf(RIGA_TABELLA)]), nuovi[originali.indexOf(RIGA_TABELLA)]);
    atteso("riformulazione: il modello riceve le formule trovate e il titolo", m.chiamate[0].righe.some((x) => x.formule.some((f) => /oneri/.test(f))) && m.chiamate[0].titoloSezione === "1. Prova", "");
  }

  // 4.3 Primo tentativo ancora con la formula: secondo tentativo con il motivo.
  {
    const m = modello([
      (c) => new Map(c.righe.map((x) => [x.indice, x.riga.replace("senza oneri aggiuntivi", "senza costi")])),
      (c) => new Map(c.righe.map((x) => [x.indice, x.riga.replace(" senza oneri aggiuntivi di orario per l'Amministrazione", "").replace(" gratuitamente", "")])),
    ]);
    const r = await garantisciSenzaRiferimentiEconomici(SEZIONE, { titoloSezione: "1. Prova", context: ctx, riformula: m.riformula });
    atteso("secondo tentativo: la formula residua viene tolta, nessun avviso", !haRiferimentiEconomici(r.testo) && r.avvisi.length === 0 && m.chiamate.length === 2, `chiamate ${m.chiamate.length}, avvisi ${r.avvisi.length}`);
    atteso("secondo tentativo: il modello riceve il motivo dello scarto", /contiene ancora/.test(m.chiamate[1].correzioni) && /RIGA \d+/.test(m.chiamate[1].correzioni), m.chiamate[1].correzioni);
  }

  // 4.4 La formula persiste dopo il secondo tentativo: il documento esce, con l'avviso sul punto esatto.
  {
    // Il paragrafo viene riscritto con un'altra formula vietata; la riga di tabella correttamente.
    const m = modello([(c) => new Map(c.righe.map((x) => [x.indice, /Formazione/.test(x.riga) ? x.riga.replace(" gratuitamente", "") : x.riga.replace("senza oneri aggiuntivi", "a costo zero")]))]);
    const r = await garantisciSenzaRiferimentiEconomici(SEZIONE, { titoloSezione: "1. Prova", context: ctx, riformula: m.riformula });
    atteso("formula persistente: due tentativi e non di più", m.chiamate.length === 2 && r.chiamate === 2, `chiamate ${m.chiamate.length}`);
    atteso("formula persistente: il documento esce comunque, con il testo intero", r.testo.split("\n").length === SEZIONE.split("\n").length, "");
    // La riformulazione "a costo zero" è a sua volta vietata, quindi scartata: nel documento resta la riga ORIGINALE e l'avviso ne indica la formula.
    atteso("formula persistente: un avviso con sezione, sotto-criterio, formula ed estratto", r.avvisi.length === 1 && r.avvisi[0].sezione === "1. Prova" && r.avvisi[0].sottoCriterio === "1.2 Verifiche periodiche" && /senza oneri/.test(r.avvisi[0].formula) && /quindicinale/.test(r.avvisi[0].estratto), JSON.stringify(r.avvisi));
    atteso("formula persistente: la riga di tabella corretta non genera avviso", !r.avvisi.some((a) => /Formazione|gratuitamente/.test(a.estratto)), JSON.stringify(r.avvisi));
    const nonRiformulata = await garantisciSenzaRiferimentiEconomici(RIGA_TABELLA, { titoloSezione: "1. Prova", context: ctx, riformula: async () => new Map() });
    atteso("estratto di una riga di tabella: leggibile, con '|' e senza separatori interni", nonRiformulata.avvisi.length === 1 && /Formazione | Erogata gratuitamente/.test(nonRiformulata.avvisi[0].estratto) && !/¦/.test(nonRiformulata.avvisi[0].estratto), JSON.stringify(nonRiformulata.avvisi));
    const testoModello = testoAvvisoEconomico(r.avvisi);
    atteso("avviso per il modello che risponde in chat: punto esatto e invito a non dire 'pronto'", /ATTENZIONE/.test(testoModello) && /1\.2 Verifiche periodiche/.test(testoModello) && /senza dire che il documento è pronto/.test(testoModello), testoModello);
    atteso("nessun avviso, nessun testo per il modello", testoAvvisoEconomico([]) === "", "");
  }

  // 4.5 Riformulazioni che non reggono ai controlli sono scartate.
  {
    const casi: [string, string, string, RegExp][] = [
      ["riga di tabella con una cella in meno (celle fuse)", RIGA_TABELLA, "| [C]Formazione Erogata a tutto il personale **operativo** * |", /struttura diversa/],
      ["riga di tabella senza il tag di allineamento", RIGA_TABELLA, "| Formazione | [G]Erogata a tutto il personale **operativo** * |", /tag di formattazione/],
      ["asterisco di proposta perso", RIGA_TABELLA, "| [C]Formazione | [G]Erogata a tutto il personale **operativo** |", /asterisco/],
      ["riga svuotata", RIGA_PARAGRAFO, "Sì.", /ridotta troppo/],
      ["riga vuota", RIGA_PARAGRAFO, "   ", /vuota/],
      ["più righe", RIGA_PARAGRAFO, "Prima riga.\nSeconda riga che aggiunge altro testo.", /più righe/],
      ["formula ancora presente", RIGA_PARAGRAFO, RIGA_PARAGRAFO, /contiene ancora/],
      ["titolo che perde la numerazione", "## 1.3 Servizi gratuiti per l'utenza", "## Servizi per l'utenza", /struttura diversa/],
      ["voce di elenco che diventa paragrafo", "- Report gratuito consegnato ogni mese.", "Report consegnato ogni mese.", /struttura diversa/],
    ];
    for (const [nome, originale, nuova, atteso_] of casi) {
      const motivo = validaRiformulazione(originale, nuova);
      atteso(`riformulazione scartata: ${nome}`, motivo !== null && atteso_.test(motivo), String(motivo));
    }
    atteso(
      "riformulazione accettata: titolo con la stessa numerazione",
      validaRiformulazione("## 1.3 Servizi gratuiti per l'utenza", "## 1.3 Servizi per l'utenza") === null,
      String(validaRiformulazione("## 1.3 Servizi gratuiti per l'utenza", "## 1.3 Servizi per l'utenza")),
    );
    atteso(
      "riformulazione accettata: paragrafo senza la clausola",
      validaRiformulazione(RIGA_PARAGRAFO, "Il controllo intermedio ha cadenza quindicinale.") === null,
      String(validaRiformulazione(RIGA_PARAGRAFO, "Il controllo intermedio ha cadenza quindicinale.")),
    );
  }

  // 4.6 Il modello restituisce una riformulazione scartata, poi una valida: la prima non entra mai nel testo.
  {
    const m = modello([
      (c) => new Map(c.righe.map((x) => [x.indice, "Sì."])),
      (c) => new Map(c.righe.map((x) => [x.indice, x.riga.replace(" senza oneri aggiuntivi di orario per l'Amministrazione", "").replace(" gratuitamente", "")])),
    ]);
    const r = await garantisciSenzaRiferimentiEconomici(SEZIONE, { titoloSezione: "1. Prova", context: ctx, riformula: m.riformula });
    atteso("riformulazione scartata al primo tentativo: non entra nel testo, la seconda sì", !r.testo.includes("Sì.") && !haRiferimentiEconomici(r.testo) && r.avvisi.length === 0, r.testo);
  }

  // 4.7 La chiamata al modello fallisce: nessuna eccezione, il documento esce con l'avviso.
  {
    const r = await garantisciSenzaRiferimentiEconomici(SEZIONE, {
      titoloSezione: "1. Prova",
      context: ctx,
      riformula: async () => {
        throw new Error("rete assente");
      },
    });
    atteso("errore del modello: nessuna eccezione, testo intatto e avvisi per tutte le formule", r.testo === SEZIONE && r.avvisi.length === 2, `avvisi ${r.avvisi.length}`);
  }

  // 4.8 Il modello non risponde per una riga: scartata, riprova.
  {
    const m = modello([() => new Map(), (c) => new Map(c.righe.map((x) => [x.indice, x.riga.replace(" senza oneri aggiuntivi di orario per l'Amministrazione", "").replace(" gratuitamente", "")]))]);
    const r = await garantisciSenzaRiferimentiEconomici(SEZIONE, { titoloSezione: "1. Prova", context: ctx, riformula: m.riformula });
    atteso("nessuna riformulazione al primo tentativo: il secondo la ottiene", r.avvisi.length === 0 && m.chiamate.length === 2 && /nessuna riformulazione/.test(m.chiamate[1].correzioni), m.chiamate[1]?.correzioni);
  }

  // --- 5. Il controllo di livello 1 usa lo stesso elenco ---
  {
    const fixture = (contenuto: string): FixtureRelazione => ({
      titolo: "Relazione di prova",
      sezioni: [{ titolo_sezione: "1. Prova", contenuto }],
      formattazione: { font: "Calibri", dimensioneCarattere: 12 },
      datiIntestazione: {},
      limitePagineTotale: 12,
    });
    const tabella = "| Attività | Frequenza |\n|---|---|\n| [C]Sopralluogo | [C]Mensile |";
    const conFormula = await eseguiControlliStrutturali(fixture(`## 1.1 Prova\n\nIl passaggio è svolto senza alcun aggravio di spesa per l'ente.\n\n${tabella}`));
    const pulito = await eseguiControlliStrutturali(fixture(`## 1.1 Prova\n\nIl passaggio è svolto con cadenza quindicinale.\n\n${tabella}`));
    atteso("livello 1: una formula indiretta nel testo fa fallire il controllo", conFormula.errori.some((e) => /Offerta economica: riferimento vietato/.test(e) && /aggravio di spesa/.test(e)), conFormula.errori.join(" / "));
    atteso("livello 1: lo stesso testo senza la formula non produce quell'errore", !pulito.errori.some((e) => /Offerta economica/.test(e)), pulito.errori.join(" / "));
  }

  // --- 6. Prompt e collegamento nei punti di produzione ---
  {
    atteso("prompt di riformulazione: segnaposto titolo e correzioni presenti", /\{TITOLO_SEZIONE\}/.test(ISTRUZIONI_RIFORMULAZIONE_SENZA_ECONOMICO) && /\{CORREZIONI\}/.test(ISTRUZIONI_RIFORMULAZIONE_SENZA_ECONOMICO), "");
    atteso("regola R8 ancora nel prompt di generazione", /\*\*R8 —/.test(REGOLE_OMNIA), "");

    const rel = leggi("src/lib/relazione-tecnica.ts");
    const inizioBozza = rel.indexOf("export async function generaBozzaSezione");
    const fineBozza = rel.indexOf("function normalizzaTitoloSezione");
    const bozza = rel.slice(inizioBozza, fineBozza);
    atteso(
      "collegamento: generaBozzaSezione applica la garanzia prima di salvare e di costruire il Word",
      bozza.includes("garantisciSenzaRiferimentiEconomici(") &&
        bozza.indexOf("garantisciSenzaRiferimentiEconomici(") < bozza.indexOf(".insert(") &&
        bozza.indexOf("garantisciSenzaRiferimentiEconomici(") < bozza.indexOf("buildDocxBuffer("),
      "",
    );
    atteso("collegamento: generaBozzaSezione restituisce gli avvisi", /avvisiEconomici: garanziaEconomica\.avvisi/.test(bozza), "");
    const inizioFinale = rel.indexOf("export async function componiRelazioneFinale");
    const finale = rel.slice(inizioFinale);
    atteso(
      "collegamento: componiRelazioneFinale applica la garanzia prima di comporre il documento",
      finale.includes("garantisciSenzaRiferimentiEconomici(") && finale.indexOf("garantisciSenzaRiferimentiEconomici(") < finale.indexOf("const contenutoFinale") && /avvisiEconomici\s*\}\s*;?\s*\n\}/.test(finale),
      "",
    );

    const chat = leggi("src/app/actions/gara-chat.ts");
    atteso("collegamento: gara-chat salva gli avvisi con il messaggio e li dice al modello", /avvisi_economici: avvisiEconomici/.test(chat) && chat.split("testoAvvisoEconomico(").length >= 3, "");
    atteso("collegamento: se la colonna manca l'avviso viaggia comunque nel testo del messaggio", /avvisi_economici/.test(chat) && /Colonna gara_messaggi\.avvisi_economici assente/.test(chat), "");

    const ui = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/chat-section.tsx");
    atteso("UI: avviso in rosso dentro la scheda del pulsante di scaricamento, con il punto esatto", /omnia-avviso-economico/.test(ui) && /role="alert"/.test(ui) && /a\.estratto/.test(ui) && ui.indexOf("omnia-avviso-economico") > ui.indexOf("Scarica documento"), "");
    const css = leggi("src/app/site-omnia-ai/omnia-ai.css");
    atteso("UI: stile rosso dell'avviso", /\.omnia-avviso-economico \{[^}]*var\(--rosso\)/.test(css), "");

    const migrazione = leggi("supabase/migrations/0070_gara_messaggi_avvisi_economici.sql");
    atteso("migrazione: colonna avvisi_economici aggiunta in modo idempotente", /add column if not exists avvisi_economici jsonb/i.test(migrazione), "");

    const l2 = leggi("scripts/verifica-livello2.ts");
    atteso("livello 2: la garanzia gira nei due punti di produzione e un avviso residuo è un errore", (l2.match(/garantisciSenzaRiferimentiEconomici\(/g) || []).length === 2 && /\[R8 offerta economica\]/.test(l2), "");
  }

  if (fallimenti.length > 0) {
    console.log(`\n${fallimenti.length} verifiche fallite`);
    process.exit(1);
  }
  console.log("\nAutotest della garanzia R8 (offerta economica): tutti i casi ok.");
}

main().catch((err) => {
  console.error("Errore inatteso nell'autotest della garanzia R8:", err);
  process.exit(1);
});
