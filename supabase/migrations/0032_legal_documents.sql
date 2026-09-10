-- Registro dei documenti legali versionati (Privacy policy, Cookie
-- policy, Condizioni generali di vendita). Ogni riga punta a un file
-- immutabile in legal/ (mai modificato dopo la pubblicazione: una
-- revisione è sempre un nuovo file con versione successiva) e ne
-- registra l'impronta SHA-256, per poter dimostrare esattamente quale
-- testo era in vigore quando un cliente ha accettato.

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (
    document_type in ('privacy_policy', 'cookie_policy', 'condizioni_vendita')
  ),
  version integer not null check (version > 0),
  effective_date date not null,
  file_path text not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  unique (document_type, version)
);

-- Il checkout cerca ad ogni caricamento la versione vigente per tipo di
-- documento (data di entrata in vigore più recente non successiva ad
-- oggi): senza questo indice la ricerca peggiora linearmente man mano
-- che le versioni si accumulano nel tempo.
create index idx_legal_documents_type_effective_date
  on public.legal_documents (document_type, effective_date desc);

alter table public.legal_documents enable row level security;

create policy "legal_documents_select_all" on public.legal_documents
  for select using (true);

-- Registro a sola aggiunta: una volta pubblicata, una riga non è più
-- né modificabile né cancellabile da nessuno (nemmeno da un admin). Se
-- l'impronta o il percorso di una versione già accettata potessero
-- essere corretti in silenzio, la prova raccolta in legal_acceptances
-- non varrebbe più nulla. Una revisione è sempre una riga NUOVA con
-- versione ed effective_date successivi, mai un update su una esistente.
create policy "legal_documents_insert_admin" on public.legal_documents
  for insert with check (public.is_admin());

-- grant di base (RLS non basta senza questi grant): niente update/delete
-- per authenticated, di proposito — coerente con la policy sopra.
grant select on public.legal_documents to anon;
grant select, insert on public.legal_documents to authenticated;
grant select, insert, update, delete on public.legal_documents to service_role;

-- Versione 1 dei tre documenti, pubblicata insieme a questa migrazione.
-- sha256 calcolato dal contenuto esatto dei file in legal/.
insert into public.legal_documents (document_type, version, effective_date, file_path, sha256)
values
  ('privacy_policy', 1, '2026-09-10', 'legal/privacy-policy-v1.md', 'f6861487e0bf2b03127b744ad200ee6d9281af4a9c06b990c68b07ea2869dfe2'),
  ('cookie_policy', 1, '2026-09-10', 'legal/cookie-policy-v1.md', 'f7a566a2e8b75da769a9d8a989c9e3265f23c491d4653d93eeb4f29b70af7f2d'),
  ('condizioni_vendita', 1, '2026-09-10', 'legal/condizioni-vendita-v1.md', '5070f4025d27d2382f8dac13e92268e2cf70937057278f0033dcfa8ff4c70f39');
