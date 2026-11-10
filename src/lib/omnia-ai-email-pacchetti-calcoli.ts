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
import { SERVIZI, testoUnita, type ServizioPacchetto } from "@/lib/pacchetti-servizi-calcoli";

// Le due email di un pacchetto di servizi appena pagato: all'ufficio (con i dati per la fattura) e la conferma al cliente.

export function emailUfficioPacchettoAcquistato(d: {
  prova: boolean;
  acquistoId: string;
  cliente: ClienteEmail;
  azienda: AziendaRevisione | null;
  fatturazione: FatturazioneStripe | null;
  servizio: ServizioPacchetto;
  quantita: number;
  importoPagatoCentesimi: number;
  pagataIl: Date;
  stripePaymentIntentId: string | null;
  // le unità NON sono finite nel saldo (utente non più presente): da sistemare a mano
  accreditoMancante?: boolean;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const a = d.azienda;
  const f = d.fatturazione;
  const unita = testoUnita(d.quantita, d.servizio);
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
    oggetto: oggettoConProva(`Pacchetto acquistato: ${nome} — ${SERVIZI[d.servizio].nome}, ${unita}`, d.prova),
    html: cornice({
      titolo: "Pacchetto acquistato",
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        (d.accreditoMancante
          ? `<p style="background:#fde8e8;border:1px solid #f1a9a9;border-radius:8px;padding:8px 12px;font-size:14px;"><strong>Attenzione:</strong> le unità non risultano accreditate sul saldo del cliente (l'account non è più presente). Verifica e, se serve, rimborsa su Stripe.</p>`
          : "") +
        `<p><strong>${esc(nome)}</strong> ha acquistato il pacchetto <strong>${esc(SERVIZI[d.servizio].nome)}: ${esc(unita)}</strong>. Non serve nessun intervento sul saldo: le unità sono già nel suo conto. Da fare: <strong>la fattura</strong> (dalla console, «Da fatturare»).</p>` +
        `<p style="margin:18px 0 0;color:#6b7280;">Pagamento</p>` +
        tabella([
          ["Pacchetto", `${SERVIZI[d.servizio].nome}: ${unita}`],
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

// `linkCondizioni`: la pagina con le condizioni del servizio che il cliente ha accettato.
export function emailClientePacchettoAcquistato(d: {
  prova: boolean;
  servizio: ServizioPacchetto;
  quantita: number;
  importoCentesimi: number;
  pagataIl: Date;
  linkServizi: string;
  linkCondizioni?: string;
}): EmailPronta {
  const unita = testoUnita(d.quantita, d.servizio);
  return {
    oggetto: oggettoConProva(`Acquisto del pacchetto ricevuto — OMNIA AI`, d.prova),
    html: cornice({
      titolo: "Acquisto del pacchetto ricevuto",
      prova: d.prova,
      piede: PIEDE_CLIENTE,
      corpo:
        `<p>Gentile cliente, abbiamo ricevuto il tuo pagamento di <strong>${esc(euro(d.importoCentesimi))}</strong> (IVA inclusa) per il pacchetto <strong>${esc(SERVIZI[d.servizio].nome)}: ${esc(unita)}</strong>. Grazie.</p>` +
        tabella([
          ["Pacchetto", `${SERVIZI[d.servizio].nome}: ${unita}`],
          ["Importo", euro(d.importoCentesimi)],
          ["Data del pagamento", dataOra(d.pagataIl)],
        ]) +
        `<p style="margin:18px 0 6px;"><strong>Come funziona</strong></p>` +
        `<p style="margin:4px 0;">1. Le unità sono già nel tuo saldo. Apri una gara e premi «Genera»: ogni gara usa una sola unità.</p>` +
        `<p style="margin:4px 0;">2. Non scadono: si esauriscono man mano che le usi, anche in più mesi. Le possono usare sia tu sia il tuo Ufficio Gare.</p>` +
        `<p style="margin:4px 0;">3. Se l'abbonamento a OMNIA AI cessa, le unità non ancora usate si perdono, come per i crediti aggiuntivi.</p>` +
        (d.linkCondizioni ? collegamento("Le condizioni del servizio che hai accettato", d.linkCondizioni) : "") +
        pulsante("Vai ai servizi aggiuntivi", d.linkServizi),
    }),
  };
}
