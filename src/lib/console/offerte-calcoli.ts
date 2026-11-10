import { offertaAcquistabile, type RigaOfferta, type ServizioPacchetto } from "@/lib/pacchetti-servizi-calcoli";

// Offerte dedicate (migrazione 0105) come le racconta la console: regole PURE (nessun database), provate da scripts/verifica-console-pacchetti.ts.
// Lo stato del database è «attiva», «acquistata» o «revocata»: la console aggiunge «scaduta» per un'offerta attiva la cui data è passata (l'ultimo giorno
// incluso), così non sembra comprabile quando non lo è più.

export type StatoOffertaConsole = "attiva" | "scaduta" | "acquistata" | "revocata";

export const ETICHETTA_STATO_OFFERTA: Record<StatoOffertaConsole, string> = {
  attiva: "attiva",
  scaduta: "scaduta",
  acquistata: "acquistata",
  revocata: "revocata",
};

export type OffertaDedicataConsole = {
  id: string;
  userId: string;
  // l'email del cliente (null = cliente non trovato)
  cliente: string | null;
  servizio: ServizioPacchetto;
  quantita: number;
  prezzoCentesimi: number;
  scadeIl: string | null;
  // nota interna: mai mostrata al cliente
  nota: string | null;
  stato: StatoOffertaConsole;
  creataIl: string;
  creataDa: string;
  chiusaIl: string | null;
  chiusaDa: string | null;
};

// `oggi`: il giorno di Roma (AAAA-MM-GG).
export function statoOffertaConsole(r: Pick<RigaOfferta, "stato" | "scade_il">, oggi: string): StatoOffertaConsole {
  if (r.stato === "attiva") return offertaAcquistabile(r, oggi) ? "attiva" : "scaduta";
  return r.stato;
}

export function daRigaConsole(r: RigaOfferta & { cliente_email: string | null }, oggi: string): OffertaDedicataConsole {
  return {
    id: r.id,
    userId: r.user_id,
    cliente: r.cliente_email,
    servizio: r.servizio,
    quantita: r.quantita,
    prezzoCentesimi: r.prezzo_centesimi,
    scadeIl: r.scade_il,
    nota: r.nota,
    stato: statoOffertaConsole(r, oggi),
    creataIl: r.creata_il,
    creataDa: r.creata_da_email,
    chiusaIl: r.chiusa_il,
    chiusaDa: r.chiusa_da_email,
  };
}

// Si può ancora revocare? Solo se è attiva (anche se è scaduta di data resta «attiva» nel database: revocarla la chiude con il nome di chi l'ha fatto).
export function revocabile(stato: StatoOffertaConsole): boolean {
  return stato === "attiva" || stato === "scaduta";
}
