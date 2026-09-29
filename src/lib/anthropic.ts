import Anthropic from "@anthropic-ai/sdk";

export const MODELLO_PRINCIPALE = "claude-sonnet-5";
export const MODELLO_LEGGERO = "claude-haiku-4-5-20251001";

// Il modello leggero serve ESCLUSIVAMENTE a verificare che un meccanismo
// funzioni (una compressione viene invocata, un controllo scatta, un
// formato di risposta viene rispettato): costa una frazione del principale
// ma scrive peggio, quindi i suoi testi non dicono nulla sulla qualità e
// non vanno mai giudicati. Mai per le generazioni reali dei clienti, mai
// per la verifica di livello 2 prima di una pubblicazione.
//
// Si attiva solo se ENTRAMBE le variabili sono impostate: la prima dice
// "usa il leggero", la seconda dice "sono uno script di prova". Solo gli
// script in scripts/ impostano la seconda (in codice, non in un file
// .env): un .env dimenticato con la prima non basta. In produzione
// (NODE_ENV=production o Vercel) la richiesta viene rifiutata con un
// errore invece di essere ignorata in silenzio, così un'attivazione per
// errore si vede subito invece di degradare i documenti dei clienti.
export function modelloLeggeroAttivo(): boolean {
  if (process.env.OMNIA_AI_MODELLO_PROVA !== "leggero") return false;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new Error(
      "OMNIA_AI_MODELLO_PROVA=leggero è impostata in un ambiente di produzione: rifiutato. Il modello leggero è solo per le prove di meccanismo in locale.",
    );
  }
  return process.env.OMNIA_AI_SCRIPT_PROVE === "1";
}

// Modello da usare per una chiamata: il principale sempre, tranne nelle
// prove di meccanismo di cui sopra.
export function modelloAttivo(): string {
  return modelloLeggeroAttivo() ? MODELLO_LEGGERO : MODELLO_PRINCIPALE;
}

// Le chiamate di prova sono riconoscibili nel registro dei costi
// (ai_operazioni) senza cancellare né alterare nulla: l'operazione riceve un
// prefisso. Vale anche per le prove col modello principale lanciate dagli
// script (OMNIA_AI_SCRIPT_PROVE=1), così le spese di prova si distinguono
// da quelle dei clienti.
export function operazionePerRegistro(operazione: string): string {
  if (process.env.OMNIA_AI_SCRIPT_PROVE !== "1") return operazione;
  return modelloLeggeroAttivo() ? `prova-leggero:${operazione}` : `prova:${operazione}`;
}

// Configurazione del ragionamento compatibile col modello scelto: il
// ragionamento adattivo è quello del modello principale; il leggero non lo
// usa (le prove di meccanismo non ne hanno bisogno).
export function pensieroPerModello(model: string, principale: { type: "adaptive" } | { type: "disabled" }) {
  return model === MODELLO_LEGGERO ? ({ type: "disabled" } as const) : principale;
}

export function createAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}
