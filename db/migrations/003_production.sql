-- Etapa 4: rețete, plan de producție, consum de materii prime, documente pentru SAGA C.

-- Cost unitar de achiziție (introdus manual până la modulul de facturi, Etapa 6).
ALTER TABLE products ADD COLUMN cost_price numeric(14,4);
ALTER TABLE products ADD COLUMN cost_updated_at timestamptz;

-- Rețetele sunt versionate: o modificare creează o versiune nouă, iar documentele vechi rămân legate de versiunea folosită.
CREATE TABLE recipes (
  id          serial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id),
  version     integer NOT NULL,
  yield_qty   numeric(14,3) NOT NULL CHECK (yield_qty > 0),   -- câte unități de produs finit rezultă din cantitățile de mai jos
  active      boolean NOT NULL DEFAULT true,
  note        text,
  created_by  integer NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, version)
);
CREATE UNIQUE INDEX recipes_one_active ON recipes (product_id) WHERE active;

CREATE TABLE recipe_items (
  id             serial PRIMARY KEY,
  recipe_id      integer NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id  integer NOT NULL REFERENCES products(id),
  qty            numeric(14,4) NOT NULL CHECK (qty > 0),        -- în unitatea ingredientului, pentru yield_qty
  UNIQUE (recipe_id, ingredient_id)
);

-- Documentul de producție: Planificat → Înregistrat (cantități reale) → Aprobat (intră în stoc) → Înregistrat în SAGA.
CREATE TABLE production_orders (
  id              serial PRIMARY KEY,
  location_id     integer NOT NULL REFERENCES locations(id),
  freezer_location_id integer REFERENCES locations(id),
  planned_for     date NOT NULL,
  status          text NOT NULL CHECK (status IN ('planned','recorded','approved','cancelled')) DEFAULT 'planned',
  note            text,
  created_by      integer NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  recorded_by     integer REFERENCES users(id),
  recorded_at     timestamptz,
  approved_by     integer REFERENCES users(id),
  approved_at     timestamptz,
  saga_doc_no     text,
  saga_registered_at timestamptz,
  saga_registered_by integer REFERENCES users(id)
);

CREATE TABLE production_lines (
  id             serial PRIMARY KEY,
  order_id       integer NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  product_id     integer NOT NULL REFERENCES products(id),
  recipe_id      integer REFERENCES recipes(id),
  planned_qty    numeric(14,3) NOT NULL CHECK (planned_qty >= 0),
  produced_qty   numeric(14,3) CHECK (produced_qty >= 0),
  to_freezer_qty numeric(14,3) CHECK (to_freezer_qty >= 0),
  scrap_qty      numeric(14,3) CHECK (scrap_qty >= 0),
  expires_on     date,
  UNIQUE (order_id, product_id)
);

-- Consumul pe document: teoretic (din rețetă × cantitatea produsă) și, opțional, efectiv.
CREATE TABLE production_consumption (
  id               serial PRIMARY KEY,
  order_id         integer NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  ingredient_id    integer NOT NULL REFERENCES products(id),
  theoretical_qty  numeric(14,4) NOT NULL,
  actual_qty       numeric(14,4),
  unit_cost        numeric(14,4),
  UNIQUE (order_id, ingredient_id)
);

ALTER TABLE stock_movements ADD COLUMN production_order_id integer REFERENCES production_orders(id);

-- Raportul SAGA „Situația producției”, importat pentru asocierea codurilor și compararea cu aplicația.
CREATE TABLE saga_production_lines (
  id          bigserial PRIMARY KEY,
  batch_id    integer NOT NULL REFERENCES import_batches(id),
  gestiune    text,
  doc_date    date NOT NULL,
  doc_no      text,
  code        text NOT NULL,
  name        text NOT NULL,
  unit        text,
  qty         numeric(14,3) NOT NULL,
  unit_price  numeric(14,4),
  value       numeric(14,2),
  line_key    text NOT NULL UNIQUE
);
CREATE INDEX saga_production_lines_date ON saga_production_lines (doc_date);
