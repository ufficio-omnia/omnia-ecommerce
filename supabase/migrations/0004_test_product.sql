-- Fase 2A — prodotto di test per collaudare l'intero flusso di
-- checkout (carta e bonifico) end-to-end

insert into public.products (title, description, price, category, file_path)
values (
  'Facsimile Progetto Pulizie',
  'Documento di prova per testare il flusso di acquisto, pagamento e download.',
  9.90,
  'facsimile',
  'FAC-SIMILE-PROGETTOPULIZIE.pdf'
);
