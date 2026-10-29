-- Proroga dei termini di presentazione dell'offerta.
--
-- L'analisi dei documenti ora riconosce una proroga dei termini di presentazione e prende come scadenza della gara quella
-- della proroga. Se la proroga c'è ma i documenti non riportano la nuova data (rimandano al portale, per esempio), e SOLO
-- allora, il cliente può cambiare a mano la scadenza. Tre colonne nuove in public.gare:
--
--   proroga_stato        'nessuna' | 'con_nuova_data' | 'senza_nuova_data'; vuoto = gara non ancora analizzata con la proroga
--   scadenza_originaria  la data del bando prima della proroga (solo se la proroga c'è e i documenti la riportano)
--   scadenza_manuale     vero se la scadenza l'ha inserita il cliente a mano (la nuova analisi la conserva finché la proroga
--                        resta senza data)
--
-- Additiva e idempotente: si può rieseguire e non tocca nessun dato esistente. Prima di questa migrazione l'analisi e la scheda
-- della gara funzionano come sempre (il codice tollera la mancanza delle colonne) e la scadenza a mano non c'è. Le regole di
-- accesso della tabella (gare_all_own) valgono anche per le colonne nuove.

alter table public.gare
  add column if not exists proroga_stato text;

alter table public.gare
  add column if not exists scadenza_originaria date;

alter table public.gare
  add column if not exists scadenza_manuale boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gare_proroga_stato_valori' and conrelid = 'public.gare'::regclass
  ) then
    alter table public.gare
      add constraint gare_proroga_stato_valori
      check (proroga_stato is null or proroga_stato in ('nessuna', 'con_nuova_data', 'senza_nuova_data'));
  end if;
end
$$;

notify pgrst, 'reload schema';
