// Verifica dei modelli delle email di Tender Intelligence (fase B4, decisione dell'utente del 19/11 §2–3; contratto di B2 versione 1).
// Solo funzioni pure e dati SINTETICI: nessuna rete, nessun database, nessun invio. Mutazioni: scripts/mutazioni-radar-b4-ui-email.mjs.
import fs from "node:fs";
import path from "node:path";
import {
  AVVERTENZA_EMAIL,
  DETTAGLIO_NON_DISPONIBILE,
  MASSIMO_GARE_RIEPILOGO,
  NOTA_AGGIUNTA_A_MANO,
  RIMANDO_AVVISO_UFFICIALE,
  TIPI_EVENTO,
  componiEmailRadar,
  type EventoModifica,
  type EventoRadar,
  type EventoScadenza,
} from "../src/lib/radar/email-modelli";
import { formattaScadenza, oraValida, riga, urlSicuro } from "../src/lib/radar/email-modelli/formato";
import {
  ANNULLAMENTO,
  ANTEPRIME,
  CASO_AGGIUNTA_A_MANO,
  CASO_CIG_ASSENTE,
  CASO_ORA_NON_NOTA,
  DOCUMENTI,
  MODIFICA_SCADENZA,
  NUOVE_OPPORTUNITA,
  NUOVE_OPPORTUNITA_MOTORE,
  PROROGA,
  RETTIFICA,
  RETTIFICA_SENZA_DETTAGLIO,
  SCADENZA_1,
  SCADENZA_10,
  SCADENZA_10_BETA,
  SCADENZA_5,
  SCADENZA_RAVVICINATA,
  TITOLARE_ALFA,
  TITOLARE_BETA,
  UFFICIO_GARE_ALFA,
  URL_PER_TE,
  URL_PREFERENZE,
  gara,
  scadenza,
} from "./dati-sintetici-email-radar-b4";

const RADICE = path.resolve(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const TUTTI: EventoRadar[] = [
  SCADENZA_10,
  SCADENZA_5,
  SCADENZA_1,
  SCADENZA_RAVVICINATA,
  RETTIFICA,
  RETTIFICA_SENZA_DETTAGLIO,
  PROROGA,
  MODIFICA_SCADENZA,
  DOCUMENTI,
  ANNULLAMENTO,
  NUOVE_OPPORTUNITA,
  NUOVE_OPPORTUNITA_MOTORE,
  CASO_ORA_NON_NOTA,
  CASO_CIG_ASSENTE,
  CASO_AGGIUNTA_A_MANO,
];

/** Il testo visibile dell'HTML (senza tag e senza entità), per cercare le frasi come le legge il destinatario. */
function visibile(html: string): string {
  return html
    .replace(/<\/?(a|span|strong)\b[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Tutti gli href dell'HTML. */
function collegamenti(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

function nomeCaso(e: EventoRadar): string {
  const extra = new Map<EventoRadar, string>([
    [CASO_ORA_NON_NOTA, " (ora non nota)"],
    [CASO_CIG_ASSENTE, " (CIG assente)"],
    [CASO_AGGIUNTA_A_MANO, " (aggiunta a mano)"],
    [RETTIFICA_SENZA_DETTAGLIO, " (senza dettaglio)"],
    [NUOVE_OPPORTUNITA_MOTORE, " (20 + 3 dal motore)"],
  ]);
  return `${e.tipo}${extra.get(e) ?? ""}`;
}

function errore(f: () => unknown): string {
  try {
    f();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

// ───── E1. Ogni tipo del contratto ha un caso di prova ─────

const coperti = new Set(TUTTI.map((e) => e.tipo));
for (const tipo of TIPI_EVENTO) atteso(`E1 tipo «${tipo}» coperto dalle prove`, coperti.has(tipo));

// ───── E2–E6. In ogni email: avvertenza, preferenze, oggetto pulito, niente «amministratore», i dati obbligatori ─────

for (const evento of TUTTI) {
  const { oggetto, html, testo } = componiEmailRadar(evento, TITOLARE_ALFA);
  const nome = nomeCaso(evento);
  const vis = visibile(html);
  atteso(`E2 ${nome}: avvertenza nell'HTML e nel testo`, vis.includes(AVVERTENZA_EMAIL) && testo.includes(AVVERTENZA_EMAIL));
  atteso(`E3 ${nome}: collegamento alle preferenze nell'HTML e nel testo`, collegamenti(html).includes(URL_PREFERENZE) && testo.includes(`Preferenze delle notifiche: ${URL_PREFERENZE}`));
  atteso(`E4 ${nome}: oggetto su una riga, non vuoto, al massimo 150 caratteri`, oggetto.length > 0 && oggetto.length <= 150 && !/[\r\n\t]/.test(oggetto));
  atteso(`E4 ${nome}: documento HTML completo, lingua italiana, tema chiaro`, html.startsWith("<!DOCTYPE html>") && html.includes('<html lang="it">') && html.includes('content="light"'));
  atteso(`E5 ${nome}: mai «amministratore» (titolare dell'impresa ≠ amministratori della console)`, !/amministrator/i.test(vis + testo));
  atteso(`E5 ${nome}: l'indirizzo email e l'id del destinatario non compaiono`, !(html + testo).includes(TITOLARE_ALFA.email) && !(html + testo).includes(`userId`));
  const gare = evento.tipo === "riepilogo_opportunita" ? evento.gare.slice(0, 3) : [evento.gara];
  for (const g of gare) {
    atteso(`E6 ${nome}: denominazione «${g.denominazione.slice(0, 28)}…»`, vis.includes(g.denominazione) && testo.includes(g.denominazione));
    atteso(`E6 ${nome}: collegamento alla scheda OMNIA AI`, collegamenti(html).includes(g.urlScheda) && testo.includes(g.urlScheda));
    atteso(`E6 ${nome}: data dell'ultimo aggiornamento rilevato`, vis.includes("19/11/2026 alle 08:42") && testo.includes("19/11/2026 alle 08:42"));
    atteso(`E6 ${nome}: scadenza`, testo.includes(formattaScadenza(g.scadenza)));
  }
  if (evento.tipo !== "riepilogo_opportunita") {
    const g = evento.gara;
    atteso(`E6 ${nome}: stazione appaltante`, vis.includes(g.stazioneAppaltante ?? "-") && testo.includes(`Stazione appaltante: ${g.stazioneAppaltante}`));
    if (g.tipoAvviso) atteso(`E6 ${nome}: tipo di avviso`, vis.includes(`Tipo di avviso ${g.tipoAvviso}`) && testo.includes(`Tipo di avviso: ${g.tipoAvviso}`));
    if (g.urlFonteUfficiale) atteso(`E6 ${nome}: collegamento alla fonte ufficiale`, collegamenti(html).includes(g.urlFonteUfficiale) && testo.includes(`Fonte ufficiale: ${g.urlFonteUfficiale}`));
    if (!g.aggiuntaAMano) {
      atteso(`E6 ${nome}: «Ultimo aggiornamento rilevato dalla fonte» (non «verificata»)`, testo.includes("Ultimo aggiornamento rilevato dalla fonte: 19/11/2026 alle 08:42") && !/verificata/i.test(testo));
    }
  }
}

// ───── E7. L'ora della scadenza: solo se indicata, mai presunta ─────

{
  const { html, testo } = componiEmailRadar(CASO_ORA_NON_NOTA, TITOLARE_ALFA);
  const vis = visibile(html);
  const senzaAggiornamento = (s: string) => s.replace(/19\/11\/2026 alle 08:42/g, "");
  atteso("E7 ora non nota: «ora non indicata dalla fonte» nell'HTML", vis.includes("mercoledì 25 novembre 2026 ora non indicata dalla fonte: controlla l'orario nel bando"));
  atteso("E7 ora non nota: «ora non indicata dalla fonte» nel testo", testo.includes("SCADENZA PER LE OFFERTE: mercoledì 25 novembre 2026 · ora non indicata dalla fonte"));
  atteso("E7 ora non nota: nessun orario scritto (HTML e testo)", !/\b\d{1,2}[:.]\d{2}\b/.test(senzaAggiornamento(vis)) && !/\b\d{1,2}[:.]\d{2}\b/.test(senzaAggiornamento(testo)));
  atteso("E7 ora non nota: mai «23:59», mezzanotte o fine giornata", !/23[:.]59|24[:.]00|mezzanotte|fine giornata/i.test(vis + testo));
}
{
  const { html, testo } = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  atteso("E7 ora nota: «lunedì 30 novembre 2026, ore 12:00» in HTML e testo", visibile(html).includes("lunedì 30 novembre 2026, ore 12:00") && testo.includes("lunedì 30 novembre 2026, ore 12:00"));
}
{
  const conOra = (ora: string | null, giorno = "2026-11-30"): string =>
    componiEmailRadar({ ...SCADENZA_10, gara: { ...SCADENZA_10.gara, scadenza: { giorno, ora, istante: null, origine: "fonte" } } }, TITOLARE_ALFA).testo;
  atteso("E7 ora 23:59 indicata dalla fonte: scritta così com'è (non è una presunzione)", conOra("23:59").includes("ore 23:59"));
  for (const sbagliata of ["24:00", "23:60", "9:30", "12.00", "", " 12:00", "12:00:00", "ore 12"]) {
    const t = conOra(sbagliata);
    atteso(`E7 ora non valida «${sbagliata}»: nessun orario, «ora non indicata dalla fonte»`, t.includes("ora non indicata dalla fonte") && !/ore \d/.test(t));
  }
  for (const giorno of ["2026-02-30", "2026-13-01", "30/11/2026", "2026-11-30T12:00", ""]) {
    const t = conOra("12:00", giorno);
    atteso(`E7 giorno non valido «${giorno}»: «non indicata dalla fonte», ora non scritta`, t.includes("SCADENZA PER LE OFFERTE: non indicata dalla fonte") && !t.includes("ore 12:00"));
  }
  const senzaScadenza = componiEmailRadar({ ...RETTIFICA, gara: { ...RETTIFICA.gara, scadenza: null } }, TITOLARE_ALFA).testo;
  atteso("E7 gara senza scadenza (rettifica): «non indicata dalla fonte», nessuna data inventata", senzaScadenza.includes("Scadenza per le offerte: non indicata dalla fonte"));
  atteso("E7 oraValida accetta solo HH:MM", oraValida("00:00") === "00:00" && oraValida("23:59") === "23:59" && oraValida("7:05") === null && oraValida(null) === null);
  const casi: [string, string][] = [
    ["2026-03-29", "domenica 29 marzo 2026"],
    ["2026-10-25", "domenica 25 ottobre 2026"],
    ["2026-11-26", "giovedì 26 novembre 2026"],
    ["2027-01-01", "venerdì 1 gennaio 2027"],
  ];
  for (const [giorno, atteso_] of casi) atteso(`E7 giorno ${giorno} (anche nei cambi d'ora) → «${atteso_}»`, formattaScadenza(scadenza(giorno, null)).startsWith(atteso_));
  const impresa = componiEmailRadar(CASO_AGGIUNTA_A_MANO, TITOLARE_ALFA).testo;
  atteso("E7 gara aggiunta senza ora: «ora non indicata nella gara aggiunta» (non «dalla fonte»)", impresa.includes("mercoledì 25 novembre 2026 · ora non indicata nella gara aggiunta") && !impresa.includes("ora non indicata dalla fonte"));
}

// ───── E8. Escape HTML di ogni testo variabile, collegamenti solo http(s) ─────

{
  const VELENO = `<script>alert("x")</script><img src=x onerror=alert(1)>&'"`;
  const v = (s: string) => `${s} ${VELENO}`;
  const garaVelenosa = gara(1, {
    denominazione: v("Oggetto"),
    stazioneAppaltante: v("Stazione"),
    cig: [v("CIG")],
    tipoAvviso: v("Tipo"),
    fonti: [{ fonte: v("f"), nome: v("Fonte") }],
    luogo: v("Luogo"),
    lottiConScadenzeDiverse: [{ numero: v("1"), titolo: v("Lotto"), cig: v("CIGL"), scadenza: scadenza("2026-12-01", null) }],
  });
  const eventi: EventoRadar[] = [
    {
      ...RETTIFICA,
      nomeImpresa: v("Impresa"),
      gara: garaVelenosa,
      modifiche: [{ campo: "importo", etichetta: v("Campo"), prima: v("Prima"), dopo: v("Dopo") }],
      evidenza: { ...RETTIFICA.evidenza, nomeFonte: v("NomeFonte"), avvisoId: v("Avviso"), motivoFonte: v("Motivo") },
    },
    { ...SCADENZA_10, gara: { ...garaVelenosa, scadenza: scadenza("2026-11-30", null) } },
    { ...NUOVE_OPPORTUNITA, gare: [{ ...NUOVE_OPPORTUNITA.gare[0], ...garaVelenosa, perche: [v("Perché")] }] },
  ];
  for (const evento of eventi) {
    const { html, oggetto } = componiEmailRadar(evento, { ...TITOLARE_ALFA, nome: v("Nome") });
    // l'attributo resta testo innocuo («onerror=» dentro un &lt;img…&gt; già neutralizzato): conta che non nasca nessun tag
    atteso(`E8 ${evento.tipo}: nessun tag iniettato`, !/<script|<img/i.test(html) && !/<[^>]*onerror=/i.test(html));
    atteso(`E8 ${evento.tipo}: i testi compaiono con l'escape`, html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;") && html.includes("&amp;&#39;&quot;"));
    atteso(`E8 ${evento.tipo}: oggetto su una riga`, !/[\r\n]/.test(oggetto));
  }
  const pericolosi = ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//omnia-ai.it/x", 'https://a.example/x"onmouseover="alert(1)', "https://a.example/ x", "https://a.example/\nx", " javascript:alert(1)"];
  for (const url of pericolosi) {
    const g = gara(1, { urlScheda: url, urlFonteUfficiale: url });
    const casi: EventoRadar[] = [
      { ...DOCUMENTI, gara: g, evidenza: { ...DOCUMENTI.evidenza, avvisoUrl: url } },
      { ...NUOVE_OPPORTUNITA, urlPerTe: url, gare: [{ ...NUOVE_OPPORTUNITA.gare[0], ...g }] },
    ];
    for (const evento of casi) {
      const { html, testo } = componiEmailRadar(evento, { ...TITOLARE_ALFA, urlPreferenze: url });
      const hrefs = collegamenti(html);
      atteso(`E8 ${evento.tipo}, collegamento ${JSON.stringify(url)}: mai negli href`, hrefs.every((h) => /^https?:\/\/[^\s"'<>]+$/.test(h)) && !hrefs.some((h) => h.includes("onmouseover")));
      atteso(`E8 ${evento.tipo}, collegamento ${JSON.stringify(url)}: mai nel testo`, !/javascript:|data:text|vbscript:/i.test(testo));
      atteso(`E8 ${evento.tipo}, collegamento ${JSON.stringify(url)}: resta la frase per trovare le preferenze`, visibile(html).includes("preferenze delle notifiche della tua area riservata"));
    }
  }
  atteso("E8 urlSicuro: https ammesso, il resto no", urlSicuro("https://a.example/x?y=1&z=2") === "https://a.example/x?y=1&z=2" && urlSicuro("ftp://a.example") === null && urlSicuro(null) === null);
}

// ───── E9. Oggetto: nessun a capo né carattere di controllo (iniezione di intestazioni) ─────

{
  const evento: EventoRadar = { ...SCADENZA_1, gara: { ...SCADENZA_1.gara, denominazione: "Gara\r\nBcc: vittima@example.com\r\n\r\nTesto\u0000\u0007 finale" } };
  const { oggetto, testo } = componiEmailRadar(evento, TITOLARE_ALFA);
  atteso("E9 oggetto senza a capo né controlli", !/[\u0000-\u001f\u007f]/.test(oggetto), JSON.stringify(oggetto));
  atteso("E9 il testo semplice non porta caratteri di controllo (salvo l'a capo delle righe)", !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(testo));
  const lungo = componiEmailRadar({ ...SCADENZA_1, gara: { ...SCADENZA_1.gara, denominazione: "X".repeat(400) } }, TITOLARE_ALFA).oggetto;
  atteso("E9 oggetto lungo accorciato con «…»", lungo.length <= 150 && lungo.endsWith("…"));
  atteso("E9 riga() toglie i controlli", riga("a\r\nb\tc\u0000d") === "a b c d");
}

// ───── E10. CIG: riga presente solo se c'è ─────

{
  const { html, testo } = componiEmailRadar(CASO_CIG_ASSENTE, TITOLARE_ALFA);
  atteso("E10 CIG assente: nessuna riga CIG (HTML e testo)", !/\bCIG\b/.test(visibile(html)) && !/\bCIG\b/.test(testo));
  const uno = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  atteso("E10 un CIG: «CIG A0SINT0001»", visibile(uno.html).includes("CIG A0SINT0001") && uno.testo.includes("CIG: A0SINT0001"));
  const piu = componiEmailRadar(SCADENZA_5, TITOLARE_ALFA);
  atteso("E10 più lotti: tutti i CIG", piu.testo.includes("CIG: A0SINT0021, A0SINT0022, A0SINT0023"));
  const vuoti = componiEmailRadar({ ...SCADENZA_10, gara: { ...SCADENZA_10.gara, cig: ["", "  "] } }, TITOLARE_ALFA).testo;
  atteso("E10 CIG vuoti trattati come assenti", !/\bCIG\b/.test(vuoti));
}

// ───── E11. Rettifiche, proroghe, documenti, annullamento: solo ciò che dicono modifiche ed evidenza ─────

{
  const r = componiEmailRadar(RETTIFICA, TITOLARE_ALFA);
  const vis = visibile(r.html);
  atteso("E11 rettifica: ogni cambiamento con prima e ora (HTML)", vis.includes("Importo a base di gara Prima: 1.250.000,00 € Ora: 1.310.000,00 €") && vis.includes("Numero dei lotti Prima: 2 Ora: 3"));
  atteso("E11 rettifica: ogni cambiamento con prima e ora (testo)", r.testo.includes("- Importo a base di gara\n  Prima: 1.250.000,00 €\n  Ora: 1.310.000,00 €"));
  atteso("E11 rettifica: l'avviso con fonte, data e collegamento", vis.includes("Fonte del cambiamento: avviso 000005-2026 su TED (Gazzetta UE), pubblicato il 18 novembre 2026.") && collegamenti(r.html).includes("https://ted.example/avvisi/000005-2026"));
  atteso("E11 rettifica: motivo della fonte e affidabilità", r.testo.includes("Motivo indicato dalla fonte: Correzione da parte dell'amministrazione.") && r.testo.includes("Avviso di modifica pubblicato dalla fonte."));
  atteso("E11 rettifica: quando OMNIA AI l'ha rilevata (ora di Roma)", r.testo.includes("Rilevato da OMNIA AI il 19/11/2026 alle 06:10."));
  const s = componiEmailRadar(RETTIFICA_SENZA_DETTAGLIO, TITOLARE_ALFA);
  atteso("E11 avviso ufficiale senza campi cambiati: rimanda all'avviso (testo e HTML)", s.testo.includes(RIMANDO_AVVISO_UFFICIALE) && visibile(s.html).includes(RIMANDO_AVVISO_UFFICIALE));
  atteso("E11 avviso ufficiale senza campi cambiati: nessun cambiamento elencato", !/Prima:|Ora:/.test(s.testo) && !/Prima:|Ora:/.test(visibile(s.html)));
  const confronto = componiEmailRadar({ ...RETTIFICA_SENZA_DETTAGLIO, evidenza: { ...RETTIFICA_SENZA_DETTAGLIO.evidenza, affidabilita: "confronto_versioni" } }, TITOLARE_ALFA);
  atteso("E11 nessuna modifica e nessun avviso ufficiale: «dettaglio non disponibile»", confronto.testo.includes(DETTAGLIO_NON_DISPONIBILE) && !confronto.testo.includes(RIMANDO_AVVISO_UFFICIALE));
  const nulli = componiEmailRadar({ ...RETTIFICA, modifiche: [{ campo: "oggetto", etichetta: "Oggetto", prima: null, dopo: "Nuovo oggetto" }] }, TITOLARE_ALFA).testo;
  atteso("E11 valore precedente assente: «non indicato», niente di inventato", nulli.includes("Prima: non indicato\n  Ora: Nuovo oggetto"));
  const p = componiEmailRadar(PROROGA, TITOLARE_ALFA);
  atteso("E11 proroga: nuova e vecchia scadenza con le ore della fonte", p.testo.includes("NUOVA SCADENZA PER LE OFFERTE: mercoledì 9 dicembre 2026, ore 12:00\nScadenza precedente: mercoledì 25 novembre 2026, ore 12:00"));
  atteso("E11 proroga: la scadenza non è ripetuta tra gli altri cambiamenti", !p.testo.includes("Scadenza per la presentazione delle offerte") && !p.testo.includes("ALTRI CAMBIAMENTI"));
  atteso("E11 proroga: confronto tra versioni dichiarato", p.testo.includes("Cambiamento rilevato confrontando due versioni ufficiali della gara pubblicate dalla fonte."));
  atteso("E11 proroga: oggetto «Scadenza prorogata» dal tipo", p.oggetto.startsWith("Scadenza prorogata:"));
  const m = componiEmailRadar(MODIFICA_SCADENZA, TITOLARE_ALFA);
  atteso("E11 modifica della scadenza: «modificata», mai «prorogata» o «anticipata»", m.oggetto.startsWith("Scadenza modificata:") && !/prorogat|anticipat/i.test(m.testo + visibile(m.html)));
  atteso("E11 modifica della scadenza: senza ora resta «ora non indicata»", m.testo.includes("NUOVA SCADENZA PER LE OFFERTE: venerdì 27 novembre 2026 · ora non indicata dalla fonte\nScadenza precedente: venerdì 4 dicembre 2026 · ora non indicata dalla fonte"));
  atteso("E11 evidenza senza avviso né collegamento: «avviso ufficiale», nessun link inventato", m.testo.includes("Fonte del cambiamento: avviso ufficiale su Sintel (ARIA Lombardia), pubblicato il 18 novembre 2026.") && !m.testo.includes("Avviso: http"));
  const altri = componiEmailRadar({ ...PROROGA, modifiche: [...PROROGA.modifiche, { campo: "importo", etichetta: "Importo a base di gara", prima: "100", dopo: "120" }] }, TITOLARE_ALFA).testo;
  atteso("E11 proroga con altri cambiamenti: elencati a parte", altri.includes("ALTRI CAMBIAMENTI INDICATI DALLA FONTE\n- Importo a base di gara\n  Prima: 100\n  Ora: 120"));
  const d = componiEmailRadar(DOCUMENTI, TITOLARE_ALFA);
  atteso("E11 documenti: elenco con prima e ora", d.testo.includes("DOCUMENTI PUBBLICATI O SOSTITUITI\n- Capitolato speciale d'appalto\n  Prima: versione del 2 novembre 2026\n  Ora: versione 2 del 17 novembre 2026"));
  const a = componiEmailRadar(ANNULLAMENTO, TITOLARE_ALFA);
  atteso("E11 annullamento: titolo, motivo della fonte, nessun cambiamento inventato", a.oggetto.startsWith("Gara annullata:") && a.testo.includes("Motivo indicato dalla fonte: Procedura annullata in autotutela.") && !/Prima:|Ora:/.test(a.testo));
  atteso("E11 annullamento: non dice «non risultano cambiati»", !a.testo.includes(RIMANDO_AVVISO_UFFICIALE));
}

// ───── E12. Riepilogo delle nuove opportunità: al massimo 20 gare elencate ─────

{
  for (const evento of [NUOVE_OPPORTUNITA, NUOVE_OPPORTUNITA_MOTORE]) {
    const nome = nomeCaso(evento);
    const { oggetto, html, testo } = componiEmailRadar(evento, TITOLARE_ALFA);
    const tutte = NUOVE_OPPORTUNITA.gare;
    const nelTesto = tutte.filter((g) => testo.includes(g.denominazione)).length;
    const nellHtml = tutte.filter((g) => collegamenti(html).includes(g.urlScheda)).length;
    atteso(`E12 ${nome}: 20 gare nel testo`, nelTesto === MASSIMO_GARE_RIEPILOGO, String(nelTesto));
    atteso(`E12 ${nome}: 20 gare nell'HTML`, nellHtml === MASSIMO_GARE_RIEPILOGO, String(nellHtml));
    atteso(`E12 ${nome}: le altre 3 annunciate`, testo.includes("E altre 3 gare in «Per te».") && visibile(html).includes("E altre 3 gare in «Per te»."));
    atteso(`E12 ${nome}: oggetto con il totale (23)`, oggetto === "23 nuove gare per te", oggetto);
    atteso(`E12 ${nome}: collegamento a «Per te»`, collegamenti(html).includes(URL_PER_TE) && testo.includes(`Apri «Per te» in OMNIA AI: ${URL_PER_TE}`));
    atteso(`E12 ${nome}: il perché della pertinenza`, testo.includes("nel tuo profilo: Pulizia · Lombardia") && visibile(html).includes("nel tuo profilo: Pulizia · Lombardia"));
  }
  const una = componiEmailRadar({ ...NUOVE_OPPORTUNITA, gare: NUOVE_OPPORTUNITA.gare.slice(0, 1) }, TITOLARE_ALFA);
  atteso("E12 singolare: «1 nuova gara per te», nessuna «altra»", una.oggetto === "1 nuova gara per te" && !una.testo.includes("E altre") && !una.testo.includes("un'altra"));
  const negativo = componiEmailRadar({ ...NUOVE_OPPORTUNITA, gare: NUOVE_OPPORTUNITA.gare.slice(0, 2), altreNonIncluse: -4 }, TITOLARE_ALFA);
  atteso("E12 «altre» negativo ignorato", negativo.oggetto === "2 nuove gare per te");
  const oraIgnota = NUOVE_OPPORTUNITA.gare[3];
  atteso("E12 nel riepilogo l'ora non nota resta «non indicata»", oraIgnota.scadenza?.ora === null && componiEmailRadar(NUOVE_OPPORTUNITA, TITOLARE_ALFA).testo.includes(`Scadenza: ${formattaScadenza(oraIgnota.scadenza)}`));
}

// ───── E13. Separazione tra imprese e contratto rispettato ─────

{
  atteso("E13 evento dell'impresa Beta per un destinatario di Alfa: errore, nessuna email", errore(() => componiEmailRadar(SCADENZA_10_BETA, TITOLARE_ALFA)).includes("non appartiene all'impresa"));
  atteso("E13 impresa vuota da entrambe le parti: errore (mai «uguali perché vuote»)", errore(() => componiEmailRadar({ ...SCADENZA_10, impresaId: "" }, { ...TITOLARE_ALFA, impresaId: "" })).includes("non appartiene all'impresa"));
  const incoerente = { ...SCADENZA_10, categoria: "rettifiche" } as unknown as EventoRadar;
  atteso("E13 categoria incoerente col tipo: errore (le preferenze per categoria non si aggirano)", errore(() => componiEmailRadar(incoerente, TITOLARE_ALFA)).includes("tipo o categoria"));
  const sconosciuto = { ...SCADENZA_10, tipo: "toString" } as unknown as EventoRadar;
  atteso("E13 tipo sconosciuto: errore", errore(() => componiEmailRadar(sconosciuto, TITOLARE_ALFA)).includes("tipo o categoria"));
  componiEmailRadar(SCADENZA_10_BETA, TITOLARE_BETA);
  const alfa = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  const tutto = alfa.oggetto + alfa.html + alfa.testo;
  atteso("E13 nessun dato di Beta nell'email di Alfa composta dopo", !/RISERVATA-BETA|BETA000001|Beta Costruzioni|be7a|Paola/.test(tutto));
  atteso("E13 deterministica: stessa email byte per byte a parità di dati", JSON.stringify(componiEmailRadar(SCADENZA_10, TITOLARE_ALFA)) === JSON.stringify(alfa));
  const prima = JSON.stringify(TUTTI);
  for (const e of TUTTI) componiEmailRadar(e, UFFICIO_GARE_ALFA);
  atteso("E13 gli eventi non vengono modificati", JSON.stringify(TUTTI) === prima);
}

// ───── E14. Destinatario: titolare dell'impresa o Ufficio Gare, testi distinti ─────

{
  const t = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  const u = componiEmailRadar(SCADENZA_10, UFFICIO_GARE_ALFA);
  atteso("E14 titolare: «sei il titolare dell'impresa Alfa Servizi Sintetici S.r.l.»", t.testo.includes("perché sei il titolare dell'impresa Alfa Servizi Sintetici S.r.l. in OMNIA AI"));
  atteso("E14 Ufficio Gare: «fai parte dell'Ufficio Gare dell'impresa …»", u.testo.includes("perché fai parte dell'Ufficio Gare dell'impresa Alfa Servizi Sintetici S.r.l. in OMNIA AI"));
  atteso("E14 saluto col nome", t.testo.includes("Buongiorno Laura,") && u.testo.includes("Buongiorno Marco,"));
  atteso("E14 senza nome: «Buongiorno,»", componiEmailRadar(SCADENZA_10, { ...TITOLARE_ALFA, nome: null }).testo.includes("\nBuongiorno,\n"));
  atteso("E14 impresa senza nome: frase senza buchi", componiEmailRadar({ ...SCADENZA_10, nomeImpresa: null }, UFFICIO_GARE_ALFA).testo.includes("perché fai parte dell'Ufficio Gare dell'impresa in OMNIA AI."));
}

// ───── E15. Oggetti attesi per ogni tipo ─────

{
  const oggetti: [EventoRadar, string][] = [
    [SCADENZA_10, "Scadenza tra 10 giorni: Servizio di pulizia"],
    [SCADENZA_5, "Scadenza tra 5 giorni: Lavori di manutenzione"],
    [SCADENZA_1, "Scadenza domani: Fornitura di arredi"],
    [SCADENZA_RAVVICINATA, "Scadenza tra 2 giorni: Servizio di ristorazione"],
    [RETTIFICA, "Rettifica: Servizio di pulizia"],
    [PROROGA, "Scadenza prorogata: Servizio di manutenzione del verde"],
    [MODIFICA_SCADENZA, "Scadenza modificata: Servizio di trasporto disabili"],
    [DOCUMENTI, "Nuovi documenti di gara: Servizio di vigilanza"],
    [ANNULLAMENTO, "Gara annullata: Servizio di gestione del centro estivo"],
  ];
  for (const [evento, inizio] of oggetti) {
    const o = componiEmailRadar(evento, TITOLARE_ALFA).oggetto;
    atteso(`E15 oggetto ${evento.tipo}: «${inizio}…»`, o.startsWith(inizio), o);
  }
  const ravvicinata = (giorni: number) => componiEmailRadar({ ...SCADENZA_RAVVICINATA, giorniMancanti: giorni } as EventoScadenza, TITOLARE_ALFA).oggetto;
  atteso("E15 ravvicinata a 0 giorni: «Scadenza oggi»", ravvicinata(0).startsWith("Scadenza oggi:"));
  atteso("E15 ravvicinata a 1 giorno: «Scadenza domani»", ravvicinata(1).startsWith("Scadenza domani:"));
  atteso("E15 ravvicinata con giorni non validi: «Scadenza a breve»", ravvicinata(Number.NaN).startsWith("Scadenza a breve:"));
  const promemoria10 = componiEmailRadar({ ...SCADENZA_10, giorniMancanti: 7 }, TITOLARE_ALFA).oggetto;
  atteso("E15 promemoria a 10 giorni: il testo segue il tipo, non un conteggio diverso", promemoria10.startsWith("Scadenza tra 10 giorni:"));
}

// ───── E16. I modelli sono puri: nessun database, rete, ambiente od orologio; nessun «23:59» ─────

{
  const cartella = path.join(RADICE, "src/lib/radar/email-modelli");
  const file = fs.readdirSync(cartella).filter((f) => f.endsWith(".ts"));
  atteso("E16 file dei modelli presenti", ["componi.ts", "contratto.ts", "formato.ts", "index.ts"].every((f) => file.includes(f)), file.join(", "));
  for (const f of file) {
    const sorgente = fs.readFileSync(path.join(cartella, f), "utf8");
    const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    atteso(`E16 ${f}: nessun database, rete, server, invio, ambiente od orologio`, !/supabase|from "@\/lib\/email"|resend|server-only|next\/|node:|fetch\(|process\.env|Date\.now|new Date\(\)|Math\.random/i.test(codice));
    const importati = [...codice.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    atteso(`E16 ${f}: importa solo i modelli e l'escape condiviso`, importati.every((i) => i.startsWith("./") || i === "@/lib/omnia-ai-email-eventi-calcoli"), importati.join(", "));
    atteso(`E16 ${f}: nessun «23:59»`, !codice.includes("23:59"));
    atteso(`E16 ${f}: righe LF, niente CRLF`, !sorgente.includes("\r\n"));
  }
}

// ───── E17. Lotti con scadenze diverse ─────

{
  const { html, testo } = componiEmailRadar(SCADENZA_5, TITOLARE_ALFA);
  atteso("E17 lotti: titoletto e lotto con CIG e scadenza (testo)", testo.includes("LOTTI CON UNA SCADENZA DIVERSA\n- Lotto 3 — Zona montana (CIG A0SINT0023)\n  Scadenza: mercoledì 2 dicembre 2026 · ora non indicata dalla fonte"));
  atteso("E17 lotti: anche nell'HTML", visibile(html).includes("Lotto 3 — Zona montana CIG A0SINT0023 Scadenza: mercoledì 2 dicembre 2026 · ora non indicata dalla fonte"));
  atteso("E17 senza lotti diversi: nessun titoletto", !componiEmailRadar(SCADENZA_10, TITOLARE_ALFA).testo.includes("LOTTI"));
}

// ───── E18. Gara aggiunta a mano dall'impresa ─────

{
  const { html, testo } = componiEmailRadar(CASO_AGGIUNTA_A_MANO, TITOLARE_ALFA);
  atteso("E18 aggiunta a mano: nota sui dati inseriti dall'impresa (testo e HTML)", testo.includes(NOTA_AGGIUNTA_A_MANO) && visibile(html).includes(NOTA_AGGIUNTA_A_MANO));
  atteso("E18 aggiunta a mano: nessun collegamento a una fonte ufficiale", !testo.includes("Fonte ufficiale:") && !visibile(html).includes("Oppure vai direttamente alla fonte ufficiale"));
  atteso("E18 aggiunta a mano: «Ultimo aggiornamento della gara aggiunta»", testo.includes("Ultimo aggiornamento della gara aggiunta: 19/11/2026 alle 08:42"));
  atteso("E18 aggiunta a mano: introduzione corretta", testo.includes("Promemoria per una gara aggiunta a mano dall'impresa"));
  atteso("E18 gara da fonte: nessuna nota «aggiunta a mano»", !componiEmailRadar(SCADENZA_10, TITOLARE_ALFA).testo.includes(NOTA_AGGIUNTA_A_MANO));
}

// ───── E19. Le anteprime per l'utente si compongono tutte ─────

for (const a of ANTEPRIME) atteso(`E19 anteprima «${a.file}» composta`, errore(() => componiEmailRadar(a.evento, a.destinatario)) === "");

// i tipi dei casi di prova restano quelli del contratto (aiuta il controllo dei tipi a cogliere un contratto cambiato)
const _controlloTipi: [EventoScadenza, EventoModifica] = [SCADENZA_10, RETTIFICA];
void _controlloTipi;

console.log(fallimenti.length ? `\n${fallimenti.length} controlli FALLITI` : "\nTutti i controlli dei modelli delle email B4 sono passati.");
process.exit(fallimenti.length ? 1 : 0);
