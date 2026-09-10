import sharp from "sharp";

// Libreria fissa di icone semplici (stile flat, tratto pulito) per le
// categorie ricorrenti nei progetti tecnici OMNIA (pulizia, sicurezza,
// formazione, ambiente, ecc.), disegnate internamente come SVG invece di
// usare un pacchetto icone esterno: niente dipendenze, niente questioni
// di licenza, colore sempre coerente con il documento generato.
// Ogni path usa un viewBox 24x24 e "currentColor" per essere ricolorata.
const ICONE: Record<string, string> = {
  pulizia:
    '<path d="M14.5 2.5 6 11l1.4 1.4L11 9v9.5a2.5 2.5 0 0 0 5 0V9l3.6-3.6L18.2 4 14.5 7.7V2.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="13.5" cy="20" r="1.3" fill="currentColor"/>',
  sicurezza:
    '<path d="M12 2.5 5 5.3v5.4c0 4.9 3 8.9 7 10.3 4-1.4 7-5.4 7-10.3V5.3L12 2.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12.2l2 2 4.2-4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  formazione:
    '<path d="M2.5 9 12 5l9.5 4-9.5 4-9.5-4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.5 11v4.3c0 1.4 2.5 2.7 5.5 2.7s5.5-1.3 5.5-2.7V11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M20.5 9v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  ambiente:
    '<path d="M19 5c-7 0-12.5 5-12.5 11.5 0 .5 0 1 .1 1.5.5 0 1 .1 1.5.1C14.5 18.1 19 12.5 19 5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 20c0-4 3-7.5 6.5-9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  certificazione:
    '<circle cx="12" cy="9.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 14.5 8 21.5l4-2 4 2-1-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9.5 9.5l1.7 1.7 3.3-3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  qualita:
    '<path d="M12 3.5 14.5 9l6 .8-4.3 4.1 1 5.9-5.2-2.9-5.2 2.9 1-5.9L3.5 9.8l6-.8L12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  tempistiche:
    '<circle cx="12" cy="12.5" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5v5.3l3.5 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  personale:
    '<circle cx="12" cy="7.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 20.5c0-4.4 3.4-7 7.5-7s7.5 2.6 7.5 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  comunicazione:
    '<path d="M4 5.5h16v11H9l-4 3.5v-3.5H4v-11Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.5 9.5h9M7.5 13h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  monitoraggio:
    '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.3 15.3 20.5 20.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  logistica:
    '<rect x="2.5" y="8" width="12" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14.5 11h3.5l3.5 3.5V17h-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="7" cy="18.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="18" cy="18.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  attrezzature:
    '<path d="M14.7 6.3a3.5 3.5 0 0 1 4.9 4.9l-8 8a3.5 3.5 0 0 1-4.9-4.9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.5 15.5 3.5 20.5l5-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  documentazione:
    '<path d="M7 2.5h8l3.5 3.5v15.5H7V2.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9.5 11h5M9.5 14.5h5M9.5 18h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

export const NOMI_ICONE = Object.keys(ICONE);

const cache = new Map<string, Buffer>();

// Renderizza un'icona come PNG piccolo, colorata in "colore" (esadecimale
// senza #). Usata per accompagnare righe di tabella/elenchi puntati
// (es. attrezzatura, certificazione) come nei progetti di riferimento,
// che affiancano spesso piccole icone al testo tecnico.
export async function renderIconePng(nome: string, colore: string): Promise<Buffer | null> {
  const path = ICONE[nome.toLowerCase()];
  if (!path) return null;

  const chiave = `${nome.toLowerCase()}:${colore}`;
  const cached = cache.get(chiave);
  if (cached) return cached;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" color="#${colore}">${path}</svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  cache.set(chiave, buffer);
  return buffer;
}
