// Fase B4 (19/11/2026, B2) — UNA sola regola per decidere se una persona RICEVE le email di Tender Intelligence, usata sia dal motore
// (alla creazione delle consegne e di nuovo al momento dell'invio) sia dalla pagina «Notifiche» di B1 (colonna «Riceve», stato
// dell'indirizzo). Logica PURA: nessun database, nessuna rete, nessun orologio (l'istante arriva come argomento).
//
// I dati arrivano già letti dal server:
//   - la persona dalla funzione del database radar_notifiche_destinatari (0125): titolare o membro dell'Ufficio Gare, email confermata,
//     utente bloccato o cancellato, membro attivo;
//   - le preferenze da omnia_ai_radar_notifiche_persone (0124), assenti = tutto spento;
//   - lo stato dell'impresa: Radar attivo (console), email accese (titolare), abbonamento valido se controllato (decisione D-E8).
// Regole: decisione dell'utente del 19/11 (documento 26, §3) e piano 26B §2.3. Gli amministratori della console NON sono mai destinatari
// in quanto tali: la funzione del database restituisce solo il titolare e i membri dell'impresa richiesta.

import { CATEGORIE_NOTIFICA, type CategoriaNotifica, type RuoloDestinatario } from "./tipi";

/** Una riga della funzione radar_notifiche_destinatari (0125). `email` serve solo in memoria all'invio: mai salvata, mai mostrata. */
export type PersonaImpresa = {
  impresaId: string;
  userId: string;
  ruolo: RuoloDestinatario;
  email: string | null;
  emailConfermata: boolean;
  /** utente bloccato (banned_until futuro) o cancellato in auth */
  bloccato: boolean;
  /** per il titolare sempre true; per l'Ufficio Gare omnia_ai_membri.attivo */
  membroAttivo: boolean;
};

/** Le preferenze di una persona (riga di omnia_ai_radar_notifiche_persone); null = nessuna riga = tutto spento. */
export type PreferenzePersona = {
  nuove_opportunita: boolean;
  scadenze: boolean;
  rettifiche: boolean;
  /** indirizzo bloccato dopo un rimbalzo definitivo, un reclamo o una soppressione del provider (webhook futuro) */
  email_bloccata_il: string | null;
  motivo_blocco: "rimbalzo" | "reclamo" | "soppressione" | null;
};

/** Lo stato dell'impresa. `abbonamentoValido` null = non controllato (finché la decisione D-E8 non è presa). */
export type StatoImpresaNotifiche = {
  impresaId: string;
  radarAttivo: boolean;
  emailAttive: boolean;
  abbonamentoValido: boolean | null;
};

/** I motivi per cui una persona NON riceve, dal più generale al più specifico (vedi ORDINE_MOTIVI). */
export type MotivoNonRiceve =
  | "altra_impresa"
  | "radar_non_attivo"
  | "abbonamento_non_valido"
  | "email_impresa_spente"
  | "membro_disattivato"
  | "utente_bloccato"
  | "email_mancante"
  | "email_da_verificare"
  | "email_bloccata"
  | "categoria_spenta";

export const ORDINE_MOTIVI: readonly MotivoNonRiceve[] = [
  "altra_impresa",
  "radar_non_attivo",
  "abbonamento_non_valido",
  "email_impresa_spente",
  "membro_disattivato",
  "utente_bloccato",
  "email_mancante",
  "email_da_verificare",
  "email_bloccata",
  "categoria_spenta",
];

/** Testi per i clienti (pagina «Notifiche»): «titolare dell'impresa», mai «amministratore». */
export const TESTO_MOTIVO: Readonly<Record<MotivoNonRiceve, string>> = {
  altra_impresa: "Persona di un'altra impresa",
  radar_non_attivo: "Opportunità non attive per l'impresa",
  abbonamento_non_valido: "Abbonamento OMNIA AI non attivo",
  email_impresa_spente: "Avvisi email spenti dal titolare dell'impresa",
  membro_disattivato: "Accesso dell'Ufficio Gare sospeso",
  utente_bloccato: "Utente disattivato",
  email_mancante: "Indirizzo email mancante",
  email_da_verificare: "Indirizzo email da verificare",
  email_bloccata: "Indirizzo email non raggiungibile",
  categoria_spenta: "Categoria spenta nelle preferenze",
};

export type EsitoRiceve = { riceve: true } | { riceve: false; motivo: MotivoNonRiceve; motivi: MotivoNonRiceve[]; testo: string };

/** La persona appartiene all'impresa? Titolare = l'impresa stessa; Ufficio Gare = membro di quel titolare (la riga viene dalla funzione). */
function dellaImpresa(p: PersonaImpresa, impresaId: string): boolean {
  if (p.impresaId !== impresaId) return false;
  return p.ruolo === "titolare" ? p.userId === impresaId : p.userId !== impresaId;
}

function indirizzoPlausibile(email: string | null): boolean {
  return !!email && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Riceve questa persona le email di questa categoria per questa impresa? Tutti i motivi in `motivi` (ordinati), il primo in `motivo`.
 * È la STESSA regola per la pagina, per la creazione delle consegne e per il ricontrollo all'invio.
 */
export function riceve(
  persona: PersonaImpresa,
  preferenze: PreferenzePersona | null,
  impresa: StatoImpresaNotifiche,
  categoria: CategoriaNotifica,
): EsitoRiceve {
  const motivi = new Set<MotivoNonRiceve>();
  if (!dellaImpresa(persona, impresa.impresaId)) motivi.add("altra_impresa");
  if (!impresa.radarAttivo) motivi.add("radar_non_attivo");
  if (impresa.abbonamentoValido === false) motivi.add("abbonamento_non_valido");
  if (!impresa.emailAttive) motivi.add("email_impresa_spente");
  if (!persona.membroAttivo) motivi.add("membro_disattivato");
  if (persona.bloccato) motivi.add("utente_bloccato");
  if (!indirizzoPlausibile(persona.email)) motivi.add("email_mancante");
  else if (!persona.emailConfermata) motivi.add("email_da_verificare");
  if (preferenze?.email_bloccata_il) motivi.add("email_bloccata");
  if (!preferenze || preferenze[categoria] !== true) motivi.add("categoria_spenta");
  if (motivi.size === 0) return { riceve: true };
  const ordinati = ORDINE_MOTIVI.filter((m) => motivi.has(m));
  return { riceve: false, motivo: ordinati[0], motivi: ordinati, testo: TESTO_MOTIVO[ordinati[0]] };
}

/** Le tre categorie in una volta, per la tabella della pagina «Notifiche». */
export function riceveTutte(
  persona: PersonaImpresa,
  preferenze: PreferenzePersona | null,
  impresa: StatoImpresaNotifiche,
): Record<CategoriaNotifica, EsitoRiceve> {
  return Object.fromEntries(CATEGORIE_NOTIFICA.map((c) => [c, riceve(persona, preferenze, impresa, c)])) as Record<CategoriaNotifica, EsitoRiceve>;
}

/** Stato dell'indirizzo per la pagina (26A §3.1): verificato, da verificare, bloccato, utente disattivato. */
export type StatoIndirizzo = "verificato" | "da_verificare" | "bloccato" | "utente_disattivato";

export function statoIndirizzo(persona: PersonaImpresa, preferenze: PreferenzePersona | null): StatoIndirizzo {
  if (!persona.membroAttivo || persona.bloccato) return "utente_disattivato";
  if (preferenze?.email_bloccata_il) return "bloccato";
  if (!indirizzoPlausibile(persona.email) || !persona.emailConfermata) return "da_verificare";
  return "verificato";
}

/**
 * Le persone che ricevono una categoria per un'impresa, dall'elenco della funzione del database: per il motore (creazione delle consegne)
 * e per il ricontrollo all'invio. Le persone di altre imprese non passano mai, anche se l'elenco le contenesse per errore.
 */
export function destinatariCheRicevono(
  persone: readonly PersonaImpresa[],
  preferenze: ReadonlyMap<string, PreferenzePersona>,
  impresa: StatoImpresaNotifiche,
  categoria: CategoriaNotifica,
): PersonaImpresa[] {
  const visti = new Set<string>();
  const esito: PersonaImpresa[] = [];
  for (const p of persone) {
    if (visti.has(p.userId)) continue;
    if (riceve(p, preferenze.get(p.userId) ?? null, impresa, categoria).riceve) {
      visti.add(p.userId);
      esito.push(p);
    }
  }
  return esito;
}

/** Da una riga grezza della funzione radar_notifiche_destinatari (nomi del database) alla persona; null se la forma non è quella attesa. */
export function personaDaRiga(r: unknown): PersonaImpresa | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (typeof x.impresa_id !== "string" || !uuid.test(x.impresa_id)) return null;
  if (typeof x.user_id !== "string" || !uuid.test(x.user_id)) return null;
  if (x.ruolo !== "titolare" && x.ruolo !== "ufficio_gare") return null;
  return {
    impresaId: x.impresa_id,
    userId: x.user_id,
    ruolo: x.ruolo,
    email: typeof x.email === "string" ? x.email.trim().toLowerCase() : null,
    emailConfermata: x.email_confermata === true,
    bloccato: x.bloccato !== false,
    membroAttivo: x.membro_attivo === true,
  };
}
