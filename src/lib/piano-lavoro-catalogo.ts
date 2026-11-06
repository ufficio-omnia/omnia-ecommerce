// Piano di lavoro: catalogo di riferimento di macchinari e attrezzature, con prezzi STANDARD di mercato (€, IVA esclusa), la vita utile
// e la regola con cui il codice ne stabilisce la quantità. I prezzi sono ipotesi da sostituire con quelli dei fornitori del cliente
// (l'Excel lo dice in evidenza). Dove la voce è una macchina IPC o FIMAP il prezzo viene da listini/rivenditori pubblici consultati
// alla data indicata; per il resto (attrezzatura manuale, accessori, dotazioni specialistiche) dai prezzi usati nei piani di lavoro di
// riferimento (Milanosport, Teatro alla Scala, Castello Donnafugata, Ferrovie del Sud-Est).
//
// Il catalogo è un file di codice, non una tabella del database: sono poche decine di voci, validate dall'utente, che cambiano di rado.
// Ogni voce riporta la FONTE del prezzo e la data, così chi le valida (o le aggiorna) sa da dove vengono.

export type CategoriaCatalogo = "Macchinari" | "Attrezzature";

// Quantità = il più grande tra i valori calcolati sulle basi indicate, arrotondato per eccesso e riportato tra min e max.
export type BaseQuantita = { su: "fte" | "sedi" | "mq" | "mqEsterni"; fattore?: number; ogni?: number };
export type RegolaQuantita = { basi: BaseQuantita[]; min: number; max: number };

export type VoceCatalogo = {
  chiave: string;
  nome: string;
  categoria: CategoriaCatalogo;
  // a cosa serve: lo legge il modello quando decide quali voci servono alla gara
  uso: string;
  // «sempre»: serve in ogni gara di pulizia; «se_serve»: solo quando i documenti la richiedono o la gara la rende necessaria
  quando: "sempre" | "se_serve";
  // modello di riferimento (marca e modello) e dove si è visto il prezzo
  riferimento: string;
  prezzo: number;
  prezzoMin: number;
  prezzoMax: number;
  vitaUtileMesi: number;
  fonte: string;
  rilevatoIl: string;
  regola: RegolaQuantita;
};

export const DATA_RILEVAZIONE = "2026-11-03";
export const FONTE_PIANI = "Prezzo standard di riferimento OMNIA AI";

type Dati = Omit<VoceCatalogo, "fonte" | "rilevatoIl" | "riferimento"> & Partial<Pick<VoceCatalogo, "fonte" | "rilevatoIl" | "riferimento">>;
const voce = (d: Dati): VoceCatalogo => ({ riferimento: "", fonte: FONTE_PIANI, rilevatoIl: DATA_RILEVAZIONE, ...d });

// Voci di base: prezzi di prassi dei piani di riferimento. Per le macchine IPC e FIMAP sotto si sovrappongono i prezzi dei rivenditori.
const CATALOGO_BASE: VoceCatalogo[] = [
  // ───── macchinari ─────
  voce({
    chiave: "monospazzola",
    nome: "Monospazzola professionale (lavaggio e lucidatura pavimenti)",
    categoria: "Macchinari",
    uso: "Lavaggio a fondo e lucidatura dei pavimenti duri, deceratura e inceratura",
    quando: "sempre",
    prezzo: 1000,
    prezzoMin: 860,
    prezzoMax: 1800,
    vitaUtileMesi: 60,
    regola: { basi: [{ su: "fte", fattore: 0.12 }, { su: "sedi", fattore: 0.2 }], min: 1, max: 12 },
  }),
  voce({
    chiave: "lavasciuga_spinta",
    nome: "Lavasciuga pavimenti a spinta (uomo a terra)",
    categoria: "Macchinari",
    uso: "Lavaggio meccanico e asciugatura dei pavimenti di locali di medie dimensioni",
    quando: "sempre",
    prezzo: 3000,
    prezzoMin: 1800,
    prezzoMax: 3200,
    vitaUtileMesi: 72,
    regola: { basi: [{ su: "mq", ogni: 30000 }], min: 1, max: 10 },
  }),
  voce({
    chiave: "lavasciuga_bordo",
    nome: "Lavasciuga pavimenti uomo a bordo (grandi superfici)",
    categoria: "Macchinari",
    uso: "Lavaggio meccanico di grandi superfici interne (magazzini, laboratori, palazzetti, hall)",
    quando: "se_serve",
    prezzo: 9000,
    prezzoMin: 4500,
    prezzoMax: 12000,
    vitaUtileMesi: 84,
    regola: { basi: [{ su: "mq", ogni: 60000 }], min: 1, max: 4 },
  }),
  voce({
    chiave: "spazzatrice_semovente",
    nome: "Spazzatrice semovente uomo a bordo (piazzali e aree esterne)",
    categoria: "Macchinari",
    uso: "Spazzamento meccanico di piazzali, parcheggi, marciapiedi e grandi aree esterne",
    quando: "se_serve",
    prezzo: 12500,
    prezzoMin: 9000,
    prezzoMax: 18000,
    vitaUtileMesi: 96,
    regola: { basi: [{ su: "mqEsterni", ogni: 100000 }], min: 1, max: 4 },
  }),
  voce({
    chiave: "spazzatrice_spinta",
    nome: "Spazzatrice a spinta (walk-behind)",
    categoria: "Macchinari",
    uso: "Spazzamento meccanico di aree esterne di media estensione, banchine, cortili",
    quando: "se_serve",
    prezzo: 3200,
    prezzoMin: 2000,
    prezzoMax: 5000,
    vitaUtileMesi: 72,
    regola: { basi: [{ su: "mqEsterni", ogni: 80000 }], min: 1, max: 3 },
  }),
  voce({
    chiave: "aspiratore_professionale",
    nome: "Aspirapolvere / aspiraliquidi professionale",
    categoria: "Macchinari",
    uso: "Aspirazione di polvere e liquidi, zerbini, tappeti, ambienti confinati",
    quando: "sempre",
    prezzo: 600,
    prezzoMin: 320,
    prezzoMax: 650,
    vitaUtileMesi: 48,
    regola: { basi: [{ su: "fte", fattore: 0.25 }, { su: "sedi", fattore: 0.5 }], min: 1, max: 20 },
  }),
  voce({
    chiave: "aspiratore_zaino",
    nome: "Aspirapolvere a zaino silenziato",
    categoria: "Macchinari",
    uso: "Aspirazione silenziosa durante il giorno in presenza di pubblico o durante le prove",
    quando: "se_serve",
    prezzo: 480,
    prezzoMin: 400,
    prezzoMax: 650,
    vitaUtileMesi: 48,
    regola: { basi: [{ su: "fte", fattore: 0.2 }], min: 1, max: 15 },
  }),
  voce({
    chiave: "battitappeto",
    nome: "Battitappeto professionale",
    categoria: "Macchinari",
    uso: "Pulizia di tappeti, zerbini e moquette",
    quando: "se_serve",
    prezzo: 1200,
    prezzoMin: 900,
    prezzoMax: 1600,
    vitaUtileMesi: 48,
    regola: { basi: [{ su: "sedi", ogni: 20 }], min: 1, max: 3 },
  }),
  voce({
    chiave: "lavamoquette",
    nome: "Lavamoquette a iniezione-estrazione",
    categoria: "Macchinari",
    uso: "Lavaggio e igienizzazione di moquette e tappezzerie",
    quando: "se_serve",
    prezzo: 2000,
    prezzoMin: 1150,
    prezzoMax: 2900,
    vitaUtileMesi: 60,
    regola: { basi: [{ su: "sedi", ogni: 15 }], min: 1, max: 3 },
  }),
  voce({
    chiave: "idropulitrice",
    nome: "Idropulitrice professionale",
    categoria: "Macchinari",
    uso: "Lavaggio a pressione di aree esterne, griglie, aree tecniche",
    quando: "sempre",
    prezzo: 940,
    prezzoMin: 600,
    prezzoMax: 1100,
    vitaUtileMesi: 60,
    regola: { basi: [{ su: "sedi", fattore: 0.1 }, { su: "mqEsterni", ogni: 50000 }], min: 1, max: 10 },
  }),
  voce({
    chiave: "vaporizzatore",
    nome: "Vaporizzatore professionale (vapore secco)",
    categoria: "Macchinari",
    uso: "Sanificazione a vapore di servizi igienici, spogliatoi e superfici",
    quando: "se_serve",
    prezzo: 300,
    prezzoMin: 280,
    prezzoMax: 400,
    vitaUtileMesi: 48,
    regola: { basi: [{ su: "sedi", fattore: 0.5 }], min: 1, max: 15 },
  }),
  voce({
    chiave: "lucidatrice_alta_velocita",
    nome: "Lucidatrice ad alta velocità",
    categoria: "Macchinari",
    uso: "Lucidatura di pavimenti trattati (marmo, pietra, pavimenti ceratati)",
    quando: "se_serve",
    prezzo: 1800,
    prezzoMin: 1200,
    prezzoMax: 2500,
    vitaUtileMesi: 60,
    regola: { basi: [{ su: "sedi", ogni: 10 }], min: 1, max: 3 },
  }),
  voce({
    chiave: "soffiatore",
    nome: "Soffiatore elettrico o a batteria",
    categoria: "Macchinari",
    uso: "Scopatura meccanica di foglie e detriti nelle aree esterne",
    quando: "se_serve",
    prezzo: 150,
    prezzoMin: 100,
    prezzoMax: 300,
    vitaUtileMesi: 48,
    regola: { basi: [{ su: "mqEsterni", ogni: 8000 }], min: 1, max: 15 },
  }),
  voce({
    chiave: "decespugliatore",
    nome: "Decespugliatore / tosaerba",
    categoria: "Macchinari",
    uso: "Sfalcio di erbe e arbusti nelle aree verdi",
    quando: "se_serve",
    prezzo: 900,
    prezzoMin: 500,
    prezzoMax: 1200,
    vitaUtileMesi: 60,
    regola: { basi: [{ su: "sedi", ogni: 5 }], min: 1, max: 3 },
  }),
  voce({
    chiave: "piattaforma_trabattello",
    nome: "Trabattello o piattaforma leggera per lavori in quota",
    categoria: "Macchinari",
    uso: "Pulizia di vetrate, soffitti, volte, corpi illuminanti non raggiungibili da terra",
    quando: "se_serve",
    prezzo: 1500,
    prezzoMin: 700,
    prezzoMax: 3500,
    vitaUtileMesi: 72,
    regola: { basi: [{ su: "sedi", ogni: 10 }], min: 1, max: 3 },
  }),
  voce({
    chiave: "atomizzatore_ulv",
    nome: "Atomizzatore / nebulizzatore ULV per sanificazione",
    categoria: "Macchinari",
    uso: "Sanificazione degli ambienti per nebulizzazione",
    quando: "se_serve",
    prezzo: 1100,
    prezzoMin: 600,
    prezzoMax: 2500,
    vitaUtileMesi: 60,
    regola: { basi: [{ su: "sedi", ogni: 3 }], min: 1, max: 4 },
  }),
  voce({
    chiave: "luminometro_atp",
    nome: "Luminometro ATP per il controllo della sanificazione",
    categoria: "Macchinari",
    uso: "Verifica oggettiva dell'efficacia della sanificazione sui punti critici",
    quando: "se_serve",
    prezzo: 1850,
    prezzoMin: 1200,
    prezzoMax: 2500,
    vitaUtileMesi: 60,
    regola: { basi: [], min: 2, max: 2 },
  }),
  // ───── attrezzature ─────
  voce({
    chiave: "carrello_multiuso",
    nome: "Carrello multiuso attrezzato (secchi, strizzatore, porta sacco)",
    categoria: "Attrezzature",
    uso: "Dotazione individuale delle squadre operative",
    quando: "sempre",
    prezzo: 320,
    prezzoMin: 280,
    prezzoMax: 380,
    vitaUtileMesi: 36,
    regola: { basi: [{ su: "fte", fattore: 0.9 }], min: 1, max: 80 },
  }),
  voce({
    chiave: "kit_attrezzi_manuali",
    nome: "Kit attrezzi manuali (scopettoni, piumini, panni, guanti)",
    categoria: "Attrezzature",
    uso: "Attrezzatura manuale per sede",
    quando: "sempre",
    prezzo: 80,
    prezzoMin: 70,
    prezzoMax: 85,
    vitaUtileMesi: 24,
    regola: { basi: [{ su: "sedi", fattore: 1 }, { su: "fte", fattore: 0.65 }], min: 1, max: 60 },
  }),
  voce({
    chiave: "secchio_strizzatore",
    nome: "Secchi doppi con strizzatore",
    categoria: "Attrezzature",
    uso: "Lavaggio manuale dei pavimenti",
    quando: "sempre",
    prezzo: 38,
    prezzoMin: 38,
    prezzoMax: 40,
    vitaUtileMesi: 24,
    regola: { basi: [{ su: "fte", fattore: 0.9 }], min: 1, max: 80 },
  }),
  voce({
    chiave: "spruzzatori_spingiacqua",
    nome: "Spruzzatori e spingi acqua professionali",
    categoria: "Attrezzature",
    uso: "Lavaggio e asciugatura di superfici e vetri",
    quando: "sempre",
    prezzo: 40,
    prezzoMin: 35,
    prezzoMax: 45,
    vitaUtileMesi: 24,
    regola: { basi: [{ su: "fte", fattore: 0.45 }], min: 1, max: 40 },
  }),
  voce({
    chiave: "canne_lavaggio",
    nome: "Canne per lavaggio con attacchi rapidi",
    categoria: "Attrezzature",
    uso: "Lavaggio di aree e servizi con acqua corrente",
    quando: "sempre",
    prezzo: 50,
    prezzoMin: 40,
    prezzoMax: 60,
    vitaUtileMesi: 36,
    regola: { basi: [{ su: "sedi", fattore: 1 }], min: 1, max: 40 },
  }),
  voce({
    chiave: "scale_alluminio",
    nome: "Scale in alluminio (varie altezze)",
    categoria: "Attrezzature",
    uso: "Pulizia di parti in altezza raggiungibili con scala",
    quando: "sempre",
    prezzo: 65,
    prezzoMin: 65,
    prezzoMax: 350,
    vitaUtileMesi: 96,
    regola: { basi: [{ su: "sedi", fattore: 0.5 }], min: 2, max: 20 },
  }),
  voce({
    chiave: "aste_telescopiche_vetri",
    nome: "Aste telescopiche e attrezzatura per vetri non raggiungibili",
    categoria: "Attrezzature",
    uso: "Pulizia di vetrate esterne e infissi in altezza",
    quando: "se_serve",
    prezzo: 290,
    prezzoMin: 250,
    prezzoMax: 350,
    vitaUtileMesi: 36,
    regola: { basi: [{ su: "sedi", fattore: 0.1 }], min: 1, max: 8 },
  }),
  voce({
    chiave: "dotazione_accessoria",
    nome: "Dotazione accessoria mobile (porta materiali, segnaletica bagnato)",
    categoria: "Attrezzature",
    uso: "Dotazione complementare al servizio",
    quando: "sempre",
    prezzo: 65,
    prezzoMin: 50,
    prezzoMax: 80,
    vitaUtileMesi: 36,
    regola: { basi: [{ su: "sedi", fattore: 0.7 }], min: 1, max: 30 },
  }),
  voce({
    chiave: "dosatori_parete",
    nome: "Dosatori a parete con cartucce concentrate ricaricabili",
    categoria: "Attrezzature",
    uso: "Erogazione di prodotti chimici diluiti a norma CAM",
    quando: "se_serve",
    prezzo: 65,
    prezzoMin: 50,
    prezzoMax: 90,
    vitaUtileMesi: 60,
    regola: { basi: [{ su: "sedi", fattore: 0.7 }], min: 2, max: 30 },
  }),
  voce({
    chiave: "armadietti_stoccaggio",
    nome: "Armadietti dedicati allo stoccaggio di prodotti e attrezzature",
    categoria: "Attrezzature",
    uso: "Separazione e custodia di prodotti e attrezzature in ogni sito",
    quando: "se_serve",
    prezzo: 320,
    prezzoMin: 250,
    prezzoMax: 450,
    vitaUtileMesi: 120,
    regola: { basi: [{ su: "sedi", fattore: 1 }], min: 1, max: 20 },
  }),
  voce({
    chiave: "tablet_reportistica",
    nome: "Dispositivi/tablet per reportistica digitale e controllo qualità",
    categoria: "Attrezzature",
    uso: "Tracciabilità delle attività e controllo qualità digitale",
    quando: "se_serve",
    prezzo: 350,
    prezzoMin: 250,
    prezzoMax: 500,
    vitaUtileMesi: 36,
    regola: { basi: [{ su: "fte", fattore: 0.3 }], min: 2, max: 30 },
  }),
];

// ───── prezzi di mercato delle macchine IPC e FIMAP ─────
//
// Raccolti il 2026-11-03 dalle pagine prodotto di rivenditori italiani (prezzi IVA ESCLUSA; dove il sito li dava IVA inclusa, divisi per
// 1,22), in modo verificabile: ogni prezzo ha l'indirizzo della pagina. Lo stesso modello costa da negozio a negozio anche il 50-100% in
// più o in meno (Clean Village e Puliveneta i più bassi, AFI Cleaning di listino, Ingrosso-Pulizie i più alti): il prezzo standard è un
// valore centrale, il minimo il più basso visto per la famiglia di modelli, il massimo il listino più alto. Quattro prezzi (FIMAP Genie B,
// FM43, FV80; IPC CT 15, 712 Rider, BRIX Hotel Mini) sono stati riaperti e ricontrollati a mano.
const MERCATO_IPC_FIMAP: Record<string, Partial<VoceCatalogo>> = {
  monospazzola: {
    riferimento: "FIMAP FM43 (alternativa IPC SD 17 HD)",
    prezzo: 1200,
    prezzoMin: 899,
    prezzoMax: 1830,
    fonte: "https://www.gecostore.it/monospazzole/1192-fimap-monospazzola-fm43.html (1.126 € scontato, listino 1.407,50 €); cleanvillage.it SD 17 HD 899 €; FM1500V alta velocità 1.828 €",
  },
  lavasciuga_spinta: {
    riferimento: "FIMAP Genie B (alternativa IPC CT 40 B50 MK2)",
    prezzo: 2600,
    prezzoMin: 1915,
    prezzoMax: 4450,
    fonte: "https://indors.it/lavapavimenti-uomo-a-terra/2257-fimap-genie-b.html (Genie B 2.094 €); e-shop.gfegroup.it Genie B 2.600 €; cleanvillage.it IPC CT 40 B50 MK2 2.435 €, CT 15 B35 1.915 €; aficleaning.com IPC CT 15 2.880 € e CT 40 4.450 € (listino)",
  },
  lavasciuga_bordo: {
    riferimento: "IPC CT 80 (alternativa FIMAP MMG)",
    prezzo: 9000,
    prezzoMin: 5970,
    prezzoMax: 13020,
    fonte: "https://www.aficleaning.com/product/lavasciuga-pavimenti-ipc-ct-80-uomo-a-bordo-a-batteria (CT 80 11.720 € di listino); cleanvillage.it IPC CT 80 BT55 5.970 €; aficleaning.com IPC CT 80 11.720 € e CT 81 13.020 € (listino); tuttocarrellielevatori.it FIMAP MMG nuovo 12.600 €",
  },
  spazzatrice_semovente: {
    riferimento: "IPC 712 Rider (alternativa FIMAP FSR)",
    prezzo: 10060,
    prezzoMin: 8150,
    prezzoMax: 15150,
    fonte: "https://www.aficleaning.com/product/spazzatrice-ipc-712-rider-uomo-a-bordo-con-aspirazione (712 Rider 10.060 € (IVA esclusa, su ordine), 512 Rider 8.150 €, 1050 15.150 €; onlyshopsrl.com/aficleaning.com FIMAP FSR 9.871,50 € (IVA non indicata)",
  },
  spazzatrice_spinta: {
    riferimento: "IPC 464 (uomo a terra con aspirazione)",
    prezzo: 2940,
    prezzoMin: 483,
    prezzoMax: 4795,
    fonte: "https://www.aficleaning.com/product/spazzatrice-ipc-464-uomo-a-terra-con-aspirazione (IPC 464 2.940 €) e IPC 505 4.795 €; spazzatrici manuali a spinta IPC 510M 564 € (cleanvillage.it), FIMAP FSM 483 € (indors.it)",
  },
  aspiratore_professionale: {
    riferimento: "IPC GP 2/62 W&D (alternativa FIMAP FV80)",
    prezzo: 405,
    prezzoMin: 215,
    prezzoMax: 804,
    fonte: "https://indors.it/aspirapolvere-aspiraliquidi/10310-fimap-fv80-aspirasolidi-liquidi-80-l.html (FIMAP FV80 369 €); cleanvillage.it IPC GP 2/62 W&D 405 €; aficleaning.com GP 2/62 598 €, GC 3/90 804 €; indors.it FIMAP FV80 369 €",
  },
  aspiratore_zaino: {
    riferimento: "FIMAP FV9+ B (zaino a batteria)",
    prezzo: 794,
    prezzoMin: 480,
    prezzoMax: 800,
    fonte: "https://indors.it/aspirapolvere-a-traino/4841-fimap-fv9-b-aspirapolvere-a-zaino-con-batteria.html (FIMAP FV9+ B 794 € (969 € IVA inclusa); 480 € è il prezzo di prassi dei piani per il modello a cavo",
  },
  lavamoquette: {
    riferimento: "FIMAP FE18 (alternativa IPC GS 2/62 Ext)",
    prezzo: 1016,
    prezzoMin: 661,
    prezzoMax: 1445,
    fonte: "https://indors.it/senza-vapore/4172-fimap-fe18-lavasuperfici-tessili.html (FIMAP FE18 1.016 €); cleanvillage.it IPC GS 2/62 EXT 994 €; aficleaning.com IPC GS 1/33 Ext 661 € e GS 2/62 Ext 1.445 € (listino)",
  },
  idropulitrice: {
    riferimento: "IPC Portotecnica PW-C21",
    prezzo: 1110,
    prezzoMin: 350,
    prezzoMax: 2020,
    fonte: "https://www.aficleaning.com/product/idropulitrice-ipc-pw-c21-ad-acqua-fredda-fino-a-170-bar (PW-C21 1.110 €) e PW-C45M 2.020 €; puliveneta.com PW-C22 350 €; ingrosso-pulizie.it PW-C21 1.133 €",
  },
  carrello_multiuso: {
    riferimento: "IPC Euromop BRIX School",
    prezzo: 339,
    prezzoMin: 176,
    prezzoMax: 530,
    fonte: "https://www.cleanvillage.it/carrello-brix-school-premium/ (BRIX School 339 €) e BRIX Hotel Mini 2.0 530 €; puliveneta.com Revolution 176 €",
  },
};

export const CATALOGO: VoceCatalogo[] = CATALOGO_BASE.map((v) => ({ ...v, ...(MERCATO_IPC_FIMAP[v.chiave] ?? {}) }));

export function voceCatalogo(chiave: string): VoceCatalogo | null {
  return CATALOGO.find((v) => v.chiave === chiave) ?? null;
}
