import { createClient } from "@/lib/supabase/server";

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("subscriptions")
    .select("current_period_end")
    .eq("user_id", userId)
    .eq("status", "attivo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ current_period_end: string | null }>();

  if (!data) return false;
  if (!data.current_period_end) return true;

  return new Date(data.current_period_end).getTime() > Date.now();
}
