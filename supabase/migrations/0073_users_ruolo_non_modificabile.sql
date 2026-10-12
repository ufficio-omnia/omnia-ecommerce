-- Il ruolo di un utente (public.users.role) non deve poter essere cambiato da
-- una sessione utente.
--
-- Problema (0001 + 0002): la policy "users_update_own" autorizza l'update della
-- propria riga (using auth.uid() = id) senza with check e senza limiti di
-- colonna, e 0002 dà "update" sull'INTERA tabella a authenticated. Una sessione
-- cliente poteva quindi eseguire update su public.users set role = 'admin' sulla
-- propria riga, e public.is_admin() (base di tutte le policy "admin" e di
-- requireAdmin) l'avrebbe riconosciuta come admin.
--
-- Nel codice l'unico update su public.users è l'anonimizzazione dell'email,
-- fatta con la service role (src/app/actions/admin.ts): nessuna funzione del
-- sito usa l'update con la sessione dell'utente, quindi chiuderlo non rompe nulla.
-- La promozione ad admin resta manuale, da SQL editor (dove auth.uid() è null).
--
-- Due livelli, entrambi idempotenti:
--  1. nessuna scrittura su public.users per anon/authenticated (resta il select,
--     già limitato alla propria riga o agli admin dalle policy), e la policy di
--     update viene tolta;
--  2. un trigger che rifiuta ogni cambio di ruolo fatto con una sessione utente
--     (auth.uid() valorizzato), anche se in futuro qualcuno riassegnasse per
--     errore il grant di update. La service role e il SQL editor hanno
--     auth.uid() nullo e non sono toccati.
--
-- Verifica prima/dopo: query di sola lettura nel messaggio che accompagna questa
-- migrazione (policy, grant di tabella e di colonna, elenco degli admin).

revoke insert, update, delete, truncate, references, trigger on public.users from anon, authenticated;

drop policy if exists "users_update_own" on public.users;

create or replace function public.users_blocca_cambio_ruolo()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'Il ruolo non è modificabile da una sessione utente'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists users_blocca_cambio_ruolo on public.users;

create trigger users_blocca_cambio_ruolo
  before update of role on public.users
  for each row execute function public.users_blocca_cambio_ruolo();
