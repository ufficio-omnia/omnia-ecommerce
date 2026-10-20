-- Presenza degli utenti nell'area riservata di OMNIA AI: chi è collegato adesso, se sta lavorando o è fermo,
-- in quale sezione, e quando è uscito premendo «Esci».
--
-- Una riga per utente (l'ultimo stato, non uno storico): l'area riservata manda un piccolo segnale ogni ~45
-- secondi finché la scheda è aperta e visibile (e dice solo se l'utente ha mosso il mouse, scritto o scorso nell'ultimo
-- minuto), la console legge la riga. Si registrano SOLO orari e il NOME della sezione (mai l'indirizzo preciso, mai
-- l'identificativo o il titolo di una gara, mai contenuti). Vale anche per l'Ufficio Gare: ha la sua riga, come utente
-- a sé. Si cancella con l'utente.
--
--   ultimo_segnale  l'ultimo segnale ricevuto (online se è di meno di ~2,5 minuti fa)
--   ultima_attivita l'ultima volta in cui il segnale diceva «sta usando la pagina» (distingue attivo da fermo)
--   sezione         la sezione dell'area riservata (dashboard, gare, abbonamento…): solo parole di un elenco fisso
--   ingresso_il     da quando dura la visita in corso (si riparte dopo 10 minuti di silenzio o dopo un'uscita)
--   uscita_il       l'ultima uscita con «Esci» (se chiude solo la scheda, vale l'ultimo segnale)
--
-- Nessun permesso ai ruoli utente: il segnale lo scrive il server (chiave di servizio) per l'utente della sessione, la
-- console lo legge con la chiave di servizio. Migrazione ADDITIVA e idempotente: prima di eseguirla la presenza
-- semplicemente non esiste (il segnale viene ignorato, la console dice che non è attiva).

create table if not exists public.omnia_ai_presenza (
  user_id uuid primary key references public.users (id) on delete cascade,
  ultimo_segnale timestamptz not null default now(),
  ultima_attivita timestamptz,
  sezione text check (sezione is null or char_length(sezione) <= 40),
  ingresso_il timestamptz not null default now(),
  uscita_il timestamptz
);

-- per la console: chi ha dato un segnale di recente
create index if not exists omnia_ai_presenza_segnale_idx on public.omnia_ai_presenza (ultimo_segnale desc);

alter table public.omnia_ai_presenza enable row level security;

revoke all on public.omnia_ai_presenza from anon, authenticated;
grant select, insert, update on public.omnia_ai_presenza to service_role;

-- Un segnale. Un'unica istruzione (nessuna lettura-poi-scrittura): ingresso_il riparte dopo 10 minuti di silenzio o dopo
-- un'uscita; ultima_attivita avanza solo se il segnale dice «attivo». Entro 15 secondi da un'uscita con «Esci» il segnale
-- si ignora: un battito partito un attimo prima dell'uscita non deve far risultare collegato chi è appena uscito.
create or replace function public.omnia_ai_presenza_segnale(p_user uuid, p_attivo boolean, p_sezione text)
returns void
language sql
as $$
  insert into public.omnia_ai_presenza as p (user_id, ultimo_segnale, ultima_attivita, sezione, ingresso_il)
  values (p_user, now(), case when p_attivo then now() end, left(p_sezione, 40), now())
  on conflict (user_id) do update set
    ingresso_il = case
      when p.ultimo_segnale < now() - interval '10 minutes' then now()
      when p.uscita_il is not null and p.uscita_il >= p.ultimo_segnale then now()
      else p.ingresso_il
    end,
    ultimo_segnale = now(),
    ultima_attivita = case when p_attivo then now() else p.ultima_attivita end,
    sezione = left(p_sezione, 40)
  where p.uscita_il is null or p.uscita_il <= now() - interval '15 seconds';
$$;

-- L'uscita con «Esci»: solo se l'utente ha già una riga (chi non è mai stato tracciato resta com'è).
create or replace function public.omnia_ai_presenza_uscita(p_user uuid)
returns void
language sql
as $$
  update public.omnia_ai_presenza set uscita_il = now() where user_id = p_user;
$$;

revoke all on function public.omnia_ai_presenza_segnale(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.omnia_ai_presenza_uscita(uuid) from public, anon, authenticated;
grant execute on function public.omnia_ai_presenza_segnale(uuid, boolean, text) to service_role;
grant execute on function public.omnia_ai_presenza_uscita(uuid) to service_role;
