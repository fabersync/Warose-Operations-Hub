-- Agentul v2 (Publine + e-Factura din SAGA), reduceri pe facturi, comenzi către furnizori, stocuri țintă.

-- CIF-ul firmei verificat în facturile e-Factura din SAGA: DAVID WAROSE S.R.L. = RO40177983.
-- Valoarea implicită anterioară (RO51050712) era greșită; se corectează doar dacă nu a fost schimbată manual.
UPDATE app_settings SET value = '"RO40177983"' WHERE key = 'company_cif' AND value = '"RO51050712"';

-- Starea raportată de agent la fiecare rulare (versiune, coadă, erori, surse).
ALTER TABLE sync_agents ADD COLUMN status jsonb;

-- e-Factura: identificatorul stabil din SPV (indexul de descărcare din numele fișierului SAGA) și agentul care a trimis factura.
ALTER TABLE invoices ADD COLUMN spv_index text;
ALTER TABLE invoices ADD COLUMN agent_id integer REFERENCES sync_agents(id);
ALTER TABLE invoices ADD COLUMN prepaid numeric(14,2);
CREATE UNIQUE INDEX invoices_unique_spv ON invoices (spv_index) WHERE spv_index IS NOT NULL AND status <> 'cancelled';

-- Reduceri pe linie (preț brut înainte de reducere și valoarea reducerii), ca în facturile Metro.
ALTER TABLE invoice_lines ADD COLUMN gross_unit_price numeric(14,4);
ALTER TABLE invoice_lines ADD COLUMN discount numeric(14,2);

-- Stocuri țintă pe locație: sub minim se propune comandă până la nivelul țintă.
CREATE TABLE stock_targets (
  location_id integer NOT NULL REFERENCES locations(id),
  product_id  integer NOT NULL REFERENCES products(id),
  min_qty     numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  target_qty  numeric(14,3) NOT NULL CHECK (target_qty >= 0),
  PRIMARY KEY (location_id, product_id)
);

-- Comenzi către furnizori (Metro, distribuitori) pentru Sibiu, Alba Iulia și BRUTĂRIE.
-- Recepția în stoc se face prin factură (o singură sursă pentru stoc); comanda se leagă de factură pentru comparație.
CREATE TABLE purchase_orders (
  id            serial PRIMARY KEY,
  supplier_id   integer NOT NULL REFERENCES suppliers(id),
  location_id   integer NOT NULL REFERENCES locations(id),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','delivered','cancelled')),
  needed_for    date,
  note          text,
  created_by    integer NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz, sent_by integer REFERENCES users(id), sent_via text,
  delivered_at  timestamptz, delivered_by integer REFERENCES users(id),
  invoice_id    integer REFERENCES invoices(id),
  cancelled_at  timestamptz
);
CREATE INDEX purchase_orders_status ON purchase_orders (status, location_id);

CREATE TABLE purchase_order_lines (
  id           serial PRIMARY KEY,
  order_id     integer NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id   integer NOT NULL REFERENCES products(id),
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  unit         text,
  est_price    numeric(14,4),
  received_qty numeric(14,3),
  note         text,
  UNIQUE (order_id, product_id)
);

ALTER TABLE suppliers ADD COLUMN email text;
ALTER TABLE suppliers ADD COLUMN phone text;
