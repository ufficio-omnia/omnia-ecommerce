import { dataRoma } from "./giorni-lavorativi";
import { giorniTra } from "./periodo";

// Calcoli puri (nessun database) per la pagina "Da fatturare": importi, dati di
// fatturazione del cliente, testo da copiare, esportazione CSV.
//
// Le ricevute di Stripe non sono fatture elettroniche italiane: ogni incasso
// degli abbonamenti OMNIA AI e ogni acquisto di crediti va fatturato a parte.
// Questa pagina è l'elenco di cosa fare, con tutto ciò che serve a emettere la
// fattura (importi, dati del cliente) e lo stato segnato a mano.

export type StatoFattura = "da_fatturare" | "fatturata" | "non_dovuta";
export const STATI_FATTURA: StatoFattura[] = ["da_fatturare", "fatturata", "non_dovuta"];

export type FonteRiga = "incasso" | "crediti" | "revisione";

// Giorni dall'incasso oltre i quali la riga è segnalata. È il termine ORDINARIO
// indicativo per l'emissione della fattura immediata, non un consiglio fiscale:
// va confermato col commercialista (cambia se la fattura è differita).
export const GIORNI_TERMINE_INDICATIVO = 12;

// ───── Importi ─────

function arrotonda(valore: number): number {
  return Math.round(valore * 100) / 100;
}

export type Importi = { lordo: number; imponibile: number; iva: number; ivaDaStripe: boolean };

// Imponibile e IVA di un importo IVA inclusa. Se Stripe ha calcolato le imposte
// (imposta > 0) si usano le sue; altrimenti si scorpora con l'aliquota dei
// parametri. L'IVA è sempre lordo - imponibile: i due arrotondati sommano
// esattamente al lordo, come serve in una fattura.
export function calcolaImporti(lordo: number, impostaStripe: number | null, imponibileStripe: number | null, aliquotaIva: number): Importi {
  const totale = arrotonda(lordo);
  if (impostaStripe !== null && impostaStripe > 0) {
    const imponibile = arrotonda(imponibileStripe ?? totale - impostaStripe);
    return { lordo: totale, imponibile, iva: arrotonda(totale - imponibile), ivaDaStripe: true };
  }
  const imponibile = arrotonda(totale / (1 + aliquotaIva / 100));
  return { lordo: totale, imponibile, iva: arrotonda(totale - imponibile), ivaDaStripe: false };
}

// ───── Dati di fatturazione del cliente ─────

export type ProfiloFatturazione = {
  ragione_sociale: string | null;
  partita_iva: string | null;
  codice_fiscale: string | null;
  indirizzo: string | null;
  codice_sdi: string | null;
  pec: string | null;
  buyer_type: string | null;
};

// Come lo salva src/lib/omnia-ai-incassi.ts dal cliente di Stripe.
export type SnapshotStripe = {
  nome?: string | null;
  email?: string | null;
  indirizzo?: { riga1?: string | null; riga2?: string | null; cap?: string | null; citta?: string | null; provincia?: string | null; paese?: string | null } | null;
  identificativi_fiscali?: { tipo: string; valore: string }[] | null;
} | null;

export type DatiFatturazione = {
  // da dove arrivano i dati: il profilo azienda del cliente, il cliente di Stripe, o entrambi
  fonte: "profilo" | "stripe" | "profilo+stripe" | "nessuna";
  tipoCliente: "azienda" | "consumatore" | null;
  ragioneSociale: string | null;
  partitaIva: string | null;
  codiceFiscale: string | null;
  indirizzo: string | null;
  codiceSdi: string | null;
  pec: string | null;
  email: string | null;
  // ciò che serve per fatturare e non c'è
  mancanti: string[];
};

function testo(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function indirizzoDaStripe(a: NonNullable<SnapshotStripe>["indirizzo"]): string | null {
  if (!a) return null;
  const via = [testo(a.riga1), testo(a.riga2)].filter(Boolean).join(", ");
  const localita = [testo(a.cap), testo(a.citta)].filter(Boolean).join(" ");
  const provincia = testo(a.provincia);
  const parti = [via, [localita, provincia ? `(${provincia})` : null].filter(Boolean).join(" "), testo(a.paese)].filter((p) => p && p.length > 0);
  return parti.length > 0 ? parti.join(", ") : null;
}

// Il profilo del cliente (companies) ha la precedenza; i campi che mancano si
// completano con quelli raccolti da Stripe al pagamento. La fonte dice quali
// hanno contribuito, così si sa di quali dati ci si può fidare di più.
export function risolviDatiFatturazione(profilo: ProfiloFatturazione | null, snapshot: SnapshotStripe, emailUtente: string | null): DatiFatturazione {
  const fiscali = snapshot?.identificativi_fiscali ?? [];
  const stripePiva = testo(fiscali.find((f) => /vat/i.test(f.tipo))?.valore);
  const stripeCf = testo(fiscali.find((f) => /(^|_)cf$|fiscal/i.test(f.tipo))?.valore);

  const dalProfilo = {
    ragioneSociale: testo(profilo?.ragione_sociale),
    partitaIva: testo(profilo?.partita_iva),
    codiceFiscale: testo(profilo?.codice_fiscale),
    indirizzo: testo(profilo?.indirizzo),
    codiceSdi: testo(profilo?.codice_sdi),
    pec: testo(profilo?.pec),
  };
  const daStripe = {
    ragioneSociale: testo(snapshot?.nome),
    partitaIva: stripePiva,
    codiceFiscale: stripeCf,
    indirizzo: indirizzoDaStripe(snapshot?.indirizzo),
  };

  const scelta = <K extends keyof typeof daStripe>(chiave: K) => ({
    valore: dalProfilo[chiave] ?? daStripe[chiave],
    daProfilo: dalProfilo[chiave] !== null,
    daStripe: dalProfilo[chiave] === null && daStripe[chiave] !== null,
  });

  const campi = {
    ragioneSociale: scelta("ragioneSociale"),
    partitaIva: scelta("partitaIva"),
    codiceFiscale: scelta("codiceFiscale"),
    indirizzo: scelta("indirizzo"),
  };
  const usaProfilo = Object.values(campi).some((c) => c.daProfilo) || dalProfilo.codiceSdi !== null || dalProfilo.pec !== null;
  const usaStripe = Object.values(campi).some((c) => c.daStripe);

  const tipoCliente = profilo?.buyer_type === "consumatore" ? "consumatore" : profilo?.buyer_type === "azienda" ? "azienda" : null;

  const dati: DatiFatturazione = {
    fonte: usaProfilo && usaStripe ? "profilo+stripe" : usaProfilo ? "profilo" : usaStripe ? "stripe" : "nessuna",
    tipoCliente,
    ragioneSociale: campi.ragioneSociale.valore,
    partitaIva: campi.partitaIva.valore,
    codiceFiscale: campi.codiceFiscale.valore,
    indirizzo: campi.indirizzo.valore,
    codiceSdi: dalProfilo.codiceSdi,
    pec: dalProfilo.pec,
    email: testo(snapshot?.email) ?? testo(emailUtente),
    mancanti: [],
  };

  if (!dati.ragioneSociale) dati.mancanti.push("ragione sociale");
  if (!dati.partitaIva && !dati.codiceFiscale) dati.mancanti.push("partita IVA o codice fiscale");
  if (!dati.indirizzo) dati.mancanti.push("indirizzo");
  // un privato non ha bisogno del canale telematico (si usa il codice 0000000): un'azienda sì
  if (tipoCliente !== "consumatore" && !dati.codiceSdi && !dati.pec) dati.mancanti.push("codice SDI o PEC");
  return dati;
}

// ───── Riga dell'elenco ─────

export type RigaFatturazione = {
  // "incasso:<uuid>", "crediti:<uuid>" o "revisione:<uuid>": identifica la riga nella tabella giusta
  chiave: string;
  fonte: FonteRiga;
  // istante dell'incasso
  data: string;
  descrizione: string;
  userId: string | null;
  // come mostrare il cliente: ragione sociale, altrimenti email
  cliente: string;
  importi: Importi;
  prova: boolean;
  stato: StatoFattura;
  numeroFattura: string | null;
  dataFattura: string | null;
  note: string | null;
  // il PDF della fattura è stato caricato (il cliente lo scarica dalla sua area riservata)
  fatturaFile: boolean;
  numeroRicevuta: string | null;
  ricevutaUrl: string | null;
  dati: DatiFatturazione;
  // giorni di calendario dall'incasso a oggi
  giorni: number;
  // identificativo Stripe (fattura o sessione), per ritrovare il pagamento
  idStripe: string | null;
};

export function giorniDallIncasso(data: string, adesso: Date): number {
  return Math.max(0, giorniTra(dataRoma(new Date(data)), dataRoma(adesso)));
}

export function descrizioneIncasso(tipo: string, piano: string | null): string {
  const nomePiano = piano ? ` ${piano.charAt(0).toUpperCase()}${piano.slice(1)}` : "";
  const dettaglio: Record<string, string> = { primo: "primo pagamento", rinnovo: "rinnovo", conguaglio: "conguaglio per cambio piano" };
  return `Abbonamento OMNIA AI${nomePiano}${dettaglio[tipo] ? `: ${dettaglio[tipo]}` : ""}`;
}

// I dati di fatturazione raccolti da Stripe nel pagamento di una revisione umana (customer_details del checkout).
export type DettagliClienteStripe = {
  name?: string | null;
  business_name?: string | null;
  email?: string | null;
  address?: { line1?: string | null; line2?: string | null; postal_code?: string | null; city?: string | null; state?: string | null; country?: string | null } | null;
  tax_ids?: { type?: string | null; value?: string | null }[] | null;
} | null;

export function snapshotDaDettagliStripe(d: DettagliClienteStripe | undefined): SnapshotStripe {
  if (!d) return null;
  const a = d.address;
  return {
    nome: testo(d.name) ?? testo(d.business_name),
    email: testo(d.email),
    indirizzo: a ? { riga1: testo(a.line1), riga2: testo(a.line2), cap: testo(a.postal_code), citta: testo(a.city), provincia: testo(a.state), paese: testo(a.country) } : null,
    identificativi_fiscali: (d.tax_ids ?? []).flatMap((t) => (t.value ? [{ tipo: t.type ?? "", valore: t.value }] : [])),
  };
}

export function descrizioneRevisioneRiga(garaTitolo: string, pagine: number, maggiorazionePercentuale: number): string {
  const urgenza = maggiorazionePercentuale > 0 ? `, urgenza +${maggiorazionePercentuale}%` : "";
  return `Revisione umana relazione tecnica — ${garaTitolo} (${pagine} ${pagine === 1 ? "pagina" : "pagine"}${urgenza})`;
}

export function descrizioneCrediti(pacchetto: string, crediti: number): string {
  return pacchetto === "pacchetto5" ? "Pacchetto 5 gare OMNIA AI" : `Credito OMNIA AI (${crediti} ${crediti === 1 ? "gara" : "gare"})`;
}

export function contaPerStato(righe: RigaFatturazione[]): Record<StatoFattura | "tutte", number> {
  return {
    da_fatturare: righe.filter((r) => r.stato === "da_fatturare").length,
    fatturata: righe.filter((r) => r.stato === "fatturata").length,
    non_dovuta: righe.filter((r) => r.stato === "non_dovuta").length,
    tutte: righe.length,
  };
}

export type FiltroFattura = StatoFattura | "tutte";

// La scheda che si apre se l'URL non ne indica una. Con i dati di prova INCLUSI è
// «Tutte»: i pagamenti di prova nascono «non dovuti», quindi nella scheda «Da
// fatturare» non comparirebbero mai e premere «Inclusi» sembrerebbe non fare nulla.
export function filtroPredefinito(includiProva: boolean): FiltroFattura {
  return includiProva ? "tutte" : "da_fatturare";
}

export function leggiFiltroFattura(valore: string | undefined, includiProva = false): FiltroFattura {
  return valore === "da_fatturare" || valore === "fatturata" || valore === "non_dovuta" || valore === "tutte" ? valore : filtroPredefinito(includiProva);
}

// ───── Testo da copiare nel programma di fatturazione ─────

export function testoDaCopiare(r: RigaFatturazione): string {
  const euro = (n: number) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = r.dati;
  return [
    d.ragioneSociale ?? "(ragione sociale mancante)",
    d.partitaIva ? `P.IVA ${d.partitaIva}` : null,
    d.codiceFiscale ? `C.F. ${d.codiceFiscale}` : null,
    d.indirizzo,
    d.codiceSdi ? `Codice destinatario (SDI): ${d.codiceSdi}` : d.tipoCliente === "consumatore" ? "Codice destinatario (SDI): 0000000" : null,
    d.pec ? `PEC: ${d.pec}` : null,
    d.email ? `Email: ${d.email}` : null,
    "",
    r.descrizione,
    `Imponibile € ${euro(r.importi.imponibile)} · IVA € ${euro(r.importi.iva)} · Totale € ${euro(r.importi.lordo)}`,
    `Incassato il ${dataRoma(new Date(r.data)).split("-").reverse().join("/")}`,
  ]
    .filter((riga): riga is string => riga !== null)
    .join("\n");
}

// ───── Esportazione CSV ─────

// Una cella CSV sicura. Il nome o l'indirizzo di un cliente li ha scritti il
// cliente: se cominciano per = + - @ (o tab/ritorno a capo) Excel li eseguirebbe
// come formula ("CSV injection"), quindi si neutralizzano con un apice. Le
// celle con separatore, virgolette o a capo si racchiudono tra virgolette.
export function csvCella(valore: string | number | null | undefined): string {
  if (valore === null || valore === undefined) return "";
  let testoCella = typeof valore === "number" ? String(valore).replace(".", ",") : valore;
  if (/^[=+\-@\t\r]/.test(testoCella)) testoCella = `'${testoCella}`;
  return /[;"\n\r]/.test(testoCella) ? `"${testoCella.replace(/"/g, '""')}"` : testoCella;
}

const INTESTAZIONI_CSV = [
  "Data incasso", "Descrizione", "Ragione sociale", "Partita IVA", "Codice fiscale", "Indirizzo", "Codice SDI", "PEC", "Email",
  "Imponibile", "IVA", "Totale", "Stato", "Numero fattura", "Data fattura", "Note", "Dati da", "Dati mancanti", "Id Stripe",
];

// Separatore ";" e decimali con la virgola (come si aspetta Excel in italiano),
// codifica UTF-8 con BOM perché gli accenti si leggano bene.
export function costruisciCsv(righe: RigaFatturazione[]): string {
  const data = (iso: string) => dataRoma(new Date(iso)).split("-").reverse().join("/");
  const righeCsv = righe.map((r) =>
    [
      data(r.data), r.descrizione, r.dati.ragioneSociale, r.dati.partitaIva, r.dati.codiceFiscale, r.dati.indirizzo, r.dati.codiceSdi, r.dati.pec, r.dati.email,
      r.importi.imponibile.toFixed(2).replace(".", ","), r.importi.iva.toFixed(2).replace(".", ","), r.importi.lordo.toFixed(2).replace(".", ","),
      r.stato.replace("_", " "), r.numeroFattura, r.dataFattura ? r.dataFattura.split("-").reverse().join("/") : null, r.note, r.dati.fonte, r.dati.mancanti.join(", "), r.idStripe,
    ]
      .map(csvCella)
      .join(";"),
  );
  return `﻿${[INTESTAZIONI_CSV.join(";"), ...righeCsv].join("\r\n")}\r\n`;
}
