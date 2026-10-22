-- Etapa 4: planul de dospire (congelator → decongelare → dospitor → cuptor → gata la ora stabilită).

-- Durate pe produs, în minute. „validated” = confirmate în practică; altfel orele sunt doar orientative.
CREATE TABLE product_proofing (
  product_id    integer PRIMARY KEY REFERENCES products(id),
  thaw_minutes  integer NOT NULL DEFAULT 0 CHECK (thaw_minutes >= 0),
  proof_minutes integer NOT NULL CHECK (proof_minutes > 0),
  bake_minutes  integer NOT NULL DEFAULT 0 CHECK (bake_minutes >= 0),
  validated     boolean NOT NULL DEFAULT false,
  note          text,
  updated_by    integer REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Setări pe locație: ora la care produsele trebuie să fie gata și capacitatea dospitorului (bucăți).
CREATE TABLE proofing_settings (
  location_id integer PRIMARY KEY REFERENCES locations(id),
  ready_time  time NOT NULL DEFAULT '05:00',
  capacity    integer CHECK (capacity > 0),
  updated_by  integer REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Un plan pe locație și dimineață. Ciornă → Confirmat (duratele se fixează) → sarcini bifate de personal.
CREATE TABLE proofing_plans (
  id           serial PRIMARY KEY,
  location_id  integer NOT NULL REFERENCES locations(id),
  plan_date    date NOT NULL,          -- dimineața în care produsele trebuie să fie gata
  ready_time   time NOT NULL,
  status       text NOT NULL CHECK (status IN ('draft','confirmed','cancelled')) DEFAULT 'draft',
  note         text,
  created_by   integer NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_by integer REFERENCES users(id),
  confirmed_at timestamptz
);
CREATE UNIQUE INDEX proofing_plans_one_per_day ON proofing_plans (location_id, plan_date) WHERE status <> 'cancelled';

CREATE TABLE proofing_items (
  id            serial PRIMARY KEY,
  plan_id       integer NOT NULL REFERENCES proofing_plans(id) ON DELETE CASCADE,
  product_id    integer NOT NULL REFERENCES products(id),
  qty           numeric(14,3) NOT NULL CHECK (qty > 0),
  suggested_qty numeric(14,3),
  -- duratele folosite, fixate la confirmare
  thaw_minutes  integer,
  proof_minutes integer,
  bake_minutes  integer,
  thaw_done_at  timestamptz, thaw_done_by  integer REFERENCES users(id),
  proof_done_at timestamptz, proof_done_by integer REFERENCES users(id),
  bake_done_at  timestamptz, bake_done_by  integer REFERENCES users(id),
  UNIQUE (plan_id, product_id)
);
