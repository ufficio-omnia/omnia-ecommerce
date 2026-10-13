// Date e ore in italiano, sempre con il fuso di Roma: il server gira in UTC e una data
// mostrata senza fuso sbaglierebbe l'ora (e, vicino a mezzanotte, anche il giorno).

const FUSO = "Europe/Rome";

// «14 ottobre 2026»
export function dataRoma(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("it-IT", { timeZone: FUSO, day: "numeric", month: "long", year: "numeric" });
}

// «14 ottobre 2026 alle 10:32:15» — al secondo, come richiede una prova di accettazione.
export function dataOraRoma(iso: string | Date): string {
  const d = new Date(iso);
  const ora = d.toLocaleTimeString("it-IT", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${dataRoma(d)} alle ${ora}`;
}
