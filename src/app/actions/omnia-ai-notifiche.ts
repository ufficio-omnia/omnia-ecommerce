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

// Il conteggio delle non lette non sta più qui: lo legge getStatoDashboard (omnia-ai-stato-sistema.ts) insieme allo
// stato delle gare, con un solo controllo della sessione.

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
