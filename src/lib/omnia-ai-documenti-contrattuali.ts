import { SLUG_PER_TIPO_DB, TITOLO_PER_TIPO_DB } from "./legal-documenti";
import type { ValoriSegnaposto } from "./legal-markdown";
import { normalizzaPianoSlug } from "./omnia-ai-plans";

// Calcoli puri (nessun database) per la sezione «Documenti contrattuali» dell'area
// riservata di OMNIA AI: quali documenti il cliente ha accettato per ciascun
// abbonamento, in quale versione e quando, più i dati con cui compilare l'Allegato A.

export type AccettazioneDb = { subscription_id: string; acceptance_type: string; accepted_at: string; legal_document_id: string };
export type DocumentoLegaleDb = { id: string; document_type: string; version: number; effective_date: string };
export type AbbonamentoDb = { id: string; plan: string; created_at: string; stripe_subscription_id: string | null };

export type DocumentoAccettato = {
  documentoId: string;
  tipoDb: string;
  slug: string;
  titolo: string;
  versione: number;
  // istante dell'accettazione (ISO); la prima registrata per questo documento
  accettatoIl: string;
};

// La cookie policy non si accetta nel checkout (il consenso ai cookie è un'altra cosa): si
// mostra la versione che era in vigore quando il cliente ha attivato l'abbonamento.
export type CookieInVigore = { slug: string; titolo: string; versione: number; inVigoreDal: string };

export type GruppoAccettazioni = {
  abbonamentoId: string;
  piano: string;
  creatoIl: string;
  // abbonamento creato dal fornitore, senza checkout: non ha accettazioni da mostrare
  manuale: boolean;
  documenti: DocumentoAccettato[];
  cookie: CookieInVigore | null;
};

// Ordine di presentazione: prima il contratto, poi l'atto di nomina, poi l'informativa.
const ORDINE_TIPI = ["omnia_ai_condizioni_abbonamento", "omnia_ai_allegato_a", "omnia_ai_privacy_policy"];

function posizione(tipo: string): number {
  const i = ORDINE_TIPI.indexOf(tipo);
  return i === -1 ? ORDINE_TIPI.length : i;
}

// Cookie policy in vigore al giorno indicato: la effective_date più recente non successiva.
// `giorno` è «AAAA-MM-GG»; le effective_date sono date di calendario.
export function cookieInVigoreAl(giorno: string, documenti: DocumentoLegaleDb[]): CookieInVigore | null {
  const candidati = documenti.filter((d) => d.document_type === "omnia_ai_cookie_policy" && d.effective_date <= giorno).sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  const scelto = candidati[0];
  if (!scelto) return null;
  return { slug: SLUG_PER_TIPO_DB[scelto.document_type], titolo: TITOLO_PER_TIPO_DB[scelto.document_type], versione: scelto.version, inVigoreDal: scelto.effective_date };
}

export function raggruppaAccettazioni(accettazioni: AccettazioneDb[], documenti: DocumentoLegaleDb[], abbonamenti: AbbonamentoDb[]): GruppoAccettazioni[] {
  const perDocumento = new Map(documenti.map((d) => [d.id, d]));
  const gruppi = new Map<string, GruppoAccettazioni>();

  const gruppoDi = (abbonamentoId: string, primaData: string): GruppoAccettazioni => {
    let g = gruppi.get(abbonamentoId);
    if (!g) {
      const abb = abbonamenti.find((a) => a.id === abbonamentoId);
      g = {
        abbonamentoId,
        piano: abb ? (normalizzaPianoSlug(abb.plan) ?? abb.plan) : "—",
        creatoIl: abb?.created_at ?? primaData,
        manuale: abb ? !abb.stripe_subscription_id : false,
        documenti: [],
        cookie: null,
      };
      gruppi.set(abbonamentoId, g);
    }
    return g;
  };

  // un abbonamento senza nessuna accettazione compare comunque, con la sua spiegazione
  for (const a of abbonamenti) gruppoDi(a.id, a.created_at);

  for (const acc of accettazioni) {
    const doc = perDocumento.get(acc.legal_document_id);
    if (!doc) continue;
    const g = gruppoDi(acc.subscription_id, acc.accepted_at);
    const esistente = g.documenti.find((d) => d.documentoId === doc.id);
    if (esistente) {
      if (acc.accepted_at < esistente.accettatoIl) esistente.accettatoIl = acc.accepted_at;
    } else {
      g.documenti.push({
        documentoId: doc.id,
        tipoDb: doc.document_type,
        slug: SLUG_PER_TIPO_DB[doc.document_type] ?? doc.document_type,
        titolo: TITOLO_PER_TIPO_DB[doc.document_type] ?? doc.document_type,
        versione: doc.version,
        accettatoIl: acc.accepted_at,
      });
    }
  }

  const risultato = [...gruppi.values()];
  for (const g of risultato) {
    g.documenti.sort((a, b) => posizione(a.tipoDb) - posizione(b.tipoDb));
    const attivazione = g.documenti.map((d) => d.accettatoIl).sort()[0];
    g.cookie = attivazione ? cookieInVigoreAl(attivazione.slice(0, 10), documenti) : null;
  }
  return risultato.sort((a, b) => b.creatoIl.localeCompare(a.creatoIl));
}

// ───── Allegato A: dati del cliente ─────

export type ProfiloFatturazione = { ragione_sociale: string | null; partita_iva: string | null; codice_fiscale: string | null; indirizzo: string | null };

function pieno(v: string | null | undefined): boolean {
  return (v ?? "").trim() !== "";
}

// Cosa manca perché l'Allegato A si compili per intero. Per un'impresa ci vogliono
// ragione sociale, partita IVA (o codice fiscale, per un professionista) e sede.
export function datiAllegatoMancanti(profilo: ProfiloFatturazione | null): string[] {
  const mancanti: string[] = [];
  if (!profilo || !pieno(profilo.ragione_sociale)) mancanti.push("ragione sociale");
  if (!profilo || (!pieno(profilo.partita_iva) && !pieno(profilo.codice_fiscale))) mancanti.push("partita IVA o codice fiscale");
  if (!profilo || !pieno(profilo.indirizzo)) mancanti.push("sede (indirizzo)");
  return mancanti;
}

export function valoriSegnaposto(profilo: ProfiloFatturazione | null, data: string | null): ValoriSegnaposto {
  return {
    data,
    ragioneSociale: profilo?.ragione_sociale ?? null,
    partitaIva: profilo?.partita_iva ?? null,
    codiceFiscale: profilo?.codice_fiscale ?? null,
    sede: profilo?.indirizzo ?? null,
  };
}
