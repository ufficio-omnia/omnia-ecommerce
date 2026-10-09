import { TIPI_STAFF } from "@/lib/organigramma-dati";

// Schema dello strumento (campo "organigramma" di genera_bozza_sezione):
// solo ciò che il modello può e deve dichiarare. Niente colori, coordinate o
// dimensioni; niente committente, interfaccia RUP/DEC, impresa o riquadri del
// livello di direzione (li ricava il codice da fonti certe).
const stringa = (descrizione: string) => ({ type: "string" as const, description: descrizione });

const NOMINATIVO = "Nome e cognome della persona, SOLO se compare nel profilo azienda; altrimenti ometti il campo (non inventare nomi).";

export const SCHEMA_ORGANIGRAMMA_STRUMENTO = {
  type: "object" as const,
  description:
    "Dati STRUTTURATI dell'organigramma di commessa. Compila questo campo SOLO se nel testo di questa sezione inserisci un organigramma, e in quel caso scrivi nel testo il solo segnaposto '[ORGANIGRAMMA][/ORGANIGRAMMA]' su una riga a sé, senza niente dentro: il generatore disegna lo schema come immagine. Dichiari soltanto le FIGURE e le loro RELAZIONI: colori, posizioni e stile li decide il generatore. NON dichiarare — lo ricava il sistema da fonti certe — il committente, l'interfaccia RUP/DEC, l'impresa, i riquadri del livello di direzione. CORRETTEZZA GERARCHICA (errore grave se violata): ogni figura sta sotto chi la supervisiona REALMENTE; gli addetti stanno sotto il caposquadra di riferimento, mai direttamente sotto il responsabile o il coordinatore. COMPLETEZZA: includi OGNI figura che nomini nel testo della sezione (es. se scrivi di un Ispettore Qualità, di un RSPP e di un Referente Reperibilità H24 come figure distinte, ognuna ha il suo posto qui). ORGANICO: conta una persona ogni figura (apicale, vice, staff, centrale operativa, zona, caposquadra e ogni ruolo elencato fra gli addetti) e il totale non può superare l'organico disponibile indicato nel contesto; se serve, accorpa i ruoli in una figura (es. 'Responsabile di Commessa / RSPP'). SEDI: se la gara ha un elenco di sedi, assegna OGNI sede a una zona con la denominazione ESATTA dell'elenco; il numero di sedi lo calcola il sistema. Un valore numerico in un testo libero (es. 'entro 24 ore') è un dato d'impresa e segue la regola R9 (asterisco se non confermato). Adatta sempre figure e zone ai documenti di QUESTA gara: i nomi dei ruoli cambiano di gara in gara.",
  properties: {
    figura_apicale: {
      type: "object" as const,
      description: "La figura al vertice della commessa (Responsabile di Commessa, Responsabile del Servizio, Responsabile della Convenzione...), col nome usato dai documenti di questa gara.",
      properties: { denominazione: stringa("Ruolo, es. 'Responsabile di Commessa'."), nominativo: stringa(NOMINATIVO) },
      required: ["denominazione"],
    },
    vice: {
      type: "object" as const,
      description: "Vice responsabile, solo se previsto.",
      properties: { denominazione: stringa("Ruolo."), nominativo: stringa(NOMINATIVO) },
      required: ["denominazione"],
    },
    staff_governo: {
      type: "array" as const,
      description: "Figure di staff AFFIANCATE alla figura apicale (non sotto di essa): sicurezza, qualità, ambiente, CAM, diversity, tutor, altre figure di supporto. Al massimo 6.",
      items: {
        type: "object" as const,
        properties: {
          denominazione: stringa("Ruolo, es. 'RSPP', 'Ispettore Qualità', 'Coordinatore CAM'."),
          nominativo: stringa(NOMINATIVO),
          tipo: {
            type: "string" as const,
            enum: [...TIPI_STAFF],
            description: "Tipo della figura: sicurezza (RSPP, preposto), qualita (ispettore, quality manager), ambiente, cam, diversity, tutor, reperibilita (referente di reperibilità), supporto (qualunque altra: logistica, amministrazione...). Decide il colore: lo applica il generatore.",
          },
        },
        required: ["denominazione", "tipo"],
      },
    },
    centrale_operativa: {
      type: "object" as const,
      description: "Nodo intermedio di smistamento fra governo e coordinamento (es. 'Centrale Operativa di Commessa'), solo se previsto.",
      properties: { denominazione: stringa("Nome del nodo."), descrizione: stringa("Una riga su cosa fa, facoltativa.") },
      required: ["denominazione"],
    },
    coordinamento: {
      type: "array" as const,
      description: "Zone di coordinamento: per ogni zona (o per l'unico coordinatore se non ci sono zone) il coordinatore, i capisquadra sotto di lui e gli addetti sotto ogni caposquadra. Almeno una zona; al massimo 12.",
      items: {
        type: "object" as const,
        properties: {
          denominazione: stringa("Ruolo del coordinatore, es. 'Coordinatore di Zona Nord'."),
          nominativo: stringa(NOMINATIVO),
          presidio: stringa("Che cosa presidia, es. 'Plessi ospedalieri'. Il numero di sedi NON va scritto: lo calcola il sistema."),
          sedi: { type: "array" as const, items: { type: "string" as const }, description: "Denominazioni ESATTE (copiate dall'elenco delle sedi della gara) delle sedi assegnate a questa zona." },
          annotazione: stringa("Annotazione breve facoltativa sotto il coordinatore, es. 'Antenne: Torino · Bologna'."),
          sottolivelli: {
            type: "array" as const,
            description: "Capisquadra/supervisori di questa zona, al massimo 4.",
            items: {
              type: "object" as const,
              properties: {
                denominazione: stringa("Ruolo, es. 'Caposquadra Area Critica'."),
                nominativo: stringa(NOMINATIVO),
                dettaglio: stringa("Una riga di dettaglio facoltativa (aree presidiate...)."),
                addetti: { type: "array" as const, items: { type: "string" as const }, description: "Ruoli degli addetti sotto questo caposquadra, uno per elemento (es. 'Operatore Pronto Soccorso'). Al massimo 5." },
              },
              required: ["denominazione"],
            },
          },
        },
        required: ["denominazione", "sottolivelli"],
      },
    },
    banda_conclusiva: {
      type: "object" as const,
      description: "Banda a piena larghezza in fondo allo schema (pool sostitutivo, riserva addestrata, squadra emergenze), solo se l'offerta la prevede.",
      properties: { titolo: stringa("Titolo breve."), descrizione: stringa("Una o due righe, facoltativa.") },
      required: ["titolo"],
    },
    risorse_trasversali: {
      type: "object" as const,
      description: "Risorse trasversali alle zone (squadra volante, squadra specialistica, squadra eventi), solo se previste.",
      properties: {
        titolo: stringa("Titolo del riquadro."),
        voci: { type: "array" as const, items: { type: "object" as const, properties: { denominazione: stringa("Nome della risorsa.") }, required: ["denominazione"] }, description: "Al massimo 5." },
      },
      required: ["titolo", "voci"],
    },
    strumenti_esterni: {
      type: "array" as const,
      description: "Strumenti esterni (non unità organizzative) che l'offerta cita: un call center dedicato. La piattaforma gestionale del profilo si aggiunge da sola.",
      items: {
        type: "object" as const,
        properties: { denominazione: stringa("Nome."), tipo: { type: "string" as const, enum: ["piattaforma", "call_center"], description: "Tipo." } },
        required: ["denominazione", "tipo"],
      },
    },
  },
  required: ["figura_apicale", "coordinamento"],
};
