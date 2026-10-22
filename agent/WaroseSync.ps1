<#
  Warose Sync Agent v2 — rulează pe calculatoarele Warose (Sibiu, Alba Iulia, BRUTĂRIE).

  Ce face, la fiecare rulare (programată la 5 minute de Install-WaroseSync.ps1):
    1. Citește folderele configurate (doar citire, nu modifică și nu șterge nimic din ele):
       - 'publine'  : exporturile Publine salvate MANUAL de personal (Situație comenzi .xls/.xlsx/.csv);
       - 'efactura' : facturile primite pe care SAGA C le-a descărcat din SPV (XML sau ZIP ANAF) — doar citire.
    2. Copiază fiecare fișier NOU (după amprenta SHA-256 a conținutului) într-o coadă locală.
       Fișierele rămân în coadă până când serverul confirmă primirea — inclusiv fără internet sau după repornire.
    3. Trimite coada către aplicația centrală prin HTTPS, autentificat cu cheia agentului.
       Serverul stabilește locația din înregistrarea agentului și blochează dublurile.
    4. Raportează starea (coadă, erori, surse) și scrie loguri zilnice.

  Ce NU face:
    - nu generează exporturile din Publine și nu interacționează cu interfața Publine;
    - nu descarcă facturi din SPV și nu scrie nimic în SAGA;
    - nu șterge sau mută fișierele din folderele sursă.

  Utilizare:  WaroseSync.ps1            (o rulare normală)
              WaroseSync.ps1 -Test      (verificare fără modificări: configurație, foldere, server, totaluri facturi)
  Compatibil cu Windows PowerShell 5.1 (Windows 10/11).
#>
param(
  [switch]$Test,
  [string]$ConfigPath
)

$ErrorActionPreference = "Stop"
$AgentVersion = "2.0.0"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ConfigPath) { $ConfigPath = Join-Path $Root "config.json" }
$StatePath = Join-Path $Root "state.json"
$StatusPath = Join-Path $Root "status.json"
$QueueDir = Join-Path $Root "queue"
$SentDir = Join-Path $Root "sent"
$RejectedDir = Join-Path $Root "rejected"
$LogDir = Join-Path $Root "logs"
$Curl = Join-Path $env:SystemRoot "System32\curl.exe"
$script:LastError = $null

foreach ($d in @($QueueDir, $SentDir, $RejectedDir, $LogDir)) { if (-not $Test -and -not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }

# ------------------------------------------------------------------ jurnal
function Write-Log([string]$Level, [string]$Message) {
  $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level.PadRight(5), $Message
  Write-Host $line   # Write-Host: nu intră în valorile returnate de funcții
  if ($Test) { return }
  Add-Content -Path (Join-Path $LogDir ("WaroseSync-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))) -Value $line -Encoding UTF8
  if ($Level -eq "ERROR") {
    $script:LastError = $Message
    try { Write-EventLog -LogName Application -Source "WaroseSync" -EventId 1001 -EntryType Error -Message $Message } catch { }
  }
}

# ------------------------------------------------------------------ o singură rulare odată
$mutex = New-Object System.Threading.Mutex($false, "Global\WaroseSyncAgent")
if (-not $mutex.WaitOne(0)) { Write-Output "O altă rulare este în curs; ies."; exit 0 }

try {
  # ---------------------------------------------------------------- configurație
  if (-not (Test-Path $ConfigPath)) { Write-Log "ERROR" "Lipsește configurația: $ConfigPath"; exit 1 }
  $cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $server = ([string]$cfg.ServerUrl).TrimEnd("/")
  $uri = [Uri]$server
  if ($uri.Scheme -ne "https" -and @("localhost", "127.0.0.1") -notcontains $uri.Host) {
    Write-Log "ERROR" "ServerUrl trebuie să folosească https:// (primit: $server)."; exit 1
  }
  $token = $null
  if ($cfg.TokenProtected) {
    Add-Type -AssemblyName System.Security
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([string]$cfg.TokenProtected), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    $token = [Text.Encoding]::UTF8.GetString($bytes)
  } elseif ($cfg.Token) {
    $token = [string]$cfg.Token
    Write-Log "WARN" "Cheia agentului este necriptată în config.json (doar pentru teste). Instalați cu Install-WaroseSync.ps1."
  }
  if (-not $token) { Write-Log "ERROR" "Lipsește cheia agentului (TokenProtected) în configurație."; exit 1 }
  $minAge = 60; if ($cfg.MinFileAgeSeconds) { $minAge = [int]$cfg.MinFileAgeSeconds }
  $keepSent = 90; if ($cfg.KeepSentDays) { $keepSent = [int]$cfg.KeepSentDays }
  $keepLogs = 30; if ($cfg.LogRetentionDays) { $keepLogs = [int]$cfg.LogRetentionDays }
  $authHeader = "Authorization: Bearer $token"
  $verHeader = "X-Agent-Version: $AgentVersion"

  # ---------------------------------------------------------------- stare (amprentele deja preluate)
  $seen = @{}
  if (Test-Path $StatePath) {
    $st = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($st.seen) { $st.seen.PSObject.Properties | ForEach-Object { $seen[$_.Name] = $_.Value } }
  }
  function Save-State {
    if ($Test) { return }
    $tmp = "$StatePath.tmp"
    (@{ seen = $seen } | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $StatePath -Force
  }
  function Set-Seen([string]$Hash, [string]$Status, [string]$File, [string]$Type) {
    $seen[$Hash] = [pscustomobject]@{ status = $Status; file = $File; type = $Type; at = (Get-Date -Format s) }
  }

  $sha = [Security.Cryptography.SHA256]::Create()
  function Get-Sha([byte[]]$Bytes) { -join ($sha.ComputeHash($Bytes) | ForEach-Object { $_.ToString("x2") }) }

  # Fișier încă în scriere (blocat de Publine/SAGA)? Atunci îl lăsăm pentru rularea următoare.
  function Test-Locked([string]$Path) {
    try { $fs = [IO.File]::Open($Path, "Open", "Read", "Read"); $fs.Close(); return $false } catch { return $true }
  }

  function Add-ToQueue([string]$Type, [byte[]]$Bytes, [string]$Name, [hashtable]$Meta) {
    $hash = Get-Sha $Bytes
    if ($seen.ContainsKey($hash)) { return $null }
    if ($Test) { Set-Seen $hash "test" $Name $Type; return $hash }   # în test: reținut doar în memorie (XML și ZIP-ul aceleiași facturi = o singură factură)
    $dir = Join-Path $QueueDir $Type
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $ext = [IO.Path]::GetExtension($Name).ToLower()
    [IO.File]::WriteAllBytes((Join-Path $dir "$hash$ext"), $Bytes)
    $Meta.name = $Name; $Meta.type = $Type; $Meta.hash = $hash; $Meta.queued_at = (Get-Date -Format s); $Meta.attempts = 0; $Meta.ext = $ext
    ($Meta | ConvertTo-Json -Depth 3) | Set-Content -LiteralPath (Join-Path $dir "$hash.json") -Encoding UTF8
    Set-Seen $hash "queued" $Name $Type
    Save-State
    return $hash
  }

  $sourceStatus = @()
  $testRows = @()

  # ---------------------------------------------------------------- sursa: exporturi Publine
  function Scan-Publine($src) {
    $folder = [string]$src.Folder
    if (-not (Test-Path -LiteralPath $folder)) { Write-Log "ERROR" "Folderul Publine nu există: $folder"; return @{ type = "publine"; folder = $folder; ok = $false; message = "folder inexistent" } }
    $patterns = @("*.xls", "*.xlsx", "*.csv"); if ($src.Patterns) { $patterns = @($src.Patterns) }
    $files = foreach ($p in $patterns) { Get-ChildItem -LiteralPath $folder -Filter $p -File -Recurse:([bool]$src.Recursive) -ErrorAction SilentlyContinue }
    $new = 0; $waiting = 0
    foreach ($f in ($files | Where-Object { $_.Name -notlike '~$*' } | Sort-Object LastWriteTime)) {
      if (((Get-Date) - $f.LastWriteTime).TotalSeconds -lt $minAge -or (Test-Locked $f.FullName)) { $waiting++; continue }
      $bytes = [IO.File]::ReadAllBytes($f.FullName)
      if (Add-ToQueue "publine" $bytes $f.Name @{ source_path = $f.FullName; modified = $f.LastWriteTime.ToString("s") }) {
        $new++; Write-Log "INFO" ("{0}Export Publine nou: {1}" -f $(if ($Test) { "[TEST] " } else { "" }), $f.Name)
      }
    }
    return @{ type = "publine"; folder = $folder; ok = $true; files = @($files).Count; new = $new; waiting = $waiting }
  }

  # ---------------------------------------------------------------- sursa: e-Factura (folderul SAGA, doar citire)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  function Read-InvoiceXml([IO.FileInfo]$f) {
    if ($f.Extension -ieq ".zip") {
      $zip = [IO.Compression.ZipFile]::OpenRead($f.FullName)
      try {
        $entry = $zip.Entries | Where-Object { $_.Name -match '\.xml$' -and $_.Name -notmatch '^semnatura' } | Select-Object -First 1
        if (-not $entry) { return $null }
        $ms = New-Object IO.MemoryStream; $s = $entry.Open(); $s.CopyTo($ms); $s.Close()
        return ,$ms.ToArray()   # virgula păstrează byte[] (altfel PowerShell îl desface element cu element)
      } finally { $zip.Dispose() }
    }
    return ,[IO.File]::ReadAllBytes($f.FullName)
  }
  function Test-InvoiceXml([byte[]]$Bytes) {
    $head = [Text.Encoding]::UTF8.GetString($Bytes, 0, [Math]::Min(4000, $Bytes.Length))
    if ($head -notmatch 'urn:oasis:names:specification:ubl:schema:xsd:(Invoice|CreditNote)-2') { return $null }
    try { [xml]$x = [Text.Encoding]::UTF8.GetString($Bytes); return ,$x } catch { return $null }
  }
  # Totalurile din XML, pentru modul de test (comparație cu aplicația).
  function Get-InvoiceTotals([xml]$x) {
    $ns = New-Object Xml.XmlNamespaceManager($x.NameTable)
    $ns.AddNamespace("cbc", "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2")
    $ns.AddNamespace("cac", "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2")
    $v = { param($q) $n = $x.SelectSingleNode($q, $ns); if ($n) { $n.InnerText } else { "" } }
    $lines = $x.SelectNodes("//cac:InvoiceLine|//cac:CreditNoteLine", $ns)
    $sum = [decimal]0; foreach ($l in $lines) { $sum += [decimal]::Parse($l.SelectSingleNode("cbc:LineExtensionAmount", $ns).InnerText, [Globalization.CultureInfo]::InvariantCulture) }
    foreach ($a in $x.SelectNodes("/*/cac:AllowanceCharge", $ns)) {
      $amt = [decimal]::Parse($a.SelectSingleNode("cbc:Amount", $ns).InnerText, [Globalization.CultureInfo]::InvariantCulture)
      if ($a.SelectSingleNode("cbc:ChargeIndicator", $ns).InnerText -eq "true") { $sum += $amt } else { $sum -= $amt }
    }
    [pscustomobject]@{
      furnizor = & $v "//cac:AccountingSupplierParty//cac:PartyLegalEntity/cbc:RegistrationName"
      cif = & $v "//cac:AccountingSupplierParty//cac:PartyTaxScheme/cbc:CompanyID"
      numar = & $v "/*/cbc:ID"; data = & $v "/*/cbc:IssueDate"; moneda = & $v "/*/cbc:DocumentCurrencyCode"
      linii = $lines.Count; suma_linii = $sum
      fara_tva = & $v "//cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount"
      total = & $v "//cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount"
    }
  }
  function Scan-EFactura($src) {
    $folder = [string]$src.Folder
    if (-not (Test-Path -LiteralPath $folder)) { Write-Log "ERROR" "Folderul e-Factura nu există: $folder"; return @{ type = "efactura"; folder = $folder; ok = $false; message = "folder inexistent" } }
    $filter = "FacturiPrimite"; if ($src.SubfolderFilter) { $filter = [string]$src.SubfolderFilter }
    $since = [datetime]::MinValue; if ($src.SinceDate) { $since = [datetime]::ParseExact([string]$src.SinceDate, "yyyy-MM-dd", $null) }
    # Doar facturile PRIMITE (subfolderul FacturiPrimite); facturile emise de firmă sunt ignorate.
    $files = Get-ChildItem -LiteralPath $folder -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { ($_.Extension -ieq ".xml" -or $_.Extension -ieq ".zip") -and $_.DirectoryName -match [regex]::Escape("\$filter") -and $_.LastWriteTime -ge $since } |
      Sort-Object @{ Expression = { if ($_.Extension -ieq ".xml") { 0 } else { 1 } } }, LastWriteTime
    $new = 0; $ignored = 0; $waiting = 0
    foreach ($f in $files) {
      if (((Get-Date) - $f.LastWriteTime).TotalSeconds -lt $minAge -or (Test-Locked $f.FullName)) { $waiting++; continue }
      try { $bytes = Read-InvoiceXml $f } catch { Write-Log "WARN" "Nu pot citi $($f.FullName): $($_.Exception.Message)"; continue }
      if (-not $bytes) { $ignored++; continue }
      $x = Test-InvoiceXml $bytes
      if (-not $x) { $ignored++; continue }   # semnături, răspunsuri ANAF, fișiere care nu sunt facturi UBL
      $xmlName = [IO.Path]::GetFileNameWithoutExtension($f.Name) + ".xml"
      $spv = ""; if ($f.Name -match '^F_(\d{6,})_') { $spv = $Matches[1] }
      $hash = Add-ToQueue "efactura" $bytes $xmlName @{ source_path = $f.FullName; spv_index = $spv; modified = $f.LastWriteTime.ToString("s") }
      if ($hash) {
        $new++
        if ($Test) { $script:testRows += (Get-InvoiceTotals $x) } else { Write-Log "INFO" "Factură e-Factura nouă: $xmlName" }
      }
    }
    return @{ type = "efactura"; folder = $folder; ok = $true; files = @($files).Count; new = $new; ignored = $ignored; waiting = $waiting }
  }

  foreach ($src in @($cfg.Sources)) {
    try {
      if ($src.Type -eq "publine") { $sourceStatus += Scan-Publine $src }
      elseif ($src.Type -eq "efactura") { $sourceStatus += Scan-EFactura $src }
      else { Write-Log "WARN" "Tip de sursă necunoscut: $($src.Type)" }
    } catch { Write-Log "ERROR" "Eroare la citirea sursei $($src.Type): $($_.Exception.Message)" }
  }

  # ---------------------------------------------------------------- server
  function Invoke-Curl([string[]]$CurlArgs) {
    $tmp = [IO.Path]::GetTempFileName()
    # În PowerShell 5.1, textul scris de curl pe stderr ar deveni eroare fatală; codul HTTP (000 = fără conexiune) ajunge.
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try {
      $code = & $Curl -s --tlsv1.2 --connect-timeout 15 --max-time 300 -o $tmp -w "%{http_code}" -H $authHeader -H $verHeader @CurlArgs 2>$null
      $body = ""; if (Test-Path $tmp) { $body = [IO.File]::ReadAllText($tmp, [Text.Encoding]::UTF8) }
      return @{ Code = [string]$code; Body = $body }
    } finally { $ErrorActionPreference = $prev; Remove-Item $tmp -ErrorAction SilentlyContinue }
  }

  $hb = Invoke-Curl @("-X", "POST", "$server/api/agent/heartbeat")
  $online = $hb.Code -eq "200"
  if ($hb.Code -eq "401") { Write-Log "ERROR" "Cheia agentului este invalidă sau a fost revocată. Generați o cheie nouă în aplicație (Setări → Agenți)." }
  elseif (-not $online) { Write-Log "WARN" "Serverul nu răspunde (cod $($hb.Code)). Fișierele rămân în coadă și se trimit la reconectare." }

  if ($Test) {
    Write-Output ""
    Write-Output "=== TEST (nimic nu a fost copiat sau trimis) ==="
    Write-Output ("Versiune agent: {0} · Server: {1} · conexiune: {2}" -f $AgentVersion, $server, $(if ($online) { "OK" } elseif ($hb.Code -eq "401") { "cheie invalidă" } else { "indisponibil (cod $($hb.Code))" }))
    foreach ($s in $sourceStatus) { Write-Output ("Sursa {0}: {1} · folder {2} · fișiere {3} · noi {4} · ignorate {5} · în scriere {6}" -f $s.type, $(if ($s.ok) { "OK" } else { $s.message }), $s.folder, $s.files, $s.new, $s.ignored, $s.waiting) }
    if ($script:testRows.Count) {
      Write-Output ""; Write-Output "Facturi e-Factura care ar fi trimise (totaluri din fișierele originale):"
      $script:testRows | Select-Object furnizor, cif, numar, data, linii, suma_linii, fara_tva, total, moneda | Format-Table -AutoSize | Out-String -Width 220 | Write-Output
      $bad = @($script:testRows | Where-Object { [Math]::Abs($_.suma_linii - [decimal]::Parse($_.fara_tva, [Globalization.CultureInfo]::InvariantCulture)) -gt 0.05 })
      Write-Output ("Verificare suma liniilor = total fără TVA: {0} din {1} corecte." -f ($script:testRows.Count - $bad.Count), $script:testRows.Count)
    }
    exit 0
  }

  # ---------------------------------------------------------------- trimiterea cozii
  $sent = 0; $failed = 0
  if ($online) {
    $items = Get-ChildItem -LiteralPath $QueueDir -Recurse -Filter *.json -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime
    foreach ($m in $items) {
      $meta = Get-Content -LiteralPath $m.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
      $data = Join-Path $m.DirectoryName ("{0}{1}" -f $meta.hash, $meta.ext)
      if (-not (Test-Path $data)) { Remove-Item $m.FullName; continue }
      $safeName = ([string]$meta.name) -replace '[;,"\r\n]', '_'
      $endpoint = if ($meta.type -eq "efactura") { "efactura" } else { "publine" }
      # Fără ghilimele interioare: PowerShell 5.1 le transmite greșit programelor externe; calea din coadă nu are spații.
      $form = @("-F", "file=@$data;filename=$safeName")
      if ($meta.spv_index) { $form += @("-F", "spv_index=$($meta.spv_index)") }
      $r = Invoke-Curl ($form + @("$server/api/ingest/$endpoint"))
      if ($r.Code -eq "200") {
        $res = $r.Body | ConvertFrom-Json
        $month = Join-Path $SentDir (Get-Date -Format "yyyy-MM")
        if (-not (Test-Path $month)) { New-Item -ItemType Directory -Path $month | Out-Null }
        Move-Item -LiteralPath $data -Destination (Join-Path $month (Split-Path $data -Leaf)) -Force
        Move-Item -LiteralPath $m.FullName -Destination (Join-Path $month $m.Name) -Force
        Set-Seen $meta.hash ([string]$res.status) $meta.name $meta.type; Save-State; $sent++
        if ($res.status -eq "duplicate") { Write-Log "INFO" ("{0}: deja importat anterior pe server (nimic dublat)." -f $meta.name) }
        elseif ($meta.type -eq "publine") { Write-Log "INFO" ("Trimis {0}: {1} linii noi, {2} existente, totaluri reconciliate={3}" -f $meta.name, $res.rowsInserted, $res.rowsDuplicate, $res.reconciled) }
        else { Write-Log "INFO" ("Trimis {0}: {1} — {2}" -f $meta.name, $res.status, $res.message) }
      } elseif (@("400", "413", "422") -contains $r.Code) {
        Move-Item -LiteralPath $data -Destination (Join-Path $RejectedDir (Split-Path $data -Leaf)) -Force
        Move-Item -LiteralPath $m.FullName -Destination (Join-Path $RejectedDir $m.Name) -Force
        Set-Seen $meta.hash "rejected" $meta.name $meta.type; Save-State; $failed++
        Write-Log "ERROR" "Respins de server: $($meta.name) (cod $($r.Code)) $($r.Body)"
      } elseif ($r.Code -eq "401") {
        Write-Log "ERROR" "Cheia agentului a fost refuzată; opresc trimiterea."; break
      } else {
        $meta.attempts = [int]$meta.attempts + 1
        ($meta | ConvertTo-Json -Depth 3) | Set-Content -LiteralPath $m.FullName -Encoding UTF8
        Write-Log "WARN" "Trimitere eșuată pentru $($meta.name) (cod $($r.Code), încercarea $($meta.attempts)). Rămâne în coadă."
        if ($r.Code -eq "000") { break }   # fără conexiune: reîncercăm la rularea următoare
      }
    }
  }

  # ---------------------------------------------------------------- curățenie și stare
  Get-ChildItem -LiteralPath $SentDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepSent) } | Remove-Item -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath $LogDir -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepLogs) } | Remove-Item -ErrorAction SilentlyContinue

  $queued = @(Get-ChildItem -LiteralPath $QueueDir -Recurse -Filter *.json -File -ErrorAction SilentlyContinue).Count
  $rejected = @(Get-ChildItem -LiteralPath $RejectedDir -Filter *.json -File -ErrorAction SilentlyContinue).Count
  $status = [ordered]@{
    version = $AgentVersion; host = $env:COMPUTERNAME; at = (Get-Date -Format s); online = $online
    queued = $queued; rejected = $rejected; sent_this_run = $sent; failed_this_run = $failed
    sources = $sourceStatus; lastError = $script:LastError
  }
  $json = $status | ConvertTo-Json -Depth 4
  $json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
  if ($online) {
    $tmpJson = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($tmpJson, $json, (New-Object Text.UTF8Encoding($false)))
    Invoke-Curl @("-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@$tmpJson", "$server/api/agent/heartbeat") | Out-Null
    Remove-Item $tmpJson -ErrorAction SilentlyContinue
  }
  if ($sent -or $failed -or $queued) { Write-Log "INFO" "Rulare încheiată: $sent trimise, $failed respinse, $queued în coadă." }
} catch {
  Write-Log "ERROR" "Eroare neașteptată: $($_.Exception.Message)"
  exit 1
} finally {
  $mutex.ReleaseMutex()
}
