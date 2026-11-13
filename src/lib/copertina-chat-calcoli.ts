// La CHAT per modificare una copertina della relazione tecnica (richiesta dell'utente, 13/11/2026). Regole pure, senza rete né database:
//   - si apre solo DOPO le 6 generazioni della gara (3 stilizzate e 3 realistiche: decisione dell'utente);
//   - il cliente sceglie con un flag la copertina da modificare e scrive cosa vuole cambiare (sfondo, colori, testi, posizione e dimensione dei loghi, un
//     logo nuovo allegato in chat, togliere un logo: qualsiasi cosa sulla copertina);
//   - al massimo 3 NUOVE copertine; conta solo quando la chat consegna una copertina (decisione dell'utente): una domanda, una richiesta poco chiara o fuori
//     tema non consuma nulla. C'è comunque un tetto ai messaggi del cliente, contro gli abusi. Dopo le 3 copertine la chat si chiude;
//   - ogni copertina nuova si consegna in PNG e PDF e continua la numerazione «COPERTINA N.x».
// Come si modifica senza perdere i loghi: il modello ritocca la pagina SENZA loghi (salvata accanto a ogni copertina dal 13/11/2026) e poi il codice
// riapplica i loghi originali dove e quanto grandi li vuole il cliente. Spostare, ingrandire, togliere o sostituire un logo non chiede nulla al modello.
// Un modello di testo legge la richiesta e la trasforma in un piano (SCHEMA_RICHIESTA): cosa cambiare nell'immagine, quali testi, dove vanno i loghi.

import { COPERTINE_PER_STILE, MINUTI_GENERAZIONE_INTERROTTA, type UsoCopertine } from "@/lib/copertina-diritto-calcoli";
import { DIMENSIONI, ETICHETTA_POSIZIONE, POSIZIONE_PREDEFINITA, POSIZIONI, normalizzaDimensione, normalizzaPosizione, zonaPer, type Dimensione, type Posizione } from "@/lib/copertina-loghi-calcoli";
import { SOTTOTITOLO_MASSIMO, TITOLO_PRINCIPALE_MASSIMO, cigPerCopertina, normalizzaStile, pulisciTesto, rigaTitolo, type Stile } from "@/lib/copertina-relazione-calcoli";

// ───── Limiti ─────
export const MODIFICHE_MASSIME = 3;
export const MESSAGGI_MASSIMI = 15;
export const RICHIESTA_MASSIMA = 1200;
export const ALLEGATO_MASSIMO_BYTE = 5 * 1024 * 1024;
export const TIPI_ALLEGATO: Record<string, "png" | "jpg" | "webp"> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const CHI_LOGO = ["stazione", "cliente"] as const;
export type ChiLogo = (typeof CHI_LOGO)[number];

// ───── Quando si apre e quanto resta ─────

// Dopo le 6 generazioni: 3 stilizzate E 3 realistiche (quelle che contano: pronte, o in corso da poco)
export function chatAperta(uso: Pick<UsoCopertine, "perStile">): boolean {
  return uso.perStile.stilizzato >= COPERTINE_PER_STILE && uso.perStile.realistico >= COPERTINE_PER_STILE;
}

export type RigaChat = {
  id: string;
  ruolo: "cliente" | "assistente";
  testo: string;
  // per l'assistente: la copertina consegnata (id dei file); per il cliente: quella scelta da modificare
  copertina: string | null;
  // un logo allegato dal cliente (percorso nel bucket «gare») e per quale logo
  allegato: string | null;
  allegato_per: ChiLogo | null;
  // solo per le risposte dell'assistente che preparano una copertina
  stato: "in_corso" | "pronta" | null;
  creata_il: string;
};

// Le copertine consegnate che contano: pronte, o in preparazione da meno di 20 minuti (una preparazione interrotta smette di contare da sola)
export function modificheContate(righe: RigaChat[], adesso: Date): RigaChat[] {
  const limite = adesso.getTime() - MINUTI_GENERAZIONE_INTERROTTA * 60_000;
  return righe.filter((r) => r.ruolo === "assistente" && (r.stato === "pronta" || (r.stato === "in_corso" && new Date(r.creata_il).getTime() >= limite)));
}

// La copertina su cui si lavora (richiesta dell'utente, 13/11/2026): la scelta si fa UNA volta, con il primo messaggio; poi la chat continua sempre sulla
// stessa copertina, ripartendo dall'ultima versione consegnata. `scelta` = quella scelta col flag; `ultima` = l'ultima versione (quella da modificare
// adesso). null se il cliente non ha ancora scelto (primo messaggio da scrivere).
export function copertinaDiLavoro(righe: RigaChat[]): { scelta: string; ultima: string } | null {
  const ordinate = [...righe].sort((a, b) => (a.creata_il < b.creata_il ? -1 : a.creata_il > b.creata_il ? 1 : 0));
  const primo = ordinate.find((r) => r.ruolo === "cliente" && r.copertina);
  if (!primo?.copertina) return null;
  const consegnate = ordinate.filter((r) => r.ruolo === "assistente" && r.stato === "pronta" && r.copertina);
  return { scelta: primo.copertina, ultima: consegnate.length ? (consegnate[consegnate.length - 1].copertina as string) : primo.copertina };
}

export type StatoChat = {
  aperta: boolean;
  modificheFatte: number;
  modificheRimaste: number;
  messaggiCliente: number;
  inCorso: boolean;
  puoScrivere: boolean;
  // perché non si può scrivere (null se si può)
  motivo: string | null;
};

export const MESSAGGIO_CHAT_CHIUSA_PRIMA = "La chat per modificare le copertine si apre dopo le 6 generazioni (3 stilizzate e 3 realistiche).";
export const MESSAGGIO_CHAT_FINITA = `Hai usato le ${MODIFICHE_MASSIME} modifiche disponibili per questa gara: la chat è chiusa. Puoi sempre scaricare tutte le copertine qui sopra.`;
export const MESSAGGIO_TROPPI_MESSAGGI = `Hai raggiunto il numero massimo di messaggi (${MESSAGGI_MASSIMI}) per questa chat.`;
export const MESSAGGIO_IN_CORSO = "Sto ancora preparando la copertina richiesta: attendi che sia pronta.";

export function statoChat(params: { aperta: boolean; righe: RigaChat[]; adesso: Date; diritto: { ok: boolean; messaggio: string | null } }): StatoChat {
  const contate = modificheContate(params.righe, params.adesso);
  const fatte = contate.length;
  const inCorso = contate.some((r) => r.stato === "in_corso");
  const messaggiCliente = params.righe.filter((r) => r.ruolo === "cliente").length;
  const rimaste = Math.max(0, MODIFICHE_MASSIME - fatte);
  let motivo: string | null = null;
  if (!params.aperta) motivo = MESSAGGIO_CHAT_CHIUSA_PRIMA;
  else if (rimaste === 0) motivo = MESSAGGIO_CHAT_FINITA;
  else if (messaggiCliente >= MESSAGGI_MASSIMI) motivo = MESSAGGIO_TROPPI_MESSAGGI;
  else if (!params.diritto.ok) motivo = params.diritto.messaggio ?? "La copertina non è disponibile in questo momento.";
  else if (inCorso) motivo = MESSAGGIO_IN_CORSO;
  return { aperta: params.aperta, modificheFatte: fatte, modificheRimaste: rimaste, messaggiCliente, inCorso, puoScrivere: motivo === null, motivo };
}

// ───── La scheda di una copertina ─────
// Salvata accanto a ogni copertina (file «.json»): con questa e la pagina senza loghi la copertina si può modificare. I percorsi dei loghi si accettano
// solo se sono di questa gara (bucket «gare», cartella della gara) o del profilo azienda del cliente (bucket «company-assets», cartella dell'account).

export type LogoNellaScheda = { bucket: "gare" | "company-assets"; percorso: string; posizione: Posizione; dimensione: Dimensione };
export type SchedaCopertina = {
  versione: 1;
  stile: Stile;
  testi: { titoloPrincipale: string; titolo: string; cig: string | null };
  loghi: Record<ChiLogo, LogoNellaScheda | null>;
  // la copertina da cui è nata (solo per quelle modificate in chat)
  origine: string | null;
  // il nome dell'ente che ha bandito la gara (dalla gara o letto dal documento), per capire in chat di chi è un logo; c'è dalle copertine del 13/11/2026
  ente?: string;
};

const PERCORSO_SICURO = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/;

export function percorsoLogoAmmesso(logo: Pick<LogoNellaScheda, "bucket" | "percorso">, garaId: string, accountId: string): boolean {
  if (!PERCORSO_SICURO.test(logo.percorso) || logo.percorso.includes("..")) return false;
  return logo.bucket === "gare" ? logo.percorso.startsWith(`${garaId}/`) : logo.percorso.startsWith(`${accountId}/`);
}

function logoDaJson(valore: unknown, garaId: string, accountId: string): LogoNellaScheda | null {
  const v = valore as Partial<LogoNellaScheda> | null;
  if (!v || (v.bucket !== "gare" && v.bucket !== "company-assets") || typeof v.percorso !== "string") return null;
  const posizione = normalizzaPosizione(v.posizione);
  const dimensione = normalizzaDimensione(v.dimensione);
  if (!posizione || !dimensione) return null;
  const logo = { bucket: v.bucket, percorso: v.percorso, posizione, dimensione };
  return percorsoLogoAmmesso(logo, garaId, accountId) ? logo : null;
}

export function schedaDaJson(valore: unknown, garaId: string, accountId: string): SchedaCopertina | null {
  const v = valore as { versione?: unknown; stile?: unknown; testi?: Record<string, unknown>; loghi?: Record<string, unknown>; origine?: unknown; ente?: unknown } | null;
  if (!v || v.versione !== 1) return null;
  const stile = normalizzaStile(v.stile);
  if (!stile || !v.testi || !v.loghi) return null;
  const titolo = pulisciTesto(v.testi.titolo, SOTTOTITOLO_MASSIMO);
  const titoloPrincipale = pulisciTesto(v.testi.titoloPrincipale, TITOLO_PRINCIPALE_MASSIMO);
  if (!titolo || !titoloPrincipale) return null;
  return {
    versione: 1,
    stile,
    testi: { titoloPrincipale, titolo, cig: cigPerCopertina(v.testi.cig) },
    loghi: { stazione: logoDaJson(v.loghi.stazione, garaId, accountId), cliente: logoDaJson(v.loghi.cliente, garaId, accountId) },
    origine: typeof v.origine === "string" && /^copertina-[0-9TZ]+-(stilizzato|realistico)(-modifica)?$/.test(v.origine) ? v.origine : null,
    ...entePerScheda(v.ente),
  };
}

// Il nome dell'ente nella scheda: solo se c'è, ripulito e corto
export function entePerScheda(valore: unknown): { ente?: string } {
  const ente = pulisciTesto(valore, NOME_MASSIMO);
  return ente ? { ente } : {};
}

// ───── La richiesta del cliente → il piano ─────

// `rimetti`: rimettere un logo che adesso non c'è (tolto prima per errore), preso dalla copertina di partenza o dall'ultimo allegato (vedi loghiDiRiserva)
export type CambioLogo = { posizione: Posizione | "invariata"; dimensione: Dimensione | "invariata"; togli: boolean; rimetti?: boolean };
export type PianoModifica = {
  esito: "modifica" | "risposta";
  // la frase per il cliente (cosa si sta per fare, o la domanda/spiegazione se non si modifica)
  messaggio: string;
  // per chi ritocca l'immagine: sfondo, colori, elementi, stile (vuoto se cambiano solo testi o loghi). Mai i loghi.
  istruzioniImmagine: string;
  // i testi NUOVI (null = invariato)
  titoloPrincipale: string | null;
  sottotitolo: string | null;
  cig: string | null;
  loghi: Record<ChiLogo, CambioLogo>;
};

const enumPosizione = { type: "string", enum: [...POSIZIONI, "invariata"] };
const enumDimensione = { type: "string", enum: [...DIMENSIONI, "invariata"] };
const schemaLogo = {
  type: "object",
  additionalProperties: false,
  required: ["posizione", "dimensione", "togli", "rimetti"],
  properties: { posizione: enumPosizione, dimensione: enumDimensione, togli: { type: "boolean" }, rimetti: { type: "boolean" } },
};

export const SCHEMA_RICHIESTA = {
  type: "object",
  additionalProperties: false,
  required: ["esito", "messaggio", "istruzioni_immagine", "titolo_principale", "sottotitolo", "cig", "logo_stazione", "logo_cliente"],
  properties: {
    esito: { type: "string", enum: ["modifica", "risposta"] },
    messaggio: { type: "string" },
    istruzioni_immagine: { type: "string" },
    titolo_principale: { type: ["string", "null"] },
    sottotitolo: { type: ["string", "null"] },
    cig: { type: ["string", "null"] },
    logo_stazione: schemaLogo,
    logo_cliente: schemaLogo,
  },
} as const;

export const ISTRUZIONI_RICHIESTA = [
  "Sei l'assistente che modifica la copertina della relazione tecnica di una gara d'appalto. Il cliente ha scelto una copertina e ti scrive cosa vuole cambiare.",
  "Si può cambiare qualsiasi cosa: lo sfondo (immagini, colori, stile, luce, elementi da aggiungere o togliere), i testi (titolo principale, sottotitolo, CIG), la posizione e la dimensione dei due loghi (quello della stazione appaltante e quello del cliente), togliere un logo, usare il logo che il cliente ha allegato.",
  "I LOGHI NON SI DISEGNANO: li applica il sistema, originali. Per spostarli, ingrandirli, rimpicciolirli o toglierli usa SOLO i campi logo_stazione e logo_cliente (posizioni: alto-sinistra, alto-centro, alto-destra, basso-sinistra, basso-centro, basso-destra; dimensioni: piccolo, medio, grande; «invariata» se non cambia). In istruzioni_immagine non parlare MAI di loghi, stemmi o marchi.",
  "CHI È CHI: i due loghi sono di due soggetti diversi. La STAZIONE APPALTANTE è l'ente che ha bandito la gara (il suo nome è in «CHI È CHI»): il suo logo è logo_stazione. Il CLIENTE è l'azienda che ti scrive: il suo logo è logo_cliente, ed è quello che il cliente chiama «nostro», «mio», «della nostra azienda». Se il cliente nomina un logo con il nome di uno dei due soggetti, usa quel soggetto. Se il nome della stazione appaltante non è indicato, ricavalo dal titolo della gara e dal sottotitolo della copertina: un logo chiamato col nome di un ente (comune, teatro, ospedale, università, azienda pubblica…) che non è l'azienda del cliente è il logo della stazione appaltante. Se non riesci a capire con certezza di quale logo parla, chiediglielo (esito «risposta»).",
  "Cambia SOLO quello che il cliente chiede: un logo che il cliente non nomina resta com'è (posizione e dimensione «invariata», togli e rimetti false). Togli un logo SOLO se il cliente chiede esplicitamente di toglierlo. rimetti true SOLO per rimettere un logo che adesso è assente (per esempio tolto prima per errore): torna dov'era nella COPERTINA PRECEDENTE (o in quella di partenza), se non indichi un'altra posizione.",
  "LA CONVERSAZIONE: leggi i messaggi precedenti per capire a cosa si riferisce il cliente. Se dice che hai capito male o che la modifica precedente è sbagliata, nella STESSA risposta fai due cose: (1) rimetti com'era PRIMA dell'errore quello che avevi cambiato per sbaglio: se l'errore è nell'ultima modifica, posizione e dimensione dei loghi della COPERTINA PRECEDENTE (non quella di partenza); se è più indietro, lo stato dei loghi scritto nella conversazione; rimetti true per un logo tolto per errore; (2) fai quello che il cliente aveva chiesto davvero nel messaggio che avevi capito male.",
  "Se c'è un logo allegato, il sistema lo usa già al posto di quello indicato dal cliente: non serve dire altro, a meno che il cliente chieda anche di spostarlo o ridimensionarlo.",
  "Se la richiesta è chiara: esito «modifica». In istruzioni_immagine scrivi in italiano, in modo preciso e concreto, le modifiche all'immagine (sfondo, colori, elementi, stile); lascialo vuoto se cambiano solo testi o loghi. Nei campi titolo_principale, sottotitolo e cig metti il NUOVO testo esattamente come lo vuole il cliente, solo se chiede di cambiarlo (altrimenti null; per togliere il CIG scrivi una stringa vuota). In messaggio una frase breve e cordiale che dice cosa stai per fare.",
  "Se la richiesta non è chiara o manca un'informazione: esito «risposta», e in messaggio la domanda per il cliente. Se chiede qualcosa che non riguarda la copertina: esito «risposta», e in messaggio spiega gentilmente che qui puoi solo modificare la copertina.",
  "Non inventare testi, CIG, nomi o dati: usa solo quelli scritti dal cliente o quelli attuali della copertina. Rispondi sempre in italiano.",
].join("\n");

// Ciò che l'interprete deve sapere oltre alla copertina (correzione del 13/11/2026, dopo la prova sulla gara Teatro alla Scala: senza i nomi l'interprete
// ha spostato il logo sbagliato, e senza i messaggi precedenti ha letto la correzione «non il nostro logo» come «togli il nostro logo»).
export type MessaggioStoria = {
  ruolo: "cliente" | "assistente";
  testo: string;
  numeroSu: number | null;
  numeroConsegnata: number | null;
  conAllegato: ChiLogo | null;
  // com'erano i loghi nella copertina consegnata (per rimettere a posto un errore tornando alla versione GIUSTA precedente, non sempre alla partenza)
  loghiConsegnata?: Record<ChiLogo, LogoNellaScheda | null> | null;
};
export type ContestoInterprete = {
  // i nomi dei due soggetti (null se non si conoscono)
  nomi: Record<ChiLogo, string | null>;
  // il titolo della gara: un indizio in più su chi è la stazione appaltante quando il suo nome manca
  titoloGara?: string | null;
  // i messaggi precedenti della chat, dal più vecchio (al massimo STORIA_MASSIMA, già accorciati)
  storia: MessaggioStoria[];
  // la copertina scelta all'inizio: com'erano i loghi prima di ogni modifica in chat
  partenza: { numero: number | null; scheda: SchedaCopertina } | null;
  // la copertina da cui è nata quella da modificare adesso: per annullare l'ULTIMA modifica (un errore) si torna a questa
  precedente?: { numero: number | null; scheda: SchedaCopertina } | null;
};

export const STORIA_MASSIMA = 10;
const STORIA_TESTO_MASSIMO = 400;
export const NOME_MASSIMO = 150;

// I messaggi precedenti, come li legge l'interprete: solo quelli scambiati davvero (non le copertine in preparazione o interrotte), gli ultimi STORIA_MASSIMA.
// `schede`: le schede delle copertine consegnate, per dire com'erano i loghi in ognuna.
export function storiaPerInterprete(righe: RigaChat[], numeri: Map<string, number>, schede?: Map<string, SchedaCopertina | null>): MessaggioStoria[] {
  return [...righe]
    .sort((a, b) => (a.creata_il < b.creata_il ? -1 : a.creata_il > b.creata_il ? 1 : 0))
    .filter((r) => r.ruolo === "cliente" || r.stato === null || r.stato === "pronta")
    .slice(-STORIA_MASSIMA)
    .map((r) => {
      const testo = r.testo.replace(/\s+/g, " ").trim();
      return {
        ruolo: r.ruolo,
        testo: testo.length > STORIA_TESTO_MASSIMO ? `${testo.slice(0, STORIA_TESTO_MASSIMO)}…` : testo,
        numeroSu: r.ruolo === "cliente" && r.copertina ? (numeri.get(r.copertina) ?? null) : null,
        numeroConsegnata: r.ruolo === "assistente" && r.copertina ? (numeri.get(r.copertina) ?? null) : null,
        conAllegato: r.ruolo === "cliente" && r.allegato ? r.allegato_per : null,
        loghiConsegnata: r.ruolo === "assistente" && r.copertina ? (schede?.get(r.copertina)?.loghi ?? null) : null,
      };
    });
}

const descriviLogo = (l: LogoNellaScheda | null) => (l ? `${ETICHETTA_POSIZIONE[l.posizione]}, dimensione ${l.dimensione}` : "assente");

// Il messaggio per il modello di testo: chi è chi, la conversazione finora, com'erano i loghi all'inizio, com'è adesso la copertina e cosa chiede il cliente
export function messaggioPerInterprete(params: { scheda: SchedaCopertina; numero: number | null; richiesta: string; allegatoPer: ChiLogo | null; contesto?: ContestoInterprete }): string {
  const { scheda, contesto } = params;
  const nome = (chi: ChiLogo) => {
    const n = contesto?.nomi[chi]?.replace(/\s+/g, " ").trim().slice(0, NOME_MASSIMO);
    return n ? `«${n}»` : "nome non indicato";
  };
  const righe: string[] = [
    "CHI È CHI:",
    `- stazione appaltante (l'ente che ha bandito la gara): ${nome("stazione")} → il suo logo è logo_stazione`,
    `- cliente (l'azienda che ti scrive: «nostro», «mio»): ${nome("cliente")} → il suo logo è logo_cliente`,
  ];
  const titoloGara = contesto?.titoloGara?.replace(/\s+/g, " ").trim().slice(0, NOME_MASSIMO);
  if (titoloGara) righe.push(`- la gara: «${titoloGara}»`);
  if (contesto?.storia.length) {
    righe.push("", "CONVERSAZIONE FINORA (dal messaggio più vecchio):");
    for (const m of contesto.storia) {
      if (m.ruolo === "cliente") {
        const su = m.numeroSu ? ` (su COPERTINA N.${m.numeroSu})` : "";
        const allegato = m.conAllegato ? ` [ha allegato un nuovo ${m.conAllegato === "cliente" ? "logo del cliente" : "logo della stazione appaltante"}]` : "";
        righe.push(`CLIENTE${su}${allegato}: ${m.testo}`);
      } else {
        const loghiDopo = m.loghiConsegnata ? `: logo della stazione appaltante ${descriviLogo(m.loghiConsegnata.stazione)}; logo del cliente ${descriviLogo(m.loghiConsegnata.cliente)}` : "";
        righe.push(`ASSISTENTE: ${m.testo}${m.numeroConsegnata ? ` [ha consegnato la COPERTINA N.${m.numeroConsegnata}${loghiDopo}]` : ""}`);
      }
    }
  }
  const precedente = contesto?.precedente ?? null;
  const partenzaUguale = Boolean(precedente && contesto?.partenza && precedente.numero !== null && precedente.numero === contesto.partenza.numero);
  if (contesto?.partenza && !partenzaUguale) {
    const p = contesto.partenza;
    righe.push(
      "",
      `COPERTINA DI PARTENZA${p.numero ? ` (COPERTINA N.${p.numero}, scelta dal cliente all'inizio)` : ""}, prima di ogni modifica in chat:`,
      `- logo della stazione appaltante: ${descriviLogo(p.scheda.loghi.stazione)}`,
      `- logo del cliente: ${descriviLogo(p.scheda.loghi.cliente)}`,
    );
  }
  if (precedente) {
    righe.push(
      "",
      `COPERTINA PRECEDENTE${precedente.numero ? ` (COPERTINA N.${precedente.numero}` : " ("}${partenzaUguale ? ", la copertina di partenza scelta dal cliente" : ""}, da cui è nata quella da modificare adesso: per annullare l'ultima modifica si torna a questa):`,
      `- logo della stazione appaltante: ${descriviLogo(precedente.scheda.loghi.stazione)}`,
      `- logo del cliente: ${descriviLogo(precedente.scheda.loghi.cliente)}`,
    );
  }
  righe.push(
    "",
    `COPERTINA DA MODIFICARE ADESSO${params.numero ? ` (COPERTINA N.${params.numero})` : ""}, stile ${scheda.stile}:`,
    `- titolo principale: «${scheda.testi.titoloPrincipale}»`,
    `- sottotitolo: «${scheda.testi.titolo}»`,
    `- CIG: ${scheda.testi.cig ?? "nessuno"}`,
    `- logo della stazione appaltante: ${descriviLogo(scheda.loghi.stazione)}`,
    `- logo del cliente: ${descriviLogo(scheda.loghi.cliente)}`,
    params.allegatoPer ? `- il cliente ha ALLEGATO un nuovo ${params.allegatoPer === "cliente" ? "logo del cliente (il suo)" : "logo della stazione appaltante"}: il sistema lo usa al posto di quello attuale` : "- nessun file allegato",
    "",
    "RICHIESTA DEL CLIENTE (adesso):",
    params.richiesta,
  );
  return righe.join("\n");
}

const TESTO_MESSAGGIO_MASSIMO = 800;
const ISTRUZIONI_MASSIME = 1500;

// Dalla risposta del modello di testo al piano, controllato: valori fuori dagli elenchi, testi troppo lunghi o CIG con la forma sbagliata non passano.
// null se la risposta non è utilizzabile.
export function leggiPiano(testo: string | null): PianoModifica | null {
  if (!testo) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(testo);
  } catch {
    return null;
  }
  if (!v || (v.esito !== "modifica" && v.esito !== "risposta")) return null;
  const messaggio = pulisciTesto(v.messaggio, TESTO_MESSAGGIO_MASSIMO);
  if (!messaggio) return null;
  const cambio = (x: unknown): CambioLogo => {
    const c = x as { posizione?: unknown; dimensione?: unknown; togli?: unknown; rimetti?: unknown } | null;
    return {
      posizione: normalizzaPosizione(c?.posizione) ?? "invariata",
      dimensione: normalizzaDimensione(c?.dimensione) ?? "invariata",
      togli: c?.togli === true,
      rimetti: c?.rimetti === true,
    };
  };
  const testoNuovo = (x: unknown, massimo: number) => (typeof x === "string" ? pulisciTesto(x, massimo) || null : null);
  // il CIG: una stringa vuota vuol dire «togli il CIG»; un CIG con la forma sbagliata non si usa (resta quello di prima)
  let cig: string | null = null;
  if (typeof v.cig === "string") cig = v.cig.trim() === "" ? "" : cigPerCopertina(v.cig.replace(/^CIG\s*[:.-]?\s*/i, ""));
  return {
    esito: v.esito,
    messaggio,
    istruzioniImmagine: typeof v.istruzioni_immagine === "string" ? pulisciTesto(v.istruzioni_immagine, ISTRUZIONI_MASSIME) : "",
    titoloPrincipale: testoNuovo(v.titolo_principale, TITOLO_PRINCIPALE_MASSIMO),
    sottotitolo: testoNuovo(v.sottotitolo, SOTTOTITOLO_MASSIMO),
    cig,
    loghi: { stazione: cambio(v.logo_stazione), cliente: cambio(v.logo_cliente) },
  };
}

// ───── Controlli sul piano, nel codice (non basta chiederlo al modello) ─────

// Parole con cui si chiede di togliere qualcosa. Senza nessuna di queste un «togli» del modello non vale: sulla gara Teatro alla Scala «non il nostro logo»
// (una correzione) era diventato «togli il nostro logo».
const PAROLE_TOGLIERE = /(togl|rimuov|elimin|\bleva|\blevar|cancell|\bsenza\b|nascond|non (?:mettere|metterlo|metterla|voglio|mostrare|deve|serve)|\bvia\b)/i;

// Parole troppo generiche per riconoscere un soggetto dal nome
// (non «comune», «provincia», «fondazione»…: «il logo del comune» indica proprio la stazione appaltante; una parola presente in tutti e due i nomi non conta)
const PAROLE_GENERICHE = new Set(["azienda", "ente", "enti", "societa", "servizi", "servizio", "della", "delle", "dello", "degli", "dell", "nazionale", "italia", "italiana", "pubblica", "pubblico", "citta", "metropolitana", "s.r.l", "s.p.a", "srls", "spa", "srl", "snc", "sas", "coop", "cooperativa", "sociale", "group", "gruppo", "logo"]);

const senzaAccenti = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const paroleDistintive = (nome: string | null, altro: string | null): string[] => {
  if (!nome) return [];
  const dellAltro = new Set(senzaAccenti(altro ?? "").split(/[^a-z0-9.]+/));
  return [...new Set(senzaAccenti(nome).split(/[^a-z0-9.]+/))].filter((p) => p.length >= 4 && !PAROLE_GENERICHE.has(p) && !dellAltro.has(p));
};
const contieneParola = (testo: string, parola: string) => new RegExp(`(^|[^a-z0-9])${parola.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(testo);

// Di quali loghi parla la richiesta, a parole (nomi dei soggetti, «nostro», «stazione appaltante»…)
export function loghiNominati(richiesta: string, nomi: Record<ChiLogo, string | null>): Record<ChiLogo, boolean> {
  const t = senzaAccenti(richiesta);
  const stazione = /stazione appaltante|\bappaltante\b|\bcommittente\b|\bl'ente\b|\bdell'ente\b|\bamministrazione\b/.test(t) || paroleDistintive(nomi.stazione, nomi.cliente).some((p) => contieneParola(t, p));
  const cliente = /\b(nostr[oaie]|mio|mia|miei|mie|cliente)\b/.test(t) || paroleDistintive(nomi.cliente, nomi.stazione).some((p) => contieneParola(t, p));
  return { stazione, cliente };
}

const cambiaLogo = (c: CambioLogo) => c.posizione !== "invariata" || c.dimensione !== "invariata" || c.togli || c.rimetti === true;

// Il piano controllato prima di usarlo: un «togli» senza che il cliente abbia chiesto di togliere non vale; se il cliente nomina UN solo logo e il modello
// vuole cambiare solo l'ALTRO, non si consuma una copertina: si chiede quale dei due (una domanda non consuma).
export function verificaPiano(params: { piano: PianoModifica; richiesta: string; nomi: Record<ChiLogo, string | null> }): { piano: PianoModifica; domanda: string | null } {
  const { richiesta, nomi } = params;
  const chiedeDiTogliere = PAROLE_TOGLIERE.test(senzaAccenti(richiesta));
  const loghi = { ...params.piano.loghi };
  for (const chi of CHI_LOGO) if (loghi[chi].togli && !chiedeDiTogliere) loghi[chi] = { ...loghi[chi], togli: false };
  const piano = { ...params.piano, loghi };
  if (piano.esito !== "modifica") return { piano, domanda: null };
  const nominati = loghiNominati(richiesta, nomi);
  for (const [nominato, toccato] of [["stazione", "cliente"], ["cliente", "stazione"]] as const) {
    if (nominati[nominato] && !nominati[toccato] && cambiaLogo(loghi[toccato]) && !cambiaLogo(loghi[nominato])) {
      const nomeStazione = nomi.stazione ? ` (${nomi.stazione.replace(/\s+/g, " ").trim().slice(0, NOME_MASSIMO)})` : "";
      return { piano, domanda: `Vuoi che modifichi il logo della stazione appaltante${nomeStazione} o il logo della tua azienda? Scrivimelo e preparo la copertina.` };
    }
  }
  return { piano, domanda: null };
}

// La copertina nuova sarebbe uguale a quella di partenza (niente da ritoccare, stessi testi, stessi loghi negli stessi posti): non si prepara e non si consuma
export function pianoSenzaEffetti(piano: PianoModifica, prima: SchedaCopertina, dopo: SchedaCopertina): boolean {
  if (serveRitocco(piano, prima, dopo)) return false;
  return CHI_LOGO.every((chi) => {
    const a = prima.loghi[chi];
    const b = dopo.loghi[chi];
    if (!a || !b) return a === b;
    return a.bucket === b.bucket && a.percorso === b.percorso && a.posizione === b.posizione && a.dimensione === b.dimensione;
  });
}

export const MESSAGGIO_SENZA_EFFETTI = "Così la copertina resterebbe uguale a quella attuale: dimmi cosa vuoi cambiare (per esempio la posizione di un logo, i colori dello sfondo o un testo) e la preparo.";

// I loghi da usare per «rimettere» un logo tolto: l'ultimo allegato in chat per quel soggetto, altrimenti quello della copertina precedente o di partenza
// (nella posizione e dimensione che aveva lì). Un allegato fuori dalla cartella della gara non si usa.
export function loghiDiRiserva(righe: RigaChat[], partenza: SchedaCopertina | null, garaId: string, precedente: SchedaCopertina | null = null): Record<ChiLogo, LogoNellaScheda | null> {
  const ordinate = [...righe].sort((a, b) => (a.creata_il < b.creata_il ? -1 : a.creata_il > b.creata_il ? 1 : 0));
  const riserva = {} as Record<ChiLogo, LogoNellaScheda | null>;
  for (const chi of CHI_LOGO) {
    // prima la copertina precedente (annullare l'ultima modifica), poi quella di partenza
    const base = precedente?.loghi[chi] ?? partenza?.loghi[chi] ?? null;
    const allegati = ordinate.filter((r) => r.ruolo === "cliente" && r.allegato && r.allegato_per === chi && percorsoLogoAmmesso({ bucket: "gare", percorso: r.allegato }, garaId, ""));
    const ultimo = allegati.length ? (allegati[allegati.length - 1].allegato as string) : null;
    riserva[chi] = ultimo
      ? { bucket: "gare", percorso: ultimo, posizione: base?.posizione ?? POSIZIONE_PREDEFINITA[chi], dimensione: base?.dimensione ?? "medio" }
      : base;
  }
  return riserva;
}

// ───── Il piano applicato alla scheda ─────
// La scheda NUOVA: testi cambiati, loghi spostati/ridimensionati/tolti/rimessi, e il logo allegato al posto di quello indicato dal cliente (con la posizione
// di prima, o quella predefinita se quel logo non c'era).
export function applicaPiano(params: {
  scheda: SchedaCopertina;
  piano: PianoModifica;
  allegato: { per: ChiLogo; percorso: string } | null;
  origine: string;
  // i loghi per rimettere un logo tolto (loghiDiRiserva)
  riserva?: Record<ChiLogo, LogoNellaScheda | null>;
}): SchedaCopertina {
  const { scheda, piano, allegato } = params;
  const loghi = { ...scheda.loghi };
  for (const chi of CHI_LOGO) {
    let logo = loghi[chi];
    const cambio = piano.loghi[chi];
    if (!logo && cambio.rimetti && params.riserva?.[chi]) logo = { ...(params.riserva[chi] as LogoNellaScheda) };
    if (allegato?.per === chi) logo = { bucket: "gare", percorso: allegato.percorso, posizione: logo?.posizione ?? POSIZIONE_PREDEFINITA[chi], dimensione: logo?.dimensione ?? "medio" };
    if (logo && cambio.togli && !cambio.rimetti && allegato?.per !== chi) logo = null;
    if (logo) {
      logo = {
        ...logo,
        posizione: cambio.posizione === "invariata" ? logo.posizione : cambio.posizione,
        dimensione: cambio.dimensione === "invariata" ? logo.dimensione : cambio.dimensione,
      };
    }
    loghi[chi] = logo;
  }
  return {
    versione: 1,
    stile: scheda.stile,
    testi: {
      titoloPrincipale: piano.titoloPrincipale ?? scheda.testi.titoloPrincipale,
      titolo: piano.sottotitolo ?? scheda.testi.titolo,
      cig: piano.cig === null ? scheda.testi.cig : piano.cig === "" ? null : piano.cig,
    },
    loghi,
    origine: params.origine,
    ...entePerScheda(scheda.ente),
  };
}

// L'immagine va ritoccata dal modello? Solo se cambiano sfondo/colori/elementi o i testi (che sono disegnati nella pagina). Spostare, ridimensionare,
// togliere o sostituire un logo lo fa il codice: nessuna chiamata al modello, nessun costo d'immagine.
export function serveRitocco(piano: PianoModifica, prima: SchedaCopertina, dopo: SchedaCopertina): boolean {
  return (
    piano.istruzioniImmagine.length > 0 ||
    prima.testi.titoloPrincipale !== dopo.testi.titoloPrincipale ||
    prima.testi.titolo !== dopo.testi.titolo ||
    prima.testi.cig !== dopo.testi.cig
  );
}

const percento = (v: number) => `${Math.round(v * 100)}%`;

// Il comando per il ritocco della pagina senza loghi
export function promptRitocco(params: { piano: PianoModifica; prima: SchedaCopertina; dopo: SchedaCopertina }): string {
  const { piano, prima, dopo } = params;
  const righe = [
    "Questa immagine è la copertina in formato A4 della relazione tecnica di una gara d'appalto, ancora SENZA loghi (i loghi vengono applicati dopo).",
    "Modificala come indicato qui sotto e lascia IDENTICO tutto il resto: composizione, stile, colori, luce, elementi e testi non citati.",
  ];
  if (piano.istruzioniImmagine) righe.push("", "MODIFICHE RICHIESTE:", piano.istruzioniImmagine);
  const testiCambiati = prima.testi.titoloPrincipale !== dopo.testi.titoloPrincipale || prima.testi.titolo !== dopo.testi.titolo || prima.testi.cig !== dopo.testi.cig;
  if (testiCambiati) {
    righe.push(
      "",
      "TESTI (sostituiscono quelli attuali, nella stessa posizione e con lo stesso stile tipografico):",
      `AL CENTRO SCRIVI: ${dopo.testi.titoloPrincipale}`,
      `SOTTO SEMPRE AL CENTRO SCRIVI: ${rigaTitolo({ titolo: dopo.testi.titolo, cig: dopo.testi.cig })}`,
      "Scrivili ESATTAMENTE così, parola per parola, senza correggerli né abbreviarli, e non scrivere nessun altro testo.",
    );
  } else {
    righe.push("", "I testi della copertina restano esattamente quelli attuali, lettera per lettera.");
  }
  const spazi = CHI_LOGO.map((chi) => dopo.loghi[chi])
    .filter((l): l is LogoNellaScheda => l !== null)
    .map((l) => {
      const z = zonaPer(l.posizione, l.dimensione);
      return `${ETICHETTA_POSIZIONE[l.posizione]} (circa dal ${percento(z.x)} al ${percento(z.x + z.larghezza)} della larghezza e dal ${percento(z.y)} al ${percento(z.y + z.altezza)} dell'altezza)`;
    });
  righe.push(
    "",
    "Non disegnare NESSUN logo, stemma o marchio e nessun riquadro, pannello o cornice per loghi.",
    spazi.length ? `Gli spazi dei loghi ${spazi.join(" e ")} restano chiari, semplici e calmi, senza dettagli, così i loghi applicati dopo si vedono bene.` : "",
    "Formato: pagina A4 verticale, a tutta pagina, senza bordi bianchi.",
  );
  return righe.filter((r, i, tutte) => !(r === "" && tutte[i - 1] === "")).join("\n").trim();
}
