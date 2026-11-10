// Autotest della console per i pacchetti prepagati di servizi aggiuntivi (piano di lavoro e, in arrivo, OMNIA FOOD MENU): ricavi, da fatturare, scheda
// cliente con la rettifica del saldo, editor dei pacchetti, offerte dedicate a un cliente (pacchetti privati a prezzo e numero decisi dalla console),
// interruttore di vendita sciolto dall'abbonamento, tolleranza alle migrazioni 0104 e 0105 non ancora eseguite. Gratuito, nessun database né rete (client finti e controlli sul testo dei sorgenti): gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcolaPeriodo } from "../src/lib/console/periodo";
import { aggregaRicavi, type FonteRicavo, type VoceRicavo } from "../src/lib/console/ricavi-calcoli";
import { descrizionePacchettoRiga, descrizionePianoLavoroRiga } from "../src/lib/console/fatturazione-calcoli";
import { creaOffertaDedicata, leggiOfferteConsole, rettificaPacchetti, revocaOffertaDedicata } from "../src/lib/pacchetti-servizi";
import { daRigaConsole, revocabile, statoOffertaConsole } from "../src/lib/console/offerte-calcoli";
import { COLONNA_DATA_PER_FONTE, TABELLA_PER_FONTE, percorsoFatturaPagamento } from "../src/lib/omnia-ai-pagamenti";
import { CATALOGO_PREDEFINITO, LIMITI_CATALOGO, LIMITI_OFFERTA, SERVIZI, daRigaOfferta, interpretaCatalogoPacchetti, serializzaCatalogoPacchetti, validaCatalogoDaModulo, validaNuovaOfferta, type RigaOfferta } from "../src/lib/pacchetti-servizi-calcoli";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
function vicino(nome: string, ottenuto: number, previsto: number, tolleranza = 0.005) {
  atteso(nome, Math.abs(ottenuto - previsto) <= tolleranza, `ottenuto ${ottenuto}, previsto ${previsto}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

// il corpo di una funzione esportata, dal suo nome alla successiva «export»
function corpoFunzione(sorgente: string, nome: string): string {
  const inizio = sorgente.indexOf(`export async function ${nome}(`);
  if (inizio < 0) return "";
  const dopo = sorgente.indexOf("\nexport ", inizio + 10);
  return sorgente.slice(inizio, dopo < 0 ? sorgente.length : dopo);
}

const ID = "11111111-1111-4111-8111-111111111111";

async function main() {
  // ═════ 1. ricavi ═════
  console.log("--- Ricavi: la nuova fonte «pacchetto» ---");
  const ottobre = calcolaPeriodo({ p: "mese" }, new Date("2026-10-20T10:00:00Z"));
  const voce = (o: Partial<VoceRicavo> = {}): VoceRicavo => ({ dominio: "omnia_ai", fonte: "pacchetto", data: "2026-10-10T10:00:00Z", lordo: 300, impostaStripe: null, prova: false, dataApprossimata: false, ...o });
  {
    const r = aggregaRicavi([voce()], ottobre, 22, false);
    vicino("un pacchetto da 300 € lordi vale 245,90 € netti (IVA scorporata al 22%)", r.totali.pacchettiNetto, 300 / 1.22);
    uguale("conta un acquisto di pacchetto", r.totali.acquistiPacchetto, 1);
    uguale("NON finisce tra gli abbonamenti (l'else finale conta come abbonamento)", [r.totali.abbonamentiNetto, r.totali.incassiAbbonamento, r.totali.creditiNetto, r.totali.revisioniNetto, r.totali.pianiLavoroNetto], [0, 0, 0, 0, 0]);
    vicino("è dentro il totale OMNIA AI e il totale generale", r.totali.omniaAiNetto + r.totali.netto, 2 * (300 / 1.22));
    uguale("il mese ha la colonna dei pacchetti e non quella degli abbonamenti", [Math.round(r.perMese[0].pacchetti), r.perMese[0].abbonamenti, r.perMese[0].pianiLavoro], [246, 0, 0]);
    uguale("non è nel dominio e-commerce", [r.totali.ecommerceNetto, r.totali.ecommerceOrdini], [0, 0]);
  }
  {
    const misto = aggregaRicavi([voce(), voce({ fonte: "piano_lavoro", lordo: 75 }), voce({ fonte: "abbonamento", lordo: 100 }), voce({ fonte: "crediti", lordo: 50 })], ottobre, 22, false);
    vicino("ogni fonte ha il suo conto: pacchetti 300 lordi", misto.totali.pacchettiNetto, 300 / 1.22);
    vicino("piani di lavoro singoli 75 lordi", misto.totali.pianiLavoroNetto, 75 / 1.22);
    vicino("abbonamenti 100 lordi", misto.totali.abbonamentiNetto, 100 / 1.22);
    uguale("i conti per fonte", [misto.totali.acquistiPacchetto, misto.totali.acquistiPianoLavoro, misto.totali.incassiAbbonamento, misto.totali.acquistiCrediti], [1, 1, 1, 1]);
    vicino("il totale è la somma delle fonti", misto.totali.netto, 525 / 1.22);
  }
  {
    const prova = [voce({ prova: true })];
    const senza = aggregaRicavi(prova, ottobre, 22, false);
    uguale("un pacchetto di prova (Stripe in modalità test) resta fuori dai totali, e si dichiara", [senza.totali.pacchettiNetto, senza.prova.voci, senza.prova.lordo], [0, 1, 300]);
    const con = aggregaRicavi(prova, ottobre, 22, true);
    vicino("con i dati di prova inclusi entra", con.totali.pacchettiNetto, 300 / 1.22);
    const fuori = aggregaRicavi([voce({ data: "2026-09-10T10:00:00Z" })], ottobre, 22, false);
    uguale("un pagamento fuori dal periodo non conta", fuori.totali.acquistiPacchetto, 0);
  }
  {
    // ogni fonte dell'elenco, tranne «ordine» (e-commerce) e «abbonamento» (il ramo finale), ha un ramo ESPLICITO in aggregaRicavi
    const calcoli = leggi("src/lib/console/ricavi-calcoli.ts");
    const elenco = (calcoli.match(/export type FonteRicavo = ([^;]+);/) ?? [])[1] ?? "";
    const fonti = [...elenco.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as FonteRicavo);
    const senzaRamo = fonti.filter((f) => f !== "ordine" && f !== "abbonamento" && !new RegExp(`v\\.fonte === "${f}"`).test(calcoli));
    uguale("ogni fonte di ricavo ha il suo ramo (una fonte senza ramo finirebbe tra gli abbonamenti)", senzaRamo, []);
    atteso("le fonti sono quelle previste, pacchetto compreso", fonti.includes("pacchetto") && fonti.length === 6, fonti.join(","));
  }

  console.log("--- Ricavi: lettura ---");
  {
    const lettura = leggi("src/lib/console/ricavi.ts");
    atteso("legge i pacchetti PAGATI del periodo, con la data del pagamento esatta e il segno di prova", /from\("omnia_ai_pacchetti_acquisti"\)[^\n]*\.eq\("stato", "pagata"\)\.gte\("pagata_il", periodo\.daIso\)\.lt\("pagata_il", periodo\.aIso\)/.test(lettura) && /fonte: "pacchetto"/.test(lettura) && /prova: !p\.livemode/.test((lettura.match(/fonte: "pacchetto",[\s\S]*?\}\);/) ?? [""])[0]));
    atteso("l'importo è quello pagato davvero (altrimenti il prezzo), in euro", /num\(p\.importo_pagato_centesimi \?\? p\.prezzo_centesimi\) \/ 100/.test(lettura));
    atteso("senza la tabella (migrazione 0104) la pagina dei ricavi non cade; ogni altro errore è dichiarato", /pacchettiQ\.error && !schemaAssente\(pacchettiQ\.error\)/.test(lettura) && /pacchettiQ\.error \? \[\]/.test(lettura));
    const vista = leggi("src/app/site-console/_componenti/ricavi-vista.tsx");
    atteso("la vista mostra la tessera, la colonna del mese, il totale e la barra con i pacchetti", /etichetta="Pacchetti di servizi"/.test(vista) && /<th className="num">Pacchetti<\/th>/.test(vista) && /m\.pacchetti/.test(vista) && /t\.pacchettiNetto/.test(vista) && /m\.pianiLavoro \+ m\.pacchetti/.test(vista));
    atteso("la vista dice che il pacchetto conta quando si paga, non quando si usa", /contano al pagamento, non all'uso/.test(vista) && /un pacchetto è un ricavo quando si paga/.test(vista));
  }

  // ═════ 2. da fatturare ═════
  console.log("--- Da fatturare ---");
  {
    uguale("descrizione di un pacchetto da 5 piani di lavoro", descrizionePacchettoRiga("piano_lavoro", 5), "Pacchetto di servizi aggiuntivi: 5 piani di lavoro");
    uguale("descrizione con un solo piano", descrizionePacchettoRiga("piano_lavoro", 1), "Pacchetto di servizi aggiuntivi: 1 piano di lavoro");
    uguale("un servizio che non conosco non fa cadere la riga: si scrive com'è", descrizionePacchettoRiga("altro_servizio", 3), "Pacchetto di servizi aggiuntivi: 3 unità (altro_servizio)");
    atteso("è diversa dalla descrizione del piano di lavoro di una singola gara", descrizionePacchettoRiga("piano_lavoro", 5) !== descrizionePianoLavoroRiga("Gara"));
    uguale("il pagamento ha la sua tabella", TABELLA_PER_FONTE.pacchetto, "omnia_ai_pacchetti_acquisti");
    uguale("la data del pagamento è «pagata_il»", COLONNA_DATA_PER_FONTE.pacchetto, "pagata_il");
    uguale("il PDF della fattura sta in una cartella a parte, un file per pagamento", percorsoFatturaPagamento("pacchetto", ID), `omnia-ai/pacchetti/${ID}.pdf`);
  }
  {
    const lettura = leggi("src/lib/console/fatturazione.ts");
    atteso("legge i pacchetti PAGATI e li riga con la chiave «pacchetto:<id>», scorpora l'IVA e porta lo stato di fattura", /from\("omnia_ai_pacchetti_acquisti"\)\.select\(COLONNE_PACCHETTO\)\.eq\("stato", "pagata"\)/.test(lettura) && /chiave: `pacchetto:\$\{p\.id\}`/.test(lettura) && /fonte: "pacchetto"/.test(lettura) && /descrizionePacchettoRiga\(p\.servizio, num\(p\.quantita\)\)/.test(lettura) && /calcolaImporti\(num\(p\.importo_pagato_centesimi \?\? p\.prezzo_centesimi\) \/ 100, null, null, parametri\.aliquotaIva\)/.test(lettura));
    atteso("legge anche le colonne del PDF e dello stato di fattura (la migrazione 0104 le ha già)", /COLONNE_PACCHETTO =\s*"[^"]*stato_fattura, numero_fattura, data_fattura, note_fattura, fattura_file_path"/.test(lettura));
    atteso("senza la tabella (migrazione 0104) la pagina non cade; ogni altro errore è dichiarato", /pacchettiQ\.error && !schemaAssente\(pacchettiQ\.error\)/.test(lettura) && /pacchettiQ\.error \? \[\]/.test(lettura));
    atteso("il cliente del pacchetto è nell'elenco dei clienti di cui si leggono i dati di fatturazione", /\.\.\.pacchetti\.flatMap\(\(p\) => \(p\.user_id \? \[p\.user_id\] : \[\]\)\)/.test(lettura));
    atteso("il contatore «da fatturare» (barra e panoramica) somma i pacchetti: solo pagati, da fatturare, non di prova", /omnia_ai_pacchetti_acquisti"\)\.select\("importo_pagato_centesimi, prezzo_centesimi"\)\.eq\("stato", "pagata"\)\.eq\("stato_fattura", "da_fatturare"\)\.eq\("livemode", true\)/.test(lettura) && /pacchettiReali\.length/.test(lettura) && /pacchettiReali\.reduce/.test(lettura));
    atteso("il contatore: senza la tabella dei pacchetti conta il resto, ogni altro errore lo rende inattendibile (null)", /tabellaPacchettiAssente/.test(lettura) && /if \(pacchettiQ\.error && !tabellaPacchettiAssente\) return null;/.test(lettura));
    const calcoli = leggi("src/lib/console/fatturazione-calcoli.ts");
    atteso("la riga può essere di fonte «pacchetto»", /export type FonteRiga = "incasso" \| "crediti" \| "revisione" \| "piano_lavoro" \| "pacchetto";/.test(calcoli));
    const azioni = leggi("src/app/site-console/azioni/fatturazione.ts");
    const regex = (azioni.match(/const CHIAVE = (\/[^\n]+\/i);/) ?? [])[1];
    const CHIAVE = regex ? (new Function(`return ${regex}`)() as RegExp) : /^$/;
    atteso("l'azione sullo stato di fattura accetta «pacchetto:<uuid>»", CHIAVE.test(`pacchetto:${ID}`));
    atteso("e continua a rifiutare il resto (una fonte inventata, un id che non è un uuid, un nome al plurale)", !CHIAVE.test(`pacchetti:${ID}`) && !CHIAVE.test("pacchetto:1") && !CHIAVE.test(`ordine:${ID}`) && CHIAVE.test(`piano_lavoro:${ID}`) && CHIAVE.test(`revisione:${ID}`));
    atteso("l'aggiornamento raggruppa anche i pacchetti e li fattura solo dopo il pagamento", /\{ incasso: \[\], crediti: \[\], revisione: \[\], piano_lavoro: \[\], pacchetto: \[\] \}/.test(azioni) && /tipo === "revisione" \|\| tipo === "piano_lavoro" \|\| tipo === "pacchetto" \? richiesta\.eq\("stato", "pagata"\)/.test(azioni));
    atteso("la pagina dice che i pacchetti compaiono nell'elenco", /ogni pacchetto di servizi pagato/.test(leggi("src/app/site-console/_componenti/fatturazione-vista.tsx")));
    atteso("il PDF si carica e si scarica dalla console e dal cliente con le stesse regole (le route usano la tabella per fonte)", /TABELLA_PER_FONTE\[origine\]/.test(leggi("src/app/site-console/(app)/fatturazione/fattura/[fonte]/[id]/route.ts")) && /CHIAVE_PAGAMENTO\.test\(fonte\)/.test(leggi("src/app/site-console/(app)/fatturazione/fattura/[fonte]/[id]/route.ts")));
  }

  // ═════ 3. pagina «Piano di lavoro e pacchetti» ═════
  console.log("--- Interruttore di vendita: sciolto dall'abbonamento ---");
  const azioniPdl = leggi("src/app/site-console/azioni/piano-lavoro.ts");
  const libPdl = leggi("src/lib/console/piano-lavoro.ts");
  const vistaPdl = leggi("src/app/site-console/_componenti/piano-lavoro-vista.tsx");
  {
    const vendita = corpoFunzione(azioniPdl, "impostaVenditaPianoLavoro");
    atteso("parte da richiediAdminAzione", /^export async function impostaVenditaPianoLavoro\([^)]*\)[^{]*\{\n\s*const sessione = await richiediAdminAzione\(\);/.test(vendita));
    atteso("NON richiede più i prezzi Stripe dell'abbonamento allineati né le concessioni (migrazione 0101)", !/nonAllineati|stripe\.stato|dati\.piani|concessioniDisponibili|leggiPianoLavoroConsole|leggiPianiAbbonamentoConsole/.test(vendita));
    atteso("si accende solo con la chiave Stripe riconosciuta e con la migrazione 0104 (i clienti non vedono un pacchetto che non si può comprare); si spegne sempre", /=== "sconosciuta"/.test(vendita) && /tabellaPacchettiPresente\(\)/.test(vendita) && /pacchetti === "no"/.test(vendita) && /pacchetti === "errore"/.test(vendita) && /if \(azione === "attiva"\) \{/.test(vendita));
    atteso("il controllo della tabella distingue «manca» da «non so»", /schemaAssente\(error\)\) return "no"/.test(azioniPdl) && /return "errore"/.test(azioniPdl));
    atteso("i testi dicono che vale per la singola gara E per i pacchetti, e non nominano più l'opzione nell'abbonamento", /i pacchetti sono visibili ai clienti/.test(vendita) && !/nell'abbonamento|opzione/i.test(vendita.replace(/\/\/.*$/gm, "")));
    atteso("la vista dice che l'interruttore è uno solo e che il piano di lavoro non si vende più in abbonamento", /L&apos;interruttore è uno solo/.test(vistaPdl) && /non si vende più nell&apos;abbonamento/.test(vistaPdl));
  }
  console.log("--- Pagina: il pannello dell'abbonamento non c'è più, il lavoro resta nel codice ---");
  {
    atteso("la vista non mostra più i supplementi mensili né «Allinea i prezzi su Stripe»", !/Abbonamento con piano di lavoro/.test(vistaPdl) && !/salvaSupplementiPianoLavoro|allineaPrezziStripePianoLavoro|Allinea i prezzi su Stripe/.test(vistaPdl) && !/dati\.piani/.test(vistaPdl));
    atteso("le due azioni restano nel codice (il lavoro non si perde)", /export async function salvaSupplementiPianoLavoro/.test(azioniPdl) && /export async function allineaPrezziStripePianoLavoro/.test(azioniPdl) && /NON PIÙ IN PAGINA/.test(azioniPdl));
    atteso("la lettura dei prezzi Stripe dell'abbonamento è una funzione a parte, usata solo dall'azione di allineamento", /export async function leggiPianiAbbonamentoConsole/.test(libPdl) && /leggiPianiAbbonamentoConsole\(\)/.test(corpoFunzione(azioniPdl, "allineaPrezziStripePianoLavoro")));
    const dati = libPdl.slice(libPdl.indexOf("export async function leggiPianoLavoroConsole"));
    atteso("la lettura della pagina non chiama più Stripe", !/prices\.list|createStripeClient\(/.test(dati) && /prices\.list/.test(libPdl));
    atteso("i dati della pagina non portano più i piani dell'abbonamento e portano i pacchetti, la migrazione 0104 e le unità residue", !/\n  piani: PianoLavoroPianoConsole\[\];/.test(libPdl) && /pacchetti: PacchettoCatalogo\[\];/.test(libPdl) && /pacchettiDisponibili: boolean;/.test(libPdl) && /unitaResidue: number \| null;/.test(libPdl));
    atteso("senza la tabella dei saldi (migrazione 0104) la pagina si apre e lo dice", /saldiQ\.error && !schemaAssente\(saldiQ\.error\)/.test(libPdl) && /Manca la migrazione 0104/.test(vistaPdl));
    atteso("la pagina e la voce di menu si chiamano «Piano di lavoro e pacchetti», la route è la stessa", /etichetta: "Piano di lavoro e pacchetti"/.test(leggi("src/app/site-console/_componenti/navigazione.ts")) && /href: "\/piano-lavoro"/.test(leggi("src/app/site-console/_componenti/navigazione.ts")) && /title: "Piano di lavoro e pacchetti"/.test(leggi("src/app/site-console/(app)/piano-lavoro/page.tsx")));
    atteso("la nota con l'approvazione del legale del piano di lavoro c'è ancora", /\{NOTA_CONSOLE_TESTI\}/.test(vistaPdl));
  }

  console.log("--- Editor dei pacchetti ---");
  {
    const editor = corpoFunzione(azioniPdl, "salvaCatalogoPacchettiPianoLavoro");
    atteso("l'azione esiste e parte da richiediAdminAzione prima di leggere il modulo", /^export async function salvaCatalogoPacchettiPianoLavoro\([^)]*\)[^{]*\{\n\s*const sessione = await richiediAdminAzione\(\);\n\s*if \(!sessione\) return \{ errore: "Non autorizzato\." \};/.test(editor));
    atteso("legge le righe del modulo (quantità e prezzo, fino al massimo) e le valida con validaCatalogoDaModulo", /LIMITI_CATALOGO\.pacchettiMassimi/.test(editor) && /quantita_\$\{i \+ 1\}/.test(editor) && /prezzo_\$\{i \+ 1\}/.test(editor) && /validaCatalogoDaModulo\(righe\)/.test(editor) && /if \(!esito\.ok\) return \{ errore: esito\.errore \};/.test(editor));
    atteso("salva l'elenco normalizzato nella chiave del servizio, con l'upsert delle altre impostazioni", /serializzaCatalogoPacchetti\(esito\.catalogo\)/.test(editor) && /chiave: SERVIZI\.piano_lavoro\.chiaveCatalogo/.test(editor) && /await salva\(/.test(editor));
    atteso("non compra e non incassa nulla: nessun Stripe, nessun checkout, nessuna scrittura sui pagamenti", !/stripe|checkout|omnia_ai_pacchetti_(acquisti|saldi|movimenti)/i.test(editor));
    atteso("ricarica le pagine dopo il salvataggio", /ricarica\(\);/.test(editor));
    uguale("la chiave dell'elenco è quella che legge il sito dei clienti", SERVIZI.piano_lavoro.chiaveCatalogo, "pacchetti_piano_lavoro");
    atteso("la lettura della console usa la stessa chiave e la stessa interpretazione dei clienti", /SERVIZI\.piano_lavoro\.chiaveCatalogo/.test(libPdl) && /interpretaCatalogoPacchetti\("piano_lavoro", salvato\)/.test(libPdl));

    const righe = (v: [string, string][]) => v.map(([quantita, prezzoEuro]) => ({ quantita, prezzoEuro }));
    const ok = validaCatalogoDaModulo(righe([["5", "300"], ["10", "540,50"], ["", ""], ["", ""]]));
    uguale("un elenco valido si salva ordinato e con i prezzi in centesimi", ok.ok ? ok.catalogo : null, [{ quantita: 5, prezzoCentesimi: 30000 }, { quantita: 10, prezzoCentesimi: 54050 }]);
    atteso("righe del tutto vuote: elenco vuoto, cioè nessun pacchetto in vendita", (() => { const r = validaCatalogoDaModulo(righe([["", ""], ["", ""]])); return r.ok && r.catalogo.length === 0; })());
    uguale("l'elenco vuoto si salva come «[]» e si rilegge vuoto (non torna quello di partenza)", [serializzaCatalogoPacchetti([]), interpretaCatalogoPacchetti("piano_lavoro", serializzaCatalogoPacchetti([]))], ["[]", []]);
    atteso("mai salvato: l'elenco di partenza (5 piani a 300 €)", JSON.stringify(interpretaCatalogoPacchetti("piano_lavoro", null)) === JSON.stringify(CATALOGO_PREDEFINITO.piano_lavoro) && CATALOGO_PREDEFINITO.piano_lavoro[0].quantita === 5 && CATALOGO_PREDEFINITO.piano_lavoro[0].prezzoCentesimi === 30000);
    for (const [nome, v] of [
      ["quantità non intera", [["5,5", "300"]]],
      ["quantità sotto il minimo", [[String(LIMITI_CATALOGO.quantitaMinima - 1), "100"]]],
      ["quantità sopra il massimo", [[String(LIMITI_CATALOGO.quantitaMassima + 1), "100"]]],
      ["prezzo non numerico", [["5", "tanto"]]],
      ["prezzo mancante", [["5", ""]]],
      ["prezzo sotto 1 euro", [["5", "0,50"]]],
      ["due pacchetti con la stessa quantità", [["5", "300"], ["5", "310"]]],
      ["prezzo con le migliaia o il simbolo", [["5", "1.000,00 €"]]],
    ] as [string, [string, string][]][]) {
      atteso(`rifiutato: ${nome}`, !validaCatalogoDaModulo(righe(v)).ok);
    }
    atteso("oltre il numero massimo di pacchetti si ignora l'eccedenza (il modulo ne ha solo quel numero)", validaCatalogoDaModulo(righe(Array.from({ length: LIMITI_CATALOGO.pacchettiMassimi }, (_, i) => [String(i + 2), "10"] as [string, string]))).ok);
    atteso("la vista mostra l'editor, il prezzo per unità e il risparmio, la nota «bozza da far approvare dal legale» in evidenza", /salvaCatalogoPacchettiPianoLavoro/.test(vistaPdl) && /convenienzaPacchetto\(p, dati\.prezzoSingoloCentesimi\)/.test(vistaPdl) && /\{NOTA_CONSOLE_CONDIZIONI_PACCHETTI\}/.test(vistaPdl) && /APPROVAZIONE_LEGALE_PACCHETTI \? "ok" : "avviso"/.test(vistaPdl));
    atteso("la vista dice che le unità non scadono, che si perdono alla cessazione e che i pacchetti si vendono solo con l'abbonamento attivo", /non scadono nel tempo/.test(vistaPdl) && /si perdono/.test(vistaPdl) && /solo a chi ha l&apos;abbonamento attivo/.test(vistaPdl));
  }

  // ═════ 4. scheda cliente ═════
  console.log("--- Scheda cliente: saldo, acquisti, movimenti, rettifica ---");
  {
    const azioni = leggi("src/app/site-console/azioni/pacchetti.ts");
    atteso("il file è «use server» e non esporta altro che funzioni asincrone e tipi", azioni.startsWith('"use server"') && !/^export (const|let|var|function) /m.test(azioni));
    const funzioni = azioni.split(/^export async function /m).slice(1);
    uguale("le azioni sono la rettifica del saldo e le due delle offerte dedicate (crea, revoca)", funzioni.map((f) => f.split("(")[0]), ["rettificaPacchettiCliente", "creaOffertaDedicataCliente", "revocaOffertaDedicataCliente"]);
    const r = corpoFunzione(azioni, "rettificaPacchettiCliente");
    atteso("parte da richiediAdminAzione, prima di leggere il modulo e di toccare il database", /^export async function rettificaPacchettiCliente\([^)]*\)[^{]*\{\n\s*const sessione = await richiediAdminAzione\(\);\n\s*if \(!sessione\) return \{ errore: "Non autorizzato\." \};/.test(r));
    atteso("controlla cliente (uuid), servizio (elenco chiuso, solo se in vendita), variazione intera e non zero, motivo di almeno due caratteri", /UUID\.test\(userId\)/.test(r) && /eServizioPacchetto\(servizio\)/.test(r) && /\.disponibile\)/.test(r) && /\^\[\+-\]\?\\d\{1,4\}\$/.test(r) && /delta === 0/.test(r) && /VARIAZIONE_MASSIMA/.test(r) && /motivo\.length < 2/.test(r) && /motivo\.length > 300/.test(r));
    atteso("le unità sono del titolare: a un Ufficio Gare non si assegnano, e se il controllo non riesce non si tocca nulla (PRIMA di scrivere)", /leggiTitolareDelMembro\(userId, admin\);\n\s*if \(titolareDelMembro === "errore"\) return \{ errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO \};\n\s*if \(titolareDelMembro\) return \{ errore: MESSAGGIO_E_UN_UFFICIO_GARE \};/.test(r) && r.indexOf("leggiTitolareDelMembro") < r.indexOf("rettificaPacchetti(admin"));
    atteso("scrive SOLO con la funzione SQL (registro e saldo nella stessa transazione, mai sotto zero), con l'email dell'admin e il motivo", /rettificaPacchetti\(admin, \{ userId, servizio, delta, motivo, da: sessione\.email \}\)/.test(r) && !/\.(insert|update|upsert|delete)\(/.test(r));
    atteso("l'esito negativo è restituito com'è (saldo sotto zero compreso)", /if \(!esito\.ok\) return \{ errore: esito\.errore \};/.test(r));
    atteso("nessuna azione tocca Stripe né apre pagamenti", !/stripe|checkout/i.test(azioni));
  }
  {
    // la funzione di libreria con un client finto: nome della funzione SQL e argomenti, saldo sotto zero, errore generico
    const chiamate: { nome: string; args: unknown }[] = [];
    const finto = (risposta: { data: unknown; error: { code?: string; message: string } | null }) =>
      ({ rpc: async (nome: string, args: unknown) => { chiamate.push({ nome, args }); return risposta; } }) as unknown as SupabaseClient;
    const ok = await rettificaPacchetti(finto({ data: 7, error: null }), { userId: ID, servizio: "piano_lavoro", delta: 2, motivo: "regalo", da: "admin@x.it" });
    uguale("una rettifica valida torna il nuovo saldo", ok, { ok: true, saldo: 7 });
    uguale("chiama la funzione SQL della migrazione 0104 con gli argomenti giusti", chiamate[0], { nome: "omnia_ai_pacchetto_rettifica", args: { p_user: ID, p_servizio: "piano_lavoro", p_delta: 2, p_motivo: "regalo", p_da: "admin@x.it" } });
    const sotto = await rettificaPacchetti(finto({ data: null, error: { message: "saldo insufficiente" } }), { userId: ID, servizio: "piano_lavoro", delta: -5, motivo: "correzione", da: "admin@x.it" });
    uguale("togliere più unità di quante ci sono è rifiutato, con un messaggio chiaro", sotto, { ok: false, errore: "Il saldo non può scendere sotto zero." });
    const orig = console.error;
    console.error = () => {};
    const mancante = await rettificaPacchetti(finto({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }), { userId: ID, servizio: "piano_lavoro", delta: 1, motivo: "prova", da: "admin@x.it" });
    console.error = orig;
    atteso("con la migrazione 0104 non eseguita (funzione assente) non cade: errore generico, nessun saldo inventato", !mancante.ok && /Rettifica non riuscita/.test(mancante.errore));
  }
  {
    const lettura = leggi("src/lib/console/utenti.ts");
    atteso("la scheda legge saldo, acquisti pagati e movimenti del cliente (senza le tabelle non cade e lo dichiara)", /from\("omnia_ai_pacchetti_acquisti"\)[\s\S]{0,320}\.eq\("user_id", id\)[\s\S]{0,60}\.eq\("stato", "pagata"\)/.test(lettura) && /from\("omnia_ai_pacchetti_saldi"\)/.test(lettura) && /from\("omnia_ai_pacchetti_movimenti"\)/.test(lettura) && /pacchettiDisponibili = !pacchettiAcqQ\.error && !pacchettiSaldiQ\.error && !pacchettiMovQ\.error/.test(lettura) && /q\.error && !schemaAssente\(q\.error\)/.test(lettura));
    atteso("senza le tabelle la scheda NON finge un saldo zero: disponibile=false e nessun dato", /disponibile: pacchettiDisponibili/.test(lettura) && /saldi: pacchettiDisponibili \?[\s\S]{0,140}\.map\(\(r\) => \(\{ servizio: r\.servizio/.test(lettura) && /: \[\],\n\s*acquisti: pacchettiDisponibili/.test(lettura));
    const vista = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
    atteso("il pannello «Pacchetti di servizi» c'è, con unità residue, acquisti con stato di fattura, movimenti con motivo e autore", /Pacchetti di servizi \(\$\{s\.pacchetti\.acquisti\.length\} acquistati\)/.test(vista) && /Unità residue/.test(vista) && /Acquisti pagati/.test(vista) && /ETICHETTA_MOVIMENTO\[m\.tipo as MovimentoTipo\]/.test(vista) && /m\.eseguitoDa/.test(vista) && /s\.pacchetti\.acquisti\.map\(\(p\) =>/.test(vista));
    atteso("un acquisto di prova porta il segno «prova»", /\{p\.prova && \(/.test(vista.slice(vista.indexOf("Pacchetti di servizi (")))) ;
    atteso("il modulo di rettifica: servizio fisso, variazione e motivo obbligatori, con l'azione giusta", /azione=\{rettificaPacchettiCliente\} campi=\{\{ userId: s\.utente\.id, servizio: "piano_lavoro" \}\}/.test(vista) && /name="delta"[^>]*required/.test(vista) && /name="motivo"[^>]*required/.test(vista));
    atteso("la scheda dice che le unità si perdono comunque alla cessazione, anche quelle regalate", /si perdono, come i crediti: anche quelle che regali da qui/.test(vista));
    atteso("per un Ufficio Gare il pannello è sostituito dal messaggio (le unità sono del titolare)", /\{eMembro \? \(\s*<p className="cn-nota-inline">\{MESSAGGIO_E_UN_UFFICIO_GARE\}<\/p>\s*\) : !s\.pacchetti\.disponibile/.test(vista.slice(vista.indexOf("Pacchetti prepagati di servizi aggiuntivi"))));
    atteso("senza la migrazione 0104 la scheda lo dice", /I pacchetti non sono disponibili: manca la migrazione 0104/.test(vista));
  }
  {
    const azioniUtenti = leggi("src/app/site-console/azioni/utenti.ts");
    atteso("eliminare un cliente con un pacchetto pagato davvero (non di prova) è rifiutato: è un dato contabile da conservare, si anonimizza", /omnia_ai_pacchetti_acquisti"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("user_id", bersaglio\.id\)\.eq\("stato", "pagata"\)\.eq\("livemode", true\)/.test(azioniUtenti) && /pacchettiReali\.count/.test(azioniUtenti) && /pacchettiReali\.error \? 0/.test(azioniUtenti));
    const prova = leggi("src/lib/console/prova.ts");
    atteso("i dati di prova della barra contano anche i pacchetti pagati in modalità test (tabella assente = nessun dato)", /from\("omnia_ai_pacchetti_acquisti"\)\.select\("pagata_il"\)\.eq\("stato", "pagata"\)\.eq\("livemode", false\)/.test(prova) && /pacchetti\.error \? \[\]/.test(prova));
    const costi = leggi("src/lib/console/costi.ts") + leggi("src/lib/console/costi-calcoli.ts");
    atteso("costi e margini non includono i pacchetti (come le revisioni e i piani di lavoro singoli)", !/omnia_ai_pacchetti/.test(costi));
  }

  // ═════ 4b. offerte dedicate ═════
  console.log("--- Offerte dedicate: stato, validazione ---");
  const oggi = "2026-11-10";
  const riga = (o: Partial<RigaOfferta & { cliente_email: string | null }> = {}): RigaOfferta & { cliente_email: string | null } => ({
    id: "22222222-2222-4222-8222-222222222222",
    user_id: ID,
    servizio: "piano_lavoro",
    quantita: 10,
    prezzo_centesimi: 45000,
    scade_il: null,
    nota: "accordo con il commerciale",
    stato: "attiva",
    creata_il: "2026-11-09T10:00:00Z",
    creata_da_email: "admin@x.it",
    chiusa_il: null,
    chiusa_da_email: null,
    acquisto_id: null,
    cliente_email: "cliente@x.it",
    ...o,
  });
  {
    uguale("un'offerta attiva senza scadenza è «attiva»", statoOffertaConsole(riga(), oggi), "attiva");
    uguale("l'ultimo giorno è incluso: scade oggi = ancora «attiva»", statoOffertaConsole(riga({ scade_il: oggi }), oggi), "attiva");
    uguale("scaduta ieri = «scaduta» (non sembra comprabile)", statoOffertaConsole(riga({ scade_il: "2026-11-09" }), oggi), "scaduta");
    uguale("una già acquistata resta «acquistata» anche con la data passata", statoOffertaConsole(riga({ stato: "acquistata", scade_il: "2026-01-01" }), oggi), "acquistata");
    uguale("una revocata resta «revocata»", statoOffertaConsole(riga({ stato: "revocata" }), oggi), "revocata");
    uguale("si può revocare solo finché non è stata comprata o revocata (anche se è scaduta di data)", (["attiva", "scaduta", "acquistata", "revocata"] as const).map(revocabile), [true, true, false, false]);
    const v = daRigaConsole(riga({ scade_il: "2026-12-31" }), oggi);
    uguale("la riga del database diventa quella della console, con il cliente e la nota interna", [v.id, v.cliente, v.quantita, v.prezzoCentesimi, v.scadeIl, v.nota, v.stato, v.creataDa], ["22222222-2222-4222-8222-222222222222", "cliente@x.it", 10, 45000, "2026-12-31", "accordo con il commerciale", "attiva", "admin@x.it"]);
    uguale("un cliente non trovato resta null (la pagina scrive «cliente non trovato»)", daRigaConsole(riga({ cliente_email: null }), oggi).cliente, null);
  }
  {
    const modulo = (o: Partial<Parameters<typeof validaNuovaOfferta>[0]> = {}) => ({ email: " Cliente@X.IT ", servizio: "piano_lavoro", quantita: "10", prezzoEuro: "450,00", scadeIl: "2026-12-31", nota: "  accordo  ", ...o });
    uguale(
      "un'offerta valida: email in minuscolo, prezzo in centesimi, nota ripulita",
      validaNuovaOfferta(modulo(), oggi),
      { ok: true, valori: { email: "cliente@x.it", servizio: "piano_lavoro", quantita: 10, prezzoCentesimi: 45000, scadeIl: "2026-12-31", nota: "accordo" } },
    );
    uguale("scadenza e nota facoltative: restano null", (() => { const r = validaNuovaOfferta(modulo({ scadeIl: "", nota: "  " }), oggi); return r.ok ? [r.valori.scadeIl, r.valori.nota] : null; })(), [null, null]);
    atteso("la scadenza di oggi è ammessa (l'ultimo giorno è incluso)", validaNuovaOfferta(modulo({ scadeIl: oggi }), oggi).ok);
    atteso("una sola unità e il massimo sono ammessi (l'offerta dedicata può essere anche di un solo piano)", validaNuovaOfferta(modulo({ quantita: String(LIMITI_OFFERTA.quantitaMinima) }), oggi).ok && validaNuovaOfferta(modulo({ quantita: String(LIMITI_OFFERTA.quantitaMassima) }), oggi).ok && LIMITI_OFFERTA.quantitaMinima === 1);
    const rifiuti: [string, Partial<Parameters<typeof validaNuovaOfferta>[0]>][] = [
      ["email vuota", { email: "  " }],
      ["email senza chiocciola", { email: "cliente.x.it" }],
      ["email troppo lunga", { email: `${"a".repeat(250)}@x.it` }],
      ["servizio inventato", { servizio: "altro" }],
      ["servizio non ancora disponibile (OMNIA FOOD MENU «sta arrivando»)", { servizio: "food_menu" }],
      ["quantità zero", { quantita: "0" }],
      ["quantità oltre il massimo", { quantita: String(LIMITI_OFFERTA.quantitaMassima + 1) }],
      ["quantità non intera", { quantita: "2,5" }],
      ["quantità vuota", { quantita: "" }],
      ["prezzo non numerico", { prezzoEuro: "tanto" }],
      ["prezzo con le migliaia o il simbolo", { prezzoEuro: "1.000,00 €" }],
      ["prezzo sotto 1 euro", { prezzoEuro: "0,50" }],
      ["prezzo oltre il massimo", { prezzoEuro: "100001" }],
      ["prezzo vuoto", { prezzoEuro: "" }],
      ["scadenza già passata", { scadeIl: "2026-11-09" }],
      ["scadenza in un formato strano", { scadeIl: "31/12/2026" }],
      ["scadenza impossibile", { scadeIl: "2026-13-45" }],
      ["nota troppo lunga", { nota: "x".repeat(LIMITI_OFFERTA.notaMassima + 1) }],
    ];
    for (const [nome, extra] of rifiuti) atteso(`rifiutato: ${nome}`, !validaNuovaOfferta(modulo(extra), oggi).ok);
  }

  console.log("--- Offerte dedicate: libreria con un database finto ---");
  {
    type RigaDb = Record<string, unknown>;
    type Esito = { data: unknown; error: { code?: string; message: string } | null };
    class Q implements PromiseLike<Esito> {
      private filtri: ((r: RigaDb) => boolean)[] = [];
      private op: "select" | "insert" | "update" = "select";
      private dati: RigaDb | null = null;
      private massimo = Infinity;
      private ordine: ((r: RigaDb[]) => RigaDb[]) | null = null;
      private singolo = false;
      constructor(private nome: string, private db: Record<string, RigaDb[]>, private assenti: string[]) {}
      select() { return this; }
      insert(d: RigaDb) { this.op = "insert"; this.dati = d; return this; }
      update(d: RigaDb) { this.op = "update"; this.dati = d; return this; }
      eq(c: string, v: unknown) { this.filtri.push((r) => r[c] === v); return this; }
      in(c: string, valori: unknown[]) { this.filtri.push((r) => valori.includes(r[c])); return this; }
      order(c: string, o?: { ascending?: boolean }) { this.ordine = (r) => [...r].sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (o?.ascending === false ? -1 : 1)); return this; }
      limit(n: number) { this.massimo = n; return this; }
      returns() { return this; }
      single() { this.singolo = true; return this; }
      maybeSingle() { this.singolo = true; return this; }
      private esegui(): Esito {
        if (this.assenti.includes(this.nome)) return { data: null, error: { code: "42P01", message: `relation "${this.nome}" does not exist` } };
        const tabella = (this.db[this.nome] ??= []);
        if (this.op === "insert") {
          const nuova = { id: `nuova-${tabella.length + 1}`, stato: "attiva", ...this.dati };
          tabella.push(nuova);
          return { data: this.singolo ? { id: nuova.id } : [nuova], error: null };
        }
        let trovate = tabella.filter((r) => this.filtri.every((f) => f(r)));
        if (this.op === "update") for (const r of trovate) Object.assign(r, this.dati);
        if (this.ordine) trovate = this.ordine(trovate);
        trovate = trovate.slice(0, this.massimo);
        return { data: this.singolo ? (trovate[0] ?? null) : trovate, error: null };
      }
      then<A = Esito, B = never>(ok?: ((v: Esito) => A | PromiseLike<A>) | null, ko?: ((r: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
        return Promise.resolve(this.esegui()).then(ok, ko);
      }
    }
    const finto = (db: Record<string, RigaDb[]>, assenti: string[] = []) => ({ from: (nome: string) => new Q(nome, db, assenti) }) as unknown as SupabaseClient;
    const zitto = async <T,>(f: () => Promise<T>): Promise<T> => {
      const vecchio = console.error;
      console.error = () => {};
      try {
        return await f();
      } finally {
        console.error = vecchio;
      }
    };

    // creazione
    const db: Record<string, RigaDb[]> = { omnia_ai_pacchetti_offerte: [], users: [{ id: ID, email: "cliente@x.it" }] };
    const creata = await creaOffertaDedicata(finto(db), { userId: ID, valori: { servizio: "piano_lavoro", quantita: 10, prezzoCentesimi: 45000, scadeIl: "2026-12-31", nota: "accordo" }, daEmail: "admin@x.it" });
    atteso("creaOffertaDedicata: restituisce l'id e scrive le colonne giuste (cliente, servizio, quantità, prezzo in centesimi, scadenza, nota, chi la crea)", creata.ok && JSON.stringify(Object.keys(db.omnia_ai_pacchetti_offerte[0]).sort()) === JSON.stringify(["creata_da_email", "id", "nota", "prezzo_centesimi", "quantita", "scade_il", "servizio", "stato", "user_id"]) && db.omnia_ai_pacchetti_offerte[0].user_id === ID && db.omnia_ai_pacchetti_offerte[0].prezzo_centesimi === 45000 && db.omnia_ai_pacchetti_offerte[0].creata_da_email === "admin@x.it", JSON.stringify(db.omnia_ai_pacchetti_offerte));
    const senzaTabella = await zitto(() => creaOffertaDedicata(finto({}, ["omnia_ai_pacchetti_offerte"]), { userId: ID, valori: { servizio: "piano_lavoro", quantita: 10, prezzoCentesimi: 45000, scadeIl: null, nota: null }, daEmail: "admin@x.it" }));
    atteso("senza la migrazione 0105 la creazione non cade: dice che manca la 0105", !senzaTabella.ok && /0105/.test(senzaTabella.errore));

    // revoca: solo le attive
    const idAttiva = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const dbRevoca: Record<string, RigaDb[]> = {
      omnia_ai_pacchetti_offerte: [
        { id: idAttiva, stato: "attiva" },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", stato: "acquistata" },
        { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", stato: "revocata" },
      ],
    };
    uguale("revocare un'offerta attiva: «revocata», con data e chi l'ha fatto", [await revocaOffertaDedicata(finto(dbRevoca), idAttiva, "admin@x.it"), dbRevoca.omnia_ai_pacchetti_offerte[0].stato, dbRevoca.omnia_ai_pacchetti_offerte[0].chiusa_da_email, typeof dbRevoca.omnia_ai_pacchetti_offerte[0].chiusa_il], ["revocata", "revocata", "admin@x.it", "string"]);
    uguale("revocarla di nuovo: «non_attiva», nessuna modifica", await revocaOffertaDedicata(finto(dbRevoca), idAttiva, "altro@x.it"), "non_attiva");
    uguale("una già acquistata NON si revoca (le unità sono nel saldo del cliente)", [await revocaOffertaDedicata(finto(dbRevoca), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "admin@x.it"), dbRevoca.omnia_ai_pacchetti_offerte[1].stato], ["non_attiva", "acquistata"]);
    uguale("un'offerta che non esiste: «non_attiva»", await revocaOffertaDedicata(finto(dbRevoca), "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "admin@x.it"), "non_attiva");
    uguale("senza la migrazione 0105 la revoca dà «errore» senza cadere", await zitto(() => revocaOffertaDedicata(finto({}, ["omnia_ai_pacchetti_offerte"]), idAttiva, "admin@x.it")), "errore");

    // lettura per la console
    const dbLettura: Record<string, RigaDb[]> = {
      omnia_ai_pacchetti_offerte: [
        { id: "o1", user_id: ID, servizio: "piano_lavoro", quantita: 10, prezzo_centesimi: 45000, stato: "attiva", creata_il: "2026-11-01T10:00:00Z" },
        { id: "o2", user_id: ID, servizio: "piano_lavoro", quantita: 5, prezzo_centesimi: 20000, stato: "revocata", creata_il: "2026-11-05T10:00:00Z" },
        { id: "o3", user_id: "altro-utente", servizio: "piano_lavoro", quantita: 3, prezzo_centesimi: 9000, stato: "attiva", creata_il: "2026-11-03T10:00:00Z" },
      ],
      users: [{ id: ID, email: "cliente@x.it" }, { id: "altro-utente", email: "altro@x.it" }],
    };
    const tutte = await leggiOfferteConsole(finto(dbLettura));
    uguale("la console legge tutte le offerte, dalla più recente, con l'email del cliente", [tutte.disponibile, tutte.offerte.map((o) => [o.id, o.cliente_email])], [true, [["o2", "cliente@x.it"], ["o3", "altro@x.it"], ["o1", "cliente@x.it"]]]);
    uguale("la scheda legge solo le offerte di quel cliente", (await leggiOfferteConsole(finto(dbLettura), { perUtente: ID })).offerte.map((o) => o.id), ["o2", "o1"]);
    uguale("senza la migrazione 0105: nessuna offerta e «disponibile: false», senza errori", await zitto(() => leggiOfferteConsole(finto({}, ["omnia_ai_pacchetti_offerte"]))), { disponibile: false, offerte: [] });
  }

  console.log("--- Offerte dedicate: azioni, pagina, scheda ---");
  {
    const azioni = leggi("src/app/site-console/azioni/pacchetti.ts");
    const crea = corpoFunzione(azioni, "creaOffertaDedicataCliente");
    const revoca = corpoFunzione(azioni, "revocaOffertaDedicataCliente");
    atteso("creazione: parte da richiediAdminAzione, prima di leggere il modulo e di toccare il database", /^export async function creaOffertaDedicataCliente\([^)]*\)[^{]*\{\n\s*const sessione = await richiediAdminAzione\(\);\n\s*if \(!sessione\) return \{ errore: "Non autorizzato\." \};/.test(crea));
    atteso("creazione: valida tutto con validaNuovaOfferta (giorno di Roma) PRIMA di leggere il database", /validaNuovaOfferta\(/.test(crea) && /giornoRoma\(new Date\(\)\)/.test(crea) && /if \(!esito\.ok\) return \{ errore: esito\.errore \};/.test(crea) && crea.indexOf("validaNuovaOfferta(") < crea.indexOf("createAdminClient()"));
    atteso("creazione: legge i sei campi del modulo (email, servizio, quantità, prezzo, scadenza, nota)", ["email", "servizio", "quantita", "prezzo", "scadeIl", "nota"].every((c) => crea.includes(`formData.get("${c}")`)));
    atteso("creazione: il cliente si cerca per email normalizzata nella tabella degli utenti; non trovato = errore chiaro, nessuna offerta", /\.from\("users"\)\.select\("id"\)\.eq\("email", valori\.email\)/.test(crea) && /if \(!utente\) return \{ errore: "Nessun cliente con questo indirizzo email\." \}/.test(crea));
    atteso("creazione: un Ufficio Gare non riceve offerte e, se il controllo non riesce, non si crea nulla (PRIMA di scrivere)", /leggiTitolareDelMembro\(utente\.id, admin\);\n\s*if \(titolareDelMembro === "errore"\) return \{ errore: MESSAGGIO_CONTROLLO_UFFICIO_GARE_NON_RIUSCITO \};\n\s*if \(titolareDelMembro\) return \{ errore: MESSAGGIO_E_UN_UFFICIO_GARE \};/.test(crea) && crea.indexOf("leggiTitolareDelMembro") < crea.indexOf("creaOffertaDedicata("));
    atteso("creazione: scrive SOLO con la libreria (nessuna scrittura diretta), con l'email dell'admin e il cliente trovato", /creaOffertaDedicata\(admin, \{ userId: utente\.id, valori, daEmail: sessione\.email \}\)/.test(crea) && !/\.(insert|update|upsert|delete)\(/.test(crea));
    atteso("creazione: il servizio non si fida del browser (riconvalidato da validaNuovaOfferta), il prezzo è quello digitato dall'admin, mai letto da altro", !/prezzoMostrato|searchParams|headers\(/.test(crea));
    atteso("creazione: ricarica la console dopo aver creato", /revalidatePath\("\/site-console", "layout"\);\n\s*return \{ ok: true \};/.test(crea));
    atteso("revoca: parte da richiediAdminAzione, controlla che l'id sia un uuid e usa la libreria", /^export async function revocaOffertaDedicataCliente\([^)]*\)[^{]*\{\n\s*const sessione = await richiediAdminAzione\(\);\n\s*if \(!sessione\) return \{ errore: "Non autorizzato\." \};/.test(revoca) && /UUID\.test\(id\)/.test(revoca) && /revocaOffertaDedicata\(createAdminClient\(\), id, sessione\.email\)/.test(revoca));
    atteso("revoca: «non attiva» (già comprata o revocata) e «errore» danno un messaggio, non un successo", /esito === "errore"\) return \{ errore:/.test(revoca) && /esito === "non_attiva"\) return \{ errore:/.test(revoca) && !/\.(insert|update|upsert|delete)\(/.test(revoca));
    atteso("nessuna delle due azioni incassa, apre un pagamento o scrive al cliente (l'offerta compare nella sua area)", !/stripe|checkout|sendEmail|inviaEmail|resend/i.test(crea + revoca));

    const lib = leggi("src/lib/pacchetti-servizi.ts");
    atteso("la revoca nel database è condizionata allo stato «attiva» (una già comprata non si tocca) e registra chi e quando", /\.update\(\{ stato: "revocata", chiusa_il: new Date\(\)\.toISOString\(\), chiusa_da_email: daEmail \}\)\s*\.eq\("id", offertaId\)\s*\.eq\("stato", "attiva"\)/.test(lib));

    const vista = leggi("src/app/site-console/_componenti/piano-lavoro-vista.tsx");
    const libPdl2 = leggi("src/lib/console/piano-lavoro.ts");
    atteso("la pagina legge le offerte dedicate (senza la migrazione 0105 non cade) e le passa alla vista", /offerte: OfferteDedicateConsole;/.test(libPdl2) && /leggiOfferteDedicateConsole\(\{ limite: 200 \}\)/.test(libPdl2) && /^\s+offerte,$/m.test(libPdl2));
    const lettura = leggi("src/lib/console/offerte.ts");
    atteso("la lettura per la console usa la chiave di servizio e la libreria, e lo stato «scaduta» si calcola col giorno di Roma", /createAdminClient\(\)/.test(lettura) && /leggiOfferteConsole\(/.test(lettura) && /giornoRoma\(new Date\(\)\)/.test(lettura) && /daRigaConsole\(o, oggi\)/.test(lettura));
    atteso("la vista ha il pannello «Offerte dedicate» con il modulo (email, quantità, prezzo, scadenza, nota) e l'azione di creazione, servizio fisso", /Offerte dedicate \(\$\{dati\.offerte\.elenco\.filter/.test(vista) && /azione=\{creaOffertaDedicataCliente\} campi=\{\{ servizio: "piano_lavoro" \}\}/.test(vista) && ["email", "quantita", "prezzo", "scadeIl", "nota"].every((c) => new RegExp(`name="${c}"`).test(vista.slice(vista.indexOf("Offerte dedicate (")))));
    atteso("la vista spiega: la vede solo quel cliente, non compare nell'elenco pubblico, si compra una volta sola, vale solo con la vendita accesa", /La vede solo lui/.test(vista.replace(/\s+/g, " ").replace(/\s?\n\s?/g, " ")) && /non compare nell&apos;elenco pubblico/.test(vista.replace(/\s+/g, " ")) && /una volta sola/.test(vista) && /solo con la vendita accesa/.test(vista));
    atteso("la tabella mostra cliente, pacchetto, prezzo, prezzo per unità, risparmio sul prezzo singolo, scadenza, stato e nota", /<th>Cliente<\/th>/.test(vista.slice(vista.indexOf("Offerte dedicate ("))) && /convenienzaPacchetto\(\{ quantita: o\.quantita, prezzoCentesimi: o\.prezzoCentesimi \}, dati\.prezzoSingoloCentesimi\)/.test(vista) && /Valida fino al/.test(vista) && /ETICHETTA_STATO_OFFERTA\[o\.stato\]/.test(vista) && /Nota: \{o\.nota\}/.test(vista));
    atteso("«Revoca» compare solo sulle offerte che si possono ancora revocare", /\{revocabile\(o\.stato\) && \(\s*<ModuloAzione azione=\{revocaOffertaDedicataCliente\} campi=\{\{ id: o\.id \}\}/.test(vista));
    atteso("senza la migrazione 0105 la pagina dice «Disponibile dopo la migrazione 0105», senza modulo e senza errori", /!dati\.offerte\.disponibile \? \(\s*<p className="cn-esito avviso" role="alert">\s*Disponibile dopo la migrazione 0105/.test(vista));
    atteso("l'etichetta «scaduta» e «acquistata» distinguono le offerte non più comprabili", /scaduta: "scaduta"/.test(leggi("src/lib/console/offerte-calcoli.ts")) && /acquistata: "acquistata"/.test(leggi("src/lib/console/offerte-calcoli.ts")));

    const lib2 = leggi("src/lib/console/utenti.ts");
    atteso("la scheda legge le offerte dedicate di QUESTO cliente (senza la migrazione 0105 nessuna, dichiarato)", /leggiOfferteDedicateConsole\(\{ perUtente: id, limite: 50 \}\)/.test(lib2) && /offerte: offerteDedicate,/.test(lib2) && /offerte: OfferteDedicateConsole;/.test(lib2));
    const scheda = leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx");
    const pannelloScheda = scheda.slice(scheda.indexOf("Pacchetti prepagati di servizi aggiuntivi"), scheda.indexOf("Prova gratuita e account creato dalla console"));
    atteso("la scheda mostra le offerte del cliente con stato e «Revoca» sulle revocabili", /Offerte dedicate a questo cliente/.test(pannelloScheda) && /s\.pacchetti\.offerte\.elenco\.map\(\(o\) =>/.test(pannelloScheda) && /\{revocabile\(o\.stato\) && \(\s*<ModuloAzione azione=\{revocaOffertaDedicataCliente\} campi=\{\{ id: o\.id \}\}/.test(pannelloScheda));
    atteso("il modulo della scheda ha l'email del cliente già compilata e NON modificabile (campo nascosto), servizio fisso, e quantità e prezzo obbligatori", /azione=\{creaOffertaDedicataCliente\} campi=\{\{ email: s\.utente\.email, servizio: "piano_lavoro" \}\}/.test(pannelloScheda) && /name="quantita"[^>]*required/.test(pannelloScheda) && /name="prezzo"[^>]*required/.test(pannelloScheda) && !/name="email"/.test(pannelloScheda));
    atteso("per un Ufficio Gare nessun modulo (il pannello intero è sostituito dal messaggio) e senza la migrazione 0105 la scheda lo dice", /\{eMembro \? \(\s*<p className="cn-nota-inline">\{MESSAGGIO_E_UN_UFFICIO_GARE\}<\/p>\s*\) : !s\.pacchetti\.disponibile/.test(pannelloScheda) && /\{!s\.pacchetti\.offerte\.disponibile \? \(\s*<p className="cn-nota-inline">Le offerte dedicate sono disponibili dopo la migrazione 0105\.<\/p>/.test(pannelloScheda));
    atteso("la scheda mostra anche la nota interna dell'offerta (solo in console)", /\{o\.nota && <small>Nota: \{o\.nota\}<\/small>\}/.test(pannelloScheda));
    uguale("la nota interna NON arriva al cliente: l'offerta come la vede lui non ha nemmeno il campo", Object.keys(daRigaOfferta(riga({ nota: "segreta" }))).sort(), ["id", "prezzoCentesimi", "quantita", "scadeIl", "servizio"]);
  }

  // ═════ 5. sicurezza della console ═════
  console.log("--- Sicurezza ---");
  {
    const nuovi = ["src/app/site-console/azioni/pacchetti.ts", "src/app/site-console/azioni/piano-lavoro.ts"];
    for (const file of nuovi) {
      const testo = leggi(file);
      const funzioni = testo.split(/^export async function /m).slice(1);
      const senzaGuardia = funzioni.filter((corpo) => {
        const guardia = corpo.indexOf("await richiediAdminAzione()");
        return guardia < 0 || /createAdminClient\(\)|formData\.get|\bawait\b/.test(corpo.slice(0, guardia));
      });
      uguale(`${path.basename(file)}: ogni azione esportata comincia da richiediAdminAzione`, senzaGuardia.map((c) => c.split("(")[0]), []);
    }
    atteso("le chiavi del servizio non si leggono mai dal modulo: il servizio della rettifica è fisso nella pagina e riconvalidato dal server", /campi=\{\{ userId: s\.utente\.id, servizio: "piano_lavoro" \}\}/.test(leggi("src/app/site-console/_componenti/scheda-cliente-vista.tsx")) && /eServizioPacchetto\(servizio\)/.test(leggi("src/app/site-console/azioni/pacchetti.ts")));
    atteso("nessun riferimento alla console dai due siti pubblici (le pagine dei pacchetti dei clienti non importano nulla della console)", ["src/app/actions/pacchetti-servizi.ts", "src/lib/pacchetti-servizi.ts", "src/lib/pacchetti-servizi-calcoli.ts", "src/components/omnia-ai/servizi-per-le-gare.tsx"].filter((f) => fs.existsSync(path.join(__dirname, "..", f))).every((f) => !/lib\/console|site-console|console\.omniaitalia/.test(leggi(f))));
  }

  console.log("");
  if (fallimenti.length > 0) {
    console.error(`${fallimenti.length} controlli falliti:\n - ${fallimenti.join("\n - ")}`);
    process.exit(1);
  }
  console.log("Tutti i controlli sono andati a buon fine.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
