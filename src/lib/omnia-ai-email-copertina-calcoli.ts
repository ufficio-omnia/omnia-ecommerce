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

// Le due email dell'acquisto della copertina di una gara pagato: all'ufficio (con i dati per la fattura) e la conferma al cliente.

export function emailUfficioCopertinaAcquistata(d: {
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
    oggetto: oggettoConProva(`${d.pagamentoDoppio ? "PAGAMENTO DOPPIO — " : ""}Copertina acquistata: ${nome} — ${d.garaTitolo}`, d.prova),
    html: cornice({
      titolo: "Copertina della relazione tecnica acquistata",
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        (d.pagamentoDoppio
          ? `<p style="background:#fde8e8;border:1px solid #f1a9a9;border-radius:8px;padding:8px 12px;font-size:14px;"><strong>Attenzione, pagamento doppio:</strong> per questa stessa gara risulta già un altro pagamento della copertina. Verifica su Stripe e rimborsa il doppione.</p>`
          : "") +
        `<p><strong>${esc(nome)}</strong> ha acquistato la copertina della relazione tecnica della gara <strong>${esc(d.garaTitolo)}</strong>. Non serve nessun intervento: il cliente la genera da solo dalla pagina della gara (fino a 3 generazioni per stile). Da fare: <strong>la fattura</strong> (dalla console, «Da fatturare»).</p>` +
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

export function emailClienteCopertinaAcquistata(d: { prova: boolean; garaTitolo: string; importoCentesimi: number; pagataIl: Date; linkGara: string }): EmailPronta {
  return {
    oggetto: oggettoConProva("Acquisto della copertina ricevuto — OMNIA AI", d.prova),
    html: cornice({
      titolo: "Acquisto della copertina ricevuto",
      prova: d.prova,
      piede: PIEDE_CLIENTE,
      corpo:
        `<p>Gentile cliente, abbiamo ricevuto il tuo pagamento di <strong>${esc(euro(d.importoCentesimi))}</strong> (IVA inclusa) per la copertina della relazione tecnica della gara <strong>${esc(d.garaTitolo)}</strong>. Grazie.</p>` +
        tabella([
          ["Gara", d.garaTitolo],
          ["Importo", euro(d.importoCentesimi)],
          ["Data del pagamento", dataOra(d.pagataIl)],
        ]) +
        `<p style="margin:18px 0 6px;"><strong>Cosa succede adesso</strong></p>` +
        `<p style="margin:4px 0;">1. Apri la gara e premi «Genera copertina relazione tecnica»: puoi scegliere lo stile stilizzato o quello realistico.</p>` +
        `<p style="margin:4px 0;">2. Per questa gara hai fino a 3 generazioni per ogni stile: ogni generazione è diversa, così puoi confrontarle e scegliere.</p>` +
        `<p style="margin:4px 0;">3. Controlla sempre testi e loghi sulla copertina prima di usarla: è un'immagine creata da un sistema di intelligenza artificiale e può contenere imprecisioni.</p>` +
        pulsante("Apri la gara", d.linkGara),
    }),
  };
}
