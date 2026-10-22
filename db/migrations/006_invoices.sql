-- Etapa 6: facturi furnizori, recepții, costuri alocate pe locații, istoric prețuri.

CREATE TABLE app_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
INSERT INTO app_settings (key, value) VALUES ('company_cif', '"RO40177983"'), ('eur_rate', '4.93');

-- Categoriile din „Raport Costuri – Venituri”, folosit pentru planul de business.
CREATE TABLE expense_categories (
  id     serial PRIMARY KEY,
  name   text NOT NULL UNIQUE,
  sort   integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO expense_categories (name, sort) VALUES
  ('Materii Prime', 10), ('Consumabile', 20), ('Salarii', 30), ('Chirie', 40), ('Utilitati', 50),
  ('Servicii', 60), ('Combustibil', 70), ('Servicii Auto', 80), ('Reparatii', 90), ('Reclame', 100),
  ('Distributie', 110), ('Protocol', 120), ('Discount', 130), ('Amortizari', 140), ('Cheltuieli Bancare', 150), ('Alte cheltuieli', 900);

-- Reguli de alocare: o locație sau procente pe mai multe locații. splits = [{"location_id": 1, "pct": 50}, ...]
CREATE TABLE allocation_rules (
  id     serial PRIMARY KEY,
  name   text NOT NULL UNIQUE,
  splits jsonb NOT NULL
);

CREATE TABLE suppliers (
  id                  serial PRIMARY KEY,
  name                text NOT NULL,
  cif                 text UNIQUE,
  default_category_id integer REFERENCES expense_categories(id),
  default_rule_id     integer REFERENCES allocation_rules(id),
  default_location_id integer REFERENCES locations(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id                  serial PRIMARY KEY,
  supplier_id         integer NOT NULL REFERENCES suppliers(id),
  number              text NOT NULL,
  issue_date          date NOT NULL,
  due_date            date,
  currency            text NOT NULL DEFAULT 'RON',
  total_net           numeric(14,2) NOT NULL,
  total_vat           numeric(14,2) NOT NULL,
  total_gross         numeric(14,2) NOT NULL,
  is_credit_note      boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified','cancelled')),
  source              text NOT NULL CHECK (source IN ('manual','efactura')),
  file_path           text,
  file_name           text,
  file_sha256         text,
  pdf_path            text,
  category_id         integer REFERENCES expense_categories(id),
  rule_id             integer REFERENCES allocation_rules(id),
  allocation_location_id integer REFERENCES locations(id),
  receipt_location_id integer REFERENCES locations(id),
  note                text,
  created_by          integer REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  verified_by         integer REFERENCES users(id),
  verified_at         timestamptz,
  saga_registered_at  timestamptz,
  saga_registered_by  integer REFERENCES users(id),
  saga_note           text
);
-- O factură nu poate fi înregistrată de două ori: același furnizor, număr și dată.
CREATE UNIQUE INDEX invoices_unique_doc ON invoices (supplier_id, upper(number), issue_date) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX invoices_unique_file ON invoices (file_sha256) WHERE file_sha256 IS NOT NULL AND status <> 'cancelled';

CREATE TABLE invoice_lines (
  id            serial PRIMARY KEY,
  invoice_id    integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no       integer NOT NULL,
  description   text NOT NULL,
  supplier_code text,
  qty           numeric(14,4) NOT NULL,
  unit          text,
  unit_price    numeric(14,4),
  net           numeric(14,2) NOT NULL,
  vat_rate      numeric(5,2),
  vat           numeric(14,2) NOT NULL DEFAULT 0,
  product_id    integer REFERENCES products(id),
  factor        numeric(14,4) NOT NULL DEFAULT 1 CHECK (factor > 0),  -- unități de bază (ex: kg) per unitate de pe factură (ex: sac)
  category_id   integer REFERENCES expense_categories(id),
  to_stock      boolean NOT NULL DEFAULT false
);

-- Memoria asocierilor: o dată asociat, același articol al furnizorului se recunoaște automat.
CREATE TABLE supplier_item_map (
  id          serial PRIMARY KEY,
  supplier_id integer NOT NULL REFERENCES suppliers(id),
  item_key    text NOT NULL,
  product_id  integer REFERENCES products(id),
  factor      numeric(14,4) NOT NULL DEFAULT 1,
  category_id integer REFERENCES expense_categories(id),
  UNIQUE (supplier_id, item_key)
);

-- Registrul de costuri: din facturi (alocate) sau introduse manual (salarii, chirie, amortizări).
CREATE TABLE cost_entries (
  id           bigserial PRIMARY KEY,
  entry_date   date NOT NULL,
  location_id  integer NOT NULL REFERENCES locations(id),
  category_id  integer NOT NULL REFERENCES expense_categories(id),
  amount_net   numeric(14,2) NOT NULL,
  supplier     text,
  description  text,
  source       text NOT NULL CHECK (source IN ('invoice','manual')),
  invoice_id   integer REFERENCES invoices(id),
  created_by   integer REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cost_entries_month ON cost_entries (entry_date, location_id);

CREATE TABLE price_history (
  id          bigserial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id),
  supplier_id integer REFERENCES suppliers(id),
  invoice_id  integer REFERENCES invoices(id) ON DELETE CASCADE,
  price_date  date NOT NULL,
  unit_cost   numeric(14,4) NOT NULL   -- lei fără TVA per unitatea de bază a produsului
);
CREATE INDEX price_history_product ON price_history (product_id, price_date DESC);

ALTER TABLE stock_movements ADD COLUMN invoice_id integer REFERENCES invoices(id);
