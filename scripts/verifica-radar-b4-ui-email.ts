// Verifica dei modelli delle email di Tender Intelligence (fase B4, decisione dell'utente del 19/11 §2–3 e approvazione definitiva, modifiche
// 1 e 2; contratto di B2 VERSIONE 2). Solo funzioni pure e dati SINTETICI: nessuna rete, nessun database, nessun invio.
// Mutazioni: scripts/mutazioni-radar-b4-ui-email.mjs.
import fs from "node:fs";
import path from "node:path";
import {
  AVVERTENZA_EMAIL,
  DETTAGLIO_NON_DISPONIBILE,
  MASSIMO_GARE_RIEPILOGO,
  NOTA_AGGIUNTA_A_MANO,
  RIMANDO_AVVISO_UFFICIALE,
  TIPI_EVENTO,
  VERSIONE_CONTRATTO_NOTIFICHE,
  componiEmailRadar,
  type ContenutoEmail,
  type EventoModifica,
  type EventoRadar,
  type EventoScadenza,
  type GaraEmail,
  type GruppoScadenza,
  type ScadenzaNota,
} from "../src/lib/radar/email-modelli";
import { formattaScadenza, oraValida, riga, urlSicuro } from "../src/lib/radar/email-modelli/formato";
import {
  ANNULLAMENTO,
  ANTEPRIME,
  CASO_AGGIUNTA_A_MANO,
  CASO_CIG_ASSENTE,
  CASO_ORA_NON_NOTA,
  DOCUMENTI,
  DUE_GRUPPI,
  DUE_GRUPPI_SECONDO,
  LOTTI_A,
  LOTTI_B,
  LOTTI_SENZA_SCADENZA,
  MODIFICA_SCADENZA,
  NUOVE_OPPORTUNITA,
  NUOVE_OPPORTUNITA_MOTORE,
  PIU_CIG,
  PROROGA,
  PROROGA_LOTTO,
  RAGGRUPPATO,
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
  gruppo,
  lotto,
  mod,
  scadenza,
} from "./dati-sintetici-email-radar-b4";

const RADICE = path.resolve(__dirname, "..");
const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok || !dettaglio ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale(nome: string, ottenuto: unknown, atteso_: unknown) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(atteso_), `ottenuto ${JSON.stringify(ottenuto)}`);
}

const SINGOLI: EventoRadar[] = [
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
  DUE_GRUPPI,
  DUE_GRUPPI_SECONDO,
  PIU_CIG,
  LOTTI_SENZA_SCADENZA,
  PROROGA_LOTTO,
];
const TUTTI: ContenutoEmail[] = [...SINGOLI, RAGGRUPPATO];

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

function collegamenti(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

function nomeCaso(e: ContenutoEmail): string {
  const extra = new Map<ContenutoEmail, string>([
    [CASO_ORA_NON_NOTA, " (ora non nota)"],
    [CASO_CIG_ASSENTE, " (CIG assente)"],
    [CASO_AGGIUNTA_A_MANO, " (aggiunta a mano)"],
    [RETTIFICA_SENZA_DETTAGLIO, " (senza dettaglio)"],
    [NUOVE_OPPORTUNITA_MOTORE, " (20 + 3 dal motore)"],
    [DUE_GRUPPI, " (due gruppi, primo)"],
    [DUE_GRUPPI_SECONDO, " (due gruppi, secondo)"],
    [PIU_CIG, " (gruppo con più CIG)"],
    [LOTTI_SENZA_SCADENZA, " (lotto senza scadenza)"],
    [PROROGA_LOTTO, " (proroga di un lotto)"],
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

/** Un promemoria con UNA sola scadenza di procedura (per provare le ore e i giorni). */
function conScadenza(s: ScadenzaNota): EventoScadenza {
  const g = gruppo(s);
  return { ...SCADENZA_10, gara: { ...SCADENZA_10.gara, scadenze: [g] }, gruppo: g };
}

atteso("E0 contratto di B2 versione 2", VERSIONE_CONTRATTO_NOTIFICHE === 2);

// ───── E1. Ogni tipo del contratto ha un caso di prova, più il raggruppamento ─────

const coperti = new Set(TUTTI.map((e) => e.tipo));
for (const tipo of [...TIPI_EVENTO, "raggruppamento_urgenti" as const]) atteso(`E1 tipo «${tipo}» coperto dalle prove`, coperti.has(tipo));

// ───── E2–E6. In ogni email: avvertenza, preferenze, oggetto pulito, niente «amministratore», i dati obbligatori ─────

function scadenzaAttesa(e: EventoRadar): ScadenzaNota | null {
  if (e.tipo === "riepilogo_opportunita") return null;
  if (e.categoria === "scadenze") return e.gruppo.scadenza;
  if (e.cambioScadenza) return e.cambioScadenza.nuova;
  return e.gara.scadenze[0]?.scadenza ?? null;
}

for (const contenuto of TUTTI) {
  const { oggetto, html, testo } = componiEmailRadar(contenuto, TITOLARE_ALFA);
  const nome = nomeCaso(contenuto);
  const vis = visibile(html);
  atteso(`E2 ${nome}: avvertenza UNA volta nell'HTML e nel testo`, vis.split(AVVERTENZA_EMAIL).length === 2 && testo.split(AVVERTENZA_EMAIL).length === 2);
  atteso(`E3 ${nome}: collegamento alle preferenze nell'HTML e nel testo`, collegamenti(html).includes(URL_PREFERENZE) && testo.includes(`Preferenze delle notifiche: ${URL_PREFERENZE}`));
  atteso(`E4 ${nome}: oggetto su una riga, non vuoto, al massimo 150 caratteri`, oggetto.length > 0 && oggetto.length <= 150 && !/[\r\n\t]/.test(oggetto));
  atteso(`E4 ${nome}: documento HTML completo, lingua italiana, tema chiaro`, html.startsWith("<!DOCTYPE html>") && html.includes('<html lang="it">') && html.includes('content="light"'));
  atteso(`E5 ${nome}: mai «amministratore»`, !/amministrator/i.test(vis + testo));
  atteso(`E5 ${nome}: l'indirizzo email e l'id del destinatario non compaiono`, !(html + testo).includes(TITOLARE_ALFA.email) && !(html + testo).includes(TITOLARE_ALFA.userId));
  const eventi: EventoRadar[] = contenuto.tipo === "raggruppamento_urgenti" ? contenuto.eventi : [contenuto];
  for (const e of eventi) {
    const gare = e.tipo === "riepilogo_opportunita" ? e.gare.slice(0, 3) : [e.gara];
    for (const g of gare) {
      atteso(`E6 ${nome}: denominazione «${g.denominazione.slice(0, 28)}…»`, vis.includes(g.denominazione) && testo.includes(g.denominazione));
      atteso(`E6 ${nome}: collegamento alla scheda OMNIA AI`, collegamenti(html).includes(g.urlScheda) && testo.includes(g.urlScheda));
      atteso(`E6 ${nome}: data dell'ultimo aggiornamento rilevato`, vis.includes("19/11/2026 alle 08:42") && testo.includes("19/11/2026 alle 08:42"));
    }
    const s = scadenzaAttesa(e);
    if (s) atteso(`E6 ${nome}: la scadenza dell'avviso`, testo.includes(formattaScadenza(s)));
    if (e.tipo !== "riepilogo_opportunita") {
      const g = e.gara;
      atteso(`E6 ${nome}: stazione appaltante`, vis.includes(g.stazioneAppaltante ?? "-") && testo.includes(`Stazione appaltante: ${g.stazioneAppaltante}`));
      if (g.tipoAvviso) atteso(`E6 ${nome}: tipo di avviso`, vis.includes(`Tipo di avviso ${g.tipoAvviso}`) && testo.includes(`Tipo di avviso: ${g.tipoAvviso}`));
      if (g.urlFonteUfficiale) atteso(`E6 ${nome}: collegamento alla fonte ufficiale`, collegamenti(html).includes(g.urlFonteUfficiale) && testo.includes(`Fonte ufficiale: ${g.urlFonteUfficiale}`));
      if (!g.aggiuntaAMano) atteso(`E6 ${nome}: «Ultimo aggiornamento rilevato dalla fonte»`, testo.includes("Ultimo aggiornamento rilevato dalla fonte: 19/11/2026 alle 08:42"));
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
  const conOra = (ora: string | null, giorno = "2026-11-30"): string => componiEmailRadar(conScadenza({ giorno, ora, istante: null, origine: "fonte" }), TITOLARE_ALFA).testo;
  atteso("E7 ora 23:59 indicata dalla fonte: scritta così com'è (non è una presunzione)", conOra("23:59").includes("ore 23:59"));
  for (const sbagliata of ["24:00", "23:60", "9:30", "12.00", "", " 12:00", "12:00:00", "ore 12"]) {
    const t = conOra(sbagliata);
    atteso(`E7 ora non valida «${sbagliata}»: nessun orario, «ora non indicata dalla fonte»`, t.includes("ora non indicata dalla fonte") && !/ore \d/.test(t));
  }
  for (const giorno of ["2026-02-30", "2026-13-01", "30/11/2026", "2026-11-30T12:00", ""]) {
    const t = conOra("12:00", giorno);
    atteso(`E7 giorno non valido «${giorno}»: «non indicata dalla fonte», ora non scritta`, t.includes("SCADENZA PER LE OFFERTE: non indicata dalla fonte") && !t.includes("ore 12:00"));
  }
  const senzaScadenza = componiEmailRadar({ ...RETTIFICA, gara: { ...RETTIFICA.gara, scadenze: [] } }, TITOLARE_ALFA).testo;
  atteso("E7 gara senza scadenze (rettifica): «non indicata dalla fonte», nessuna data inventata", senzaScadenza.includes("Scadenza per le offerte: non indicata dalla fonte"));
  atteso("E7 oraValida accetta solo HH:MM", oraValida("00:00") === "00:00" && oraValida("23:59") === "23:59" && oraValida("7:05") === null && oraValida(null) === null);
  for (const [giorno, atteso_] of [
    ["2026-03-29", "domenica 29 marzo 2026"],
    ["2026-10-25", "domenica 25 ottobre 2026"],
    ["2026-11-26", "giovedì 26 novembre 2026"],
    ["2027-01-01", "venerdì 1 gennaio 2027"],
  ] as const) {
    atteso(`E7 giorno ${giorno} (anche nei cambi d'ora) → «${atteso_}»`, formattaScadenza(scadenza(giorno, null)).startsWith(atteso_));
  }
  const impresa = componiEmailRadar(CASO_AGGIUNTA_A_MANO, TITOLARE_ALFA).testo;
  atteso("E7 gara aggiunta senza ora: «ora non indicata nella gara aggiunta» (non «dalla fonte»)", impresa.includes("mercoledì 25 novembre 2026 · ora non indicata nella gara aggiunta") && !impresa.includes("ora non indicata dalla fonte"));
}

// ───── E8. Escape HTML di ogni testo variabile, collegamenti solo http(s) ─────

{
  const VELENO = `<script>alert("x")</script><img src=x onerror=alert(1)>&'"`;
  const v = (s: string) => `${s} ${VELENO}`;
  const lottiVelenosi = [lotto(v("1"), v("CIGL"), v("Lotto"))];
  const grVeleno = gruppo(scadenza("2026-11-30", null), lottiVelenosi);
  const garaVelenosa = gara(1, {
    denominazione: v("Oggetto"),
    stazioneAppaltante: v("Stazione"),
    cig: [v("CIG")],
    tipoAvviso: v("Tipo"),
    fonti: [{ fonte: v("f"), nome: v("Fonte") }],
    luogo: v("Luogo"),
    scadenze: [grVeleno],
    lottiSenzaScadenza: [lotto(v("9"), v("CIG9"), v("Senza"))],
  });
  const contenuti: ContenutoEmail[] = [
    {
      ...RETTIFICA,
      nomeImpresa: v("Impresa"),
      gara: garaVelenosa,
      modifiche: [mod("importo", v("Campo"), v("Prima"), v("Dopo"), lottiVelenosi)],
      evidenza: { ...RETTIFICA.evidenza, nomeFonte: v("NomeFonte"), avvisoId: v("Avviso"), motivoFonte: v("Motivo") },
    },
    { ...SCADENZA_10, gara: garaVelenosa, gruppo: grVeleno },
    { ...NUOVE_OPPORTUNITA, gare: [{ ...NUOVE_OPPORTUNITA.gare[0], ...garaVelenosa, perche: [v("Perché")] }] },
    { ...RAGGRUPPATO, eventi: [{ ...SCADENZA_1, gara: garaVelenosa, gruppo: grVeleno }] },
  ];
  for (const c of contenuti) {
    const { html, oggetto } = componiEmailRadar(c, { ...TITOLARE_ALFA, nome: v("Nome") });
    atteso(`E8 ${c.tipo}: nessun tag iniettato`, !/<script|<img/i.test(html) && !/<[^>]*onerror=/i.test(html));
    atteso(`E8 ${c.tipo}: i testi compaiono con l'escape`, html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;") && html.includes("&amp;&#39;&quot;"));
    atteso(`E8 ${c.tipo}: oggetto su una riga`, !/[\r\n]/.test(oggetto));
  }
  const pericolosi = ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//omnia-ai.it/x", 'https://a.example/x"onmouseover="alert(1)', "https://a.example/ x", "https://a.example/\nx", " javascript:alert(1)"];
  for (const url of pericolosi) {
    const g = gara(1, { urlScheda: url, urlFonteUfficiale: url });
    const casi: ContenutoEmail[] = [
      { ...DOCUMENTI, gara: g, evidenza: { ...DOCUMENTI.evidenza, avvisoUrl: url } },
      { ...NUOVE_OPPORTUNITA, urlPerTe: url, gare: [{ ...NUOVE_OPPORTUNITA.gare[0], ...g }] },
    ];
    for (const c of casi) {
      const { html, testo } = componiEmailRadar(c, { ...TITOLARE_ALFA, urlPreferenze: url });
      const hrefs = collegamenti(html);
      atteso(`E8 ${c.tipo}, collegamento ${JSON.stringify(url)}: mai negli href`, hrefs.every((h) => /^https?:\/\/[^\s"'<>]+$/.test(h)) && !hrefs.some((h) => h.includes("onmouseover")));
      atteso(`E8 ${c.tipo}, collegamento ${JSON.stringify(url)}: mai nel testo`, !/javascript:|data:text|vbscript:/i.test(testo));
      atteso(`E8 ${c.tipo}, collegamento ${JSON.stringify(url)}: resta la frase per trovare le preferenze`, visibile(html).includes("preferenze delle notifiche della tua area riservata"));
    }
  }
  atteso("E8 urlSicuro: https ammesso, il resto no", urlSicuro("https://a.example/x?y=1&z=2") === "https://a.example/x?y=1&z=2" && urlSicuro("ftp://a.example") === null && urlSicuro(null) === null);
}

// ───── E9. Oggetto: nessun a capo né carattere di controllo ─────

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
  atteso("E10 procedura con più lotti: tutti i CIG", componiEmailRadar(SCADENZA_5, TITOLARE_ALFA).testo.includes("CIG: A0SINT0021, A0SINT0022, A0SINT0023"));
  atteso("E10 CIG vuoti trattati come assenti", !/\bCIG\b/.test(componiEmailRadar({ ...SCADENZA_10, gara: { ...SCADENZA_10.gara, cig: ["", "  "] } }, TITOLARE_ALFA).testo));
}

// ───── E11. Rettifiche, proroghe, documenti, annullamento: solo ciò che dicono modifiche, cambio di scadenza ed evidenza ─────

{
  const r = componiEmailRadar(RETTIFICA, TITOLARE_ALFA);
  const vis = visibile(r.html);
  atteso("E11 rettifica: ogni cambiamento con prima e ora (HTML)", vis.includes("Importo a base di gara Prima: 1.250.000,00 € Ora: 1.310.000,00 €") && vis.includes("Numero dei lotti Prima: 2 Ora: 3"));
  atteso("E11 rettifica: ogni cambiamento con prima e ora (testo)", r.testo.includes("- Importo a base di gara\n  Prima: 1.250.000,00 €\n  Ora: 1.310.000,00 €"));
  atteso("E11 rettifica: l'avviso con fonte, data e collegamento", vis.includes("Fonte del cambiamento: avviso 000005-2026 su TED (Gazzetta UE), pubblicato il 18 novembre 2026.") && collegamenti(r.html).includes("https://ted.example/avvisi/000005-2026"));
  atteso("E11 rettifica: motivo della fonte e affidabilità", r.testo.includes("Motivo indicato dalla fonte: Correzione da parte dell'amministrazione.") && r.testo.includes("Avviso di modifica pubblicato dalla fonte."));
  atteso("E11 rettifica: quando OMNIA AI l'ha rilevata (ora di Roma)", r.testo.includes("Rilevato da OMNIA AI il 19/11/2026 alle 06:10."));
  const confronto = componiEmailRadar({ ...RETTIFICA_SENZA_DETTAGLIO, evidenza: { ...RETTIFICA_SENZA_DETTAGLIO.evidenza, affidabilita: "confronto_versioni" } }, TITOLARE_ALFA);
  atteso("E11 nessuna modifica e nessun avviso ufficiale: «dettaglio non disponibile»", confronto.testo.includes(DETTAGLIO_NON_DISPONIBILE) && !confronto.testo.includes(RIMANDO_AVVISO_UFFICIALE));
  const nulli = componiEmailRadar({ ...RETTIFICA, modifiche: [mod("oggetto", "Oggetto", null, "Nuovo oggetto")] }, TITOLARE_ALFA).testo;
  atteso("E11 valore precedente assente: «non indicato», niente di inventato", nulli.includes("Prima: non indicato\n  Ora: Nuovo oggetto"));
  const p = componiEmailRadar(PROROGA, TITOLARE_ALFA);
  atteso("E11 proroga: nuova e vecchia scadenza dal cambio di scadenza, con le ore della fonte", p.testo.includes("NUOVA SCADENZA PER LE OFFERTE: mercoledì 9 dicembre 2026, ore 12:00\nScadenza precedente: mercoledì 25 novembre 2026, ore 12:00"));
  atteso("E11 proroga: la scadenza non è ripetuta tra gli altri cambiamenti", !p.testo.includes("Scadenza per la presentazione delle offerte") && !p.testo.includes("ALTRI CAMBIAMENTI"));
  atteso("E11 proroga: confronto tra versioni dichiarato", p.testo.includes("Cambiamento rilevato confrontando due versioni ufficiali della gara pubblicate dalla fonte."));
  atteso("E11 proroga: oggetto «Scadenza prorogata» dal tipo", p.oggetto.startsWith("Scadenza prorogata:"));
  const m = componiEmailRadar(MODIFICA_SCADENZA, TITOLARE_ALFA);
  atteso("E11 modifica della scadenza: «modificata», mai «prorogata» o «anticipata»", m.oggetto.startsWith("Scadenza modificata:") && !/prorogat|anticipat/i.test(m.testo + visibile(m.html)));
  atteso("E11 modifica della scadenza: senza ora resta «ora non indicata»", m.testo.includes("NUOVA SCADENZA PER LE OFFERTE: venerdì 27 novembre 2026 · ora non indicata dalla fonte\nScadenza precedente: venerdì 4 dicembre 2026 · ora non indicata dalla fonte"));
  atteso("E11 evidenza senza avviso né collegamento: «avviso ufficiale», nessun link inventato", m.testo.includes("Fonte del cambiamento: avviso ufficiale su Sintel (ARIA Lombardia), pubblicato il 18 novembre 2026.") && !m.testo.includes("Avviso: http"));
  const altri = componiEmailRadar({ ...PROROGA, modifiche: [...PROROGA.modifiche, mod("importo", "Importo a base di gara", "100", "120")] }, TITOLARE_ALFA).testo;
  atteso("E11 proroga con altri cambiamenti: elencati a parte", altri.includes("ALTRI CAMBIAMENTI INDICATI DALLA FONTE\n- Importo a base di gara\n  Prima: 100\n  Ora: 120"));
  const d = componiEmailRadar(DOCUMENTI, TITOLARE_ALFA);
  atteso("E11 documenti: elenco con prima e ora", d.testo.includes("DOCUMENTI PUBBLICATI O SOSTITUITI\n- Capitolato speciale d'appalto\n  Prima: versione del 2 novembre 2026\n  Ora: versione 2 del 17 novembre 2026"));
  const a = componiEmailRadar(ANNULLAMENTO, TITOLARE_ALFA);
  atteso("E11 annullamento: titolo, motivo della fonte, nessun cambiamento inventato", a.oggetto.startsWith("Gara annullata:") && a.testo.includes("Motivo indicato dalla fonte: Procedura annullata in autotutela.") && !/Prima:|Ora:/.test(a.testo) && !a.testo.includes(RIMANDO_AVVISO_UFFICIALE));
}

// ───── E12. Riepilogo delle nuove opportunità: al massimo 20 gare elencate ─────

{
  for (const evento of [NUOVE_OPPORTUNITA, NUOVE_OPPORTUNITA_MOTORE]) {
    const nome = nomeCaso(evento);
    const { oggetto, html, testo } = componiEmailRadar(evento, TITOLARE_ALFA);
    const tutte = NUOVE_OPPORTUNITA.gare;
    atteso(`E12 ${nome}: 20 gare nel testo e nell'HTML`, tutte.filter((g) => testo.includes(g.denominazione)).length === MASSIMO_GARE_RIEPILOGO && tutte.filter((g) => collegamenti(html).includes(g.urlScheda)).length === MASSIMO_GARE_RIEPILOGO);
    atteso(`E12 ${nome}: le altre 3 annunciate`, testo.includes("E altre 3 gare in «Per te».") && visibile(html).includes("E altre 3 gare in «Per te»."));
    atteso(`E12 ${nome}: oggetto con il totale (23)`, oggetto === "23 nuove gare per te", oggetto);
    atteso(`E12 ${nome}: collegamento a «Per te»`, collegamenti(html).includes(URL_PER_TE) && testo.includes(`Apri «Per te» in OMNIA AI: ${URL_PER_TE}`));
    atteso(`E12 ${nome}: il perché della pertinenza`, testo.includes("nel tuo profilo: Pulizia · Lombardia") && visibile(html).includes("nel tuo profilo: Pulizia · Lombardia"));
    atteso(`E12 ${nome}: «ultimo aggiornamento rilevato dalla fonte il …»`, testo.includes("ultimo aggiornamento rilevato dalla fonte il 19/11/2026 alle 08:42"));
  }
  const conLotti = componiEmailRadar(NUOVE_OPPORTUNITA, TITOLARE_ALFA).testo;
  atteso("E12 gara con scadenze diverse per lotto: «Prima scadenza», mai una scadenza comune", conLotti.includes("Prima scadenza: sabato 5 dicembre 2026, ore 12:00 · scadenze diverse per lotto"));
  const una = componiEmailRadar({ ...NUOVE_OPPORTUNITA, gare: NUOVE_OPPORTUNITA.gare.slice(0, 1) }, TITOLARE_ALFA);
  atteso("E12 singolare: «1 nuova gara per te», nessuna «altra»", una.oggetto === "1 nuova gara per te" && !una.testo.includes("E altre") && !una.testo.includes("un'altra"));
  atteso("E12 «altre» negativo ignorato", componiEmailRadar({ ...NUOVE_OPPORTUNITA, gare: NUOVE_OPPORTUNITA.gare.slice(0, 2), altreNonIncluse: -4 }, TITOLARE_ALFA).oggetto === "2 nuove gare per te");
}

// ───── L. Modifica 2: scadenze per GRUPPO di lotti, mai una scadenza comune inesistente ─────

const RIGA_PER = (t: string) => t.split("\n").find((r) => r.startsWith("Per: ")) ?? "";
const RIGA_CIG = (t: string) => t.split("\n").find((r) => /^CIG( dei lotti interessati)?: /.test(r)) ?? "";
{
  const t = componiEmailRadar(DUE_GRUPPI, TITOLARE_ALFA);
  atteso("L1 due gruppi, primo: la scadenza del SUO gruppo", t.testo.includes("SCADENZA PER LE OFFERTE: mercoledì 25 novembre 2026, ore 12:00"));
  uguale("L1 due gruppi, primo: «Per» elenca SOLO i lotti 1 e 2 con i loro CIG", RIGA_PER(t.testo), "Per: lotto 1 — Zona nord (CIG A0SINT1601) · lotto 2 — Zona sud (CIG A0SINT1602)");
  uguale("L1 due gruppi, primo: CIG SOLO del gruppo", RIGA_CIG(t.testo), "CIG dei lotti interessati: A0SINT1601, A0SINT1602");
  atteso("L1 due gruppi, primo: l'altra scadenza elencata a parte con i SUOI lotti", t.testo.includes("LE ALTRE SCADENZE DELLA GARA\n- mercoledì 2 dicembre 2026 · ora non indicata dalla fonte — lotto 3 — Zona montana (CIG A0SINT1603) · lotto 4 — Isole (CIG A0SINT1604)"));
  atteso("L1 due gruppi, primo: oggetto con i lotti interessati", t.oggetto.endsWith("(lotti 1 e 2)"));
  const vis = visibile(t.html);
  atteso("L1 due gruppi, primo (HTML): il riquadro porta solo i lotti 1 e 2", vis.includes("Scadenza per le offerte mercoledì 25 novembre 2026, ore 12:00 per lotto 1 — Zona nord (CIG A0SINT1601) · lotto 2 — Zona sud (CIG A0SINT1602) Gara "));
  atteso("L1 due gruppi, primo (HTML): CIG solo del gruppo", vis.includes("CIG dei lotti interessati A0SINT1601, A0SINT1602 Tipo di avviso"));
  const t2 = componiEmailRadar(DUE_GRUPPI_SECONDO, TITOLARE_ALFA).testo;
  uguale("L2 due gruppi, secondo: «Per» e CIG solo dei lotti 3 e 4", [RIGA_PER(t2), RIGA_CIG(t2)], ["Per: lotto 3 — Zona montana (CIG A0SINT1603) · lotto 4 — Isole (CIG A0SINT1604)", "CIG dei lotti interessati: A0SINT1603, A0SINT1604"]);
  atteso("L2 due gruppi, secondo: senza ora resta «ora non indicata», l'altra scadenza è quella dei lotti 1 e 2", t2.includes("SCADENZA PER LE OFFERTE: mercoledì 2 dicembre 2026 · ora non indicata dalla fonte") && t2.includes("- mercoledì 25 novembre 2026, ore 12:00 — lotto 1 — Zona nord (CIG A0SINT1601) · lotto 2 — Zona sud (CIG A0SINT1602)"));
  const p = componiEmailRadar(PIU_CIG, TITOLARE_ALFA);
  uguale("L3 un gruppo con più CIG: tutti e solo i suoi", RIGA_CIG(p.testo), "CIG dei lotti interessati: A0SINT1701, A0SINT1702, A0SINT1703");
  atteso("L3 un solo gruppo: nessuna «altra scadenza», oggetto senza lotti", !p.testo.includes("LE ALTRE SCADENZE") && !/\(lott/.test(p.oggetto));
  const s = componiEmailRadar(LOTTI_SENZA_SCADENZA, UFFICIO_GARE_ALFA);
  uguale("L4 lotto senza scadenza: mai nel «Per» né tra i CIG del gruppo", [RIGA_PER(s.testo), RIGA_CIG(s.testo)], ["Per: lotto 1 (CIG A0SINT1801) · lotto 2 (CIG A0SINT1802)", "CIG dei lotti interessati: A0SINT1801, A0SINT1802"]);
  atteso("L4 lotto senza scadenza: elencato a parte, senza data", s.testo.includes("- Nessuna scadenza indicata dalla fonte — lotto 3 — Linee extraurbane (CIG A0SINT1803)") && visibile(s.html).includes("Nessuna scadenza indicata dalla fonte lotto 3 — Linee extraurbane (CIG A0SINT1803)"));
  atteso("L4 lotto senza scadenza: l'oggetto dice quali lotti scadono", s.oggetto.endsWith("(lotti 1 e 2)"));
  atteso("L4 nessuna nota «promemoria separati» se non ci sono altre scadenze", !s.testo.includes("promemoria separati"));
  const ret = componiEmailRadar({ ...RETTIFICA, gara: DUE_GRUPPI.gara }, TITOLARE_ALFA).testo;
  atteso(
    "L5 in un avviso di modifica le scadenze della gara sono per gruppo, ognuna con i SUOI lotti",
    ret.includes("Scadenze per le offerte:\n  - mercoledì 25 novembre 2026, ore 12:00 — lotto 1 — Zona nord (CIG A0SINT1601) · lotto 2 — Zona sud (CIG A0SINT1602)\n  - mercoledì 2 dicembre 2026 · ora non indicata dalla fonte — lotto 3 — Zona montana (CIG A0SINT1603) · lotto 4 — Isole (CIG A0SINT1604)"),
  );
  const retHtml = visibile(componiEmailRadar({ ...RETTIFICA, gara: DUE_GRUPPI.gara }, TITOLARE_ALFA).html);
  atteso(
    "L5 (HTML) scadenze per gruppo, ognuna con i SUOI lotti",
    retHtml.includes("Scadenze per le offerte mercoledì 25 novembre 2026, ore 12:00 — lotto 1 — Zona nord (CIG A0SINT1601) · lotto 2 — Zona sud (CIG A0SINT1602)") &&
      retHtml.includes("mercoledì 2 dicembre 2026 · ora non indicata dalla fonte — lotto 3 — Zona montana (CIG A0SINT1603) · lotto 4 — Isole (CIG A0SINT1604)"),
  );
  const pl = componiEmailRadar(PROROGA_LOTTO, TITOLARE_ALFA);
  atteso("L6 proroga di un lotto: nuova scadenza per il SOLO lotto 2, con la precedente", pl.testo.includes("NUOVA SCADENZA PER LE OFFERTE: venerdì 11 dicembre 2026, ore 12:00\nPer: lotto 2 — Sedi periferiche (CIG A0SINT1902)\nScadenza precedente: venerdì 27 novembre 2026, ore 12:00"));
  atteso("L6 proroga di un lotto: il lotto 1 conserva la sua scadenza, elencata a parte", pl.testo.includes("LE ALTRE SCADENZE DELLA GARA\n- venerdì 27 novembre 2026, ore 12:00 — lotto 1 — Campus centrale (CIG A0SINT1901)"));
  atteso("L6 proroga di un lotto: oggetto e introduzione dicono quale lotto", pl.oggetto.endsWith("(lotto 2)") && pl.testo.includes("la scadenza del lotto 2 di una gara salvata o monitorata"));
  const lottoMod = componiEmailRadar({ ...RETTIFICA, modifiche: [mod("importo", "Importo a base di gara", "100", "120", [lotto("2", "A0SINT0002")])] }, TITOLARE_ALFA).testo;
  atteso("L7 modifica di un lotto: il lotto accanto al campo", lottoMod.includes("- Importo a base di gara — lotto 2 (CIG A0SINT0002)\n  Prima: 100\n  Ora: 120"));
  uguale("L8 i lotti delle prove sono distinti tra i due gruppi", [LOTTI_A.map((l) => l.numero), LOTTI_B.map((l) => l.numero)], [["1", "2"], ["3", "4"]]);
}

// ───── U. Modifica 1: email RAGGRUPPATA degli urgenti, nessuno perso ─────

{
  const { oggetto, html, testo } = componiEmailRadar(RAGGRUPPATO, TITOLARE_ALFA);
  const vis = visibile(html);
  atteso("U1 oggetto con il numero degli avvisi", oggetto === "3 avvisi urgenti sulle gare dell'impresa", oggetto);
  atteso("U2 ogni avviso incluso c'è (testo): «AVVISO i DI 3» per tutti, in ordine", [1, 2, 3].every((i) => testo.includes(`AVVISO ${i} DI 3`)) && testo.indexOf("AVVISO 1 DI 3 — SCADENZA DOMANI") < testo.indexOf("AVVISO 2 DI 3 — RETTIFICA") && testo.indexOf("AVVISO 2 DI 3") < testo.indexOf("AVVISO 3 DI 3"));
  atteso("U2 ogni avviso incluso c'è (HTML): «i di 3»", [1, 2, 3].every((i) => vis.includes(`${i} di 3`)));
  for (const e of RAGGRUPPATO.eventi) atteso(`U3 avviso «${e.tipo}» (${e.gara.denominazione.slice(0, 20)}…) con scheda e fonte`, collegamenti(html).includes(e.gara.urlScheda) && testo.includes(e.gara.urlScheda));
  atteso("U3 la scadenza domani con la sua ora", testo.includes("SCADENZA PER LE OFFERTE: venerdì 20 novembre 2026, ore 10:00"));
  atteso("U3 la rettifica con i suoi cambiamenti e quella senza dettaglio con il rimando", testo.includes("- Importo a base di gara\n  Prima: 1.250.000,00 €") && testo.includes(RIMANDO_AVVISO_UFFICIALE));
  atteso("U4 avvertenza, preferenze e piede una volta sola", testo.split("AVVERTENZA.").length === 2 && testo.split("Preferenze delle notifiche:").length === 2);
  atteso("U5 raggruppamento vuoto: errore, nessuna email", errore(() => componiEmailRadar({ ...RAGGRUPPATO, eventi: [] }, TITOLARE_ALFA)).includes("senza avvisi"));
  atteso("U5 avviso di un'altra impresa dentro il raggruppamento: errore", errore(() => componiEmailRadar({ ...RAGGRUPPATO, eventi: [SCADENZA_1, SCADENZA_10_BETA] }, TITOLARE_ALFA)).includes("non appartiene all'impresa"));
  atteso("U5 raggruppamento di un'altra impresa: errore", errore(() => componiEmailRadar(RAGGRUPPATO, TITOLARE_BETA)).includes("non appartiene all'impresa"));
}

// ───── E13. Separazione tra imprese e contratto rispettato ─────

{
  atteso("E13 evento dell'impresa Beta per un destinatario di Alfa: errore, nessuna email", errore(() => componiEmailRadar(SCADENZA_10_BETA, TITOLARE_ALFA)).includes("non appartiene all'impresa"));
  atteso("E13 impresa vuota da entrambe le parti: errore", errore(() => componiEmailRadar({ ...SCADENZA_10, impresaId: "" }, { ...TITOLARE_ALFA, impresaId: "" })).includes("non appartiene all'impresa"));
  atteso("E13 categoria incoerente col tipo: errore", errore(() => componiEmailRadar({ ...SCADENZA_10, categoria: "rettifiche" } as unknown as EventoRadar, TITOLARE_ALFA)).includes("tipo o categoria"));
  atteso("E13 tipo sconosciuto: errore", errore(() => componiEmailRadar({ ...SCADENZA_10, tipo: "toString" } as unknown as EventoRadar, TITOLARE_ALFA)).includes("tipo o categoria"));
  const inventato: GruppoScadenza = { scadenza: scadenza("2026-11-25", "12:00"), ambito: "lotti", lotti: [...LOTTI_A, ...LOTTI_B] };
  atteso("E13 promemoria con un gruppo che non è della gara (scadenza comune inventata): errore", errore(() => componiEmailRadar({ ...DUE_GRUPPI, gruppo: inventato }, TITOLARE_ALFA)).includes("gruppo di scadenza"));
  componiEmailRadar(SCADENZA_10_BETA, TITOLARE_BETA);
  const alfa = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  atteso("E13 nessun dato di Beta nell'email di Alfa composta dopo", !/RISERVATA-BETA|BETA000001|Beta Costruzioni|be7a|Paola/.test(alfa.oggetto + alfa.html + alfa.testo));
  const prima = JSON.stringify(TUTTI);
  for (const c of TUTTI) componiEmailRadar(c, UFFICIO_GARE_ALFA);
  atteso("E13 i contenuti non vengono modificati", JSON.stringify(TUTTI) === prima);
}

// ───── E14. Destinatario: titolare dell'impresa o Ufficio Gare ─────

{
  const t = componiEmailRadar(SCADENZA_10, TITOLARE_ALFA);
  const u = componiEmailRadar(SCADENZA_10, UFFICIO_GARE_ALFA);
  atteso("E14 titolare: «sei il titolare dell'impresa …»", t.testo.includes("perché sei il titolare dell'impresa Alfa Servizi Sintetici S.r.l. in OMNIA AI"));
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
  const ravvicinata = (giorni: number) => componiEmailRadar({ ...SCADENZA_RAVVICINATA, giorniMancanti: giorni }, TITOLARE_ALFA).oggetto;
  atteso("E15 ravvicinata a 0 giorni: «Scadenza oggi»", ravvicinata(0).startsWith("Scadenza oggi:"));
  atteso("E15 ravvicinata a 1 giorno: «Scadenza domani»", ravvicinata(1).startsWith("Scadenza domani:"));
  atteso("E15 ravvicinata con giorni non validi: «Scadenza a breve»", ravvicinata(Number.NaN).startsWith("Scadenza a breve:"));
  atteso("E15 promemoria a 10 giorni: il testo segue il tipo", componiEmailRadar({ ...SCADENZA_10, giorniMancanti: 7 }, TITOLARE_ALFA).oggetto.startsWith("Scadenza tra 10 giorni:"));
}

// ───── E16. I modelli sono puri: nessun database, rete, ambiente od orologio; nessun «23:59»; fuso Europe/Rome ─────

{
  const cartella = path.join(RADICE, "src/lib/radar/email-modelli");
  const file = fs.readdirSync(cartella).filter((f) => f.endsWith(".ts"));
  atteso("E16 file dei modelli presenti, nessuna copia del contratto", ["componi.ts", "formato.ts", "index.ts"].every((f) => file.includes(f)) && !file.includes("contratto.ts"), file.join(", "));
  const IMPORT_AMMESSI = ["@/lib/omnia-ai-email-eventi-calcoli", "@/lib/radar/notifiche/tipi"];
  for (const f of file) {
    const sorgente = fs.readFileSync(path.join(cartella, f), "utf8");
    const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    atteso(`E16 ${f}: nessun database, rete, server, invio, ambiente od orologio`, !/supabase|from "@\/lib\/email"|resend|server-only|next\/|node:|fetch\(|process\.env|Date\.now|new Date\(\)|Math\.random/i.test(codice));
    const importati = [...codice.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    atteso(`E16 ${f}: importa solo i modelli, l'escape condiviso e il contratto di B2`, importati.every((i) => i.startsWith("./") || IMPORT_AMMESSI.includes(i)), importati.join(", "));
    atteso(`E16 ${f}: date solo col fuso Europe/Rome esplicito`, !/timeZone:\s*"(?!Europe\/Rome")/.test(codice) && !/timeZone:\s*[^"F\s]/.test(codice));
    atteso(`E16 ${f}: nessun «23:59»`, !codice.includes("23:59"));
    atteso(`E16 ${f}: righe LF, niente CRLF`, !sorgente.includes("\r\n"));
  }
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

// ───── E20. Deterministica: stessi ingressi = stessi byte, anche con un orologio e una casualità diversi ─────
// Serve all'idempotenza verso Resend (Idempotency-Key per 24 ore). Si ricompone con un orologio spostato di giorni e con Math.random fisso su
// valori diversi: i byte devono restare identici.

function conOrologioDiverso<T>(spostamentoMs: number, casuale: number, f: () => T): T {
  const DataVera = globalThis.Date;
  const casualeVero = Math.random;
  class DataSpostata extends DataVera {
    constructor(...a: [] | [string | number | Date]) {
      if (a.length === 0) super(DataVera.now() + spostamentoMs);
      else super(a[0]);
    }
    static now(): number {
      return DataVera.now() + spostamentoMs;
    }
  }
  globalThis.Date = DataSpostata as DateConstructor;
  Math.random = () => casuale;
  try {
    return f();
  } finally {
    globalThis.Date = DataVera;
    Math.random = casualeVero;
  }
}

{
  const sposta = conOrologioDiverso(1, 0.5, () => Math.random());
  atteso("E20 controllo dell'orologio finto attivo", sposta === 0.5 && Math.random() !== 0.5);
  let diverse = 0;
  for (const c of [...TUTTI, ...ANTEPRIME.map((a) => a.evento)]) {
    for (const destinatario of [TITOLARE_ALFA, UFFICIO_GARE_ALFA]) {
      const prima = JSON.stringify(componiEmailRadar(c, destinatario));
      const subito = JSON.stringify(componiEmailRadar(c, destinatario));
      const avanti = JSON.stringify(conOrologioDiverso(3 * 86_400_000 + 7 * 3_600_000, 0.987, () => componiEmailRadar(c, destinatario)));
      const indietro = JSON.stringify(conOrologioDiverso(-400 * 86_400_000, 0.001, () => componiEmailRadar(c, destinatario)));
      if (prima !== subito || prima !== avanti || prima !== indietro) diverse++;
    }
  }
  atteso("E20 stesso contenuto e stesso destinatario: stessi byte (due chiamate di seguito, orologio +3 giorni, −400 giorni, casualità diversa)", diverse === 0, `${diverse} email diverse`);
}

// ───── E21. Avviso UFFICIALE di modifica senza campi cambiati (d194703; anche rettifiche PVL, 26C) ─────

{
  const casi: [string, EventoModifica][] = [
    ["TED", RETTIFICA_SENZA_DETTAGLIO],
    ["PVL", { ...RETTIFICA_SENZA_DETTAGLIO, gara: { ...RETTIFICA_SENZA_DETTAGLIO.gara, fonti: [{ fonte: "pvl", nome: "PVL ANAC" }] }, evidenza: { ...RETTIFICA_SENZA_DETTAGLIO.evidenza, fonte: "pvl", nomeFonte: "PVL ANAC", avvisoId: null, avvisoUrl: "https://piattaforma-gare.example/procedure/6/avviso" } }],
    ["documenti", { ...DOCUMENTI, modifiche: [], evidenza: { ...DOCUMENTI.evidenza, affidabilita: "avviso_ufficiale" } }],
  ];
  for (const [nome, evento] of casi) {
    const { html, testo, oggetto } = componiEmailRadar(evento, TITOLARE_ALFA);
    const vis = visibile(html);
    atteso(`E21 ${nome}: rimanda all'avviso ufficiale (testo e HTML)`, testo.includes(RIMANDO_AVVISO_UFFICIALE) && vis.includes(RIMANDO_AVVISO_UFFICIALE));
    atteso(`E21 ${nome}: nessun cambiamento elencato o supposto`, !/Prima:|Ora:|CHE COSA È CAMBIATO|DOCUMENTI PUBBLICATI|Che cosa è cambiato|Documenti pubblicati/.test(testo + vis));
    atteso(`E21 ${nome}: il collegamento all'avviso c'è`, collegamenti(html).includes(evento.evidenza.avvisoUrl ?? "-") && testo.includes(`Avviso: ${evento.evidenza.avvisoUrl}`));
    atteso(`E21 ${nome}: oggetto del tipo`, oggetto.startsWith(evento.tipo === "documenti" ? "Nuovi documenti di gara:" : "Rettifica:"));
  }
}

// ───── E22. Fonte mancante ed evidenza da confronto di versioni ─────

{
  const senzaFonte: EventoModifica = {
    ...RETTIFICA,
    gara: { ...RETTIFICA.gara, fonti: [], urlFonteUfficiale: null } as GaraEmail,
    evidenza: { fonte: "", nomeFonte: "", avvisoId: null, avvisoUrl: null, pubblicatoIl: null, rilevatoIl: "2026-11-19T05:10:00Z", affidabilita: "confronto_versioni", motivoFonte: null },
  };
  const { html, testo } = componiEmailRadar(senzaFonte, TITOLARE_ALFA);
  const vis = visibile(html);
  atteso("E22 senza fonte né avviso: «Fonte del cambiamento: avviso ufficiale.» senza buchi", testo.includes("Fonte del cambiamento: avviso ufficiale.\n") && !/su ,|su \.| ,|\(\)/.test(testo));
  atteso("E22 confronto di versioni dichiarato", testo.includes("Cambiamento rilevato confrontando due versioni ufficiali della gara pubblicate dalla fonte.") && vis.includes("Cambiamento rilevato confrontando due versioni ufficiali"));
  atteso("E22 nessun collegamento o riga di fonte inventati", !testo.includes("Fonte ufficiale:") && !testo.includes("Avviso: http") && !/\nFonte: /.test(testo) && !vis.includes("Oppure vai direttamente alla fonte ufficiale"));
}

// ───── E23. Mai «verificata» né valori grezzi in nessuna email ─────

{
  let problemi = 0;
  for (const c of [...TUTTI, ...ANTEPRIME.map((a) => a.evento)]) {
    const { html, testo, oggetto } = componiEmailRadar(c, UFFICIO_GARE_ALFA);
    const tutto = `${oggetto}\n${visibile(html)}\n${testo}`;
    if (/verificat/i.test(tutto) || /\bundefined\b|\bnull\b|\bNaN\b|\[object/.test(tutto)) problemi++;
  }
  atteso("E23 nessuna email dice «verificata» o mostra valori grezzi", problemi === 0, `${problemi} email`);
}

console.log(fallimenti.length ? `\n${fallimenti.length} controlli FALLITI` : "\nTutti i controlli dei modelli delle email B4 sono passati.");
process.exit(fallimenti.length ? 1 : 0);
