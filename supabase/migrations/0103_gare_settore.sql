-- Settore della gara: di cosa tratta.
--
-- L'analisi dei documenti ora decide anche di cosa tratta la gara, e la scheda propone di conseguenza il servizio aggiuntivo giusto oltre alla
-- relazione tecnica: le gare di pulizia il piano di lavoro in Excel, le gare di ristorazione collettiva «OMNIA FOOD MENU» (per ora «sta
-- arrivando»), le altre gare per ora nulla. Una colonna nuova in public.gare:
--
--   settore   'pulizie' | 'ristorazione_collettiva' | 'altro'; vuoto = gara non ancora classificata (analizzata prima di questa funzione)
--
-- Le gare già analizzate restano vuote e si comportano come prima (la scheda continua a proporre il piano di lavoro): il settore si
-- assegna alla prossima analisi dei documenti («Rianalizza documenti»), e da lì in poi vale quello che dicono i documenti.
--
-- Additiva e idempotente: si può rieseguire e non tocca nessun dato esistente. Prima di questa migrazione l'analisi e la scheda della gara
-- funzionano come sempre (il codice tollera la mancanza della colonna). Le regole di accesso della tabella (gare_all_own) valgono anche per
-- la colonna nuova.

alter table public.gare
  add column if not exists settore text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gare_settore_valori' and conrelid = 'public.gare'::regclass
  ) then
    alter table public.gare
      add constraint gare_settore_valori
      check (settore is null or settore in ('pulizie', 'ristorazione_collettiva', 'altro'));
  end if;
end
$$;

notify pgrst, 'reload schema';
