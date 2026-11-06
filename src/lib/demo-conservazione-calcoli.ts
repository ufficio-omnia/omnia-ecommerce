// Conservazione dei dati delle richieste di demo (regole PURE; le applica il cron «omnia-ai-demo-purge»):
//   - richieste «pending» o «superseded» (nessuna prenotazione): 90 giorni dall'invio del modulo;
//   - richieste confermate o cancellate: 24 mesi;
//   - casi del calendario da verificare: 12 mesi se aperti, 6 mesi se risolti;
//   - un contatto (la persona) senza più nessuna richiesta si cancella.
// Prenotazioni e consensi seguono la richiesta (ON DELETE CASCADE). Lo stesso schema è scritto nel commento della migrazione 0098 e
// nella guida.

export const GIORNI_CONSERVAZIONE_PENDING = 90;
export const MESI_CONSERVAZIONE_LEAD = 24;
export const MESI_CONSERVAZIONE_CASI_APERTI = 12;
export const MESI_CONSERVAZIONE_CASI_RISOLTI = 6;

function menoMesi(adesso: Date, mesi: number): Date {
  const d = new Date(adesso.getTime());
  d.setUTCMonth(d.getUTCMonth() - mesi);
  return d;
}

export type LimitiConservazione = {
  pendingPrimaDi: string;
  leadPrimaDi: string;
  casiApertiPrimaDi: string;
  casiRisoltiPrimaDi: string;
};

// Le date di taglio: tutto ciò che è stato creato PRIMA va cancellato.
export function limitiConservazione(adesso: Date): LimitiConservazione {
  return {
    pendingPrimaDi: new Date(adesso.getTime() - GIORNI_CONSERVAZIONE_PENDING * 86_400_000).toISOString(),
    leadPrimaDi: menoMesi(adesso, MESI_CONSERVAZIONE_LEAD).toISOString(),
    casiApertiPrimaDi: menoMesi(adesso, MESI_CONSERVAZIONE_CASI_APERTI).toISOString(),
    casiRisoltiPrimaDi: menoMesi(adesso, MESI_CONSERVAZIONE_CASI_RISOLTI).toISOString(),
  };
}

// Tra i contatti candidati, quelli che non hanno più nessuna richiesta (e quindi si possono cancellare).
export function contattiOrfani(candidati: string[], contattiConRichieste: string[]): string[] {
  const conRichieste = new Set(contattiConRichieste);
  return candidati.filter((id) => !conRichieste.has(id));
}
