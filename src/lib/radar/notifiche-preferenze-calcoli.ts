// Fase B4 (B1), grado 3 — Pagina «Notifiche»: calcoli puri delle preferenze delle email (decisione dell'utente del 19/11, §3; approvazione
// definitiva: D-E3 «l'Ufficio Gare può solo spegnere le proprie», D-E4 valori iniziali). Nessun database, nessuna rete.
// La regola «riceve sì/no» e lo stato dell'indirizzo NON sono qui: sono di B2 (src/lib/radar/notifiche/destinatari-calcoli.ts), una sola
// regola per la pagina e per l'invio. Qui: chi può cambiare che cosa, i valori iniziali, la vista delle persone.
// Testi per i clienti: «titolare dell'impresa», mai «amministratore».
import { CATEGORIE_NOTIFICA, type CategoriaNotifica, type RuoloDestinatario } from "./notifiche/tipi";
import { riceveTutte, statoIndirizzo, type EsitoRiceve, type PersonaImpresa, type PreferenzePersona, type StatoImpresaNotifiche, type StatoIndirizzo } from "./notifiche/destinatari-calcoli";

export const TABELLA_NOTIFICHE_IMPRESA = "omnia_ai_radar_notifiche_impresa";
export const TABELLA_NOTIFICHE_PERSONE = "omnia_ai_radar_notifiche_persone";
export const COLONNE_NOTIFICHE_PERSONE = "user_id, nuove_opportunita, scadenze, rettifiche, email_bloccata_il, motivo_blocco";

export type CategoriePreferenze = Record<CategoriaNotifica, boolean>;

export const TUTTO_SPENTO: CategoriePreferenze = { nuove_opportunita: false, scadenze: false, rettifiche: false };

/** Testi delle tre categorie (pagina e modulo). */
export const TESTI_CATEGORIA: Readonly<Record<CategoriaNotifica, { titolo: string; descrizione: string }>> = {
  nuove_opportunita: { titolo: "Nuove opportunità", descrizione: "Un riepilogo delle nuove gare in linea con il profilo dell'impresa (al massimo 20 per invio)." },
  scadenze: { titolo: "Scadenze", descrizione: "Promemoria a 10, 5 e 1 giorno dalla scadenza delle gare salvate o monitorate." },
  rettifiche: { titolo: "Rettifiche e modifiche", descrizione: "Rettifiche, proroghe o modifiche della scadenza e documenti nuovi delle gare salvate o monitorate." },
};

export const TESTO_STATO_INDIRIZZO: Readonly<Record<StatoIndirizzo, string>> = {
  verificato: "Indirizzo verificato",
  da_verificare: "Indirizzo da verificare",
  bloccato: "Indirizzo non raggiungibile",
  utente_disattivato: "Utente disattivato",
};

/**
 * D-E4 (approvata il 19/11): quando il titolare accende le email per la prima volta, scadenze e rettifiche accese per tutti, nuove
 * opportunità solo per il titolare. Poi ognuno può cambiare secondo i propri permessi.
 */
export function valoriIniziali(ruolo: RuoloDestinatario): CategoriePreferenze {
  return { nuove_opportunita: ruolo === "titolare", scadenze: true, rettifiche: true };
}

/** Dalla riga della 0124 alle preferenze della regola di B2 (valori non booleani = spento). */
export function preferenzeDaRiga(r: Record<string, unknown> | null | undefined): PreferenzePersona | null {
  if (!r) return null;
  const blocco = r.motivo_blocco;
  return {
    nuove_opportunita: r.nuove_opportunita === true,
    scadenze: r.scadenze === true,
    rettifiche: r.rettifiche === true,
    email_bloccata_il: typeof r.email_bloccata_il === "string" ? r.email_bloccata_il : null,
    motivo_blocco: blocco === "rimbalzo" || blocco === "reclamo" || blocco === "soppressione" ? blocco : null,
  };
}

export function categorieDa(p: PreferenzePersona | null | undefined): CategoriePreferenze {
  return { nuove_opportunita: p?.nuove_opportunita === true, scadenze: p?.scadenze === true, rettifiche: p?.rettifiche === true };
}

/** Le caselle del modulo: nome = categoria, valore «si». Qualunque altro campo si ignora. */
export function categorieDaModulo(fd: { get(nome: string): unknown }): CategoriePreferenze {
  return Object.fromEntries(CATEGORIE_NOTIFICA.map((c) => [c, String(fd.get(c) ?? "") === "si"])) as CategoriePreferenze;
}

/** Chi è nell'impresa, letto dal server: il titolare (l'impresa stessa) e i membri ATTIVI del suo Ufficio Gare. */
export type PersoneDellImpresa = { impresaId: string; membriAttivi: readonly string[] };

export function eDellImpresa(userId: string, persone: PersoneDellImpresa): boolean {
  return userId === persone.impresaId || persone.membriAttivi.includes(userId);
}

export function ruoloNellImpresa(userId: string, persone: PersoneDellImpresa): RuoloDestinatario | null {
  if (userId === persone.impresaId) return "titolare";
  return persone.membriAttivi.includes(userId) ? "ufficio_gare" : null;
}

export type EsitoModifica = { ok: true; valori: CategoriePreferenze } | { ok: false; errore: string };

export const MESSAGGIO_SOLO_PROPRIE = "Puoi modificare solo le tue preferenze.";
export const MESSAGGIO_RIACCENDERE = "Per riaccendere una categoria chiedi al titolare dell'impresa.";

/**
 * Una modifica delle preferenze è ammessa?
 *   - la persona da modificare deve essere dell'impresa (titolare o membro attivo): mai una persona di un'altra impresa;
 *   - il titolare modifica le preferenze di tutte le persone dell'impresa;
 *   - l'Ufficio Gare modifica SOLO le proprie e SOLO per spegnere (D-E3): accendere una categoria spenta è del titolare.
 */
export function validaModificaPreferenze(d: {
  chiModifica: { userId: string; ruolo: RuoloDestinatario };
  destinatarioId: string;
  persone: PersoneDellImpresa;
  attuali: CategoriePreferenze | null;
  richieste: CategoriePreferenze;
}): EsitoModifica {
  if (!eDellImpresa(d.destinatarioId, d.persone)) return { ok: false, errore: "Persona non valida." };
  if (d.chiModifica.ruolo === "titolare") {
    return d.chiModifica.userId === d.persone.impresaId ? { ok: true, valori: d.richieste } : { ok: false, errore: "Persona non valida." };
  }
  if (d.destinatarioId !== d.chiModifica.userId || !eDellImpresa(d.chiModifica.userId, d.persone)) return { ok: false, errore: MESSAGGIO_SOLO_PROPRIE };
  const attuali = d.attuali ?? TUTTO_SPENTO;
  if (CATEGORIE_NOTIFICA.some((c) => d.richieste[c] && !attuali[c])) return { ok: false, errore: MESSAGGIO_RIACCENDERE };
  return { ok: true, valori: d.richieste };
}

/** Le righe iniziali delle persone alla prima accensione (D-E4): solo per chi non ha già una riga. */
export function righeIniziali(persone: PersoneDellImpresa, giaPresenti: ReadonlySet<string>, autoreId: string, adesso: string) {
  const tutte: { userId: string; ruolo: RuoloDestinatario }[] = [{ userId: persone.impresaId, ruolo: "titolare" }, ...persone.membriAttivi.map((m) => ({ userId: m, ruolo: "ufficio_gare" as const }))];
  return tutte
    .filter((p) => !giaPresenti.has(p.userId))
    .map((p) => ({ impresa_id: persone.impresaId, user_id: p.userId, ...valoriIniziali(p.ruolo), aggiornato_il: adesso, aggiornato_da: autoreId }));
}

/** La riga da scrivere per una persona: impresa e autore dal server, categorie già validate. */
export function rigaPreferenze(impresaId: string, userId: string, valori: CategoriePreferenze, autoreId: string, adesso: string) {
  return { impresa_id: impresaId, user_id: userId, ...valori, aggiornato_il: adesso, aggiornato_da: autoreId };
}

// ───── vista delle persone (tabella del titolare, riga propria dell'Ufficio Gare) ─────

export type PersonaVista = {
  userId: string;
  etichetta: string;
  ruolo: RuoloDestinatario;
  tu: boolean;
  stato: StatoIndirizzo;
  statoTesto: string;
  categorie: CategoriePreferenze;
  riceve: Record<CategoriaNotifica, EsitoRiceve>;
};

/**
 * Le persone come le vede chi apre la pagina. Il titolare vede tutte le persone della SUA impresa; l'Ufficio Gare solo sé stesso.
 * Mai l'indirizzo email (né il proprio né quello degli altri): solo ruolo e stato. Le persone di altre imprese non passano mai.
 */
export function personeVisibili(d: {
  persone: readonly PersonaImpresa[];
  preferenze: ReadonlyMap<string, PreferenzePersona>;
  impresa: StatoImpresaNotifiche;
  chiGuarda: { userId: string; ruolo: RuoloDestinatario };
}): PersonaVista[] {
  const visibili: PersonaImpresa[] = [];
  for (const p of d.persone) {
    if (p.impresaId !== d.impresa.impresaId) continue;
    const ammessa = d.chiGuarda.ruolo === "titolare" ? d.chiGuarda.userId === d.impresa.impresaId : p.userId === d.chiGuarda.userId;
    if (ammessa && !visibili.some((v) => v.userId === p.userId)) visibili.push(p);
  }
  return visibili
    .sort((a, b) => (a.ruolo === b.ruolo ? 0 : a.ruolo === "titolare" ? -1 : 1))
    .map((p) => {
      const pref = d.preferenze.get(p.userId) ?? null;
      const stato = statoIndirizzo(p, pref);
      return {
        userId: p.userId,
        etichetta: p.ruolo === "titolare" ? "Titolare dell'impresa" : "Ufficio Gare",
        ruolo: p.ruolo,
        tu: p.userId === d.chiGuarda.userId,
        stato,
        statoTesto: TESTO_STATO_INDIRIZZO[stato],
        categorie: categorieDa(pref),
        riceve: riceveTutte(p, pref, d.impresa),
      };
    });
}

/** Come si può modificare una riga: «completa» (titolare), «solo_spegnere» (Ufficio Gare, la propria), «lettura». */
export function modoModifica(chiGuarda: { userId: string; ruolo: RuoloDestinatario }, riga: { userId: string }, operativo: boolean): "completa" | "solo_spegnere" | "lettura" {
  if (!operativo) return "lettura";
  if (chiGuarda.ruolo === "titolare") return "completa";
  return riga.userId === chiGuarda.userId ? "solo_spegnere" : "lettura";
}
