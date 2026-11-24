// Prove di mutazione dei modelli delle email B4 (contratto v2). Per ogni mutazione si altera UN punto dei sorgenti, si lancia
// scripts/verifica-radar-b4-ui-email.ts e la verifica DEVE fallire (con `richiede`, proprio nel controllo indicato). Motore comune:
// scripts/lib/esegui-mutazioni.mjs (ripristino dal buffer, mai git checkout, sorgenti committati prima, impronte controllate alla fine).
// Uso: node scripts/mutazioni-radar-b4-ui-email.mjs (dopo il commit dei modelli: altrimenti si ferma)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eseguiMutazioni } from "./lib/esegui-mutazioni.mjs";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPONI = "src/lib/radar/email-modelli/componi.ts";
const FORMATO = "src/lib/radar/email-modelli/formato.ts";

const MUTAZIONI = [
  { nome: "M1 ora accettata senza controllo", file: FORMATO, cerca: 'return /^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(ora ?? "")) ? String(ora) : null;', con: "return ora ? String(ora) : null;" },
  { nome: "M2 ora presunta quando manca", file: FORMATO, cerca: "return ora ? `${giorno}, ore ${ora}` : `${giorno} · ${senzaOra}`;", con: 'return `${giorno}, ore ${ora ?? "23:" + "59"}`;' },
  { nome: "M3 denominazione senza escape", file: COMPONI, cerca: 'campo("Gara", esc(riga(gara.denominazione) || "senza denominazione"))', con: 'campo("Gara", riga(gara.denominazione) || "senza denominazione")' },
  { nome: "M4 collegamenti di qualunque schema", file: FORMATO, cerca: "return /^https?:\\/\\/[^\\s<>\"'\\u0000-\\u001f]+$/i.test(u) ? u : null;", con: "return u || null;" },
  { nome: "M5 avvertenza tolta dall'HTML", file: COMPONI, cerca: '<strong style="color:${TESTO};">Avvertenza.</strong> ${esc(AVVERTENZA_EMAIL)}', con: '<strong style="color:${TESTO};">Avvertenza.</strong>' },
  { nome: "M6 nessun controllo dell'impresa", file: COMPONI, cerca: "destinatario.impresaId !== contenuto.impresaId", con: "false" },
  { nome: "M7 riepilogo senza tetto di 20", file: COMPONI, cerca: "tabellaCampi(contenuto.gare.slice(0, MASSIMO_GARE_RIEPILOGO).map(schedaRiepilogo))", con: "tabellaCampi(contenuto.gare.map(schedaRiepilogo))" },
  { nome: "M8 riga CIG anche senza CIG", file: COMPONI, cerca: 'if (cig.valori.length) righe.push(campo(cig.etichetta, esc(cig.valori.join(", "))));', con: 'righe.push(campo(cig.etichetta, esc(cig.valori.join(", ") || "-")));' },
  { nome: "M9 avviso senza dettaglio taciuto", file: COMPONI, cerca: 'return evento.evidenza.affidabilita === "avviso_ufficiale" ? RIMANDO_AVVISO_UFFICIALE : DETTAGLIO_NON_DISPONIBILE;', con: "return null;" },
  { nome: "M10 caratteri di controllo nell'oggetto", file: FORMATO, cerca: 'return String(testo ?? "").replace(/[\\u0000-\\u001f\\u007f]+/g, " ").replace(/\\s+/g, " ").trim();', con: 'return String(testo ?? "").trim();' },
  { nome: "M11 modifica della scadenza detta «prorogata»", file: COMPONI, cerca: 'const verbo = contenuto.tipo === "proroga" ? "prorogata" : "modificata";', con: 'const verbo = "prorogata";' },
  { nome: "M12 preferenze tolte dal testo semplice", file: COMPONI, cerca: "preferenze ? `Preferenze delle notifiche: ${preferenze}` :", con: "false ? `${preferenze}` :" },
  { nome: "M13 Ufficio Gare chiamato titolare", file: COMPONI, cerca: 'if (destinatario.ruolo === "titolare") {', con: "if (true) {" },
  { nome: "M14 avvertenza tolta dal testo semplice", file: COMPONI, cerca: "    `AVVERTENZA. ${AVVERTENZA_EMAIL}`,", con: "    `AVVERTENZA.`," },
  { nome: "M15 giorno della settimana nel fuso sbagliato", file: FORMATO, cerca: 'new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, weekday: "long"', con: 'new Intl.DateTimeFormat("it-IT", { timeZone: "Pacific/Kiritimati", weekday: "long"' },
  { nome: "M16 «altre» del motore ignorate", file: COMPONI, cerca: "const fuori = Number.isInteger(evento.altreNonIncluse) && evento.altreNonIncluse > 0 ? evento.altreNonIncluse : 0;", con: "const fuori = 0;" },
  { nome: "M17 categoria non controllata", file: COMPONI, cerca: " || CATEGORIA_DEL_TIPO[e.tipo] !== e.categoria", con: "" },
  { nome: "M18 scadenza ripetuta tra gli altri cambiamenti", file: COMPONI, cerca: '? valide.filter((m) => m.campo !== "scadenza") : valide;', con: "? valide : valide;" },
  { nome: "M19 nota della gara aggiunta a mano tolta", file: COMPONI, cerca: '(gara.aggiuntaAMano ? nota(NOTA_AGGIUNTA_A_MANO) : "") +', con: '"" +' },
  { nome: "M20 ora mancante attribuita alla fonte anche per le gare aggiunte", file: FORMATO, cerca: 'senzaOra: scadenza?.origine === "impresa" ? TESTO_ORA_NON_INDICATA_IMPRESA : TESTO_ORA_NON_INDICATA,', con: "senzaOra: TESTO_ORA_NON_INDICATA," },
  { nome: "M22 motivo della fonte tolto", file: COMPONI, cerca: 'riga(evidenza.motivoFonte) ? `Motivo indicato dalla fonte: ${riga(evidenza.motivoFonte)}.` : "",', con: '"",' },
  { nome: "M23 «ultima verifica» al posto dell'ultimo aggiornamento rilevato", file: COMPONI, cerca: 'return gara.aggiuntaAMano ? "Ultimo aggiornamento della gara aggiunta" : "Ultimo aggiornamento rilevato dalla fonte";', con: 'return "Ultima verifica sulla fonte";' },
  { nome: "M24 perché della pertinenza tolto dal testo", file: COMPONI, cerca: "if (motivo) righe.push(`   ${motivo}`);", con: "" },
  // determinismo: devono far fallire la prova dinamica E20, non solo la scansione del sorgente
  {
    nome: "M25 Date.now() nell'HTML",
    file: COMPONI,
    cerca: '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(t.introduzione)}</div>',
    con: '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(t.introduzione)}<!-- ${Date.now()} --></div>',
    richiede: "E20",
  },
  { nome: "M26 new Date() nel testo semplice", file: COMPONI, cerca: "    NON_RISPONDERE,\n  ];", con: "    NON_RISPONDERE,\n    new Date().toISOString(),\n  ];", richiede: "E20" },
  { nome: "M27 Math.random() nell'oggetto", file: COMPONI, cerca: "const oggetto = breve(t.oggetto, 150);", con: 'const oggetto = breve(t.oggetto + (Math.random() > 0.5 ? " ·" : ""), 150);', richiede: "E20" },
  // contratto v2, modifica 2: scadenze per gruppo di lotti
  {
    nome: "M28 scadenza comune su tutti i lotti (riquadro dell'HTML)",
    file: COMPONI,
    cerca: 'const perLotti = gruppo.ambito === "lotti" && gruppo.lotti.length ? `per ${esc(elencoLotti(gruppo.lotti))}` : "";',
    con: "const perLotti = `per ${esc(elencoLotti(gara.scadenze.flatMap((g) => g.lotti).concat(gara.lottiSenzaScadenza)))}`;",
    richiede: "L",
  },
  {
    nome: "M29 scadenza comune su tutti i lotti (testo)",
    file: COMPONI,
    cerca: 'if (gruppo.ambito === "lotti" && gruppo.lotti.length) righe.push(`Per: ${elencoLotti(gruppo.lotti)}`);',
    con: "righe.push(`Per: ${elencoLotti(gara.scadenze.flatMap((g) => g.lotti).concat(gara.lottiSenzaScadenza))}`);",
    richiede: "L",
  },
  {
    nome: "M30 una sola scadenza per tutta la gara (testo)",
    file: COMPONI,
    cerca: 'const unica = gara.scadenze.length === 1 && gara.scadenze[0].ambito === "procedura" && !gara.lottiSenzaScadenza.length;\n  if (unica) return [',
    con: "const unica = gara.scadenze.length >= 1;\n  if (unica) return [",
    richiede: "L",
  },
  {
    nome: "M31 una sola scadenza per tutta la gara (HTML)",
    file: COMPONI,
    cerca: 'const unica = gara.scadenze.length === 1 && gara.scadenze[0].ambito === "procedura" && !gara.lottiSenzaScadenza.length;\n  if (unica) return scadenzaHtml(',
    con: "const unica = gara.scadenze.length >= 1;\n  if (unica) return scadenzaHtml(",
    richiede: "L",
  },
  {
    nome: "M32 CIG del gruppo sbagliato (HTML: tutti i CIG della gara)",
    file: COMPONI,
    cerca: 'const cigGruppo = gruppo.ambito === "lotti" ? { etichetta: "CIG dei lotti interessati", valori: cigDelGruppo(gruppo) } : undefined;',
    con: 'const cigGruppo = gruppo.ambito === "lotti" ? { etichetta: "CIG dei lotti interessati", valori: gara.cig } : undefined;',
    richiede: "L",
  },
  {
    nome: "M33 CIG del gruppo sbagliato (testo: tutti i CIG della gara)",
    file: COMPONI,
    cerca: 'cig: gruppo.ambito === "lotti" ? { etichetta: "CIG dei lotti interessati", valori: cigDelGruppo(gruppo) } : undefined }',
    con: 'cig: gruppo.ambito === "lotti" ? { etichetta: "CIG dei lotti interessati", valori: gara.cig } : undefined }',
    richiede: "L",
  },
  { nome: "M34 lotti senza scadenza persi", file: COMPONI, cerca: "if (!altri.length && !gara.lottiSenzaScadenza.length) return [];", con: "if (!altri.length) return [];", richiede: "L" },
  { nome: "M35 gruppo di scadenza non controllato", file: COMPONI, cerca: 'if (e.categoria === "scadenze" && !e.gara.scadenze.some((g) => stessoGruppo(g, e.gruppo))) {', con: "if (false) {", richiede: "E13" },
  { nome: "M36 proroga di un lotto senza le altre scadenze (testo)", file: COMPONI, cerca: 'if (cambio.lotti.length) righe.push(...altreScadenzeTesto(gara, { scadenza: cambio.nuova, ambito: "lotti", lotti: cambio.lotti }));', con: "", richiede: "L6" },
  // contratto v2, modifica 1: email raggruppata degli urgenti
  { nome: "M37 urgente perso nel raggruppamento (HTML)", file: COMPONI, cerca: "return contenuto.eventi\n      .map((e, i) => {", con: "return contenuto.eventi.slice(0, -1)\n      .map((e, i) => {", richiede: "U" },
  { nome: "M38 urgente perso nel raggruppamento (testo)", file: COMPONI, cerca: "return contenuto.eventi.flatMap((e, i) => {", con: "return contenuto.eventi.slice(1).flatMap((e, i) => {", richiede: "U" },
  { nome: "M39 raggruppamento vuoto accettato", file: COMPONI, cerca: 'if (!Array.isArray(contenuto.eventi) || contenuto.eventi.length === 0) throw new Error("componiEmailRadar: raggruppamento senza avvisi");', con: "", richiede: "U5" },
  { nome: "M40 avviso di un'altra impresa nel raggruppamento", file: COMPONI, cerca: "for (const e of contenuto.eventi) controllaEvento(e, contenuto.impresaId);", con: "for (const e of contenuto.eventi) controllaEvento(e, e.impresaId);", richiede: "U5" },
];

process.exit(eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-radar-b4-ui-email.ts", mutazioni: MUTAZIONI }));
