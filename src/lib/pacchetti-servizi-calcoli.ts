import { proponeFoodMenu, proponePianoLavoro, type Settore } from "@/lib/gara-settore";
import type { RigaAcquistoPianoLavoro } from "@/lib/piano-lavoro-acquisto-calcoli";

// Pacchetti prepagati dei servizi aggiuntivi di OMNIA AI (richiesta dell'utente, 10/11/2026): regole PURE (nessun database, nessuna rete),
// provate da scripts/verifica-pacchetti-servizi-omnia-ai.ts. Le usano la pagina dei servizi, la home, la scheda della gara, le azioni, il webhook,
// la console e il test.
//
// Principi:
//   - i servizi aggiuntivi (piano di lavoro, OMNIA FOOD MENU, i prossimi) NON sono abbonamenti: si comprano per gara, singoli oppure a pacchetto;
//   - un pacchetto è un numero di unità prepagate (per esempio 5 piani di lavoro a 300 €, IVA inclusa): NON scadono col tempo, si esauriscono
//     man mano che si usano, anche in più mesi; se il cliente disdice le unità residue si perdono, come i crediti aggiuntivi;
//   - una gara consuma UNA sola unità (anche con la seconda generazione per la proroga, anche se la generazione va ripetuta dopo un errore);
//   - il pacchetto lo paga solo il titolare; l'Ufficio Gare lo vede e, con «Acquista», avvisa il titolare con una email;
//   - su ogni servizio compare solo il pacchetto dei settori che l'azienda tratta davvero (pulizie → piano di lavoro; ristorazione collettiva →
//     OMNIA FOOD MENU, per ora «sta arrivando» e senza acquisto).

// ───── i servizi che si vendono a pacchetto ─────

export const SERVIZI_PACCHETTO = ["piano_lavoro", "food_menu"] as const;
export type ServizioPacchetto = (typeof SERVIZI_PACCHETTO)[number];

export type DescrizioneServizio = {
  nome: string;
  // «piano di lavoro» / «piani di lavoro»: per dire «5 piani di lavoro»
  unitaSingolare: string;
  unitaPlurale: string;
  // il servizio si può comprare oggi (OMNIA FOOD MENU «sta arrivando»)
  disponibile: boolean;
  // la chiave di console_impostazioni con l'elenco dei pacchetti in vendita
  chiaveCatalogo: string;
  // di cosa parla il servizio, in una riga
  descrizione: string;
};

export const SERVIZI: Record<ServizioPacchetto, DescrizioneServizio> = {
  piano_lavoro: {
    nome: "Piano di lavoro",
    unitaSingolare: "piano di lavoro",
    unitaPlurale: "piani di lavoro",
    disponibile: true,
    chiaveCatalogo: "pacchetti_piano_lavoro",
    descrizione: "Per le gare di servizi di pulizia: l'Excel con formule attive, costruito dai documenti di gara (monte ore, organico, macchinari).",
  },
  food_menu: {
    nome: "OMNIA FOOD MENU",
    unitaSingolare: "OMNIA FOOD MENU",
    unitaPlurale: "OMNIA FOOD MENU",
    disponibile: false,
    chiaveCatalogo: "pacchetti_food_menu",
    descrizione: "Per le gare di ristorazione collettiva: menu stagionali, ricettari, grammature, tabelle degli allergeni, piani delle derrate.",
  },
};

export function eServizioPacchetto(valore: unknown): valore is ServizioPacchetto {
  return typeof valore === "string" && (SERVIZI_PACCHETTO as readonly string[]).includes(valore);
}

// «1 piano di lavoro», «5 piani di lavoro»
export function testoUnita(quantita: number, servizio: ServizioPacchetto): string {
  const d = SERVIZI[servizio];
  return `${quantita} ${quantita === 1 ? d.unitaSingolare : d.unitaPlurale}`;
}

// ───── l'elenco dei pacchetti in vendita (modificabile dalla console) ─────

export type PacchettoCatalogo = { quantita: number; prezzoCentesimi: number };

export const LIMITI_CATALOGO = {
  quantitaMinima: 2,
  quantitaMassima: 1000,
  prezzoMinimoCentesimi: 100,
  prezzoMassimoCentesimi: 10_000_000,
  pacchettiMassimi: 6,
} as const;

// L'esempio dell'utente: 5 piani di lavoro a 300 € (IVA inclusa). Vale finché la console non imposta altro.
export const CATALOGO_PREDEFINITO: Record<ServizioPacchetto, PacchettoCatalogo[]> = {
  piano_lavoro: [{ quantita: 5, prezzoCentesimi: 30000 }],
  food_menu: [],
};

function pacchettoValido(x: unknown): PacchettoCatalogo | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const q = r.quantita;
  const p = r.prezzoCentesimi;
  if (typeof q !== "number" || !Number.isInteger(q) || q < LIMITI_CATALOGO.quantitaMinima || q > LIMITI_CATALOGO.quantitaMassima) return null;
  if (typeof p !== "number" || !Number.isInteger(p) || p < LIMITI_CATALOGO.prezzoMinimoCentesimi || p > LIMITI_CATALOGO.prezzoMassimoCentesimi) return null;
  return { quantita: q, prezzoCentesimi: p };
}

// Ordina per quantità, toglie i doppioni (vince il primo) e rispetta il numero massimo.
function normalizzaElenco(elenco: PacchettoCatalogo[]): PacchettoCatalogo[] {
  const viste = new Set<number>();
  const uniche: PacchettoCatalogo[] = [];
  for (const p of elenco) {
    if (viste.has(p.quantita)) continue;
    viste.add(p.quantita);
    uniche.push(p);
  }
  return uniche.sort((a, b) => a.quantita - b.quantita).slice(0, LIMITI_CATALOGO.pacchettiMassimi);
}

// Il valore salvato in console_impostazioni (JSON). Mai salvato = l'elenco di partenza; salvato ma illeggibile = l'elenco di partenza;
// salvato come elenco vuoto «[]» = nessun pacchetto in vendita (scelta della console). Le voci non valide si scartano.
export function interpretaCatalogoPacchetti(servizio: ServizioPacchetto, valore: string | null | undefined): PacchettoCatalogo[] {
  if (valore === null || valore === undefined || valore.trim() === "") return CATALOGO_PREDEFINITO[servizio];
  let analizzato: unknown;
  try {
    analizzato = JSON.parse(valore);
  } catch {
    return CATALOGO_PREDEFINITO[servizio];
  }
  if (!Array.isArray(analizzato)) return CATALOGO_PREDEFINITO[servizio];
  return normalizzaElenco(analizzato.map(pacchettoValido).filter((p): p is PacchettoCatalogo => p !== null));
}

export function serializzaCatalogoPacchetti(elenco: PacchettoCatalogo[]): string {
  return JSON.stringify(normalizzaElenco(elenco));
}

export type EsitoValidazioneCatalogo = { ok: true; catalogo: PacchettoCatalogo[] } | { ok: false; errore: string };

// Le righe del modulo della console: quantità (numero) e prezzo in euro (testo, con la virgola o il punto). Righe del tutto vuote = ignorate.
export function validaCatalogoDaModulo(righe: { quantita: string; prezzoEuro: string }[]): EsitoValidazioneCatalogo {
  const elenco: PacchettoCatalogo[] = [];
  for (const [i, riga] of righe.entries()) {
    const q = riga.quantita.trim();
    const p = riga.prezzoEuro.trim();
    if (q === "" && p === "") continue;
    const n = i + 1;
    if (!/^\d{1,5}$/.test(q)) return { ok: false, errore: `Pacchetto ${n}: la quantità dev'essere un numero intero.` };
    const quantita = Number(q);
    if (quantita < LIMITI_CATALOGO.quantitaMinima || quantita > LIMITI_CATALOGO.quantitaMassima) {
      return { ok: false, errore: `Pacchetto ${n}: la quantità dev'essere tra ${LIMITI_CATALOGO.quantitaMinima} e ${LIMITI_CATALOGO.quantitaMassima}.` };
    }
    const prezzo = euroInCentesimi(p);
    if (prezzo === null) return { ok: false, errore: `Pacchetto ${n}: il prezzo dev'essere un importo in euro (per esempio 300 oppure 299,90).` };
    if (prezzo < LIMITI_CATALOGO.prezzoMinimoCentesimi || prezzo > LIMITI_CATALOGO.prezzoMassimoCentesimi) {
      return { ok: false, errore: `Pacchetto ${n}: il prezzo dev'essere tra 1 € e 100.000 €.` };
    }
    elenco.push({ quantita, prezzoCentesimi: prezzo });
  }
  const quantita = elenco.map((p) => p.quantita);
  if (new Set(quantita).size !== quantita.length) return { ok: false, errore: "Due pacchetti hanno la stessa quantità: togline uno." };
  if (elenco.length > LIMITI_CATALOGO.pacchettiMassimi) return { ok: false, errore: `Al massimo ${LIMITI_CATALOGO.pacchettiMassimi} pacchetti.` };
  return { ok: true, catalogo: normalizzaElenco(elenco) };
}

// «300», «299,90», «299.90» → centesimi; qualunque altra cosa (compresi i segni e le migliaia) → null
export function euroInCentesimi(testo: string): number | null {
  const t = testo.trim();
  if (!/^\d{1,8}([.,]\d{1,2})?$/.test(t)) return null;
  const [intero, decimali = ""] = t.replace(",", ".").split(".");
  return Number(intero) * 100 + Number(decimali.padEnd(2, "0"));
}

// Quanto costa ogni unità e quanto si risparmia rispetto al prezzo della singola gara (null = nessun risparmio da dire).
export function convenienzaPacchetto(p: PacchettoCatalogo, prezzoSingoloCentesimi: number): { perUnitaCentesimi: number; risparmioCentesimi: number | null } {
  const perUnita = Math.round(p.prezzoCentesimi / p.quantita);
  const risparmio = prezzoSingoloCentesimi * p.quantita - p.prezzoCentesimi;
  return { perUnitaCentesimi: perUnita, risparmioCentesimi: risparmio > 0 ? risparmio : null };
}

// «300 €», «299,90 €»: senza decimali se l'importo è tondo
export function formattaEuro(centesimi: number): string {
  return (centesimi / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: centesimi % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

// Il pacchetto si compra solo se è uno di quelli IN VENDITA ADESSO, con quel prezzo: la quantità arriva dal browser, il prezzo si rilegge sempre.
export function trovaPacchetto(catalogo: PacchettoCatalogo[], quantita: unknown): PacchettoCatalogo | null {
  const q = typeof quantita === "string" ? Number(quantita) : quantita;
  return typeof q === "number" ? (catalogo.find((p) => p.quantita === q) ?? null) : null;
}

// ───── offerte dedicate: pacchetti privati a prezzo e quantità decisi dalla console per UN cliente ─────

export const LIMITI_OFFERTA = { quantitaMinima: 1, quantitaMassima: 1000, prezzoMinimoCentesimi: 100, prezzoMassimoCentesimi: 10_000_000, notaMassima: 300 } as const;

// Un'offerta dedicata come la vede il cliente (la nota interna della console non c'è mai).
export type OffertaDedicata = { id: string; servizio: ServizioPacchetto; quantita: number; prezzoCentesimi: number; scadeIl: string | null };

export type StatoOfferta = "attiva" | "acquistata" | "revocata";

// La riga del database
export type RigaOfferta = {
  id: string;
  user_id: string;
  servizio: ServizioPacchetto;
  quantita: number;
  prezzo_centesimi: number;
  scade_il: string | null;
  nota: string | null;
  stato: StatoOfferta;
  creata_il: string;
  creata_da_email: string;
  chiusa_il: string | null;
  chiusa_da_email: string | null;
  acquisto_id: string | null;
};

// Si può comprare adesso? Attiva e non scaduta (l'ultimo giorno incluso). `oggi` è il giorno di Roma (AAAA-MM-GG).
export function offertaAcquistabile(r: Pick<RigaOfferta, "stato" | "scade_il">, oggi: string): boolean {
  return r.stato === "attiva" && (!r.scade_il || r.scade_il >= oggi);
}

export function daRigaOfferta(r: Pick<RigaOfferta, "id" | "servizio" | "quantita" | "prezzo_centesimi" | "scade_il">): OffertaDedicata {
  return { id: r.id, servizio: r.servizio, quantita: r.quantita, prezzoCentesimi: r.prezzo_centesimi, scadeIl: r.scade_il };
}

export type NuovaOffertaValori = { email: string; servizio: ServizioPacchetto; quantita: number; prezzoCentesimi: number; scadeIl: string | null; nota: string | null };

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// I campi del modulo della console, come arrivano: si controlla tutto qui (il server non si fida del browser). `oggi`: giorno di Roma (AAAA-MM-GG).
export function validaNuovaOfferta(
  input: { email: string; servizio: string; quantita: string; prezzoEuro: string; scadeIl: string; nota: string },
  oggi: string,
): { ok: true; valori: NuovaOffertaValori } | { ok: false; errore: string } {
  const email = input.email.trim().toLowerCase();
  if (email === "") return { ok: false, errore: "Scrivi l'email del cliente (il titolare dell'account)." };
  if (email.length > 254 || !FORMATO_EMAIL.test(email)) return { ok: false, errore: "L'email del cliente non è valida." };

  if (!eServizioPacchetto(input.servizio)) return { ok: false, errore: "Scegli il servizio." };
  if (!SERVIZI[input.servizio].disponibile) return { ok: false, errore: `${SERVIZI[input.servizio].nome} non è ancora disponibile: non si possono fare offerte.` };

  const q = input.quantita.trim();
  if (!/^\d{1,5}$/.test(q)) return { ok: false, errore: "La quantità dev'essere un numero intero." };
  const quantita = Number(q);
  if (quantita < LIMITI_OFFERTA.quantitaMinima || quantita > LIMITI_OFFERTA.quantitaMassima) return { ok: false, errore: `La quantità dev'essere tra ${LIMITI_OFFERTA.quantitaMinima} e ${LIMITI_OFFERTA.quantitaMassima}.` };

  const prezzoCentesimi = euroInCentesimi(input.prezzoEuro);
  if (prezzoCentesimi === null) return { ok: false, errore: "Il prezzo dev'essere un importo in euro (per esempio 450 oppure 449,90), IVA inclusa." };
  if (prezzoCentesimi < LIMITI_OFFERTA.prezzoMinimoCentesimi || prezzoCentesimi > LIMITI_OFFERTA.prezzoMassimoCentesimi) return { ok: false, errore: "Il prezzo dev'essere tra 1 € e 100.000 €." };

  const scadenza = input.scadeIl.trim();
  let scadeIl: string | null = null;
  if (scadenza !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scadenza) || Number.isNaN(new Date(`${scadenza}T00:00:00Z`).getTime())) return { ok: false, errore: "La data di scadenza non è valida." };
    if (scadenza < oggi) return { ok: false, errore: "La data di scadenza è già passata." };
    scadeIl = scadenza;
  }

  const nota = input.nota.trim();
  if (nota.length > LIMITI_OFFERTA.notaMassima) return { ok: false, errore: `La nota è troppo lunga (massimo ${LIMITI_OFFERTA.notaMassima} caratteri).` };

  return { ok: true, valori: { email, servizio: input.servizio, quantita, prezzoCentesimi, scadeIl, nota: nota === "" ? null : nota } };
}

// «31/12/2026»
export function dataItaliana(iso: string): string {
  return iso.split("-").reverse().join("/");
}

// ───── cosa si offre a chi guarda ─────

export type OffertaPacchetti =
  // niente da vendere (vendita spenta o nessun pacchetto in elenco)
  | { stato: "nessuna" }
  // il servizio sta arrivando: se ne parla, non si compra
  | { stato: "in_arrivo" }
  // il titolare compra adesso
  | { stato: "acquistabile"; pacchetti: PacchettoCatalogo[] }
  // l'Ufficio Gare vede i pacchetti, ma compra solo il titolare: «Acquista» manda al titolare una email
  | { stato: "solo_titolare"; pacchetti: PacchettoCatalogo[] };

// `haOfferte`: il cliente ha almeno un'offerta dedicata attiva (si vende anche con l'elenco pubblico vuoto).
export function valutaOffertaPacchetti(c: { servizio: ServizioPacchetto; titolare: boolean; venditaAttiva: boolean; catalogo: PacchettoCatalogo[]; haOfferte?: boolean }): OffertaPacchetti {
  if (!SERVIZI[c.servizio].disponibile) return { stato: "in_arrivo" };
  if (!c.venditaAttiva || (c.catalogo.length === 0 && !c.haOfferte)) return { stato: "nessuna" };
  return c.titolare ? { stato: "acquistabile", pacchetti: c.catalogo } : { stato: "solo_titolare", pacchetti: c.catalogo };
}

// ───── quali servizi compaiono nella home ─────

export type ServizioInHome = { servizio: ServizioPacchetto; motivo: "settore" | "saldo" | "acquisti" | "offerta" };

// Compare il servizio dei settori che l'azienda tratta davvero (almeno una gara di quel genere; una gara non ancora classificata conta come
// pulizie, come per la scheda della gara) e, in ogni caso, quello di cui ha già un saldo o degli acquisti: i soldi già spesi si vedono sempre.
// Nessuna gara e nessun saldo = nulla.
export function serviziPerLaHome(c: {
  settoriGare: (Settore | null)[];
  saldi: Partial<Record<ServizioPacchetto, number>>;
  acquisti: Partial<Record<ServizioPacchetto, number>>;
  // quante offerte dedicate attive ha il cliente, per servizio (un'offerta riservata a lui si vede sempre, anche senza gare di quel settore)
  offerte?: Partial<Record<ServizioPacchetto, number>>;
}): ServizioInHome[] {
  const risultato: ServizioInHome[] = [];
  for (const servizio of SERVIZI_PACCHETTO) {
    const trattaIlSettore = c.settoriGare.some((s) => (servizio === "piano_lavoro" ? proponePianoLavoro(s) : proponeFoodMenu(s)));
    if (trattaIlSettore) risultato.push({ servizio, motivo: "settore" });
    else if ((c.saldi[servizio] ?? 0) > 0) risultato.push({ servizio, motivo: "saldo" });
    else if ((c.acquisti[servizio] ?? 0) > 0) risultato.push({ servizio, motivo: "acquisti" });
    else if ((c.offerte?.[servizio] ?? 0) > 0) risultato.push({ servizio, motivo: "offerta" });
  }
  return risultato;
}

// `offertaId` e `scadeIl` solo per le offerte dedicate (riservate al cliente); assenti per i pacchetti dell'elenco pubblico.
export type PacchettoConConvenienza = PacchettoCatalogo & { perUnitaCentesimi: number; risparmioCentesimi: number | null; offertaId?: string; scadeIl?: string | null };

export type SchedaServizio = {
  servizio: ServizioPacchetto;
  motivo: ServizioInHome["motivo"];
  // unità residue dell'account
  saldo: number;
  // l'account ha avuto delle unità (almeno una riga di saldo, anche a zero) o ha già comprato: serve a dire «esaurito» solo a chi le ha finite
  haAvutoUnita: boolean;
  offerta: OffertaPacchetti;
  // i pacchetti da mostrare (solo se si possono comprare o richiedere): prima le offerte dedicate al cliente, poi quelli dell'elenco
  pacchetti: PacchettoConConvenienza[];
  // concessioni gratuite attive della console, già raccontate in una riga (solo per il piano di lavoro)
  concessioni: string[];
};

// Cosa mostrano la home e la pagina dei servizi: una scheda per ogni servizio che l'azienda tratta (o di cui ha già un saldo), tolte quelle senza
// niente da dire (vendita spenta e nessun saldo). OMNIA FOOD MENU, finché «sta arrivando», compare senza acquisto per chi ha gare di ristorazione.
export function costruisciSchede(c: {
  settoriGare: (Settore | null)[];
  saldi: Partial<Record<ServizioPacchetto, number>>;
  acquisti: Partial<Record<ServizioPacchetto, number>>;
  titolare: boolean;
  venditaAttiva: boolean;
  cataloghi: Partial<Record<ServizioPacchetto, PacchettoCatalogo[]>>;
  prezzoSingolo: Partial<Record<ServizioPacchetto, number | null>>;
  // le offerte dedicate attive e non scadute di QUESTO cliente (già filtrate)
  offerte?: OffertaDedicata[];
  // le concessioni gratuite attive, già raccontate, per servizio
  concessioni?: Partial<Record<ServizioPacchetto, string[]>>;
}): SchedaServizio[] {
  const schede: SchedaServizio[] = [];
  const offerte = c.offerte ?? [];
  const offerteDi = (servizio: ServizioPacchetto) => offerte.filter((o) => o.servizio === servizio);
  const conteggioOfferte: Partial<Record<ServizioPacchetto, number>> = {};
  for (const o of offerte) conteggioOfferte[o.servizio] = (conteggioOfferte[o.servizio] ?? 0) + 1;
  for (const { servizio, motivo } of serviziPerLaHome({ settoriGare: c.settoriGare, saldi: c.saldi, acquisti: c.acquisti, offerte: conteggioOfferte })) {
    const saldo = c.saldi[servizio] ?? 0;
    const haAvutoUnita = c.saldi[servizio] !== undefined || (c.acquisti[servizio] ?? 0) > 0;
    const concessioni = c.concessioni?.[servizio] ?? [];
    const proprie = offerteDi(servizio);
    const offerta = valutaOffertaPacchetti({ servizio, titolare: c.titolare, venditaAttiva: c.venditaAttiva, catalogo: c.cataloghi[servizio] ?? [], haOfferte: proprie.length > 0 });
    if (offerta.stato === "nessuna" && saldo === 0 && concessioni.length === 0) continue;
    const singolo = c.prezzoSingolo[servizio] ?? null;
    const conConvenienza = (p: PacchettoCatalogo) => (singolo === null ? { perUnitaCentesimi: Math.round(p.prezzoCentesimi / p.quantita), risparmioCentesimi: null } : convenienzaPacchetto(p, singolo));
    const pacchetti: PacchettoConConvenienza[] =
      offerta.stato === "acquistabile" || offerta.stato === "solo_titolare"
        ? [
            ...proprie.map((o) => ({ quantita: o.quantita, prezzoCentesimi: o.prezzoCentesimi, ...conConvenienza(o), offertaId: o.id, scadeIl: o.scadeIl })),
            ...offerta.pacchetti.map((p) => ({ ...p, ...conConvenienza(p) })),
          ]
        : [];
    schede.push({ servizio, motivo, saldo, haAvutoUnita, offerta, pacchetti, concessioni });
  }
  return schede;
}

// Cosa sa la scheda della gara dei pacchetti: le unità residue, se questa gara ha già usato la sua e, a chi può comprare, il pacchetto da proporre
// accanto all'acquisto della singola gara.
export type PacchettoNellaGara = {
  saldo: number;
  garaGiaConsumata: boolean;
  // offertaId: la proposta è un'offerta dedicata al cliente (non un pacchetto dell'elenco)
  proposta: { quantita: number; prezzoCentesimi: number; perUnitaCentesimi: number; offertaId?: string } | null;
};

// Il pacchetto che costa meno per ogni unità, tra quelli dell'elenco e le offerte dedicate al cliente (a parità, l'offerta dedicata, poi il più grande).
// null = niente da proporre.
export function proponiPacchettoPiuConveniente(catalogo: PacchettoCatalogo[], offerte: OffertaDedicata[] = []): PacchettoNellaGara["proposta"] {
  type Candidato = PacchettoCatalogo & { offertaId?: string };
  const candidati: Candidato[] = [...offerte.map((o) => ({ quantita: o.quantita, prezzoCentesimi: o.prezzoCentesimi, offertaId: o.id })), ...catalogo];
  let migliore: Candidato | null = null;
  for (const p of candidati) {
    if (!migliore) migliore = p;
    else {
      const a = p.prezzoCentesimi / p.quantita;
      const b = migliore.prezzoCentesimi / migliore.quantita;
      if (a < b || (a === b && p.quantita > migliore.quantita)) migliore = p;
    }
  }
  return migliore
    ? { quantita: migliore.quantita, prezzoCentesimi: migliore.prezzoCentesimi, perUnitaCentesimi: Math.round(migliore.prezzoCentesimi / migliore.quantita), ...(migliore.offertaId ? { offertaId: migliore.offertaId } : {}) }
    : null;
}

// ───── il saldo e il diritto alla generazione ─────

export type StatoPacchetto = {
  // unità residue
  saldo: number;
  // questa gara ha già consumato un'unità (la seconda generazione per la proroga non ne consuma un'altra)
  garaGiaConsumata: boolean;
};

// L'unità da usare per questa gara: serve «consumarla» solo se la gara non l'ha già fatto.
export function dirittoDaPacchetto(s: StatoPacchetto): { ha: boolean; consumaUnita: boolean } {
  if (s.garaGiaConsumata) return { ha: true, consumaUnita: false };
  return { ha: s.saldo > 0, consumaUnita: s.saldo > 0 };
}

// ───── i testi ─────

export const TESTI_PACCHETTI = {
  titoloSezione: "Servizi per le tue gare",
  introSezione: "Servizi aggiuntivi oltre alla relazione tecnica, per le gare che tratti. Non sono abbonamenti: si comprano singolarmente dentro la gara oppure a pacchetto, qui.",
  // cosa vale un pacchetto, in una riga, sotto il prezzo
  dettaglioPacchetto: "Non scadono: si esauriscono man mano che li usi, anche in più mesi. Si perdono se l'abbonamento cessa.",
  saldoEtichetta: "Ti restano",
  saldoZero: "Nessun piano di lavoro residuo",
  // chi non ha mai avuto unità non ha «finito» nulla
  nessunPacchetto: "Non hai pacchetti attivi",
  offertaDedicata: "Offerta dedicata a te",
  validaFinoAl: (iso: string) => `valida fino al ${dataItaliana(iso)}`,
  concessioneEtichetta: "Concessione gratuita",
  concessioneNota: "Per le gare coperte dalla concessione il piano di lavoro non consuma il pacchetto.",
  pacchettoPagato: "Pagamento ricevuto: sto aggiungendo i piani di lavoro al tuo saldo. Se non li vedi, aggiorna la pagina tra qualche istante.",
  pacchettoAnnullato: "Pagamento annullato: non è stato addebitato nulla.",
  soloTitolareNota: "Il pacchetto lo acquista e lo paga l'amministratore dell'azienda: premendo «Acquista» gli arriva una email con la tua richiesta.",
  avvisoInviato: "Ho avvisato l'amministratore: troverà il pacchetto nella sua area riservata.",
  avvisoGiaInviato: "L'amministratore è già stato avvisato oggi per questo pacchetto: lo acquisterà dalla sua area riservata.",
  avvisoNonRiuscito: "Non sono riuscito ad avvisare l'amministratore. Riprova tra qualche istante.",
  venditaSpenta: "I pacchetti non sono ancora in vendita.",
  foodMenuArrivo: "Sta arrivando: non è ancora disponibile. Quando lo sarà, lo troverai qui e dentro la gara.",
  usaUnita: (saldo: number) => `Usa 1 dei tuoi ${saldo} piani di lavoro`,
  usaUnitaNota: (saldo: number) =>
    saldo === 1 ? "È l'ultimo piano di lavoro del tuo pacchetto: dopo questa generazione il saldo sarà zero." : `Dopo questa generazione te ne resteranno ${saldo - 1}.`,
  garaGiaConsumataNota: "Per questa gara hai già usato un piano di lavoro del pacchetto: la seconda generazione (proroga) non ne consuma un altro.",
  confermaUsoUnita: "Usare 1 piano di lavoro del tuo pacchetto per questa gara?",
  usoNonConfermato: "Per generare il piano di lavoro di questa gara si usa 1 dei piani del tuo pacchetto: ricarica la pagina e conferma.",
  saldoEsaurito: "Hai finito i piani di lavoro del tuo pacchetto: puoi acquistare quello di questa gara oppure un nuovo pacchetto.",
  soloUnPianoNonServe: (saldo: number) => `Hai ancora ${testoUnita(saldo, "piano_lavoro")} nel tuo pacchetto: usane uno dalla pagina della gara, non serve acquistare questo.`,
} as const;

// ───── condizioni del pacchetto ─────
//
// BOZZA da far approvare dal legale PRIMA di accendere la vendita dei pacchetti. Versionato come le avvertenze del piano di lavoro: versione e
// impronta (sha256 del testo canonico) si registrano con l'accettazione del cliente (tabella omnia_ai_pacchetti_acquisti). Se si cambia anche
// una sola parola si aumenta la versione e si ripete l'approvazione. Le avvertenze sul SERVIZIO (cosa è il piano di lavoro, natura del documento,
// limitazione di responsabilità) sono quelle già approvate del piano di lavoro e si accettano insieme.

export const VERSIONE_CONDIZIONI_PACCHETTI = 1;

// null = bozza non ancora approvata dal legale. Dopo l'approvazione: { data: "...", versioneClausole: 1 }.
export const APPROVAZIONE_LEGALE_PACCHETTI = null as { data: string; versioneClausole: number } | null;

export type ClausolaPacchetto = { numero: number; titolo: string; testo: string; specifica: boolean };

export const CLAUSOLE_PACCHETTI: ClausolaPacchetto[] = [
  {
    numero: 1,
    titolo: "Oggetto del pacchetto",
    specifica: false,
    testo:
      "Il pacchetto è un insieme di unità prepagate del servizio indicato al momento dell'acquisto (per esempio, «piano di lavoro»). Ogni unità dà diritto alla generazione del servizio per UNA gara, alle condizioni del servizio che l'accompagnano; per il piano di lavoro, una seconda generazione per la stessa gara è possibile solo se i documenti indicano una proroga dei termini di presentazione e non consuma un'altra unità. Le unità si aggiungono al saldo dell'azienda dopo la conferma del pagamento da parte di Stripe e si usano gara per gara dalla pagina della gara.",
  },
  {
    numero: 2,
    titolo: "Utilizzo e durata",
    specifica: false,
    testo:
      "Le unità non hanno una scadenza nel tempo e si esauriscono man mano che vengono usate, anche in più mesi, finché l'abbonamento a OMNIA AI è attivo. Una gara consuma una sola unità. Se la generazione non riesce per un errore del servizio, l'unità non viene conteggiata e si può riprovare. Il pacchetto lo acquista soltanto il titolare dell'account; le unità sono dell'azienda del titolare e possono essere usate dal titolare e dall'Ufficio Gare dell'azienda.",
  },
  {
    numero: 3,
    titolo: "Estinzione delle unità alla cessazione dell'abbonamento",
    specifica: true,
    testo:
      "Se l'abbonamento a OMNIA AI cessa, per disdetta, per mancato pagamento o per qualunque altra causa, le unità non ancora usate si estinguono, senza diritto a rimborso, a conversione in altro servizio o a riattivazione successiva, come avviene per i crediti aggiuntivi. Fino alla cessazione effettiva dell'abbonamento le unità restano utilizzabili.",
  },
  {
    numero: 4,
    titolo: "Corrispettivo, pagamento e rimborsi",
    specifica: true,
    testo:
      "Il corrispettivo è quello indicato al momento dell'acquisto, IVA inclusa, ed è pagato in anticipo, con carta tramite Stripe. Una volta pagato non è rimborsabile, né in tutto né per le unità non usate, salvo i casi previsti da norme inderogabili. Le unità non sono cedibili né trasferibili ad altri account. OMNIA AI può modificare il prezzo dei pacchetti per gli acquisti futuri: i pacchetti già pagati non cambiano.",
  },
];

export const CLAUSOLE_SPECIFICHE_PACCHETTI = CLAUSOLE_PACCHETTI.filter((c) => c.specifica);

// Il testo canonico su cui si calcola l'impronta: versione, numeri, titoli e testi, nell'ordine.
export function testoCanonicoCondizioniPacchetti(): string {
  return [`versione ${VERSIONE_CONDIZIONI_PACCHETTI}`, ...CLAUSOLE_PACCHETTI.map((c) => `${c.numero}. ${c.titolo}${c.specifica ? " [specifica]" : ""}\n${c.testo}`)].join("\n\n");
}

export const NOTA_CONSOLE_CONDIZIONI_PACCHETTI = APPROVAZIONE_LEGALE_PACCHETTI
  ? `Condizioni dei pacchetti approvate dal legale il ${APPROVAZIONE_LEGALE_PACCHETTI.data} (versione ${APPROVAZIONE_LEGALE_PACCHETTI.versioneClausole}).`
  : "Le condizioni dei pacchetti sono una BOZZA: falle approvare dal legale PRIMA di accendere la vendita (le clausole 3 e 4 si approvano specificamente).";

// ───── il pagamento registrato ─────

export type RigaAcquistoPacchetto = Pick<RigaAcquistoPianoLavoro, "id" | "user_id" | "prezzo_centesimi" | "stripe_session_id" | "stripe_payment_intent_id" | "pagata_il" | "importo_pagato_centesimi"> & {
  servizio: ServizioPacchetto;
  quantita: number;
  stato: "in_attesa_pagamento" | "pagata";
  accreditata_il: string | null;
  livemode: boolean;
  // l'offerta dedicata da cui viene l'acquisto (colonna della migrazione 0105: assente prima, vuota per i pacchetti dell'elenco)
  offerta_id?: string | null;
};

export type MovimentoTipo = "acquisto" | "consumo" | "riaccredito" | "rettifica" | "estinzione";

export const ETICHETTA_MOVIMENTO: Record<MovimentoTipo, string> = {
  acquisto: "Acquisto del pacchetto",
  consumo: "Usato per una gara",
  riaccredito: "Riaccreditato (generazione non riuscita)",
  rettifica: "Rettifica dell'ufficio",
  estinzione: "Estinto alla cessazione",
};

// L'esito delle funzioni SQL, detto in una parola per il codice che le chiama
export type EsitoConsumo = "consumata" | "gia_consumata" | "saldo_insufficiente";

export function interpretaEsitoConsumo(valore: unknown): EsitoConsumo | null {
  return valore === "consumata" || valore === "gia_consumata" || valore === "saldo_insufficiente" ? valore : null;
}
