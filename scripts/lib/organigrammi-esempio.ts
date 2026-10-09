import type { DatiOrganigramma } from "../../src/lib/organigramma-dati";

// Organigrammi di esempio ANONIMIZZATI (nessun nome di committente, sede o
// persona reale), modellati su casi reali: un comune con più sedi e RSPP
// separato, un ospedale con area critica e livello di direzione compilato,
// molte zone, e tutti gli elementi insieme. Servono agli autotest e al
// disegno di prova (scripts/disegna-organigrammi-prova.ts).

export const esempioComune: DatiOrganigramma = {
  v: 2,
  committente: { denominazione: "Comune di Esempio", tipoInterfaccia: "RUP" },
  imprese: [{ denominazione: "IMPRESA ESEMPIO" }],
  figuraApicale: { denominazione: "Responsabile di Commessa" },
  staffGoverno: [
    { denominazione: "RSPP", tipo: "sicurezza" },
    { denominazione: "Ispettore Qualità", tipo: "qualita" },
  ],
  centraleOperativa: { denominazione: "Referente Reperibilità H24" },
  coordinamento: [
    {
      denominazione: "Referente Operativo di Sede",
      presidio: "Sedi comunali",
      numeroSedi: 10,
      sottolivelli: [
        { denominazione: "Caposquadra Sede Centrale", addetti: ["Addetti alle pulizie"] },
        { denominazione: "Caposquadra Sedi Periferiche", addetti: ["Addetti alle pulizie"] },
      ],
    },
  ],
  bandaConclusiva: { titolo: "Pool sostitutivo di riserva", descrizione: "Personale qualificato disponibile entro 24 ore * per assenze impreviste, ferie o malattie" },
};

export const esempioOspedale: DatiOrganigramma = {
  v: 2,
  committente: { denominazione: "Azienda Ospedaliera Esempio e Casa di Cura", tipoInterfaccia: "RUP/DEC" },
  imprese: [{ denominazione: "IMPRESA ESEMPIO" }],
  riquadriElenco: [
    { titolo: "Responsabili di funzione", posizione: "sinistra", voci: [{ funzione: "Direzione Generale" }, { funzione: "Responsabile Acquisti", nominativo: "Mario Bianchi" }, { funzione: "Responsabile Risorse Umane" }] },
    { titolo: "Uffici di gestione", posizione: "destra", voci: [{ funzione: "Ufficio Gare e Contratti" }, { funzione: "Amministrazione e Contabilità" }, { funzione: "Ufficio Qualità e Sicurezza" }] },
  ],
  figuraApicale: { denominazione: "Responsabile di Commessa / RSPP" },
  staffGoverno: [{ denominazione: "Referente Logistica e Approvvigionamenti", tipo: "supporto" }],
  coordinamento: [
    {
      denominazione: "Coordinatore Tecnico-Operativo Multisito",
      presidio: "Plessi ospedalieri",
      sedi: ["Plesso Centrale", "Plesso Nord", "Plesso Sud", "Presidio Costiero", "Presidio Collinare"],
      numeroSedi: 5,
      sottolivelli: [
        { denominazione: "Caposquadra Area Critica — Plesso Centrale", addetti: ["Operatore Blocco Operatorio", "Operatore Pronto Soccorso"] },
        { denominazione: "Caposquadra Presidi Territoriali", addetti: ["Operatore multisito"] },
      ],
    },
  ],
};

const zona = (n: number) => ({
  denominazione: `Coordinatore Zona ${n}`,
  presidio: `Zona ${n}`,
  numeroSedi: 3 + n,
  sottolivelli: [
    { denominazione: `Caposquadra ${n}A`, addetti: ["Addetti alle pulizie"] },
    { denominazione: `Caposquadra ${n}B`, dettaglio: "Aree comuni e uffici", addetti: ["Addetti"] },
  ],
});

export const esempioSetteZone: DatiOrganigramma = {
  ...esempioComune,
  coordinamento: [1, 2, 3, 4, 5, 6, 7].map(zona),
  bandaConclusiva: { titolo: "Squadra emergenze", descrizione: "Intervento in caso di eventi imprevisti" },
};

export const esempioCompleto: DatiOrganigramma = {
  ...esempioOspedale,
  imprese: [{ denominazione: "ALFA SERVIZI SRL", ruolo: "mandataria" }, { denominazione: "BETA PULIZIE SRL", ruolo: "mandante" }],
  vice: { denominazione: "Vice Responsabile", nominativo: "Giulia Verdi" },
  staffGoverno: [
    { denominazione: "Preposto Sicurezza", tipo: "sicurezza" },
    { denominazione: "Ispettore Qualità", tipo: "qualita" },
    { denominazione: "Coordinatore CAM", tipo: "cam" },
    { denominazione: "Diversity Manager", tipo: "diversity" },
  ],
  referenteCommittente: { denominazione: "Referente di sede" },
  strumentiEsterni: [{ denominazione: "Piattaforma gestionale", tipo: "piattaforma" }],
  centraleOperativa: { denominazione: "Centrale Operativa di Commessa", descrizione: "Smistamento segnalazioni e interventi" },
  coordinamento: [1, 2, 3, 4].map(zona),
  risorseTrasversali: { titolo: "Risorse trasversali", voci: [{ denominazione: "Squadra volante" }, { denominazione: "Squadra specialistica" }, { denominazione: "Squadra eventi" }] },
  bandaConclusiva: { titolo: "Pool jolly sostitutivo", descrizione: "Riserva addestrata per assenze impreviste" },
};

export const esempioMinimo: DatiOrganigramma = {
  v: 2,
  imprese: [{ denominazione: "IMPRESA ESEMPIO" }],
  figuraApicale: { denominazione: "Responsabile del Servizio" },
  coordinamento: [{ denominazione: "Coordinatore Operativo", sottolivelli: [{ denominazione: "Caposquadra", addetti: ["Operatori"] }] }],
};

export const tuttiGliEsempi: Record<string, DatiOrganigramma> = {
  comune: esempioComune,
  ospedale: esempioOspedale,
  setteZone: esempioSetteZone,
  completo: esempioCompleto,
  minimo: esempioMinimo,
};
