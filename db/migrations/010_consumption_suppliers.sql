-- Consum personal, protocol și pierderi de sfârșit de zi; scăderea ingredientelor din stoc la vânzare după rețetă;
-- furnizorii obișnuiți ai fiecărei locații și furnizorul ales pentru fiecare produs.

-- Produsele preparate în magazin (ex: cafea, sandvișuri): la vânzare se scad ingredientele din rețetă, nu produsul.
ALTER TABLE products ADD COLUMN consume_recipe_on_sale boolean NOT NULL DEFAULT false;

-- Consumul intern și pierderile, cu costul unitar de la momentul înregistrării (rețetă sau preț de achiziție).
CREATE TABLE internal_uses (
  id           serial PRIMARY KEY,
  location_id  integer NOT NULL REFERENCES locations(id),
  kind         text NOT NULL CHECK (kind IN ('staff','protocol','loss')),
  use_date     date NOT NULL,
  person       text,
  reason       text,
  product_id   integer NOT NULL REFERENCES products(id),
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost    numeric(14,4),
  cost_source  text CHECK (cost_source IN ('recipe','purchase')),
  unit_price   numeric(14,4),
  created_by   integer NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by integer REFERENCES users(id)
);
CREATE INDEX internal_uses_date ON internal_uses (use_date, location_id, kind);
ALTER TABLE stock_movements ADD COLUMN internal_use_id integer REFERENCES internal_uses(id);

-- Furnizorii de la care comandă fiecare locație.
CREATE TABLE location_suppliers (
  location_id integer NOT NULL REFERENCES locations(id),
  supplier_id integer NOT NULL REFERENCES suppliers(id),
  PRIMARY KEY (location_id, supplier_id)
);

-- Furnizorul ales pentru un produs într-o locație (altfel: ultimul furnizor din facturi).
ALTER TABLE stock_targets ADD COLUMN supplier_id integer REFERENCES suppliers(id);
ALTER TABLE stock_targets ALTER COLUMN target_qty SET DEFAULT 0;

-- Furnizorii ceruți: BRUTĂRIE: Metro, Net Distribution, Expertarom, Side; magazinele: Metro, Smart Bar, Side, Delaco, Cris-Tim.
-- Se folosește furnizorul existent din facturi (după nume); doar dacă lipsește se creează, fără CIF.
INSERT INTO suppliers (name)
SELECT v.name FROM (VALUES ('METRO', 'METRO CASH & CARRY ROMANIA'), ('NETDISTRIBUTION', 'NET DISTRIBUTION'), ('EXPERTAROM', 'EXPERTAROM'),
                           ('SIDE', 'SIDE GRUP'), ('SMARTBAR', 'SMART BAR SOLUTIONS'), ('DELACO', 'DELACO DISTRIBUTION'), ('CRISTIM', 'CRIS-TIM FAMILY HOLDING')) v(key, name)
 WHERE NOT EXISTS (SELECT 1 FROM suppliers s WHERE regexp_replace(upper(s.name), '[^A-Z0-9]', '', 'g') LIKE v.key || '%');

INSERT INTO location_suppliers (location_id, supplier_id)
SELECT l.id,
       (SELECT s.id FROM suppliers s WHERE regexp_replace(upper(s.name), '[^A-Z0-9]', '', 'g') LIKE v.key || '%'
         ORDER BY (SELECT count(*) FROM invoices i WHERE i.supplier_id = s.id) DESC, s.id LIMIT 1)
  FROM (VALUES ('production', 'METRO'), ('production', 'NETDISTRIBUTION'), ('production', 'EXPERTAROM'), ('production', 'SIDE'),
               ('store', 'METRO'), ('store', 'SMARTBAR'), ('store', 'SIDE'), ('store', 'DELACO'), ('store', 'CRISTIM')) v(kind, key)
  JOIN locations l ON l.kind = v.kind AND l.active
ON CONFLICT DO NOTHING;
