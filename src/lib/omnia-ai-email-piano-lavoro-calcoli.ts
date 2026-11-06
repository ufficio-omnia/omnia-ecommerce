import {
  PIEDE_CLIENTE,
  PIEDE_UFFICIO,
  cornice,
  dataOra,
  esc,
  euro,
  linkStripe,
  nomeCliente,
  oggettoConProva,
  pulsante,
  collegamento,
  tabella,
  type ClienteEmail,
  type EmailPronta,
} from "@/lib/omnia-ai-email-eventi-calcoli";
import type { AziendaRevisione, FatturazioneStripe } from "@/lib/omnia-ai-email-revisione-calcoli";

// Le due email dell'acquisto singolo del piano di lavoro pagato: all'ufficio (con i dati per la fattura) e la conferma al cliente.

export function emailUfficioPianoLavoroAcquistato(d: {
  prova: boolean;
  acquistoId: string;
  cliente: ClienteEmail;
  azienda: AziendaRevisione | null;
  fatturazione: FatturazioneStripe | null;
  garaTitolo: string;
  importoPagatoCentesimi: number;
  pagataIl: Date;
  stripePaymentIntentId: string | null;
  // per questa stessa gara risulta già un altro pagamento (due schede di pagamento aperte insieme)
  pagamentoDoppio?: boolean;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const a = d.azienda;
  const f = d.fatturazione;
  const azienda: [string, string | { html: string } | null | undefined][] = a
    ? [
        ["Ragione sociale", a.ragioneSociale],
        ["Forma giuridica", a.formaGiuridica],
        ["Partita IVA", a.partitaIva],
        ["Codice fiscale", a.codiceFiscale],
        ["Indirizzo", a.indirizzo],
        ["Codice SDI", a.codiceSdi],
        ["PEC", a.pec],
      ]
    : [];

  return {
    oggetto: oggettoConProva(`${d.pagamentoDoppio ? "PAGAMENTO DOPPIO — " : ""}Piano di lavoro acquistato: ${nome} — ${d.garaTitolo}`, d.prova),
    html: cornice({
      titolo: "Piano di lavoro acquistato",
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        (d.pagamentoDoppio
          ? `<p style="background:#fde8e8;border:1px solid #f1a9a9;border-radius:8px;padding:8px 12px;font-size:14px;"><strong>Attenzione, pagamento doppio:</strong> per questa stessa gara risulta già un altro pagamento del piano di lavoro. Verifica su Stripe e rimborsa il doppione.</p>`
          : "") +
        `<p><strong>${esc(nome)}</strong> ha acquistato il piano di lavoro della gara <strong>${esc(d.garaTitolo)}</strong>. Non serve nessun intervento: il cliente lo genera da solo dalla pagina della gara. Da fare: <strong>la fattura</strong> (dalla console, «Da fatturare»).</p>` +
        `<p style="margin:18px 0 0;color:#6b7280;">Pagamento</p>` +
        tabella([
          ["Pagato (IVA inclusa)", euro(d.importoPagatoCentesimi)],
          ["Data del pagamento", dataOra(d.pagataIl)],
        ]) +
        `<p style="margin:18px 0 0;color:#6b7280;">Cliente</p>` +
        tabella([["Email dell'account", d.cliente.email], ...azienda]) +
        (f
          ? `<p style="margin:18px 0 0;color:#6b7280;">Dati di fatturazione (raccolti da Stripe)</p>` +
            tabella([
              ["Intestatario", f.nome],
              ["Email", f.email],
              ["Telefono", f.telefono],
              ["Indirizzo", f.indirizzo],
              ["Partite IVA / codici fiscali", f.identificativiFiscali.length > 0 ? f.identificativiFiscali.join(", ") : null],
            ])
          : "") +
        (d.stripePaymentIntentId ? collegamento("Apri il pagamento su Stripe", linkStripe("payments", d.stripePaymentIntentId, !d.prova)) : "") +
        `<p style="color:#6b7280;font-size:12px;">Acquisto ${esc(d.acquistoId.slice(0, 8))}</p>`,
    }),
  };
}

// Il piano di lavoro dell'abbonamento aggiunto o tolto (subito, oppure dal prossimo rinnovo se è un cambio programmato): all'ufficio.
export function emailUfficioPianoLavoroAbbonamento(d: {
  prova: boolean;
  cliente: ClienteEmail;
  piano: string | null;
  cambio: "aggiunto" | "tolto";
  // da quando vale, se è un cambio programmato; null = già in corso
  dal: Date | null;
  stripeSubscriptionId: string;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const aggiunto = d.cambio === "aggiunto";
  const azione = aggiunto ? "ha aggiunto" : "ha tolto";
  const quando = d.dal ? `dal ${dataOra(d.dal)} (prossimo rinnovo)` : "subito";
  return {
    oggetto: oggettoConProva(`Piano di lavoro ${aggiunto ? "aggiunto all'" : "tolto dall'"}abbonamento: ${nome}`, d.prova),
    html: cornice({
      titolo: `Piano di lavoro ${aggiunto ? "aggiunto" : "tolto"}`,
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        `<p><strong>${esc(nome)}</strong> ${azione} il piano di lavoro ${aggiunto ? "al" : "dal"} suo abbonamento OMNIA AI. Vale ${esc(quando)}. Non serve nessun intervento: il prezzo mensile cambia da solo su Stripe.</p>` +
        tabella([
          ["Cliente", d.cliente.nome],
          ["Email", d.cliente.email],
          ["Piano", d.piano ?? "—"],
          ["Piano di lavoro", aggiunto ? "incluso" : "non incluso"],
          ["Da quando", d.dal ? dataOra(d.dal) : "subito"],
        ]) +
        collegamento("Apri l'abbonamento su Stripe", linkStripe("subscriptions", d.stripeSubscriptionId, !d.prova)),
    }),
  };
}

// `linkCondizioni`: la pagina con le condizioni del servizio che il cliente ha accettato (la stessa versione, con la stessa impronta).
export function emailClientePianoLavoroAcquistato(d: { prova: boolean; garaTitolo: string; importoCentesimi: number; pagataIl: Date; linkGara: string; linkCondizioni?: string }): EmailPronta {
  return {
    oggetto: oggettoConProva("Acquisto del piano di lavoro ricevuto — OMNIA AI", d.prova),
    html: cornice({
      titolo: "Acquisto del piano di lavoro ricevuto",
      prova: d.prova,
      piede: PIEDE_CLIENTE,
      corpo:
        `<p>Gentile cliente, abbiamo ricevuto il tuo pagamento di <strong>${esc(euro(d.importoCentesimi))}</strong> (IVA inclusa) per il piano di lavoro della gara <strong>${esc(d.garaTitolo)}</strong>. Grazie.</p>` +
        tabella([
          ["Gara", d.garaTitolo],
          ["Importo", euro(d.importoCentesimi)],
          ["Data del pagamento", dataOra(d.pagataIl)],
        ]) +
        `<p style="margin:18px 0 6px;"><strong>Cosa succede adesso</strong></p>` +
        `<p style="margin:4px 0;">1. Apri la gara e premi «Genera il piano di lavoro»: l'Excel con formule attive è pronto in pochi minuti.</p>` +
        `<p style="margin:4px 0;">2. Il piano è un dimensionamento di partenza, non un preventivo: controlla le ipotesi, completa i dati mancanti e sostituisci i prezzi standard di macchinari e attrezzature con quelli dei tuoi fornitori.</p>` +
        `<p style="margin:4px 0;">3. Se i documenti della gara indicano una proroga dei termini, puoi generare una seconda versione.</p>` +
        (d.linkCondizioni ? collegamento("Le condizioni del servizio «Piano di lavoro» che hai accettato", d.linkCondizioni) : "") +
        pulsante("Apri la gara", d.linkGara),
    }),
  };
}
