-- Relazione tecnica FINALE: segna, nel messaggio della chat che porta il file Word, quello composto con
-- «componi la relazione finale» (tutti i criteri riuniti in un unico documento), per distinguerlo dalle
-- bozze dei singoli criteri. Serve al pulsante «Richiedi revisione umana», che compare solo dopo la
-- relazione finale.
--
-- Da ora lo scrive la chat al momento della composizione. Per i messaggi già esistenti il segno si
-- ricava con un criterio prudente: un file Word generato dall'assistente, in una gara che ha sezioni
-- della relazione, il cui nome NON coincide con il titolo di nessuna sezione («<titolo sezione>.docx» è
-- il nome di una bozza) è una relazione finale. Una gara senza sezioni non viene toccata.
-- Idempotente: si può rieseguire.

alter table public.gara_messaggi
  add column if not exists relazione_finale boolean not null default false;

update public.gara_messaggi m
set relazione_finale = true
where m.relazione_finale = false
  and m.ruolo = 'assistente'
  and m.file_path is not null
  and exists (
    select 1 from public.gara_relazione_sezioni s where s.gara_id = m.gara_id
  )
  and not exists (
    select 1
    from public.gara_relazione_sezioni s
    where s.gara_id = m.gara_id
      and (s.titolo_sezione || '.docx') = m.file_nome
  );

-- per trovare in fretta l'ultima relazione finale di una gara
create index if not exists gara_messaggi_relazione_finale_idx
  on public.gara_messaggi (gara_id, created_at desc)
  where relazione_finale;
