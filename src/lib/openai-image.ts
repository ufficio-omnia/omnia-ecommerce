const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const MODEL = "gpt-image-1";

// Genera un'immagine reale (foto/illustrazione) da inserire in una
// relazione tecnica, a partire da una descrizione scritta dall'AI (es.
// "fotografia di un addetto alle pulizie professionale con attrezzatura
// moderna in un ufficio luminoso"). Diverso dall'organigramma
// (org-chart.ts, disegnato programmaticamente da uno schema gerarchico):
// qui il contenuto dell'immagine stessa viene generato da un modello
// dedicato, per illustrazioni generiche che non hanno una struttura dati
// sottostante.
export async function generateImagePng(prompt: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY non configurata.");
  }

  const response = await fetch(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: "1024x1024",
      quality: "medium",
      n: 1,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Errore OpenAI Images (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Risposta OpenAI Images senza immagine.");
  }

  return Buffer.from(b64, "base64");
}
