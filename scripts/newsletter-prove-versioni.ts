// Prove dei flussi delle versioni e dei costi della newsletter, condivise tra la verifica automatica (archivio locale,
// scripts/verifica-newsletter.ts) e il collaudo sullo staging reale (scripts/collaudo-newsletter-staging.ts).
// Nessuna chiamata a modelli: i generatori sono finti ma registrano i costi con la stessa funzione di quelli veri
// (contesto.registra), così si prova anche la contabilizzazione.
import type { ArchivioNewsletter } from "../src/lib/newsletter/archivio";
import { ErroreGenerazione, operazioneNewsletter, usoVuoto, type ContestoCosto, type EsitoGenerazione } from "../src/lib/newsletter/generazione";
import type { Notizia } from "../src/lib/newsletter/tipi";

export type Controllo = (nome: string, ok: boolean, dettaglio?: string) => void;

const COSTO_CHIAMATA_FINTA = { input: 10000, output: 2000 }; // claude-sonnet-5 a 3/15 $ per milione: 0,06 $
const RICERCHE_FINTE = 3; // 0,03 $

async function registraFinto(c: ContestoCosto) {
  const op = operazioneNewsletter(c.tipo);
  const base = { modulo: "newsletter", tipo: c.tipo, generazione_id: c.generazioneId, edizione_id: c.edizioneId ?? null, numero_edizione: c.numeroEdizione ?? null, versione: c.versione ?? null };
  await c.registra!({ userId: null, garaId: null, operazione: op, provider: "anthropic", model: "claude-sonnet-5", inputTokens: COSTO_CHIAMATA_FINTA.input, outputTokens: COSTO_CHIAMATA_FINTA.output, dettaglio: { ...base, voce: "modello", natura_costo: "stimato_da_consumi" } });
  await c.registra!({ userId: null, garaId: null, operazione: op, provider: "anthropic", model: "web_search", inputTokens: null, outputTokens: null, costoUsd: RICERCHE_FINTE * 0.01, dettaglio: { ...base, voce: "ricerca_web", ricerche_web: RICERCHE_FINTE, natura_costo: "stimato_tariffa_ricerca" } });
  return { ...usoVuoto(), costoUsd: 0.06 + RICERCHE_FINTE * 0.01, inputTokens: COSTO_CHIAMATA_FINTA.input, outputTokens: COSTO_CHIAMATA_FINTA.output, ricerche: RICERCHE_FINTE, chiamate: 1 };
}

const notizia = (titolo: string): Notizia => ({ titolo, sintesi: `Testo di ${titolo}.`, fonti: [{ titolo: "Fonte", url: `https://www.anticorruzione.it/-/${titolo.toLowerCase().replace(/\W+/g, "-")}`, data: "2026-11-26" }] });

export function generatoriFinti(stato: { giro: number; fallisci: boolean }) {
  return {
    generaEdizione: async (opz: { contesto: ContestoCosto }): Promise<EsitoGenerazione> => {
      const uso = await registraFinto(opz.contesto);
      if (stato.fallisci) throw new ErroreGenerazione("errore simulato dopo una chiamata pagata", uso);
      stato.giro++;
      const { contenutoVuoto } = await import("../src/lib/newsletter/tipi");
      const c = contenutoVuoto();
      c.sezioni = c.sezioni.map((s) => (s.chiave === "notizia" ? { ...s, notizie: [notizia(`Notizia giro ${stato.giro}`)] } : s.chiave === "normativa" ? { ...s, notizie: [notizia(`Norma A giro ${stato.giro}`), notizia(`Norma B giro ${stato.giro}`)] } : s));
      return { oggetto: `Oggetto giro ${stato.giro}`, preheader: `Pre ${stato.giro}`, contenuto: c, note: "", ricerche: RICERCHE_FINTE, fontiScartate: 0, notizieScartate: 0, uso };
    },
    generaParte: async (opz: { contesto: ContestoCosto; notizia?: Notizia | null; chiave: string }) => {
      const uso = await registraFinto(opz.contesto);
      if (stato.fallisci) throw new ErroreGenerazione("errore simulato dopo una chiamata pagata", uso);
      stato.giro++;
      return { notizie: opz.notizia ? [notizia(`Notizia rifatta ${stato.giro}`)] : [notizia(`Sezione rifatta ${stato.giro} a`), notizia(`Sezione rifatta ${stato.giro} b`)], note: "", uso, fontiScartate: 0 };
    },
  };
}

// Esegue i flussi su un'edizione nuova. Restituisce l'id dell'edizione creata (per l'eventuale pulizia).
export async function provaVersioniECosti(a: ArchivioNewsletter, atteso: Controllo, opz: { marcatore: string }): Promise<string> {
  const { generaNuovaEdizione, rigenera, ripristinaVersione } = await import("../src/lib/newsletter/versioni");
  const { riepilogaCostiNewsletter, costoEdizione } = await import("../src/lib/console/newsletter-costi-calcoli");
  const stato = { giro: 0, fallisci: false };
  const g = generatoriFinti(stato);

  const edizioniPrima = (await a.elencoEdizioni()).length;
  // generazione: l'edizione nasce e la generazione è la versione 1
  const { edizione, esito } = await generaNuovaEdizione({ dataEdizione: "2026-11-27", autore: null, a, g });
  atteso("generazione: versione 1 creata", esito.ok && esito.versione === 1, JSON.stringify(esito));
  const id = edizione.id;
  void opz.marcatore;
  const numero = edizione.numero;

  // tre rigenerazioni consecutive della stessa edizione: stesso numero e stessa data, versioni 2, 3, 4
  for (let i = 0; i < 3; i++) await rigenera({ edizioneId: id, tipo: "rigenerazione", indicazioni: `prova ${i + 1}`, autore: null }, a, g);
  let e = (await a.leggiEdizione(id))!;
  let vs = await a.elencoVersioni(id);
  atteso("tre rigenerazioni: stessa edizione, stesso numero, stessa data", e.numero === numero && e.data_edizione === "2026-11-27" && (await a.elencoEdizioni()).length === edizioniPrima + 1);
  atteso("tre rigenerazioni: versioni 1–4, la 4 in uso", vs.map((v) => v.numero_versione).sort((x, y) => x - y).join(",") === "1,2,3,4" && e.versione_attiva === 4 && e.oggetto === "Oggetto giro 4", `${vs.map((v) => v.numero_versione)} attiva=${e.versione_attiva} ${e.oggetto}`);
  atteso("le indicazioni restano nella versione", vs.find((v) => v.numero_versione === 3)?.indicazioni === "prova 2");

  // ripristino della prima versione
  const rip = await ripristinaVersione({ edizioneId: id, numero: 1, autore: null }, a);
  e = (await a.leggiEdizione(id))!;
  atteso("ripristino della versione 1", rip.ok && e.versione_attiva === 1 && e.oggetto === "Oggetto giro 1", JSON.stringify(rip));
  atteso("il ripristino non crea versioni né costi", (await a.elencoVersioni(id)).length === 4);

  // modifiche manuali conservate: si modifica a mano una notizia, poi si rigenera UN'ALTRA sezione
  const manuale = structuredClone(e.contenuto);
  const norm = manuale.sezioni.findIndex((s) => s.chiave === "normativa");
  manuale.sezioni[norm].notizie[0].titolo = "TITOLO SCRITTO A MANO";
  manuale.editoriale = { attivo: true, titolo: "Editoriale a mano", testo: "Testo a mano.", firma: "Redazione" };
  const testoEditor = { oggetto: "Oggetto a mano", preheader: e.preheader, data_edizione: e.data_edizione, contenuto: manuale, destinatari: e.destinatari };
  const sez = await rigenera({ edizioneId: id, tipo: "rigenerazione_sezione", chiave: "notizia", testoEditor, autore: null }, a, g);
  e = (await a.leggiEdizione(id))!;
  vs = await a.elencoVersioni(id);
  const sNot = e.contenuto.sezioni.find((s) => s.chiave === "notizia")!;
  const sNorm = e.contenuto.sezioni.find((s) => s.chiave === "normativa")!;
  atteso("rigenerazione di una sezione: cambia solo quella", sez.ok && sNot.notizie[0].titolo.startsWith("Sezione rifatta") && sNorm.notizie[0].titolo === "TITOLO SCRITTO A MANO", JSON.stringify(sez));
  atteso("modifiche manuali conservate nel testo (oggetto ed editoriale)", e.oggetto === "Oggetto a mano" && e.contenuto.editoriale.titolo === "Editoriale a mano");
  const manuali = vs.find((v) => v.origine === "modifiche_manuali");
  atteso("modifiche manuali conservate anche come versione prima della rigenerazione", Boolean(manuali && manuali.contenuto?.sezioni.find((s) => s.chiave === "normativa")?.notizie[0].titolo === "TITOLO SCRITTO A MANO" && (manuali.costo_usd ?? 0) === 0));

  // rigenerazione di una singola notizia: solo quella
  const prima = (await a.leggiEdizione(id))!;
  const not = await rigenera({ edizioneId: id, tipo: "rigenerazione_notizia", chiave: "normativa", indice: 1, autore: null }, a, g);
  e = (await a.leggiEdizione(id))!;
  const n2 = e.contenuto.sezioni.find((s) => s.chiave === "normativa")!.notizie;
  atteso("rigenerazione di una notizia: cambia solo quella", not.ok && n2[0].titolo === "TITOLO SCRITTO A MANO" && n2[1].titolo.startsWith("Notizia rifatta") && JSON.stringify(e.contenuto.sezioni.find((s) => s.chiave === "notizia")) === JSON.stringify(prima.contenuto.sezioni.find((s) => s.chiave === "notizia")));
  atteso("sezioni della redazione non rigenerabili", !(await rigenera({ edizioneId: id, tipo: "rigenerazione_sezione", chiave: "omnia", autore: null }, a, g)).ok);

  // errore di generazione: il testo resta, la versione fallita registra il costo speso
  const integra = (await a.leggiEdizione(id))!;
  stato.fallisci = true;
  const ko = await rigenera({ edizioneId: id, tipo: "rigenerazione", autore: null }, a, g);
  stato.fallisci = false;
  e = (await a.leggiEdizione(id))!;
  vs = await a.elencoVersioni(id);
  const fallita = vs.find((v) => v.esito === "fallita");
  atteso("errore di generazione: la versione precedente resta integra", !ko.ok && JSON.stringify(e.contenuto) === JSON.stringify(integra.contenuto) && e.oggetto === integra.oggetto && e.versione_attiva === integra.versione_attiva);
  atteso("errore di generazione: versione «fallita» con il costo speso e senza contenuto", Boolean(fallita && !fallita.contenuto && Math.abs((fallita.costo_usd ?? 0) - 0.09) < 1e-9 && fallita.errore));
  atteso("dopo un errore il blocco è rilasciato (si può rigenerare)", !(await a.leggiEdizione(id))!.generazione_in_corso_da);

  // approvazione invalidata da una rigenerazione (e da un ripristino)
  await a.aggiornaEdizione(id, { stato: "approvata", approvata_il: new Date().toISOString() }, ["bozza", "in_revisione"]);
  await a.aggiornaEdizione(id, { stato: "programmata", programmata_per: new Date(Date.now() + 86400000).toISOString() }, ["approvata"]);
  const dopoApp = await rigenera({ edizioneId: id, tipo: "rigenerazione_notizia", chiave: "notizia", indice: 0, autore: null }, a, g);
  e = (await a.leggiEdizione(id))!;
  atteso("rigenerazione di un'edizione programmata: approvazione e programmazione tolte", dopoApp.ok && e.stato === "in_revisione" && !e.approvata_il && !e.programmata_per && /approvazione/.test(dopoApp.ok ? dopoApp.messaggio : ""), `${e.stato} ${e.approvata_il}`);
  await a.aggiornaEdizione(id, { stato: "approvata", approvata_il: new Date().toISOString() }, ["in_revisione"]);
  await ripristinaVersione({ edizioneId: id, numero: 2, autore: null }, a);
  e = (await a.leggiEdizione(id))!;
  atteso("ripristino su un'edizione approvata: approvazione tolta", e.stato === "in_revisione" && !e.approvata_il);

  // generazioni concorrenti e doppio clic: il blocco ne fa passare una sola
  const [r1, r2] = await Promise.all([rigenera({ edizioneId: id, tipo: "rigenerazione", autore: null }, a, g), rigenera({ edizioneId: id, tipo: "rigenerazione", autore: null }, a, g)]);
  atteso("due rigenerazioni contemporanee: una sola parte", [r1, r2].filter((r) => r.ok).length === 1 && [r1, r2].some((r) => !r.ok && /in corso/.test(r.errore)), JSON.stringify([r1, r2]));
  const token = "00000000-0000-4000-8000-000000000001";
  atteso("blocco: preso una volta", await a.prendiBlocco(id, token, ["bozza", "in_revisione", "approvata", "programmata"]));
  atteso("blocco: la seconda presa è rifiutata", !(await a.prendiBlocco(id, "00000000-0000-4000-8000-000000000002", ["bozza", "in_revisione", "approvata", "programmata"])));
  await a.rilasciaBlocco(id, token);

  // contabilizzazione: ogni chiamata una volta sola, le versioni non si sommano, fallite comprese
  const ops = (await a.operazioniCosto()).filter((o) => (o.dettaglio ?? {}).edizione_id === id);
  const generazioniFatte = new Set(ops.map((o) => (o.dettaglio ?? {}).generazione_id)).size;
  vs = await a.elencoVersioni(id);
  const vGenerate = vs.filter((v) => v.generazione_id);
  atteso("ogni generazione (riuscita o fallita) ha le sue righe di costo", generazioniFatte === vGenerate.length && generazioniFatte >= 8, `${generazioniFatte} vs ${vGenerate.length}`);
  atteso("due righe per generazione (modello e ricerca web)", ops.length === generazioniFatte * 2, `${ops.length}`);
  const totaleRighe = ops.reduce((s, o) => s + (o.costo_stimato ?? 0), 0);
  const totaleVersioni = vs.reduce((s, v) => s + (v.costo_usd ?? 0), 0);
  atteso("il costo delle versioni coincide con le righe (nessun costo perso)", Math.abs(totaleRighe - totaleVersioni) < 1e-6, `${totaleRighe} vs ${totaleVersioni}`);
  const ce = costoEdizione(await a.operazioniCosto(), id);
  atteso("costo cumulativo dell'edizione = somma delle righe, senza doppioni", Math.abs(ce.produzioneUsd + ce.sviluppoUsd - totaleRighe) < 1e-6);
  const r = riepilogaCostiNewsletter({
    operazioni: await a.operazioniCosto(),
    versioni: await a.versioniSenzaContenuto(),
    edizioni: await a.elencoEdizioni(),
    invii: [],
    impostazioni: { resend_piano: null, resend_quota_mensile_eur: null },
    cambioUsdEur: 0.9,
    adesso: new Date(),
    da: "2000-01-01",
    a: "2100-12-31",
  });
  const riga = r.edizioni.find((x) => x.id === id)!;
  atteso("riepilogo: l'edizione ha tutte le versioni e le fallite", riga.versioni === vs.filter((v) => v.esito === "ok").length && riga.fallite >= 1);
  atteso("riepilogo: costo dell'edizione = righe (produzione + sviluppo)", Math.abs(riga.costoUsd + riga.costoSviluppoUsd - totaleRighe) < 1e-6);
  return id;
}
