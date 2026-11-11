// CHI può generare la copertina della relazione tecnica, e quante volte (richiesta dell'utente, 11/11/2026). Modulo senza dipendenze di server: le regole, i
// testi per il cliente e per la console, il controllo del modulo della console. Le letture e le scritture nel database stanno in copertina-diritto.ts.
// Test: scripts/verifica-copertina-diritti.ts.
//
// Regole:
//   - ogni cliente (titolare) ha le sue impostazioni, scritte dalla console: il servizio è acceso o spento (di base SPENTO), gratis o a pagamento;
//   - gratis: facoltativamente un numero di gare gratis in tutto e una data di scadenza (l'ultimo giorno incluso). Una gara «usa» una gara gratis alla
//     sua prima copertina; le altre copertine della stessa gara non ne usano altre;
//   - a pagamento: un prezzo per gara (IVA inclusa) deciso per quel cliente. Il titolare lo paga con carta su Stripe per UNA gara (acquisto in
//     copertina-acquisto-calcoli.ts); una gara pagata dà diritto alle generazioni anche se poi la console spegne il servizio. Se il pagamento
//     online non è possibile (chiave Stripe non reale, tabella degli acquisti assente) il cliente vede il prezzo ma non può generare;
//   - per ogni gara, al massimo 3 generazioni per stile (3 stilizzate e 3 realistiche), qualunque sia la fonte del diritto;
//   - le tabelle (migrazione 0106) non ci sono: online il servizio è spento; in sviluppo locale resta aperto per le prove (come prima della scelta per cliente).

import { euroACentesimi, formattaGiorno } from "@/lib/omnia-ai-catalogo-calcoli";
import { ETICHETTA_STILE, STILI, type Stile } from "@/lib/copertina-relazione-calcoli";

export const COPERTINE_PER_STILE = 3;
// Una generazione «in corso» da più di così si considera interrotta (un errore del server che non l'ha chiusa): non conta più
export const MINUTI_GENERAZIONE_INTERROTTA = 20;
export const LIMITI_PREZZO_COPERTINA = { minimoCentesimi: 100, massimoCentesimi: 100_000 } as const;
export const LIMITE_GARE_GRATIS = 1000;
export const LIMITE_NOTA = 300;

export type ModalitaCopertina = "gratis" | "pagamento";
export const MODALITA_COPERTINA: ModalitaCopertina[] = ["gratis", "pagamento"];

export type ImpostazioniCopertina = {
  attivo: boolean;
  modalita: ModalitaCopertina;
  // per gara, IVA inclusa; solo per «pagamento»
  prezzoCentesimi: number | null;
  // solo per «gratis»: quante gare gratis in tutto (null = senza limite) e l'ultimo giorno in cui vale (null = senza scadenza)
  gareMassime: number | null;
  scadeIl: string | null;
  nota: string | null;
};

const euro = (centesimi: number) => (centesimi / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: centesimi % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });

// ───── la riga del database ─────

export const COLONNE_IMPOSTAZIONI_COPERTINA = "user_id, attivo, modalita, prezzo_centesimi, gare_massime, scade_il, nota, aggiornata_il, aggiornata_da_email";

// Una riga letta dal database; un valore che non ha senso rende le impostazioni inutilizzabili (null = come se non ci fossero: servizio spento)
export function impostazioniDaRiga(riga: unknown): ImpostazioniCopertina | null {
  const r = riga as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  if (r.modalita !== "gratis" && r.modalita !== "pagamento") return null;
  const intero = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    attivo: r.attivo === true,
    modalita: r.modalita,
    prezzoCentesimi: intero(r.prezzo_centesimi),
    gareMassime: intero(r.gare_massime),
    scadeIl: typeof r.scade_il === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.scade_il) ? r.scade_il.slice(0, 10) : null,
    nota: typeof r.nota === "string" && r.nota.trim() ? r.nota : null,
  };
}

// ───── le generazioni già fatte ─────

export type RigaGenerazione = { gara_id: string; stile: Stile; stato: "in_corso" | "pronta"; fonte: "gratis" | "pagamento" | "sviluppo"; creata_il: string };

// Le generazioni che contano: quelle pronte e quelle ancora in corso da poco (una cancellata perché non riuscita non c'è più; una interrotta non conta)
export function generazioniContate(righe: RigaGenerazione[], adesso: Date): RigaGenerazione[] {
  const limite = adesso.getTime() - MINUTI_GENERAZIONE_INTERROTTA * 60_000;
  return righe.filter((r) => {
    if (r.stato === "pronta") return true;
    if (r.stato !== "in_corso") return false;
    const creata = new Date(r.creata_il).getTime();
    return Number.isFinite(creata) && creata >= limite;
  });
}

export type UsoCopertine = {
  // le gare (distinte) del cliente che hanno già usato una delle sue gare gratis
  gareGratisUsate: string[];
  // le generazioni di QUESTA gara, per stile
  perStile: Record<Stile, number>;
};

// Dalle righe del registro del cliente (tutte le sue gare) a ciò che serve per decidere su una gara
export function usoDaRighe(righeCliente: RigaGenerazione[], garaId: string, adesso: Date): UsoCopertine {
  const contate = generazioniContate(righeCliente, adesso);
  const gareGratis = new Set<string>();
  const perStile: Record<Stile, number> = { stilizzato: 0, realistico: 0 };
  for (const r of contate) {
    if (r.fonte === "gratis") gareGratis.add(r.gara_id);
    if (r.gara_id === garaId && (STILI as readonly string[]).includes(r.stile)) perStile[r.stile] += 1;
  }
  return { gareGratisUsate: [...gareGratis], perStile };
}

// ───── la decisione ─────

export type ContestoDirittoCopertina = {
  impostazioni: ImpostazioniCopertina | null;
  // le tabelle non ci sono (migrazione 0106 non eseguita)
  schemaAssente: boolean;
  // NODE_ENV non è production e non si è su Vercel: le prove in locale
  sviluppoLocale: boolean;
  // il giorno di oggi a Roma (AAAA-MM-GG)
  oggi: string;
  garaId: string;
  uso: UsoCopertine;
  stile: Stile;
  // questa gara ha un acquisto PAGATO (confermato da Stripe, tabella della migrazione 0107): dà diritto alle generazioni in ogni caso
  acquistata: boolean;
  // il cliente può pagare adesso: la tabella degli acquisti c'è e la chiave Stripe di questo ambiente lo permette
  pagamentoDisponibile: boolean;
};

export type MotivoNegato = "spento" | "a_pagamento" | "scaduto" | "gare_finite" | "limite_stile";

export type EsitoDirittoCopertina =
  // consumaGara: questa copertina è la prima della gara e usa una delle gare gratis del cliente
  | { ok: true; fonte: "gratis" | "sviluppo" | "pagamento"; consumaGara: boolean }
  | { ok: false; motivo: Exclude<MotivoNegato, "a_pagamento">; messaggio: string }
  // a pagamento e non ancora pagata: il prezzo per gara (IVA inclusa) e se adesso si può comprare
  | { ok: false; motivo: "a_pagamento"; messaggio: string; prezzoCentesimi: number | null; acquistabile: boolean };

export const MESSAGGIO_COPERTINA_SPENTA = "La copertina della relazione tecnica non è attiva per il tuo account.";
const CONTATTI = "Scrivici dalla pagina Supporto per continuare.";

export function messaggioLimiteStile(stile: Stile): string {
  return `Hai già fatto ${COPERTINE_PER_STILE} generazioni in ${ETICHETTA_STILE[stile].toLowerCase()} per questa gara: è il massimo.`;
}

export function valutaDirittoCopertina(ctx: ContestoDirittoCopertina): EsitoDirittoCopertina {
  const imp = ctx.impostazioni;
  let fonte: "gratis" | "sviluppo" | "pagamento";
  let consumaGara = false;

  if (ctx.acquistata) {
    // chi ha pagato questa gara mantiene il suo diritto anche se la console poi spegne il servizio o ne cambia la modalità: resta solo il limite per stile
    fonte = "pagamento";
  } else if (ctx.schemaAssente && ctx.sviluppoLocale) {
    fonte = "sviluppo";
  } else {
    if (ctx.schemaAssente || !imp || !imp.attivo) return { ok: false, motivo: "spento", messaggio: MESSAGGIO_COPERTINA_SPENTA };
    if (imp.modalita === "pagamento") {
      const acquistabile = ctx.pagamentoDisponibile && imp.prezzoCentesimi !== null;
      const messaggio = acquistabile
        ? `Per questa gara il servizio costa ${euro(imp.prezzoCentesimi as number)} (IVA inclusa): una volta acquistato puoi generare fino a ${COPERTINE_PER_STILE} copertine per stile.`
        : `Per il tuo account il servizio ${imp.prezzoCentesimi !== null ? `costa ${euro(imp.prezzoCentesimi)} a gara (IVA inclusa)` : "è a pagamento"}. Il pagamento online non è ancora disponibile: scrivici dalla pagina Supporto per attivarlo.`;
      return { ok: false, motivo: "a_pagamento", messaggio, prezzoCentesimi: imp.prezzoCentesimi, acquistabile };
    }
    if (imp.scadeIl && imp.scadeIl < ctx.oggi) return { ok: false, motivo: "scaduto", messaggio: `Il periodo gratuito è terminato il ${formattaGiorno(imp.scadeIl)}. ${CONTATTI}` };
    const giaUsata = ctx.uso.gareGratisUsate.includes(ctx.garaId);
    if (imp.gareMassime !== null && !giaUsata && ctx.uso.gareGratisUsate.length >= imp.gareMassime) {
      return { ok: false, motivo: "gare_finite", messaggio: `Hai usato tutte le ${imp.gareMassime} ${imp.gareMassime === 1 ? "gara gratis inclusa" : "gare gratis incluse"} per le copertine. ${CONTATTI}` };
    }
    fonte = "gratis";
    consumaGara = !giaUsata;
  }

  if (ctx.uso.perStile[ctx.stile] >= COPERTINE_PER_STILE) return { ok: false, motivo: "limite_stile", messaggio: messaggioLimiteStile(ctx.stile) };
  return { ok: true, fonte, consumaGara };
}

// Il riquadro è visibile al cliente? Sì se il servizio è acceso per lui (anche se poi non può generare: scaduto, finito, a pagamento: lo si dice), o se si
// è in sviluppo locale senza le tabelle.
export function copertinaVisibile(ctx: Pick<ContestoDirittoCopertina, "impostazioni" | "schemaAssente" | "sviluppoLocale"> & { acquistata?: boolean }): boolean {
  if (ctx.acquistata) return true;
  if (ctx.schemaAssente) return ctx.sviluppoLocale;
  return Boolean(ctx.impostazioni?.attivo);
}

// Le righe che il cliente legge sotto i pulsanti: quanto gli resta del periodo gratuito. Vuote se non c'è nulla da dire.
export function righeGratisPerCliente(imp: ImpostazioniCopertina | null, uso: UsoCopertine, garaId: string): string[] {
  if (!imp || !imp.attivo || imp.modalita !== "gratis") return [];
  const righe: string[] = [];
  const giaUsata = uso.gareGratisUsate.includes(garaId);
  if (imp.gareMassime === null) {
    righe.push("Servizio gratuito per il tuo account, senza limite di gare.");
  } else {
    const rimaste = Math.max(0, imp.gareMassime - uso.gareGratisUsate.length);
    righe.push(
      giaUsata
        ? `Servizio gratuito per il tuo account: questa gara usa già una delle tue ${imp.gareMassime} gare gratis (te ne restano ${rimaste}).`
        : `Servizio gratuito per il tuo account: ${rimaste === 1 ? "ti resta 1 gara gratis" : `ti restano ${rimaste} gare gratis`} su ${imp.gareMassime}. La prima copertina di questa gara ne usa una.`,
    );
  }
  if (imp.scadeIl) righe.push(`Gratis fino al ${formattaGiorno(imp.scadeIl)}.`);
  return righe;
}

// ───── la console ─────

// Il prezzo in euro, come lo vede il cliente («49 €», «49,50 €»)
export function prezzoCopertina(centesimi: number): string {
  return euro(centesimi);
}

// Come le impostazioni si raccontano alla console
export function descriviImpostazioniCopertina(imp: ImpostazioniCopertina | null): string {
  if (!imp) return "Spento (mai configurato).";
  if (!imp.attivo) return "Spento.";
  if (imp.modalita === "pagamento") return `Acceso, a pagamento: ${imp.prezzoCentesimi !== null ? `${euro(imp.prezzoCentesimi)} a gara (IVA inclusa)` : "prezzo non indicato"}.`;
  const limite = imp.gareMassime === null ? "senza limite di gare" : `fino a ${imp.gareMassime} ${imp.gareMassime === 1 ? "gara" : "gare"}`;
  return `Acceso, gratis: ${limite}, ${imp.scadeIl ? `fino al ${formattaGiorno(imp.scadeIl)}` : "senza scadenza"}.`;
}

export type ValoriImpostazioniCopertina = {
  attivo: boolean;
  modalita: ModalitaCopertina;
  prezzoCentesimi: number | null;
  gareMassime: number | null;
  scadeIl: string | null;
  nota: string | null;
};

// I campi del modulo della console, come arrivano: si controlla tutto qui (il server non si fida del browser). `oggi` è il giorno di Roma (AAAA-MM-GG).
// Ciò che non vale per la modalità scelta si RIFIUTA (non si ignora in silenzio): il prezzo vale solo «a pagamento», il numero di gare e la scadenza solo «gratis».
export function validaImpostazioniCopertina(
  input: { stato: string; modalita: string; prezzo: string; gareMassime: string; scadeIl: string; nota: string },
  oggi: string,
): { ok: true; valori: ValoriImpostazioniCopertina } | { ok: false; errore: string } {
  const stato = input.stato.trim();
  if (stato !== "acceso" && stato !== "spento") return { ok: false, errore: "Scegli se il servizio è acceso o spento." };
  const attivo = stato === "acceso";

  const modalita = input.modalita.trim();
  if (modalita !== "gratis" && modalita !== "pagamento") return { ok: false, errore: "Scegli se il servizio è gratis o a pagamento." };

  const nota = input.nota.trim();
  if (nota.length > LIMITE_NOTA) return { ok: false, errore: `La nota è troppo lunga (massimo ${LIMITE_NOTA} caratteri).` };

  const prezzo = input.prezzo.trim();
  const massime = input.gareMassime.trim();
  const scadenza = input.scadeIl.trim();

  if (modalita === "pagamento") {
    if (massime !== "" || scadenza !== "") return { ok: false, errore: "Il numero di gare e la scadenza valgono solo per il servizio gratis: svuota quei campi, oppure scegli «gratis»." };
    const centesimi = euroACentesimi(prezzo);
    if (centesimi === null) return { ok: false, errore: "Scrivi il prezzo per gara in euro (per esempio 49 oppure 49,90)." };
    if (centesimi < LIMITI_PREZZO_COPERTINA.minimoCentesimi || centesimi > LIMITI_PREZZO_COPERTINA.massimoCentesimi) {
      return { ok: false, errore: `Il prezzo dev'essere tra ${euro(LIMITI_PREZZO_COPERTINA.minimoCentesimi)} e ${euro(LIMITI_PREZZO_COPERTINA.massimoCentesimi)}.` };
    }
    return { ok: true, valori: { attivo, modalita, prezzoCentesimi: centesimi, gareMassime: null, scadeIl: null, nota: nota || null } };
  }

  if (prezzo !== "") return { ok: false, errore: "Il prezzo vale solo per il servizio a pagamento: svuota il campo, oppure scegli «a pagamento»." };

  let gareMassime: number | null = null;
  if (massime !== "") {
    if (!/^\d{1,4}$/.test(massime) || Number(massime) < 1 || Number(massime) > LIMITE_GARE_GRATIS) {
      return { ok: false, errore: `Il numero di gare gratis dev'essere un intero da 1 a ${LIMITE_GARE_GRATIS} (lascia vuoto per nessun limite).` };
    }
    gareMassime = Number(massime);
  }

  let scadeIl: string | null = null;
  if (scadenza !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scadenza) || Number.isNaN(new Date(`${scadenza}T00:00:00Z`).getTime())) return { ok: false, errore: "La data di scadenza non è valida." };
    // una data già passata si rifiuta solo se si sta ACCENDENDO il servizio (accenderlo con una scadenza passata non servirebbe a nessuno)
    if (attivo && scadenza < oggi) return { ok: false, errore: "La data di scadenza è già passata." };
    scadeIl = scadenza;
  }
  return { ok: true, valori: { attivo, modalita, prezzoCentesimi: null, gareMassime, scadeIl, nota: nota || null } };
}
