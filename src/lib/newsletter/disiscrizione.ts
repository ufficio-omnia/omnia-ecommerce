import { archivioNewsletter, type ArchivioNewsletter } from "./archivio";
import { avvisaDisiscrizione } from "./avviso-disiscrizione";
import type { Iscritto } from "./tipi";

// Disiscrizione e riattivazione dal link personale (token casuale di 48 caratteri esadecimali, uno per iscritto).
// Nessun accesso richiesto: il token è la prova che il link arriva dall'email. La disiscrizione è immediata e
// definitiva per tutti gli invii successivi (anche per un'edizione già in invio: ogni lotto ricontrolla lo stato).

export function mascheraEmail(email: string): string {
  const [nome, dominio] = email.split("@");
  if (!dominio) return "•••";
  return `${nome.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, nome.length - 2)))}@${dominio}`;
}

export async function disiscriviConToken(
  token: string,
  motivo: string,
  a: ArchivioNewsletter = archivioNewsletter(),
  avvisa: (i: Iscritto, motivo: string, quando: string) => Promise<unknown> = (i, m, q) => avvisaDisiscrizione(i, m, q, a),
): Promise<Iscritto | null> {
  const i = await a.iscrittoPerToken(token);
  if (!i) return null;
  if (i.stato === "iscritto") {
    const quando = new Date().toISOString();
    await a.aggiornaIscritto(i.id, { stato: "disiscritto", disiscritto_il: quando, motivo_uscita: motivo.slice(0, 200) });
    await a.annota(null, "disiscrizione", { iscritto: i.id, motivo: motivo.slice(0, 200) }, null);
    // avviso all'ufficio solo DOPO la disiscrizione registrata; un suo errore non la annulla
    await avvisa(i, motivo.slice(0, 200), quando).catch(() => undefined);
  }
  return { ...i, stato: i.stato === "iscritto" ? "disiscritto" : i.stato };
}

// Riattivazione chiesta dall'interessato stesso, dal suo link personale: è un nuovo consenso espresso, registrato
// come tale con data e modalità. Non vale per chi ha segnalato spam o per un indirizzo che rimbalza.
export async function riattivaConToken(token: string, a: ArchivioNewsletter = archivioNewsletter()): Promise<"ok" | "non_trovato" | "non_ammesso"> {
  const i = await a.iscrittoPerToken(token);
  if (!i) return "non_trovato";
  if (i.stato === "iscritto") return "ok";
  if (i.stato !== "disiscritto") return "non_ammesso";
  const ora = new Date();
  await a.aggiornaIscritto(i.id, {
    stato: "iscritto",
    disiscritto_il: null,
    motivo_uscita: null,
    base_giuridica: "consenso",
    prova_base: `Nuova iscrizione chiesta dall'interessato dal link personale della newsletter il ${ora.toISOString()} (pulsante «Iscrivimi di nuovo»).`,
    base_dal: ora.toISOString().slice(0, 10),
  });
  await a.annota(null, "riattivazione", { iscritto: i.id }, null);
  return "ok";
}
