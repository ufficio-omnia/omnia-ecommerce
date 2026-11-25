// Testi della console Tender Intelligence (riordino del 25/11/2026, proposta B1 43, via dell'utente): una frase per ogni parametro e per
// ogni azione sulle fonti, che cosa fa e che cosa comporta cambiarlo. Solo testi: nessuna regola. La prova
// scripts/verifica-monitorate-fonti-nascoste.ts (sezione CR) controlla che le frasi «oggi non ha effetto» restino vere: i limiti non in uso
// non sono letti dal codice e i costi in crediti non sono scalati da nessuna azione.
import type { NomeLimite } from "@/lib/radar/diritto-calcoli";
import type { LimitiPvl } from "@/lib/radar/fonti/pvl-calcoli";

export const FRASE_INTERRUTTORE_GENERALE =
  "Acceso: le imprese abilitate vedono «Opportunità» nel loro menu. Spento: nessun cliente la vede, anche se abilitato. L'effetto è immediato: la console svuota subito la memoria del menu.";

export const FRASE_IMPRESE =
  "Abilita: l'impresa vede «Opportunità» solo se anche l'interruttore generale è acceso. Si abilita il titolare: il suo Ufficio Gare segue il titolare. Disabilita: l'impresa non la vede più, subito. Ogni cambio va nel registro.";

/** I limiti tecnici che il codice applica oggi (in «Cerca» e «Per te»). */
export const LIMITI_IN_USO: readonly NomeLimite[] = ["ricerche_minuto"];
/** I limiti delle funzioni non ancora attive: stanno in «Avanzate», con la scritta che oggi non hanno effetto. */
export const LIMITI_NON_IN_USO: readonly NomeLimite[] = ["progetti_senza_analisi", "sintesi_giorno", "analisi_requisiti_giorno"];

export const FRASE_NON_IN_USO = "Oggi non ha effetto: la funzione non è ancora attiva. Si applicherà quando lo sarà.";

export const FRASE_LIMITE: Record<NomeLimite, string> = {
  ricerche_minuto:
    "Quante ricerche al minuto può fare un'impresa in «Cerca» e «Per te». Oltre il limite vede un invito ad aspettare. Abbassarlo protegge il database; alzarlo serve solo a chi lavora molto in fretta.",
  progetti_senza_analisi: FRASE_NON_IN_USO,
  sintesi_giorno: FRASE_NON_IN_USO,
  analisi_requisiti_giorno: FRASE_NON_IN_USO,
};

export const FRASE_COSTI =
  "Crediti da scalare per ogni azione. Oggi il codice non li scala per nessuna azione: i valori sono preparati per il futuro e cambiarli non ha effetto. Il contatore delle gare del piano è separato e non cambia.";

export const FRASE_LIMITE_PVL: Record<keyof LimitiPvl, string> = {
  avvisiPerPagina: "Quanti avvisi chiede ogni richiesta alla PVL. Meno avvisi per pagina vuol dire più richieste per leggere lo stesso periodo.",
  pausaMs: "Quanto aspetta il giro tra una richiesta e la successiva. Più alta: giro più lento e meno carico sui sistemi di ANAC.",
  timeoutMs: "Oltre questo tempo la richiesta si considera non riuscita.",
  tentativi: "Quante volte si riprova dopo un errore temporaneo. I blocchi (401, 403, 429) sospendono comunque la fonte, senza tentativi in più.",
  richiesteMassime:
    "Tetto di richieste alla PVL in un giro: raggiunto il tetto il giro si ferma e il resto riprende al giro successivo. Alzarlo accelera il recupero ma aumenta il carico sulla fonte.",
};

export const FRASE_ACCENDI = "Avvia i giri programmati di questa fonte (acquisizioni vere). Serve la conferma; il primo giro parte all'orario successivo.";
export const FRASE_SPEGNI_A_META = "Nessun giro nuovo; un giro in corso si ferma alla pagina successiva.";
export const FRASE_ESEGUI_GIRO = "Un giro subito, al massimo 50 secondi, fuori dagli orari programmati. Usarlo solo per una verifica: conta come un giro vero verso la fonte.";
export const FRASE_VISIBILITA = "Nascosta: le gare che hanno solo questa fonte non compaiono ai clienti. Vale subito.";
export const FRASE_ACCENSIONE_NON_CONSENTITA = "In questo ambiente l'accensione non è consentita (permesso dell'ambiente): il server la rifiuterebbe.";
