// Verifica dei modelli delle email di Tender Intelligence (fase B4, decisione dell'utente del 19/11 §2–3). Solo funzioni pure e dati
// SINTETICI: nessuna rete, nessun database, nessun invio. Le prove di mutazione sono in scripts/mutazioni-radar-b4-ui-email.mjs.
import fs from "node:fs";
import path from "node:path";
import { AVVERTENZA_EMAIL, CATEGORIA_EMAIL, MASSIMO_GARE_RIEPILOGO, componiEmailRadar, type EventoEmailRadar, type TipoEmailRadar } from "../src/lib/radar/email-modelli";
import { formattaScadenza, oraValida, urlSicuro, riga } from "../src/lib/radar/email-modelli/formato";
import {
  ANTEPRIME,
  CASO_CIG_ASSENTE,
  CASO_ORA_NON_NOTA,
  DOCUMENTI,
  NUOVE_OPPORTUNITA,
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
  URL_PREFERENZE,
  gara,
} from "./dati-sintetici-email-radar-b4";

const RADICE = path.resolve(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}

const TUTTI: EventoEmailRadar[] = [SCADENZA_10, SCADENZA_5, SCADENZA_1, SCADENZA_RAVVICINATA, RETTIFICA, RETTIFICA_SENZA_DETTAGLIO, PROROGA, DOCUMENTI, NUOVE_OPPORTUNITA, CASO_ORA_NON_NOTA, CASO_CIG_ASSENTE];
const TIPI_COPERTI = new Set(TUTTI.map((e) => e.tipo));

/** Il testo visibile dell'HTML (senza tag e senza entità), per cercare parole come le legge il destinatario. */
function visibile(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
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

// ───── E1. Ogni tipo di evento ha un modello, e ogni email ha avvertenza, preferenze e i dati obbligatori ─────

for (const tipo of Object.keys(CATEGORIA_EMAIL) as TipoEmailRadar[]) atteso(`E1 tipo «${tipo}» coperto dalle prove`, TIPI_COPERTI.has(tipo));

for (const evento of TUTTI) {
  const { oggetto, html, testo } = componiEmailRadar(evento, TITOLARE_ALFA);
  const nome = `${evento.tipo}${evento === CASO_ORA_NON_NOTA ? " (ora non nota)" : evento === CASO_CIG_ASSENTE ? " (CIG assente)" : evento === RETTIFICA_SENZA_DETTAGLIO ? " (senza dettaglio)" : ""}`;
  const vis = visibile(html);
  atteso(`E2 ${nome}: avvertenza nell'HTML`, vis.includes(AVVERTENZA_EMAIL));
  atteso(`E2 ${nome}: avvertenza nel testo`, testo.includes(AVVERTENZA_EMAIL));
  atteso(`E3 ${nome}: collegamento alle preferenze nell'HTML`, collegamenti(html).includes(URL_PREFERENZE));
  atteso(`E3 ${nome}: collegamento alle preferenze nel testo`, testo.includes(URL_PREFERENZE));
  atteso(`E4 ${nome}: oggetto su una riga, non vuoto, al massimo 150 caratteri`, oggetto.length > 0 && oggetto.length <= 150 && !/[\r\n\t]/.test(oggetto));
  atteso(`E4 ${nome}: documento HTML completo, lingua italiana, tema chiaro`, html.startsWith("<!DOCTYPE html>") && html.includes('<html lang="it">') && html.includes('content="light"'));
  atteso(`E5 ${nome}: mai «amministratore» nei testi (titolare dell'impresa ≠ amministratori della console)`, !/amministrator/i.test(vis) && !/amministrator/i.test(testo));
  const gare = evento.tipo === "nuove_opportunita" ? evento.gare.slice(0, MASSIMO_GARE_RIEPILOGO) : [evento.gara];
  for (const g of gare.slice(0, 3)) {
    atteso(`E6 ${nome}: denominazione «${g.oggetto.slice(0, 30)}…» in HTML e testo`, vis.includes(g.oggetto) && testo.includes(g.oggetto));
    atteso(`E6 ${nome}: collegamento alla scheda OMNIA AI`, collegamenti(html).includes(g.urlScheda) && testo.includes(g.urlScheda));
    atteso(`E6 ${nome}: data dell'ultima verifica`, vis.includes("19/11/2026 alle 08:42") && testo.includes("19/11/2026 alle 08:42"));
  }
  if (evento.tipo !== "nuove_opportunita") {
    const g = evento.gara;
    atteso(`E6 ${nome}: stazione appaltante`, vis.includes(g.stazioneAppaltante ?? "") && testo.includes(g.stazioneAppaltante ?? ""));
    atteso(`E6 ${nome}: tipo di avviso`, vis.includes(`Tipo di avviso ${g.tipoAvviso}`) && testo.includes(`Tipo di avviso: ${g.tipoAvviso}`));
    atteso(`E6 ${nome}: collegamento alla fonte ufficiale`, collegamenti(html).includes(g.urlFonte ?? "-") && testo.includes(`Fonte ufficiale: ${g.urlFonte}`));
    atteso(`E6 ${nome}: scadenza`, testo.includes(formattaScadenza(g.scadenza)));
  }
}

// ───── E7. L'ora della scadenza: solo se indicata dalla fonte, mai presunta ─────

{
  const { html, testo } = componiEmailRadar(CASO_ORA_NON_NOTA, TITOLARE_ALFA);
  const vis = visibile(html);
  atteso("E7 ora non nota: «ora non indicata dalla fonte» nell'HTML", vis.includes("ora non indicata dalla fonte"));
  atteso("E7 ora non nota: «ora non indicata dalla fonte» nel testo", testo.includes("mercoledì 25 novembre 2026 · ora non indicata dalla fonte"));
  atteso("E7 ora non nota: nessun orario scritto nell'HTML", !/\bore \d{1,2}[:.]\d{2}\b/.test(vis) && !/\b\d{1,2}:\d{2}\b/.test(vis.replace("08:42", "")));
  atteso("E7 ora non nota: nessun orario scritto nel testo", !/\bore \d{1,2}[:.]\d{2}\b/.test(testo) && !/\b\d{1,2}:\d{2}\b/.test(testo.replace("08:42", "")));
  atteso("E7 ora non nota: mai «23:59» né mezzanotte", !/23[:.]59|24[:.]00|mezzanotte|fine giornata/i.test(vis + testo));
}
{
  const { html, testo } = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  atteso("E7 ora nota: «lunedì 30 novembre 2026, ore 12:00» in HTML e testo", visibile(html).includes("lunedì 30 novembre 2026, ore 12:00") && testo.includes("lunedì 30 novembre 2026, ore 12:00"));
}
{
  // un'ora scritta dalla fonte vale anche se è 23:59 (non è una presunzione), un'ora non valida non si scrive
  const conOra = (ora: string | null) => componiEmailRadar({ ...SCADENZA_10, gara: gara(1, { scadenza: { giorno: "2026-11-30", ora } }) }, TITOLARE_ALFA).testo;
  atteso("E7 ora 23:59 indicata dalla fonte: scritta così com'è", conOra("23:59").includes("ore 23:59"));
  for (const sbagliata of ["24:00", "23:60", "9:30", "12.00", "", " 12:00", "12:00:00", "ore 12"]) {
    const t = conOra(sbagliata);
    atteso(`E7 ora non valida «${sbagliata}»: nessun orario, «ora non indicata dalla fonte»`, t.includes("ora non indicata dalla fonte") && !/ore \d/.test(t));
  }
  const senzaScadenza = componiEmailRadar({ ...SCADENZA_10, gara: gara(1, { scadenza: null }) }, TITOLARE_ALFA).testo;
  atteso("E7 scadenza assente: «non indicata dalla fonte», nessuna data inventata", senzaScadenza.includes("SCADENZA PER LE OFFERTE: non indicata dalla fonte") && !/novembre|dicembre/.test(senzaScadenza.split("Ultima verifica")[0]));
  for (const giorno of ["2026-02-30", "2026-13-01", "30/11/2026", "2026-11-30T12:00", ""]) {
    const t = componiEmailRadar({ ...SCADENZA_10, gara: gara(1, { scadenza: { giorno, ora: "12:00" } }) }, TITOLARE_ALFA).testo;
    atteso(`E7 giorno non valido «${giorno}»: scadenza non indicata e ora non scritta`, t.includes("SCADENZA PER LE OFFERTE: non indicata dalla fonte") && !t.includes("ore 12:00"));
  }
  atteso("E7 oraValida accetta solo HH:MM", oraValida("00:00") === "00:00" && oraValida("23:59") === "23:59" && oraValida("7:05") === null && oraValida(null) === null);
}
{
  // il giorno della settimana è quello del calendario (nessun fuso che sposti la data)
  const casi: [string, string][] = [
    ["2026-03-29", "domenica 29 marzo 2026"],
    ["2026-10-25", "domenica 25 ottobre 2026"],
    ["2026-11-26", "giovedì 26 novembre 2026"],
    ["2027-01-01", "venerdì 1 gennaio 2027"],
  ];
  for (const [giorno, atteso_] of casi) atteso(`E7 giorno ${giorno} (anche nei cambi d'ora) → «${atteso_}»`, formattaScadenza({ giorno, ora: null }).startsWith(atteso_));
}

// ───── E8. Escape HTML di ogni testo variabile, collegamenti solo http(s) ─────

{
  const VELENO = `<script>alert("x")</script><img src=x onerror=alert(1)>&'"`;
  const veleno = (s: string) => `${s} ${VELENO}`;
  const eventi: EventoEmailRadar[] = [
    {
      ...RETTIFICA,
      impresaNome: veleno("Impresa"),
      gara: gara(1, {
        oggetto: veleno("Oggetto"),
        stazioneAppaltante: veleno("Stazione"),
        cig: [veleno("CIG")],
        tipoAvviso: veleno("Tipo"),
        fonti: [veleno("Fonte")],
        luogo: veleno("Luogo"),
      }),
      modifiche: [{ campo: veleno("Campo"), prima: veleno("Prima"), dopo: veleno("Dopo") }],
      evidenza: { avviso: veleno("Avviso"), url: "https://ted.example/a", pubblicatoIl: "2026-11-18" },
    },
    { ...DOCUMENTI, documenti: [{ nome: veleno("Documento"), natura: "sostitutivo", url: "https://piattaforma-gare.example/d.pdf" }] },
    { ...NUOVE_OPPORTUNITA, gare: [gara(1, { oggetto: veleno("Riepilogo"), stazioneAppaltante: veleno("Ente"), luogo: veleno("Regione") })] },
  ];
  for (const evento of eventi) {
    const { html, oggetto } = componiEmailRadar(evento, { ...TITOLARE_ALFA, nome: veleno("Nome") });
    // l'attributo resta testo innocuo («onerror=» dentro un &lt;img…&gt; già neutralizzato): conta che non nasca nessun tag
    atteso(`E8 ${evento.tipo}: nessun tag iniettato`, !/<script|<img/i.test(html) && !/<[^>]*onerror=/i.test(html));
    atteso(`E8 ${evento.tipo}: i testi compaiono con l'escape`, html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;") && html.includes("&amp;&#39;&quot;"));
    atteso(`E8 ${evento.tipo}: oggetto senza HTML interpretato (resta testo)`, !/[\r\n]/.test(oggetto));
  }
  const pericolosi = ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//omnia-ai.it/x", "https://a.example/x\"onmouseover=\"alert(1)", "https://a.example/ x", "https://a.example/\nx", " javascript:alert(1)"];
  for (const url of pericolosi) {
    const evento: EventoEmailRadar = { ...DOCUMENTI, urlPreferenze: url, gara: gara(1, { urlScheda: url, urlFonte: url }), documenti: [{ nome: "Documento", natura: "nuovo", url }], evidenza: { avviso: "Avviso", url, pubblicatoIl: null } };
    const { html, testo } = componiEmailRadar(evento, TITOLARE_ALFA);
    const hrefs = collegamenti(html);
    atteso(`E8 collegamento non sicuro ${JSON.stringify(url)}: mai negli href`, hrefs.every((h) => /^https?:\/\/[^\s"'<>]+$/.test(h)) && !hrefs.some((h) => h.includes("onmouseover")));
    atteso(`E8 collegamento non sicuro ${JSON.stringify(url)}: mai nel testo`, !/javascript:|data:text|vbscript:/i.test(testo));
    atteso(`E8 collegamento non sicuro ${JSON.stringify(url)}: senza preferenze cliccabili resta la frase per trovarle`, visibile(html).includes("preferenze delle notifiche della tua area riservata"));
  }
  atteso("E8 urlSicuro: https ammesso, il resto no", urlSicuro("https://a.example/x?y=1&z=2") === "https://a.example/x?y=1&z=2" && urlSicuro("ftp://a.example") === null && urlSicuro(null) === null);
}

// ───── E9. Oggetto: nessun a capo né carattere di controllo (iniezione di intestazioni) ─────

{
  const evento: EventoEmailRadar = { ...SCADENZA_1, gara: gara(1, { oggetto: "Gara\r\nBcc: vittima@example.com\r\n\r\nTesto\u0000\u0007 finale" }) };
  const { oggetto, testo } = componiEmailRadar(evento, TITOLARE_ALFA);
  atteso("E9 oggetto senza a capo né controlli", !/[\u0000-\u001f\u007f]/.test(oggetto), JSON.stringify(oggetto));
  atteso("E9 il testo semplice non porta caratteri di controllo (salvo l'a capo delle righe)", !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(testo));
  const lungo = componiEmailRadar({ ...SCADENZA_1, gara: gara(1, { oggetto: "X".repeat(400) }) }, TITOLARE_ALFA).oggetto;
  atteso("E9 oggetto lungo accorciato con «…»", lungo.length <= 150 && lungo.endsWith("…"));
  atteso("E9 riga() toglie i controlli", riga("a\r\nb\tc\u0000d") === "a b c d");
}

// ───── E10. CIG: riga presente solo se c'è ─────

{
  const { html, testo } = componiEmailRadar(CASO_CIG_ASSENTE, TITOLARE_ALFA);
  atteso("E10 CIG assente: nessuna riga CIG nell'HTML", !/\bCIG\b/.test(visibile(html)));
  atteso("E10 CIG assente: nessuna riga CIG nel testo", !/\bCIG\b/.test(testo));
  const conCig = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  atteso("E10 un CIG: «CIG A0SINT0001»", visibile(conCig.html).includes("CIG A0SINT0001") && conCig.testo.includes("CIG: A0SINT0001"));
  const piuLotti = componiEmailRadar(SCADENZA_5, TITOLARE_ALFA);
  atteso("E10 più lotti: «CIG dei lotti» con tutti i codici", piuLotti.testo.includes("CIG dei lotti: A0SINT0021, A0SINT0022, A0SINT0023"));
  const cigVuoti = componiEmailRadar({ ...SCADENZA_10, gara: gara(1, { cig: ["", "  "] }) }, TITOLARE_ALFA).testo;
  atteso("E10 CIG vuoti trattati come assenti", !/\bCIG\b/.test(cigVuoti));
}

// ───── E11. Rettifiche, proroghe e documenti: solo ciò che dice l'evidenza ─────

{
  const { html, testo } = componiEmailRadar(RETTIFICA, TITOLARE_ALFA);
  const vis = visibile(html);
  atteso("E11 rettifica: ogni cambiamento con prima e dopo (HTML)", vis.includes("Importo a base di gara Prima: 1.250.000,00 € Ora: 1.310.000,00 €"));
  atteso("E11 rettifica: ogni cambiamento con prima e dopo (testo)", testo.includes("- Importo a base di gara\n  Prima: 1.250.000,00 €\n  Ora: 1.310.000,00 €"));
  atteso("E11 rettifica: l'avviso ufficiale da cui viene, con data e collegamento", vis.includes("Avviso di rettifica n. 2026/S 000-000005, pubblicato il 18 novembre 2026") && collegamenti(html).includes("https://ted.example/avvisi/000005-2026"));
  const senza = componiEmailRadar(RETTIFICA_SENZA_DETTAGLIO, TITOLARE_ALFA);
  atteso("E11 rettifica senza dettaglio: lo dice, non inventa cambiamenti", senza.testo.includes("non ne riporta il dettaglio") && !/Prima:|Ora:/.test(senza.testo) && !/Prima:|Ora:/.test(visibile(senza.html)));
  const valoriAssenti = componiEmailRadar({ ...RETTIFICA, modifiche: [{ campo: "Luogo di esecuzione", prima: null, dopo: "Veneto" }] }, TITOLARE_ALFA).testo;
  atteso("E11 valore precedente assente: «non indicato», niente di inventato", valoriAssenti.includes("Prima: non indicato\n  Ora: Veneto"));
  const p = componiEmailRadar(PROROGA, TITOLARE_ALFA);
  atteso("E11 proroga: prima e dopo con le ore della fonte", p.testo.includes("Prima: mercoledì 25 novembre 2026, ore 12:00\nOra: mercoledì 9 dicembre 2026, ore 12:00"));
  atteso("E11 proroga: «prorogata» solo perché la nuova data è successiva", p.oggetto.startsWith("Scadenza prorogata:"));
  const anticipo = componiEmailRadar({ ...PROROGA, scadenzaPrecedente: { giorno: "2026-12-20", ora: null } }, TITOLARE_ALFA);
  atteso("E11 anticipo: «anticipata»", anticipo.oggetto.startsWith("Scadenza anticipata:"));
  const ignota = componiEmailRadar({ ...PROROGA, scadenzaPrecedente: null }, TITOLARE_ALFA);
  atteso("E11 scadenza precedente ignota: «modificata», prima «non indicata dalla fonte»", ignota.oggetto.startsWith("Scadenza modificata:") && ignota.testo.includes("Prima: non indicata dalla fonte"));
  const soloOra = componiEmailRadar({ ...PROROGA, scadenzaPrecedente: { giorno: "2026-12-09", ora: "10:00" } }, TITOLARE_ALFA);
  atteso("E11 cambia solo l'ora: «modificata» (non «prorogata»)", soloOra.oggetto.startsWith("Scadenza modificata:"));
  const d = componiEmailRadar(DOCUMENTI, TITOLARE_ALFA);
  atteso("E11 documenti: nome, natura e collegamento", d.testo.includes("- Capitolato speciale d'appalto — versione 2 (sostituisce un documento precedente)") && collegamenti(d.html).includes("https://piattaforma-gare.example/procedure/8/capitolato-v2.pdf"));
  const nessunDoc = componiEmailRadar({ ...DOCUMENTI, documenti: [] }, TITOLARE_ALFA).testo;
  atteso("E11 documenti senza elenco: lo dice", nessunDoc.includes("non ne riporta l'elenco"));
}

// ───── E12. Riepilogo delle nuove opportunità: al massimo 20 gare elencate ─────

{
  const { oggetto, html, testo } = componiEmailRadar(NUOVE_OPPORTUNITA, TITOLARE_ALFA);
  const elencate = NUOVE_OPPORTUNITA.tipo === "nuove_opportunita" ? NUOVE_OPPORTUNITA.gare : [];
  atteso("E12 fixture con più di 20 gare", elencate.length === 23);
  const nelTesto = elencate.filter((g) => testo.includes(g.oggetto)).length;
  const nellHtml = elencate.filter((g) => collegamenti(html).includes(g.urlScheda)).length;
  atteso("E12 al massimo 20 gare nel testo", nelTesto === MASSIMO_GARE_RIEPILOGO, String(nelTesto));
  atteso("E12 al massimo 20 gare nell'HTML", nellHtml === MASSIMO_GARE_RIEPILOGO, String(nellHtml));
  atteso("E12 le altre 3 sono annunciate", testo.includes("E altre 3 gare in «Per te».") && visibile(html).includes("E altre 3 gare in «Per te»."));
  atteso("E12 oggetto con il totale", oggetto === "23 nuove gare per te");
  atteso("E12 collegamento a «Per te»", collegamenti(html).includes("https://omnia-ai.it/dashboard/omnia-ai/opportunita/per-te"));
  const conAltre = componiEmailRadar({ ...NUOVE_OPPORTUNITA, gare: elencate.slice(0, 2), altre: 5 }, TITOLARE_ALFA);
  atteso("E12 «altre» dal motore sommate al totale", conAltre.oggetto === "7 nuove gare per te" && conAltre.testo.includes("E altre 5 gare"));
  const una = componiEmailRadar({ ...NUOVE_OPPORTUNITA, gare: elencate.slice(0, 1), altre: 0 }, TITOLARE_ALFA);
  atteso("E12 singolare: «1 nuova gara per te»", una.oggetto === "1 nuova gara per te" && !una.testo.includes("E altre"));
  const negativo = componiEmailRadar({ ...NUOVE_OPPORTUNITA, gare: elencate.slice(0, 2), altre: -4 }, TITOLARE_ALFA);
  atteso("E12 «altre» negativo ignorato", negativo.oggetto === "2 nuove gare per te");
  const oraIgnota = elencate[3];
  atteso("E12 nel riepilogo l'ora non nota resta «non indicata»", oraIgnota.scadenza?.ora === null && testo.includes(`${oraIgnota.oggetto}`) && testo.includes("· ora non indicata dalla fonte"));
}

// ───── E13. Separazione tra imprese ─────

{
  let errore = "";
  try {
    componiEmailRadar(SCADENZA_10_BETA, TITOLARE_ALFA);
  } catch (e) {
    errore = (e as Error).message;
  }
  atteso("E13 evento dell'impresa Beta per un destinatario di Alfa: errore, nessuna email", errore.includes("non appartiene all'impresa"));
  let vuoto = "";
  try {
    componiEmailRadar({ ...SCADENZA_10, impresaId: "" }, { ...TITOLARE_ALFA, impresaId: "" });
  } catch (e) {
    vuoto = (e as Error).message;
  }
  atteso("E13 impresa vuota da entrambe le parti: errore (mai «uguali perché vuote»)", vuoto.includes("non appartiene all'impresa"));
  // nessuno stato tra una chiamata e l'altra: dopo un'email di Beta, quella di Alfa non contiene nulla di Beta
  componiEmailRadar(SCADENZA_10_BETA, TITOLARE_BETA);
  const alfa = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  const tutto = alfa.oggetto + alfa.html + alfa.testo;
  atteso("E13 nessun dato di Beta nell'email di Alfa composta dopo", !/RISERVATA-BETA|BETA000001|Beta Costruzioni|be7a|Paola/.test(tutto));
  atteso("E13 stessa email a parità di dati (funzione pura)", JSON.stringify(componiEmailRadar(SCADENZA_10, TITOLARE_ALFA)) === JSON.stringify(alfa));
  const prima = JSON.stringify(SCADENZA_10);
  componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  atteso("E13 l'evento non viene modificato", JSON.stringify(SCADENZA_10) === prima);
}

// ───── E14. Destinatario: titolare dell'impresa o Ufficio Gare, testi distinti ─────

{
  const t = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  const u = componiEmailRadar(SCADENZA_10, UFFICIO_GARE_ALFA);
  atteso("E14 titolare: «sei il titolare dell'impresa Alfa Servizi Sintetici S.r.l.»", t.testo.includes("perché sei il titolare dell'impresa Alfa Servizi Sintetici S.r.l. in OMNIA AI"));
  atteso("E14 Ufficio Gare: «fai parte dell'Ufficio Gare dell'impresa …»", u.testo.includes("perché fai parte dell'Ufficio Gare dell'impresa Alfa Servizi Sintetici S.r.l. in OMNIA AI"));
  atteso("E14 saluto col nome", t.testo.includes("Buongiorno Laura,") && u.testo.includes("Buongiorno Marco,"));
  const senzaNome = componiEmailRadar(SCADENZA_10, { ...TITOLARE_ALFA, nome: null }).testo;
  atteso("E14 senza nome: «Buongiorno,»", senzaNome.includes("\nBuongiorno,\n"));
}

// ───── E15. Oggetti attesi per ogni tipo ─────

{
  const oggetti: [EventoEmailRadar, string][] = [
    [SCADENZA_10, "Scadenza tra 10 giorni: Servizio di pulizia"],
    [SCADENZA_5, "Scadenza tra 5 giorni: Lavori di manutenzione"],
    [SCADENZA_1, "Scadenza domani: Fornitura di arredi"],
    [SCADENZA_RAVVICINATA, "Scadenza tra 3 giorni: Servizio di ristorazione"],
    [RETTIFICA, "Rettifica pubblicata: "],
    [PROROGA, "Scadenza prorogata: Servizio di manutenzione del verde"],
    [DOCUMENTI, "Nuovi documenti di gara: Servizio di vigilanza"],
  ];
  for (const [evento, inizio] of oggetti) {
    const o = componiEmailRadar(evento, TITOLARE_ALFA).oggetto;
    atteso(`E15 oggetto ${evento.tipo}: «${inizio}…»`, o.startsWith(inizio), o);
  }
  const oggi = componiEmailRadar({ ...SCADENZA_RAVVICINATA, giorniMancanti: 0 }, TITOLARE_ALFA).oggetto;
  atteso("E15 ravvicinata a 0 giorni: «Scadenza oggi»", oggi.startsWith("Scadenza oggi:"));
  const strano = componiEmailRadar({ ...SCADENZA_RAVVICINATA, giorniMancanti: Number.NaN }, TITOLARE_ALFA).oggetto;
  atteso("E15 ravvicinata con giorni non validi: «Scadenza a breve»", strano.startsWith("Scadenza a breve:"));
}

// ───── E16. I modelli sono puri: nessun accesso a database, rete, ambiente; nessun «23:59» ─────

{
  const cartella = path.join(RADICE, "src/lib/radar/email-modelli");
  const file = fs.readdirSync(cartella).filter((f) => f.endsWith(".ts"));
  atteso("E16 file dei modelli presenti", ["componi.ts", "contratto.ts", "formato.ts", "index.ts"].every((f) => file.includes(f)), file.join(", "));
  for (const f of file) {
    const sorgente = fs.readFileSync(path.join(cartella, f), "utf8");
    const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    atteso(`E16 ${f}: nessun import di database, rete, server o invio`, !/supabase|from "@\/lib\/email"|resend|server-only|next\/|node:|fetch\(|process\.env|Date\.now|new Date\(\)/i.test(codice));
    const importati = [...codice.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    atteso(`E16 ${f}: importa solo i modelli e l'escape condiviso`, importati.every((i) => i.startsWith("./") || i === "@/lib/omnia-ai-email-eventi-calcoli"), importati.join(", "));
    atteso(`E16 ${f}: nessun «23:59»`, !codice.includes("23:59"));
    atteso(`E16 ${f}: righe LF, niente CRLF`, !sorgente.includes("\r\n"));
  }
}

// ───── E17. Le anteprime per l'utente si compongono tutte ─────

for (const a of ANTEPRIME) {
  let ok = true;
  try {
    componiEmailRadar(a.evento, a.destinatario);
  } catch {
    ok = false;
  }
  atteso(`E17 anteprima «${a.file}» composta`, ok);
}

console.log(fallimenti.length ? `\n${fallimenti.length} controlli FALLITI` : "\nTutti i controlli dei modelli delle email B4 sono passati.");
process.exit(fallimenti.length ? 1 : 0);
