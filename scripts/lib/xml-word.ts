// Helper di lettura dell'XML di un documento Word, condivisi tra i
// controlli strutturali (controlli-relazione.ts) e il manifest delle
// immagini (immagini-relazione.ts).

export function decodeEntitaXml(testo: string): string {
  return testo
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Testo di OGNI nodo <w:t>, separatamente (non concatenato in una sola
// stringa): un marcatore di sintassi non convertito (es. "**testo**") vive
// SEMPRE interamente dentro un singolo nodo di testo, non a cavallo di due
// — la stessa sequenza di caratteri può comparire per puro accostamento
// tra due nodi indipendenti e corretti (es. un asterisco singolo a fine
// cella di tabella seguito, in un nodo completamente diverso, dall'asterisco
// singolo iniziale della nota sotto la tabella: "* " + "*Valori..." letti
// insieme sembrano "**" ma sono due marcatori legittimi, non uno residuo).
export function estraiTestiPerNodo(xml: string): string[] {
  // "<w:t" seguito da spazio o ">" (NON "<w:t[^>]*>", che cattura anche
  // <w:tcPr>, <w:tab/>, <w:tblPr>... e trattava del markup come testo).
  const match = xml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
  return match.map((m) => decodeEntitaXml(m.replace(/^<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>$/, "")));
}

// Testo dei nodi <w:t> concatenato, nell'ordine: è il testo che un lettore
// vede davvero. Usata per controlli su testo "letto per intero"
// (intestazione, celle, frasi vietate) — per i marcatori residui vedi
// estraiTestiPerNodo, che non concatena nodi diversi tra loro.
export function estraiTestiVisibili(xml: string): string {
  return estraiTestiPerNodo(xml).join("");
}

export function attributoXml(tag: string, nome: string): string | null {
  const m = tag.match(new RegExp(`\\b${nome.replace(":", "\\:")}="([^"]*)"`));
  return m ? decodeEntitaXml(m[1]) : null;
}
