import {
  PIEDE_CLIENTE,
  PIEDE_UFFICIO,
  cornice,
  dataOra,
  esc,
  euro,
  giorno,
  linkStripe,
  nomeCliente,
  oggettoConProva,
  pulsante,
  collegamento,
  tabella,
  type ClienteEmail,
  type EmailPronta,
} from "@/lib/omnia-ai-email-eventi-calcoli";
import { REVISIONE, descriviFontePagine, testoScadenza, type FontePagine } from "@/lib/omnia-ai-revisione-calcoli";

// Le due email della revisione umana pagata: all'ufficio (con il Word della relazione in allegato, i dati
// aziendali principali e il referente) e la conferma al cliente.

export type AziendaRevisione = {
  ragioneSociale: string | null;
  formaGiuridica: string | null;
  partitaIva: string | null;
  codiceFiscale: string | null;
  indirizzo: string | null;
  codiceSdi: string | null;
  pec: string | null;
  numeroDipendenti: number | null;
  fatturatoMedioAnnuo: number | null;
  certificazioni: string | null;
  settoriAttivita: string | null;
  sitoWeb: string | null;
  telefonoAziendale: string | null;
  presentazione: string | null;
  referenze: string | null;
};

export type FatturazioneStripe = {
  nome: string | null;
  email: string | null;
  telefono: string | null;
  indirizzo: string | null;
  identificativiFiscali: string[];
};

export type ReferenteRevisione = { nome: string; email: string; cellulare: string };

function testoLungo(titolo: string, testo: string | null | undefined): string {
  const pulito = (testo ?? "").trim();
  if (!pulito) return "";
  return `<p style="margin:16px 0 4px;color:#6b7280;">${esc(titolo)}</p><div style="white-space:pre-wrap;background:#f6f7f9;border-radius:8px;padding:10px 12px;font-size:14px;">${esc(pulito)}</div>`;
}

function linkMail(email: string): { html: string } {
  return { html: `<a href="mailto:${esc(email)}" style="color:#4f46e5;">${esc(email)}</a>` };
}

function linkTel(numero: string): { html: string } {
  return { html: `<a href="tel:${esc(numero)}" style="color:#4f46e5;">${esc(numero)}</a>` };
}

export function emailUfficioRevisioneUmana(d: {
  prova: boolean;
  revisioneId: string;
  cliente: ClienteEmail;
  azienda: AziendaRevisione | null;
  fatturazione: FatturazioneStripe | null;
  garaTitolo: string;
  scadenza: string | null;
  // ora indicata dal bando («HH:MM»); null = non indicata (23:59)
  scadenzaOra: string | null;
  oreAllaScadenza: number | null;
  pagine: number;
  fontePagine: FontePagine;
  baseCentesimi: number;
  maggiorazionePercentuale: number;
  importoPagatoCentesimi: number;
  pagataIl: Date;
  referente: ReferenteRevisione;
  fileNome: string;
  stripePaymentIntentId: string | null;
  // per questa stessa relazione risulta già un altro pagamento (due schede di pagamento aperte insieme)
  pagamentoDoppio?: boolean;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const urgente = d.maggiorazionePercentuale > 0;
  const scadenza = testoScadenza(d.scadenza, d.scadenzaOra);
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
        ["Telefono aziendale", a.telefonoAziendale],
        ["Sito web", a.sitoWeb],
        ["Dipendenti", a.numeroDipendenti !== null ? String(a.numeroDipendenti) : null],
        ["Fatturato medio annuo", a.fatturatoMedioAnnuo !== null ? euro(Math.round(a.fatturatoMedioAnnuo * 100)) : null],
        ["Certificazioni", a.certificazioni],
        ["Settori di attività", a.settoriAttivita],
      ]
    : [];

  return {
    oggetto: oggettoConProva(`${d.pagamentoDoppio ? "PAGAMENTO DOPPIO — " : ""}${urgente ? "URGENTE — " : ""}Revisione umana richiesta: ${nome} — ${d.garaTitolo}${scadenza ? ` (gara in scadenza il ${scadenza})` : ""}`, d.prova),
    html: cornice({
      titolo: urgente ? `Revisione umana richiesta — URGENTE (+${d.maggiorazionePercentuale}%)` : "Revisione umana richiesta",
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        (d.pagamentoDoppio
          ? `<p style="background:#fde8e8;border:1px solid #f1a9a9;border-radius:8px;padding:8px 12px;font-size:14px;"><strong>Attenzione, pagamento doppio:</strong> per questa stessa relazione tecnica risulta già un altro pagamento. Verifica su Stripe e rimborsa il doppione.</p>`
          : "") +
        `<p><strong>${esc(nome)}</strong> ha pagato la revisione umana della relazione tecnica per la gara <strong>${esc(d.garaTitolo)}</strong>. Il file Word della relazione è in allegato (<em>${esc(d.fileNome)}</em>).</p>` +
        `<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin:14px 0;font-size:14px;">` +
        `<strong>Impegni presi con il cliente</strong><br>` +
        `• Contatto personale di un consulente entro <strong>${REVISIONE.oreContattoLavorative} ore lavorative</strong> dal pagamento (${esc(dataOra(d.pagataIl))}).<br>` +
        `• Relazione revisionata consegnata entro <strong>${REVISIONE.oreConsegna} ore</strong> dall'invio della richiesta.<br>` +
        `• La revisione comprende intestazione, piè di pagina e copertina grafica personalizzata.` +
        `</div>` +
        `<p style="margin:18px 0 0;color:#6b7280;">Referente da contattare</p>` +
        tabella([
          ["Nome", d.referente.nome],
          ["Email", linkMail(d.referente.email)],
          ["Cellulare", linkTel(d.referente.cellulare)],
        ]) +
        `<p style="margin:18px 0 0;color:#6b7280;">Gara</p>` +
        tabella([
          ["Titolo", d.garaTitolo],
          ["Scadenza", scadenza ? `${scadenza}${d.oreAllaScadenza !== null ? ` (mancavano circa ${Math.max(0, Math.round(d.oreAllaScadenza))} ore alla richiesta)` : ""}` : "non registrata"],
          ["Urgenza", urgente ? `maggiorazione del ${d.maggiorazionePercentuale}%` : "nessuna"],
        ]) +
        `<p style="margin:18px 0 0;color:#6b7280;">Prezzo</p>` +
        tabella([
          ["Pagine considerate", `${d.pagine} (${descriviFontePagine(d.fontePagine)})`],
          ["Prezzo di base", euro(d.baseCentesimi)],
          ["Maggiorazione per urgenza", urgente ? `+${d.maggiorazionePercentuale}% (${euro(d.importoPagatoCentesimi - d.baseCentesimi)})` : null],
          ["Pagato (IVA inclusa)", euro(d.importoPagatoCentesimi)],
          ["Data del pagamento", dataOra(d.pagataIl)],
        ]) +
        `<p style="margin:18px 0 0;color:#6b7280;">Dati aziendali</p>` +
        tabella([["Email dell'account", d.cliente.email], ...azienda]) +
        testoLungo("Presentazione dell'azienda", a?.presentazione) +
        testoLungo("Referenze", a?.referenze) +
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
        `<p style="color:#6b7280;font-size:12px;">Richiesta ${esc(d.revisioneId.slice(0, 8))}</p>`,
    }),
  };
}

export function emailClienteRevisioneRicevuta(d: {
  prova: boolean;
  garaTitolo: string;
  importoCentesimi: number;
  maggiorazionePercentuale: number;
  pagataIl: Date;
  referente: ReferenteRevisione;
  linkGara: string;
}): EmailPronta {
  return {
    oggetto: oggettoConProva("Richiesta di revisione umana ricevuta — OMNIA AI", d.prova),
    html: cornice({
      titolo: "Richiesta di revisione umana ricevuta",
      prova: d.prova,
      piede: PIEDE_CLIENTE,
      corpo:
        `<p>Gentile cliente, abbiamo ricevuto il tuo pagamento di <strong>${esc(euro(d.importoCentesimi))}</strong> (IVA inclusa) per la revisione umana della relazione tecnica della gara <strong>${esc(d.garaTitolo)}</strong>. Grazie.</p>` +
        tabella([
          ["Gara", d.garaTitolo],
          ["Importo", `${euro(d.importoCentesimi)}${d.maggiorazionePercentuale > 0 ? ` (comprende la maggiorazione per urgenza del ${d.maggiorazionePercentuale}%)` : ""}`],
          ["Data del pagamento", dataOra(d.pagataIl)],
          ["Referente da contattare", d.referente.nome],
          ["Email del referente", d.referente.email],
          ["Cellulare del referente", d.referente.cellulare],
        ]) +
        `<p style="margin:18px 0 6px;"><strong>Cosa succede adesso</strong></p>` +
        `<p style="margin:4px 0;">1. Entro <strong>${REVISIONE.oreContattoLavorative} ore lavorative</strong> un consulente umano contatta personalmente il referente indicato.</p>` +
        `<p style="margin:4px 0;">2. Entro <strong>${REVISIONE.oreConsegna} ore</strong> dall'invio della richiesta ricevi la relazione tecnica revisionata, completa di intestazione, piè di pagina e copertina grafica personalizzata.</p>` +
        `<p style="margin:4px 0;">3. Per non rallentare i tempi, tieni a portata di mano le informazioni utili alla revisione (logo, dati per intestazione e piè di pagina, indicazioni grafiche) e fai in modo che il referente sia raggiungibile.</p>` +
        pulsante("Torna alla gara", d.linkGara),
    }),
  };
}
