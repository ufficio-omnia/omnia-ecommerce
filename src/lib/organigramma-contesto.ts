import {
  contaPersone,
  leggiDichiarazioneModello,
  normalizzaPerConfronto,
  pulisciTesto,
  serializzaBlocco,
  type DatiOrganigramma,
  type Figura,
  type RiquadroElenco,
  type TipoInterfaccia,
  type VoceElenco,
  type Zona,
} from "@/lib/organigramma-dati";
import { applicaGuardiaValori, type EvidenzaDati } from "@/lib/valori-impresa";

// Costruzione dei DATI dell'organigramma da ciò che dichiara il modello e da
// ciò che il codice SA da fonti certe. Il modello non decide: committente e
// tipo di interfaccia (RUP/DEC), impresa, riquadri del livello di direzione,
// piattaforma gestionale, numero di sedi; né inventa nominativi o sedi.
// Modulo PURO: i fatti (letti da DB in organigramma-fatti.ts) arrivano come
// parametro, così tutto si prova senza database né modello.

export type FattiOrganigramma = {
  impresa: string | null;
  committente: string | null;
  // Ricavato dai documenti di gara (vedi derivaTipoInterfaccia), mai dal modello.
  tipoInterfaccia: TipoInterfaccia | null;
  // Denominazioni esatte delle sedi della gara (può essere vuoto).
  sedi: string[];
  // Dipendenti del profilo + personale uscente assorbito (null se ignoto).
  organico: number | null;
  funzioniDirezione: VoceElenco[];
  ufficiGestione: VoceElenco[];
  softwareNome: string | null;
  // Testo del profilo aziendale: un nominativo si tiene solo se compare qui.
  testoProfilo: string;
};

export type EsitoOrganigramma = {
  dati: DatiOrganigramma | null;
  blocco: string | null;
  avvisi: string[];
  persone: number;
};

// RUP e DEC si ricavano dai documenti di gara, non dal modello: su una gara
// reale la bozza parlava di un "DEC comunale" che nei documenti non compare.
const RUP_REGEX = /\bRUP\b|responsabile\s+unico\s+(?:del\s+|di\s+)?(?:progetto|procedimento)/i;
const DEC_REGEX = /\bDEC\b|direttore\s+dell['’]\s*esecuzione/i;

export function derivaTipoInterfaccia(testiDocumenti: string[]): TipoInterfaccia | null {
  const rup = testiDocumenti.some((t) => RUP_REGEX.test(t));
  const dec = testiDocumenti.some((t) => DEC_REGEX.test(t));
  if (rup && dec) return "RUP/DEC";
  if (rup) return "RUP";
  if (dec) return "DEC";
  return null;
}

// Abbina un nome di sede scritto dal modello a una sede dell'elenco della gara
// (stessa scrittura a meno di maiuscole/accenti/punteggiatura, oppure uno dei
// due contenuto nell'altro): ciò che non si abbina non è una sede della gara.
export function abbinaSede(nome: string, sedi: string[]): string | null {
  const n = normalizzaPerConfronto(nome);
  if (!n) return null;
  const esatta = sedi.find((s) => normalizzaPerConfronto(s) === n);
  if (esatta) return esatta;
  if (n.length < 5) return null;
  return sedi.find((s) => {
    const sn = normalizzaPerConfronto(s);
    return sn.length >= 5 && (sn.includes(n) || n.includes(sn));
  }) ?? null;
}

// Riferimenti ai campi di testo libero di un organigramma, per applicare la
// guardia R9 ai valori numerici che il modello vi scrive ("entro 24 ore").
type Campo = { leggi: () => string | undefined; scrivi: (v: string) => void };

function campiDiTesto(d: DatiOrganigramma): Campo[] {
  const campi: Campo[] = [];
  if (d.centraleOperativa) {
    const c = d.centraleOperativa;
    campi.push({ leggi: () => c.descrizione, scrivi: (v) => { c.descrizione = v; } });
  }
  if (d.bandaConclusiva) {
    const b = d.bandaConclusiva;
    campi.push({ leggi: () => b.titolo, scrivi: (v) => { b.titolo = v; } });
    campi.push({ leggi: () => b.descrizione, scrivi: (v) => { b.descrizione = v; } });
  }
  for (const z of d.coordinamento) {
    campi.push({ leggi: () => z.presidio, scrivi: (v) => { z.presidio = v; } });
    campi.push({ leggi: () => z.annotazione, scrivi: (v) => { z.annotazione = v; } });
    for (const s of z.sottolivelli) {
      campi.push({ leggi: () => s.dettaglio, scrivi: (v) => { s.dettaglio = v; } });
      (s.addetti ?? []).forEach((_, i) => campi.push({ leggi: () => s.addetti?.[i], scrivi: (v) => { if (s.addetti) s.addetti[i] = v; } }));
    }
  }
  for (const r of d.risorseTrasversali?.voci ?? []) campi.push({ leggi: () => r.denominazione, scrivi: (v) => { r.denominazione = v; } });
  return campi;
}

// Guardia R9 sui testi dell'organigramma: un valore numerico su prodotti,
// attrezzature, prestazioni o organico senza riscontro riceve l'asterisco di
// "proposta da confermare", come ovunque nel documento. Ritorna i campi marcati.
export function marcaValoriNellOrganigramma(d: DatiOrganigramma, evidenza: EvidenzaDati): string[] {
  const campi = campiDiTesto(d).filter((c) => (c.leggi() ?? "").trim().length > 0);
  if (campi.length === 0) return [];
  const righe = campi.map((c) => (c.leggi() as string).replace(/\s+/g, " "));
  const esito = applicaGuardiaValori(righe.join("\n"), evidenza);
  const nuove = esito.testo.split("\n");
  const marcati: string[] = [];
  campi.forEach((c, i) => {
    const nuovo = nuove[i];
    if (typeof nuovo === "string" && nuovo !== righe[i]) {
      c.scrivi(nuovo.length > 200 ? `${nuovo.slice(0, 199)}…` : nuovo);
      marcati.push(righe[i]);
    }
  });
  return marcati;
}

export function costruisciOrganigramma(raw: unknown, fatti: FattiOrganigramma, opzioni: { evidenza?: EvidenzaDati | null } = {}): EsitoOrganigramma {
  const dich = leggiDichiarazioneModello(raw);
  const avvisi = [...dich.avvisi];

  if (!dich.figuraApicale) {
    return { dati: null, blocco: null, avvisi: [...avvisi, "Organigramma NON disegnato: nei dati strutturati manca la figura apicale."], persone: 0 };
  }
  if (dich.coordinamento.length === 0) {
    return { dati: null, blocco: null, avvisi: [...avvisi, "Organigramma NON disegnato: nei dati strutturati manca il livello di coordinamento (almeno una zona)."], persone: 0 };
  }

  // Nominativi: solo se compaiono nel profilo aziendale. Il modello non deve
  // inventare persone; il nome di un dipendente lo conosce solo il cliente.
  const profilo = normalizzaPerConfronto(fatti.testoProfilo);
  let nominativiScartati = 0;
  const verifica = <T extends { nominativo?: string }>(f: T): T => {
    if (f.nominativo && !profilo.includes(normalizzaPerConfronto(f.nominativo))) {
      nominativiScartati++;
      const { nominativo: _scartato, ...resto } = f;
      void _scartato;
      return resto as T;
    }
    return f;
  };
  const apicale: Figura = verifica(dich.figuraApicale);
  const vice = dich.vice ? verifica(dich.vice) : undefined;
  const staff = dich.staffGoverno.map(verifica);
  const zone: Zona[] = dich.coordinamento.map((z) => ({ ...verifica(z), sottolivelli: z.sottolivelli.map(verifica) }));
  if (nominativiScartati > 0) {
    avvisi.push(`${nominativiScartati} nominativo/i scritto/i dal modello non compaiono nel profilo azienda e sono stati omessi dall'organigramma.`);
  }

  // Sedi: solo quelle dell'elenco della gara; il numero lo calcola il codice.
  if (fatti.sedi.length > 0) {
    const coperte = new Set<string>();
    for (const z of zone) {
      const abbinate: string[] = [];
      for (const nome of z.sedi ?? []) {
        const sede = abbinaSede(nome, fatti.sedi);
        if (sede) {
          if (!abbinate.includes(sede)) abbinate.push(sede);
          coperte.add(sede);
        } else {
          avvisi.push(`Sede «${nome}» scritta nell'organigramma ma non presente nell'elenco delle sedi della gara: non è stata disegnata.`);
        }
      }
      if (abbinate.length) {
        z.sedi = abbinate;
        z.numeroSedi = abbinate.length;
      } else {
        delete z.sedi;
      }
    }
    const scoperte = fatti.sedi.filter((s) => !coperte.has(s));
    if (scoperte.length > 0) {
      if (zone.length === 1) {
        // Con una sola zona l'assegnazione è ovvia: tutte le sedi sono sue.
        zone[0].sedi = [...(zone[0].sedi ?? []), ...scoperte];
        zone[0].numeroSedi = zone[0].sedi.length;
      } else {
        avvisi.push(`Sedi della gara non assegnate a nessuna zona dell'organigramma: ${scoperte.join(", ")}. Dillo al cliente: vanno assegnate a una zona.`);
      }
    }
  } else {
    for (const z of zone) {
      delete z.sedi;
      delete z.numeroSedi;
    }
  }

  // Strumenti esterni: la piattaforma del profilo (dato certo) + ciò che il
  // modello dichiara (call center).
  const strumenti = [...dich.strumentiEsterni];
  const software = pulisciTesto(fatti.softwareNome ?? undefined, 70);
  if (software && !strumenti.some((s) => normalizzaPerConfronto(s.denominazione) === normalizzaPerConfronto(software))) {
    strumenti.unshift({ denominazione: software, tipo: "piattaforma" });
  }

  // Riquadri del livello di direzione: dal profilo, se compilato.
  const riquadri: RiquadroElenco[] = [];
  if (fatti.funzioniDirezione.length) riquadri.push({ titolo: "Responsabili di funzione", posizione: "sinistra", voci: fatti.funzioniDirezione });
  if (fatti.ufficiGestione.length) riquadri.push({ titolo: "Uffici di gestione", posizione: "destra", voci: fatti.ufficiGestione });

  const dati: DatiOrganigramma = {
    v: 2,
    ...(fatti.committente ? { committente: { denominazione: fatti.committente, ...(fatti.tipoInterfaccia ? { tipoInterfaccia: fatti.tipoInterfaccia } : {}) } } : {}),
    imprese: fatti.impresa ? [{ denominazione: fatti.impresa }] : [],
    ...(strumenti.length ? { strumentiEsterni: strumenti } : {}),
    ...(riquadri.length ? { riquadriElenco: riquadri } : {}),
    figuraApicale: apicale,
    ...(vice ? { vice } : {}),
    ...(staff.length ? { staffGoverno: staff } : {}),
    ...(dich.centraleOperativa ? { centraleOperativa: dich.centraleOperativa } : {}),
    coordinamento: zone,
    ...(dich.bandaConclusiva ? { bandaConclusiva: dich.bandaConclusiva } : {}),
    ...(dich.risorseTrasversali ? { risorseTrasversali: dich.risorseTrasversali } : {}),
  };

  const persone = contaPersone(dati);
  if (fatti.organico != null && persone > fatti.organico) {
    avvisi.push(`L'organigramma ha ${persone} caselle di persone ma l'organico disponibile è ${fatti.organico} (dipendenti del profilo + personale uscente): una struttura con più teste di quante l'azienda ne abbia è un dato d'impresa inventato. Dillo al cliente e accorpa i ruoli.`);
  }

  if (opzioni.evidenza) {
    const marcati = marcaValoriNellOrganigramma(dati, opzioni.evidenza);
    if (marcati.length > 0) avvisi.push(`${marcati.length} testo/i dell'organigramma con un valore numerico senza riscontro sono stati marcati con asterisco (proposta da confermare).`);
  }

  return { dati, blocco: serializzaBlocco(dati), avvisi, persone };
}
