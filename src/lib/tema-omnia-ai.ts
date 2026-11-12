// Il tema (scuro o chiaro) di omnia-ai.it e della sua area riservata. Modulo puro, senza React né server: lo usano lo script che parte
// prima della pagina, l'interruttore e i widget di terzi (anti-bot, badge Stripe Climate); provato in scripts/verifica-tema-omnia-ai.ts.
//
// Regole di prodotto:
//  - SENZA una scelta dell'utente il tema è SEMPRE il CHIARO, per chiunque arrivi sul sito o nell'area riservata (richiesta dell'utente,
//    12/11/2026), anche se il suo dispositivo è in modo scuro: lo scuro si sceglie con l'interruttore;
//  - la scelta è di tre tipi: «scuro», «chiaro», «auto» (segue il sistema del dispositivo, anche se cambia mentre la pagina è aperta);
//  - la scelta si ricorda sul dispositivo (localStorage, solo dopo un clic dell'utente) e vale per sito e area riservata, che hanno lo
//    stesso dominio; se il browser non lascia scrivere si resta sul tema scelto per quella visita, senza errori;
//  - il tema si applica con data-tema="scuro|chiaro" sull'<html>; i colori stanno tutti in omnia-ai.css (variabili).

export const CHIAVE_TEMA = "omnia-tema";

export type SceltaTema = "scuro" | "chiaro" | "auto";
export type TemaEffettivo = "scuro" | "chiaro";

export const SCELTE_TEMA: readonly SceltaTema[] = ["scuro", "chiaro", "auto"];
export const SCELTA_PREDEFINITA: SceltaTema = "chiaro";
// Il tema che il server scrive già nell'<html> (layout.tsx), così anche prima dello script e senza JavaScript la pagina parte chiara.
export const TEMA_PREDEFINITO: TemaEffettivo = "chiaro";

export const ETICHETTE_SCELTA: Record<SceltaTema, string> = {
  scuro: "Tema scuro",
  chiaro: "Tema chiaro",
  auto: "Tema automatico (segue il dispositivo)",
};

// I colori del browser (barra dell'indirizzo sui telefoni, controlli nativi) per ciascun tema: devono coincidere con --nero di omnia-ai.css.
export const COLORI_BROWSER: Record<TemaEffettivo, { themeColor: string; colorScheme: "dark" | "light" }> = {
  scuro: { themeColor: "#050509", colorScheme: "dark" },
  chiaro: { themeColor: "#f5f4fb", colorScheme: "light" },
};

export const MEDIA_SISTEMA_CHIARO = "(prefers-color-scheme: light)";

// Ciò che è salvato → una scelta valida (qualsiasi altra cosa vale «chiaro»).
export function interpretaScelta(valore: string | null | undefined): SceltaTema {
  return valore === "chiaro" || valore === "auto" || valore === "scuro" ? valore : SCELTA_PREDEFINITA;
}

export function temaEffettivo(scelta: SceltaTema, sistemaChiaro: boolean): TemaEffettivo {
  if (scelta === "chiaro") return "chiaro";
  if (scelta === "auto" && sistemaChiaro) return "chiaro";
  return "scuro";
}

// ───── applicazione nel documento (usata dall'interruttore; lo script iniziale fa la stessa cosa in ES5) ─────

type DocumentoMinimo = {
  documentElement: { setAttribute(nome: string, valore: string): void };
  querySelector(selettore: string): { setAttribute(nome: string, valore: string): void } | null;
};
type StorageMinimo = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function applicaTemaAlDocumento(doc: DocumentoMinimo, scelta: SceltaTema, sistemaChiaro: boolean): TemaEffettivo {
  const tema = temaEffettivo(scelta, sistemaChiaro);
  doc.documentElement.setAttribute("data-tema", tema);
  doc.documentElement.setAttribute("data-tema-scelta", scelta);
  const colori = COLORI_BROWSER[tema];
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", colori.themeColor);
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute("content", colori.colorScheme);
  return tema;
}

// Salva la scelta; mai un errore se il browser non lo permette (finestra privata, dati del sito bloccati).
export function salvaScelta(storage: StorageMinimo | null | undefined, scelta: SceltaTema): boolean {
  try {
    if (!storage) return false;
    storage.setItem(CHIAVE_TEMA, scelta);
    return true;
  } catch {
    return false;
  }
}

export function leggiScelta(storage: StorageMinimo | null | undefined): SceltaTema {
  try {
    return interpretaScelta(storage?.getItem(CHIAVE_TEMA));
  } catch {
    return SCELTA_PREDEFINITA;
  }
}

// ───── lo script che parte prima della pagina ─────
// Va nel <body>, come primo elemento (src/components/omnia-ai/applica-tema.tsx), e si esegue subito: così il tema giusto c'è già
// quando il browser disegna, senza il lampo del tema sbagliato. ES5 e senza dipendenze, perché gira da solo. Deve fare ESATTAMENTE
// ciò che fanno interpretaScelta + temaEffettivo + applicaTemaAlDocumento: lo prova lo stesso test, eseguendolo caso per caso.
export function costruisciScriptTema(): string {
  const colori = JSON.stringify(COLORI_BROWSER);
  return (
    "(function(){" +
    "var d=document,r=d.documentElement,s=" + JSON.stringify(SCELTA_PREDEFINITA) + ";" +
    "try{var v=localStorage.getItem(" + JSON.stringify(CHIAVE_TEMA) + ");if(v===\"chiaro\"||v===\"auto\"||v===\"scuro\")s=v}catch(e){}" +
    // con «automatico» e un sistema che non si riesce a interrogare si resta sul chiaro (il tema di base): solo un sistema che DICE di essere scuro dà lo scuro
    "var c=true;try{if(window.matchMedia)c=!!matchMedia(" + JSON.stringify(MEDIA_SISTEMA_CHIARO) + ").matches}catch(e){}" +
    "var t=s===\"chiaro\"||(s===\"auto\"&&c)?\"chiaro\":\"scuro\";" +
    "r.setAttribute(\"data-tema\",t);r.setAttribute(\"data-tema-scelta\",s);" +
    "var k=" + colori + "[t],m=d.querySelector('meta[name=\"theme-color\"]'),q=d.querySelector('meta[name=\"color-scheme\"]');" +
    "if(m)m.setAttribute(\"content\",k.themeColor);if(q)q.setAttribute(\"content\",k.colorScheme)" +
    "})();"
  );
}
