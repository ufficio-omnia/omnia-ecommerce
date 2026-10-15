// Chi non ha più gare a disposizione (quelle del piano, i crediti, le gare gratuite) non può
// lavorare su una gara nuova: né caricare documenti (e farli indicizzare), né usare la chat con
// OMNIA AI. Qui i calcoli puri e i testi; la lettura dal database sta in gara-diritto.ts.
// Le regole rispecchiano quelle del consumo vero (gara-consumo.ts: prima le gare incluse nel
// piano, poi i crediti, poi le gare gratuite): chi chiama non deve mai bloccare chi un'analisi
// potrebbe ancora avviarla.

export type FontiQuota = {
  // abbonamento attivo e non scaduto: gare incluse nel periodo e già consumate in quel periodo
  piano: { gareIncluse: number; consumate: number } | null;
  crediti: number;
  // solo per chi non ha mai avuto un abbonamento e ha un contatore dalla console
  gratuite: { rimanenti: number } | null;
};

export type FonteQuota = "piano" | "credito" | "gratuita";

export function fonteQuotaDisponibile(f: FontiQuota): FonteQuota | null {
  if (f.piano && f.piano.gareIncluse > 0 && f.piano.consumate < f.piano.gareIncluse) return "piano";
  if (f.crediti > 0) return "credito";
  if (f.gratuite && f.gratuite.rimanenti > 0) return "gratuita";
  return null;
}

export type DirittoGara =
  | { consentito: true; motivo: "gia_consumata" | "gia_analizzata" | "quota_disponibile" }
  | { consentito: false; motivo: "quota_esaurita" | "gratuite_esaurite" | "verifica_non_riuscita"; messaggio: string };

export const MESSAGGIO_GARA_BLOCCATA_QUOTA =
  "Hai esaurito le gare incluse nel tuo piano e i crediti aggiuntivi: la chat con OMNIA AI e il caricamento dei documenti di questa gara sono disattivati. Acquista crediti o attendi il rinnovo del piano per riattivarli. Le gare già avviate restano consultabili.";

export const MESSAGGIO_GARA_BLOCCATA_GRATUITE =
  "Hai usato tutte le gare gratuite: la chat con OMNIA AI e il caricamento dei documenti di questa gara sono disattivati. Scegli un abbonamento dalla pagina «Abbonamento» per riattivarli. Le gare già avviate restano consultabili.";

export const MESSAGGIO_VERIFICA_GARE_NON_RIUSCITA =
  "Non riesco a verificare le gare ancora a tua disposizione in questo momento. Riprova tra qualche istante.";

export function dirittoDaFonti(f: FontiQuota): DirittoGara {
  if (fonteQuotaDisponibile(f)) return { consentito: true, motivo: "quota_disponibile" };
  // con un contatore di gare gratuite (e nessun abbonamento mai avuto) l'invito è a scegliere un abbonamento
  if (f.gratuite) return { consentito: false, motivo: "gratuite_esaurite", messaggio: MESSAGGIO_GARA_BLOCCATA_GRATUITE };
  return { consentito: false, motivo: "quota_esaurita", messaggio: MESSAGGIO_GARA_BLOCCATA_QUOTA };
}

// Quante gare restano da avviare in tutto: quelle del piano non ancora usate, i crediti e le gare gratuite.
// Serve a mostrare all'Ufficio Gare un solo numero («gare a disposizione») senza i dettagli amministrativi.
export function gareRimanenti(f: FontiQuota): number {
  const delPiano = f.piano ? Math.max(0, f.piano.gareIncluse - f.piano.consumate) : 0;
  return delPiano + Math.max(0, f.crediti) + (f.gratuite ? Math.max(0, f.gratuite.rimanenti) : 0);
}
