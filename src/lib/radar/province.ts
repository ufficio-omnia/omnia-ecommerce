// Province italiane → sigla e regione. Serve alle fonti che indicano il luogo con il NOME della provincia invece del codice NUTS (la PVL di
// ANAC scrive «Venezia», «Forlì-Cesena», «Reggio Calabria» nel campo «luogo_nuts»). Logica pura, nessuna rete.
//
// Regole: un nome che non si riconosce con certezza non dà né sigla né regione (mai indovinate). «ITALIA» e i valori vuoti → nulla.
// Le province sarde istituite dalla riforma regionale hanno la sola regione: la sigla resta vuota finché non è quella ufficiale.
import { regioneDaNuts, type IdRegione } from "./territorio";

type Provincia = { nome: string; sigla: string | null; regione: IdRegione; altri?: readonly string[] };

export const PROVINCE: readonly Provincia[] = [
  // Piemonte
  { nome: "Torino", sigla: "TO", regione: "piemonte" },
  { nome: "Vercelli", sigla: "VC", regione: "piemonte" },
  { nome: "Novara", sigla: "NO", regione: "piemonte" },
  { nome: "Cuneo", sigla: "CN", regione: "piemonte" },
  { nome: "Asti", sigla: "AT", regione: "piemonte" },
  { nome: "Alessandria", sigla: "AL", regione: "piemonte" },
  { nome: "Biella", sigla: "BI", regione: "piemonte" },
  { nome: "Verbano-Cusio-Ossola", sigla: "VB", regione: "piemonte", altri: ["Verbania"] },
  // Valle d'Aosta
  { nome: "Aosta", sigla: "AO", regione: "valle_d_aosta", altri: ["Valle d'Aosta", "Valle d'Aosta/Vallée d'Aoste", "Vallée d'Aoste"] },
  // Lombardia
  { nome: "Varese", sigla: "VA", regione: "lombardia" },
  { nome: "Como", sigla: "CO", regione: "lombardia" },
  { nome: "Sondrio", sigla: "SO", regione: "lombardia" },
  { nome: "Milano", sigla: "MI", regione: "lombardia" },
  { nome: "Bergamo", sigla: "BG", regione: "lombardia" },
  { nome: "Brescia", sigla: "BS", regione: "lombardia" },
  { nome: "Pavia", sigla: "PV", regione: "lombardia" },
  { nome: "Cremona", sigla: "CR", regione: "lombardia" },
  { nome: "Mantova", sigla: "MN", regione: "lombardia" },
  { nome: "Lecco", sigla: "LC", regione: "lombardia" },
  { nome: "Lodi", sigla: "LO", regione: "lombardia" },
  { nome: "Monza e della Brianza", sigla: "MB", regione: "lombardia", altri: ["Monza e Brianza", "Monza Brianza", "Monza"] },
  // Trentino-Alto Adige
  { nome: "Bolzano", sigla: "BZ", regione: "trentino_alto_adige", altri: ["Bolzano/Bozen", "Bozen", "Alto Adige"] },
  { nome: "Trento", sigla: "TN", regione: "trentino_alto_adige" },
  // Veneto
  { nome: "Verona", sigla: "VR", regione: "veneto" },
  { nome: "Vicenza", sigla: "VI", regione: "veneto" },
  { nome: "Belluno", sigla: "BL", regione: "veneto" },
  { nome: "Treviso", sigla: "TV", regione: "veneto" },
  { nome: "Venezia", sigla: "VE", regione: "veneto" },
  { nome: "Padova", sigla: "PD", regione: "veneto" },
  { nome: "Rovigo", sigla: "RO", regione: "veneto" },
  // Friuli-Venezia Giulia
  { nome: "Udine", sigla: "UD", regione: "friuli_venezia_giulia" },
  { nome: "Gorizia", sigla: "GO", regione: "friuli_venezia_giulia" },
  { nome: "Trieste", sigla: "TS", regione: "friuli_venezia_giulia" },
  { nome: "Pordenone", sigla: "PN", regione: "friuli_venezia_giulia" },
  // Liguria
  { nome: "Imperia", sigla: "IM", regione: "liguria" },
  { nome: "Savona", sigla: "SV", regione: "liguria" },
  { nome: "Genova", sigla: "GE", regione: "liguria" },
  { nome: "La Spezia", sigla: "SP", regione: "liguria" },
  // Emilia-Romagna
  { nome: "Piacenza", sigla: "PC", regione: "emilia_romagna" },
  { nome: "Parma", sigla: "PR", regione: "emilia_romagna" },
  { nome: "Reggio nell'Emilia", sigla: "RE", regione: "emilia_romagna", altri: ["Reggio Emilia"] },
  { nome: "Modena", sigla: "MO", regione: "emilia_romagna" },
  { nome: "Bologna", sigla: "BO", regione: "emilia_romagna" },
  { nome: "Ferrara", sigla: "FE", regione: "emilia_romagna" },
  { nome: "Ravenna", sigla: "RA", regione: "emilia_romagna" },
  { nome: "Forlì-Cesena", sigla: "FC", regione: "emilia_romagna", altri: ["Forli-Cesena", "Forlì Cesena"] },
  { nome: "Rimini", sigla: "RN", regione: "emilia_romagna" },
  // Toscana
  { nome: "Massa-Carrara", sigla: "MS", regione: "toscana", altri: ["Massa Carrara", "Massa"] },
  { nome: "Lucca", sigla: "LU", regione: "toscana" },
  { nome: "Pistoia", sigla: "PT", regione: "toscana" },
  { nome: "Firenze", sigla: "FI", regione: "toscana" },
  { nome: "Livorno", sigla: "LI", regione: "toscana" },
  { nome: "Pisa", sigla: "PI", regione: "toscana" },
  { nome: "Arezzo", sigla: "AR", regione: "toscana" },
  { nome: "Siena", sigla: "SI", regione: "toscana" },
  { nome: "Grosseto", sigla: "GR", regione: "toscana" },
  { nome: "Prato", sigla: "PO", regione: "toscana" },
  // Umbria
  { nome: "Perugia", sigla: "PG", regione: "umbria" },
  { nome: "Terni", sigla: "TR", regione: "umbria" },
  // Marche
  { nome: "Pesaro e Urbino", sigla: "PU", regione: "marche", altri: ["Pesaro Urbino", "Pesaro-Urbino"] },
  { nome: "Ancona", sigla: "AN", regione: "marche" },
  { nome: "Macerata", sigla: "MC", regione: "marche" },
  { nome: "Ascoli Piceno", sigla: "AP", regione: "marche" },
  { nome: "Fermo", sigla: "FM", regione: "marche" },
  // Lazio
  { nome: "Viterbo", sigla: "VT", regione: "lazio" },
  { nome: "Rieti", sigla: "RI", regione: "lazio" },
  { nome: "Roma", sigla: "RM", regione: "lazio" },
  { nome: "Latina", sigla: "LT", regione: "lazio" },
  { nome: "Frosinone", sigla: "FR", regione: "lazio" },
  // Abruzzo
  { nome: "L'Aquila", sigla: "AQ", regione: "abruzzo", altri: ["L Aquila", "Aquila"] },
  { nome: "Teramo", sigla: "TE", regione: "abruzzo" },
  { nome: "Pescara", sigla: "PE", regione: "abruzzo" },
  { nome: "Chieti", sigla: "CH", regione: "abruzzo" },
  // Molise
  { nome: "Campobasso", sigla: "CB", regione: "molise" },
  { nome: "Isernia", sigla: "IS", regione: "molise" },
  // Campania
  { nome: "Caserta", sigla: "CE", regione: "campania" },
  { nome: "Benevento", sigla: "BN", regione: "campania" },
  { nome: "Napoli", sigla: "NA", regione: "campania" },
  { nome: "Avellino", sigla: "AV", regione: "campania" },
  { nome: "Salerno", sigla: "SA", regione: "campania" },
  // Puglia
  { nome: "Foggia", sigla: "FG", regione: "puglia" },
  { nome: "Bari", sigla: "BA", regione: "puglia" },
  { nome: "Taranto", sigla: "TA", regione: "puglia" },
  { nome: "Brindisi", sigla: "BR", regione: "puglia" },
  { nome: "Lecce", sigla: "LE", regione: "puglia" },
  { nome: "Barletta-Andria-Trani", sigla: "BT", regione: "puglia", altri: ["Barletta Andria Trani", "Barletta"] },
  // Basilicata
  { nome: "Potenza", sigla: "PZ", regione: "basilicata" },
  { nome: "Matera", sigla: "MT", regione: "basilicata" },
  // Calabria
  { nome: "Cosenza", sigla: "CS", regione: "calabria" },
  { nome: "Catanzaro", sigla: "CZ", regione: "calabria" },
  { nome: "Reggio Calabria", sigla: "RC", regione: "calabria", altri: ["Reggio di Calabria"] },
  { nome: "Crotone", sigla: "KR", regione: "calabria" },
  { nome: "Vibo Valentia", sigla: "VV", regione: "calabria" },
  // Sicilia
  { nome: "Trapani", sigla: "TP", regione: "sicilia" },
  { nome: "Palermo", sigla: "PA", regione: "sicilia" },
  { nome: "Messina", sigla: "ME", regione: "sicilia" },
  { nome: "Agrigento", sigla: "AG", regione: "sicilia" },
  { nome: "Caltanissetta", sigla: "CL", regione: "sicilia" },
  { nome: "Enna", sigla: "EN", regione: "sicilia" },
  { nome: "Catania", sigla: "CT", regione: "sicilia" },
  { nome: "Ragusa", sigla: "RG", regione: "sicilia" },
  { nome: "Siracusa", sigla: "SR", regione: "sicilia" },
  // Sardegna (sigle certe; le province della riforma regionale solo con la regione)
  { nome: "Sassari", sigla: "SS", regione: "sardegna" },
  { nome: "Nuoro", sigla: "NU", regione: "sardegna" },
  { nome: "Cagliari", sigla: "CA", regione: "sardegna" },
  { nome: "Oristano", sigla: "OR", regione: "sardegna" },
  { nome: "Sud Sardegna", sigla: "SU", regione: "sardegna" },
  { nome: "Gallura Nord-Est Sardegna", sigla: null, regione: "sardegna", altri: ["Gallura", "Nord-Est Sardegna", "Olbia-Tempio"] },
  { nome: "Ogliastra", sigla: null, regione: "sardegna" },
  { nome: "Medio Campidano", sigla: null, regione: "sardegna" },
  { nome: "Sulcis Iglesiente", sigla: null, regione: "sardegna", altri: ["Carbonia-Iglesias"] },
];

// Confronto: minuscole, senza accenti, senza «provincia di», «città metropolitana di», «libero consorzio comunale di»; trattini,
// apostrofi e barre come spazi.
export function nomeDiConfronto(testo: string | null | undefined): string {
  return (testo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(provincia (autonoma )?di|citta metropolitana di|libero consorzio comunale di)\s+/, "")
    .replace(/[-'’`/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PER_NOME = new Map<string, Provincia>();
for (const p of PROVINCE) {
  for (const n of [p.nome, ...(p.altri ?? [])]) PER_NOME.set(nomeDiConfronto(n), p);
}

export type LuogoProvincia = { provincia: string | null; sigla: string | null; regione: IdRegione | null };

// «Venezia» → { provincia: "Venezia", sigla: "VE", regione: "veneto" }; «ITH35» → solo la regione; «ITALIA», «» o un nome sconosciuto → vuoto.
export function provinciaDaTesto(testo: string | null | undefined): LuogoProvincia {
  const t = (testo ?? "").trim();
  if (!t) return { provincia: null, sigla: null, regione: null };
  const daNuts = regioneDaNuts(t);
  if (daNuts) return { provincia: null, sigla: null, regione: daNuts };
  const p = PER_NOME.get(nomeDiConfronto(t));
  return p ? { provincia: p.nome, sigla: p.sigla, regione: p.regione } : { provincia: null, sigla: null, regione: null };
}
