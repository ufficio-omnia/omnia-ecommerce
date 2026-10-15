import { PIEDE_CLIENTE, cornice, esc, pulsante, type EmailPronta } from "@/lib/omnia-ai-email-eventi-calcoli";
import { OMNIA_AI_BASE_URL } from "@/lib/zone";

// Le email dell'Ufficio Gare. Testi e struttura qui (puri, provabili); l'invio sta in omnia-ai-ufficio-gare.ts.
//   1) invito: all'Ufficio Gare, con il link per scegliere la password
//   2) gare finite o abbonamento non attivo: AL TITOLARE, automatica, al massimo una al giorno
//   3) revisione umana richiesta: AL TITOLARE, quando l'Ufficio Gare preme il pulsante
// Nessun prezzo: cambiano (sconti, offerte) e le email non devono mai promettere una cifra.

export const URL_ABBONAMENTO = `${OMNIA_AI_BASE_URL}/dashboard/omnia-ai/abbonamento`;

export function urlRevisioneGara(garaId: string): string {
  return `${OMNIA_AI_BASE_URL}/dashboard/omnia-ai/gare/${encodeURIComponent(garaId)}/revisione`;
}

export function emailInvitoUfficioGare(d: { linkPassword: string; nomeAzienda: string | null; emailTitolare: string | null }): EmailPronta {
  const azienda = d.nomeAzienda?.trim() || d.emailTitolare?.trim() || "la tua azienda";
  const corpo = `<p>${esc(azienda)} ti ha creato l'accesso a OMNIA AI come <strong>Ufficio Gare</strong>.</p>
<p>Con questo accesso puoi caricare i documenti delle gare, farle analizzare, usare la chat e generare la relazione tecnica. Le parti amministrative (abbonamento, pagamenti, fatture e dati dell'azienda) restano dell'amministratore.</p>
<p>Per cominciare, scegli la tua password:</p>
${pulsante("Scegli la tua password", d.linkPassword)}
<p>Il link è valido per un tempo limitato e si usa una sola volta: se è scaduto, chiedi all'amministratore di rinviartelo. Una volta scelta, la password la conosci solo tu.</p>`;
  return {
    oggetto: "Il tuo accesso a OMNIA AI come Ufficio Gare",
    html: cornice({ titolo: "Benvenuto in OMNIA AI", corpo, prova: false, piede: PIEDE_CLIENTE }),
  };
}

export function emailAvvisoGareFinite(d: { emailUfficioGare: string; motivo: "gare_finite" | "abbonamento_non_attivo" }): EmailPronta {
  const finite = d.motivo === "gare_finite";
  const corpo = finite
    ? `<p>L'Ufficio Gare (${esc(d.emailUfficioGare)}) ha provato a lavorare su una gara, ma <strong>le gare a disposizione sono finite</strong> (quelle del piano e gli eventuali crediti).</p>
<p>Per permettergli di svolgere altre gare puoi passare a un piano superiore oppure acquistare dei crediti singoli, dalla tua area riservata:</p>
${pulsante("Vai all'abbonamento", URL_ABBONAMENTO)}
<p>Finché non lo fai, l'Ufficio Gare può solo consultare le gare già avviate.</p>`
    : `<p>L'Ufficio Gare (${esc(d.emailUfficioGare)}) ha provato a lavorare su una gara, ma <strong>l'abbonamento dell'azienda non è attivo</strong>.</p>
<p>Per riprendere il lavoro riattiva l'abbonamento dalla tua area riservata:</p>
${pulsante("Vai all'abbonamento", URL_ABBONAMENTO)}
<p>Nel frattempo l'Ufficio Gare può solo consultare le gare esistenti e scaricare i documenti già generati.</p>`;
  return {
    oggetto: finite ? "Le gare di OMNIA AI sono finite: il tuo Ufficio Gare è fermo" : "L'abbonamento OMNIA AI non è attivo: il tuo Ufficio Gare è fermo",
    html: cornice({
      titolo: finite ? "Gare finite" : "Abbonamento non attivo",
      corpo: `${corpo}<p style="color:#6b7280;font-size:13px;">Ti scriviamo al massimo una volta al giorno per questo motivo.</p>`,
      prova: false,
      piede: PIEDE_CLIENTE,
    }),
  };
}

export function emailAvvisoRevisioneRichiesta(d: { emailUfficioGare: string; titoloGara: string; garaId: string }): EmailPronta {
  const corpo = `<p>L'Ufficio Gare (${esc(d.emailUfficioGare)}) vorrebbe la <strong>revisione umana</strong> della relazione tecnica per la gara «${esc(d.titoloGara)}».</p>
<p>La revisione la richiedi e la paghi tu: dalla pagina della gara puoi scegliere i tempi e vedere il prezzo prima di confermare.</p>
${pulsante("Apri la richiesta di revisione", urlRevisioneGara(d.garaId))}`;
  return {
    oggetto: `Revisione umana richiesta dal tuo Ufficio Gare: ${d.titoloGara}`,
    html: cornice({ titolo: "Revisione umana richiesta", corpo, prova: false, piede: PIEDE_CLIENTE }),
  };
}
