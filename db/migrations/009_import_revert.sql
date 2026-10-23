-- Anularea unui import de vânzări: liniile lui se scot din vânzări, mișcările de stoc se stornează,
-- iar fișierul și istoricul importului rămân (stare „reverted”). Fișierul poate fi reimportat ulterior.
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_status_check
  CHECK (status IN ('processing','done','failed','duplicate','reverted'));
ALTER TABLE import_batches ADD COLUMN reverted_at timestamptz;
ALTER TABLE import_batches ADD COLUMN reverted_by integer REFERENCES users(id);
