-- Warose Operations Hub — fundația (Etapa 1 + 2 + evidență stocuri)
-- Regula de bază: stocurile se calculează DOAR din stock_movements. Nu există coloană "stoc" editabilă.

CREATE TABLE locations (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('store','production','freezer','warehouse')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Cum apare o locație în sistemele externe (ex: Publine "MAGAZN SIBIU", SAGA "BRUTARIE").
CREATE TABLE location_aliases (
  id          serial PRIMARY KEY,
  source      text NOT NULL CHECK (source IN ('publine','saga')),
  alias       text NOT NULL,
  location_id integer REFERENCES locations(id),
  UNIQUE (source, alias)
);

CREATE TABLE users (
  id             serial PRIMARY KEY,
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('admin','production','location_manager','staff','accounting')),
  active         boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_locations (
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id integer NOT NULL REFERENCES locations(id),
  PRIMARY KEY (user_id, location_id)
);

CREATE TABLE products (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  unit        text NOT NULL DEFAULT 'buc',
  category    text NOT NULL DEFAULT 'merchandise'
              CHECK (category IN ('finished','raw','merchandise','packaging','service','other')),
  is_frozen   boolean NOT NULL DEFAULT false,
  sale_price  numeric(12,4),
  vat_rate    numeric(5,2),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Asocierea codurilor externe (Publine / SAGA) cu produsul din aplicație.
CREATE TABLE product_codes (
  id              serial PRIMARY KEY,
  source          text NOT NULL CHECK (source IN ('publine','saga')),
  code            text NOT NULL,
  name_in_source  text NOT NULL,
  product_id      integer REFERENCES products(id),
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, code)
);

CREATE TABLE sync_agents (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  location_id   integer NOT NULL REFERENCES locations(id),
  token_hash    text NOT NULL UNIQUE,
  active        boolean NOT NULL DEFAULT true,
  last_seen_at  timestamptz,
  last_upload_at timestamptz,
  last_status   text,
  agent_version text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_batches (
  id              serial PRIMARY KEY,
  source          text NOT NULL,           -- 'publine'
  kind            text NOT NULL,           -- 'sales_lines'
  file_name       text NOT NULL,
  file_sha256     text NOT NULL,
  storage_path    text NOT NULL,
  status          text NOT NULL CHECK (status IN ('processing','done','failed','duplicate')),
  default_location_id integer REFERENCES locations(id),
  rows_total      integer NOT NULL DEFAULT 0,
  rows_inserted   integer NOT NULL DEFAULT 0,
  rows_duplicate  integer NOT NULL DEFAULT 0,
  rows_error      integer NOT NULL DEFAULT 0,
  file_net_total   numeric(14,2),
  file_gross_total numeric(14,2),
  db_net_total     numeric(14,2),
  db_gross_total   numeric(14,2),
  reconciled      boolean,
  period_from     timestamp,
  period_to       timestamp,
  warnings        jsonb NOT NULL DEFAULT '[]',
  error           text,
  agent_id        integer REFERENCES sync_agents(id),
  user_id         integer REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE UNIQUE INDEX import_batches_unique_file
  ON import_batches (source, kind, file_sha256) WHERE status IN ('done','processing');

CREATE TABLE import_errors (
  id        serial PRIMARY KEY,
  batch_id  integer NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_no    integer,
  message   text NOT NULL,
  raw       jsonb
);

CREATE TABLE sales_lines (
  id              bigserial PRIMARY KEY,
  location_id     integer NOT NULL REFERENCES locations(id),
  sold_at         timestamp NOT NULL,      -- ora locală (Europe/Bucharest), ca în Publine
  sold_date       date NOT NULL,
  receipt_no      text,
  invoice_no      text,
  table_name      text,
  source_code     text,
  product_id      integer REFERENCES products(id),
  product_name    text NOT NULL,
  item_type       text,
  qty             numeric(14,3) NOT NULL,
  unit            text,
  unit_price      numeric(14,4),
  net             numeric(14,2) NOT NULL,
  vat             numeric(14,2) NOT NULL,
  gross           numeric(14,2) NOT NULL,
  vat_rate        numeric(5,2),
  payment_method  text,
  client          text,
  line_key        text NOT NULL UNIQUE,     -- previne importul dublu al aceleiași linii
  batch_id        integer NOT NULL REFERENCES import_batches(id)
);
CREATE INDEX sales_lines_loc_date ON sales_lines (location_id, sold_date);
CREATE INDEX sales_lines_product ON sales_lines (product_id, sold_date);
CREATE INDEX sales_lines_batch ON sales_lines (batch_id);

-- Registrul de mișcări: singura sursă pentru stocul operațional.
-- Mișcările nu se editează și nu se șterg; o corecție este o nouă mișcare (storno).
CREATE TABLE stock_movements (
  id           bigserial PRIMARY KEY,
  location_id  integer NOT NULL REFERENCES locations(id),
  product_id   integer NOT NULL REFERENCES products(id),
  qty          numeric(14,3) NOT NULL CHECK (qty <> 0),
  kind         text NOT NULL CHECK (kind IN
               ('receipt','production','consumption','transfer_out','transfer_in',
                'loss','adjustment','inventory','sale','reversal')),
  lot          text,
  produced_on  date,
  expires_on   date,
  counterpart_location_id integer REFERENCES locations(id),
  transfer_group uuid,
  document_ref text,
  note         text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  reverses_id  bigint REFERENCES stock_movements(id),
  created_by   integer NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_loc_prod ON stock_movements (location_id, product_id);

CREATE TABLE inventory_counts (
  id           serial PRIMARY KEY,
  location_id  integer NOT NULL REFERENCES locations(id),
  status       text NOT NULL CHECK (status IN ('open','closed','cancelled')) DEFAULT 'open',
  started_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  started_by   integer NOT NULL REFERENCES users(id),
  closed_by    integer REFERENCES users(id),
  note         text
);

CREATE TABLE inventory_count_lines (
  id           serial PRIMARY KEY,
  count_id     integer NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id   integer NOT NULL REFERENCES products(id),
  book_qty     numeric(14,3) NOT NULL,   -- stoc scriptic (operațional) la începutul inventarului
  counted_qty  numeric(14,3),            -- stoc faptic
  counted_by   integer REFERENCES users(id),
  counted_at   timestamptz,
  UNIQUE (count_id, product_id)
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    integer REFERENCES users(id),
  agent_id   integer REFERENCES sync_agents(id),
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  details    jsonb
);
CREATE INDEX audit_log_at ON audit_log (at DESC);

-- Date de bază
INSERT INTO locations (code, name, kind) VALUES
  ('SIBIU',      'Warose Bakery Sibiu',        'store'),
  ('ALBA',       'Warose Bakery Alba Iulia',   'store'),
  ('BRUTARIE',   'BRUTĂRIE',                   'production'),
  ('CONGELATOR', 'Depozit produse congelate',  'freezer');

INSERT INTO location_aliases (source, alias, location_id)
  SELECT 'publine', 'MAGAZN SIBIU', id FROM locations WHERE code = 'SIBIU';
INSERT INTO location_aliases (source, alias, location_id)
  SELECT 'saga', 'BRUTARIE', id FROM locations WHERE code = 'BRUTARIE';
