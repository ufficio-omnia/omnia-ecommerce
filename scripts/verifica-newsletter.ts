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
// la build gira con NODE_ENV=production: questa verifica (e solo lei) si dichiara ambiente di prova per usare l'archivio
// locale in una cartella temporanea; la guardia di archivio.ts resta com'è per tutto il resto
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

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
  const comeStringa = filtraBozza(
    { oggetto: "O", preheader: "P", sezioni: JSON.stringify({ notizia: [{ titolo: "Vera", sintesi: "s", fonti: [{ titolo: "ANAC", url: "https://anticorruzione.it/-/vera" }] }], normativa: JSON.stringify([{ titolo: "Due", sintesi: "s", fonti: [{ titolo: "MIT", url: "https://www.mit.gov.it/notizia" }] }]) }) },
    verificati,
    "2026-11-27",
  );
  const homeEAmp = filtraBozza(
    { oggetto: "O", preheader: "P", sezioni: { normativa: [{ titolo: "Solo home", sintesi: "s", fonti: [{ titolo: "ANAC", url: "https://www.anticorruzione.it/en/home" }] }] } },
    new Set([...verificati, "anticorruzione.it/en/home"]),
    "2026-11-27",
  );
  atteso("una fonte che è solo la home page viene tolta (e la notizia senza altre fonti con lei)", homeEAmp.contenuto.sezioni.every((s) => s.notizie.length === 0) && homeEAmp.fontiScartate === 1);
  uguale("«&amp;» negli indirizzi diventa «&»", [urlSicuro("https://x.it/v?a=1&amp;b=2"), urlSicuro("https://x.it/v?a=1&amp=&b=2")], ["https://x.it/v?a=1&b=2", "https://x.it/v?a=1&b=2"]);
  uguale("sezioni passate dal modello come stringa JSON: lette lo stesso", comeStringa.contenuto.sezioni.filter((s) => s.notizie.length).map((s) => s.chiave), ["notizia", "normativa"]);

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
  atteso("fuori dalla produzione l'invio reale è vietato", !invioRealeConsentito(process.env) && !invioRealeConsentito({ RESEND_API_KEY: "x", VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv) && invioRealeConsentito({ RESEND_API_KEY: "x", VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv));
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
  const { generatoriFinti } = await import("./newsletter-prove-versioni");
  const baseFinti = generatoriFinti({ giro: 0, fallisci: false });
  const finta = { ...baseFinti, generaEdizione: async (o: Parameters<typeof baseFinti.generaEdizione>[0]) => (gen++, baseFinti.generaEdizione(o)) };
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
  atteso("0141: RLS su tutte e sette le tabelle", (mig.match(/enable row level security/g) ?? []).length === 7);
  atteso("0141: versioni con numero unico per edizione e contenuto obbligatorio se riuscite", /unique \(edizione_id, numero_versione\)/.test(mig) && /check \(esito = 'fallita' or contenuto is not null\)/.test(mig));
  atteso("0141: costi nello stesso registro (ai_operazioni.dettaglio), nessuna tabella di costi parallela", /alter table public\.ai_operazioni add column if not exists dettaglio jsonb/.test(mig) && !/create table[^(]*cost/i.test(mig));
  atteso("0141: categoria «newsletter» nella funzione dei costi, il resto invariato", /when starts_with\(b\.operazione, 'newsletter_'\) then 'newsletter'/.test(mig) && /when starts_with\(b\.operazione, 'kb_'\) then 'piattaforma'/.test(mig) && /when b\.e_prova then 'prova'/.test(mig));
  atteso("0141: nessuna estensione richiesta (token con gen_random_uuid)", !/create extension/i.test(mig) && !/gen_random_bytes/.test(mig));
  atteso("0141: blocco delle generazioni sull'edizione", /generazione_in_corso_da timestamptz/.test(mig) && /generazione_token uuid/.test(mig));
  atteso("0141: niente accesso per anon/authenticated", /revoke all on[\s\S]*from anon, authenticated/.test(mig) && !/grant [^;]* to (anon|authenticated)/.test(mig));
  atteso("0141: un invio reale per iscritto ed edizione", /unique index if not exists newsletter_invii_un_reale_per_iscritto[\s\S]*\(edizione_id, iscritto_id\)/.test(mig));
  atteso("0141: base giuridica obbligatoria", /base_giuridica text not null/.test(mig) && /prova_base text not null/.test(mig));
  atteso("0141: modifica dopo approvazione → in_revisione", /new\.stato := 'in_revisione'/.test(mig));
  const webhook = leggi("src/app/site-omnia-ai/api/webhooks/resend/route.ts");
  atteso("webhook: firma verificata prima di leggere il corpo come JSON", webhook.indexOf("verificaFirmaSvix") < webhook.indexOf("JSON.parse"));
  const pag = leggi("src/app/site-omnia-ai/newsletter/disiscrizione/page.tsx");
  atteso("pagina di disiscrizione noindex e con conferma via POST", /index: false/.test(pag) && /action=\{confermaDisiscrizione\}/.test(pag));

  console.log("--- 12. Versioni: tre rigenerazioni, ripristino, sezione, notizia, errori, approvazione, concorrenza, costi ---");
  const { provaVersioniECosti } = await import("./newsletter-prove-versioni");
  await provaVersioniECosti(a, atteso, { marcatore: "verifica-locale" });

  console.log("--- 13. Contabilizzazione sul codice vero (client finto, nessuna chiamata a pagamento) ---");
  {
    const gen = await import("../src/lib/newsletter/generazione");
    const registrate: { operazione: string; model: string; costoUsd?: number | null; dettaglio?: Record<string, unknown> }[] = [];
    const registra = async (r: { operazione: string; model: string; costoUsd?: number | null; dettaglio?: Record<string, unknown> }) => {
      registrate.push(r);
    };
    let chiamate = 0;
    const risposta = (contenuto: unknown[], stop: string, ricerche: number) => ({ content: contenuto, stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: ricerche } } });
    const sequenza = [
      risposta([{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.anticorruzione.it/-/vera" }] }], "pause_turn", 2),
      risposta([{ type: "tool_use", name: "componi_edizione", id: "x", input: { oggetto: "O", preheader: "P", sezioni: { notizia: [{ titolo: "Vera", sintesi: "s", fonti: [{ titolo: "ANAC", url: "https://www.anticorruzione.it/-/vera", data: "2026-11-26" }] }] } } }], "tool_use", 1),
    ];
    const finto = { messages: { stream: () => ({ finalMessage: async () => sequenza[chiamate++] }) } };
    gen.impostaClienteDiProva(finto as never);
    const esito = await gen.generaEdizione({ dataEdizione: "2026-11-27", contesto: { generazioneId: "g-1", tipo: "rigenerazione", edizioneId: "e-1", numeroEdizione: 7, versione: 3, registra: registra as never } });
    uguale("due chiamate al modello e due righe di ricerca web registrate", registrate.map((r) => r.model), ["claude-sonnet-5", "web_search", "claude-sonnet-5", "web_search"]);
    atteso("ogni riga porta edizione, numero, versione, tipo e generazione", registrate.every((r) => r.dettaglio?.edizione_id === "e-1" && r.dettaglio?.numero_edizione === 7 && r.dettaglio?.versione === 3 && r.dettaglio?.tipo === "rigenerazione" && r.dettaglio?.generazione_id === "g-1"));
    atteso("fuori produzione le operazioni sono di sviluppo («prova:newsletter_…»)", registrate.every((r) => r.operazione === "prova:newsletter_rigenerazione"));
    uguale("in produzione «newsletter_…»", gen.operazioneNewsletter("generazione", { VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv), "newsletter_generazione");
    const atteso2 = 2 * (1000 * 3 + 500 * 15) / 1e6 + 3 * gen.COSTO_RICERCA_WEB_USD;
    atteso("costo della generazione = token × tariffa + ricerche × 0,01 $", Math.abs(esito.uso.costoUsd - atteso2) < 1e-9, `${esito.uso.costoUsd} vs ${atteso2}`);
    uguale("ricerche contate", esito.uso.ricerche, 3);
    // errore a metà: la prima chiamata è pagata, la seconda fallisce → il costo speso resta registrato e arriva al chiamante
    registrate.length = 0;
    chiamate = 0;
    const rotto = { messages: { stream: () => ({ finalMessage: async () => { if (chiamate++ === 0) return sequenza[0]; throw new Error("rete interrotta"); } }) } };
    gen.impostaClienteDiProva(rotto as never);
    let erroreUso: number | null = null;
    try {
      await gen.generaEdizione({ dataEdizione: "2026-11-27", contesto: { generazioneId: "g-2", tipo: "rigenerazione", registra: registra as never } });
    } catch (e) {
      erroreUso = e instanceof gen.ErroreGenerazione ? e.uso.costoUsd : null;
    }
    atteso("errore a metà: il costo della chiamata già fatta è registrato e restituito", registrate.length === 2 && erroreUso !== null && Math.abs(erroreUso - ((1000 * 3 + 500 * 15) / 1e6 + 0.02)) < 1e-9, `${registrate.length} ${erroreUso}`);
    gen.impostaClienteDiProva(null);
  }

  console.log("--- 14. Aggregazioni economiche (giorno, mese, anno, storico; produzione e sviluppo separati) ---");
  {
    const { riepilogaCostiNewsletter } = await import("../src/lib/console/newsletter-costi-calcoli");
    const op = (id: string, quando: string, costo: number | null, operazione = "newsletter_generazione", dett: Record<string, unknown> = {}) => ({ id, operazione, provider: "anthropic", model: "claude-sonnet-5", input_tokens: 10, output_tokens: 5, costo_stimato: costo, created_at: quando, dettaglio: { voce: "modello", tipo: operazione.replace(/^prova:/, "").replace("newsletter_", ""), ...dett } });
    const ops = [
      op("a", "2026-11-27T10:00:00Z", 1, "newsletter_generazione", { generazione_id: "g1" }),
      op("b", "2026-11-26T23:30:00Z", 2, "newsletter_rigenerazione", { generazione_id: "g2" }), // 27/11 00:30 a Roma
      op("c", "2026-11-02T10:00:00Z", 4, "newsletter_rigenerazione_sezione", { generazione_id: "g3" }),
      op("d", "2026-03-01T10:00:00Z", 8, "newsletter_generazione", { generazione_id: "g4" }),
      op("e", "2025-12-31T22:30:00Z", 16, "newsletter_generazione", { generazione_id: "g5" }), // 31/12 23:30 a Roma: anno precedente
      op("f", "2026-11-27T11:00:00Z", 32, "prova:newsletter_generazione", { generazione_id: "g6" }),
      op("g", "2026-11-27T12:00:00Z", null, "newsletter_generazione", { generazione_id: "g1" }),
    ];
    const r = riepilogaCostiNewsletter({ operazioni: ops, versioni: [], edizioni: [], invii: [], impostazioni: { resend_piano: null, resend_quota_mensile_eur: null }, cambioUsdEur: 0.5, adesso: new Date("2026-11-27T15:00:00Z"), da: "2026-11-01", a: "2026-11-30" });
    uguale("oggi (fuso di Roma: la riga delle 23:30 UTC del 26 è del 27)", r.tessere.oggi.costoUsd, 3);
    uguale("mese corrente", r.tessere.mese.costoUsd, 7);
    uguale("anno corrente (il 31/12 23:30 di Roma resta nel 2025)", r.tessere.anno.costoUsd, 15);
    uguale("storico", r.tessere.storico.costoUsd, 31);
    uguale("euro col cambio del sistema esistente", r.tessere.storico.costoEur, 15.5);
    uguale("sviluppo e collaudo fuori dai totali", [r.tessere.sviluppoPeriodo.costoUsd, r.tessere.sviluppoStorico.costoUsd], [32, 32]);
    uguale("costo non disponibile contato a parte, non come zero nascosto", r.tessere.periodo.senzaCosto, 1);
    uguale("generazioni nel periodo contate per identificativo (non per riga)", r.conteggi.totaleGenerazioni, 3);
    uguale("ripartizione per tipologia", r.perTipo.map((x) => [x.tipo, x.costoUsd]), [["rigenerazione_sezione", 4], ["rigenerazione", 2], ["generazione", 1]]);
    const { assemblaClienti } = await import("../src/lib/console/costi-calcoli");
    const tot = assemblaClienti(
      { costi: [{ user_id: null, categoria: "newsletter", operazioni: 2, operazioni_senza_costo: 0, costo_usd: 5, input_token: 0, output_token: 0 }, { user_id: null, categoria: "piattaforma", operazioni: 1, operazioni_senza_costo: 0, costo_usd: 1, input_token: 0, output_token: 0 }, { user_id: null, categoria: "prova", operazioni: 1, operazioni_senza_costo: 0, costo_usd: 100, input_token: 0, output_token: 0 }], gare: [], abbonamenti: [], acquisti: [], identita: new Map() },
      { cambioUsdEur: 1, aliquotaIva: 22 },
      { preset: "mese", etichetta: "m", da: "2026-11-01", a: "2026-11-30", daIso: "2026-10-31T23:00:00Z", aIso: "2026-11-30T23:00:00Z", giorni: 30, inCorso: true },
      new Date("2026-11-27T12:00:00Z"),
    ).totali;
    uguale("Costi e margini: la newsletter entra nel costo complessivo una volta sola, le prove no", [tot.costoUsd, tot.costoNewsletterUsd, tot.costoPiattaformaUsd], [6, 5, 1]);
    uguale("Costi e margini: la newsletter non pesa sul costo per gara", tot.costoPerGaraEur, null);
  }

  console.log("--- 15. Iscrizione pubblica con doppia conferma ---");
  {
    const isc = await import("../src/lib/newsletter/iscrizioni");
    const t0 = new Date("2026-11-27T15:00:00Z");
    const ip = "ip-prova-1";
    const r1 = await isc.richiediIscrizione({ email: "  Nuovo.Lettore@Example.COM ", consenso: true, ipHash: ip, userAgent: "UA", adesso: t0 }, a);
    const n = (await a.iscrittoPerEmail("nuovo.lettore@example.com"))!;
    atteso("richiesta valida: riga «in attesa» dal sito, email in minuscolo", r1.ok && n.stato === "in_attesa" && n.provenienza === "sito");
    atteso("consenso registrato: testo, versione dell'informativa, impronta IP, browser", Boolean(n.consenso_testo && n.informativa_versione && n.consenso_ip_hash === ip && n.consenso_user_agent === "UA"));
    atteso("gettone di conferma casuale (48 esadecimali)", /^[a-f0-9]{48}$/.test(n.conferma_token ?? ""));
    const confermeInviate = async () => (await a.registroPerAzione("email_conferma", 100)).length;
    uguale("una email di conferma (simulata fuori produzione)", await confermeInviate(), 1);
    atteso("la conferma è simulata (nessun invio reale)", (await a.registroPerAzione("email_conferma", 1))[0].dettaglio.simulato === true);
    const { selezionaDestinatari } = await import("../src/lib/newsletter/destinatari");
    atteso("in attesa: NON tra i destinatari", !selezionaDestinatari(await a.elencoIscritti(), [], { abbonati_attivi: true, altri_autorizzati: true }).inclusi.some((i) => i.email === "nuovo.lettore@example.com"));
    // stessa richiesta subito dopo: nessuna seconda email (pausa tra le conferme), risposta identica
    const r2 = await isc.richiediIscrizione({ email: "nuovo.lettore@example.com", consenso: true, ipHash: "ip-2", userAgent: null, adesso: new Date(t0.getTime() + 60_000) }, a);
    atteso("seconda richiesta ravvicinata: stessa risposta, nessuna nuova email", r2.ok && (await confermeInviate()) === 1);
    const r3 = await isc.richiediIscrizione({ email: "nuovo.lettore@example.com", consenso: true, ipHash: "ip-3", userAgent: null, adesso: new Date(t0.getTime() + 11 * 60_000) }, a);
    atteso("dopo la pausa: nuova email con un nuovo gettone", r3.ok && (await confermeInviate()) === 2 && (await a.iscrittoPerEmail("nuovo.lettore@example.com"))!.conferma_token !== n.conferma_token);
    atteso("email non valida rifiutata", !(await isc.richiediIscrizione({ email: "non-una-email", consenso: true, ipHash: "x", userAgent: null }, a)).ok);
    atteso("senza consenso rifiutata", !(await isc.richiediIscrizione({ email: "a@example.com", consenso: false, ipHash: "x", userAgent: null }, a)).ok);
    // limite di frequenza: 5 richieste all'ora per impronta IP
    for (let k = 0; k < 5; k++) await isc.richiediIscrizione({ email: `raffica${k}@example.com`, consenso: true, ipHash: "ip-raffica", userAgent: null, adesso: t0 }, a);
    const sesta = await isc.richiediIscrizione({ email: "raffica6@example.com", consenso: true, ipHash: "ip-raffica", userAgent: null, adesso: t0 });
    atteso("limite di frequenza: la sesta richiesta in un'ora è rifiutata", !sesta.ok && sesta.motivo === "troppe_richieste");
    atteso("…e non crea la riga", !(await a.iscrittoPerEmail("raffica6@example.com")));
    // conferma
    const tok = (await a.iscrittoPerEmail("nuovo.lettore@example.com"))!.conferma_token!;
    const c1 = await isc.confermaIscrizione(tok, a, new Date("2026-11-27T16:00:00Z"));
    const conf = (await a.iscrittoPerEmail("nuovo.lettore@example.com"))!;
    atteso("conferma: diventa «iscritto» con base consenso e prova completa", c1.ok && conf.stato === "iscritto" && conf.base_giuridica === "consenso" && /Doppia conferma/.test(conf.prova_base) && Boolean(conf.confermato_il) && conf.conferma_token === null);
    atteso("prossimo invio: venerdì 4 dicembre alle 10:00 di Roma (venerdì 27 alle 17 è già passato)", c1.ok && c1.prossimoInvio.toISOString() === "2026-12-04T09:00:00.000Z" && c1.giornoInvio === "venerdì");
    const c0 = await isc.confermaIscrizione(tok, a, new Date("2026-11-27T08:00:00Z"));
    atteso("gettone già usato: non valido", !c0.ok);
    atteso("confermato: tra i destinatari", selezionaDestinatari(await a.elencoIscritti(), [], { abbonati_attivi: true, altri_autorizzati: true }).inclusi.some((i) => i.email === "nuovo.lettore@example.com"));
    const pc = await isc.confermaIscrizione(tok.replace(/./, "0"), a);
    atteso("gettone inesistente: non valido", !pc.ok);
    // prossimo invio di venerdì mattina prima delle 10: oggi stesso
    await isc.richiediIscrizione({ email: "mattina@example.com", consenso: true, ipHash: "ip-m", userAgent: null, adesso: new Date("2026-12-04T07:00:00Z") }, a);
    const cm = await isc.confermaIscrizione((await a.iscrittoPerEmail("mattina@example.com"))!.conferma_token!, a, new Date("2026-12-04T07:30:00Z"));
    atteso("confermato venerdì alle 8:30: il prossimo invio è oggi alle 10", cm.ok && cm.prossimoInvio.toISOString() === "2026-12-04T09:00:00.000Z");
    // gettone scaduto
    await isc.richiediIscrizione({ email: "lento@example.com", consenso: true, ipHash: "ip-l", userAgent: null, adesso: t0 }, a);
    const cs = await isc.confermaIscrizione((await a.iscrittoPerEmail("lento@example.com"))!.conferma_token!, a, new Date(t0.getTime() + 8 * 86400000));
    atteso("conferma dopo 8 giorni: scaduta, resta in attesa", !cs.ok && cs.motivo === "scaduto" && (await a.iscrittoPerEmail("lento@example.com"))!.stato === "in_attesa");
    // già iscritto: nessuna email; disiscritto: nuovo consenso con doppia conferma
    const prima = await confermeInviate();
    await isc.richiediIscrizione({ email: "nuovo.lettore@example.com", consenso: true, ipHash: "ip-x", userAgent: null, adesso: t0 }, a);
    atteso("già iscritto: nessuna email, stessa risposta", (await confermeInviate()) === prima && (await a.iscrittoPerEmail("nuovo.lettore@example.com"))!.stato === "iscritto");
    const { disiscriviConToken } = await import("../src/lib/newsletter/disiscrizione");
    await disiscriviConToken(conf.token_disiscrizione, "prova", a);
    await isc.richiediIscrizione({ email: "nuovo.lettore@example.com", consenso: true, ipHash: "ip-y", userAgent: null, adesso: t0 }, a);
    atteso("disiscritto che si riscrive: torna «in attesa» e serve una nuova conferma", (await a.iscrittoPerEmail("nuovo.lettore@example.com"))!.stato === "in_attesa" && (await confermeInviate()) === prima + 1);
    const contenuto = isc.emailConferma("https://omnia-ai.it/newsletter/conferma?t=abc");
    atteso("email di conferma: link, scadenza e versione testo", contenuto.html.includes("https://omnia-ai.it/newsletter/conferma?t=abc") && contenuto.text.includes("https://omnia-ai.it/newsletter/conferma?t=abc") && /7 giorni/.test(contenuto.text));
  }

  console.log("--- 16. Destinatari manuali, elenchi, CSV, clienti ---");
  {
    const g = await import("../src/lib/newsletter/gestione-iscritti");
    const e1 = g.leggiElenco("Mario Rossi <mario@x.it>, anna@y.it; non-email\nANNA@y.it\nluca@z.it luigi@w.it");
    uguale("elenco incollato: indirizzi estratti, duplicati tolti, minuscolo", e1.righe.map((r) => r.email), ["mario@x.it", "anna@y.it", "luca@z.it", "luigi@w.it"]);
    atteso("elenco incollato: nome da «Nome <email>» e righe non valide segnalate", e1.righe[0].nome === "Mario Rossi" && e1.nonValidi.includes("non-email"));
    const e2 = g.leggiElenco("\uFEFFNome;Cognome;Azienda;E-mail\nMario;Rossi;\"Rossi; Figli srl\";MARIO@x.it\n;;;sbagliata\n");
    atteso("CSV con intestazione e punto e virgola, campo tra virgolette", e2.righe.length === 1 && e2.righe[0].email === "mario@x.it" && e2.righe[0].nome === "Mario Rossi" && e2.righe[0].azienda === "Rossi; Figli srl" && e2.nonValidi.length === 1, JSON.stringify(e2));
    const e3 = g.leggiElenco("email,nome\na@b.it,A\n");
    atteso("CSV con virgola", e3.righe.length === 1 && e3.righe[0].nome === "A");
    // inserimento: nuovi, duplicati, disiscritti, bloccati
    const base = { base: "consenso" as const, prova: "consenso scritto conservato in archivio", baseDal: "2026-11-27", note: "nota", categoria: "prospect" as const, provenienza: "importazione" as const };
    const dis = await a.aggiungiIscritto({ email: "ex@x.it", nome: null, user_id: null, categoria: "altro", stato: "iscritto", base_giuridica: "consenso", prova_base: "consenso precedente documentato", base_dal: "2026-01-01" }, null);
    await a.aggiornaIscritto(dis.id, { stato: "disiscritto", disiscritto_il: "2026-11-01T10:00:00Z" });
    const bl = await a.aggiungiIscritto({ email: "rimbalza@x.it", nome: null, user_id: null, categoria: "altro", stato: "iscritto", base_giuridica: "consenso", prova_base: "consenso precedente documentato", base_dal: "2026-01-01" }, null);
    await a.aggiornaIscritto(bl.id, { stato: "rimbalzato" });
    const righe = [{ email: "nuovo1@x.it", nome: "N", azienda: "Az" }, { email: "ex@x.it", nome: null, azienda: null }, { email: "rimbalza@x.it", nome: null, azienda: null }, { email: "luca@z.it", nome: null, azienda: null }];
    const r1 = await g.inserisciDestinatari({ ...base, righe, nuovaAutorizzazione: false }, null, a);
    atteso("inserimento: nuovi aggiunti, disiscritto NON riattivato senza nuova autorizzazione, bloccato non toccato", r1.aggiunti.join() === "nuovo1@x.it,luca@z.it" && r1.disiscrittiNonRiattivati.join() === "ex@x.it" && r1.bloccati.join() === "rimbalza@x.it", JSON.stringify(r1));
    atteso("il disiscritto resta disiscritto", (await a.iscrittoPerEmail("ex@x.it"))!.stato === "disiscritto");
    const nuovo1 = (await a.iscrittoPerEmail("nuovo1@x.it"))!;
    atteso("provenienza, azienda, note e base registrate", nuovo1.provenienza === "importazione" && nuovo1.azienda === "Az" && nuovo1.note_admin === "nota" && nuovo1.base_giuridica === "consenso");
    const r2 = await g.inserisciDestinatari({ ...base, righe: [{ email: "nuovo1@x.it", nome: null, azienda: null }], nuovaAutorizzazione: false }, null, a);
    atteso("di nuovo lo stesso indirizzo: nessun doppione", r2.giaPresenti.join() === "nuovo1@x.it" && (await a.elencoIscritti()).filter((i) => i.email === "nuovo1@x.it").length === 1);
    const r3 = await g.inserisciDestinatari({ ...base, righe: [{ email: "ex@x.it", nome: null, azienda: null }], nuovaAutorizzazione: true }, null, a);
    const ex = (await a.iscrittoPerEmail("ex@x.it"))!;
    atteso("con la nuova autorizzazione: riattivato e la prova lo dice", r3.riattivati.join() === "ex@x.it" && ex.stato === "iscritto" && /NUOVA autorizzazione/.test(ex.prova_base));
    // clienti dagli abbonamenti: chi è già presente (anche disiscritto) non si tocca
    const { clientiDaAggiungere } = await import("../src/lib/newsletter/destinatari");
    const clienti = [
      { userId: "u-ex", email: "ex@x.it", accettazioneId: "a1", versione: 3, accettataIl: "2026-12-01T10:00:00Z" },
      { userId: "u-nuovo", email: "cliente.nuovo@x.it", accettazioneId: "a2", versione: 3, accettataIl: "2026-12-01T10:00:00Z" },
    ];
    uguale("clienti da aggiungere: solo chi non c'è", clientiDaAggiungere(await a.elencoIscritti(), clienti).map((c) => c.email), ["cliente.nuovo@x.it"]);
    await a.aggiornaIscritto(ex.id, { stato: "disiscritto", disiscritto_il: "2026-12-02T10:00:00Z" });
    const s = await g.sincronizzaClienti(a, async () => clienti);
    const cn = (await a.iscrittoPerEmail("cliente.nuovo@x.it"))!;
    atteso("cliente acquisito in automatico con base «contratto_abbonamento» e prova dell'accettazione", s.aggiunti === 1 && cn.stato === "iscritto" && cn.base_giuridica === "contratto_abbonamento" && cn.provenienza === "abbonamento" && /v3/.test(cn.prova_base) && /a2/.test(cn.prova_base));
    atteso("un cliente disiscritto che rinnova NON viene riacquisito", (await a.iscrittoPerEmail("ex@x.it"))!.stato === "disiscritto");
    uguale("una seconda sincronizzazione non aggiunge nulla", (await g.sincronizzaClienti(a, async () => clienti)).aggiunti, 0);
    const { selezionaDestinatari } = await import("../src/lib/newsletter/destinatari");
    const sel = selezionaDestinatari([...(await a.elencoIscritti()), { ...cn, id: "doppio", email: "Cliente.Nuovo@x.it" }], [], { abbonati_attivi: true, altri_autorizzati: true });
    uguale("stesso indirizzo da due fonti: una sola copia", sel.inclusi.filter((i) => i.email.toLowerCase() === "cliente.nuovo@x.it").length, 1);
  }

  console.log("--- 17. Testo giustificato nel template ---");
  {
    const { renderNewsletterHtml, GIUSTIFICATO } = await import("../src/lib/newsletter/template");
    const html = renderNewsletterHtml(dati, { urlDisiscrizione: "https://omnia-ai.it/newsletter/disiscrizione" });
    // paragrafi di testo (carattere del testo e interlinea 1,65); le etichette in maiuscoletto sono intestazioni
    const paragrafi = html.match(/<p style="margin:0 0 (14|8)px 0;font-family:'Inter'[^"]*line-height:1.65[^"]*">/g) ?? [];
    atteso("i paragrafi discorsivi sono giustificati", paragrafi.length > 0 && paragrafi.every((p) => p.includes("text-align:justify")));
    atteso("con sillabazione per gli schermi stretti", GIUSTIFICATO.includes("hyphens:auto") && html.includes('lang="it"'));
    atteso("titoli, fonti, pulsanti e piè di pagina NON giustificati", !/<h[123][^>]*text-align:justify/.test(html) && !/text-align:justify[^>]*>Fonti</.test(html) && !/text-align:justify[^>]*>[^<]*Accedi a OMNIA AI/.test(html) && (html.match(/text-align:justify/g) ?? []).length === paragrafi.length);
  }

  console.log("--- 18. Costi: email di conferma ---");
  {
    const { riepilogaCostiNewsletter } = await import("../src/lib/console/newsletter-costi-calcoli");
    const r = riepilogaCostiNewsletter({
      operazioni: [],
      versioni: [],
      edizioni: [],
      invii: [],
      conferme: [
        { creato_il: "2026-11-27T10:00:00Z", dettaglio: { simulato: false, esito: "ok" } },
        { creato_il: "2026-11-27T11:00:00Z", dettaglio: { simulato: true, esito: "ok" } },
        { creato_il: "2026-11-27T12:00:00Z", dettaglio: { simulato: false, esito: "errore" } },
      ],
      impostazioni: { resend_piano: null, resend_quota_mensile_eur: null },
      cambioUsdEur: null,
      adesso: new Date("2026-11-27T15:00:00Z"),
      da: "2026-11-01",
      a: "2026-11-30",
    });
    atteso("conferme vere contate nei volumi di Resend, simulate a parte, nessun costo per email", r.resend.periodo.conferme === 1 && r.resend.mesi[0].conferme === 1 && r.resend.periodo.simulate === 1 && r.tessere.periodo.costoUsd === 0);
  }

  console.log("--- 19. Cablaggio della parte pubblica e della 0142 ---");
  {
    const leggi = (p: string) => fs.readFileSync(p, "utf8");
    const azione = leggi("src/app/actions/omnia-ai-newsletter.ts");
    atteso("azione pubblica: campo trappola, Turnstile, impronta IP prima di toccare i dati", azione.indexOf("NOME_CAMPO_TRAPPOLA") < azione.indexOf("verificaFormUmano") && azione.indexOf("verificaFormUmano") < azione.indexOf("richiediIscrizione({"));
    const conferma = leggi("src/app/site-omnia-ai/newsletter/conferma/page.tsx");
    atteso("pagina di conferma: non indicizzata, conferma solo dal pulsante (POST)", /index: false/.test(conferma) && /action=\{confermaTenderWeekly\}/.test(conferma));
    atteso("messaggio di benvenuto richiesto", conferma.includes("Benvenuto in Tender Weekly!") && conferma.includes("Grazie per esserti iscritto alla newsletter di OMNIA AI.") && conferma.includes("riceverai direttamente nella tua casella di posta le principali novità del mondo degli appalti pubblici.") && conferma.includes("inizia con Tender Weekly."));
    atteso("home: sezione Tender Weekly subito prima del piè di pagina", /<TenderWeeklyIscrizione \/>\s*<\/section>\s*<SiteFooter \/>/.test(leggi("src/app/site-omnia-ai/page.tsx")));
    atteso("piè di pagina: collegamento permanente alla newsletter", leggi("src/components/omnia-ai/site-footer.tsx").includes('<Link href="/newsletter">Newsletter</Link>'));
    atteso("sitemap: /newsletter presente, conferma e disiscrizione no", /path: "\/newsletter"/.test(leggi("src/app/sitemap.ts")) && !/newsletter\/(conferma|disiscrizione)/.test(leggi("src/app/sitemap.ts")));
    const modulo = leggi("src/components/omnia-ai/tender-weekly-iscrizione.tsx");
    atteso("modulo: email, consenso obbligatorio, link all'informativa, Turnstile, «Iscriviti gratuitamente»", /type="email"/.test(modulo) && /name="consenso" value="1" required/.test(modulo) && modulo.includes('href="/privacy"') && modulo.includes("<TurnstileCampo") && modulo.includes("Iscriviti gratuitamente"));
    const m2 = leggi("supabase/migrations/0142_newsletter_iscrizioni_pubbliche.sql");
    atteso("0142: stato «in_attesa», base «contratto_abbonamento», provenienza vincolata", /'in_attesa', 'iscritto'/.test(m2) && /'contratto_abbonamento'/.test(m2) && /provenienza in \('sito', 'console', 'importazione', 'abbonamento'\)/.test(m2));
    atteso("0142: chi arriva dal sito ha sempre testo del consenso e versione dell'informativa", /provenienza <> 'sito' or \(consenso_testo is not null and informativa_versione is not null\)/.test(m2));
    atteso("0142: gettone di conferma solo per «in_attesa»", /\(stato = 'in_attesa'\) = \(conferma_token is not null\)/.test(m2));
    atteso("0141 non modificata dopo il collaudo sullo staging", require("crypto").createHash("sha256").update(leggi("supabase/migrations/0141_newsletter_tender_weekly.sql")).digest("hex").startsWith("b09187b993fd28b2"));
    const att = leggi("supabase/manuali/attiva_documenti_v3_newsletter.sql");
    for (const [file, tipo] of [["legal/privacy-policy-omnia-ai-v3.md", "omnia_ai_privacy_policy"], ["legal/condizioni-abbonamento-v3.md", "omnia_ai_condizioni_abbonamento"]]) {
      const h = require("crypto").createHash("sha256").update(leggi(file).replace(/\r\n/g, "\n")).digest("hex");
      atteso(`attivazione v3: impronta di ${file} corretta`, att.includes(h) && att.includes(tipo));
    }
    atteso("le versioni v2 pubblicate non sono state toccate", !/Tender Weekly/.test(leggi("legal/privacy-policy-omnia-ai-v2.md")) && !/Tender Weekly/.test(leggi("legal/condizioni-abbonamento-v2.md")));
    atteso("condizioni v3: Tender Weekly incluso e disiscrizione senza effetti sull'abbonamento", /comprende anche Tender Weekly/.test(leggi("legal/condizioni-abbonamento-v3.md")) && /senza alcun effetto sull'abbonamento/.test(leggi("legal/condizioni-abbonamento-v3.md")));
  }

  fs.rmSync(fileArchivio, { force: true });
  console.log(`\n${controlli - errori}/${controlli} controlli superati.`);
  if (errori) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(fileArchivio, { force: true });
  process.exit(1);
});
