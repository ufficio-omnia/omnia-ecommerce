// Verifiche della newsletter Tender Weekly (nessuna rete, nessun database): template, normalizzazione, filtro delle
// fonti della generazione AI, calendario con ora legale, destinatari, firma del webhook, eventi, e i flussi completi
// (prova, approvazione, doppio invio, disiscrizione) sull'archivio locale in una cartella temporanea.
import fs from "fs";
import os from "os";
import path from "path";
import { createHmac } from "crypto";

let errori = 0;
let controlli = 0;
function atteso(nome: string, ok: boolean, dettaglio = "") {
  controlli++;
  if (!ok) {
    errori++;
    console.error(`✗ ${nome}${dettaglio ? ` — ${dettaglio}` : ""}`);
  }
}
function uguale<T>(nome: string, a: T, b: T) {
  atteso(nome, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

const fileArchivio = path.join(os.tmpdir(), `verifica-newsletter-${process.pid}.json`);
process.env.NEWSLETTER_ARCHIVIO = "locale";
process.env.NEWSLETTER_ARCHIVIO_FILE = fileArchivio;
delete process.env.VERCEL_ENV;
delete process.env.VERCEL;

async function main() {
  const { renderNewsletterHtml, renderNewsletterTesto, numeroEdizione, dataLunga } = await import("../src/lib/newsletter/template");
  const { normalizzaContenuto, controllaEdizione, urlSicuro } = await import("../src/lib/newsletter/contenuto");
  const { filtraBozza, urlDaRisultatiRicerca } = await import("../src/lib/newsletter/generazione");
  const p = await import("../src/lib/newsletter/pianificazione");
  const { selezionaDestinatari, candidatiDaAbbonati, emailValida } = await import("../src/lib/newsletter/destinatari");
  const { verificaFirmaSvix, applicaEvento, gestisciEvento } = await import("../src/lib/newsletter/webhook");
  const { invioRealeConsentito } = await import("../src/lib/newsletter/posta");
  const { archivioNewsletter } = await import("../src/lib/newsletter/archivio");
  const { inviaProva, avviaInvio, riprendiInvio, statistiche } = await import("../src/lib/newsletter/invio");
  const { disiscriviConToken, riattivaConToken, mascheraEmail } = await import("../src/lib/newsletter/disiscrizione");
  const { eseguiPassaggioNewsletter } = await import("../src/lib/newsletter/cron");
  const { contenutoVuoto } = await import("../src/lib/newsletter/tipi");

  console.log("--- 1. Template ---");
  const c = normalizzaContenuto({
    editoriale: { attivo: true, titolo: "Benvenuti <b>", testo: "Primo paragrafo.\n\nSecondo & ultimo.", firma: "La redazione" },
    sezioni: [
      { chiave: "notizia", attiva: true, notizie: [{ titolo: "ANAC <script>alert(1)</script>", sintesi: "Testo", evidenza: "Dato chiave", implicazioni: "Cosa fare", fonti: [{ titolo: "ANAC", url: "https://www.anticorruzione.it/-/x", data: "2026-11-25" }, { titolo: "js", url: "javascript:alert(1)" }] }] },
      { chiave: "normativa", attiva: true, notizie: [{ titolo: "Sentenza", sintesi: "x", fonti: [{ titolo: "GA", url: "https://www.giustizia-amministrativa.it/a" }] }] },
      { chiave: "omnia", attiva: false, notizie: [] },
    ],
  });
  const dati = { numero: 1, data_edizione: "2026-11-27", oggetto: "Oggetto \"prova\"", preheader: "Anteprima", contenuto: c };
  const html = renderNewsletterHtml(dati, { urlDisiscrizione: "https://omnia-ai.it/newsletter/disiscrizione?t=abc" });
  const testo = renderNewsletterTesto(dati, { urlDisiscrizione: "https://omnia-ai.it/newsletter/disiscrizione?t=abc" });
  atteso("il testo del modello è neutralizzato (niente <script>)", !html.includes("<script>") && html.includes("&lt;script&gt;"));
  atteso("niente JavaScript nel template", !/<script|javascript:|onclick=/i.test(html));
  atteso("un indirizzo javascript: non diventa una fonte", !c.sezioni[0].notizie[0].fonti.some((f) => f.url.startsWith("javascript")) && c.sezioni[0].notizie[0].fonti.length === 1);
  atteso("intestazione con numero e data", html.includes("Edizione n.&nbsp;001") && html.includes("27 novembre 2026"));
  atteso("testata, sottotitolo e claim", html.includes("TENDER WEEKLY") && html.includes("Il mondo degli appalti pubblici, ogni settimana.") && html.includes("TECH WHEN POSSIBLE. HUMAN WHEN IT MATTERS."));
  atteso("link di disiscrizione nell'HTML e nel testo", html.includes("https://omnia-ai.it/newsletter/disiscrizione?t=abc") && testo.includes("https://omnia-ai.it/newsletter/disiscrizione?t=abc"));
  atteso("logo ufficiale da omnia-ai.it in https", html.includes('src="https://omnia-ai.it/site-omnia-ai/logo.png"'));
  atteso("impaginazione a tabelle e larghezza massima 640", html.includes('role="presentation"') && html.includes("max-width:640px"));
  atteso("niente flex/grid/variabili CSS", !/display:\s*(flex|grid)|var\(--/.test(html));
  atteso("versione Outlook (mso) e media query per smartphone", html.includes("<!--[if mso]>") && html.includes("@media screen and (max-width:620px)"));
  atteso("sezione spenta e sezione vuota non compaiono", !html.includes("OMNIA AI News"));
  atteso("dati aziendali e privacy nel piè di pagina", html.includes("P.IVA 02957590819") && html.includes("https://omnia-ai.it/privacy"));
  atteso("versione testo con fonti", testo.includes("Fonte: ANAC") && testo.includes("https://www.anticorruzione.it/-/x"));
  atteso("parametri di campagna solo sui link di omnia-ai.it", html.includes("utm_campaign=tender-weekly-001") && !html.includes("anticorruzione.it/-/x?utm"));
  const prova = renderNewsletterHtml(dati, { urlDisiscrizione: "x", prova: true });
  atteso("fascia «EMAIL DI PROVA» solo nella prova", prova.includes("EMAIL DI PROVA") && !html.includes("EMAIL DI PROVA"));
  uguale("numero a tre cifre", numeroEdizione(7), "007");
  uguale("data lunga", dataLunga("2026-03-01"), "1 marzo 2026");
  uguale("urlSicuro rifiuta ftp", urlSicuro("ftp://x.it/a"), null);

  console.log("--- 2. Controlli prima dell'approvazione ---");
  const vuota = controllaEdizione({ oggetto: "", preheader: "", contenuto: contenutoVuoto() });
  atteso("edizione vuota e senza oggetto: bloccata", vuota.bloccanti.length >= 2);
  const senzaFonti = controllaEdizione({ oggetto: "Oggetto valido", preheader: "p", contenuto: normalizzaContenuto({ sezioni: [{ chiave: "normativa", notizie: [{ titolo: "T", sintesi: "S", fonti: [] }] }] }) });
  atteso("notizia normativa senza fonti: bloccata", senzaFonti.bloccanti.some((b) => b.includes("fonti")));
  atteso("edizione completa: approvabile", controllaEdizione(dati).bloccanti.length === 0, JSON.stringify(controllaEdizione(dati).bloccanti));

  console.log("--- 3. Generazione AI: fonti solo dai risultati della ricerca ---");
  const blocchi = [
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.anticorruzione.it/-/vera?utm_source=x", title: "a" }] },
    { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://www.mit.gov.it/notizia" } },
  ];
  const verificati = urlDaRisultatiRicerca(blocchi);
  atteso("gli indirizzi della ricerca e della lettura sono raccolti", verificati.size === 2, [...verificati].join(","));
  const f = filtraBozza(
    {
      oggetto: "  Oggetto   ",
      preheader: "Pre",
      sezioni: {
        notizia: [
          { titolo: "Vera", sintesi: "s", fonti: [{ titolo: "ANAC", url: "https://anticorruzione.it/-/vera", data: "2026-11-25" }] },
          { titolo: "Seconda", sintesi: "s", fonti: [{ titolo: "MIT", url: "https://www.mit.gov.it/notizia/", data: "2026-10-01" }] },
        ],
        normativa: [{ titolo: "Inventata", sintesi: "s", fonti: [{ titolo: "x", url: "https://www.giustizia-amministrativa.it/inventata" }] }],
        esperto: [{ titolo: "Approfondimento", sintesi: "s", fonti: [] }],
        omnia: [{ titolo: "Non deve esserci", sintesi: "s", fonti: [] }],
      },
    },
    verificati,
    "2026-11-27",
  );
  const sez = (k: string) => f.contenuto.sezioni.find((s) => s.chiave === k)!;
  uguale("notizia con fonte verificata: resta (una sola nella sezione A)", sez("notizia").notizie.map((n) => n.titolo), ["Vera"]);
  atteso("la seconda notizia della settimana scende in Normativa", sez("normativa").notizie.some((n) => n.titolo === "Seconda"));
  atteso("notizia con link non trovato nella ricerca: tolta", !sez("normativa").notizie.some((n) => n.titolo === "Inventata") && f.notizieScartate === 1 && f.fontiScartate === 1);
  atteso("fonte vecchia segnalata nelle note", f.note.some((n) => n.includes("2026-10-01")));
  atteso("l'approfondimento senza fonti resta", sez("esperto").notizie.length === 1);
  atteso("la sezione OMNIA AI News resta vuota e spenta", sez("omnia").notizie.length === 0 && !sez("omnia").attiva);
  uguale("oggetto ripulito", f.oggetto, "Oggetto");

  console.log("--- 4. Calendario Europe/Rome ---");
  // giovedì 26/11/2026 18:00 Roma = 17:00 UTC (ora solare)
  uguale("giovedì 18:00 in inverno", p.scadenzaNellaSettimana(4, "18:00", new Date("2026-11-27T09:00:00Z")).toISOString(), "2026-11-26T17:00:00.000Z");
  // venerdì 10:00 d'estate = 08:00 UTC
  uguale("venerdì 10:00 in estate", p.scadenzaNellaSettimana(5, "10:00", new Date("2026-07-01T09:00:00Z")).toISOString(), "2026-07-03T08:00:00.000Z");
  uguale("venerdì 27/03/2026 10:00 (prima del cambio)", p.scadenzaNellaSettimana(5, "10:00", new Date("2026-03-25T09:00:00Z")).toISOString(), "2026-03-27T09:00:00.000Z");
  uguale("venerdì 03/04/2026 10:00 (dopo il cambio)", p.scadenzaNellaSettimana(5, "10:00", new Date("2026-04-01T09:00:00Z")).toISOString(), "2026-04-03T08:00:00.000Z");
  uguale("prossimo venerdì da venerdì 27/11 alle 11 Roma", p.prossimaScadenza(5, "10:00", new Date("2026-11-27T10:00:00Z")).toISOString(), "2026-12-04T09:00:00.000Z");
  uguale("prossimo venerdì da venerdì 27/11 alle 9 Roma", p.prossimaScadenza(5, "10:00", new Date("2026-11-27T08:00:00Z")).toISOString(), "2026-11-27T09:00:00.000Z");
  atteso("generazione dovuta giovedì 18:30", p.generazioneDovuta(4, "18:00", new Date("2026-11-26T17:30:00Z")));
  atteso("generazione non dovuta giovedì 17:59", !p.generazioneDovuta(4, "18:00", new Date("2026-11-26T16:59:00Z")));
  atteso("generazione non dovuta sabato (fuori finestra)", !p.generazioneDovuta(4, "18:00", new Date("2026-11-28T12:00:00Z")));
  uguale("settimana ISO", p.settimanaIso(new Date("2026-11-27T12:00:00Z")), "2026-W48");
  uguale("settimana ISO a cavallo d'anno", p.settimanaIso(new Date("2027-01-01T12:00:00Z")), "2026-W53");
  uguale("input datetime-local ↔ istante", p.daInputLocale(p.perInputLocale(new Date("2026-11-27T09:00:00Z")))?.toISOString(), "2026-11-27T09:00:00.000Z");
  atteso("ora non valida rifiutata", !p.oraValida("24:00") && p.oraValida("09:30"));

  console.log("--- 5. Destinatari: nessun consenso presunto ---");
  const base = { nome: null, categoria: "cliente" as const, base_giuridica: "consenso" as const, prova_base: "consenso via email del 27/11/2026", base_dal: "2026-11-27", token_disiscrizione: "t", disiscritto_il: null, motivo_uscita: null, creato_il: "" };
  const iscritti = [
    { ...base, id: "1", email: "a@x.it", user_id: "u1", stato: "iscritto" as const },
    { ...base, id: "2", email: "b@x.it", user_id: null, stato: "iscritto" as const },
    { ...base, id: "3", email: "c@x.it", user_id: null, stato: "disiscritto" as const },
    { ...base, id: "4", email: "d@x.it", user_id: null, stato: "iscritto" as const, prova_base: "" },
    { ...base, id: "5", email: "e@x.it", user_id: null, stato: "rimbalzato" as const },
  ];
  const abbonati = [{ userId: "u1", email: "a@x.it" }, { userId: "u9", email: "nonsiscritto@x.it" }];
  const tutti = selezionaDestinatari(iscritti, abbonati, { abbonati_attivi: true, altri_autorizzati: true });
  uguale("inclusi solo iscritti con base documentata", tutti.inclusi.map((i) => i.email), ["a@x.it", "b@x.it"]);
  atteso("disiscritto, senza prova e rimbalzato: esclusi", tutti.esclusi.length === 3);
  atteso("l'abbonato non iscritto NON riceve", !tutti.inclusi.some((i) => i.email === "nonsiscritto@x.it"));
  uguale("solo abbonati", selezionaDestinatari(iscritti, abbonati, { abbonati_attivi: true, altri_autorizzati: false }).inclusi.map((i) => i.email), ["a@x.it"]);
  uguale("solo altri", selezionaDestinatari(iscritti, abbonati, { abbonati_attivi: false, altri_autorizzati: true }).inclusi.map((i) => i.email), ["b@x.it"]);
  uguale("candidati: abbonati non iscritti", candidatiDaAbbonati(iscritti, abbonati).map((a) => a.email), ["nonsiscritto@x.it"]);
  atteso("validazione email", emailValida("nome.cognome@azienda.it") && !emailValida("a@b") && !emailValida("x y@z.it"));
  uguale("email mascherata", mascheraEmail("mario.rossi@azienda.it"), "ma••••••@azienda.it");

  console.log("--- 6. Webhook di Resend ---");
  const segreto = "whsec_" + Buffer.from("segreto-di-prova-1234567890").toString("base64");
  const corpo = JSON.stringify({ type: "email.delivered" });
  const ts = String(Math.floor(Date.now() / 1000));
  const firma = createHmac("sha256", Buffer.from("segreto-di-prova-1234567890")).update(`msg_1.${ts}.${corpo}`).digest("base64");
  atteso("firma valida accettata", verificaFirmaSvix(corpo, { id: "msg_1", timestamp: ts, firma: `v1,${firma}` }, segreto));
  atteso("corpo alterato rifiutato", !verificaFirmaSvix(corpo + " ", { id: "msg_1", timestamp: ts, firma: `v1,${firma}` }, segreto));
  atteso("senza segreto: rifiutato", !verificaFirmaSvix(corpo, { id: "msg_1", timestamp: ts, firma: `v1,${firma}` }, undefined));
  atteso("timestamp vecchio rifiutato", !verificaFirmaSvix(corpo, { id: "msg_1", timestamp: ts, firma: `v1,${firma}` }, segreto, Number(ts) + 3600));
  const riga = { id: "r", edizione_id: "e", iscritto_id: "i", tipo: "reale" as const, email: "a@x.it", versione: 1, stato: "rimbalzato" as const, resend_id: "x", errore: null, inviato_il: null, consegnato_il: null, aperto_il: null, cliccato_il: null, clic: 0, creato_il: "" };
  atteso("una consegna dopo un rimbalzo non cancella il rimbalzo", applicaEvento(riga, "email.delivered", "t")?.stato === undefined);
  uguale("un clic conta", applicaEvento({ ...riga, stato: "consegnato" }, "email.clicked", "t")?.clic, 1);

  console.log("--- 7. Flussi completi (archivio locale, invio simulato) ---");
  atteso("fuori dalla produzione l'invio reale è vietato", !invioRealeConsentito(process.env) && !invioRealeConsentito({ RESEND_API_KEY: "x", VERCEL_ENV: "preview" } as NodeJS.ProcessEnv) && invioRealeConsentito({ RESEND_API_KEY: "x", VERCEL_ENV: "production" } as NodeJS.ProcessEnv));
  const a = archivioNewsletter();
  uguale("archivio locale attivo", a.tipo, "locale");
  const ed = await a.creaEdizione({ data_edizione: "2026-11-27", oggetto: dati.oggetto, preheader: "p", contenuto: c }, null);
  const ed2 = await a.creaEdizione({ data_edizione: "2026-11-27", contenuto: contenutoVuoto() }, null);
  uguale("numerazione progressiva", [ed.numero, ed2.numero], [1, 2]);
  const i1 = await a.aggiungiIscritto({ email: "Uno@X.it", nome: null, user_id: null, categoria: "altro", stato: "iscritto", base_giuridica: "consenso", prova_base: "consenso scritto del 27/11/2026", base_dal: "2026-11-27" }, null);
  await a.aggiungiIscritto({ email: "due@x.it", nome: null, user_id: null, categoria: "altro", stato: "iscritto", base_giuridica: "consenso", prova_base: "consenso scritto del 27/11/2026", base_dal: "2026-11-27" }, null);
  uguale("email salvata in minuscolo", i1.email, "uno@x.it");

  const pr = await inviaProva(ed.id, ["test@omniaitalia.com"], null, a);
  atteso("la prova riesce (simulata)", pr.ok && pr.messaggio.includes("SIMULATA"), JSON.stringify(pr));
  uguale("la prova NON cambia lo stato", (await a.leggiEdizione(ed.id))!.stato, "bozza");
  atteso("la prova non conta come invio reale", statistiche(await a.inviiDellEdizione(ed.id)).totale === 0 && statistiche(await a.inviiDellEdizione(ed.id)).prove === 1);
  atteso("più di 5 indirizzi di prova rifiutati", !(await inviaProva(ed.id, ["a@x.it", "b@x.it", "c@x.it", "d@x.it", "e@x.it", "f@x.it"], null, a)).ok);

  const nonApprovata = await avviaInvio(ed.id, null, "manuale", a);
  atteso("un'edizione non approvata non parte", !nonApprovata.ok);
  atteso("programmare senza approvazione: rifiutato dalla guardia", await a.aggiornaEdizione(ed.id, { stato: "programmata", programmata_per: new Date().toISOString() }, ["bozza"]).then(() => false).catch(() => true));

  await a.aggiornaEdizione(ed.id, { stato: "approvata", approvata_il: new Date().toISOString() }, ["bozza"]);
  const modificata = await a.aggiornaEdizione(ed.id, { oggetto: "Oggetto cambiato dopo l'approvazione" }, ["approvata"]);
  uguale("modifica dopo l'approvazione → torna in revisione senza approvazione", [modificata?.stato, modificata?.approvata_il], ["in_revisione", null]);
  await a.aggiornaEdizione(ed.id, { stato: "approvata", approvata_il: new Date().toISOString() }, ["in_revisione"]);

  const [x, y] = await Promise.all([avviaInvio(ed.id, null, "manuale", a), avviaInvio(ed.id, null, "cron", a)]);
  atteso("doppio invio contemporaneo: uno solo parte", [x, y].filter((r) => r.ok).length === 1, JSON.stringify([x, y]));
  let st = statistiche(await a.inviiDellEdizione(ed.id));
  uguale("ogni iscritto ha UNA riga reale", [st.totale, st.inviati], [2, 2]);
  uguale("stato finale «inviata»", (await a.leggiEdizione(ed.id))!.stato, "inviata");
  atteso("un secondo invio della stessa edizione è rifiutato", !(await avviaInvio(ed.id, null, "manuale", a)).ok);
  await a.accodaInvii([{ edizione_id: ed.id, iscritto_id: i1.id, tipo: "reale", email: "uno@x.it", versione: 9, stato: "in_coda" }]);
  st = statistiche(await a.inviiDellEdizione(ed.id));
  uguale("accodare di nuovo lo stesso iscritto non duplica", st.totale, 2);
  atteso("contenuto di un'edizione inviata non modificabile", await a.aggiornaEdizione(ed.id, { oggetto: "no" }, ["inviata"]).then(() => false).catch(() => true));
  atteso("riprendi su un'edizione inviata: rifiutato", !(await riprendiInvio(ed.id, null, a)).ok);

  console.log("--- 8. Disiscrizione ---");
  const tok = i1.token_disiscrizione;
  atteso("token casuale lungo", /^[a-f0-9]{48}$/.test(tok));
  await disiscriviConToken(tok, "prova", a);
  uguale("disiscritto", (await a.iscrittoPerEmail("uno@x.it"))!.stato, "disiscritto");
  await a.aggiornaEdizione(ed2.id, { oggetto: "Edizione 2", contenuto: c }, ["bozza"]);
  await a.aggiornaEdizione(ed2.id, { stato: "approvata", approvata_il: new Date().toISOString() }, ["bozza"]);
  await avviaInvio(ed2.id, null, "manuale", a);
  uguale("il disiscritto non riceve l'edizione successiva", (await a.inviiDellEdizione(ed2.id)).filter((r) => r.tipo === "reale").map((r) => r.email), ["due@x.it"]);
  uguale("riattivazione dal proprio link: nuovo consenso", await riattivaConToken(tok, a), "ok");
  const riattivato = (await a.iscrittoPerEmail("uno@x.it"))!;
  atteso("riattivazione registrata come consenso con data", riattivato.stato === "iscritto" && riattivato.base_giuridica === "consenso" && riattivato.prova_base.includes("link personale"));
  uguale("token sconosciuto", await disiscriviConToken("f".repeat(48), "x", a), null);

  console.log("--- 9. Eventi del webhook sull'archivio ---");
  const rigaDue = (await a.inviiDellEdizione(ed2.id)).find((r) => r.tipo === "reale")!;
  uguale("evento registrato", await gestisciEvento("msg_a", { type: "email.bounced", data: { email_id: rigaDue.resend_id!, bounce: { type: "Permanent" } } }, a), "registrato");
  uguale("lo stesso evento due volte: una sola", await gestisciEvento("msg_a", { type: "email.bounced", data: { email_id: rigaDue.resend_id! } }, a), "già registrato");
  uguale("rimbalzo definitivo → indirizzo escluso dai prossimi invii", (await a.iscrittoPerEmail("due@x.it"))!.stato, "rimbalzato");
  uguale("evento di un'email transazionale: ignorato", await gestisciEvento("msg_b", { type: "email.delivered", data: { email_id: "id-transazionale" } }, a), "ignorato");

  console.log("--- 10. Processo pianificato ---");
  const ed3 = await a.creaEdizione({ data_edizione: "2026-11-27", oggetto: "Edizione 3", contenuto: c }, null);
  await a.aggiornaEdizione(ed3.id, { stato: "approvata", approvata_il: new Date().toISOString() }, ["bozza"]);
  await a.aggiornaEdizione(ed3.id, { stato: "programmata", programmata_per: new Date(Date.now() + 3600_000).toISOString() }, ["approvata"]);
  let gen = 0;
  const finta = async () => {
    gen++;
    return { oggetto: "Generata", preheader: "p", contenuto: c, note: "", ricerche: 1, fontiScartate: 0, notizieScartate: 0 };
  };
  const r1 = await eseguiPassaggioNewsletter(new Date("2026-11-26T17:30:00Z"), a, finta);
  uguale("programmata nel futuro: non parte", r1.invii.length, 0);
  uguale("giovedì 18:30: bozza generata", r1.generazione, "generata");
  const r2 = await eseguiPassaggioNewsletter(new Date("2026-11-26T17:45:00Z"), a, finta);
  uguale("passaggio successivo: nessuna seconda bozza", [r2.generazione, gen], ["gia_presente", 1]);
  const bozzaAuto = (await a.elencoEdizioni()).find((e) => e.origine === "ai_automatica")!;
  uguale("la bozza automatica resta in bozza (non parte)", bozzaAuto.stato, "bozza");
  const r3 = await eseguiPassaggioNewsletter(new Date(Date.now() + 2 * 3600_000), a, finta);
  uguale("all'ora programmata parte solo l'approvata", r3.invii.map((i) => i.edizione), [ed3.numero]);
  const r4 = await eseguiPassaggioNewsletter(new Date(Date.now() + 3 * 3600_000), a, finta);
  uguale("al passaggio dopo non riparte", r4.invii.length, 0);

  console.log("--- 11. Cablaggio ---");
  const leggi = (f: string) => fs.readFileSync(f, "utf8");
  const cron = leggi("src/app/api/cron/newsletter/route.ts");
  atteso("cron: segreto prima di tutto, interruttore spento di base", cron.indexOf("cronAutorizzato") < cron.indexOf("NEWSLETTER_CRON") && /!== "attivo"/.test(cron));
  atteso("cron NON in vercel.json (si accende solo con autorizzazione)", !leggi("vercel.json").includes("/api/cron/newsletter"));
  atteso("le email transazionali non cambiano (mittente noreply invariato)", leggi("src/lib/email.ts").includes('const FROM = "OMNIA <noreply@omniaitalia.com>"'));
  const mig = leggi("supabase/migrations/0141_newsletter_tender_weekly.sql");
  atteso("0141: RLS su tutte e sei le tabelle", (mig.match(/enable row level security/g) ?? []).length === 6);
  atteso("0141: niente accesso per anon/authenticated", /revoke all on[\s\S]*from anon, authenticated/.test(mig) && !/grant [^;]* to (anon|authenticated)/.test(mig));
  atteso("0141: un invio reale per iscritto ed edizione", /unique index if not exists newsletter_invii_un_reale_per_iscritto[\s\S]*\(edizione_id, iscritto_id\)/.test(mig));
  atteso("0141: base giuridica obbligatoria", /base_giuridica text not null/.test(mig) && /prova_base text not null/.test(mig));
  atteso("0141: modifica dopo approvazione → in_revisione", /new\.stato := 'in_revisione'/.test(mig));
  const webhook = leggi("src/app/site-omnia-ai/api/webhooks/resend/route.ts");
  atteso("webhook: firma verificata prima di leggere il corpo come JSON", webhook.indexOf("verificaFirmaSvix") < webhook.indexOf("JSON.parse"));
  const pag = leggi("src/app/site-omnia-ai/newsletter/disiscrizione/page.tsx");
  atteso("pagina di disiscrizione noindex e con conferma via POST", /index: false/.test(pag) && /action=\{confermaDisiscrizione\}/.test(pag));

  fs.rmSync(fileArchivio, { force: true });
  console.log(`\n${controlli - errori}/${controlli} controlli superati.`);
  if (errori) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(fileArchivio, { force: true });
  process.exit(1);
});
