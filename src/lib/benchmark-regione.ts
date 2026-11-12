// SOLO PER IL BENCHMARK DI REGIONE (branch perf/benchmark-regione*): mai da unire in master.
// Il banco di prova si accende solo se TUTTE queste condizioni valgono insieme:
//   - non è produzione: VERCEL_ENV === "preview" (anteprima Vercel) oppure sviluppo/prova locale (VERCEL_ENV assente);
//   - BENCHMARK_TOKEN impostato (almeno 24 caratteri) — le richieste devono portarlo nell'intestazione x-benchmark-token;
//   - BENCHMARK_SUPABASE_ATTESO uguale all'host di NEXT_PUBLIC_SUPABASE_URL: chi configura l'anteprima dichiara quale
//     database di STAGING si aspetta; se l'anteprima puntasse a un altro database (per esempio quello reale) tutto resta spento.

export function hostSupabase(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return null;
  }
}

export function benchmarkAcceso(): boolean {
  const ambiente = process.env.VERCEL_ENV;
  if (ambiente === "production") return false;
  if (ambiente !== undefined && ambiente !== "preview") return false;
  const token = process.env.BENCHMARK_TOKEN ?? "";
  const atteso = process.env.BENCHMARK_SUPABASE_ATTESO ?? "";
  return token.length >= 24 && atteso.length > 0 && hostSupabase() === atteso;
}

export function tokenValido(intestazione: string | null): boolean {
  const token = process.env.BENCHMARK_TOKEN ?? "";
  if (!benchmarkAcceso() || !intestazione || intestazione.length !== token.length) return false;
  let diverso = 0;
  for (let i = 0; i < token.length; i++) diverso |= token.charCodeAt(i) ^ intestazione.charCodeAt(i);
  return diverso === 0;
}

export function statistiche(valori: number[]): { n: number; min: number; mediana: number; p90: number; max: number } {
  const v = [...valori].sort((a, b) => a - b);
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, min: Math.round(v[0]), mediana: Math.round(q(0.5)), p90: Math.round(q(0.9)), max: Math.round(v[v.length - 1]) };
}
