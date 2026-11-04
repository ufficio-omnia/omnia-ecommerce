// Conservazione dei dati delle richieste di demo (regole PURE; le applica il cron «omnia-ai-demo-purge»):
//   - lead «pending» (non hanno mai prenotato): 90 giorni dall'invio del modulo;
//   - lead confermati o cancellati: 24 mesi;
//   - casi del calendario da verificare: 12 mesi se aperti, 6 mesi se risolti.
// Lo stesso schema è scritto nel commento della migrazione 0098 e nella guida.

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
