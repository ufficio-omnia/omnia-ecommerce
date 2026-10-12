// Formattazione di date e numeri, sempre in italiano e con il fuso di Roma:
// il server gira in UTC e una data mostrata senza fuso sbaglierebbe l'ora.

const FUSO = "Europe/Rome";

export function formattaDataOra(iso: string | Date): string {
  return new Date(iso).toLocaleString("it-IT", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Solo la data. Accetta un istante (ISO con ora, convertito al giorno di Roma)
// oppure un giorno già di calendario "AAAA-MM-GG", che non va spostato di fuso.
export function formattaData(valore: string | Date): string {
  if (typeof valore === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valore)) {
    const [anno, mese, giorno] = valore.split("-");
    return `${giorno}/${mese}/${anno}`;
  }
  return new Date(valore).toLocaleDateString("it-IT", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formattaEuro(importo: number): string {
  return importo.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

export function formattaUsd(importo: number, decimali = 2): string {
  return `$${importo.toLocaleString("it-IT", { minimumFractionDigits: decimali, maximumFractionDigits: decimali })}`;
}

// 0,42 → "42 %"
export function formattaPercentuale(frazione: number): string {
  return `${(frazione * 100).toLocaleString("it-IT", { maximumFractionDigits: 0 })} %`;
}

export function formattaIntero(n: number): string {
  return n.toLocaleString("it-IT", { maximumFractionDigits: 0 });
}

// Millisecondi da adesso a una data (negativi se è già passata). In una
// funzione a parte perché un componente non può chiamare Date.now() nel render.
export function msDa(adesso: Date): number {
  return adesso.getTime() - Date.now();
}

// "11 h 42 min" per una durata in millisecondi (mai negativa).
export function formattaDurata(ms: number): string {
  const minuti = Math.max(0, Math.floor(ms / 60_000));
  const ore = Math.floor(minuti / 60);
  return ore > 0 ? `${ore} h ${minuti % 60} min` : `${minuti} min`;
}
