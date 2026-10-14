// Autotest di «Piani e prezzi» di OMNIA AI (migrazione 0085): prezzo di listino modificabile dalla
// console, sconti (validità, durata, il più conveniente), importo scritto dall'amministratore,
// coupon Stripe a importo fisso, checkout (ciò che si addebita = ciò che si mostra) e pagine.
// Gratuito, nessun database né rete: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import type Stripe from "stripe";
import {
  costruisciCatalogo,
  erroreListino,
  euroACentesimi,
  giornoRoma,
  prezzoConSconto,
  scontoMigliore,
  statoSconto,
  testoOfferta,
  validaNuovoSconto,
  type Sconto,
} from "../src/lib/omnia-ai-catalogo-calcoli";
import { assicuraCoupon, idCouponSconto } from "../src/lib/omnia-ai-stripe-sconti";
import { PIANI } from "../src/lib/omnia-ai-plans";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
function uguale<T>(nome: string, ottenuto: T, previsto: T) {
  atteso(nome, JSON.stringify(ottenuto) === JSON.stringify(previsto), `ottenuto ${JSON.stringify(ottenuto)}, previsto ${JSON.stringify(previsto)}`);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");
const primaDi = (sorgente: string, a: string, b: string) => sorgente.indexOf(a) !== -1 && sorgente.indexOf(a) < sorgente.indexOf(b);

const OGGI = "2026-10-14";
const sconto = (extra: Partial<Sconto>): Sconto => ({ id: "00000000-0000-4000-8000-000000000001", nome: "Lancio", piano: null, tipo: "percentuale", percentuale: 20, prezzoScontatoCentesimi: null, validoDal: "2026-10-01", validoAl: "2026-12-31", durataMesi: 6, attivo: true, ...extra });

async function main() {
  console.log("--- Giorno di Roma e stato di uno sconto ---");
  uguale("22:30 UTC è già il giorno dopo a Roma", giornoRoma(new Date("2026-10-14T22:30:00Z")), "2026-10-15");
  uguale("21:30 UTC è ancora lo stesso giorno a Roma", giornoRoma(new Date("2026-10-14T21:30:00Z")), "2026-10-14");
  uguale("d'inverno (ora solare) 23:30 UTC è già il giorno dopo", giornoRoma(new Date("2026-12-14T23:30:00Z")), "2026-12-15");
  uguale("sconto in corso", statoSconto(sconto({}), OGGI), "attivo");
  uguale("sconto non ancora iniziato", statoSconto(sconto({ validoDal: "2026-11-01" }), OGGI), "in_programma");
  uguale("sconto finito", statoSconto(sconto({ validoAl: "2026-10-13" }), OGGI), "scaduto");
  uguale("il giorno di inizio è compreso", statoSconto(sconto({ validoDal: OGGI }), OGGI), "attivo");
  uguale("il giorno di fine è compreso", statoSconto(sconto({ validoAl: OGGI }), OGGI), "attivo");
  uguale("senza scadenza resta in corso", statoSconto(sconto({ validoAl: null }), "2030-01-01"), "attivo");
  uguale("disattivato prevale su tutto", statoSconto(sconto({ attivo: false }), OGGI), "disattivato");

  console.log("--- Prezzo scontato ---");
  uguale("20 % su 699 € = 559,20 €", prezzoConSconto(69900, { tipo: "percentuale", percentuale: 20, prezzoScontatoCentesimi: null }), 55920);
  uguale("prezzo promozionale fisso", prezzoConSconto(69900, { tipo: "prezzo", percentuale: null, prezzoScontatoCentesimi: 54900 }), 54900);
  uguale("un prezzo promozionale più alto del listino non lo supera", prezzoConSconto(69900, { tipo: "prezzo", percentuale: null, prezzoScontatoCentesimi: 80000 }), 69900);
  uguale("l'importo è sempre intero (centesimi)", Number.isInteger(prezzoConSconto(69950, { tipo: "percentuale", percentuale: 15, prezzoScontatoCentesimi: null })), true);

  console.log("--- Lo sconto che si applica a un piano ---");
  uguale("nessuno sconto: nulla", scontoMigliore("starter", 69900, [], OGGI), null);
  atteso("sconto su tutti i piani: vale per ogni piano", ["starter", "professional", "enterprise"].every((p) => scontoMigliore(p as "starter", 69900, [sconto({})], OGGI) !== null));
  uguale("sconto su un piano solo: gli altri non ne hanno", [scontoMigliore("starter", 69900, [sconto({ piano: "professional" })], OGGI), scontoMigliore("professional", 149000, [sconto({ piano: "professional" })], OGGI) !== null], [null, true]);
  uguale("scaduto, in programma e disattivato non si applicano", scontoMigliore("starter", 69900, [sconto({ id: "a", validoAl: "2026-10-01" }), sconto({ id: "b", validoDal: "2026-11-01" }), sconto({ id: "c", attivo: false })], OGGI), null);
  const due = scontoMigliore("starter", 69900, [sconto({ id: "a", percentuale: 10 }), sconto({ id: "b", percentuale: 30 }), sconto({ id: "c", percentuale: 20 })], OGGI);
  uguale("con più sconti vince il più conveniente, mai la somma", [due?.id, due?.prezzoCentesimi], ["b", 48930]);
  uguale("lo sconto che non scende sotto il listino si ignora", scontoMigliore("starter", 69900, [sconto({ tipo: "prezzo", piano: "starter", percentuale: null, prezzoScontatoCentesimi: 80000 })], OGGI), null);
  uguale("a parità di prezzo la scelta è stabile (identificativo più basso)", scontoMigliore("starter", 69900, [sconto({ id: "z" }), sconto({ id: "m" })], OGGI)?.id, "m");
  uguale("il risparmio mensile è la differenza col listino", scontoMigliore("starter", 69900, [sconto({})], OGGI)?.risparmioCentesimi, 13980);

  console.log("--- Importo scritto dall'amministratore ---");
  for (const [testo, previsto] of [["699", 69900], ["699,00", 69900], ["699.00", 69900], ["1.490,50", 149050], ["1490,5", 149050], ["€ 699", 69900], ["749,50", 74950], ["1.490", 149000], ["0,99", 99]] as const) uguale(`«${testo}»`, euroACentesimi(testo), previsto);
  for (const testo of ["", "  ", "abc", "-5", "699,555", "69 9a", "1,2,3", "€"]) uguale(`«${testo}» non è un importo`, euroACentesimi(testo), null);
  atteso("sotto il minimo (1 €) rifiutato", erroreListino(50) !== null);
  atteso("sopra il massimo (100.000 €) rifiutato", erroreListino(10_000_001) !== null);
  atteso("importo mancante rifiutato", erroreListino(null) !== null);
  uguale("un prezzo normale è accettato", erroreListino(69900), null);

  console.log("--- Nuovo sconto: controllo del modulo ---");
  const listini = { starter: 69900, professional: 149000, enterprise: 290000 };
  const base = { nome: "Offerta di lancio", piano: "", tipo: "percentuale", valore: "20", validoDal: OGGI, validoAl: "2026-12-31", durataMesi: "6" };
  const errore = (campi: Partial<typeof base>) => {
    const r = validaNuovoSconto({ ...base, ...campi }, listini, OGGI);
    return r.ok ? null : r.errore;
  };
  const valido = validaNuovoSconto(base, listini, OGGI);
  atteso("uno sconto completo è accettato", valido.ok);
  if (valido.ok) uguale("piano vuoto = tutti i piani; durata numerica", [valido.valori.piano, valido.valori.durataMesi, valido.valori.percentuale], [null, 6, 20]);
  atteso("nome troppo corto", errore({ nome: "x" }) !== null);
  atteso("piano inesistente", errore({ piano: "gold" }) !== null);
  atteso("percentuale 0", errore({ valore: "0" }) !== null);
  atteso("percentuale 100", errore({ valore: "100" }) !== null);
  atteso("percentuale con decimali", errore({ valore: "12.5" }) !== null);
  atteso("prezzo promozionale senza un piano preciso", errore({ tipo: "prezzo", valore: "500", piano: "" }) !== null);
  atteso("prezzo promozionale uguale al listino non è uno sconto", errore({ tipo: "prezzo", piano: "starter", valore: "699" }) !== null);
  atteso("prezzo promozionale sopra il listino", errore({ tipo: "prezzo", piano: "starter", valore: "800" }) !== null);
  atteso("prezzo promozionale valido", errore({ tipo: "prezzo", piano: "starter", valore: "549" }) === null);
  atteso("tipo sconosciuto", errore({ tipo: "regalo" }) !== null);
  atteso("giorno di inizio non valido", errore({ validoDal: "2026-02-31" }) !== null);
  atteso("fine prima dell'inizio", errore({ validoDal: "2026-11-10", validoAl: "2026-11-01" }) !== null);
  atteso("fine già passata", errore({ validoDal: "2026-09-01", validoAl: "2026-10-01" }) !== null);
  atteso("senza scadenza (fine vuota) accettato", errore({ validoAl: "" }) === null);
  atteso("durata negativa", errore({ durataMesi: "-1" }) !== null);
  atteso("durata oltre 60 mesi", errore({ durataMesi: "61" }) !== null);
  atteso("durata vuota = 0 (per sempre)", (validaNuovoSconto({ ...base, durataMesi: "" }, listini, OGGI) as { valori: { durataMesi: number } }).valori.durataMesi === 0);

  console.log("--- Testo dell'offerta ---");
  uguale("per sempre", testoOfferta({ nome: "Lancio", prezzoCentesimi: 55920, validoAl: null, durataMesi: 0 }, 69900), "Lancio: 559,20 € al mese per tutta la durata dell'abbonamento.");
  atteso("per N mesi e poi il listino, con la scadenza dell'offerta", /per i primi 6 mesi, poi 699,00 € al mese\. Offerta valida fino al 31\/12\/2026\./.test(testoOfferta({ nome: "Lancio", prezzoCentesimi: 55920, validoAl: "2026-12-31", durataMesi: 6 }, 69900)));
  atteso("un mese solo (singolare)", /per il primo mese, poi 699,00 € al mese/.test(testoOfferta({ nome: "Lancio", prezzoCentesimi: 55920, validoAl: null, durataMesi: 1 }, 69900)));

  console.log("--- Catalogo ---");
  const senzaDb = costruisciCatalogo({}, [], OGGI);
  uguale("senza modifiche valgono i prezzi del codice", [senzaDb.starter.prezzoListinoCentesimi, senzaDb.professional.prezzoListinoCentesimi, senzaDb.enterprise.prezzoListinoCentesimi], [PIANI.starter.prezzoCentesimi, PIANI.professional.prezzoCentesimi, PIANI.enterprise.prezzoCentesimi]);
  const conModifiche = costruisciCatalogo({ starter: 74900 }, [sconto({ piano: "professional", percentuale: 10 })], OGGI);
  uguale("un piano modificato cambia, gli altri no", [conModifiche.starter.prezzoListinoCentesimi, conModifiche.professional.prezzoListinoCentesimi], [74900, PIANI.professional.prezzoCentesimi]);
  uguale("lo sconto si applica solo al suo piano e il prezzo da pagare lo riflette", [conModifiche.starter.sconto, conModifiche.professional.prezzoCentesimi], [null, 134100]);
  atteso("nome, gare incluse e voci restano quelli del codice (non si modificano dalla console)", conModifiche.starter.nome === PIANI.starter.nome && conModifiche.starter.gareIncluse === PIANI.starter.gareIncluse && conModifiche.starter.voci.length === PIANI.starter.voci.length);
  atteso("il catalogo è serializzabile (passa ai componenti del browser senza perdere nulla)", JSON.stringify(JSON.parse(JSON.stringify(conModifiche))) === JSON.stringify(conModifiche));

  console.log("--- Coupon Stripe a importo fisso ---");
  uguale("identificativo deterministico", idCouponSconto("12345678-aaaa-4bbb-8ccc-1234567890ab", 13980, 6), "oa_12345678aaaa_13980_6");
  uguale("cambia se cambia l'importo o la durata (un coupon non si modifica)", [idCouponSconto("12345678-aaaa-4bbb-8ccc-1234567890ab", 13980, 6) === idCouponSconto("12345678-aaaa-4bbb-8ccc-1234567890ab", 14000, 6), idCouponSconto("12345678-aaaa-4bbb-8ccc-1234567890ab", 13980, 6) === idCouponSconto("12345678-aaaa-4bbb-8ccc-1234567890ab", 13980, 0)], [false, false]);
  const creati: Stripe.CouponCreateParams[] = [];
  const stripeFinto = (esistente: { amount_off: number } | "manca" | "errore") =>
    ({
      coupons: {
        retrieve: async (id: string) => {
          if (esistente === "manca") throw Object.assign(new Error("No such coupon"), { code: "resource_missing" });
          if (esistente === "errore") throw Object.assign(new Error("rete"), { code: "api_connection_error" });
          return { id, amount_off: esistente.amount_off };
        },
        create: async (p: Stripe.CouponCreateParams) => {
          creati.push(p);
          return { id: p.id };
        },
      },
    }) as unknown as Stripe;
  uguale("coupon già esistente con lo stesso importo: si riusa, non si crea", [await assicuraCoupon(stripeFinto({ amount_off: 13980 }), { id: "oa_x", risparmioCentesimi: 13980, durataMesi: 6, nome: "Lancio" }), creati.length], ["oa_x", 0]);
  let rifiutato = false;
  try {
    await assicuraCoupon(stripeFinto({ amount_off: 5 }), { id: "oa_x", risparmioCentesimi: 13980, durataMesi: 6, nome: "Lancio" });
  } catch {
    rifiutato = true;
  }
  atteso("coupon esistente con un importo diverso: mai usato", rifiutato);
  await assicuraCoupon(stripeFinto("manca"), { id: "oa_y", risparmioCentesimi: 13980, durataMesi: 6, nome: "Offerta di lancio" });
  uguale("coupon mancante, 6 mesi: creato a importo fisso in euro, ripetuto 6 mesi", [creati[0]?.amount_off, creati[0]?.currency, creati[0]?.duration, creati[0]?.duration_in_months, creati[0]?.percent_off], [13980, "eur", "repeating", 6, undefined]);
  await assicuraCoupon(stripeFinto("manca"), { id: "oa_z", risparmioCentesimi: 13980, durataMesi: 0, nome: "Per sempre" });
  uguale("durata 0: coupon «forever», senza mesi", [creati[1]?.duration, creati[1]?.duration_in_months], ["forever", undefined]);
  atteso("un nome lungo si accorcia al limite di Stripe", ((await assicuraCoupon(stripeFinto("manca"), { id: "oa_w", risparmioCentesimi: 100, durataMesi: 1, nome: "x".repeat(100) })), (creati[2]?.name ?? "").length <= 40));
  let propagato = false;
  try {
    await assicuraCoupon(stripeFinto("errore"), { id: "oa_q", risparmioCentesimi: 1, durataMesi: 1, nome: "x" });
  } catch {
    propagato = true;
  }
  atteso("un errore diverso da «non esiste» non crea nulla e si propaga", propagato && creati.length === 3);

  console.log("--- Checkout: ciò che si addebita è ciò che si mostra ---");
  const checkout = leggi("src/app/actions/omnia-ai-subscription.ts");
  atteso("il prezzo viene dal catalogo e dal prezzo Stripe attivo", /getStripePrezzoAttivo\(stripe, planSlug as PianoSlug\)/.test(checkout) && /\(await getCatalogoPiani\(\)\)\[planSlug as PianoSlug\]/.test(checkout) && !/getStripePriceId/.test(checkout));
  atteso("si ferma se il prezzo Stripe non coincide col listino", /prezzoStripe\.unit_amount !== voce\.prezzoListinoCentesimi/.test(checkout) && primaDi(checkout, "prezzoStripe.unit_amount !== voce.prezzoListinoCentesimi", "checkout.sessions.create"));
  atteso("lo sconto in corso diventa un coupon applicato alla sessione, con lo sconto nei metadata", /discounts = \[\{ coupon \}\]/.test(checkout) && /metadata\.scontoId = voce\.sconto\.id/.test(checkout) && /\.\.\.\(discounts \? \{ discounts \} : \{\}\)/.test(checkout));
  atteso("il coupon è quello deterministico (importo e durata dal catalogo)", /idCouponSconto\(voce\.sconto\.id, voce\.sconto\.risparmioCentesimi, voce\.sconto\.durataMesi\)/.test(checkout));
  atteso("il rinnovo a prezzo pieno dopo i mesi di sconto lo fa Stripe (coupon a durata), non il nostro codice", /durataMesi/.test(checkout) && !/subscriptionSchedules/.test(checkout));
  const cambio = leggi("src/app/actions/omnia-ai-plan-change.ts");
  atteso("salire o scendere di piano si decide dall'ordine dei piani, non dai prezzi", /PIANI_ORDINE\.indexOf\(pianoDestinazione\) > PIANI_ORDINE\.indexOf\(pianoAttuale\)/.test(cambio) && !/prezzoCentesimi/.test(cambio));

  console.log("--- Cosa vede il cliente ---");
  const piani = leggi("src/app/site-omnia-ai/piani/page.tsx");
  const acquisto = leggi("src/app/site-omnia-ai/abbonati/[piano]/page.tsx");
  const attivazione = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/activate-subscription-form.tsx");
  const layout = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx");
  const abbonamento = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/abbonamento/page.tsx");
  atteso("sito pubblico /piani: prezzo e sconto dal catalogo, listino barrato e testo dell'offerta", /getCatalogoPiani\(\)/.test(piani) && /const p = catalogo\[slug\]/.test(piani) && /omnia-prezzo-prima/.test(piani) && /testoOfferta\(p\.sconto/.test(piani) && !/PIANI\[/.test(piani));
  atteso("pagina di acquisto /abbonati: prezzo e sconto dal catalogo", /\(await getCatalogoPiani\(\)\)\[piano\]/.test(acquisto) && /testoOfferta\(p\.sconto/.test(acquisto) && /p\.prezzoCentesimi/.test(acquisto));
  atteso("modulo di attivazione: riceve i piani con i prezzi di oggi (nessun prezzo dalla costante)", /piani: PianoCatalogo\[\]/.test(attivazione) && /piani\.map\(\(p\) =>/.test(attivazione) && !/PIANI\[/.test(attivazione) && /testoOfferta\(p\.sconto/.test(attivazione));
  atteso("area riservata: i due punti che mostrano il modulo di attivazione costruiscono il catalogo dai prezzi di oggi e lo passano (con l'eventuale offerta riservata al cliente)", /applicaPilotAlCatalogo\(PIANI_ORDINE\.map\(\(slug\) => catalogo\[slug\]\)/.test(layout) && /applicaPilotAlCatalogo\(PIANI_ORDINE\.map\(\(slug\) => catalogo\[slug\]\)/.test(abbonamento) && /piani=\{vista\.piani\}/.test(layout) && /piani=\{vista\.piani\}/.test(abbonamento));
  const visibili = ["src/app/site-omnia-ai/piani/page.tsx", "src/app/site-omnia-ai/abbonati/[piano]/page.tsx", "src/app/site-omnia-ai/dashboard/omnia-ai/activate-subscription-form.tsx"];
  atteso("nessuna pagina che mostra i prezzi ai clienti legge più il prezzo dalla costante del codice", visibili.every((f) => !/PIANI\[[^\]]+\]\.prezzoCentesimi/.test(leggi(f))));
  atteso("i testi dei clienti non rimandano alla console", ![piani, acquisto, attivazione, layout, leggi("src/lib/omnia-ai-catalogo.ts"), leggi("src/lib/omnia-ai-catalogo-calcoli.ts"), leggi("src/lib/omnia-ai-stripe-sconti.ts")].some((t) => /console\.omniaitalia\.com|CONSOLE_BASE_URL|site-console|lib\/console/.test(t)));
  const catalogoDb = leggi("src/lib/omnia-ai-catalogo.ts");
  atteso("senza le tabelle (migrazione non eseguita) o con un errore valgono i prezzi del codice, senza rompere la pagina", /return \{ disponibile: false, listini: \{\}, sconti: \[\] \}/.test(catalogoDb) && /schemaAssente\(q\.error\)/.test(catalogoDb));
  atteso("si leggono solo gli sconti attivi", /\.eq\("attivo", true\)/.test(catalogoDb));

  console.log("--- Console: prezzi e sconti ---");
  const az = leggi("src/app/site-console/azioni/prezzi.ts");
  const corpoPrezzo = az.slice(az.indexOf("export async function salvaPrezzoPiano"), az.indexOf("export async function creaSconto"));
  const corpoSconto = az.slice(az.indexOf("export async function creaSconto"), az.indexOf("export async function impostaScontoAttivo"));
  const corpoAttivo = az.slice(az.indexOf("export async function impostaScontoAttivo"));
  for (const [nome, corpo] of [["salvaPrezzoPiano", corpoPrezzo], ["creaSconto", corpoSconto], ["impostaScontoAttivo", corpoAttivo]] as const) {
    atteso(`${nome}: controllo admin e stop subito se non lo è`, /const sessione = await richiediAdminAzione\(\);\s*if \(!sessione\) return \{ errore: "Non autorizzato\." \};/.test(corpo));
  }
  atteso("il prezzo si controlla (importo valido, nei limiti) prima di toccare Stripe", primaDi(corpoPrezzo, "erroreListino(nuovo)", "stripe.prices.create") && /euroACentesimi\(String\(formData\.get\("prezzo"\)/.test(corpoPrezzo));
  atteso("un prezzo Stripe NUOVO con il lookup_key trasferito: gli abbonati attuali restano sul vecchio", /stripe\.prices\.create\(/.test(corpoPrezzo) && /transfer_lookup_key: true/.test(corpoPrezzo) && /lookup_key: lookupKeyDelPiano\(slug\)/.test(corpoPrezzo));
  atteso("il vecchio prezzo Stripe non si archivia né si modifica", !/prices\.update\(/.test(corpoPrezzo) && !/active: false/.test(corpoPrezzo));
  atteso("ricalca il prezzo vecchio (prodotto, valuta, ricorrenza, IVA)", /product: typeof corrente\.product/.test(corpoPrezzo) && /currency: corrente\.currency/.test(corpoPrezzo) && /interval: corrente\.recurring\?\.interval/.test(corpoPrezzo) && /tax_behavior/.test(corpoPrezzo));
  atteso("Stripe si cambia PRIMA del database, e se il database fallisce lo dice (gli acquisti si fermano da soli)", primaDi(corpoPrezzo, "stripe.prices.create(", 'from("omnia_ai_prezzi_piani").upsert') && /per sicurezza gli acquisti di questo piano sono fermi/.test(corpoPrezzo));
  atteso("ripetere la modifica con lo stesso importo completa un'operazione rimasta a metà (non crea un secondo prezzo)", /if \(corrente\.unit_amount !== nuovo\) \{\s*await stripe\.prices\.create/.test(corpoPrezzo) && /È già il prezzo attuale/.test(corpoPrezzo));
  atteso("ogni modifica lascia una riga di storico (chi, da quanto a quanto)", /from\("omnia_ai_prezzi_piani_storico"\)\.insert\(\{ piano: slug, prezzo_precedente_centesimi: listinoAttuale, prezzo_nuovo_centesimi: nuovo, operatore_email: sessione\.email \}\)/.test(corpoPrezzo));
  atteso("senza chiave Stripe non cambia nulla", /STRIPE_SECRET_KEY_OMNIA_AI\) return \{ errore:[^}]*nessuna modifica fatta/.test(corpoPrezzo));
  atteso("creaSconto valida con la stessa funzione provata qui e conosce i listini reali", /validaNuovoSconto\(/.test(corpoSconto) && /listini\[r\.piano as PianoSlug\] = r\.prezzo_centesimi/.test(corpoSconto));
  atteso("uno sconto non si cancella: si disattiva (nessun delete)", /update\(\{ attivo \}\)/.test(corpoAttivo) && !/\.delete\(/.test(az));
  atteso("nessuna azione scrive la password o dati di clienti", !/password|users/.test(az));
  const pagina = leggi("src/app/site-console/(app)/prezzi/page.tsx");
  atteso("pagina «Piani e prezzi»: controllo admin come prima istruzione", /export default async function PaginaPrezzi\(\) \{\s*await richiediAdminPagina\(\);/.test(pagina));
  atteso("voce «Piani e prezzi» nel menu della console", /href: "\/prezzi", etichetta: "Piani e prezzi", pronto: true/.test(leggi("src/app/site-console/_componenti/navigazione.ts")));
  const vista = leggi("src/app/site-console/_componenti/prezzi-vista.tsx");
  atteso("la pagina dice che il prezzo vale per i nuovi acquisti e che gli abbonati restano al loro", /nuovi acquisti/.test(vista) && /resta al prezzo che ha/.test(vista));
  atteso("la pagina dice se Stripe è di prova o reale e se il prezzo è allineato", /Stripe è in modalità di PROVA/.test(vista) && /Stripe è in modalità REALE/.test(vista) && /NON allineato/.test(vista));
  atteso("Impostazioni non mostra più i prezzi dei piani dalla costante: rimanda a «Piani e prezzi»", /vedi Piani e prezzi/.test(leggi("src/app/site-console/_componenti/impostazioni-vista.tsx")) && !/PIANI\[slug\]\.prezzoCentesimi/.test(leggi("src/app/site-console/_componenti/impostazioni-vista.tsx")));

  console.log("--- Migrazione 0085 ---");
  const mig = leggi("supabase/migrations/0085_omnia_ai_prezzi_sconti.sql");
  const sql = mig.split("\n").filter((r) => !r.trimStart().startsWith("--")).join("\n");
  for (const t of ["omnia_ai_prezzi_piani", "omnia_ai_prezzi_piani_storico", "omnia_ai_sconti"]) {
    atteso(`tabella ${t}: creata se manca, con la RLS attiva`, new RegExp(`create table if not exists public\\.${t}\\b`).test(sql) && new RegExp(`alter table public\\.${t} enable row level security`).test(sql));
  }
  atteso("nessun permesso ai ruoli utente (nessuna lettura pubblica dei prezzi dal database)", !/\b(anon|authenticated)\b/i.test(sql) && !/create policy/i.test(sql));
  atteso("il storico dei prezzi è solo in aggiunta; i prezzi e gli sconti non si cancellano", /grant select, insert on public\.omnia_ai_prezzi_piani_storico to service_role/.test(sql) && !/\bdelete\b/i.test(sql.replace(/delete from|on delete/gi, "")));
  atteso("i piani ammessi sono quelli del codice", (sql.match(/'starter', 'professional', 'enterprise'/g) ?? []).length === 3);
  atteso("prezzo con limiti (1 € - 100.000 €), lo stesso del codice", /between 100 and 10000000/.test(sql));
  atteso("uno sconto è o percentuale o prezzo, mai entrambi né nessuno dei due", /omnia_ai_sconti_valore/.test(sql));
  atteso("un prezzo promozionale fisso richiede un piano preciso", /omnia_ai_sconti_prezzo_su_piano/.test(sql) && /tipo <> 'prezzo' or piano is not null/.test(sql));
  atteso("la fine non precede l'inizio; durata 0-60 mesi", /valido_al >= valido_dal/.test(sql) && /between 0 and 60/.test(sql));
  atteso("nessuna cancellazione di dati", !/\b(delete\s+from|truncate|drop\s+(table|column))\b/i.test(sql));

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
