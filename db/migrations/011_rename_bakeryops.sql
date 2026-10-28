-- Aplicația se numește BakeryOps: locațiile nu mai poartă numele vechi al mărcii.
-- Se schimbă doar dacă numele n-a fost modificat manual între timp.
UPDATE locations SET name = 'Sibiu' WHERE code = 'SIBIU' AND name = 'Warose Bakery Sibiu';
UPDATE locations SET name = 'Alba Iulia' WHERE code = 'ALBA' AND name = 'Warose Bakery Alba Iulia';
