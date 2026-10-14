import { PACCHETTI_CREDITI, PIANI, PIANI_ORDINE, normalizzaPianoSlug, type PacchettoCreditiSlug } from "@/lib/omnia-ai-plans";

// Email automatiche di OMNIA AI legate agli eventi di Stripe. Qui solo le parti pure: quando
// inviare (rilevamento delle variazioni) e che cosa scrivere (testi). L'invio, il registro contro i
// doppioni e la lettura dei dati stanno in omnia-ai-email-eventi.ts e omnia-ai-email-webhook.ts.
//
// All'UFFICIO (ufficio@omniaitalia.com) arrivano solo gli eventi che richiedono attenzione: nuovo
// cliente, cambio piano (upgrade o downgrade), acquisto di crediti, disdetta, mancato pagamento.
// MAI i rinnovi andati a buon fine. Al CLIENTE: pagamento ricevuto (primo e rinnovi), disdetta
// confermata, cambio del metodo di pagamento.

export type EmailPronta = { oggetto: string; html: string };

// ───── formattazione ─────

export function esc(valore: string | null | undefined): string {
  return (valore ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function euro(centesimi: number): string {
  return `${(centesimi / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;
}

const FORMATO_GIORNO = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" });
const FORMATO_DATA_ORA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function giorno(quando: Date): string {
  return FORMATO_GIORNO.format(quando);
}

export function dataOra(quando: Date): string {
  return FORMATO_DATA_ORA.format(quando).replace(",", "");
}

// Stripe dà le date in secondi dall'epoca Unix.
export function daUnix(secondi: number | null | undefined): Date | null {
  return typeof secondi === "number" && Number.isFinite(secondi) ? new Date(secondi * 1000) : null;
}

export function nomePiano(slug: string | null | undefined): string {
  const normalizzato = normalizzaPianoSlug(slug);
  return normalizzato ? PIANI[normalizzato].nome : (slug?.trim() || "—");
}

export type DirezioneCambioPiano = "upgrade" | "downgrade" | "invariato" | "sconosciuto";

export function direzioneCambioPiano(da: string | null | undefined, a: string | null | undefined): DirezioneCambioPiano {
  const dal = normalizzaPianoSlug(da);
  const al = normalizzaPianoSlug(a);
  if (!dal || !al) return "sconosciuto";
  const differenza = PIANI_ORDINE.indexOf(al) - PIANI_ORDINE.indexOf(dal);
  return differenza > 0 ? "upgrade" : differenza < 0 ? "downgrade" : "invariato";
}

// Collegamento al pannello di Stripe (di prova o vero) per l'ufficio.
export function linkStripe(oggetto: "subscriptions" | "invoices" | "customers" | "payments", id: string, livemode: boolean): string {
  return `https://dashboard.stripe.com${livemode ? "" : "/test"}/${oggetto}/${encodeURIComponent(id)}`;
}

// ───── quando inviare ─────

export type AbbonamentoPrima = { plan: string | null; piano_programmato: string | null; cancel_at_period_end: boolean | null };

export type VariazioniAbbonamento = {
  cambioPiano: { direzione: "upgrade" | "downgrade"; da: string; a: string } | null;
  disdettaRichiesta: boolean;
};

// Confronta la riga locale PRIMA dell'aggiornamento con ciò che Stripe dichiara ora. Senza una riga
// precedente (abbonamento non ancora registrato) non si può dire che cosa sia cambiato: nessuna email.
export function rilevaVariazioniAbbonamento(prima: AbbonamentoPrima | null, nuovo: { plan: string | null; cancel_at_period_end: boolean }): VariazioniAbbonamento {
  if (!prima) return { cambioPiano: null, disdettaRichiesta: false };

  let cambioPiano: VariazioniAbbonamento["cambioPiano"] = null;
  const dal = normalizzaPianoSlug(prima.plan);
  const al = normalizzaPianoSlug(nuovo.plan);
  if (dal && al && dal !== al) {
    const direzione = direzioneCambioPiano(dal, al);
    // Un downgrade già programmato dall'area riservata è stato annunciato quando è stato richiesto:
    // quando scatta non si riscrive.
    const giaAnnunciato = direzione === "downgrade" && normalizzaPianoSlug(prima.piano_programmato) === al;
    if ((direzione === "upgrade" || direzione === "downgrade") && !giaAnnunciato) cambioPiano = { direzione, da: dal, a: al };
  }

  return { cambioPiano, disdettaRichiesta: !prima.cancel_at_period_end && nuovo.cancel_at_period_end };
}

// Un cambio piano programmato (downgrade) appena comparso: c'è un piano programmato nuovo e la riga
// locale non lo aveva ancora (o ne aveva un altro).
export function rilevaCambioProgrammato(
  prima: { plan: string | null; piano_programmato: string | null } | null,
  pianoProgrammatoNuovo: string | null,
): { direzione: "upgrade" | "downgrade" | "sconosciuto"; da: string; a: string } | null {
  if (!prima) return null;
  const a = normalizzaPianoSlug(pianoProgrammatoNuovo);
  const da = normalizzaPianoSlug(prima.plan);
  if (!a || !da || a === da) return null;
  if (normalizzaPianoSlug(prima.piano_programmato) === a) return null;
  const direzione = direzioneCambioPiano(da, a);
  return { direzione: direzione === "upgrade" ? "upgrade" : direzione === "downgrade" ? "downgrade" : "sconosciuto", da, a };
}

// Mancato pagamento: solo per un abbonamento che NON è in disdetta (una disdetta non genera rinnovi) e
// non per il primo pagamento (se fallisce il checkout non diventa mai un abbonamento).
export function deveAvvisareMancatoPagamento(prima: { cancel_at_period_end: boolean | null } | null, motivoFattura: string | null | undefined): boolean {
  if (motivoFattura === "subscription_create") return false;
  return !(prima?.cancel_at_period_end ?? false);
}

// Cambio del metodo di pagamento da un evento «customer.updated» o «customer.subscription.updated»:
// il nuovo metodo, solo se prima ce n'era un altro (la prima impostazione, nel checkout, non è un cambio).
export function nuovoMetodoDaCliente(
  attuale: { invoice_settings?: { default_payment_method?: string | { id: string } | null } | null },
  precedenti: { invoice_settings?: { default_payment_method?: string | { id: string } | null } | null } | null | undefined,
): string | null {
  const prima = precedenti?.invoice_settings;
  if (!prima || !("default_payment_method" in prima)) return null;
  const idPrima = idDa(prima.default_payment_method);
  const idOra = idDa(attuale.invoice_settings?.default_payment_method);
  return idPrima && idOra && idPrima !== idOra ? idOra : null;
}

export function nuovoMetodoDaAbbonamento(
  attuale: { default_payment_method?: string | { id: string } | null },
  precedenti: { default_payment_method?: string | { id: string } | null } | null | undefined,
): string | null {
  if (!precedenti || !("default_payment_method" in precedenti)) return null;
  const idPrima = idDa(precedenti.default_payment_method);
  const idOra = idDa(attuale.default_payment_method);
  return idPrima && idOra && idPrima !== idOra ? idOra : null;
}

function idDa(valore: string | { id: string } | null | undefined): string | null {
  return typeof valore === "string" ? valore : (valore?.id ?? null);
}

// ───── come si presentano ─────

export type ClienteEmail = { email: string | null; nome: string | null; partitaIva?: string | null; codiceFiscale?: string | null };

export function nomeCliente(c: ClienteEmail): string {
  return c.nome?.trim() || c.email?.trim() || "cliente non identificato";
}

export function oggettoConProva(oggetto: string, prova: boolean): string {
  return prova ? `[PROVA] ${oggetto}` : oggetto;
}

export function tabella(righe: [string, string | { html: string } | null | undefined][]): string {
  const celle = righe
    .filter(([, valore]) => valore !== null && valore !== undefined && valore !== "" && !(typeof valore === "object" && !valore.html))
    .map(
      ([etichetta, valore]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap;">${esc(etichetta)}</td><td style="padding:6px 0;font-weight:600;">${typeof valore === "object" ? (valore as { html: string }).html : esc(valore as string)}</td></tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse;margin:12px 0 4px;">${celle}</table>`;
}

export function pulsante(testo: string, url: string): string {
  return `<p style="margin:20px 0;"><a href="${esc(url)}" style="background:#6d5dfc;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block;">${esc(testo)}</a></p>`;
}

export function collegamento(testo: string, url: string): string {
  return `<p style="margin:12px 0;"><a href="${esc(url)}" style="color:#4f46e5;">${esc(testo)}</a></p>`;
}

export function cornice({ titolo, corpo, prova, piede }: { titolo: string; corpo: string; prova: boolean; piede: string }): string {
  const avvisoProva = prova
    ? `<p style="background:#fff4d6;border:1px solid #f0d58a;border-radius:8px;padding:8px 12px;font-size:13px;margin:16px 0;">Evento dell'account Stripe di PROVA: nessun addebito reale.</p>`
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2430;line-height:1.55;font-size:15px;">
<div style="padding:14px 0;border-bottom:2px solid #6d5dfc;font-weight:700;font-size:18px;letter-spacing:0.5px;">OMNIA AI</div>
${avvisoProva}<h2 style="font-size:19px;margin:22px 0 10px;">${esc(titolo)}</h2>
${corpo}
<p style="color:#6b7280;font-size:12px;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;">${esc(piede)}</p>
</div>`;
}

export const PIEDE_UFFICIO = "Email automatica generata dagli eventi di Stripe di OMNIA AI.";
export const PIEDE_CLIENTE = "Questa è una email automatica: non rispondere a questo indirizzo. Per assistenza usa la pagina Supporto della tua area riservata.";

// ───── email all'ufficio ─────

export function emailUfficioNuovoCliente(d: {
  prova: boolean;
  primoAbbonamento: boolean;
  cliente: ClienteEmail;
  piano: string;
  importoCentesimi: number | null;
  quando: Date;
  accountNuovo: boolean;
  creatoDaConsole: boolean;
  pilot: boolean;
  stripeSubscriptionId: string;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const titolo = d.primoAbbonamento ? "Nuovo cliente OMNIA AI" : "Nuovo abbonamento OMNIA AI (cliente già registrato)";
  return {
    oggetto: oggettoConProva(`${titolo}: ${nome} — piano ${nomePiano(d.piano)}`, d.prova),
    html: cornice({
      titolo,
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        `<p><strong>${esc(nome)}</strong> ha sottoscritto l'abbonamento OMNIA AI, piano <strong>${esc(nomePiano(d.piano))}</strong>.</p>` +
        tabella([
          ["Cliente", d.cliente.nome],
          ["Email", d.cliente.email],
          ["Partita IVA", d.cliente.partitaIva],
          ["Codice fiscale", d.cliente.codiceFiscale],
          ["Piano", nomePiano(d.piano)],
          ["Importo pagato (IVA inclusa)", d.importoCentesimi !== null ? euro(d.importoCentesimi) : null],
          ["Data", dataOra(d.quando)],
          ["Account", d.accountNuovo ? "nuovo, creato con questo acquisto" : "già esistente"],
          ["Creato dalla console", d.creatoDaConsole ? "sì" : null],
          ["Offerta pilot", d.pilot ? "sì (prezzo dedicato)" : null],
        ]) +
        collegamento("Apri l'abbonamento su Stripe", linkStripe("subscriptions", d.stripeSubscriptionId, !d.prova)),
    }),
  };
}

export function emailUfficioCambioPiano(d: {
  prova: boolean;
  cliente: ClienteEmail;
  direzione: "upgrade" | "downgrade" | "sconosciuto";
  da: string;
  a: string;
  // vale solo per un cambio programmato: da quando
  dal: Date | null;
  programmato: boolean;
  stripeSubscriptionId: string;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const etichetta = d.direzione === "upgrade" ? "Upgrade" : d.direzione === "downgrade" ? "Downgrade" : "Cambio piano";
  const dal = d.dal ? giorno(d.dal) : null;
  const frase = d.programmato
    ? `<strong>${esc(nome)}</strong> ha chiesto il passaggio dal piano <strong>${esc(nomePiano(d.da))}</strong> al piano <strong>${esc(nomePiano(d.a))}</strong>${dal ? `, che scatterà il <strong>${esc(dal)}</strong>` : ""}. Fino ad allora resta sul piano ${esc(nomePiano(d.da))}.`
    : d.direzione === "downgrade"
      ? `<strong>${esc(nome)}</strong> è passato dal piano <strong>${esc(nomePiano(d.da))}</strong> al piano <strong>${esc(nomePiano(d.a))}</strong>. Il cambio non risultava programmato dall'area riservata: è stato fatto direttamente su Stripe.`
      : `<strong>${esc(nome)}</strong> è passato dal piano <strong>${esc(nomePiano(d.da))}</strong> al piano <strong>${esc(nomePiano(d.a))}</strong>. Il passaggio è immediato; il conguaglio viene addebitato subito.`;
  return {
    oggetto: oggettoConProva(`${etichetta} OMNIA AI: ${nome} da ${nomePiano(d.da)} a ${nomePiano(d.a)}${d.programmato && dal ? ` (dal ${dal})` : ""}`, d.prova),
    html: cornice({
      titolo: d.programmato ? `${etichetta} programmato` : etichetta,
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        `<p>${frase}</p>` +
        tabella([
          ["Cliente", d.cliente.nome],
          ["Email", d.cliente.email],
          ["Piano attuale", nomePiano(d.da)],
          [d.programmato ? "Piano dal cambio" : "Nuovo piano", nomePiano(d.a)],
          ["Decorrenza", d.programmato ? dal : "immediata"],
        ]) +
        collegamento("Apri l'abbonamento su Stripe", linkStripe("subscriptions", d.stripeSubscriptionId, !d.prova)),
    }),
  };
}

export function emailUfficioCreditiAcquistati(d: {
  prova: boolean;
  cliente: ClienteEmail;
  pacchetto: string;
  crediti: number;
  importoCentesimi: number;
  quando: Date;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const nomePacchetto = nomePacchettoCrediti(d.pacchetto);
  return {
    oggetto: oggettoConProva(`Acquisto crediti OMNIA AI: ${nome} — ${nomePacchetto}`, d.prova),
    html: cornice({
      titolo: "Acquisto di crediti",
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        `<p><strong>${esc(nome)}</strong> ha acquistato <strong>${esc(nomePacchetto)}</strong> (${d.crediti} ${d.crediti === 1 ? "gara" : "gare"}).</p>` +
        tabella([
          ["Cliente", d.cliente.nome],
          ["Email", d.cliente.email],
          ["Pacchetto", nomePacchetto],
          ["Crediti aggiunti", String(d.crediti)],
          ["Importo pagato (IVA inclusa)", euro(d.importoCentesimi)],
          ["Data", dataOra(d.quando)],
        ]),
    }),
  };
}

export function emailUfficioDisdetta(d: {
  prova: boolean;
  cliente: ClienteEmail;
  piano: string | null;
  fineIl: Date | null;
  stripeSubscriptionId: string;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const fine = d.fineIl ? giorno(d.fineIl) : null;
  return {
    oggetto: oggettoConProva(`Disdetta abbonamento OMNIA AI: ${nome}${fine ? ` (attivo fino al ${fine})` : ""}`, d.prova),
    html: cornice({
      titolo: "Disdetta dell'abbonamento",
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        `<p><strong>${esc(nome)}</strong> ha disdetto l'abbonamento OMNIA AI${d.piano ? ` (piano <strong>${esc(nomePiano(d.piano))}</strong>)` : ""}. Il servizio resta attivo fino al termine del periodo già pagato${fine ? `, il <strong>${esc(fine)}</strong>` : ""}; da quella data non si rinnova.</p>` +
        tabella([
          ["Cliente", d.cliente.nome],
          ["Email", d.cliente.email],
          ["Piano", d.piano ? nomePiano(d.piano) : null],
          ["Attivo fino al", fine],
        ]) +
        collegamento("Apri l'abbonamento su Stripe", linkStripe("subscriptions", d.stripeSubscriptionId, !d.prova)),
    }),
  };
}

export function emailUfficioMancatoPagamento(d: {
  prova: boolean;
  cliente: ClienteEmail;
  piano: string | null;
  importoCentesimi: number;
  tentativo: number | null;
  prossimoTentativo: Date | null;
  // true all'ultimo tentativo: Stripe non riprova più
  definitivo: boolean;
  motivoFattura: string | null;
  stripeInvoiceId: string;
}): EmailPronta {
  const nome = nomeCliente(d.cliente);
  const che = d.motivoFattura === "subscription_update" ? "Il conguaglio del cambio di piano" : "Il rinnovo dell'abbonamento";
  const titolo = d.definitivo ? "Mancato pagamento: ultimo tentativo fallito" : "Mancato pagamento";
  const prossimo = d.prossimoTentativo ? dataOra(d.prossimoTentativo) : null;
  const frase = d.definitivo
    ? `${che} di <strong>${esc(nome)}</strong> non è andato a buon fine e Stripe <strong>non riproverà più</strong> ad addebitarlo. L'abbonamento non risulta in disdetta: verifica lo stato su Stripe e contatta il cliente.`
    : `${che} di <strong>${esc(nome)}</strong> non è andato a buon fine. L'abbonamento è ancora attivo e senza disdetta.${prossimo ? ` Stripe riproverà ad addebitare il <strong>${esc(prossimo)}</strong>.` : ""}`;
  return {
    oggetto: oggettoConProva(`${titolo}: ${nome}${d.definitivo ? "" : " — rinnovo non riuscito"}`, d.prova),
    html: cornice({
      titolo,
      prova: d.prova,
      piede: PIEDE_UFFICIO,
      corpo:
        `<p>${frase}</p>` +
        tabella([
          ["Cliente", d.cliente.nome],
          ["Email", d.cliente.email],
          ["Piano", d.piano ? nomePiano(d.piano) : null],
          ["Importo non incassato", euro(d.importoCentesimi)],
          ["Tentativo", d.tentativo !== null ? String(d.tentativo) : null],
          ["Prossimo tentativo", d.definitivo ? "nessuno" : prossimo],
        ]) +
        collegamento("Apri la fattura su Stripe", linkStripe("invoices", d.stripeInvoiceId, !d.prova)),
    }),
  };
}

export function nomePacchettoCrediti(slug: string): string {
  return slug in PACCHETTI_CREDITI ? PACCHETTI_CREDITI[slug as PacchettoCreditiSlug].nome : slug;
}

// ───── email al cliente ─────

export type TipoPagamentoCliente = "primo" | "rinnovo" | "conguaglio" | "crediti" | "altro";

export function emailClientePagamentoRicevuto(d: {
  prova: boolean;
  tipo: TipoPagamentoCliente;
  piano: string | null;
  // per i crediti: nome del pacchetto
  pacchetto?: string | null;
  importoCentesimi: number;
  pagatoIl: Date;
  periodoDal: Date | null;
  periodoAl: Date | null;
  linkPagamenti: string;
}): EmailPronta {
  const piano = d.piano ? nomePiano(d.piano) : null;
  const descrizione =
    d.tipo === "crediti"
      ? `Acquisto crediti${d.pacchetto ? ` — ${nomePacchettoCrediti(d.pacchetto)}` : ""}`
      : d.tipo === "conguaglio"
        ? "Conguaglio per il cambio di piano dell'abbonamento OMNIA AI"
        : `Abbonamento OMNIA AI${piano ? ` — piano ${piano}` : ""}${d.tipo === "primo" ? " (primo pagamento)" : d.tipo === "rinnovo" ? " (rinnovo)" : ""}`;
  const periodo = d.tipo !== "conguaglio" && d.tipo !== "crediti" && d.periodoDal && d.periodoAl ? `dal ${giorno(d.periodoDal)} al ${giorno(d.periodoAl)}` : null;
  return {
    oggetto: oggettoConProva(d.tipo === "crediti" ? "Pagamento ricevuto — acquisto crediti OMNIA AI" : "Pagamento ricevuto — abbonamento OMNIA AI", d.prova),
    html: cornice({
      titolo: "Pagamento ricevuto",
      prova: d.prova,
      piede: PIEDE_CLIENTE,
      corpo:
        `<p>Gentile cliente, abbiamo ricevuto il tuo pagamento di <strong>${esc(euro(d.importoCentesimi))}</strong> (IVA inclusa). Grazie.</p>` +
        tabella([
          ["Descrizione", descrizione],
          ["Periodo", periodo],
          ["Importo", euro(d.importoCentesimi)],
          ["Data del pagamento", dataOra(d.pagatoIl)],
        ]) +
        `<p>Trovi i tuoi pagamenti nella pagina <strong>Pagamenti e fatture</strong> della tua area riservata. La fattura è un documento a parte: la trovi in quella pagina quando viene emessa.</p>` +
        pulsante("Vai a Pagamenti e fatture", d.linkPagamenti),
    }),
  };
}

export function emailClienteDisdettaConfermata(d: { prova: boolean; piano: string | null; fineIl: Date | null; linkAbbonamento: string }): EmailPronta {
  const fine = d.fineIl ? giorno(d.fineIl) : null;
  return {
    oggetto: oggettoConProva("Disdetta dell'abbonamento OMNIA AI confermata", d.prova),
    html: cornice({
      titolo: "Disdetta confermata",
      prova: d.prova,
      piede: PIEDE_CLIENTE,
      corpo:
        `<p>Gentile cliente, abbiamo registrato la disdetta del tuo abbonamento OMNIA AI${d.piano ? ` (piano <strong>${esc(nomePiano(d.piano))}</strong>)` : ""}.</p>` +
        `<p>Il servizio resta attivo ${fine ? `fino al <strong>${esc(fine)}</strong>` : "fino al termine del periodo già pagato"}, comprese le gare residue del piano. Da quella data l'abbonamento non si rinnova e non ti verrà addebitato più nulla.</p>` +
        `<p>Dopo la fine dell'abbonamento, per 30 giorni puoi ancora consultare e scaricare i tuoi documenti (sola lettura); poi i contenuti vengono cancellati. I crediti aggiuntivi residui si estinguono con la cessazione, senza rimborso.</p>` +
        `<p>Se cambi idea, potrai riattivare il servizio in qualsiasi momento dalla pagina Abbonamento.</p>` +
        pulsante("Vai ad Abbonamento", d.linkAbbonamento),
    }),
  };
}

export function emailClienteMetodoPagamento(d: { prova: boolean; metodo: string | null; linkAbbonamento: string }): EmailPronta {
  return {
    oggetto: oggettoConProva("Metodo di pagamento OMNIA AI aggiornato", d.prova),
    html: cornice({
      titolo: "Metodo di pagamento aggiornato",
      prova: d.prova,
      piede: PIEDE_CLIENTE,
      corpo:
        `<p>Gentile cliente, abbiamo registrato il cambio del metodo di pagamento del tuo abbonamento OMNIA AI.</p>` +
        (d.metodo ? `<p>I prossimi addebiti avverranno su: <strong>${esc(d.metodo)}</strong>.</p>` : `<p>I prossimi addebiti avverranno sul nuovo metodo di pagamento.</p>`) +
        `<p>Se non sei stato tu a fare questa modifica, contattaci subito dalla pagina Supporto della tua area riservata.</p>` +
        pulsante("Vai ad Abbonamento", d.linkAbbonamento),
    }),
  };
}

// «Visa •••• 4242, scade 12/2030» da una carta di Stripe.
export function descriviMetodo(carta: { brand?: string | null; last4?: string | null; exp_month?: number | null; exp_year?: number | null } | null | undefined): string | null {
  if (!carta?.last4) return null;
  const marca = carta.brand ? carta.brand.charAt(0).toUpperCase() + carta.brand.slice(1) : "Carta";
  const scadenza = carta.exp_month && carta.exp_year ? `, scade ${String(carta.exp_month).padStart(2, "0")}/${carta.exp_year}` : "";
  return `${marca} •••• ${carta.last4}${scadenza}`;
}
