import { dataRoma } from "@/lib/newsletter/pianificazione";
import type { Edizione, Impostazioni, Invio, OperazioneCosto, Versione } from "@/lib/newsletter/tipi";

// Riepilogo economico della newsletter «Tender Weekly» per l'area dedicata di Costi e margini. Funzione pura.
//
// Fonte UNICA dei costi: le righe di ai_operazioni (lo stesso registro di tutto il progetto). Le versioni portano il
// costo della loro generazione solo come informazione: qui non si sommano mai, così nessun costo è contato due volte.
//  - produzione: operazione «newsletter_*»; sviluppo e collaudo: «prova:newsletter_*» (mostrati a parte, fuori dai
//    totali e dai margini);
//  - natura del costo: «stimato» = consumi reali (token, ricerche) × tariffe di listino di src/lib/ai-pricing.ts;
//    «non disponibile» = chiamata senza tariffa (costo nullo); costi «effettivi» fatturati per singola chiamata non
//    esistono (Anthropic fattura in aggregato);
//  - Resend: nessun costo per email (comprese nel piano); si mostrano i volumi e, se dichiarata, la quota fissa
//    mensile attribuita alla newsletter. Le prove simulate (fuori produzione) non contano.

export type Ambito = "produzione" | "sviluppo";

export type RigaOperazione = OperazioneCosto & {
  ambito: Ambito;
  tipo: string;
  voce: "modello" | "ricerca_web" | "altro";
  giorno: string; // AAAA-MM-GG di Roma
  edizioneId: string | null;
  numeroEdizione: number | null;
  versione: number | null;
  generazioneId: string | null;
};

export function classificaOperazione(o: OperazioneCosto): RigaOperazione {
  const sviluppo = o.operazione.startsWith("prova:") || o.operazione.startsWith("prova-leggero:");
  const nome = o.operazione.replace(/^prova(-leggero)?:/, "");
  const d = o.dettaglio ?? {};
  const voce = d.voce === "ricerca_web" || o.model === "web_search" ? "ricerca_web" : d.voce === "modello" || o.provider === "anthropic" ? "modello" : "altro";
  return {
    ...o,
    ambito: sviluppo ? "sviluppo" : "produzione",
    tipo: typeof d.tipo === "string" ? d.tipo : nome.replace(/^newsletter_/, ""),
    voce,
    giorno: dataRoma(new Date(o.created_at)),
    edizioneId: typeof d.edizione_id === "string" ? d.edizione_id : null,
    numeroEdizione: typeof d.numero_edizione === "number" ? d.numero_edizione : null,
    versione: typeof d.versione === "number" ? d.versione : null,
    generazioneId: typeof d.generazione_id === "string" ? d.generazione_id : null,
  };
}

type Somma = { costoUsd: number; chiamate: number; senzaCosto: number; inputTokens: number; outputTokens: number; ricerche: number };
const somma0 = (): Somma => ({ costoUsd: 0, chiamate: 0, senzaCosto: 0, inputTokens: 0, outputTokens: 0, ricerche: 0 });
function aggiungi(s: Somma, r: RigaOperazione) {
  if (r.costo_stimato === null) s.senzaCosto++;
  else s.costoUsd += r.costo_stimato;
  if (r.voce === "ricerca_web") s.ricerche += Number((r.dettaglio ?? {}).ricerche_web ?? 0);
  else {
    s.chiamate++;
    s.inputTokens += r.input_tokens ?? 0;
    s.outputTokens += r.output_tokens ?? 0;
  }
}

export type RiepilogoCostiNewsletter = ReturnType<typeof riepilogaCostiNewsletter>;

export function riepilogaCostiNewsletter(d: {
  operazioni: OperazioneCosto[];
  versioni: Omit<Versione, "contenuto">[];
  edizioni: Edizione[];
  invii: Invio[];
  // email di conferma delle iscrizioni dal sito (righe «email_conferma» del registro)
  conferme?: { creato_il: string; dettaglio: Record<string, unknown> }[];
  impostazioni: Pick<Impostazioni, "resend_piano" | "resend_quota_mensile_eur">;
  cambioUsdEur: number | null;
  adesso: Date;
  // periodo scelto: giorni di Roma inclusi
  da: string;
  a: string;
}) {
  const righe = d.operazioni.map(classificaOperazione);
  const prod = righe.filter((r) => r.ambito === "produzione");
  const svil = righe.filter((r) => r.ambito === "sviluppo");
  const oggi = dataRoma(d.adesso);
  const mese = oggi.slice(0, 7);
  const anno = oggi.slice(0, 4);
  const eur = (usd: number) => (d.cambioUsdEur ? usd * d.cambioUsdEur : null);
  const totale = (filtro: (r: RigaOperazione) => boolean, insieme = prod) => {
    const s = somma0();
    for (const r of insieme) if (filtro(r)) aggiungi(s, r);
    return { ...s, costoEur: eur(s.costoUsd) };
  };
  const nelPeriodo = (r: RigaOperazione) => r.giorno >= d.da && r.giorno <= d.a;

  const tessere = {
    oggi: totale((r) => r.giorno === oggi),
    mese: totale((r) => r.giorno.startsWith(mese)),
    anno: totale((r) => r.giorno.startsWith(anno)),
    storico: totale(() => true),
    periodo: totale(nelPeriodo),
    sviluppoPeriodo: totale(nelPeriodo, svil),
    sviluppoStorico: totale(() => true, svil),
  };

  // generazioni: una per identificativo (più chiamate e ricerche appartengono alla stessa generazione)
  const generazioni = new Map<string, { tipo: string; costoUsd: number; giorno: string; edizioneId: string | null }>();
  for (const r of prod.filter(nelPeriodo)) {
    const chiave = r.generazioneId ?? `senza-id:${r.id}`;
    const g = generazioni.get(chiave) ?? { tipo: r.tipo, costoUsd: 0, giorno: r.giorno, edizioneId: r.edizioneId };
    g.costoUsd += r.costo_stimato ?? 0;
    generazioni.set(chiave, g);
  }
  const perTipoGen = new Map<string, number>();
  for (const g of generazioni.values()) perTipoGen.set(g.tipo, (perTipoGen.get(g.tipo) ?? 0) + 1);
  const versioniPeriodo = d.versioni.filter((v) => {
    const g = dataRoma(new Date(v.creata_il));
    return g >= d.da && g <= d.a && v.origine !== "modifiche_manuali" && v.origine !== "iniziale";
  });
  const conteggi = {
    generazioni: perTipoGen.get("generazione") ?? 0,
    rigenerazioniIntere: perTipoGen.get("rigenerazione") ?? 0,
    rigenerazioniSezione: perTipoGen.get("rigenerazione_sezione") ?? 0,
    rigenerazioniNotizia: perTipoGen.get("rigenerazione_notizia") ?? 0,
    totaleGenerazioni: generazioni.size,
    fallite: versioniPeriodo.filter((v) => v.esito === "fallita").length,
    edizioniInviate: d.edizioni.filter((e) => (e.stato === "inviata" || e.stato === "invio_parziale") && e.invio_concluso_il && dataRoma(new Date(e.invio_concluso_il)) >= d.da && dataRoma(new Date(e.invio_concluso_il)) <= d.a).length,
  };

  // ripartizioni (produzione, nel periodo)
  const perVoce = new Map<string, Somma>();
  const perTipo = new Map<string, Somma>();
  for (const r of prod.filter(nelPeriodo)) {
    const kv = `${r.provider} · ${r.voce === "ricerca_web" ? "ricerca web" : r.model}`;
    if (!perVoce.has(kv)) perVoce.set(kv, somma0());
    aggiungi(perVoce.get(kv)!, r);
    if (!perTipo.has(r.tipo)) perTipo.set(r.tipo, somma0());
    aggiungi(perTipo.get(r.tipo)!, r);
  }

  // per edizione (tutto lo storico di produzione; le edizioni si leggono per intero)
  const costoPerEdizione = new Map<string, number>();
  for (const r of prod) if (r.edizioneId) costoPerEdizione.set(r.edizioneId, (costoPerEdizione.get(r.edizioneId) ?? 0) + (r.costo_stimato ?? 0));
  const costoSviluppoPerEdizione = new Map<string, number>();
  for (const r of svil) if (r.edizioneId) costoSviluppoPerEdizione.set(r.edizioneId, (costoSviluppoPerEdizione.get(r.edizioneId) ?? 0) + (r.costo_stimato ?? 0));
  const edizioni = d.edizioni
    .map((e) => {
      const vs = d.versioni.filter((v) => v.edizione_id === e.id);
      const attiva = vs.find((v) => v.numero_versione === e.versione_attiva);
      const costoUsd = costoPerEdizione.get(e.id) ?? 0;
      // costo della generazione che ha prodotto la versione in uso: tutto il resto sono versioni scartate o fallite
      const costoAttivaUsd = attiva?.generazione_id ? prod.filter((r) => r.generazioneId === attiva.generazione_id).reduce((s, r) => s + (r.costo_stimato ?? 0), 0) : 0;
      return {
        id: e.id,
        numero: e.numero,
        oggetto: e.oggetto,
        stato: e.stato,
        versioni: vs.filter((v) => v.esito === "ok").length,
        fallite: vs.filter((v) => v.esito === "fallita").length,
        versioneAttiva: e.versione_attiva,
        costoUsd,
        costoEur: eur(costoUsd),
        costoAttivaUsd,
        costoScartateUsd: Math.max(0, costoUsd - costoAttivaUsd),
        costoSviluppoUsd: costoSviluppoPerEdizione.get(e.id) ?? 0,
      };
    })
    .sort((x, y) => y.numero - x.numero);
  const inviate = edizioni.filter((e) => e.stato === "inviata" || e.stato === "invio_parziale");
  const medie = {
    perGenerazioneUsd: generazioni.size ? tessere.periodo.costoUsd / generazioni.size : null,
    perEdizioneInviataUsd: inviate.length ? inviate.reduce((s, e) => s + e.costoUsd, 0) / inviate.length : null,
  };

  // Resend: volumi per mese (solo invii veri: gli id «simulato-» sono prove di sviluppo)
  const veri = d.invii.filter((i) => i.resend_id && !i.resend_id.startsWith("simulato-") && i.inviato_il);
  const perMese = new Map<string, { reali: number; prove: number; conferme: number }>();
  for (const i of veri) {
    const m = dataRoma(new Date(i.inviato_il!)).slice(0, 7);
    const x = perMese.get(m) ?? { reali: 0, prove: 0, conferme: 0 };
    if (i.tipo === "reale") x.reali++;
    else x.prove++;
    perMese.set(m, x);
  }
  // email di conferma vere (le simulate dello sviluppo non partono e non contano)
  const confermeVere = (d.conferme ?? []).filter((c) => c.dettaglio?.simulato !== true && c.dettaglio?.esito !== "errore");
  for (const c of confermeVere) {
    const m = dataRoma(new Date(c.creato_il)).slice(0, 7);
    const x = perMese.get(m) ?? { reali: 0, prove: 0, conferme: 0 };
    x.conferme++;
    perMese.set(m, x);
  }
  const resend = {
    piano: d.impostazioni.resend_piano,
    quotaMensileEur: d.impostazioni.resend_quota_mensile_eur,
    mesi: [...perMese.entries()].sort((x, y) => y[0].localeCompare(x[0])).map(([m, v]) => ({ mese: m, ...v })),
    periodo: {
      reali: veri.filter((i) => i.tipo === "reale" && dataRoma(new Date(i.inviato_il!)) >= d.da && dataRoma(new Date(i.inviato_il!)) <= d.a).length,
      prove: veri.filter((i) => i.tipo === "prova" && dataRoma(new Date(i.inviato_il!)) >= d.da && dataRoma(new Date(i.inviato_il!)) <= d.a).length,
      simulate: d.invii.filter((i) => i.resend_id?.startsWith("simulato-")).length + (d.conferme ?? []).filter((c) => c.dettaglio?.simulato === true).length,
      conferme: confermeVere.filter((c) => dataRoma(new Date(c.creato_il)) >= d.da && dataRoma(new Date(c.creato_il)) <= d.a).length,
    },
  };

  return {
    tessere,
    conteggi,
    medie,
    perVoce: [...perVoce.entries()].map(([voce, s]) => ({ voce, ...s, costoEur: eur(s.costoUsd) })).sort((x, y) => y.costoUsd - x.costoUsd),
    perTipo: [...perTipo.entries()].map(([tipo, s]) => ({ tipo, ...s, costoEur: eur(s.costoUsd) })).sort((x, y) => y.costoUsd - x.costoUsd),
    edizioni,
    storico: righe.filter(nelPeriodo).slice(0, 500),
    resend,
  };
}

// Costo cumulativo di UNA edizione (editor): tutte le versioni, anche scartate o fallite. Produzione e sviluppo separati.
export function costoEdizione(operazioni: OperazioneCosto[], edizioneId: string) {
  const righe = operazioni.map(classificaOperazione).filter((r) => r.edizioneId === edizioneId);
  const s = (amb: Ambito) => righe.filter((r) => r.ambito === amb).reduce((t, r) => t + (r.costo_stimato ?? 0), 0);
  return { produzioneUsd: s("produzione"), sviluppoUsd: s("sviluppo"), chiamate: righe.filter((r) => r.voce === "modello").length, senzaCosto: righe.filter((r) => r.costo_stimato === null).length };
}
