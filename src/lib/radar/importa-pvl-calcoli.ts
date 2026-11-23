// Importazione dalla PVL di ANAC: costanti delle finestre, validazione del cursore v1 (solo per la conversione), orari dei giri, riga della
// gara costruita da un avviso. Logica pura, provata da scripts/verifica-radar-pvl.ts.
//
// Dal K4 (48C) il cursore e le sue regole stanno in importa-pvl-cursore.ts (versione 2: incrementale, finestra controllata, recupero dei
// 90 giorni, buchi, completezza); un cursore v1 salvato si converte da lì senza perdere nulla.
import { attribuzioneRicercaPvl, descrizioniDaRaccogliere, type AvvisoPvlLetto, type BandoPvl } from "./fonti/pvl-calcoli";
import { rigaDaBando, type RigaProcedura } from "./importa-calcoli";

export const GIORNI_SOVRAPPOSIZIONE_PVL = 1;
// Finestra massima di un giro incrementale: dopo un fermo più lungo il resto entra nei buchi e lo legge il recupero (importa-pvl-cursore.ts).
export const GIORNI_MASSIMI_INCREMENTALE = 7;
// Oltre questi avvisi per giorno di finestra la risposta è anomala: il giro si ferma e la console lo segnala.
export const AVVISI_ANOMALI_PER_GIORNO = 400;

// Cursore versione 1 (fino al K4): resta solo per leggere e convertire quello salvato.
export type CursorePvl = {
  versione: 1;
  modo: "finestra" | "incrementale";
  inCorso: boolean;
  da: string;
  a: string;
  token: string | null;
  pagine: number;
  // ultimo giorno letto per intero da un giro incrementale finito (la finestra controllata non lo sposta in avanti oltre il suo «a»)
  ultimoGiorno: string | null;
};

const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

export function cursorePvlValido(v: unknown): CursorePvl | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<CursorePvl>;
  const g = (x: unknown) => typeof x === "string" && GIORNO.test(x);
  if (c.versione !== 1 || (c.modo !== "finestra" && c.modo !== "incrementale") || typeof c.inCorso !== "boolean") return null;
  if (!g(c.da) || !g(c.a) || (c.da as string) > (c.a as string)) return null;
  if (c.token !== null && (typeof c.token !== "string" || c.token.length > 500)) return null;
  if (!Number.isInteger(c.pagine) || (c.pagine as number) < 0) return null;
  if (c.ultimoGiorno !== null && !g(c.ultimoGiorno)) return null;
  return c as CursorePvl;
}

export function giorniFinestra(c: Pick<CursorePvl, "da" | "a">): number {
  return Math.round((Date.parse(`${c.a}T12:00:00Z`) - Date.parse(`${c.da}T12:00:00Z`)) / 86_400_000) + 1;
}

export function conteggioAnomalo(count: number | null, c: Pick<CursorePvl, "da" | "a">): boolean {
  return count !== null && count > AVVISI_ANOMALI_PER_GIORNO * giorniFinestra(c);
}

// ───── giri programmati: 8:00, 13:00, 18:00 ora italiana, con l'ora legale ─────

export const ORE_GIRI_PVL = [8, 13, 18] as const;

// Le righe di vercel.json che servirebbero: Vercel ragiona in UTC, quindi si chiamano entrambe le ore UTC possibili (ora solare e legale)
// e il percorso parte solo quando a Roma è l'ora giusta. NON sono in vercel.json: si aggiungono solo con l'autorizzazione operativa.
export const CRON_PVL_PROPOSTO = "5 6,7,11,12,16,17 * * *";

const FMT_ORA_ROMA = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function oraDiRoma(d: Date): { ora: number; minuto: number } {
  const [h, m] = FMT_ORA_ROMA.format(d).split(":").map(Number);
  return { ora: h, minuto: m };
}

// Questo richiamo del cron è uno dei tre giri? Sì solo nell'ora giusta a Roma (entro 30 minuti, per i ritardi di Vercel).
export function eOraDiUnGiroPvl(d: Date): boolean {
  const { ora, minuto } = oraDiRoma(d);
  return (ORE_GIRI_PVL as readonly number[]).includes(ora) && minuto < 30;
}

// Il prossimo giro previsto dopo «d» (per la console): il primo istante in cui a Roma sono le 8, le 13 o le 18.
export function prossimoGiroPvl(d: Date): Date {
  const t = new Date(d.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(0);
  for (let i = 0; i < 72; i++) {
    t.setUTCHours(t.getUTCHours() + 1);
    const { ora, minuto } = oraDiRoma(t);
    if (minuto === 0 && (ORE_GIRI_PVL as readonly number[]).includes(ora)) return new Date(t.getTime());
  }
  return t;
}

// ───── riga della gara costruita da un solo avviso PVL ─────

export function rigaDaBandoPvl(b: BandoPvl, adesso: Date): RigaProcedura {
  return rigaDaBando(
    { record: b.record, regioni: b.regioni, enteTipo: null, scadenzaFonte: b.scadenzaFonte, settori: b.settori, metodoSettore: b.metodoSettore, meta: { data: b.meta.giorno, numero: `pvl:${b.meta.idAvviso}` } },
    null,
    adesso,
  );
}

// ───── statistiche di un giro (registrate in radar_fonti_stato.conteggi e mostrate in console) ─────

// C2 (49C, R2): per un codice dell'elenco di ricerca, in un giro: avvisi letti, ammessi nell'archivio («bandi», comprese indagini ed elenchi
// di C1) con il loro livello migliore (A o B), e scartati perché fuori dai settori. La potatura la decide l'utente (mai automatica).
export type MisuraCodicePvl = { letti: number; bandi: number; a: number; b: number; fuori_settore: number };
// R4: al più tante voci nuove per giro, per non gonfiare il registro
export const MASSIMO_DESCRIZIONI_RACCOLTE = 50;

/** C2: aggiunge alla misura per codice gli avvisi di una pagina (stesso ordine di `letti`, cioè content.map(leggiAvvisoPvl)). */
export function misuraPerCodicePvl(stat: StatistichePvl["avvisi"], avvisi: readonly Record<string, unknown>[], letti: readonly AvvisoPvlLetto[]): void {
  avvisi.forEach((a, i) => {
    const { codici, delFile } = attribuzioneRicercaPvl(a);
    // R4: coppie certe da qualunque avviso; descrizioni sconosciute solo dagli avvisi che non si attribuiscono
    const { coppie, sconosciute } = descrizioniDaRaccogliere(a);
    const daCompletare = (stat.descrizioniDaCompletare ??= {});
    for (const [c, t] of Object.entries(coppie)) if (!(c in daCompletare) && Object.keys(daCompletare).length < MASSIMO_DESCRIZIONI_RACCOLTE) daCompletare[c] = t;
    if (codici.length === 0) {
      if (!delFile) {
        stat.nonAttribuiti++;
        const ignote = (stat.descrizioniSconosciute ??= {});
        for (const t of sconosciute) if (t in ignote || Object.keys(ignote).length < MASSIMO_DESCRIZIONI_RACCOLTE) ignote[t] = (ignote[t] ?? 0) + 1;
      }
      return;
    }
    const l = letti[i];
    for (const c of codici) {
      const m = (stat.perCodice[c] ??= { letti: 0, bandi: 0, a: 0, b: 0, fuori_settore: 0 });
      m.letti++;
      if (l?.tipo === "bando") {
        m.bandi++;
        if (l.livello === "A") m.a++;
        else m.b++;
      } else if (l?.tipo === "esclusione" && l.motivo === "fuori_settore") m.fuori_settore++;
    }
  });
}

export type StatistichePvl = {
  pvl: { richieste: number; byte: number; ms: number; risposte: Record<string, number>; conteggioDichiarato: number | null };
  // sostituiti = avvisi che la PVL dichiara superati da un avviso nuovo (rettifiche, annullamenti), per tipo; non attivi = ritirati
  avvisi: {
    letti: number;
    perScheda: Record<string, number>;
    bandi: number;
    esiti: number;
    esclusi: Record<string, number>;
    sostituiti: Record<string, number>;
    nonAttivi: number;
    // C2 (49C, R2): per ogni codice dell'elenco di ricerca, gli avvisi letti e che cosa ne è nato; «non attribuiti» = avvisi che non si
    // riconducono a nessun codice (né dell'elenco né del file di classificazione), per esempio i 14 codici ancora senza descrizione
    perCodice: Record<string, MisuraCodicePvl>;
    nonAttribuiti: number;
    // R4 (decisione dell'utente del 23/11): coppie codice → descrizione scritte dalla PVL per i codici dell'elenco ancora senza
    // descrizione, e descrizioni sconosciute degli avvisi non attribuiti (con quante volte). Solo testo del CPV, al più 50 voci
    descrizioniDaCompletare: Record<string, string>;
    descrizioniSconosciute: Record<string, number>;
  };
  bandi: {
    invariati: number;
    // gare nuove nell'archivio: nazionali (senza avviso TED) e sopra soglia non ancora arrivate da TED
    nuoveNazionali: number;
    nuoveSopraSogliaSenzaTed: number;
    // la stessa gara era già nell'archivio da TED (riconosciuta col numero dell'avviso TED o col CIG)
    giaPresentiTed: number;
    // nuova versione di una gara già letta dalla PVL
    nuoveVersioni: number;
    aggiornate: number;
    rettifiche: number;
    annullate: number;
    // gare importate già scadute al momento dell'importazione (mai mostrate come aperte)
    scaduteAllImportazione: number;
    lotti: number;
    cigAssegnati: number;
    cigScartati: number;
    lottiNonAllineati: number;
    aggiunteCollegate: number;
    conflitti: number;
    mancanti: Record<string, number>;
    // gare doppie collegate in modo reversibile (0117) e avvisi applicati a una gara già collegata (copia nascosta, mai notifiche)
    collegateDoppie: number;
    suGaraCollegata: number;
  };
  esiti: { letti: number; applicati: number; senzaGara: number; invariati: number };
};

export function statistichePvlVuote(): StatistichePvl {
  return {
    pvl: { richieste: 0, byte: 0, ms: 0, risposte: {}, conteggioDichiarato: null },
    avvisi: { letti: 0, perScheda: {}, bandi: 0, esiti: 0, esclusi: {}, sostituiti: {}, nonAttivi: 0, perCodice: {}, nonAttribuiti: 0, descrizioniDaCompletare: {}, descrizioniSconosciute: {} },
    bandi: {
      invariati: 0,
      nuoveNazionali: 0,
      nuoveSopraSogliaSenzaTed: 0,
      giaPresentiTed: 0,
      nuoveVersioni: 0,
      aggiornate: 0,
      rettifiche: 0,
      annullate: 0,
      scaduteAllImportazione: 0,
      lotti: 0,
      cigAssegnati: 0,
      cigScartati: 0,
      lottiNonAllineati: 0,
      aggiunteCollegate: 0,
      conflitti: 0,
      mancanti: {},
      collegateDoppie: 0,
      suGaraCollegata: 0,
    },
    esiti: { letti: 0, applicati: 0, senzaGara: 0, invariati: 0 },
  };
}

export function aggiungi(m: Record<string, number>, k: string, n = 1): void {
  m[k] = (m[k] ?? 0) + n;
}
