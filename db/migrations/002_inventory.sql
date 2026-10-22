-- Etapa 3: inventar digital + scăderea vânzărilor din stoc.

-- Produsele cu stoc gestionat: vânzările importate din Publine scad automat din stocul locației.
ALTER TABLE products ADD COLUMN track_stock boolean NOT NULL DEFAULT false;

-- Mișcările generate de import nu au un utilizator; au în schimb importul sursă.
ALTER TABLE stock_movements ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE stock_movements ADD COLUMN source_batch_id integer REFERENCES import_batches(id);
ALTER TABLE stock_movements ADD COLUMN inventory_count_id integer REFERENCES inventory_counts(id);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_has_origin
  CHECK (created_by IS NOT NULL OR source_batch_id IS NOT NULL);

-- Momentul la care se referă inventarul (ex: aseară la închidere), poate diferi de momentul deschiderii în aplicație.
ALTER TABLE inventory_counts ADD COLUMN as_of timestamptz NOT NULL DEFAULT now();
ALTER TABLE inventory_counts ADD COLUMN posted_value numeric(14,2);
ALTER TABLE inventory_counts ADD COLUMN uncounted_as_zero boolean;
CREATE UNIQUE INDEX inventory_one_open_per_location ON inventory_counts (location_id) WHERE status = 'open';

-- Prețul unitar folosit la valorizarea diferențelor (prețul de vânzare cu TVA din Publine, la data inventarului).
ALTER TABLE inventory_count_lines ADD COLUMN unit_value numeric(14,4);
