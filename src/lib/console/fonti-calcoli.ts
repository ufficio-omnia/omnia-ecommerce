// Pagina «Fonti» della console (48C §3.5–3.6): testi e colori dello stato e degli allarmi, prossimo giro previsto, righe del registro dei giri
// per l'elenco. Logica pura, provata da scripts/verifica-monitorate-fonti-nascoste.ts (sezione S). Lo stato e gli allarmi li calcola B2
// (stato-fonti-calcoli.ts, K3): qui solo come si mostrano.
import type { FonteEsecuzione } from "@/lib/radar/esecuzioni-calcoli";
import { CRON_PROPOSTI, INTERRUTTORE_REGIONALI_VECCHIO, INTERRUTTORI_CRON, ORARI_GIRI, cronAttiviDa, orariPrevisti, type GiorniGiro } from "@/lib/radar/programmazione-calcoli";
import type { GravitaAllarme, RigaEsecuzioneLetta, StatoFonte } from "@/lib/radar/stato-fonti-calcoli";

export type TonoConsole = "neutro" | "ok" | "avviso" | "errore";

export const STATO_FONTE_CONSOLE: Record<StatoFonte, { testo: string; spiegazione: string; tono: TonoConsole }> = {
  ok: { testo: "In funzione", spiegazione: "l'ultimo esito non è un errore più recente dell'ultimo successo", tono: "ok" },
  in_errore: { testo: "In errore", spiegazione: "l'ultimo esito è un errore più recente dell'ultimo successo", tono: "errore" },
  sospesa: { testo: "Sospesa dal connettore", spiegazione: "fermata da un giro (motivo nel registro); si riaccende solo da qui", tono: "errore" },
  spenta: { testo: "Spenta", spiegazione: "spenta dalla console: nessun giro", tono: "neutro" },
};

export const GRAVITA_CONSOLE: Record<GravitaAllarme, { testo: string; tono: TonoConsole }> = {
  errore: { testo: "errore", tono: "errore" },
  avviso: { testo: "avviso", tono: "avviso" },
  informazione: { testo: "informazione", tono: "neutro" },
};

export const NOME_FONTE_CONSOLE: Record<FonteEsecuzione, string> = { ted: "TED", pvl: "PVL ANAC", sintel: "Sintel", sardegnacat: "SardegnaCAT" };

const MODO: Record<string, string> = { incrementale: "incrementale", recupero: "recupero", finestra: "finestra", manuale: "manuale (console)" };
const ESITO: Record<string, string> = { ok: "riuscito", errore: "errore", sospesa: "sospesa", occupata: "occupata (altro giro in corso)", inerte: "nulla da fare", gia_eseguito: "già eseguito" };

export function modoLeggibile(m: string): string {
  return MODO[m] ?? m;
}
export function esitoLeggibile(e: string): string {
  return ESITO[e] ?? e;
}

// Accendere una fonte avvia acquisizioni vere: la conferma (casella «conferma» = «si» del modulo) è controllata anche nel SERVER, nelle tre
// azioni della console (impostaFonteTed, impostaFontePvl, impostaFonteRegionale), prima di ogni lettura o scrittura (decisione del
// coordinamento del 23/11). Spegnere resta sempre ammesso senza conferma: è la direzione sicura.
export const ERRORE_CONFERMA_ACCENSIONE = "Accendere la fonte avvia acquisizioni vere: spunta la casella di conferma e riprova. Nessuna modifica salvata.";
export function accensioneConfermata(dati: FormData): boolean {
  return dati.get("conferma") === "si";
}

export const GIRI_PER_FONTE = 10;
const GIORNI_PROSSIMO_GIRO = 8;

// ───── giri programmati (K1 di B2): orari, interruttori e righe cron vengono SOLO da programmazione-calcoli.ts, mai scritti a mano qui né
// nelle viste e nelle azioni della console (la prova FS12 lo controlla sui sorgenti) ─────

const GIORNI_LEGGIBILI: Record<GiorniGiro, string> = { tutti: "tutti i giorni", feriali: "dal lunedì al venerdì", fine_settimana: "il sabato e la domenica" };

/** Gli orari di Roma dei giri programmati di una fonte (ORARI_GIRI), in chiaro: «08:05, 13:05, 18:05 tutti i giorni». */
export function orariLeggibili(fonte: FonteEsecuzione): string {
  const gruppi = new Map<GiorniGiro, string[]>();
  for (const o of ORARI_GIRI[fonte]) gruppi.set(o.giorni, [...(gruppi.get(o.giorni) ?? []), o.ora]);
  return [...gruppi].map(([giorni, ore]) => `${ore.join(", ")} ${GIORNI_LEGGIBILI[giorni]}`).join("; ");
}

export type GiriProgrammatiConsole = {
  fonte: FonteEsecuzione;
  // accesi in questo ambiente (cronAttiviDa: l'interruttore della fonte; per Sintel e SardegnaCAT anche il vecchio delle regionali)
  attivi: boolean;
  // il proprio interruttore per primo, poi l'eventuale vecchio interruttore ancora valido
  interruttori: string[];
  orari: string;
  cronProposti: string[];
  // il prossimo orario dei giri programmati, accesi o no (la pagina «Fonti» lo mostra come prossimo giro solo con fonte e giri accesi)
  prossimoOrario: string | null;
};

export function giriProgrammatiFonte(fonte: FonteEsecuzione, env: Record<string, string | undefined>, adesso: Date): GiriProgrammatiConsole {
  return {
    fonte,
    attivi: cronAttiviDa(env).has(fonte),
    interruttori: fonte === "sintel" || fonte === "sardegnacat" ? [INTERRUTTORI_CRON[fonte], INTERRUTTORE_REGIONALI_VECCHIO] : [INTERRUTTORI_CRON[fonte]],
    orari: orariLeggibili(fonte),
    cronProposti: [...CRON_PROPOSTI[fonte]],
    prossimoOrario: orariPrevisti(fonte, adesso, new Date(adesso.getTime() + GIORNI_PROSSIMO_GIRO * 86_400_000))[0]?.toISOString() ?? null,
  };
}

export function giriProgrammatiTutti(env: Record<string, string | undefined>, adesso: Date): Record<FonteEsecuzione, GiriProgrammatiConsole> {
  return { ted: giriProgrammatiFonte("ted", env, adesso), pvl: giriProgrammatiFonte("pvl", env, adesso), sintel: giriProgrammatiFonte("sintel", env, adesso), sardegnacat: giriProgrammatiFonte("sardegnacat", env, adesso) };
}

/** «RADAR_SINTEL_CRON=attivo (o il vecchio RADAR_REGIONALI_CRON=attivo)» */
export function interruttoriLeggibili(g: GiriProgrammatiConsole): string {
  const [proprio, ...vecchi] = g.interruttori;
  return `${proprio}=attivo${vecchi.length ? ` (o il vecchio ${vecchi.map((n) => `${n}=attivo`).join(", ")})` : ""}`;
}

/** La frase dei giri programmati per la console e per gli esiti delle azioni: orari di Roma, accesi o spenti, che cosa serve per accenderli. */
export function testoGiriProgrammati(g: GiriProgrammatiConsole): string {
  const orari = `Giri programmati alle ${g.orari} (ora di Roma)`;
  return g.attivi
    ? `${orari}: accesi in questo ambiente (${interruttoriLeggibili(g)}).`
    : `${orari}: spenti in questo ambiente; per accenderli servono l'autorizzazione operativa, ${g.cronProposti.length === 1 ? "la riga" : "le righe"} «${g.cronProposti.join("», «")}» in vercel.json e ${interruttoriLeggibili(g)}.`;
}

/** Il prossimo giro previsto: solo per una fonte accesa con i giri programmati accesi in questo ambiente; altrimenti null. */
export function prossimoGiro(fonte: FonteEsecuzione, attiva: boolean, cronAttivo: boolean, adesso: Date): string | null {
  if (!attiva || !cronAttivo) return null;
  return orariPrevisti(fonte, adesso, new Date(adesso.getTime() + GIORNI_PROSSIMO_GIRO * 86_400_000))[0]?.toISOString() ?? null;
}

// Una riga del registro per l'elenco: solo conteggi, codici e l'errore ripulito del giro (nessun dato di gare)
export type GiroConsole = {
  modo: string;
  esito: string;
  iniziatoIl: string;
  durataMs: number | null;
  richiesteFonte: number;
  richiesteDb: number;
  gareNuove: number;
  allarmi: string[];
  errore: string | null;
};

export function giroConsole(r: RigaEsecuzioneLetta): GiroConsole {
  const durata = Date.parse(r.finito_il) - Date.parse(r.iniziato_il);
  return {
    modo: r.modo,
    esito: r.esito,
    iniziatoIl: r.iniziato_il,
    durataMs: Number.isFinite(durata) && durata >= 0 ? durata : null,
    richiesteFonte: r.fonte_richieste,
    richiesteDb: r.db_richieste,
    gareNuove: r.gare_nuove,
    allarmi: r.allarmi ?? [],
    errore: r.errore,
  };
}

/** Gli ultimi giri di ciascuna fonte (al più GIRI_PER_FONTE, dal più recente) da righe già lette in ordine decrescente. */
export function giriPerFonte(righe: readonly RigaEsecuzioneLetta[], fonte: string): GiroConsole[] {
  return righe
    .filter((r) => r.fonte === fonte)
    .sort((a, b) => Date.parse(b.iniziato_il) - Date.parse(a.iniziato_il))
    .slice(0, GIRI_PER_FONTE)
    .map(giroConsole);
}
