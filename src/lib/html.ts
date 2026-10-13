// Il testo scritto da un utente (o da un admin) non va mai messo così com'è in una
// email HTML: «<» e «&» verrebbero interpretati come markup. Si neutralizzano, e gli
// a capo diventano <br> perché una risposta su più righe resti leggibile.
export function escapeHtml(valore: string): string {
  return valore.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function testoPerEmail(valore: string): string {
  return escapeHtml(valore).replace(/\r?\n/g, "<br>");
}
