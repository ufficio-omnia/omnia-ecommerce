// Autotest della console per i pacchetti prepagati di servizi aggiuntivi (piano di lavoro e, in arrivo, OMNIA FOOD MENU): ricavi, da fatturare, scheda
// cliente con la rettifica del saldo, editor dei pacchetti, interruttore di vendita sciolto dall'abbonamento, tolleranza alla migrazione 0104
// non ancora eseguita. Gratuito, nessun database né rete (client finti e controlli sul testo dei sorgenti): gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcolaPeriodo } from "../src/lib/console/periodo";
import { aggregaRicavi, type FonteRicavo, type VoceRicavo } from "../src/lib/console/ricavi-calcoli";
import { descrizionePacchettoRiga, descrizionePianoLavoroRiga } from "../src/lib/console/fatturazione-calcoli";
import { rettificaPacchetti } from "../src/lib/pacchetti-servizi";
import { COLONNA_DATA_PER_FONTE, TABELLA_PER_FONTE, percorsoFatturaPagamento } from "../src/lib/omnia-ai-pagamenti";
import { CATALOGO_PREDEFINITO, LIMITI_CATALOGO, SERVIZI, interpretaCatalogoPacchetti, serializzaCatalogoPacchetti, validaCatalogoDaModulo } from "../src/lib/pacchetti-servizi-calcoli";

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
    uguale("l'unica azione è la rettifica", funzioni.map((f) => f.split("(")[0]), ["rettificaPacchettiCliente"]);
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
