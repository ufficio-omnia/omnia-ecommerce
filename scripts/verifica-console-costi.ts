// Autotest dei costi per cliente nella console: periodi (fuso di Roma), ricavo da
// listino, margine, assemblaggio per cliente, ordinamento e collegamenti di
// sicurezza delle nuove pagine. Gratuito, nessun database né rete: gira nel
// livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import {
  GIORNI_MESE_MEDIO,
  assemblaClienti,
  calcolaMargine,
  ordinaClienti,
  ricavoAbbonamentiUtente,
  ricavoAbbonamentoLordo,
  type AbbonamentoRiga,
  type DatiGrezziCosti,
} from "../src/lib/console/costi-calcoli";
import { calcolaPeriodo, mezzanotteRoma } from "../src/lib/console/periodo";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
function vicino(nome: string, ottenuto: number | null, previsto: number, tolleranza = 0.005) {
  atteso(nome, ottenuto !== null && Math.abs(ottenuto - previsto) <= tolleranza, `ottenuto ${ottenuto}, previsto ${previsto}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

console.log("--- Mezzanotte di Roma ---");
uguale("giorno d'ottobre con l'ora legale (UTC+2)", mezzanotteRoma("2026-10-05").toISOString(), "2026-10-04T22:00:00.000Z");
uguale("giorno di dicembre con l'ora solare (UTC+1)", mezzanotteRoma("2026-12-08").toISOString(), "2026-12-07T23:00:00.000Z");
uguale("25 ottobre 2026, giorno del cambio all'ora solare: mezzanotte ancora in ora legale", mezzanotteRoma("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z");
uguale("26 ottobre 2026: già ora solare", mezzanotteRoma("2026-10-26").toISOString(), "2026-10-25T23:00:00.000Z");
uguale("29 marzo 2026, giorno del cambio all'ora legale: mezzanotte ancora in ora solare", mezzanotteRoma("2026-03-29").toISOString(), "2026-03-28T23:00:00.000Z");
uguale("30 marzo 2026: già ora legale", mezzanotteRoma("2026-03-30").toISOString(), "2026-03-29T22:00:00.000Z");

console.log("--- Periodi ---");
const adesso = new Date("2026-10-12T10:00:00Z");
const mese = calcolaPeriodo({}, adesso);
uguale("senza parametri: mese corrente, 1-31 ottobre", [mese.preset, mese.da, mese.a, mese.giorni, mese.inCorso], ["mese", "2026-10-01", "2026-10-31", 31, true]);
uguale("il mese comincia a mezzanotte di Roma e finisce a mezzanotte del giorno dopo l'ultimo (cambio d'ora in mezzo)", [mese.daIso, mese.aIso], ["2026-09-30T22:00:00.000Z", "2026-10-31T23:00:00.000Z"]);
const scorso = calcolaPeriodo({ p: "mese-scorso" }, adesso);
uguale("mese scorso = settembre 2026, concluso", [scorso.da, scorso.a, scorso.giorni, scorso.inCorso, scorso.etichetta], ["2026-09-01", "2026-09-30", 30, false, "Settembre 2026"]);
uguale("mese scorso a gennaio = dicembre dell'anno prima", [calcolaPeriodo({ p: "mese-scorso" }, new Date("2026-01-15T10:00:00Z")).da, calcolaPeriodo({ p: "mese-scorso" }, new Date("2026-01-15T10:00:00Z")).a], ["2025-12-01", "2025-12-31"]);
const trenta = calcolaPeriodo({ p: "30g" }, adesso);
uguale("ultimi 30 giorni: oggi compreso", [trenta.da, trenta.a, trenta.giorni], ["2026-09-13", "2026-10-12", 30]);
const anno = calcolaPeriodo({ p: "anno" }, adesso);
uguale("anno corrente", [anno.da, anno.a, anno.daIso], ["2026-01-01", "2026-12-31", "2025-12-31T23:00:00.000Z"]);
const custom = calcolaPeriodo({ p: "personalizzato", dal: "2026-09-01", al: "2026-09-30" }, adesso);
uguale("periodo personalizzato valido", [custom.preset, custom.da, custom.a, custom.giorni], ["personalizzato", "2026-09-01", "2026-09-30", 30]);
uguale("personalizzato con date invertite: ripiega sul mese corrente", calcolaPeriodo({ p: "personalizzato", dal: "2026-09-30", al: "2026-09-01" }, adesso).preset, "mese");
uguale("personalizzato con una data impossibile (30 febbraio): ripiega sul mese corrente", calcolaPeriodo({ p: "personalizzato", dal: "2026-02-30", al: "2026-03-10" }, adesso).preset, "mese");
uguale("personalizzato con testo qualunque: ripiega sul mese corrente", calcolaPeriodo({ p: "personalizzato", dal: "ieri", al: "oggi" }, adesso).preset, "mese");
uguale("personalizzato troppo lungo (oltre 800 giorni): ripiega sul mese corrente", calcolaPeriodo({ p: "personalizzato", dal: "2020-01-01", al: "2026-01-01" }, adesso).preset, "mese");
uguale("un preset sconosciuto ripiega sul mese corrente", calcolaPeriodo({ p: "boh" }, adesso).preset, "mese");

console.log("--- Ricavo dell'abbonamento da listino ---");
const abb = (o: Partial<AbbonamentoRiga>): AbbonamentoRiga => ({
  plan: "starter",
  status: "attivo",
  stripe_subscription_id: "sub_1",
  created_at: "2026-08-01T09:00:00Z",
  current_period_end: "2026-11-01T09:00:00Z",
  cancel_at_period_end: false,
  ...o,
});
const settembre = calcolaPeriodo({ p: "mese-scorso" }, adesso);
const ottobre = calcolaPeriodo({}, adesso);
const OGGI = "2026-10-12";
const giornaliero = 699 / GIORNI_MESE_MEDIO;
uguale("abbonamento attivo per tutto settembre: 30 giorni", ricavoAbbonamentoLordo(abb({}), settembre, OGGI).giorni, 30);
vicino("importo = prezzo mensile ÷ 30,4375 × giorni", ricavoAbbonamentoLordo(abb({}), settembre, OGGI).importo, giornaliero * 30, 0.0001);
uguale("nel mese in corso contano solo i giorni fino a oggi compreso (1-12 ottobre = 12)", ricavoAbbonamentoLordo(abb({}), ottobre, OGGI).giorni, 12);
uguale("iniziato il 5 ottobre: 8 giorni (5-12)", ricavoAbbonamentoLordo(abb({ created_at: "2026-10-05T09:00:00Z" }), ottobre, OGGI).giorni, 8);
uguale("iniziato dopo la fine del periodo: nessun ricavo", ricavoAbbonamentoLordo(abb({ created_at: "2026-10-05T09:00:00Z" }), settembre, OGGI).giorni, 0);
uguale("annullato con fine periodo il 15 settembre: 14 giorni di settembre (1-14)", ricavoAbbonamentoLordo(abb({ status: "annullato", current_period_end: "2026-09-15T09:00:00Z" }), settembre, OGGI).giorni, 14);
uguale("disdetta richiesta, ancora attivo fino al 20 ottobre: conta fino al 19", ricavoAbbonamentoLordo(abb({ cancel_at_period_end: true, current_period_end: "2026-10-20T09:00:00Z" }), calcolaPeriodo({}, new Date("2026-10-25T10:00:00Z")), "2026-10-25").giorni, 19);
const manuale = ricavoAbbonamentoLordo(abb({ stripe_subscription_id: null }), settembre, OGGI);
uguale("riga creata a mano: nessun ricavo, segnalata come manuale", [manuale.importo, manuale.manuale], [0, true]);
const sconosciuto = ricavoAbbonamentoLordo(abb({ plan: "platino" }), settembre, OGGI);
uguale("piano fuori catalogo: nessun ricavo, segnalato", [sconosciuto.importo, sconosciuto.pianoSconosciuto], [0, true]);
vicino("il piano si riconosce senza badare alle maiuscole ('Enterprise')", ricavoAbbonamentoLordo(abb({ plan: "Enterprise" }), settembre, OGGI).importo, (2900 / GIORNI_MESE_MEDIO) * 30, 0.0001);

console.log("--- Abbonamenti sovrapposti dello stesso utente ---");
// Difetto visto sui dati reali: un utente con tre righe di abbonamento sovrapposte
// (abbonamento ricreato durante le prove) risultava attivo per 89 giorni in 30.
const unaRiga = ricavoAbbonamentiUtente([abb({})], settembre, OGGI);
const treRigheUguali = ricavoAbbonamentiUtente([abb({}), abb({ stripe_subscription_id: "sub_2" }), abb({ stripe_subscription_id: "sub_3" })], settembre, OGGI);
uguale("tre righe identiche contano come una sola: 30 giorni, non 90", [treRigheUguali.giorni, Math.round(treRigheUguali.importo * 100)], [unaRiga.giorni, Math.round(unaRiga.importo * 100)]);
const aggiornamento = ricavoAbbonamentiUtente(
  [
    abb({ status: "annullato", current_period_end: "2026-09-20T09:00:00Z" }), // starter fino al 19 settembre
    abb({ plan: "professional", created_at: "2026-09-10T09:00:00Z", stripe_subscription_id: "sub_2" }), // professional dal 10 settembre
  ],
  settembre,
  OGGI,
);
uguale("cambio di piano con sovrapposizione: 30 giorni coperti, non 40", aggiornamento.giorni, 30);
vicino("nei giorni sovrapposti vale il piano più caro: 9 giorni Starter (1-9) + 21 giorni Professional (10-30)", aggiornamento.importo, (699 / GIORNI_MESE_MEDIO) * 9 + (1490 / GIORNI_MESE_MEDIO) * 21, 0.0001);
const conBuco = ricavoAbbonamentiUtente(
  [
    abb({ status: "annullato", current_period_end: "2026-09-10T09:00:00Z" }), // fino al 9 settembre
    abb({ created_at: "2026-09-20T09:00:00Z", stripe_subscription_id: "sub_2" }), // dal 20 settembre
  ],
  settembre,
  OGGI,
);
uguale("due abbonamenti con un buco in mezzo: i giorni scoperti non contano (9 + 11 = 20)", conBuco.giorni, 20);
uguale("una riga manuale e una Stripe: conta solo quella Stripe, e l'utente non è 'manuale'", [ricavoAbbonamentiUtente([abb({ stripe_subscription_id: null }), abb({})], settembre, OGGI).giorni, ricavoAbbonamentiUtente([abb({ stripe_subscription_id: null }), abb({})], settembre, OGGI).manuale], [30, false]);

console.log("--- Margine ---");
const m = calcolaMargine(122, 30, 22);
vicino("ricavo 122 IVA inclusa al 22 % = 100 netti", m.ricavoNetto, 100, 0.0001);
vicino("margine = 100 - 30", m.margine, 70, 0.0001);
vicino("margine percentuale = 70 %", m.percentuale, 0.7, 0.0001);
uguale("senza cambio (costo in euro ignoto): nessun margine", [calcolaMargine(122, null, 22).margine, calcolaMargine(122, null, 22).percentuale], [null, null]);
const senzaRicavo = calcolaMargine(0, 12, 22);
uguale("costo senza ricavo: margine negativo, percentuale non calcolabile (niente divisione per zero)", [senzaRicavo.margine, senzaRicavo.percentuale], [-12, null]);

console.log("--- Assemblaggio per cliente ---");
const dati: DatiGrezziCosti = {
  costi: [
    { user_id: "A", categoria: "cliente", operazioni: 40, operazioni_senza_costo: 1, costo_usd: 10, input_token: 1000, output_token: 500 },
    { user_id: "B", categoria: "cliente", operazioni: 5, operazioni_senza_costo: 0, costo_usd: 1, input_token: 100, output_token: 50 },
    { user_id: null, categoria: "piattaforma", operazioni: 8, operazioni_senza_costo: 0, costo_usd: 5, input_token: 0, output_token: 0 },
    { user_id: null, categoria: "non_attribuito", operazioni: 3, operazioni_senza_costo: 2, costo_usd: 2, input_token: 0, output_token: 0 },
    { user_id: null, categoria: "prova", operazioni: 90, operazioni_senza_costo: 0, costo_usd: 100, input_token: 0, output_token: 0 },
  ],
  gare: [{ user_id: "A", gare_piano: 2, gare_credito: 0 }],
  abbonamenti: [
    { ...abb({}), user_id: "A" },
    { ...abb({ stripe_subscription_id: null }), user_id: "M" },
    { ...abb({ plan: "professional" }), user_id: "C" },
  ],
  acquisti: [{ user_id: "B", importo_centesimi: 29000 }],
  identita: new Map([
    ["A", { email: "a@example.com", ragioneSociale: "Azienda A" }],
    ["B", { email: "b@example.com", ragioneSociale: null }],
    ["C", { email: "c@example.com", ragioneSociale: null }],
  ]),
};
const esito = assemblaClienti(dati, { cambioUsdEur: 0.9, aliquotaIva: 22 }, settembre, adesso);
const per = (id: string) => esito.righe.find((r) => r.userId === id);
vicino("cliente A: costo in euro = 10 $ × 0,9", per("A")?.costoEur ?? null, 9);
uguale("cliente A: 2 gare dal piano", [per("A")?.gare, per("A")?.gareDaPiano, per("A")?.gareDaCredito], [2, 2, 0]);
vicino("cliente A: costo per gara = 9 ÷ 2", per("A")?.costoPerGaraEur ?? null, 4.5);
vicino("cliente A: ricavo lordo = abbonamento Starter di settembre", per("A")?.ricavoLordo ?? null, giornaliero * 30, 0.0001);
vicino("cliente A: margine = ricavo netto - costo", per("A")?.margine ?? null, (giornaliero * 30) / 1.22 - 9, 0.0001);
uguale("cliente A: piano e abbonamento non manuale", [per("A")?.piano, per("A")?.abbonamentoManuale], ["starter", false]);
vicino("cliente B (solo crediti): ricavo lordo = 290 €", per("B")?.ricavoLordo ?? null, 290);
uguale("cliente B senza gare: costo per gara non calcolabile", per("B")?.costoPerGaraEur ?? null, null);
atteso("cliente C (abbonato, nessun costo né gara) compare per il suo ricavo", per("C") !== undefined && (per("C")?.ricavoLordo ?? 0) > 0);
atteso("utente con solo un abbonamento manuale e nessun costo non compare", per("M") === undefined);
uguale("tre categorie non attribuibili", esito.nonAttribuiti.map((n) => n.categoria).sort(), ["non_attribuito", "piattaforma", "prova"]);
vicino("costo che pesa sul margine = clienti + piattaforma (10+1+5 = 16 $ → 14,40 €), fuori le chiamate senza cliente e le prove", esito.totali.costoEur, 14.4);
vicino("costo senza cliente (script di sviluppo, clienti eliminati) = 2 $, a parte", esito.totali.costoNonAttribuitoUsd, 2);
vicino("costo di piattaforma = 5 $", esito.totali.costoPiattaformaUsd, 5);
uguale("chiamate di clienti e piattaforma (40+5+8)", esito.totali.operazioni, 53);
uguale("chiamate senza costo: tra tutte le non di prova (1 + 2)", esito.totali.operazioniSenzaCosto, 3);
vicino("costo per gara = solo costi dei clienti ÷ gare consumate (11 $ × 0,9 ÷ 2 = 4,95)", esito.totali.costoPerGaraEur, 4.95);
vicino("margine complessivo = ricavo netto - 14,40 (non 16,20)", esito.totali.margine, esito.totali.ricavoNetto - 14.4, 0.0001);
const senzaCambio = assemblaClienti(dati, { cambioUsdEur: null, aliquotaIva: 22 }, settembre, adesso);
uguale("senza cambio: costi in euro e margini assenti (non zero)", [per("A") && senzaCambio.righe.find((r) => r.userId === "A")?.costoEur, senzaCambio.righe.find((r) => r.userId === "A")?.margine, senzaCambio.totali.margine, senzaCambio.totali.costoEur], [null, null, null, null]);
vicino("senza cambio i dollari restano disponibili", senzaCambio.righe.find((r) => r.userId === "A")?.costoUsd ?? null, 10);

console.log("--- Ordinamento ---");
const righe = esito.righe;
uguale("per costo: dal più alto", ordinaClienti(righe, "costo").map((r) => r.userId), ["A", "B", "C"]);
const perMargine = ordinaClienti(righe, "margine").map((r) => r.userId);
atteso("per margine: dal più basso (il cliente in perdita B per primo)", perMargine[0] === "B", JSON.stringify(perMargine));
uguale("per gare: A per primo", ordinaClienti(righe, "gare")[0].userId, "A");
uguale("per cliente: ordine alfabetico dell'email", ordinaClienti(righe, "cliente").map((r) => r.email), ["a@example.com", "b@example.com", "c@example.com"]);
uguale("con margini assenti l'ordine per margine non si rompe", ordinaClienti(senzaCambio.righe, "margine").length, 3);

console.log("--- Migrazione 0077 ---");
const sql = leggi("supabase/migrations/0077_console_costi_clienti.sql");
for (const funzione of ["console_costi_per_cliente", "console_costi_per_operazione", "console_gare_consumate", "console_modelli_in_uso"]) {
  atteso(`${funzione}: revocata a tutti e concessa solo a service_role`, new RegExp(`revoke all on function public\\.${funzione}\\([^)]*\\) from public, anon, authenticated;`).test(sql) && new RegExp(`grant execute on function public\\.${funzione}\\([^)]*\\) to service_role;`).test(sql));
}
atteso("le funzioni girano con i diritti di chi le chiama (security invoker), non con quelli del proprietario", (sql.match(/security invoker/g) ?? []).length === 4 && !/security definer/.test(sql));
atteso("le prove degli script si distinguono dai costi dei clienti", /starts_with\(o\.operazione, 'prova:'\)/.test(sql) && /starts_with\(o\.operazione, 'prova-leggero:'\)/.test(sql));
atteso("la tabella dei parametri non ha chiave esterna su aggiornato_da (vedi 0076) e ha la RLS attiva", !/aggiornato_da uuid references/.test(sql) && /alter table public\.console_impostazioni enable row level security/.test(sql));
atteso("il cambio non ha un valore iniziale inventato", /values \('aliquota_iva', '22'\)/.test(sql) && !/cambio_usd_eur/.test(sql));

console.log("--- Sicurezza delle pagine e delle azioni ---");
const pagine = ["src/app/site-console/(app)/costi/page.tsx", "src/app/site-console/(app)/costi/[utente]/page.tsx"].map(leggi);
atteso(
  "le pagine Costi chiamano richiediAdminPagina prima di leggere i dati",
  pagine.every((p) => {
    const admin = p.indexOf("await richiediAdminPagina()");
    const lettura = p.search(/await leggi(Costi|DettaglioCliente)\(/);
    return admin >= 0 && lettura > admin;
  }),
);
atteso("la pagina di dettaglio accetta solo un uuid o 'piattaforma' (niente altro nella query)", /const UUID = /.test(pagine[1]) && /notFound\(\)/.test(pagine[1]));
const azioneCosti = leggi("src/app/site-console/azioni/costi.ts");
atteso("salvaParametri parte da richiediAdminAzione e controlla i limiti di cambio e IVA", azioneCosti.indexOf("richiediAdminAzione()") < azioneCosti.indexOf("numeroDaTesto(formData") && /CAMBIO_MINIMO/.test(azioneCosti) && /IVA_MASSIMA/.test(azioneCosti));

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAutotest dei costi della console: tutti i casi ok.");
