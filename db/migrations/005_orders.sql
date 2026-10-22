-- Etapa 5: comenzile locațiilor către BRUTĂRIE / depozitul de congelate și transferurile rezultate.
-- Flux: Ciornă → Trimisă → Confirmată → În pregătire → Expediată → Recepționată (sau Anulată).

CREATE TABLE location_orders (
  id               serial PRIMARY KEY,
  from_location_id integer NOT NULL REFERENCES locations(id),   -- locația care comandă (destinatarul mărfii)
  to_location_id   integer NOT NULL REFERENCES locations(id),   -- cine livrează (congelator / BRUTĂRIE)
  needed_for       date NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','submitted','confirmed','preparing','shipped','received','cancelled')),
  note             text,
  created_by       integer NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  submitted_at     timestamptz, submitted_by integer REFERENCES users(id),
  confirmed_at     timestamptz, confirmed_by integer REFERENCES users(id),
  shipped_at       timestamptz, shipped_by   integer REFERENCES users(id),
  received_at      timestamptz, received_by  integer REFERENCES users(id),
  cancelled_at     timestamptz, cancelled_by integer REFERENCES users(id),
  cancel_reason    text,
  transfer_group   uuid,
  CHECK (from_location_id <> to_location_id)
);
CREATE INDEX location_orders_status ON location_orders (status, needed_for);

-- Cantitățile se păstrează separat pe fiecare etapă, ca diferențele să rămână vizibile.
CREATE TABLE location_order_lines (
  id            serial PRIMARY KEY,
  order_id      integer NOT NULL REFERENCES location_orders(id) ON DELETE CASCADE,
  product_id    integer NOT NULL REFERENCES products(id),
  ordered_qty   numeric(14,3) NOT NULL CHECK (ordered_qty >= 0),
  confirmed_qty numeric(14,3) CHECK (confirmed_qty >= 0),
  shipped_qty   numeric(14,3) CHECK (shipped_qty >= 0),
  received_qty  numeric(14,3) CHECK (received_qty >= 0),
  note          text,
  UNIQUE (order_id, product_id)
);

-- Istoricul complet: schimbări de stare, modificări de cantități, comentarii.
CREATE TABLE location_order_events (
  id        bigserial PRIMARY KEY,
  order_id  integer NOT NULL REFERENCES location_orders(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   integer REFERENCES users(id),
  kind      text NOT NULL CHECK (kind IN ('status','change','comment')),
  status    text,
  message   text,
  details   jsonb
);
CREATE INDEX location_order_events_order ON location_order_events (order_id, at);

ALTER TABLE stock_movements ADD COLUMN location_order_id integer REFERENCES location_orders(id);
