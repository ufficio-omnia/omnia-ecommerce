"use server";

import { createClient } from "@/lib/supabase/server";

export type NotificaRow = {
  id: string;
  tipo: string;
  gara_id: string | null;
  titolo: string;
  corpo: string;
  letta: boolean;
  created_at: string;
};

const LIMITE_RECENTI = 20;

export async function getNotificheRecenti(): Promise<NotificaRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data } = await supabase
    .from("omnia_ai_notifiche")
    .select("id, tipo, gara_id, titolo, corpo, letta, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMITE_RECENTI)
    .returns<NotificaRow[]>();

  return data ?? [];
}

export async function getConteggioNonLette(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return 0;

  const { count } = await supabase
    .from("omnia_ai_notifiche")
    .select("id", { count: "exact", head: true })
    .eq("letta", false);

  return count ?? 0;
}

export async function segnaLetta(id: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  await supabase.from("omnia_ai_notifiche").update({ letta: true }).eq("id", id);
}

export async function segnaTutteLette(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  await supabase.from("omnia_ai_notifiche").update({ letta: true }).eq("letta", false);
}
