import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import { clientiConCondizioniNewsletter, clientiDaAggiungere, emailValida, type ClienteConCondizioni } from "./destinatari";
import { VERSIONE_CONDIZIONI_CON_NEWSLETTER, type BaseGiuridica, type CategoriaIscritto, type Iscritto } from "./tipi";

// Gestione centralizzata dei destinatari: clienti acquisiti dagli abbonamenti, inserimenti manuali (uno, un elenco
// incollato, un file CSV). Regole comuni:
//  - un indirizzo è UNA riga (email unica nel database): acquisito da più fonti riceve comunque una sola copia;
//  - un inserimento manuale non riattiva MAI da solo un indirizzo disiscritto: serve la spunta «nuova autorizzazione
//    documentata» con la sua prova, e la riattivazione è registrata;
//  - un indirizzo che rimbalza o ha segnalato spam non si riattiva da qui.

// ───── clienti dagli abbonamenti ─────

export async function sincronizzaClienti(
  a: ArchivioNewsletter = archivioNewsletter(),
  leggiClienti: () => Promise<ClienteConCondizioni[]> = () => clientiConCondizioniNewsletter(VERSIONE_CONDIZIONI_CON_NEWSLETTER),
): Promise<{ aggiunti: number }> {
  const [iscritti, clienti] = await Promise.all([a.elencoIscritti(), leggiClienti()]);
  let aggiunti = 0;
  for (const c of clientiDaAggiungere(iscritti, clienti)) {
    try {
      await a.aggiungiIscritto(
        {
          email: c.email,
          nome: null,
          user_id: c.userId,
          categoria: "cliente",
          stato: "iscritto",
          base_giuridica: "contratto_abbonamento",
          prova_base: `Accettazione delle Condizioni di abbonamento OMNIA AI v${c.versione} (registro accettazioni, id ${c.accettazioneId}) del ${c.accettataIl}: Tender Weekly è incluso tra i servizi informativi dell'abbonamento.`,
          base_dal: c.accettataIl.slice(0, 10),
          provenienza: "abbonamento",
        },
        null,
      );
      aggiunti++;
    } catch (e) {
      // aggiunto nel frattempo da un'altra richiesta: va bene così
      if (!/già presente|23505|duplicate/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  if (aggiunti) await a.annota(null, "clienti_acquisiti", { aggiunti }, null);
  return { aggiunti };
}

// ───── elenchi e CSV ─────

export type RigaIndirizzo = { email: string; nome: string | null; azienda: string | null };
export type ElencoLetto = { righe: RigaIndirizzo[]; nonValidi: string[] };

function dividiCsv(riga: string, sep: string): string[] {
  const out: string[] = [];
  let campo = "";
  let virgolette = false;
  for (let i = 0; i < riga.length; i++) {
    const ch = riga[i];
    if (ch === '"') {
      if (virgolette && riga[i + 1] === '"') {
        campo += '"';
        i++;
      } else virgolette = !virgolette;
    } else if (ch === sep && !virgolette) {
      out.push(campo.trim());
      campo = "";
    } else campo += ch;
  }
  out.push(campo.trim());
  return out;
}

// Legge un CSV con intestazione (colonne riconosciute: email, nome, cognome, azienda/società/ragione sociale) oppure, se
// non c'è un'intestazione con «email», un testo qualsiasi da cui si estraggono gli indirizzi (elenco incollato).
export function leggiElenco(testo: string): ElencoLetto {
  const pulito = testo.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!pulito) return { righe: [], nonValidi: [] };
  const righeTesto = pulito.split("\n").filter((r) => r.trim());
  const prima = righeTesto[0].toLowerCase();
  const sep = (prima.match(/;/g)?.length ?? 0) > (prima.match(/,/g)?.length ?? 0) ? ";" : prima.includes("\t") ? "\t" : ",";
  const intestazione = dividiCsv(prima, sep).map((h) => h.replace(/^"|"$/g, "").trim());
  const col = (...nomi: string[]) => intestazione.findIndex((h) => nomi.some((n) => h === n || h.replace(/[^a-z]/g, "") === n.replace(/[^a-z]/g, "")));
  const iEmail = col("email", "e-mail", "indirizzo email", "mail");
  const righe: RigaIndirizzo[] = [];
  const nonValidi: string[] = [];
  const visti = new Set<string>();
  const aggiungi = (email: string, nome: string | null, azienda: string | null) => {
    const e = email.trim().toLowerCase().replace(/^mailto:/, "");
    if (!emailValida(e)) {
      if (email.trim()) nonValidi.push(email.trim().slice(0, 80));
      return;
    }
    if (visti.has(e)) return;
    visti.add(e);
    righe.push({ email: e, nome: nome?.trim().slice(0, 120) || null, azienda: azienda?.trim().slice(0, 160) || null });
  };
  if (iEmail >= 0) {
    const iNome = col("nome", "nome e cognome", "nominativo");
    const iCognome = col("cognome");
    const iAzienda = col("azienda", "società", "societa", "ragione sociale", "impresa");
    for (const r of righeTesto.slice(1)) {
      const c = dividiCsv(r, sep);
      const nome = [iNome >= 0 ? c[iNome] : "", iCognome >= 0 ? c[iCognome] : ""].filter(Boolean).join(" ");
      aggiungi(c[iEmail] ?? "", nome || null, iAzienda >= 0 ? c[iAzienda] ?? null : null);
    }
  } else {
    // elenco libero: ogni pezzo separato da a capo, virgola, punto e virgola o spazio; «Nome <email>» è ammesso
    for (const pezzo of pulito.split(/[\n,;]+/)) {
      const t = pezzo.trim();
      if (!t) continue;
      const tra = t.match(/^(.*)<([^>]+)>\s*$/);
      if (tra) aggiungi(tra[2], tra[1].replace(/"/g, "").trim() || null, null);
      else for (const parola of t.split(/\s+/)) aggiungi(parola, null, null);
    }
  }
  return { righe, nonValidi };
}

// ───── inserimento manuale ─────

export type DatiInserimento = {
  righe: RigaIndirizzo[];
  base: BaseGiuridica;
  prova: string;
  baseDal: string;
  note: string | null;
  categoria: CategoriaIscritto;
  provenienza: "console" | "importazione";
  // spunta esplicita: per questi indirizzi disiscritti ho una NUOVA autorizzazione documentata
  nuovaAutorizzazione: boolean;
};

export type EsitoInserimento = {
  aggiunti: string[];
  giaPresenti: string[];
  riattivati: string[];
  disiscrittiNonRiattivati: string[];
  bloccati: string[];
};

export async function inserisciDestinatari(d: DatiInserimento, autore: string | null, a: ArchivioNewsletter = archivioNewsletter()): Promise<EsitoInserimento> {
  const esito: EsitoInserimento = { aggiunti: [], giaPresenti: [], riattivati: [], disiscrittiNonRiattivati: [], bloccati: [] };
  if (d.prova.trim().length < 10) throw new Error("Newsletter, prova della base giuridica troppo breve");
  const esistenti = new Map((await a.elencoIscritti()).map((i) => [i.email.toLowerCase(), i] as const));
  for (const r of d.righe) {
    const e: Iscritto | undefined = esistenti.get(r.email);
    if (!e) {
      await a.aggiungiIscritto(
        {
          email: r.email,
          nome: r.nome,
          user_id: null,
          categoria: d.categoria,
          stato: "iscritto",
          base_giuridica: d.base,
          prova_base: d.prova.trim().slice(0, 1000),
          base_dal: d.baseDal,
          provenienza: d.provenienza,
          azienda: r.azienda,
          note_admin: d.note,
        },
        autore,
      );
      esito.aggiunti.push(r.email);
      continue;
    }
    if (e.stato === "rimbalzato" || e.stato === "segnalato_spam") {
      esito.bloccati.push(r.email);
    } else if (e.stato === "disiscritto") {
      if (!d.nuovaAutorizzazione) {
        esito.disiscrittiNonRiattivati.push(r.email);
        continue;
      }
      await a.aggiornaIscritto(e.id, {
        stato: "iscritto",
        base_giuridica: d.base,
        prova_base: `NUOVA autorizzazione dopo la disiscrizione del ${e.disiscritto_il ?? "?"}: ${d.prova.trim()}`.slice(0, 1000),
        base_dal: d.baseDal,
        disiscritto_il: null,
        motivo_uscita: null,
        note_admin: [e.note_admin, d.note].filter(Boolean).join(" · ") || null,
      });
      await a.annota(null, "iscritto_riattivato", { iscritto: e.id, base: d.base }, autore);
      esito.riattivati.push(r.email);
    } else {
      // già iscritto o in attesa di conferma: nessun doppione e nessuna modifica della sua base
      esito.giaPresenti.push(r.email);
    }
  }
  if (esito.aggiunti.length) await a.annota(null, "iscritti_aggiunti", { quanti: esito.aggiunti.length, provenienza: d.provenienza, base: d.base }, autore);
  return esito;
}
