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
//
// Dal 17/11/2026 (richiesta dell'utente: «mettiamola in Sistema come il piano di lavoro») la copertina si VENDE A TUTTI come il piano di lavoro: pagina
// «Copertina» della console con interruttore di vendita (spento di base), prezzo per gara uguale per tutti (50 €), pacchetti prepagati (5 gare a 175 €),
// offerte dedicate, regola per gli account in prova e concessioni gratuite. Le impostazioni per cliente restano come CONDIZIONI PARTICOLARI: «gratis»
// (con gare e scadenza) o «a pagamento» con un prezzo suo; «spento» ora vuol dire «nessuna condizione particolare» (valgono le regole generali).
// Ordine delle fonti del diritto per una gara: acquisto pagato > (sviluppo locale senza tabelle) > concessione gratuita > gratis del cliente >
// pacchetto (unità già usata da questa gara, o saldo) > prova «inclusa gratis» > acquisto (prezzo del cliente, altrimenti quello generale).

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

// Da dove viene il diritto a una generazione (colonna «fonte» del registro; «concessione», «pacchetto» e «prova» dalla migrazione 0130)
export type FonteCopertina = "gratis" | "pagamento" | "sviluppo" | "concessione" | "pacchetto" | "prova";

export type RigaGenerazione = { gara_id: string; stile: Stile; stato: "in_corso" | "pronta"; fonte: FonteCopertina; creata_il: string };

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
  // ── la vendita a tutti (17/11/2026); assenti = come prima: niente vendita, niente concessioni, niente pacchetti ──
  // l'interruttore di vendita della console è acceso
  venditaAttiva?: boolean;
  // il prezzo per gara uguale per tutti (IVA inclusa)
  prezzoGeneraleCentesimi?: number | null;
  // la concessione gratuita della console che copre questa gara (migrazione 0130), se c'è
  concessioneId?: string | null;
  // pacchetto prepagato: le unità residue e se questa gara ha già usato la sua
  pacchetto?: { saldo: number; garaGiaConsumata: boolean };
  // l'account è in prova (gare gratuite, nessun abbonamento) e la regola della console per chi è in prova
  inProva?: boolean;
  politicaProva?: "acquisto" | "gratis" | "bloccato";
};

export type MotivoNegato = "spento" | "a_pagamento" | "scaduto" | "gare_finite" | "limite_stile" | "prova_bloccata";

export type EsitoDirittoCopertina =
  // consumaGara: questa copertina è la prima della gara e usa una delle gare gratis del cliente; consumaUnita: è la prima della gara e usa un'unità del
  // pacchetto (il cliente lo conferma); concessioneId: la concessione che la rende possibile
  | { ok: true; fonte: FonteCopertina; consumaGara: boolean; consumaUnita?: boolean; concessioneId?: string | null }
  | { ok: false; motivo: Exclude<MotivoNegato, "a_pagamento">; messaggio: string }
  // a pagamento e non ancora pagata: il prezzo per gara (IVA inclusa) e se adesso si può comprare
  | { ok: false; motivo: "a_pagamento"; messaggio: string; prezzoCentesimi: number | null; acquistabile: boolean };

export const MESSAGGIO_COPERTINA_SPENTA = "La copertina della relazione tecnica non è attiva per il tuo account.";
const CONTATTI = "Scrivici dalla pagina Supporto per continuare.";

export function messaggioLimiteStile(stile: Stile): string {
  return `Hai già fatto ${COPERTINE_PER_STILE} generazioni in ${ETICHETTA_STILE[stile].toLowerCase()} per questa gara: è il massimo.`;
}

export const MESSAGGIO_COPERTINA_PROVA_BLOCCATA = "Durante la prova la copertina della relazione tecnica non è disponibile: lo sarà con l'abbonamento.";

export function valutaDirittoCopertina(ctx: ContestoDirittoCopertina): EsitoDirittoCopertina {
  const imp = ctx.impostazioni;
  const consenti = (esito: Extract<EsitoDirittoCopertina, { ok: true }>): EsitoDirittoCopertina =>
    ctx.uso.perStile[ctx.stile] >= COPERTINE_PER_STILE ? { ok: false, motivo: "limite_stile", messaggio: messaggioLimiteStile(ctx.stile) } : esito;

  // chi ha pagato questa gara mantiene il suo diritto anche se la console poi spegne il servizio o ne cambia la modalità: resta solo il limite per stile
  if (ctx.acquistata) return consenti({ ok: true, fonte: "pagamento", consumaGara: false });
  if (ctx.schemaAssente && ctx.sviluppoLocale) return consenti({ ok: true, fonte: "sviluppo", consumaGara: false });
  if (ctx.schemaAssente) return { ok: false, motivo: "spento", messaggio: MESSAGGIO_COPERTINA_SPENTA };

  // la concessione gratuita della console per questa gara (o per tutte le sue gare, nei limiti)
  if (ctx.concessioneId) return consenti({ ok: true, fonte: "concessione", consumaGara: false, concessioneId: ctx.concessioneId });

  // le condizioni particolari del cliente: «gratis» (nei suoi limiti). Se il periodo è finito si guardano le altre fonti, e se non ce n'è nessuna si dice
  // perché il gratis è finito.
  let gratisFinito: EsitoDirittoCopertina | null = null;
  if (imp?.attivo && imp.modalita === "gratis") {
    const giaUsata = ctx.uso.gareGratisUsate.includes(ctx.garaId);
    if (imp.scadeIl && imp.scadeIl < ctx.oggi) gratisFinito = { ok: false, motivo: "scaduto", messaggio: `Il periodo gratuito è terminato il ${formattaGiorno(imp.scadeIl)}. ${CONTATTI}` };
    else if (imp.gareMassime !== null && !giaUsata && ctx.uso.gareGratisUsate.length >= imp.gareMassime) {
      gratisFinito = { ok: false, motivo: "gare_finite", messaggio: `Hai usato tutte le ${imp.gareMassime} ${imp.gareMassime === 1 ? "gara gratis inclusa" : "gare gratis incluse"} per le copertine. ${CONTATTI}` };
    } else return consenti({ ok: true, fonte: "gratis", consumaGara: !giaUsata });
  }

  // pacchetto prepagato: la gara che ha già usato la sua unità continua senza consumarne altre; altrimenti un'unità del saldo (il cliente lo conferma)
  const pacchetto = ctx.pacchetto ?? { saldo: 0, garaGiaConsumata: false };
  if (pacchetto.garaGiaConsumata) return consenti({ ok: true, fonte: "pacchetto", consumaGara: false, consumaUnita: false });
  if (pacchetto.saldo > 0) return consenti({ ok: true, fonte: "pacchetto", consumaGara: false, consumaUnita: true });

  // Le condizioni «a pagamento» del cliente: un prezzo suo, che vale sempre (anche a vendita spenta, come prima della vendita a tutti) e prevale su quello
  // generale e sulla regola della prova.
  if (imp?.attivo && imp.modalita === "pagamento") {
    const acquistabile = ctx.pagamentoDisponibile && imp.prezzoCentesimi !== null;
    const messaggio = acquistabile
      ? `Per questa gara il servizio costa ${euro(imp.prezzoCentesimi as number)} (IVA inclusa): una volta acquistato puoi generare fino a ${COPERTINE_PER_STILE} copertine per stile.`
      : `Per il tuo account il servizio ${imp.prezzoCentesimi !== null ? `costa ${euro(imp.prezzoCentesimi)} a gara (IVA inclusa)` : "è a pagamento"}. Il pagamento online non è ancora disponibile: scrivici dalla pagina Supporto per attivarlo.`;
    return { ok: false, motivo: "a_pagamento", messaggio, prezzoCentesimi: imp.prezzoCentesimi, acquistabile };
  }

  // gli account in prova, a vendita accesa: la regola della console (di base comprano come tutti)
  if (ctx.venditaAttiva && ctx.inProva && ctx.politicaProva === "gratis") return consenti({ ok: true, fonte: "prova", consumaGara: false });
  if (ctx.venditaAttiva && ctx.inProva && ctx.politicaProva === "bloccato") return gratisFinito ?? { ok: false, motivo: "prova_bloccata", messaggio: MESSAGGIO_COPERTINA_PROVA_BLOCCATA };

  // la vendita a tutti, al prezzo generale: solo a vendita accesa e se il pagamento online è possibile in questo ambiente
  const prezzoGenerale = ctx.prezzoGeneraleCentesimi ?? null;
  if (ctx.venditaAttiva && ctx.pagamentoDisponibile && prezzoGenerale !== null) {
    return {
      ok: false,
      motivo: "a_pagamento",
      messaggio: `Per questa gara il servizio costa ${euro(prezzoGenerale)} (IVA inclusa): una volta acquistato puoi generare fino a ${COPERTINE_PER_STILE} copertine per stile.`,
      prezzoCentesimi: prezzoGenerale,
      acquistabile: true,
    };
  }
  return gratisFinito ?? { ok: false, motivo: "spento", messaggio: MESSAGGIO_COPERTINA_SPENTA };
}

// Il riquadro è visibile al cliente? Sì se per lui c'è qualcosa da dire o da fare: può generare, può comprare, ha raggiunto un limite, il suo periodo
// gratuito è finito (lo si dice), ha condizioni particolari dalla console. No se il servizio, per lui, è spento (niente vendita, niente condizioni, niente
// concessioni, niente pacchetti) o se è in prova con la regola «non disponibile». La pagina lo mostra comunque se ci sono già copertine da scaricare.
export function copertinaVisibile(ctx: Partial<Omit<ContestoDirittoCopertina, "stile">> & Pick<ContestoDirittoCopertina, "impostazioni" | "schemaAssente" | "sviluppoLocale">): boolean {
  const esito = valutaDirittoCopertina({
    garaId: "",
    oggi: "",
    uso: { gareGratisUsate: [], perStile: { stilizzato: 0, realistico: 0 } },
    acquistata: false,
    pagamentoDisponibile: false,
    ...ctx,
    stile: "stilizzato",
  });
  if (esito.ok) return true;
  if (esito.motivo === "spento" || esito.motivo === "prova_bloccata") return Boolean(ctx.impostazioni?.attivo);
  return true;
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
  if (!imp) return "Nessuna condizione particolare (mai impostate): valgono le regole generali della pagina Copertina.";
  if (!imp.attivo) return "Nessuna condizione particolare: valgono le regole generali della pagina Copertina.";
  if (imp.modalita === "pagamento") return `Prezzo dedicato: ${imp.prezzoCentesimi !== null ? `${euro(imp.prezzoCentesimi)} a gara (IVA inclusa)` : "prezzo non indicato"}, al posto di quello generale (vale anche a vendita spenta).`;
  const limite = imp.gareMassime === null ? "senza limite di gare" : `fino a ${imp.gareMassime} ${imp.gareMassime === 1 ? "gara" : "gare"}`;
  return `Gratis: ${limite}, ${imp.scadeIl ? `fino al ${formattaGiorno(imp.scadeIl)}` : "senza scadenza"}.`;
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

// ───── pacchetto e concessione, detti al cliente nella pagina della gara ─────

export const TESTI_COPERTINA_PACCHETTO = {
  usaUnita: (saldo: number) => `usa 1 delle tue ${saldo} gare con copertina`,
  confermaUsoUnita: "Usare 1 gara del tuo pacchetto copertine per questa gara? Comprende fino a 3 generazioni per stile.",
  usoNonConfermato: "La prima copertina di questa gara usa 1 gara del tuo pacchetto: ricarica la pagina e conferma.",
  saldoEsaurito: "Hai finito le gare del tuo pacchetto copertine: puoi acquistare la copertina di questa gara oppure un nuovo pacchetto.",
} as const;

// Le righe sotto i pulsanti che spiegano da dove viene il diritto quando non è il gratis del cliente (quello lo dice righeGratisPerCliente).
export function righeFontePerCliente(esito: EsitoDirittoCopertina, saldo: number): string[] {
  if (!esito.ok) return [];
  if (esito.fonte === "concessione") return ["Copertina gratuita per questa gara (concessione di OMNIA AI)."];
  if (esito.fonte === "prova") return ["Durante la prova la copertina è inclusa."];
  if (esito.fonte === "pacchetto") {
    return esito.consumaUnita
      ? [`Dal tuo pacchetto: ${saldo === 1 ? "ti resta 1 gara con copertina" : `ti restano ${saldo} gare con copertina`}. La prima copertina di questa gara ne usa una (${saldo === 1 ? "è l'ultima" : `poi te ne resteranno ${saldo - 1}`}).`]
      : ["Questa gara usa già una gara del tuo pacchetto copertine: le altre generazioni non ne consumano altre."];
  }
  return [];
}
