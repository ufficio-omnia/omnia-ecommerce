import type { PianoSlug } from "@/lib/omnia-ai-plans";
import type { ModalitaStripe } from "@/lib/omnia-ai-vendita";

// Calcoli puri (nessuna rete) per il controllo della configurazione Stripe di OMNIA AI, mostrato nella
// pagina «Piani e prezzi» della console prima di accendere la vendita degli abbonamenti.

// Gli eventi che il webhook (/api/webhooks/stripe) gestisce per OMNIA AI.
export const EVENTI_ATTESI = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "subscription_schedule.created",
  "subscription_schedule.updated",
  "subscription_schedule.released",
  "invoice.payment_failed",
  "invoice.paid",
  "customer.updated",
] as const;

export type DestinazioneWebhook = { url: string; stato: string; eventi: string[] };

export type EsitoWebhook = {
  // eventi attesi che nessuna destinazione attiva riceve
  mancanti: string[];
  // eventi attesi ricevuti da PIÙ di una destinazione attiva: lo stesso evento verrebbe elaborato due volte
  doppi: { evento: string; url: string[] }[];
};

const attiva = (d: DestinazioneWebhook) => d.stato === "enabled";
const riceve = (d: DestinazioneWebhook, evento: string) => d.eventi.includes("*") || d.eventi.includes(evento);

export function analizzaWebhook(destinazioni: DestinazioneWebhook[]): EsitoWebhook {
  const attive = destinazioni.filter(attiva);
  const mancanti: string[] = [];
  const doppi: EsitoWebhook["doppi"] = [];
  for (const evento of EVENTI_ATTESI) {
    const ricevitori = attive.filter((d) => riceve(d, evento));
    if (ricevitori.length === 0) mancanti.push(evento);
    else if (ricevitori.length > 1) doppi.push({ evento, url: ricevitori.map((d) => d.url) });
  }
  return { mancanti, doppi };
}

export type StatoPrezzoPiano = "allineato" | "disallineato" | "assente" | "errore";

export type PianoDaControllare = { slug: PianoSlug; nome: string; listinoCentesimi: number; stato: StatoPrezzoPiano };

// I piani che non hanno nessun prezzo attivo su Stripe: sono gli unici che si possono creare da qui.
// Un prezzo «non allineato» non si tocca (si risolve risalvando il prezzo) e un errore di lettura non
// autorizza a creare niente.
export function pianiConPrezzoDaCreare(piani: PianoDaControllare[]): PianoDaControllare[] {
  return piani.filter((p) => p.stato === "assente");
}

export type StatoPortale = "configurato" | "mancante" | "non_verificabile";
export type StatoWebhook = (EsitoWebhook & { verificabile: true }) | { verificabile: false };

// Può la vendita essere accesa? Ritorna i motivi che lo impediscono (vuoto = sì).
// Un webhook non verificabile (chiave con permessi limitati) non blocca: lo si dice, e decide chi accende.
export function motiviCheImpedisconoLaVendita(i: { modalita: ModalitaStripe; piani: PianoDaControllare[]; webhook: StatoWebhook }): string[] {
  const motivi: string[] = [];
  if (i.modalita !== "reale") motivi.push("Stripe non è in modalità reale: la chiave di OMNIA AI su questo ambiente è di prova o non riconosciuta.");
  for (const p of i.piani) {
    if (p.stato === "assente") motivi.push(`Su Stripe manca il prezzo del piano ${p.nome}: crealo con «Crea i prezzi mancanti».`);
    else if (p.stato === "disallineato") motivi.push(`Il prezzo su Stripe del piano ${p.nome} è diverso dal listino: risalva il prezzo del piano.`);
    else if (p.stato === "errore") motivi.push(`Non riesco a leggere da Stripe il prezzo del piano ${p.nome}.`);
  }
  if (i.webhook.verificabile) {
    if (i.webhook.mancanti.length > 0) motivi.push(`Al webhook mancano questi eventi: ${i.webhook.mancanti.join(", ")}.`);
    if (i.webhook.doppi.length > 0) motivi.push(`Questi eventi arrivano a più di una destinazione e verrebbero elaborati due volte: ${i.webhook.doppi.map((d) => d.evento).join(", ")}.`);
  }
  return motivi;
}
