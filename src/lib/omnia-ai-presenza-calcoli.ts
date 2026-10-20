// Presenza degli utenti nell'area riservata di OMNIA AI (migrazione 0094): calcoli puri (nessun database, nessuna rete).
// L'area riservata manda un segnale ogni ~45 secondi finché la scheda è aperta e visibile; la console ne ricava se l'utente è
// collegato, se sta lavorando o è fermo, in quale sezione, e quando è uscito.
//
// Si registrano SOLO orari e il nome di una sezione scelta da un elenco fisso: mai l'indirizzo preciso, mai l'identificativo
// o il titolo di una gara, mai contenuti.

// ───── Soglie ─────

export const INTERVALLO_SEGNALE_MS = 45_000;
// Se la scheda non ha mosso né mouse né tastiera né scorrimento nell'ultimo minuto, il segnale dice «fermo».
export const FINESTRA_ATTIVITA_MS = 60_000;
// Collegato se l'ultimo segnale è di meno di 2,5 minuti fa (si perdono due segnali di fila prima di risultare offline).
export const SOGLIA_ONLINE_MS = 150_000;
// Attivo se l'ultimo segnale «attivo» è di meno di 2 minuti fa.
export const SOGLIA_ATTIVO_MS = 120_000;
// Un segnale con più di questi byte non si guarda nemmeno.
export const DIMENSIONE_MASSIMA_CORPO = 1024;

// ───── Sezioni ─────

export type Sezione = "dashboard" | "gare" | "gara" | "documenti-aziendali" | "profilo-azienda" | "abbonamento" | "pagamenti" | "documenti-contrattuali" | "ufficio-gare" | "impostazioni" | "assistenza" | "altro";

export const ETICHETTE_SEZIONE: Record<Sezione, string> = {
  dashboard: "Dashboard",
  gare: "Elenco gare",
  gara: "Dentro una gara",
  "documenti-aziendali": "Documenti aziendali",
  "profilo-azienda": "Profilo azienda",
  abbonamento: "Abbonamento",
  pagamenti: "Pagamenti e fatture",
  "documenti-contrattuali": "Documenti contrattuali",
  "ufficio-gare": "Ufficio Gare",
  impostazioni: "Impostazioni",
  assistenza: "Supporto",
  altro: "Altra pagina",
};

const RADICE_AREA = "/dashboard/omnia-ai";

// Dal percorso della pagina (senza dominio) alla SEZIONE: una parola di un elenco fisso. Qualunque altra cosa è «altro»; di una
// gara si dice solo «dentro una gara», mai quale. Non si legge mai altro del percorso.
export function sezioneDaPercorso(percorso: unknown): Sezione {
  if (typeof percorso !== "string" || percorso.length > 300) return "altro";
  const pulito = percorso.split("?")[0].split("#")[0].replace(/\/+$/, "");
  if (pulito === RADICE_AREA) return "dashboard";
  if (!pulito.startsWith(`${RADICE_AREA}/`)) return "altro";
  const [primo, secondo] = pulito.slice(RADICE_AREA.length + 1).split("/");
  switch (primo) {
    case "gare":
      return secondo ? "gara" : "gare";
    case "documenti-aziendali":
    case "profilo-azienda":
    case "abbonamento":
    case "pagamenti":
    case "documenti-contrattuali":
    case "ufficio-gare":
    case "impostazioni":
    case "assistenza":
      return primo;
    default:
      return "altro";
  }
}

export function etichettaSezione(sezione: string | null | undefined): string | null {
  if (!sezione) return null;
  return ETICHETTE_SEZIONE[sezione as Sezione] ?? ETICHETTE_SEZIONE.altro;
}

// ───── Il segnale che arriva dal browser ─────

export type SegnaleValido = { attivo: boolean; sezione: Sezione };

// Il corpo è un piccolo JSON {attivo, percorso}: tutto il resto si ignora. null = non valido (non si registra niente).
export function leggiSegnale(testoCorpo: string): SegnaleValido | null {
  if (testoCorpo.length === 0 || testoCorpo.length > DIMENSIONE_MASSIMA_CORPO) return null;
  let dati: unknown;
  try {
    dati = JSON.parse(testoCorpo);
  } catch {
    return null;
  }
  if (typeof dati !== "object" || dati === null || Array.isArray(dati)) return null;
  const { attivo, percorso } = dati as { attivo?: unknown; percorso?: unknown };
  if (typeof attivo !== "boolean") return null;
  return { attivo, sezione: sezioneDaPercorso(percorso) };
}

// ───── Stato mostrato in console ─────

// La riga della tabella omnia_ai_presenza, come arriva dal database.
export type PresenzaDb = {
  user_id: string;
  ultimo_segnale: string;
  ultima_attivita: string | null;
  sezione: string | null;
  ingresso_il: string;
  uscita_il: string | null;
};

export type StatoPresenza = "attivo" | "fermo" | "offline" | "mai";

export type PresenzaCalcolata = {
  stato: StatoPresenza;
  // sezione dell'ultimo segnale (parola dell'elenco), con la sua etichetta
  sezione: string | null;
  etichettaSezione: string | null;
  // l'ultimo segnale ricevuto
  ultimoSegnale: string | null;
  ultimaAttivita: string | null;
  // da quando dura la visita in corso (solo se collegato)
  inSessioneDa: string | null;
  // l'ultima volta che ha premuto «Esci», se è successo dopo l'ultimo segnale (cioè se è uscito così)
  uscitoConEsciIl: string | null;
  // l'ultima uscita con «Esci» in assoluto (anche se poi è rientrato)
  ultimaUscitaEsciIl: string | null;
};

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

export function statoPresenza(riga: PresenzaDb | null | undefined, adesso: Date): PresenzaCalcolata {
  if (!riga) return { stato: "mai", sezione: null, etichettaSezione: null, ultimoSegnale: null, ultimaAttivita: null, inSessioneDa: null, uscitoConEsciIl: null, ultimaUscitaEsciIl: null };

  const segnale = ms(riga.ultimo_segnale);
  const uscita = ms(riga.uscita_il);
  const uscitoDopoIlSegnale = Number.isFinite(uscita) && Number.isFinite(segnale) && uscita >= segnale;
  // dopo un'uscita con «Esci» non si è collegati, qualunque cosa dica il tempo trascorso
  const collegato = Number.isFinite(segnale) && !uscitoDopoIlSegnale && adesso.getTime() - segnale <= SOGLIA_ONLINE_MS && adesso.getTime() - segnale >= -SOGLIA_ONLINE_MS;
  const attivitaMs = ms(riga.ultima_attivita);
  const attivo = collegato && Number.isFinite(attivitaMs) && adesso.getTime() - attivitaMs <= SOGLIA_ATTIVO_MS;

  return {
    stato: !collegato ? "offline" : attivo ? "attivo" : "fermo",
    sezione: riga.sezione,
    etichettaSezione: etichettaSezione(riga.sezione),
    ultimoSegnale: riga.ultimo_segnale,
    ultimaAttivita: riga.ultima_attivita,
    inSessioneDa: collegato ? riga.ingresso_il : null,
    uscitoConEsciIl: uscitoDopoIlSegnale ? riga.uscita_il : null,
    ultimaUscitaEsciIl: riga.uscita_il,
  };
}

// «Online · attivo ora · Gare», «Online · fermo · Abbonamento», «Offline · ultimo segnale 15:42», «Mai visto in linea».
// `formatta` è la funzione che rende un orario leggibile (la console usa il fuso di Roma).
export function testoPresenza(p: PresenzaCalcolata, formatta: (iso: string) => string): string {
  if (p.stato === "mai") return "Mai visto in linea";
  if (p.stato === "attivo" || p.stato === "fermo") {
    const sezione = p.etichettaSezione ? ` · ${p.etichettaSezione}` : "";
    return `Online · ${p.stato === "attivo" ? "attivo ora" : "fermo"}${sezione}`;
  }
  if (p.uscitoConEsciIl) return `Offline · uscito con «Esci» il ${formatta(p.uscitoConEsciIl)}`;
  return `Offline · ultimo segnale ${p.ultimoSegnale ? formatta(p.ultimoSegnale) : "—"}`;
}

export function eOnline(p: PresenzaCalcolata | null | undefined): boolean {
  return p?.stato === "attivo" || p?.stato === "fermo";
}
