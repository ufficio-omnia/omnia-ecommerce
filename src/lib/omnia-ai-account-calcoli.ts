// Ufficio Gare di OMNIA AI: un utente secondario per azienda, collegato al titolare dell'abbonamento, che
// lavora SOLO sulle gare. Qui i calcoli puri e i testi (nessun database, nessuna rete): chi è il titolare e
// chi l'Ufficio Gare, quali pagine e quali voci di menu spettano a ciascuno, come si valida l'invito, che
// cosa vede l'Ufficio Gare quando le gare finiscono. La lettura dal database sta in omnia-ai-account.ts;
// le guardie delle pagine e delle azioni in omnia-ai-account-guardie.ts.

export type RuoloAccount = "titolare" | "ufficio_gare";

export const RUOLO_UFFICIO_GARE: RuoloAccount = "ufficio_gare";

// ───── pagine e menu ─────

export const RADICE_AREA = "/dashboard/omnia-ai";

export type VoceMenu = { href: string; label: string };

// Le voci del titolare sono quelle di sempre, più «Ufficio Gare» (dove crea e gestisce l'utente).
export const VOCI_MENU_TITOLARE: VoceMenu[] = [
  { href: `${RADICE_AREA}`, label: "Dashboard" },
  { href: `${RADICE_AREA}/gare`, label: "Gare" },
  { href: `${RADICE_AREA}/documenti-aziendali`, label: "Documenti aziendali" },
  { href: `${RADICE_AREA}/profilo-azienda`, label: "Profilo azienda" },
  { href: `${RADICE_AREA}/abbonamento`, label: "Abbonamento" },
  { href: `${RADICE_AREA}/pagamenti`, label: "Pagamenti e fatture" },
  { href: `${RADICE_AREA}/documenti-contrattuali`, label: "Documenti contrattuali" },
  { href: `${RADICE_AREA}/ufficio-gare`, label: "Ufficio Gare" },
  { href: `${RADICE_AREA}/impostazioni`, label: "Impostazioni" },
];

// L'Ufficio Gare vede la dashboard e le gare. Il Supporto sta nel piede della barra, come per il titolare.
export const VOCI_MENU_UFFICIO_GARE: VoceMenu[] = [
  { href: `${RADICE_AREA}`, label: "Dashboard" },
  { href: `${RADICE_AREA}/gare`, label: "Gare" },
];

export function vociMenuPer(ruolo: RuoloAccount): VoceMenu[] {
  return ruolo === RUOLO_UFFICIO_GARE ? VOCI_MENU_UFFICIO_GARE : VOCI_MENU_TITOLARE;
}

// Le sole sezioni (sotto la radice dell'area) aperte all'Ufficio Gare. Tutto il resto è del titolare.
export const SEZIONI_UFFICIO_GARE = ["gare", "assistenza"] as const;

function sottoPercorso(percorso: string, base: string): boolean {
  return percorso === base || percorso.startsWith(`${base}/`);
}

// Il percorso (senza dominio né parametri) è aperto a questo ruolo? Il titolare vede tutto; l'Ufficio Gare
// solo la radice dell'area (la dashboard), le gare e il supporto: ogni altro percorso, anche fuori
// dall'area, per lui è «no» (la funzione si usa solo per le pagine dell'area riservata).
export function percorsoConsentito(ruolo: RuoloAccount, percorso: string): boolean {
  if (ruolo !== RUOLO_UFFICIO_GARE) return true;
  const pulito = percorso.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  // Un percorso con «..», «.» o segmenti vuoti (anche codificati) non si interpreta: per l'Ufficio Gare è chiuso.
  let decodificato: string;
  try {
    decodificato = decodeURIComponent(pulito);
  } catch {
    return false;
  }
  if (decodificato.split("/").slice(1).some((segmento) => segmento === "" || segmento === "." || segmento === "..")) return false;
  if (pulito === RADICE_AREA) return true;
  return SEZIONI_UFFICIO_GARE.some((sezione) => sottoPercorso(pulito, `${RADICE_AREA}/${sezione}`));
}

// ───── invito ─────

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LUNGHEZZA_MASSIMA_EMAIL = 254;

export function normalizzaEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type EsitoInvito = { ok: true; email: string } | { ok: false; errore: string };

export function validaInvitoUfficioGare({
  email,
  emailTitolare,
  consenso,
}: {
  email: string;
  emailTitolare: string | null | undefined;
  consenso: boolean;
}): EsitoInvito {
  const pulita = normalizzaEmail(email);
  if (!pulita) return { ok: false, errore: "Inserisci l'indirizzo email dell'Ufficio Gare." };
  if (pulita.length > LUNGHEZZA_MASSIMA_EMAIL || !FORMATO_EMAIL.test(pulita)) {
    return { ok: false, errore: "L'indirizzo email non è valido." };
  }
  if (emailTitolare && pulita === normalizzaEmail(emailTitolare)) {
    return { ok: false, errore: "Usa un indirizzo diverso dal tuo: l'Ufficio Gare è una persona (o una casella) distinta da te." };
  }
  if (!consenso) {
    return { ok: false, errore: "Conferma che la persona è autorizzata a trattare i dati della tua azienda in OMNIA AI." };
  }
  return { ok: true, email: pulita };
}

export const TESTO_CONSENSO_TITOLARE =
  "Confermo che questa persona è autorizzata a trattare, sotto la mia responsabilità, i dati della mia azienda in OMNIA AI (gare, documenti e relazioni).";

// ───── stato dell'Ufficio Gare, visto dal titolare ─────

export type StatoUfficioGare = "in_attesa" | "attivo" | "sospeso";

// «In attesa»: l'accesso è stato creato ma la persona non è ancora mai entrata (non ha scelto la password).
export function statoUfficioGare({ attivo, ultimoAccesso }: { attivo: boolean; ultimoAccesso: string | null }): StatoUfficioGare {
  if (!attivo) return "sospeso";
  return ultimoAccesso ? "attivo" : "in_attesa";
}

export const ETICHETTA_STATO_UFFICIO_GARE: Record<StatoUfficioGare, string> = {
  in_attesa: "In attesa del primo accesso",
  attivo: "Attivo",
  sospeso: "Sospeso",
};

export const SECONDI_TRA_DUE_INVII = 60;

export type EsitoPermesso = { ok: true } | { ok: false; errore: string };

// Il link per scegliere la password si rinvia solo finché la persona non ha fatto il primo accesso (poi ha la
// sua password e, se la dimentica, usa «Password dimenticata»), e non più di una volta al minuto.
export function rinvioLinkPermesso({ stato, invitoInviatoIl, adesso }: { stato: StatoUfficioGare; invitoInviatoIl: string | null; adesso: Date }): EsitoPermesso {
  if (stato === "sospeso") return { ok: false, errore: "L'accesso è sospeso: riattivalo prima di rinviare il link." };
  if (stato === "attivo") {
    return { ok: false, errore: "L'Ufficio Gare ha già scelto la password. Se l'ha dimenticata, può usare «Password dimenticata» dalla pagina di accesso." };
  }
  if (invitoInviatoIl) {
    const passati = (adesso.getTime() - new Date(invitoInviatoIl).getTime()) / 1000;
    if (passati >= 0 && passati < SECONDI_TRA_DUE_INVII) return { ok: false, errore: "Il link è già stato inviato da meno di un minuto: attendi un momento e riprova." };
  }
  return { ok: true };
}

// ───── testi mostrati all'Ufficio Gare ─────

// Gare del piano, crediti e gare gratuite finite: l'Ufficio Gare non compra nulla, rimanda al titolare.
export const MESSAGGIO_UFFICIO_GARE_GARE_FINITE =
  "Le gare a disposizione sono finite. Ricorda al tuo amministratore di acquistare un upgrade del piano o dei crediti singoli per svolgere altre gare: le gare già avviate restano consultabili.";

// Abbonamento scaduto (sola lettura) o cessato: non si crea e non si analizza nulla, finché non lo riattiva il titolare.
export const MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO =
  "L'abbonamento dell'azienda non è attivo: non si possono avviare nuove analisi né creare nuove gare. Ricorda al tuo amministratore di riattivarlo; nel frattempo puoi consultare le gare esistenti e scaricare i documenti già generati.";

export const MESSAGGIO_UFFICIO_GARE_SOSPESO =
  "Il tuo accesso a OMNIA AI è stato sospeso dall'amministratore della tua azienda. Per riattivarlo rivolgiti a lui.";

export const MESSAGGIO_UFFICIO_GARE_VERIFICA_NON_RIUSCITA =
  "Non riesco a verificare il tuo accesso in questo momento. Riprova tra qualche istante.";

export const MESSAGGIO_UFFICIO_GARE_NON_AUTORIZZATO =
  "Questa funzione è riservata all'amministratore dell'azienda.";

// I dati di fatturazione dell'azienda (codice destinatario o PEC) mancano: il download dei documenti generati
// resta chiuso finché il titolare non li completa. L'Ufficio Gare non vede il profilo: gli si dice a chi rivolgersi.
export const MESSAGGIO_UFFICIO_GARE_FATTURAZIONE_INCOMPLETA =
  "Per scaricare i documenti generati servono i dati di fatturazione dell'azienda (codice destinatario o PEC): ricorda al tuo amministratore di completarli nel profilo azienda.";

export const MESSAGGIO_UFFICIO_GARE_REVISIONE =
  "La revisione umana la richiede e la paga l'amministratore dell'azienda: lo abbiamo avvisato, la troverà nella sua area riservata.";

export const MESSAGGIO_UFFICIO_GARE_REVISIONE_GIA_AVVISATO =
  "L'amministratore è già stato avvisato oggi per questa gara. La revisione umana la richiede e la paga lui dalla sua area riservata.";

// ───── avvisi al titolare: un solo giorno, quello italiano ─────

const FORMATO_GIORNO_ROMA = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });

// «2026-10-16»: la data di Roma, la stessa che il database dà alla colonna «giorno» (default in Europe/Rome).
export function giornoRoma(quando: Date): string {
  return FORMATO_GIORNO_ROMA.format(quando);
}

export type TipoAvvisoTitolare = "quota_esaurita" | "revisione_richiesta";

// Chiave di unicità dell'avviso (con titolare, tipo e giorno): la quota è una al giorno in tutto;
// la revisione una al giorno per ogni gara.
export function chiaveAvviso(tipo: TipoAvvisoTitolare, garaId?: string | null): string {
  return tipo === "revisione_richiesta" ? (garaId ?? "") : "";
}

// Il codice errore con cui il database dice «esiste già una riga identica»: l'avviso di oggi è già partito.
export function eAvvisoGiaInviato(errore: { code?: string } | null | undefined): boolean {
  return errore?.code === "23505";
}

export type MotivoQuotaFinita = "gare_finite" | "abbonamento_non_attivo";

export function messaggioPerUfficioGare(motivo: MotivoQuotaFinita): string {
  return motivo === "abbonamento_non_attivo" ? MESSAGGIO_UFFICIO_GARE_ABBONAMENTO_NON_ATTIVO : MESSAGGIO_UFFICIO_GARE_GARE_FINITE;
}

// ───── quando avvisare il titolare ─────

export type StatoAccessoPerAvviso = "attivo" | "prova" | "sola_lettura" | "cessato";
export type MotivoDirittoPerAvviso = "gia_consumata" | "gia_analizzata" | "quota_disponibile" | "quota_esaurita" | "gratuite_esaurite" | "verifica_non_riuscita" | null;

// Perché l'Ufficio Gare è fermo, se lo è davvero. Abbonamento non attivo (sola lettura o cessato): manca
// l'abbonamento. Abbonamento attivo o prova ma senza più gare né crediti: le gare sono finite. Una verifica
// che non è riuscita NON è «gare finite» (non si avvisa nessuno per un dato che non si ha); gli altri casi: nessun motivo.
export function motivoAvvisoTitolare({ stato, diritto }: { stato: StatoAccessoPerAvviso; diritto: MotivoDirittoPerAvviso }): MotivoQuotaFinita | null {
  if (stato === "sola_lettura" || stato === "cessato") return "abbonamento_non_attivo";
  if (diritto === "quota_esaurita" || diritto === "gratuite_esaurite") return "gare_finite";
  return null;
}

// Il testo che un'azione bloccata restituisce: all'Ufficio Gare mai i testi del titolare (che parlano di
// acquistare crediti e di piani), solo il promemoria per l'amministratore.
export function testoBloccoPerRuolo(ruolo: RuoloAccount, motivo: MotivoQuotaFinita, testoDelTitolare: string): string {
  return ruolo === RUOLO_UFFICIO_GARE ? messaggioPerUfficioGare(motivo) : testoDelTitolare;
}
