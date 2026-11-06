// Autenticazione delle route chiamate da Vercel Cron: Vercel manda «Authorization: Bearer $CRON_SECRET». Senza il segreto impostato
// NESSUNA chiamata è autorizzata (un confronto con «Bearer undefined» lascerebbe passare chiunque scriva quella stringa).
export function cronAutorizzato(intestazione: string | null, segreto: string | undefined): boolean {
  const atteso = (segreto ?? "").trim();
  if (atteso === "") return false;
  return intestazione === `Bearer ${atteso}`;
}
