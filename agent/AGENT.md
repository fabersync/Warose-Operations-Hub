# Agentul Warose Sync (Windows)

Agentul rulează pe calculatoarele Warose și trimite automat către aplicație:

- **exporturile Publine** („Situație comenzi”), salvate de personal într-un folder — Sibiu și Alba Iulia;
- **facturile primite e-Factura** pe care SAGA C le-a descărcat din SPV — calculatorul pe care rulează SAGA.

Agentul doar **citește** folderele. Nu generează exporturi din Publine, nu descarcă din SPV, nu scrie nimic în SAGA și nu șterge sau mută fișierele sursă.

## Ce făcea versiunea 1 și ce nu

| Versiunea 1 (înlocuită) | Versiunea 2 (actuală) |
|---|---|
| Citea un singur folder Publine, la 5 minute | Mai multe surse: Publine și e-Factura (SAGA) |
| Ținea evidența fișierelor trimise după amprenta SHA-256 | La fel, plus o **coadă locală**: fișierul e copiat imediat, deci nu se pierde dacă e șters sau mutat din folder înainte de trimitere |
| Fără internet: reîncerca la rularea următoare, dar dacă fișierul dispărea din folder, se pierdea | Fișierele rămân în coadă până la confirmarea serverului, inclusiv după repornire |
| Sarcina rula doar cu utilizatorul autentificat în Windows | Rulează sub contul **SYSTEM**, la pornirea calculatorului și apoi la fiecare 5 minute, fără ca cineva să fie autentificat |
| Cheia agentului stătea în clar în config.json | Cheia e **criptată (DPAPI)** și legată de calculator; folderul e accesibil doar SYSTEM și Administratorilor |
| Un singur log, fără niveluri | Loguri zilnice cu niveluri (INFO/WARN/ERROR), păstrate 30 de zile; erorile apar și în Event Viewer |
| Fără mod de test | `-Test`: verifică totul **fără să copieze sau să trimită** nimic și afișează totalurile facturilor |
| Accepta și http:// | Cere **https://** (în afară de testele locale) |
| Nu raporta starea | Raportează versiunea, coada, sursele și ultima eroare; se văd în Importuri & sincronizare |

## Cum identifică locația și cum previne dublurile

- **Locația** e cea pe care a fost înregistrat agentul în aplicație (Setări → Agenți), legată de cheia lui. Nu se deduce din numele furnizorului sau al fișierului.
  - Exporturi Publine: dacă exportul conține gestiunea, aceasta e verificată după asocierile din Setări; liniile fără gestiune primesc locația agentului.
  - Facturi e-Factura: factura intră „De verificat”, cu locația agentului ca alocare implicită. Dacă furnizorul are deja o alocare setată de voi, are prioritate aceea. Locația se poate schimba la verificare.
- **Dublurile**:
  - pe calculator: amprenta conținutului (XML-ul și ZIP-ul aceleiași facturi se recunosc ca un singur fișier);
  - pe server: același fișier, aceeași linie de vânzare, același index SPV sau același furnizor + număr + dată nu se înregistrează de două ori.

## Instalare

Pe fiecare calculator, din PowerShell deschis **„Ca administrator”**, în folderul `agent`:

```
powershell -ExecutionPolicy Bypass -File .\Install-WaroseSync.ps1 -ServerUrl "https://hub.warose.ro" -Token "wrs_..." -Publine "D:\Exporturi Publine"
```

Pe calculatorul cu SAGA (sursă e-Factura):

```
powershell -ExecutionPolicy Bypass -File .\Install-WaroseSync.ps1 -ServerUrl "https://hub.warose.ro" -Token "wrs_..." -EFactura "C:\SAGA C.3.0\e-Factura\DAVID_WAROSE_SRL" -EFacturaSince "2026-01-01"
```

- Cheia (`wrs_...`) se generează în aplicație: Setări → Agenți de sincronizare, câte una pentru fiecare calculator, pe locația lui.
- `-EFacturaSince`: de la ce **dată a facturii** se preiau facturile (citită din numele fișierului SAGA, `F_<index>_<număr>_ZZ-LL-AAAA`; data salvării nu e folosită, pentru că un folder SAGA copiat are toate fișierele cu aceeași dată). Pentru istoric, reinstalați cu o dată mai veche: facturile deja trimise nu se dublează; toate cele noi intră „De verificat”.
- Pe calculatorul SAGA de la brutărie se poate folosi direct `Instaleaza-PC-SAGA.cmd` (dublu-clic): cere permisiunea de administrator și cheia, restul e completat.
- Instalarea modifică pe calculator doar trei lucruri: creează `C:\ProgramData\WaroseSync`, sursa „WaroseSync” în jurnalul de evenimente și sarcina programată „Warose Sync”.
- Dezinstalare: `Uninstall-WaroseSync.ps1`.

Verificare oricând (nu modifică nimic):

```
powershell -ExecutionPolicy Bypass -File C:\ProgramData\WaroseSync\WaroseSync.ps1 -Test
```

## Exportul din Publine: se poate automatiza?

**Situația de azi:** exportul e manual. Nu presupunem că Publine are export programat sau API.

| Variantă | Evaluare |
|---|---|
| **A. Export programat sau din linia de comandă oferit de Publine** | Cea mai bună, dacă există. Se confirmă cu furnizorul (vezi întrebările de mai jos). |
| **B. Citire doar-în-citire din baza de date Publine** (prin Firebird/SQL, cu un utilizator read-only) | Fiabilă și fără interfață grafică, dar **numai cu acordul și documentația furnizorului**: structura bazei se poate schimba la actualizări și poate afecta garanția sau suportul. |
| **C. Automatizarea interfeței Windows** (clicuri simulate în meniurile Publine, de ex. cu UI Automation / AutoHotkey) | **Nerecomandată.** Depinde de poziția ferestrelor și meniurilor, de rezoluție și de actualizările Publine. Cere o sesiune Windows deblocată și ar putea interfera cu casierul care folosește programul. O eroare poate lăsa dialoguri deschise pe casă. Am ales să nu o implementez. |
| **D. Proces manual simplu** (recomandat până la A sau B) | La închidere, responsabilul exportă „Situație comenzi” în folderul urmărit. Agentul preia fișierul în maximum 5 minute. Dacă exportul lipsește, aplicația trimite alerta „Nicio vânzare importată ieri”. |

Exportul Publine **nu este automat** până când varianta A sau B nu e confirmată de furnizor și testată pe casă.

### De confirmat cu furnizorul Publine

1. Există export programat (zilnic, la o oră fixă) al raportului „Situație comenzi” într-un folder? În ce formate?
2. Există un utilitar sau un parametru de linie de comandă care generează raportul fără interfață?
3. Ce bază de date folosește (Firebird, SQL Server etc.)? Se poate primi un utilizator **doar-citire** și documentația tabelelor de vânzări, cu garanția că nu afectează funcționarea și suportul?
4. Exportul cumulativ pe lună (rulat zilnic) este stabil, adică aceleași bonuri cu aceleași valori?
5. Ce se întâmplă cu bonurile anulate sau stornate în export?
6. Câmpul „Gestiune” e completat pentru toate liniile (inclusiv tipul „Nedefinit”)? Ce înseamnă gestiunea „BLAJ” apărută în februarie?

## Facturile e-Factura din SAGA C: ce am constatat pe acest calculator

Am verificat doar prin citire `C:\SAGA C.3.0\e-Factura\DAVID_WAROSE_SRL`:

- **Structura:** `<Luna><An>\FacturiPrimite\<FURNIZOR>\F_<indexSPV>_<număr>_<dată>.xml` și `.zip` (arhiva ANAF cu semnătura). În rădăcina lunii sunt facturile **emise** de firmă; agentul le ignoră.
- **Calitatea fișierelor:** toate cele **813 facturi primite** sunt citite corect. Suma liniilor e egală cu totalul fără TVA la toate, iar toate sunt emise către DAVID WAROSE S.R.L. (CIF RO40177983). Facturile Metro au reduceri în preț și sunt „achitate” (de plată 0); se citesc corect.
- **Descărcarea NU pare automată:** ultima descărcare de facturi primite e din **10.08.2026**. Pentru septembrie și octombrie 2026 nu există `FacturiPrimite`. Concluzia: SAGA descarcă la acțiunea cuiva (sau descărcarea se face pe alt calculator).
- **Testul pe acest calculator:** facturile din iulie–august (122 de fișiere, 61 de facturi unice) au fost preluate în aplicația locală. Pagina „Verificare e-Factura” confirmă că totalurile sunt identice cu fișierele originale.

Sincronizarea facturilor **nu este complet automată** până când descărcarea din SPV în SAGA nu e confirmată ca automată și testată.

### De confirmat cu SAGA / contabilitatea

1. Pe ce calculator(e) rulează SAGA și unde se descarcă e-Facturile (același folder pe toate)?
2. SAGA C poate descărca **automat, programat** facturile primite din SPV? Dacă da, cu ce setare și cu ce cerințe (certificat digital conectat, program deschis)?
3. Dacă nu: cine apasă „Descarcă din SPV” și cât de des? Recomandat: zilnic sau cel puțin înainte de verificarea facturilor în aplicație.
4. Ce se întâmplă dacă se descarcă de două ori aceeași factură (alt index SPV)? Aplicația o recunoaște oricum după furnizor + număr + dată.
5. Alternativ, pe termen lung: descărcare direct din SPV prin API-ul ANAF (OAuth cu certificat), independentă de SAGA.

## Plan de instalare și testare

### Pregătire (o singură dată)
1. Aplicația e pornită (local pentru test sau în cloud după aprobare). În Setări → Locații, „MAGAZN SIBIU” e asociat cu Sibiu; după primul export de la Alba, asociați și gestiunea Alba.
2. Generați câte o cheie: „PC casă Sibiu” (Sibiu), „PC casă Alba Iulia” (Alba Iulia) și „PC SAGA” (BRUTĂRIE sau locația dorită pentru costuri).

### Pe fiecare casă (Sibiu, apoi Alba Iulia)
| Pas | Ce faceți | Rezultat așteptat |
|---|---|---|
| 1 | Alegeți folderul de export (ex. `D:\Exporturi Publine`); exportați manual „Situație comenzi” acolo | Fișierul apare în folder |
| 2 | Rulați instalarea (cu `-Publine`) „Ca administrator” | Testul final arată „conexiune: OK” și „Sursa publine: OK” |
| 3 | Așteptați 5 minute | În aplicație, la Importuri: import nou, „Reconciliat”; agentul „Online”, cu versiunea 2.0.0 |
| 4 | Comparați totalul importului cu raportul Publine pentru aceeași perioadă | Valoarea fără TVA este identică |
| 5 | Exportați din nou același raport | Import „duplicat blocat” sau 0 linii noi; nicio dublare în vânzări |
| 6 | Scoateți cablul de rețea / opriți Wi-Fi; exportați un raport nou | În log: „Serverul nu răspunde… rămân în coadă”; fișierul e în `queue` |
| 7 | Reconectați rețeaua | În maximum 5 minute: „Trimis…”, coada e goală |
| 8 | Reporniți calculatorul fără să vă autentificați | După ~2–5 minute, agentul apare „Online” în aplicație |
| 9 | Verificați Event Viewer → Application → sursa WaroseSync | Fără erori (sau erori explicite, dacă le-ați provocat) |

### Pe calculatorul cu SAGA
| Pas | Ce faceți | Rezultat așteptat |
|---|---|---|
| 1 | Rulați `WaroseSync.ps1 -Test` cu `-EFacturaSince` ales | Lista facturilor, cu „suma liniilor = total fără TVA” corectă la toate |
| 2 | Instalați cu `-EFactura` | Sarcina „Warose Sync” e creată |
| 3 | În SAGA, descărcați facturile primite din SPV | În max. 5 minute, facturile apar „De verificat” în aplicație |
| 4 | Deschideți Facturi → Verificare e-Factura | „Toate … corespund fișierelor originale” |
| 5 | Descărcați din nou în SAGA | Nicio factură dublată |
| 6 | **Test de automatizare:** nu descărcați nimic manual 2–3 zile | Dacă apar facturi noi singure, descărcarea SAGA e automată; altfel rămâne un pas manual |

### Ce trebuie verificat la final
- Totalurile importate se potrivesc cu Publine și cu fișierele e-Factura.
- Agenții sunt „Online” în timpul programului.
- Alertele „agent offline” și „nicio vânzare ieri” ajung la persoanele potrivite.
