# Warose Operations Hub

Aplicație web pentru operațiunile Warose Bakery (Sibiu, Alba Iulia, BRUTĂRIE, congelator).
Lucrează **împreună cu** Publine și SAGA C — nu le modifică bazele de date.

## Ce funcționează acum

| Modul | Stare |
|---|---|
| Autentificare, roluri, acces pe locații, jurnal audit | gata |
| Import vânzări Publine („Situație comenzi” .xls/.xlsx/.csv) cu blocarea dublurilor și reconciliere | gata, verificat pe ian./feb. 2026 |
| Agent de sincronizare Windows pentru PC-urile cu Publine | gata (de instalat în locații) |
| Dashboard, analiză vânzări, export Excel | gata |
| Stocuri operaționale din mișcări, congelator cu loturi/expirare, transferuri, stornări | gata |
| Vânzările Publine scad automat din stoc (produse marcate „stoc gestionat”) | gata |
| Inventar lunar digital: numărare pe telefon, diferențe, închidere în stoc, raport Excel | gata |
| Rețete versionate cu cost teoretic, plan de producție, necesar materii prime vs. stoc | gata |
| Document de producție: înregistrare, consum teoretic/efectiv, aprobare în stoc, export pentru SAGA | gata |
| Import „Situația producției” din SAGA C, asociere coduri SAGA, comparație lunară | gata |
| Plan dospire: durate pe produs, ore calculate, propuneri din vânzări, verificare stoc, sarcini bifabile | gata |
| Comenzi locații → depozit/BRUTĂRIE: confirmare cu motiv, expediere pe loturi, recepție cu diferențe, istoric, document de transfer | gata |
| Necesar din comenzi vs. stoc, plan de producție generat din lipsuri | gata |
| Facturi: import e-Factura (XML/ZIP din SPV), facturi manuale cu PDF, blocarea dublurilor | gata |
| Verificare factură: asociere cu materii prime (cu conversie sac/bax → kg), prețuri, recepție în stoc, alocare pe locații | gata |
| Costuri lunare pe locații și categorii, costuri fără factură, export „Raport Costuri – Venituri” | gata |
| Profitabilitate: rezultat estimat pe locație, marjă estimată pe produs, modificări de preț | gata |
| Agent Windows v2: Publine + facturile e-Factura din SAGA (doar citire), coadă offline, pornire cu Windows | gata (de instalat în locații) |
| Comenzi către furnizori pe locații (Sibiu, Alba, BRUTĂRIE), stocuri minime și propuneri | gata |
| Export Excel pentru stocuri (stoc curent, loturi, mișcări) | gata |
| Alerte automate, notificări în aplicație și pe email, rapoarte zilnice și lunare, webhook pentru n8n / Make | gata |

## Rulare locală

```
npm install
npm run dev
```

Fără `DATABASE_URL`, aplicația folosește o bază PostgreSQL locală embedded (`.data/pglite`).
La prima pornire se aplică migrările din `db/migrations` și se creează administratorul din
`ADMIN_EMAIL` / `ADMIN_PASSWORD` (vezi `.env.local`). Schimbați parola după prima autentificare.

## Testare pe PostgreSQL real

```
npm run db:local-postgres   # PostgreSQL 16 local (UTF-8), port 5433
npm run build && npm run prod-test   # build de producție pe http://127.0.0.1:3100
```

## Găzduire în cloud

Ghidul complet, cu conturile necesare și pașii: [DEPLOY.md](DEPLOY.md). Pe scurt:

1. Bază de date PostgreSQL administrată (ex: Supabase, Neon) cu backup zilnic → `DATABASE_URL`.
2. Server Node.js (ex: Railway, Render, VPS) — `npm run build && npm start`.
3. Variabile: `DATABASE_URL`, `AUTH_SECRET` (min. 32 caractere aleatoare), `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `FILE_STORAGE_DIR` pe un volum persistent (fișierele originale importate).
4. HTTPS obligatoriu (agentul trimite cheia în antet).

## Agentul de sincronizare (Publine + e-Factura din SAGA)

Documentația completă, cu instalarea, testarea și întrebările pentru furnizori: [agent/AGENT.md](agent/AGENT.md).

### Versiunea 1 (veche)

1. În aplicație: Setări → Agenți de sincronizare → „Generează agent” pentru locație. Copiați cheia.
2. Copiați folderul `agent/` pe calculator, ex. `C:\WaroseSync\`.
3. Copiați `config.example.json` în `config.json` și completați `ServerUrl`, `Token`, `WatchFolder`
   (folderul în care Publine salvează exporturile).
4. Rulați o dată: `powershell -ExecutionPolicy Bypass -File C:\WaroseSync\Install-WaroseSync.ps1`

Agentul rulează la 5 minute, trimite doar fișierele noi, păstrează coada când nu există internet
și scrie jurnalul în `agent.log`. Nu șterge și nu mută fișierele din folderul de export.

**De verificat cu furnizorul Publine:** dacă exportul „Situație comenzi” poate fi programat automat
(ex: zilnic la închidere) într-un folder. Până atunci, exportul se face manual din Publine în folderul
urmărit, iar restul fluxului este automat.

## Inventarul lunar

1. Produse & coduri: bifați „stoc gestionat” la produsele care se numără. De atunci, vânzările lor din Publine scad din stoc.
2. Inventar → Inventar nou: alegeți locația și momentul (de obicei ora închiderii).
3. Personalul numără de pe telefon; valorile se salvează la fiecare produs. Rolul „Personal operațional” nu vede stocul scriptic.
4. Managerul închide inventarul: stocul scriptic se recalculează la momentul ales (inclusiv vânzări importate mai târziu),
   iar diferențele devin mișcări „Diferență inventar”. Lipsurile se scad din cel mai vechi lot.
5. Primul inventar al fiecărei locații stabilește stocul de pornire.

Valoarea diferențelor este calculată la prețul de vânzare cu TVA din Publine (prețul de achiziție vine în Etapa 6).

## Producția

1. Materiile prime se adaugă în Produse & coduri (categoria „Materie primă”, UM kg/l/buc); prețul de achiziție se setează în Producție → Rețete & costuri.
2. Produsele fabricate trebuie să aibă categoria „Produs finit” (setată automat la salvarea rețetei).
3. Plan nou → necesarul de materii prime este comparat cu stocul BRUTĂRIE.
4. După producție: cantități reale, cât merge la congelare, rebut; consumul teoretic se calculează din rețetă, efectivul e opțional.
5. Aprobarea scrie în stoc: + produs finit, − rebut, transfer la congelator pe lotul documentului, − materiile prime cu stoc gestionat.
6. „Document pentru SAGA” (Excel) se introduce în SAGA; apoi se notează numărul documentului SAGA.
7. Comparație SAGA: importați lunar „Situația producției” și asociați codurile SAGA cu produsele.

## Planul de dospire

1. Dospire → Setări dospire: pentru fiecare produs, minutele de decongelare, dospire și coacere (bifați „verificate” când sunt confirmate în practică); pe locație, ora „gata” și capacitatea dospitorului.
2. Plan dospire: alegeți locația și dimineața; „Creează cu propuneri din vânzări” completează cantitățile cu media ultimelor 4 zile identice (aceeași zi a săptămânii) din Publine.
3. Aplicația calculează înapoi de la ora „gata”: cuptor = gata − coacere, dospitor = cuptor − dospire, scoatere din congelator = dospitor − decongelare.
4. Avertizări: stoc insuficient în locație (cât trebuie adus din depozitul de congelate sau cât lipsește), capacitate depășită, durate neconfigurate/nevalidate, sarcini întârziate.
5. După confirmare, personalul vede sarcinile în ordinea orelor și le bifează de pe telefon; confirmarea fixează duratele folosite.

## Comenzile locațiilor

1. Managerul locației: Comenzi → Comandă nouă (de unde se livrează, data, produse) → Trimite.
2. BRUTĂRIE / depozit: vede stocul, ce e rezervat pentru alte comenzi și ce e liber; confirmă (modificările cer motiv).
3. „În pregătire” → Expediere cu cantitățile încărcate: stocul furnizorului scade pe loturi, cele mai vechi întâi. Nu se poate expedia peste stoc.
4. Locația recepționează: marfa intră pe aceleași loturi; lipsurile devin pierderi la recepție, cu explicația obligatorie.
5. Document de transfer tipăribil (cod SAGA, lot, expirare, semnături) — avizul oficial se emite în SAGA C.
6. Comenzi → Necesar comenzi: total cerut vs. stoc; lipsurile pot deveni direct un plan de producție.

## Facturi și costuri

1. Facturi → Import e-Factura: XML sau ZIP descărcate din SPV (mai multe odată). Facturile fără e-Factura se introduc manual, cu PDF-ul atașat.
2. Dublurile sunt blocate (același fișier sau același furnizor + număr + dată); facturile emise către alt CIF sunt respinse.
3. Verificare: fiecare linie se asociază (o singură dată per articol de furnizor) cu o materie primă și un factor de conversie (ex: 1 sac = 25 kg); se alege categoria de cost și locația / regula de alocare.
4. „Verifică și înregistrează”: costurile intră în registru pe locații, prețul materiei prime se actualizează (cu istoric), marfa intră în stoc. Ce se învață se aplică automat facturilor următoare ale furnizorului.
5. Costuri lunare: salarii, chirie, amortizări se introduc ca costuri fără factură; exportul Excel păstrează structura „Raport Costuri – Venituri”.
6. După introducerea în SAGA, factura se marchează „introdusă în SAGA”. Aplicația nu scrie în SAGA.

## Automatizări

- Planificatorul intern rulează în serverul aplicației: verifică alertele (implicit la 15 minute) și generează raportul zilnic (07:30, pentru ziua precedentă) și lunar (ziua 1, 08:00). Orele se schimbă din Setări → Automatizări.
- Alerte: agent Publine oprit, importuri eșuate/nereconciliate, zile fără vânzări, stoc negativ, loturi care expiră, comenzi neconfirmate/de livrat/nerecepționate, plan de dospire neconfirmat, producție neaprobată, facturi neverificate sau neintroduse în SAGA, creșteri de preț ≥ 10%. Fiecare situație se anunță o singură dată și se marchează rezolvată automat.
- Canale: clopoțelul din aplicație (mereu), email (SMTP_URL / MAIL_FROM; fără SMTP mesajele se salvează în .data/outbox), webhook semnat HMAC către n8n / Make (WhatsApp, Telegram, SMS).
- În cloud se poate folosi și un cron extern: POST /api/cron/run cu Authorization: Bearer CRON_SECRET (opțional ?job=alerts|daily_report|monthly_report, &date= / &month= pentru rapoarte istorice). Apelurile repetate sunt sigure.
- Fiecare utilizator își alege din Notificări ce primește pe email.

## Reguli de date

- Stocul operațional = suma mișcărilor. Nu există câmp „stoc” editabil; corecțiile sunt stornări.
- Stocul din aplicație **nu** este stocul contabil SAGA C și nu este prezentat ca reconciliat cu acesta.
- Un fișier identic nu se importă de două ori; liniile din exporturi suprapuse sunt ignorate prin cheie unică.
- Fiecare import compară totalul din fișier cu totalul din baza de date („Reconciliat” / „De verificat”).
