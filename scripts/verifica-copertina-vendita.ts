// Autotest della copertina della relazione tecnica in vendita come il piano di lavoro (richiesta dell'utente, 17/11/2026): pagina «Copertina» della console
// (menu Sistema), prezzo per gara uguale per tutti (50 €), pacchetti prepagati (5 gare a 175 €), offerte dedicate, regola per gli account in prova e
// concessioni gratuite; le impostazioni per cliente restano come condizioni particolari che prevalgono.
// Controlla, senza rete né database:
//   - l'ordine delle fonti del diritto (acquisto > concessione > gratis del cliente > pacchetto > prezzo del cliente > prova > vendita a tutti) e i casi limite;
//   - la visibilità del riquadro nella gara;
//   - il servizio «copertina» nei pacchetti (elenco di partenza, testi, schede della home con un interruttore per servizio);
//   - i punti del codice che devono restare collegati (azione che consuma e rimette l'unità, console, menu, migrazione 0130).
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  COPERTINE_PER_STILE,
  MESSAGGIO_COPERTINA_PROVA_BLOCCATA,
  MESSAGGIO_COPERTINA_SPENTA,
  copertinaVisibile,
  descriviImpostazioniCopertina,
  righeFontePerCliente,
  valutaDirittoCopertina,
  type ContestoDirittoCopertina,
  type ImpostazioniCopertina,
} from "../src/lib/copertina-diritto-calcoli";
import { PREZZO_COPERTINA, interpretaInterruttoreVenditaCopertina, interpretaPrezzoCopertina } from "../src/lib/copertina-acquisto-calcoli";
import { CATALOGO_PREDEFINITO, SERVIZI, SERVIZI_PACCHETTO, TESTI_PACCHETTI, convenienzaPacchetto, costruisciSchede, interpretaCatalogoPacchetti, testoUnita, validaNuovaOfferta } from "../src/lib/pacchetti-servizi-calcoli";
import { descrizionePacchettoRiga } from "../src/lib/console/fatturazione-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const GARA = "aaaaaaaa-1111-4111-8111-111111111111";
const OGGI = "2026-11-17";
const gratis = (extra: Partial<ImpostazioniCopertina> = {}): ImpostazioniCopertina => ({ attivo: true, modalita: "gratis", prezzoCentesimi: null, gareMassime: null, scadeIl: null, nota: null, ...extra });
const prezzoDedicato = (centesimi: number): ImpostazioniCopertina => ({ attivo: true, modalita: "pagamento", prezzoCentesimi: centesimi, gareMassime: null, scadeIl: null, nota: null });
const uso = (extra: { gare?: string[]; stilizzato?: number; realistico?: number } = {}) => ({ gareGratisUsate: extra.gare ?? [], perStile: { stilizzato: extra.stilizzato ?? 0, realistico: extra.realistico ?? 0 } });
// di base: nessuna condizione del cliente, vendita accesa con pagamento possibile, 50 € a gara
function ctx(extra: Partial<ContestoDirittoCopertina> = {}): ContestoDirittoCopertina {
  return {
    impostazioni: null,
    schemaAssente: false,
    sviluppoLocale: false,
    oggi: OGGI,
    garaId: GARA,
    uso: uso(),
    stile: "stilizzato",
    acquistata: false,
    pagamentoDisponibile: true,
    venditaAttiva: true,
    prezzoGeneraleCentesimi: 5000,
    concessioneId: null,
    pacchetto: { saldo: 0, garaGiaConsumata: false },
    inProva: false,
    politicaProva: "acquisto",
    ...extra,
  };
}

console.log("--- Prezzo e interruttore della vendita ---");
atteso("il prezzo di partenza è 50 € (richiesta dell'utente)", PREZZO_COPERTINA.predefinitoCentesimi === 5000 && interpretaPrezzoCopertina(undefined) === 5000);
atteso("un prezzo salvato valido si usa, uno fuori dai limiti o non numerico no", interpretaPrezzoCopertina("4500") === 4500 && interpretaPrezzoCopertina("50") === 5000 && interpretaPrezzoCopertina("abc") === 5000 && interpretaPrezzoCopertina("99999999") === 5000);
atteso("l'interruttore è acceso solo con «1» (di base spento)", interpretaInterruttoreVenditaCopertina("1") && !interpretaInterruttoreVenditaCopertina(undefined) && !interpretaInterruttoreVenditaCopertina("0") && !interpretaInterruttoreVenditaCopertina("true"));

console.log("--- La vendita a tutti ---");
{
  const e = valutaDirittoCopertina(ctx());
  atteso("vendita accesa, nessuna altra fonte: a pagamento al prezzo generale, acquistabile", !e.ok && e.motivo === "a_pagamento" && e.prezzoCentesimi === 5000 && e.acquistabile === true && /50\s€/.test(e.messaggio));
  const spenta = valutaDirittoCopertina(ctx({ venditaAttiva: false }));
  atteso("vendita spenta, nessuna altra fonte: spento (come prima)", !spenta.ok && spenta.motivo === "spento" && spenta.messaggio === MESSAGGIO_COPERTINA_SPENTA);
  const senzaStripe = valutaDirittoCopertina(ctx({ pagamentoDisponibile: false }));
  atteso("vendita accesa ma pagamento impossibile in questo ambiente: spento (nessun prezzo che non si può pagare)", !senzaStripe.ok && senzaStripe.motivo === "spento");
  const vecchio = valutaDirittoCopertina({ impostazioni: null, schemaAssente: false, sviluppoLocale: false, oggi: OGGI, garaId: GARA, uso: uso(), stile: "stilizzato", acquistata: false, pagamentoDisponibile: true });
  atteso("un contesto senza i campi nuovi si comporta come prima (spento)", !vecchio.ok && vecchio.motivo === "spento");
}

console.log("--- Ordine delle fonti ---");
{
  const pagata = valutaDirittoCopertina(ctx({ acquistata: true, concessioneId: "c1", pacchetto: { saldo: 3, garaGiaConsumata: false } }));
  atteso("una gara pagata resta «pagamento» anche con concessione e pacchetto (non consuma nulla)", pagata.ok && pagata.fonte === "pagamento" && !pagata.consumaUnita);
  const conc = valutaDirittoCopertina(ctx({ concessioneId: "c1", pacchetto: { saldo: 3, garaGiaConsumata: false }, impostazioni: prezzoDedicato(3000) }));
  atteso("la concessione batte gratis/pacchetto/prezzo dedicato e porta il suo id", conc.ok && conc.fonte === "concessione" && conc.concessioneId === "c1" && !conc.consumaUnita);
  const concSpenta = valutaDirittoCopertina(ctx({ concessioneId: "c1", venditaAttiva: false, pagamentoDisponibile: false }));
  atteso("la concessione vale anche a vendita spenta e senza Stripe", concSpenta.ok && concSpenta.fonte === "concessione");
  const grat = valutaDirittoCopertina(ctx({ impostazioni: gratis(), pacchetto: { saldo: 3, garaGiaConsumata: false } }));
  atteso("il gratis del cliente batte il pacchetto (non si consumano unità)", grat.ok && grat.fonte === "gratis" && !grat.consumaUnita);
  const pac = valutaDirittoCopertina(ctx({ pacchetto: { saldo: 2, garaGiaConsumata: false } }));
  atteso("con un saldo: pacchetto, e la prima copertina della gara consuma un'unità", pac.ok && pac.fonte === "pacchetto" && pac.consumaUnita === true);
  const pacGia = valutaDirittoCopertina(ctx({ pacchetto: { saldo: 0, garaGiaConsumata: true } }));
  atteso("gara che ha già usato la sua unità: si continua anche a saldo zero, senza consumarne altre", pacGia.ok && pacGia.fonte === "pacchetto" && pacGia.consumaUnita === false);
  const pacSpenta = valutaDirittoCopertina(ctx({ pacchetto: { saldo: 1, garaGiaConsumata: false }, venditaAttiva: false, pagamentoDisponibile: false }));
  atteso("le unità già comprate si usano anche a vendita spenta", pacSpenta.ok && pacSpenta.fonte === "pacchetto");
  const dedicato = valutaDirittoCopertina(ctx({ impostazioni: prezzoDedicato(3000) }));
  atteso("il prezzo dedicato al cliente prevale su quello generale", !dedicato.ok && dedicato.motivo === "a_pagamento" && dedicato.prezzoCentesimi === 3000 && dedicato.acquistabile);
  const dedicatoSpenta = valutaDirittoCopertina(ctx({ impostazioni: prezzoDedicato(3000), venditaAttiva: false }));
  atteso("il prezzo dedicato vale anche a vendita spenta (come prima della vendita a tutti)", !dedicatoSpenta.ok && dedicatoSpenta.motivo === "a_pagamento" && dedicatoSpenta.prezzoCentesimi === 3000 && dedicatoSpenta.acquistabile);
  const dedicatoProva = valutaDirittoCopertina(ctx({ impostazioni: prezzoDedicato(3000), inProva: true, politicaProva: "bloccato" }));
  atteso("il prezzo dedicato prevale anche sulla regola della prova", !dedicatoProva.ok && dedicatoProva.motivo === "a_pagamento" && dedicatoProva.prezzoCentesimi === 3000);
  const pacPrimaDelPrezzo = valutaDirittoCopertina(ctx({ impostazioni: prezzoDedicato(3000), pacchetto: { saldo: 1, garaGiaConsumata: false } }));
  atteso("chi ha unità del pacchetto le usa prima di pagare la singola gara", pacPrimaDelPrezzo.ok && pacPrimaDelPrezzo.fonte === "pacchetto");
}

console.log("--- Gratis del cliente finito, prova ---");
{
  const scaduto = valutaDirittoCopertina(ctx({ impostazioni: gratis({ scadeIl: "2026-11-10" }) }));
  atteso("gratis scaduto e vendita accesa: si offre l'acquisto al prezzo generale", !scaduto.ok && scaduto.motivo === "a_pagamento" && scaduto.prezzoCentesimi === 5000);
  const scadutoPac = valutaDirittoCopertina(ctx({ impostazioni: gratis({ scadeIl: "2026-11-10" }), pacchetto: { saldo: 1, garaGiaConsumata: false } }));
  atteso("gratis scaduto con un pacchetto: si usa il pacchetto", scadutoPac.ok && scadutoPac.fonte === "pacchetto");
  const scadutoSpenta = valutaDirittoCopertina(ctx({ impostazioni: gratis({ scadeIl: "2026-11-10" }), venditaAttiva: false }));
  atteso("gratis scaduto e vendita spenta: il messaggio dice che il periodo gratuito è finito", !scadutoSpenta.ok && scadutoSpenta.motivo === "scaduto" && /10\/11\/2026/.test(scadutoSpenta.messaggio));
  const finite = valutaDirittoCopertina(ctx({ impostazioni: gratis({ gareMassime: 1 }), uso: uso({ gare: ["altra"] }), venditaAttiva: false }));
  atteso("gare gratis finite e vendita spenta: «gare finite»", !finite.ok && finite.motivo === "gare_finite");

  const provaGratis = valutaDirittoCopertina(ctx({ inProva: true, politicaProva: "gratis" }));
  atteso("in prova con «incluso gratis» e vendita accesa: fonte «prova»", provaGratis.ok && provaGratis.fonte === "prova");
  const provaGratisSpenta = valutaDirittoCopertina(ctx({ inProva: true, politicaProva: "gratis", venditaAttiva: false }));
  atteso("in prova con «incluso gratis» ma vendita spenta: spento", !provaGratisSpenta.ok && provaGratisSpenta.motivo === "spento");
  const provaBloccata = valutaDirittoCopertina(ctx({ inProva: true, politicaProva: "bloccato" }));
  atteso("in prova con «non disponibile»: negato con il suo messaggio", !provaBloccata.ok && provaBloccata.motivo === "prova_bloccata" && provaBloccata.messaggio === MESSAGGIO_COPERTINA_PROVA_BLOCCATA);
  const provaAcquisto = valutaDirittoCopertina(ctx({ inProva: true, politicaProva: "acquisto" }));
  atteso("in prova con «come tutti»: si compra", !provaAcquisto.ok && provaAcquisto.motivo === "a_pagamento" && provaAcquisto.acquistabile);
  const provaConc = valutaDirittoCopertina(ctx({ inProva: true, politicaProva: "bloccato", concessioneId: "c9" }));
  atteso("una concessione vale anche per chi è in prova con «non disponibile»", provaConc.ok && provaConc.fonte === "concessione");
}

console.log("--- Limite per stile, con ogni fonte ---");
for (const [nome, extra] of [
  ["concessione", { concessioneId: "c1" }],
  ["pacchetto", { pacchetto: { saldo: 0, garaGiaConsumata: true } }],
  ["prova", { inProva: true, politicaProva: "gratis" as const }],
] as [string, Partial<ContestoDirittoCopertina>][]) {
  const e = valutaDirittoCopertina(ctx({ ...extra, uso: uso({ stilizzato: COPERTINE_PER_STILE }) }));
  atteso(`${nome}: al massimo ${COPERTINE_PER_STILE} generazioni per stile`, !e.ok && e.motivo === "limite_stile");
  const altro = valutaDirittoCopertina(ctx({ ...extra, uso: uso({ stilizzato: COPERTINE_PER_STILE }), stile: "realistico" }));
  atteso(`${nome}: l'altro stile resta libero`, altro.ok);
}

console.log("--- Visibilità del riquadro nella gara ---");
{
  const base = { impostazioni: null, schemaAssente: false, sviluppoLocale: false };
  atteso("vendita accesa e pagamento possibile: visibile", copertinaVisibile({ ...base, venditaAttiva: true, pagamentoDisponibile: true, prezzoGeneraleCentesimi: 5000 }));
  atteso("vendita spenta, niente altro: non visibile", !copertinaVisibile({ ...base, venditaAttiva: false, pagamentoDisponibile: true, prezzoGeneraleCentesimi: 5000 }));
  atteso("vendita accesa ma Stripe non reale: non visibile", !copertinaVisibile({ ...base, venditaAttiva: true, pagamentoDisponibile: false, prezzoGeneraleCentesimi: 5000 }));
  atteso("concessione: visibile anche a vendita spenta", copertinaVisibile({ ...base, concessioneId: "c1" }));
  atteso("unità del pacchetto: visibile anche a vendita spenta", copertinaVisibile({ ...base, pacchetto: { saldo: 1, garaGiaConsumata: false } }));
  atteso("gratis del cliente: visibile", copertinaVisibile({ ...base, impostazioni: gratis() }));
  atteso("prezzo dedicato senza Stripe: visibile (si dice il prezzo, come prima)", copertinaVisibile({ ...base, impostazioni: prezzoDedicato(3000) }));
  atteso("in prova con «non disponibile»: non visibile", !copertinaVisibile({ ...base, venditaAttiva: true, pagamentoDisponibile: true, prezzoGeneraleCentesimi: 5000, inProva: true, politicaProva: "bloccato" }));
  atteso("gara già pagata: visibile", copertinaVisibile({ ...base, acquistata: true }));
}

console.log("--- Righe per il cliente e descrizioni per la console ---");
{
  atteso("pacchetto da usare: dice quante ne restano", righeFontePerCliente({ ok: true, fonte: "pacchetto", consumaGara: false, consumaUnita: true }, 3).join(" ").includes("ti restano 3 gare con copertina"));
  atteso("pacchetto già usato dalla gara: lo dice", /usa già una gara del tuo pacchetto/.test(righeFontePerCliente({ ok: true, fonte: "pacchetto", consumaGara: false, consumaUnita: false }, 0).join(" ")));
  atteso("concessione: lo dice", /concessione/.test(righeFontePerCliente({ ok: true, fonte: "concessione", consumaGara: false }, 0).join(" ")));
  atteso("nessuna condizione particolare: la console rimanda alle regole generali", /regole generali/.test(descriviImpostazioniCopertina(null)) && /regole generali/.test(descriviImpostazioniCopertina(gratis({ attivo: false }))));
  atteso("prezzo dedicato: la console lo chiama così", /Prezzo dedicato: 30\s€/.test(descriviImpostazioniCopertina(prezzoDedicato(3000))));
}

console.log("--- La copertina nei pacchetti ---");
{
  atteso("«copertina» è un servizio dei pacchetti, disponibile, con la sua chiave di elenco", (SERVIZI_PACCHETTO as readonly string[]).includes("copertina") && SERVIZI.copertina.disponibile && SERVIZI.copertina.chiaveCatalogo === "pacchetti_copertina");
  atteso("il pacchetto di partenza è 5 gare a 175 € (richiesta dell'utente)", JSON.stringify(CATALOGO_PREDEFINITO.copertina) === JSON.stringify([{ quantita: 5, prezzoCentesimi: 17500 }]) && JSON.stringify(interpretaCatalogoPacchetti("copertina", null)) === JSON.stringify([{ quantita: 5, prezzoCentesimi: 17500 }]));
  atteso("il piano di lavoro non cambia (5 a 300 €)", JSON.stringify(CATALOGO_PREDEFINITO.piano_lavoro) === JSON.stringify([{ quantita: 5, prezzoCentesimi: 30000 }]));
  atteso("5 gare a 175 € contro 50 € a gara: 35 € a gara, si risparmiano 75 €", (() => { const c = convenienzaPacchetto({ quantita: 5, prezzoCentesimi: 17500 }, 5000); return c.perUnitaCentesimi === 3500 && c.risparmioCentesimi === 7500; })());
  atteso("l'unità si dice «gara con copertina»", testoUnita(1, "copertina") === "1 gara con copertina" && testoUnita(5, "copertina") === "5 gare con copertina");
  atteso("la fattura del pacchetto si legge bene", descrizionePacchettoRiga("copertina", 5) === "Pacchetto di servizi aggiuntivi: 5 gare con copertina");
  atteso("i testi per servizio: saldo esaurito e concessione parlano della copertina", /copertina/.test(TESTI_PACCHETTI.saldoZeroDi("copertina")) && /copertina/.test(TESTI_PACCHETTI.concessioneNotaDi("copertina")) && TESTI_PACCHETTI.saldoZeroDi("piano_lavoro") === TESTI_PACCHETTI.saldoZero);
  const offerta = validaNuovaOfferta({ email: "a@b.it", servizio: "copertina", quantita: "10", prezzoEuro: "300", scadeIl: "", nota: "" }, OGGI);
  atteso("un'offerta dedicata della copertina è valida", offerta.ok && offerta.valori.servizio === "copertina" && offerta.valori.prezzoCentesimi === 30000);

  const schede = (venditaAttiva: Parameters<typeof costruisciSchede>[0]["venditaAttiva"]) =>
    costruisciSchede({
      settoriGare: ["pulizie"],
      saldi: {},
      acquisti: {},
      titolare: true,
      venditaAttiva,
      cataloghi: { piano_lavoro: CATALOGO_PREDEFINITO.piano_lavoro, copertina: CATALOGO_PREDEFINITO.copertina },
      prezzoSingolo: { piano_lavoro: 7500, copertina: 5000 },
    }).map((s) => [s.servizio, s.offerta.stato]);
  atteso("interruttori separati: solo la copertina accesa → si vende solo la copertina", JSON.stringify(schede({ piano_lavoro: false, copertina: true })) === JSON.stringify([["copertina", "acquistabile"]]));
  atteso("interruttori separati: solo il piano di lavoro acceso → si vende solo il piano di lavoro", JSON.stringify(schede({ piano_lavoro: true, copertina: false })) === JSON.stringify([["piano_lavoro", "acquistabile"]]));
  const ristorazione = costruisciSchede({ settoriGare: ["ristorazione_collettiva"], saldi: {}, acquisti: {}, titolare: true, venditaAttiva: { copertina: true }, cataloghi: { copertina: CATALOGO_PREDEFINITO.copertina }, prezzoSingolo: { copertina: 5000 } });
  atteso("la copertina serve a ogni settore (anche alle gare di ristorazione)", ristorazione.some((s) => s.servizio === "copertina" && s.offerta.stato === "acquistabile"));
  atteso("senza gare e senza saldo nessuna scheda della copertina", costruisciSchede({ settoriGare: [], saldi: {}, acquisti: {}, titolare: true, venditaAttiva: { copertina: true }, cataloghi: { copertina: CATALOGO_PREDEFINITO.copertina }, prezzoSingolo: { copertina: 5000 } }).length === 0);
}

console.log("--- Collegamenti nel codice ---");
{
  const azione = leggi("src/app/actions/gara-copertina.ts");
  atteso("l'azione pretende la conferma dell'uso del pacchetto", /diritto\.consumaUnita && formData\.get\("usaPacchetto"\) !== "1"/.test(azione));
  atteso("l'azione consuma l'unità «copertina» PRIMA di registrare la generazione", azione.indexOf('servizio: "copertina", garaId: gara.id, garaTitolo') > 0 && azione.indexOf('servizio: "copertina", garaId: gara.id, garaTitolo') < azione.indexOf("const riserva = await riservaCopertina("));
  atteso("l'azione rimette l'unità se la generazione non riesce (solo se la gara non ha altre copertine)", /if \(!esito\.ok\) await restituisciUnita\(rigaId\)/.test(azione) && /altre === 0/.test(azione));
  atteso("la riga della generazione ricorda la concessione", /concessioneId: diritto\.concessioneId \?\? null/.test(azione));
  const acquistoPacchetto = leggi("src/app/actions/pacchetti-servizi.ts");
  atteso("l'acquisto dei pacchetti usa l'interruttore e le tabelle del servizio scelto", /venditaPacchettiAttiva\(admin, servizio\)/.test(acquistoPacchetto) && /pacchettiDisponibili\(admin, servizio\)/.test(acquistoPacchetto));
  atteso("il pacchetto della copertina registra le condizioni della copertina (approvate l'11/11)", /servizio === "copertina" \? testoCanonicoCondizioniCopertina\(\)/.test(acquistoPacchetto));
  const nav = leggi("src/app/site-console/_componenti/navigazione.ts");
  atteso("la voce «Copertina» è nel menu Sistema, dopo il piano di lavoro", /"\/piano-lavoro"[^\n]*\n\s*\{ href: "\/copertina", etichetta: "Copertina", pronto: true \}/.test(nav));
  const pagina = leggi("src/app/site-console/(app)/copertina/page.tsx");
  atteso("la pagina della console controlla l'admin", /await richiediAdminPagina\(\)/.test(pagina));
  const azioniConsole = leggi("src/app/site-console/azioni/copertina.ts");
  const funzioni = ["impostaVenditaCopertina", "salvaPrezzoSingoloCopertina", "impostaPoliticaProvaCopertina", "salvaCatalogoPacchettiCopertina", "creaConcessioneCopertina", "revocaConcessioneCopertina"];
  atteso("ogni azione della console parte da richiediAdminAzione()", funzioni.every((f) => new RegExp(`export async function ${f}\\([^)]*\\)[^{]*\\{\\n  const sessione = await richiediAdminAzione\\(\\);`).test(azioniConsole)));
  const migrazione = leggi("supabase/migrations/0130_copertina_vendita_pacchetti.sql");
  atteso("la migrazione 0130 ammette «copertina» nei pacchetti e le nuove fonti, e crea le concessioni senza permessi agli utenti", /'copertina'/.test(migrazione) && /'concessione', 'pacchetto', 'prova'/.test(migrazione) && /create table if not exists public\.omnia_ai_copertina_concessioni/.test(migrazione) && !/to authenticated/.test(migrazione));
  const pianoLavoro = leggi("src/lib/console/piano-lavoro.ts");
  atteso("la pagina del piano di lavoro mostra solo le sue offerte dedicate", /o\.servizio === "piano_lavoro"/.test(pianoLavoro));
  const garaPagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
  atteso("nella gara, il piano di lavoro propone solo le sue offerte e la copertina solo le sue", /o\.servizio === "piano_lavoro"/.test(garaPagina) && /o\.servizio === "copertina"/.test(garaPagina));
}

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controlli FALLITI`);
  process.exit(1);
}
console.log("\nTutti i controlli della vendita della copertina sono passati.");
