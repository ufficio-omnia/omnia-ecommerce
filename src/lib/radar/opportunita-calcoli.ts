// Tipo di opportunità e partecipazione di una pubblicazione (documento 09, §6.4): non presentare come «aperto a tutti» ciò che non lo è.
// Logica pura, nessuna rete, nessun database. Fase B2-0: la usano i connettori Sintel e SardegnaCAT; in B2a diventerà una colonna
// dell'archivio (migrazione 0120) e la userà anche TED.
//
// Regola: in «Opportunità» entrano solo le pubblicazioni a partecipazione LIBERA o PER ISCRIZIONE. Procedure su invito, negoziate senza
// bando e affidamenti diretti restano fuori (in futuro solo nell'intelligence), come già fa la PVL nella fase B1-bis.

export type TipoOpportunita =
  | "bando" // bando di gara: chiunque abbia i requisiti presenta l'offerta
  | "manifestazione_interesse" // si presenta la candidatura per essere invitati
  | "indagine_mercato" // come sopra, per una procedura successiva
  | "sistema_qualificazione" // elenco, sistema di qualificazione, SDA istitutivo: ci si iscrive
  | "riservata" // procedura su invito, negoziata senza bando, appalto specifico di un SDA
  | "affidamento_diretto"; // nessuna competizione aperta

export type Partecipazione = "libera" | "iscrizione" | "riservata" | "non_partecipabile";

export const PARTECIPAZIONE: Record<TipoOpportunita, Partecipazione> = {
  bando: "libera",
  manifestazione_interesse: "libera",
  indagine_mercato: "libera",
  sistema_qualificazione: "iscrizione",
  riservata: "riservata",
  affidamento_diretto: "non_partecipabile",
};

export const ETICHETTA_OPPORTUNITA: Record<TipoOpportunita, string> = {
  bando: "Bando di gara",
  manifestazione_interesse: "Manifestazione di interesse",
  indagine_mercato: "Indagine di mercato",
  sistema_qualificazione: "Iscrizione a elenco o sistema di qualificazione",
  riservata: "Procedura riservata agli invitati",
  affidamento_diretto: "Affidamento diretto",
};

export type Opportunita = { tipo: TipoOpportunita; partecipazione: Partecipazione };

// Nell'archivio entrano solo le opportunità a partecipazione libera o per iscrizione (vincolo della colonna, migrazione 0120).
export type TipoOpportunitaArchivio = Exclude<TipoOpportunita, "riservata" | "affidamento_diretto">;
export type PartecipazioneArchivio = Extract<Partecipazione, "libera" | "iscrizione">;
export type OpportunitaArchivio = { tipo: TipoOpportunitaArchivio; partecipazione: PartecipazioneArchivio };

export function perArchivio(o: Opportunita | null): OpportunitaArchivio | null {
  if (!o || !entraInOpportunita(o)) return null;
  return o as OpportunitaArchivio;
}

// TED e PVL: il tipo dell'avviso già letto in B1 e B1-bis. TED: bandi («cn-*») e preinformazioni che indicono la gara («pin-cfc-*») =
// bando; sistemi di qualificazione («qu-sy») = iscrizione. PVL: schede di bando P1 e P2 = bando; C1 (decisione dell'utente del 23/11):
// P7_1_3 (avvio dell'indagine di mercato sotto soglia) = indagine di mercato, cioè una candidatura; P7_3 (avviso di costituzione di un
// elenco) = iscrizione. Altri tipi → non indicato.
export function opportunitaDaTipoAvviso(tipoAvviso: string | null | undefined): OpportunitaArchivio | null {
  const t = (tipoAvviso ?? "").trim();
  if (/^cn-|^pin-cfc-|^P[12]_/.test(t)) return { tipo: "bando", partecipazione: "libera" };
  if (/^qu-sy$/.test(t)) return { tipo: "sistema_qualificazione", partecipazione: "iscrizione" };
  if (/^P7_1_3$/.test(t)) return { tipo: "indagine_mercato", partecipazione: "libera" };
  if (/^P7_3$/.test(t)) return { tipo: "sistema_qualificazione", partecipazione: "iscrizione" };
  return null;
}

export function opportunita(tipo: TipoOpportunita): Opportunita {
  return { tipo, partecipazione: PARTECIPAZIONE[tipo] };
}

export function entraInOpportunita(o: Opportunita): boolean {
  return o.partecipazione === "libera" || o.partecipazione === "iscrizione";
}

function norm(t: string | null | undefined): string {
  return (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Sintel: la modalità di scelta del contraente (valori letti nei dati aperti il 16/11/2026). Una modalità sconosciuta → null: la riga
// non entra finché la regola non viene aggiornata (mai indovinare).
export function opportunitaSintel(modalita: string | null | undefined): Opportunita | null {
  const m = norm(modalita);
  if (!m) return null;
  if (/^procedura aperta|^aperta\b|^procedura ristretta|^ristretta\b/.test(m)) return opportunita("bando");
  // nei dati: «Procedura negoziata con previa indizione di gara» (anche nella forma breve «Negoziata con previa indizione»)
  if (/^(procedura )?negoziata con previa (indizione|pubblicazione)|competitiva con negoziazione|dialogo competitivo|partenariato per l.innovazione/.test(m)) return opportunita("bando");
  if (/^sda\b.*bando istitutivo|sistema di qualificazione|^elenco/.test(m)) return opportunita("sistema_qualificazione");
  if (/^sda\b.*appalto specifico/.test(m)) return opportunita("riservata");
  if (/ad invito|^(procedura )?negoziata senza|^cottimo/.test(m)) return opportunita("riservata");
  if (/^affidamento diretto/.test(m)) return opportunita("affidamento_diretto");
  // «RDO per manifestazione di interesse», «RDO per indagine di mercato»: avvisi aperti come le manifestazioni e le indagini
  if (/manifestazione di interesse/.test(m)) return opportunita("manifestazione_interesse");
  if (/indagine di mercato/.test(m)) return opportunita("indagine_mercato");
  return null;
}

// Feed AF Soluzioni (SardegnaCAT): tipo dell'elemento (Bando/Avviso), tipo di procedura e testo dell'oggetto. Valori letti nel feed del
// 16/11/2026: Aperta, Negoziata, Affidamento Diretto; tipi Bando e Avviso (gli avvisi sono manifestazioni di interesse o indagini di
// mercato per procedure negoziate).
export function opportunitaAflink(tipo: string | null | undefined, tipoProcedura: string | null | undefined, testo: string | null | undefined): Opportunita | null {
  const t = norm(tipo);
  const p = norm(tipoProcedura);
  const o = norm(testo);
  if (t === "avviso") {
    if (/indagine di mercato/.test(o)) return opportunita("indagine_mercato");
    return opportunita("manifestazione_interesse");
  }
  if (t !== "bando") return null;
  if (/^affidamento diretto/.test(p)) return opportunita("affidamento_diretto");
  if (/^negoziata/.test(p)) return opportunita("riservata");
  if (/^aperta|^ristretta|competitiva con negoziazione|dialogo competitivo/.test(p)) return opportunita("bando");
  return null;
}
