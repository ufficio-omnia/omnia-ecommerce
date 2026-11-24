// Solo per le verifiche eseguite fuori da Next (tsx): «next/cache» diventa un modulo senza cache (unstable_cache restituisce la funzione
// così com'è, invalidazioni nulle). Va importato PER PRIMO, prima dei moduli che usano next/cache. Nessuna rete, nessun database.
import Module from "node:module";

const finto = { unstable_cache: <T>(fn: T) => fn, revalidateTag() {}, updateTag() {}, revalidatePath() {} };
const m = Module as unknown as { _load: (richiesta: string, ...resto: unknown[]) => unknown };
const caricaOriginale = m._load;
m._load = function (richiesta: string, ...resto: unknown[]) {
  if (richiesta === "next/cache") return finto;
  return caricaOriginale.call(this, richiesta, ...resto);
};
