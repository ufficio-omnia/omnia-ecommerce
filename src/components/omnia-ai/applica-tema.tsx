import { costruisciScriptTema } from "@/lib/tema-omnia-ai";

// Primo elemento del <body> (src/app/site-omnia-ai/layout.tsx): applica il tema scelto dall'utente PRIMA che la pagina compaia, così
// non c'è il lampo del tema sbagliato. Senza scelta salvata il tema è il chiaro (lo scrive già il server). Il testo dello script e le sue regole stanno in
// src/lib/tema-omnia-ai.ts. Componente server: nessun avviso di React sugli <script>.
export default function ApplicaTema() {
  return <script dangerouslySetInnerHTML={{ __html: costruisciScriptTema() }} />;
}
