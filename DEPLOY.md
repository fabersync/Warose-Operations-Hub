# Găzduirea Warose Operations Hub în cloud

## Arhitectura recomandată

| Componentă | Serviciu | De ce |
|---|---|---|
| Aplicația web (Docker) | **Render** – Web Service, regiunea **Frankfurt** | Pornește direct din cod, HTTPS automat, o singură instanță (planificatorul de alerte rulează o dată) |
| Baza de date | **Render PostgreSQL**, Frankfurt | Administrată, cu backup automat; datele rămân în UE (GDPR) |
| Fișierele originale (exporturi Publine, facturi, PDF-uri) | **Disc persistent Render** montat la `/var/data` | Se păstrează la redeploy, cu instantanee zilnice |
| Emailuri (alerte, rapoarte) | **Brevo** (SMTP) sau serverul de email al domeniului | Trimitere fiabilă; Brevo are server în UE și un plan gratuit |
| Codul sursă | **GitHub** (depozit privat) | Render construiește și publică automat la fiecare modificare |

Aplicația nu depinde de Render: imaginea Docker (`Dockerfile`) rulează pe orice găzduire cu Docker + PostgreSQL.

## Conturile de creat

1. **GitHub** – cont gratuit, apoi un depozit **privat** `warose-operations-hub`.
2. **Render** – cont pe render.com, cu card de plată (serviciile din blueprint sunt cu plată).
3. **Brevo** – cont gratuit pe brevo.com pentru SMTP. Autentificați domeniul expeditorului (SPF/DKIM), ca emailurile să nu ajungă în spam. Alternativ: datele SMTP ale adresei de email existente a firmei.
4. **Acces la DNS-ul domeniului** (unde este înregistrat domeniul firmei), pentru adresa aplicației, de ex. `hub.warose.ro`.

Opțional, mai târziu:
- **n8n Cloud** (sau Make) – pentru a trimite alertele pe WhatsApp / Telegram / SMS prin webhook-ul aplicației.
- **SPV ANAF** cu certificat digital – pentru descărcarea automată a facturilor e-Factura.

## Cost estimativ lunar

Aproximativ 15 USD/lună: aplicația (Starter, ~7 USD) + PostgreSQL (Basic-256mb, ~6 USD) + disc 5 GB (~1,25 USD). Brevo gratuit până la 300 emailuri/zi. **Verificați prețurile actuale pe render.com la creare.**

## Pași

1. **Codul pe GitHub**: din folderul `warose-operations-hub`, publicați depozitul privat (fișierele `.env.local`, `.data` și `node_modules` sunt excluse automat).
2. **Render → New → Blueprint** → alegeți depozitul. Fișierul `render.yaml` creează aplicația, baza de date și discul, în Frankfurt.
3. Completați variabilele cerute:
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` – administratorul inițial (parolă lungă, unică; o schimbați după prima autentificare din „Contul meu”).
   - `APP_URL` – adresa finală, de ex. `https://hub.warose.ro`.
   - `SMTP_URL` – de ex. `smtp://LOGIN:CHEIE_SMTP@smtp-relay.brevo.com:587`; `MAIL_FROM` – de ex. `Warose Operations Hub <hub@warose.ro>`.
   - `AUTH_SECRET` și `CRON_SECRET` sunt generate automat de Render.
4. Primul deploy aplică automat migrările bazei de date. Verificați `https://<adresa>/api/health` → `{"ok":true,...}`.
5. **Domeniul**: Render → Settings → Custom Domain → `hub.warose.ro`; adăugați la DNS înregistrarea CNAME indicată. Certificatul HTTPS se emite automat.
6. Autentificați-vă, schimbați parola, creați utilizatorii (Setări) și agenții Publine.

## După lansare

- **Calculatoarele cu Publine**: în `agent/config.json` setați `ServerUrl` la adresa aplicației și cheia agentului generată în Setări → Agenți; rulați `Install-WaroseSync.ps1`.
- **Datele istorice**: baza din cloud pornește goală. Importați exporturile Publine reale (Importuri → Import manual), raportul SAGA „Situația producției” și facturile din SPV. Datele de test de pe calculatorul local nu se mută.
- **Configurare inițială**: asocierea gestiunilor Publine cu locațiile, produsele cu „stoc gestionat”, rețetele, duratele de dospire, furnizorii și regulile de alocare.

## Backup și recuperare

- PostgreSQL Render face backup zilnic automat; restaurarea se face din panoul Render (păstrarea depinde de plan).
- Discul cu fișierele originale are instantanee zilnice în Render.
- Exporturile Excel (vânzări, costuri, inventar, producție) permit oricând păstrarea datelor în afara aplicației.
- Recomandat: o dată pe lună, verificați în Render că există backup-uri recente.

## Securitate

- Doar HTTPS; antete de securitate active; cookie-uri de sesiune `Secure`/`HttpOnly`.
- Autentificarea se blochează temporar după 8 încercări greșite în 15 minute.
- Parolele: schimbare din „Contul meu”; administratorul poate reseta parola oricui (Setări). Dezactivarea unui cont închide imediat sesiunile.
- Agenții Publine au chei proprii, revocabile din Setări.
- `/api/cron/run` cere `CRON_SECRET`.
- Totul este înregistrat în Jurnalul de audit.

## Variabile de mediu

| Variabilă | Obligatorie | Descriere |
|---|---|---|
| `DATABASE_URL` | da | Conexiunea PostgreSQL (setată automat de blueprint) |
| `AUTH_SECRET` | da | Cheia sesiunilor, min. 32 caractere (generată automat) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | prima pornire | Administratorul creat când nu există utilizatori |
| `APP_URL` | da | Adresa publică, pentru linkurile din emailuri |
| `FILE_STORAGE_DIR` | da | `/var/data/files` (discul persistent) |
| `SMTP_URL`, `MAIL_FROM` | recomandat | Trimiterea emailurilor; fără ele, emailurile nu pleacă |
| `CRON_SECRET` | da | Protejează `/api/cron/run` (generată automat) |
| `INTERNAL_SCHEDULER` | nu | `off` dezactivează planificatorul intern (dacă folosiți doar cron extern) |
