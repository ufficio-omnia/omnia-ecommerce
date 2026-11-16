// Interruttori, crediti e limiti di Tender Intelligence. Logica pura: i valori arrivano da console_impostazioni e da omnia_ai_radar_impostazioni
// (letti in impostazioni.ts), qui solo le regole. Provato da scripts/verifica-radar-fondamenta.ts.
//
// Regole approvate:
//   - il modulo è SPENTO per difetto: si vede solo con l'interruttore generale acceso E l'interruttore del cliente acceso; in sviluppo locale
//     (mai in produzione né su Vercel) si può aprire con OMNIA_AI_RADAR_APERTO=1, per le prove;
//   - qualunque errore o valore non riconosciuto = spento (nel dubbio non si mostra);
//   - le azioni costano crediti del Radar secondo un parametro per azione, predefinito ZERO: finché vale zero non si addebita nulla
//     (decisione D2); il contatore delle gare del piano non si tocca mai;
//   - limiti tecnici per organizzazione (precisazione P4): azioni per giorno o per minuto, con possibilità di valori dedicati al singolo cliente.

export const AZIONI_RADAR = ["ricerca", "sintesi", "analisi_requisiti", "intelligence", "crea_offerta", "aggiungi_manuale", "monitora"] as const;
export type AzioneRadar = (typeof AZIONI_RADAR)[number];

export const CHIAVE_RADAR_ATTIVO = "radar_attivo";
export const PREFISSO_COSTO = "radar_costo_";
export const PREFISSO_LIMITE = "radar_limite_";

export type NomeLimite = "progetti_senza_analisi" | "ricerche_minuto" | "sintesi_giorno" | "analisi_requisiti_giorno";

export const LIMITI_PREDEFINITI: Readonly<Record<NomeLimite, number>> = {
  progetti_senza_analisi: 5,
  ricerche_minuto: 60,
  sintesi_giorno: 200,
  analisi_requisiti_giorno: 20,
};

// Tetto di ragionevolezza: un valore oltre questo è un errore di battitura, si torna al predefinito.
const MASSIMO_LIMITE = 100_000;
const MASSIMO_COSTO = 1_000;

export type ParametriRadar = {
  attivo: boolean;
  costi: Record<AzioneRadar, number>;
  limiti: Record<NomeLimite, number>;
};

export function interpretaInterruttore(valore: string | null | undefined): boolean {
  return valore === "1";
}

function interoValido(valore: string | null | undefined, massimo: number): number | null {
  if (valore === null || valore === undefined) return null;
  const t = valore.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n <= massimo ? n : null;
}

// righe = null: lettura fallita o tabella assente → tutto spento, costi zero, limiti predefiniti.
export function parametriDaRighe(righe: readonly { chiave: string; valore: string }[] | null): ParametriRadar {
  const mappa = new Map((righe ?? []).map((r) => [r.chiave, r.valore]));
  const costi = Object.fromEntries(AZIONI_RADAR.map((a) => [a, interoValido(mappa.get(`${PREFISSO_COSTO}${a}`), MASSIMO_COSTO) ?? 0])) as Record<AzioneRadar, number>;
  const limiti = Object.fromEntries(
    (Object.keys(LIMITI_PREDEFINITI) as NomeLimite[]).map((n) => [n, interoValido(mappa.get(`${PREFISSO_LIMITE}${n}`), MASSIMO_LIMITE) ?? LIMITI_PREDEFINITI[n]]),
  ) as Record<NomeLimite, number>;
  return { attivo: righe !== null && interpretaInterruttore(mappa.get(CHIAVE_RADAR_ATTIVO)), costi, limiti };
}

export type ImpostazioniClienteRadar = { attivo: boolean; limiti: Partial<Record<NomeLimite, number>> };

// I limiti dedicati a un cliente (colonna jsonb «limiti»): si tengono solo i nomi noti con valori interi validi.
export function impostazioniClienteDaRiga(riga: { attivo: boolean | null; limiti: unknown } | null): ImpostazioniClienteRadar | null {
  if (!riga) return null;
  const limiti: Partial<Record<NomeLimite, number>> = {};
  if (riga.limiti && typeof riga.limiti === "object" && !Array.isArray(riga.limiti)) {
    for (const nome of Object.keys(LIMITI_PREDEFINITI) as NomeLimite[]) {
      const v = (riga.limiti as Record<string, unknown>)[nome];
      if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MASSIMO_LIMITE) limiti[nome] = v;
    }
  }
  return { attivo: riga.attivo === true, limiti };
}

export function limiteEffettivo(parametri: ParametriRadar, cliente: ImpostazioniClienteRadar | null, nome: NomeLimite): number {
  return cliente?.limiti[nome] ?? parametri.limiti[nome];
}

export function creditiPerAzione(parametri: ParametriRadar, azione: AzioneRadar): number {
  return parametri.costi[azione] ?? 0;
}

export function aperturaSviluppoRadar(env: Record<string, string | undefined>): boolean {
  if (env.OMNIA_AI_RADAR_APERTO !== "1") return false;
  return env.NODE_ENV !== "production" && !env.VERCEL;
}

export type StatoAccessoRadar = "attivo" | "prova" | "sola_lettura" | "cessato";

export type DirittoRadar =
  | { visibile: false; operativo: false; motivo: "spento" | "cliente_non_abilitato" }
  | { visibile: true; operativo: boolean; motivo: "abilitato" | "sviluppo"; messaggioSolaLettura: string | null };

export const MESSAGGIO_RADAR_SOLA_LETTURA =
  "Il tuo abbonamento non è attivo: puoi consultare le gare che hai già salvato, ma non cercarne di nuove né avviare analisi.";

export function dirittoRadar(dati: {
  parametri: ParametriRadar;
  cliente: ImpostazioniClienteRadar | null;
  statoAccesso: StatoAccessoRadar;
  aperturaSviluppo: boolean;
}): DirittoRadar {
  const abilitato = dati.parametri.attivo && dati.cliente?.attivo === true;
  if (!abilitato && !dati.aperturaSviluppo) return { visibile: false, operativo: false, motivo: dati.parametri.attivo ? "cliente_non_abilitato" : "spento" };
  const operativo = dati.statoAccesso === "attivo" || dati.statoAccesso === "prova";
  return { visibile: true, operativo, motivo: abilitato ? "abilitato" : "sviluppo", messaggioSolaLettura: operativo ? null : MESSAGGIO_RADAR_SOLA_LETTURA };
}

export type EsitoLimite = { consentito: boolean; usate: number; limite: number; rimanenti: number };

export function verificaLimite(usate: number, limite: number): EsitoLimite {
  const u = Math.max(0, Math.floor(usate));
  const l = Math.max(0, Math.floor(limite));
  return { consentito: u < l, usate: u, limite: l, rimanenti: Math.max(0, l - u) };
}

// Inizio della finestra di conteggio di un limite: il giorno di calendario di Roma per i limiti «_giorno», l'ultimo minuto per «_minuto».
export function inizioFinestra(nome: NomeLimite, adesso: Date): Date | null {
  if (nome.endsWith("_minuto")) return new Date(adesso.getTime() - 60_000);
  if (nome.endsWith("_giorno")) {
    const parti = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(adesso);
    const v = (t: string) => Number(parti.find((p) => p.type === t)?.value);
    const trascorsiMs = ((v("hour") * 60 + v("minute")) * 60 + v("second")) * 1000 + adesso.getMilliseconds();
    return new Date(adesso.getTime() - trascorsiMs);
  }
  return null;
}
