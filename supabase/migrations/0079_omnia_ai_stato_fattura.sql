-- Stato di fatturazione degli incassi OMNIA AI e degli acquisti di crediti.
--
-- PERCHÉ. Le ricevute di Stripe non sono fatture elettroniche italiane: ogni
-- incasso (primo pagamento, rinnovo, conguaglio) e ogni acquisto di crediti va
-- fatturato a parte, con un altro strumento. Questa migrazione dà a ogni riga uno
-- stato che l'admin segna a mano dalla console, così si vede sempre cosa è ancora
-- da fatturare e cosa è già stato fatto, con numero e data della fattura.
--
-- STATI. 'da_fatturare' (predefinito), 'fatturata' (con numero e data della fattura
-- emessa), 'non_dovuta' (nessuna fattura da emettere: pagamento di prova, duplicato,
-- storno; la nota dice perché). Chi ha aggiornato e quando si registra a ogni
-- cambio (fatturazione_aggiornata_il / _da, senza chiave esterna: vedi 0076).
--
-- PAGAMENTI DI PROVA. Un pagamento di prova (Stripe in modalità test) non va mai
-- fatturato. Le righe esistenti di prova, e quelle che arriveranno, nascono già
-- 'non_dovuta' con una nota: lo fa un trigger sull'inserimento, quindi il webhook
-- e il backfill non hanno bisogno di conoscere queste colonne (e continuano a
-- funzionare anche se questa migrazione non è ancora stata eseguita). Una riga di
-- prova si riconosce da livemode = false (incassi) o dalla sessione Stripe che
-- comincia per "cs_test_" (crediti).
--
-- PERMESSI. omnia_ai_credit_purchases è un registro a sola aggiunta: il service role
-- ha solo select e insert, di proposito, perché importi e crediti non si modificano.
-- Qui si concede update SOLO sulle colonne di fatturazione: gli importi restano
-- immutabili. omnia_ai_incassi ha già update per il service role.
--
-- Idempotente: colonne con IF NOT EXISTS, funzioni con CREATE OR REPLACE, trigger
-- ricreati, il backfill tocca solo righe ancora 'da_fatturare'.

alter table public.omnia_ai_incassi
  add column if not exists stato_fattura text not null default 'da_fatturare'
    check (stato_fattura in ('da_fatturare', 'fatturata', 'non_dovuta')),
  add column if not exists numero_fattura text,
  add column if not exists data_fattura date,
  add column if not exists note_fattura text,
  add column if not exists fatturazione_aggiornata_il timestamptz,
  add column if not exists fatturazione_aggiornata_da uuid;

alter table public.omnia_ai_credit_purchases
  add column if not exists stato_fattura text not null default 'da_fatturare'
    check (stato_fattura in ('da_fatturare', 'fatturata', 'non_dovuta')),
  add column if not exists numero_fattura text,
  add column if not exists data_fattura date,
  add column if not exists note_fattura text,
  add column if not exists fatturazione_aggiornata_il timestamptz,
  add column if not exists fatturazione_aggiornata_da uuid;

create index if not exists omnia_ai_incassi_stato_fattura_idx on public.omnia_ai_incassi (stato_fattura);
create index if not exists omnia_ai_credit_purchases_stato_fattura_idx on public.omnia_ai_credit_purchases (stato_fattura);

-- Solo le colonne di fatturazione: importi, crediti e sessione Stripe restano immutabili.
grant update (stato_fattura, numero_fattura, data_fattura, note_fattura, fatturazione_aggiornata_il, fatturazione_aggiornata_da)
  on public.omnia_ai_credit_purchases to service_role;

-- Un pagamento di prova non è mai da fatturare.
create or replace function public.omnia_ai_incasso_di_prova_non_dovuto()
returns trigger
language plpgsql
as $$
begin
  if new.livemode is false and new.stato_fattura = 'da_fatturare' then
    new.stato_fattura := 'non_dovuta';
    new.note_fattura := coalesce(new.note_fattura, 'Pagamento di prova (Stripe in modalità test): nessuna fattura da emettere');
  end if;
  return new;
end;
$$;

create or replace function public.omnia_ai_acquisto_crediti_di_prova_non_dovuto()
returns trigger
language plpgsql
as $$
begin
  if starts_with(new.stripe_session_id, 'cs_test_') and new.stato_fattura = 'da_fatturare' then
    new.stato_fattura := 'non_dovuta';
    new.note_fattura := coalesce(new.note_fattura, 'Pagamento di prova (Stripe in modalità test): nessuna fattura da emettere');
  end if;
  return new;
end;
$$;

drop trigger if exists omnia_ai_incassi_prova_non_dovuto on public.omnia_ai_incassi;
create trigger omnia_ai_incassi_prova_non_dovuto
  before insert on public.omnia_ai_incassi
  for each row execute function public.omnia_ai_incasso_di_prova_non_dovuto();

drop trigger if exists omnia_ai_credit_purchases_prova_non_dovuto on public.omnia_ai_credit_purchases;
create trigger omnia_ai_credit_purchases_prova_non_dovuto
  before insert on public.omnia_ai_credit_purchases
  for each row execute function public.omnia_ai_acquisto_crediti_di_prova_non_dovuto();

-- Righe di prova già presenti.
update public.omnia_ai_incassi
set stato_fattura = 'non_dovuta',
    note_fattura = coalesce(note_fattura, 'Pagamento di prova (Stripe in modalità test): nessuna fattura da emettere')
where livemode = false
  and stato_fattura = 'da_fatturare';

update public.omnia_ai_credit_purchases
set stato_fattura = 'non_dovuta',
    note_fattura = coalesce(note_fattura, 'Pagamento di prova (Stripe in modalità test): nessuna fattura da emettere')
where starts_with(stripe_session_id, 'cs_test_')
  and stato_fattura = 'da_fatturare';

notify pgrst, 'reload schema';
