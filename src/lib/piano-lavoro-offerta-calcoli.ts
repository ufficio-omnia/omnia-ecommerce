import { PIANI, PIANI_ORDINE, type PianoSlug } from "@/lib/omnia-ai-plans";

// Piano di lavoro nell'abbonamento: regole PURE (nessun database, nessuna rete), provate da
// scripts/verifica-piano-lavoro-abbonamento-omnia-ai.ts. Le usano il checkout dell'abbonamento, il cambio di piano, la pagina della gara,
// la console e il test.

// ───── il surplus mensile ─────

// Il supplemento mensile (IVA inclusa) per avere il piano di lavoro nell'abbonamento; la console può cambiarlo senza toccare il codice
// (console_impostazioni). Il prezzo dell'abbonamento con il piano di lavoro è il prezzo del piano + il supplemento.
export const SURPLUS_PIANO_LAVORO_PREDEFINITO: Record<PianoSlug, number> = {
  starter: 15000,
  professional: 35000,
  enterprise: 90000,
};

export const LIMITI_SURPLUS = { minimoCentesimi: 100, massimoCentesimi: 1_000_000 } as const;

export function chiaveSurplusPianoLavoro(piano: PianoSlug): string {
  return `piano_lavoro_surplus_${piano}_centesimi`;
}

// Il valore salvato: un intero in centesimi nei limiti; qualunque altra cosa = il valore del codice.
export function interpretaSurplus(valore: string | number | null | undefined, piano: PianoSlug): number {
  const testo = typeof valore === "number" ? String(valore) : (valore ?? "").trim();
  if (!/^\d{1,9}$/.test(testo)) return SURPLUS_PIANO_LAVORO_PREDEFINITO[piano];
  const n = Number(testo);
  return n >= LIMITI_SURPLUS.minimoCentesimi && n <= LIMITI_SURPLUS.massimoCentesimi ? n : SURPLUS_PIANO_LAVORO_PREDEFINITO[piano];
}

export function surplusDaImpostazioni(righe: { chiave: string; valore: string }[]): Record<PianoSlug, number> {
  const per = new Map(righe.map((r) => [r.chiave, r.valore]));
  return Object.fromEntries(PIANI_ORDINE.map((p) => [p, interpretaSurplus(per.get(chiaveSurplusPianoLavoro(p)), p)])) as Record<PianoSlug, number>;
}

export function prezzoConPianoLavoro(prezzoPianoCentesimi: number, surplusCentesimi: number): number {
  return prezzoPianoCentesimi + surplusCentesimi;
}

// Il prezzo Stripe attivo dell'offerta (piano + supplemento) deve essere quello che il cliente vede: se non lo è, il checkout si ferma.
export type StatoPrezzoOfferta = "allineato" | "mancante" | "da_allineare";

export function statoPrezzoOfferta(attesoCentesimi: number, importoStripe: number | null | undefined): StatoPrezzoOfferta {
  if (importoStripe === null || importoStripe === undefined) return "mancante";
  return importoStripe === attesoCentesimi ? "allineato" : "da_allineare";
}

// ───── gli utenti in prova ─────

// Che cosa fa il piano di lavoro per chi è in prova (ha gare gratuite dalla console, nessun abbonamento):
//   acquisto: lo compra come tutti, gara per gara (predefinito);  gratis: per le gare in prova è incluso;  bloccato: non è disponibile.
export type PoliticaProva = "acquisto" | "gratis" | "bloccato";
export const POLITICHE_PROVA: PoliticaProva[] = ["acquisto", "gratis", "bloccato"];
export const CHIAVE_POLITICA_PROVA = "piano_lavoro_prova_politica";

export function interpretaPoliticaProva(valore: string | null | undefined): PoliticaProva {
  const v = (valore ?? "").trim();
  return (POLITICHE_PROVA as string[]).includes(v) ? (v as PoliticaProva) : "acquisto";
}

export const ETICHETTA_POLITICA_PROVA: Record<PoliticaProva, string> = {
  acquisto: "Lo comprano come tutti (gara per gara)",
  gratis: "Incluso gratis per le loro gare",
  bloccato: "Non disponibile in prova",
};

// ───── l'offerta dell'abbonamento: piano + piano di lavoro ─────

export type OffertaAbbonamento = { piano: PianoSlug; pianoLavoro: boolean };

export function etichettaOfferta(o: OffertaAbbonamento): string {
  return `${PIANI[o.piano].nome}${o.pianoLavoro ? " con piano di lavoro" : ""}`;
}

// La destinazione di un cambio di piano, come arriva dal browser: «starter» (si mantiene l'opzione che ha già), «starter:lavoro»
// (con il piano di lavoro) o «starter:base» (senza). Qualunque altra cosa non vale.
export function interpretaDestinazione(raw: string, attuale: OffertaAbbonamento): OffertaAbbonamento | null {
  const [slug, opzione, ...resto] = String(raw ?? "").split(":");
  if (resto.length > 0 || !(PIANI_ORDINE as string[]).includes(slug)) return null;
  const piano = slug as PianoSlug;
  if (opzione === undefined) return { piano, pianoLavoro: attuale.pianoLavoro };
  if (opzione === "lavoro") return { piano, pianoLavoro: true };
  if (opzione === "base") return { piano, pianoLavoro: false };
  return null;
}

// Salire o scendere si decide dall'ORDINE dei piani e, a parità di piano, dal piano di lavoro: aggiungerlo è salire (si paga subito la
// differenza, per la parte di mese rimasta), toglierlo è scendere (vale dal prossimo rinnovo). Mai dal confronto dei prezzi, che la
// console può cambiare. null = è già l'offerta attuale.
export function tipoCambioOfferta(attuale: OffertaAbbonamento, destinazione: OffertaAbbonamento): "upgrade" | "downgrade" | null {
  const a = PIANI_ORDINE.indexOf(attuale.piano);
  const d = PIANI_ORDINE.indexOf(destinazione.piano);
  if (d > a) return "upgrade";
  if (d < a) return "downgrade";
  if (destinazione.pianoLavoro === attuale.pianoLavoro) return null;
  return destinazione.pianoLavoro ? "upgrade" : "downgrade";
}

// Il piano di lavoro dell'abbonamento è stato aggiunto o tolto? `prima` null = non si sa (colonna assente o riga non ancora registrata):
// nessuna segnalazione. Serve a segnalarlo all'ufficio anche a parità di piano (il cambio di piano da solo non lo direbbe).
export function rilevaCambioPianoLavoro(prima: boolean | null | undefined, nuovo: boolean): "aggiunto" | "tolto" | null {
  if (prima === null || prima === undefined) return null;
  if (prima === nuovo) return null;
  return nuovo ? "aggiunto" : "tolto";
}

// ───── le concessioni gratuite ─────

export type RigaConcessione = {
  id: string;
  tipo: "tutte" | "gara";
  gara_id: string | null;
  gare_massime: number | null;
  scade_il: string | null;
  attiva: boolean;
};

// Una concessione vale per questa gara se: è attiva, non è scaduta (l'ultimo giorno incluso), e — per «gara» — è proprio questa; per «tutte» —
// c'è ancora posto nel numero massimo di gare, oppure questa gara ne fa già parte (la sua seconda versione, con la proroga, non conta di nuovo).
// `gareUsate`: per ogni concessione le gare che hanno già un piano generato (o in corso) grazie a lei.
// Si preferisce quella per la singola gara, poi quelle per tutte; a parità, la più vecchia (stesso ordine delle righe).
export function scegliConcessione(righe: RigaConcessione[], garaId: string, oggi: string, gareUsate: Record<string, string[]>): { id: string } | null {
  const valide = righe.filter((c) => {
    if (!c.attiva) return false;
    if (c.scade_il && c.scade_il < oggi) return false;
    if (c.tipo === "gara") return c.gara_id === garaId;
    if (c.gare_massime === null) return true;
    const usate = gareUsate[c.id] ?? [];
    return usate.includes(garaId) || usate.length < c.gare_massime;
  });
  const scelta = valide.find((c) => c.tipo === "gara") ?? valide[0];
  return scelta ? { id: scelta.id } : null;
}

// Come una concessione si racconta alla console
export function descriviConcessione(c: { tipo: "tutte" | "gara"; gara_titolo: string | null; gare_massime: number | null; scade_il: string | null }): string {
  if (c.tipo === "gara") return `Solo la gara «${c.gara_titolo ?? "(gara cancellata)"}»`;
  const limite = c.gare_massime === null ? "tutte le gare" : `fino a ${c.gare_massime} ${c.gare_massime === 1 ? "gara" : "gare"}`;
  return `${limite[0].toUpperCase()}${limite.slice(1)}${c.scade_il ? `, fino al ${c.scade_il.split("-").reverse().join("/")}` : ", senza scadenza"}`;
}

// ───── le avvertenze accettate con l'abbonamento ─────
// Sono le stesse dell'acquisto singolo (piano-lavoro-acquisto-calcoli.ts): stesso testo, stessa versione e impronta. Il corrispettivo,
// per l'abbonamento, è il supplemento mensile mostrato nel modulo.

// ───── la concessione che la console sta creando ─────

export type NuovaConcessioneValori = {
  tipo: "tutte" | "gara";
  garaId: string | null;
  gareMassime: number | null;
  scadeIl: string | null;
  motivo: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// I campi del modulo, come arrivano: si controlla tutto qui (il server non si fida del browser). `oggi` è il giorno di Roma (AAAA-MM-GG).
export function validaNuovaConcessione(
  input: { tipo: string; garaId: string; gareMassime: string; scadeIl: string; motivo: string },
  oggi: string,
): { ok: true; valori: NuovaConcessioneValori } | { ok: false; errore: string } {
  const tipo = input.tipo.trim();
  if (tipo !== "tutte" && tipo !== "gara") return { ok: false, errore: "Scegli se la concessione vale per tutte le gare o per una sola." };

  const motivo = input.motivo.trim();
  if (motivo.length < 2) return { ok: false, errore: "Scrivi il motivo della concessione (resta nella storia)." };
  if (motivo.length > 300) return { ok: false, errore: "Il motivo è troppo lungo (massimo 300 caratteri)." };

  const scadenza = input.scadeIl.trim();
  let scadeIl: string | null = null;
  if (scadenza !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scadenza) || Number.isNaN(new Date(`${scadenza}T00:00:00Z`).getTime())) return { ok: false, errore: "La data di scadenza non è valida." };
    if (scadenza < oggi) return { ok: false, errore: "La data di scadenza è già passata." };
    scadeIl = scadenza;
  }

  if (tipo === "gara") {
    if (!UUID_RE.test(input.garaId.trim())) return { ok: false, errore: "Scegli la gara." };
    if (input.gareMassime.trim() !== "") return { ok: false, errore: "Il numero massimo di gare vale solo per «tutte le gare»." };
    return { ok: true, valori: { tipo, garaId: input.garaId.trim(), gareMassime: null, scadeIl, motivo } };
  }

  const massime = input.gareMassime.trim();
  let gareMassime: number | null = null;
  if (massime !== "") {
    if (!/^\d{1,4}$/.test(massime) || Number(massime) < 1 || Number(massime) > 1000) return { ok: false, errore: "Il numero massimo di gare dev'essere un intero da 1 a 1000 (lascia vuoto per nessun limite)." };
    gareMassime = Number(massime);
  }
  return { ok: true, valori: { tipo, garaId: null, gareMassime, scadeIl, motivo } };
}
