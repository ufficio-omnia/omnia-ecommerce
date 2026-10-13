-- Fatture dell'abbonamento OMNIA AI scaricabili dal cliente.
--
-- 1) Il PDF della fattura si carica dalla console sul singolo pagamento (un incasso
--    di abbonamento o un acquisto di crediti): due colonne per il percorso del file
--    nel bucket privato «invoices» (lo stesso delle fatture dell'e-commerce, sotto il
--    prefisso omnia-ai/) e per il momento del primo caricamento.
--
-- 2) Il cliente legge i propri pagamenti dalla pagina «Pagamenti e fatture» con la sua
--    sessione. Gli incassi finora erano leggibili solo dalla chiave di servizio: si
--    aggiunge la policy «solo le mie righe» e si concedono SOLO le colonne che il
--    cliente deve vedere. Restano fuori l'istantanea dei dati del cliente su Stripe,
--    gli identificativi Stripe, le note interne di fatturazione e chi/quando le ha
--    modificate: sono dati di lavoro dell'amministrazione, non del cliente.
--
-- 3) Stessa cosa per gli acquisti di crediti, che avevano una lettura completa:
--    dopo la 0079 la tabella contiene anche note interne di fatturazione, che un
--    cliente avrebbe potuto leggere interrogando direttamente l'API con la sua
--    sessione. Si ritira la lettura dell'intera tabella e si concedono le sole colonne
--    che la sua area riservata usa. Nessun codice dell'applicazione legge altre colonne
--    con la sessione del cliente (verificato).
--
-- I file non diventano raggiungibili da nessun indirizzo: il bucket resta privato e il
-- download passa sempre da un collegamento firmato di 60 secondi, generato dal server
-- dopo aver verificato che il pagamento sia del cliente che lo chiede.
--
-- Tutta idempotente. Può essere eseguita prima o dopo il deploy: il codice nuovo ripiega
-- se mancano le colonne, e quello vecchio non usa nulla di ciò che qui cambia.

alter table public.omnia_ai_incassi
  add column if not exists fattura_file_path text,
  add column if not exists fattura_caricata_il timestamptz;

alter table public.omnia_ai_credit_purchases
  add column if not exists fattura_file_path text,
  add column if not exists fattura_caricata_il timestamptz;

-- La 0079 concede l'update sui soli campi di fatturazione degli acquisti di crediti
-- (gli importi sono immutabili): si aggiungono i due nuovi. Sugli incassi la chiave di
-- servizio ha già l'update sull'intera tabella (0078).
grant update (fattura_file_path, fattura_caricata_il) on public.omnia_ai_credit_purchases to service_role;

-- ───── Incassi: il cliente legge i propri, solo alcune colonne ─────

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'omnia_ai_incassi' and policyname = 'omnia_ai_incassi_select_own'
  ) then
    create policy "omnia_ai_incassi_select_own" on public.omnia_ai_incassi
      for select using (user_id = auth.uid());
  end if;
end
$$;

grant select (
  id, user_id, tipo, importo_lordo_centesimi, pagato_il, livemode,
  numero_ricevuta, ricevuta_url, stripe_subscription_id,
  stato_fattura, numero_fattura, data_fattura, fattura_file_path
) on public.omnia_ai_incassi to authenticated;

-- ───── Acquisti di crediti: da lettura completa a sole colonne ─────

revoke select on public.omnia_ai_credit_purchases from authenticated;

grant select (
  id, user_id, pacchetto, crediti, importo_centesimi, created_at,
  stato_fattura, numero_fattura, data_fattura, fattura_file_path
) on public.omnia_ai_credit_purchases to authenticated;
