-- 0115 — Tender Intelligence, fase B1-bis: più fonti nella STESSA gara (TED e PVL di ANAC), 16/11/2026.
--
-- Serve a tre cose chieste dal titolare:
--   1) la provenienza dei singoli dati: per ogni gruppo di campi della gara, quale fonte e quale avviso lo hanno dato
--      (radar_procedure.provenienza_campi, oggetto JSON con chiavi corte; vuoto per le gare importate prima);
--   2) l'abbinamento senza doppioni tra fonti: la procedura della fonte (PVL: idAppalto; TED: procedure-identifier) e il numero
--      dell'avviso TED citato da un'altra fonte (radar_procedure_fonti.id_procedura_fonte e rif_ted), con i loro indici;
--   3) nessun archivio separato: la PVL scrive nelle stesse tabelle di TED (la colonna «fonte» accetta già qualunque fonte).
--
-- ADDITIVA e idempotente: solo colonne nuove (con valore predefinito costante, nessuna riscrittura della tabella) e indici parziali.
-- Nessuna modifica ai permessi: le tabelle restano leggibili e scrivibili solo dal server (RLS senza regole, migrazione 0109).
-- Da eseguire SOLO sullo staging finché la PVL non è autorizzata in produzione.

alter table public.radar_procedure
  add column if not exists provenienza_campi jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'radar_procedure_provenienza_campi_oggetto') then
    alter table public.radar_procedure
      add constraint radar_procedure_provenienza_campi_oggetto check (jsonb_typeof(provenienza_campi) = 'object' and pg_column_size(provenienza_campi) <= 8000);
  end if;
end $$;

alter table public.radar_procedure_fonti
  add column if not exists id_procedura_fonte text check (id_procedura_fonte is null or char_length(id_procedura_fonte) between 1 and 200);

alter table public.radar_procedure_fonti
  add column if not exists rif_ted text check (rif_ted is null or rif_ted ~ '^[0-9]{1,8}-[0-9]{4}$');

create index if not exists radar_procedure_fonti_procedura_fonte_idx
  on public.radar_procedure_fonti (fonte, id_procedura_fonte) where id_procedura_fonte is not null;

create index if not exists radar_procedure_fonti_rif_ted_idx
  on public.radar_procedure_fonti (fonte, rif_ted) where rif_ted is not null;

-- la riga di stato della nuova fonte, SPENTA (si accende solo dalla console, e solo sullo staging: guardia nel codice)
insert into public.radar_fonti_stato (fonte, attiva) values ('pvl', false)
on conflict (fonte) do nothing;

notify pgrst, 'reload schema';
