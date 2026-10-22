-- Etapa 7: alerte, notificări, rapoarte programate, jurnalul sarcinilor automate.

-- Starea fiecărei alerte (cheie stabilă), ca să notificăm o singură dată și să știm când s-a rezolvat.
CREATE TABLE alert_state (
  key         text PRIMARY KEY,
  severity    text NOT NULL CHECK (severity IN ('info','warn','bad')),
  title       text NOT NULL,
  detail      text,
  link        text,
  roles       text[] NOT NULL,
  location_id integer REFERENCES locations(id),
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  notified_at timestamptz
);

CREATE TABLE notifications (
  id           bigserial PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('alert','report','info')),
  severity     text NOT NULL DEFAULT 'info',
  alert_key    text,
  title        text NOT NULL,
  body         text,
  link         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  email_status text
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE notification_prefs (
  user_id       integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_alerts  boolean NOT NULL DEFAULT true,
  email_reports boolean NOT NULL DEFAULT true,
  min_severity  text NOT NULL DEFAULT 'warn' CHECK (min_severity IN ('info','warn','bad'))
);

CREATE TABLE reports (
  id           serial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('daily','monthly')),
  period_from  date NOT NULL,
  period_to    date NOT NULL,
  title        text NOT NULL,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, period_from)
);

CREATE TABLE job_runs (
  id          bigserial PRIMARY KEY,
  job         text NOT NULL,
  trigger     text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  message     text
);
CREATE INDEX job_runs_started ON job_runs (started_at DESC);

INSERT INTO app_settings (key, value) VALUES
  ('automation', '{"daily_report_time": "07:30", "monthly_report_time": "08:00", "alerts_every_min": 15, "agent_offline_min": 45, "business_from": 7, "business_to": 20}'),
  ('webhook', '{"url": "", "secret": ""}')
ON CONFLICT (key) DO NOTHING;
