$ErrorActionPreference = "Continue"
$base = "http://127.0.0.1:54321"

Push-Location "D:\SAT website\backend"
$envOut = npx --yes supabase@2.115.0 status -o env 2>$null
Pop-Location
$anon = (($envOut | Select-String '^ANON_KEY="(.*)"$').Matches[0].Groups[1].Value)
$srv = (($envOut | Select-String '^SERVICE_ROLE_KEY="(.*)"$').Matches[0].Groups[1].Value)
if (-not $anon) { $anon = (($envOut | Select-String '^PUBLISHABLE_KEY="(.*)"$').Matches[0].Groups[1].Value) }
if (-not $srv) { $srv = (($envOut | Select-String '^SECRET_KEY="(.*)"$').Matches[0].Groups[1].Value) }
if (-not $anon -or -not $srv) { Write-Host "could not read keys"; exit 1 }

$email = "admin.import@test.local"
$pass = "ImportTest123!"
$jsonHeaders = @{ apikey = $anon; "Content-Type" = "application/json" }
$body = @{ email = $email; password = $pass } | ConvertTo-Json

# 1. ensure admin user exists (ignore "already registered")
try {
  Invoke-RestMethod -Uri "$base/auth/v1/signup" -Method Post -Headers $jsonHeaders -Body $body | Out-Null
  Write-Host "1. signup ok"
} catch {
  Write-Host "1. signup skipped (user already exists): $($_.Exception.Message)"
}

# 2. promote to admin (idempotent)
$users = Invoke-RestMethod -Uri "$base/auth/v1/admin/users?page=1&per_page=200" -Method Get -Headers @{ apikey = $srv; Authorization = "Bearer $srv" }
$uid = ($users.users | Where-Object { $_.email -eq $email } | Select-Object -First 1).id
if ($uid) {
  Invoke-RestMethod -Uri "$base/rest/v1/profiles?id=eq.$uid" -Method Patch -Headers @{ apikey = $srv; Authorization = "Bearer $srv"; "Content-Type" = "application/json" } -Body '{"role":"admin"}' | Out-Null
  Write-Host "2. promoted $email to admin"
} else {
  Write-Host "2. FAILED: user not found"; exit 1
}

# 3. sign in
$signin = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers $jsonHeaders -Body $body
Write-Host "3. signed in"
$token = $signin.access_token

# 4. upload PDF to storage, then register import via admin-pdf-imports
$pdfPath = "uploads/sample-$([guid]::NewGuid().ToString('N')).pdf"
$upload = curl.exe -s -X POST -H "apikey: $srv" -H "Authorization: Bearer $srv" -H "Content-Type: application/pdf" --data-binary "@D:\SAT website\backend\worker\sample-pdf.pdf" "$base/storage/v1/object/pdf-imports/$pdfPath"
Write-Host "4. storage upload: $upload"
$size = (Get-Item "D:\SAT website\backend\worker\sample-pdf.pdf").Length
$importBody = @{ storage_path = $pdfPath; original_filename = "sample-pdf.pdf"; file_size = $size } | ConvertTo-Json
$import = Invoke-RestMethod -Uri "$base/functions/v1/admin-pdf-imports" -Method Post -Headers @{ apikey = $anon; Authorization = "Bearer $token"; "Content-Type" = "application/json" } -Body $importBody
Write-Host "4b. import: id=$($import.import.id) status=$($import.import.status) path=$($import.import.storage_path)"
if (-not $import.import.id) { Write-Host "   response: $($import | ConvertTo-Json)"; exit 1 }

# 5. run worker
$proc = Invoke-RestMethod -Uri "http://127.0.0.1:8000/process" -Method Post -ContentType "application/json" -Body (@{ import_id = $import.import.id } | ConvertTo-Json)
Write-Host "5. worker: $($proc | ConvertTo-Json -Compress -Depth 5)"

# 6. verify drafts (included in import detail)
$detail = Invoke-RestMethod -Uri "$base/functions/v1/admin-pdf-imports/$($import.import.id)" -Method Get -Headers @{ apikey = $anon; Authorization = "Bearer $token" }
Write-Host "6. drafts: $($detail.drafts.Count)"
foreach ($d in $detail.drafts) {
  Write-Host "   #$($d.source_question_number) $($d.section) [$($d.question_type)] $($d.status) suggested=$($d.suggested_answer) | $($d.prompt.Substring(0, [Math]::Min(45, $d.prompt.Length)))"
}
Write-Host "7. import status: $($detail.import.status) pages=$($detail.import.page_count) method=$($detail.import.extraction_method)"