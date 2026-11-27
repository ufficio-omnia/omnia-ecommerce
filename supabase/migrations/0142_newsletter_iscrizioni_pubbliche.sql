-- Newsletter «Tender Weekly», terza parte (27/11/2026): iscrizione pubblica da omnia-ai.it con doppia conferma,
-- provenienza degli iscritti, inserimenti manuali (singoli, elenchi, CSV), clienti acquisiti dagli abbonamenti.
--
-- Presuppone la 0141 (già sullo staging). Solo colonne e vincoli nuovi sulla tabella newsletter_iscritti; nessun dato
-- esistente cambia significato:
--   - stato «in_attesa»: iscrizione dal sito non ancora confermata dall'interessato. NON riceve nulla (gli invii
--     prendono solo «iscritto»);
--   - base giuridica «contratto_abbonamento»: cliente che ha accettato le Condizioni di abbonamento che includono
--     Tender Weekly tra i servizi informativi (versione 3 o successive: la prova cita l'accettazione registrata);
--   - provenienza, azienda, note, dati del consenso (testo, versione dell'informativa, impronta dell'IP, browser),
--     gettone e date della conferma.
-- Idempotente: si può rieseguire. Le righe esistenti restano «console».

alter table public.newsletter_iscritti add column if not exists provenienza text not null default 'console';
alter table public.newsletter_iscritti add column if not exists azienda text;
alter table public.newsletter_iscritti add column if not exists note_admin text;
alter table public.newsletter_iscritti add column if not exists consenso_testo text;
alter table public.newsletter_iscritti add column if not exists informativa_versione text;
alter table public.newsletter_iscritti add column if not exists consenso_ip_hash text;
alter table public.newsletter_iscritti add column if not exists consenso_user_agent text;
alter table public.newsletter_iscritti add column if not exists conferma_token text;
alter table public.newsletter_iscritti add column if not exists conferma_inviata_il timestamptz;
alter table public.newsletter_iscritti add column if not exists conferme_inviate integer not null default 0;
alter table public.newsletter_iscritti add column if not exists confermato_il timestamptz;

create unique index if not exists newsletter_iscritti_conferma_token_idx on public.newsletter_iscritti (conferma_token) where conferma_token is not null;
create index if not exists newsletter_iscritti_provenienza_idx on public.newsletter_iscritti (provenienza, stato);

alter table public.newsletter_iscritti drop constraint if exists newsletter_iscritti_provenienza_check;
alter table public.newsletter_iscritti add constraint newsletter_iscritti_provenienza_check
  check (provenienza in ('sito', 'console', 'importazione', 'abbonamento'));

-- stato: si aggiunge «in_attesa» (nome del vincolo creato dalla 0141 per la colonna stato)
alter table public.newsletter_iscritti drop constraint if exists newsletter_iscritti_stato_check;
alter table public.newsletter_iscritti add constraint newsletter_iscritti_stato_check
  check (stato in ('in_attesa', 'iscritto', 'disiscritto', 'rimbalzato', 'segnalato_spam'));

-- base giuridica: si aggiunge «contratto_abbonamento»
alter table public.newsletter_iscritti drop constraint if exists newsletter_iscritti_base_giuridica_check;
alter table public.newsletter_iscritti add constraint newsletter_iscritti_base_giuridica_check
  check (base_giuridica in ('consenso', 'soft_spam_art130', 'altro_documentato', 'contratto_abbonamento'));

-- un iscritto dal sito ha sempre il testo del consenso e la versione dell'informativa che ha visto
alter table public.newsletter_iscritti drop constraint if exists newsletter_iscritti_consenso_sito_check;
alter table public.newsletter_iscritti add constraint newsletter_iscritti_consenso_sito_check
  check (provenienza <> 'sito' or (consenso_testo is not null and informativa_versione is not null));

-- conferma: solo «in_attesa» ha un gettone di conferma aperto; chi è confermato dal sito ha la data
alter table public.newsletter_iscritti drop constraint if exists newsletter_iscritti_conferma_check;
alter table public.newsletter_iscritti add constraint newsletter_iscritti_conferma_check
  check ((stato = 'in_attesa') = (conferma_token is not null));
