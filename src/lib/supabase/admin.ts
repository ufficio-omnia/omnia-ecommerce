import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Client con la service role key: bypassa la RLS. Usare SOLO in codice
// server-only che gira senza una sessione utente (server action che
// deve creare account/ordini prima del login, webhook Stripe). Non
// importare mai in un componente client o in codice esposto al browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
