$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:54321"
$anon = (Get-Content "D:\SAT website\frontend\.env" | Select-String '^VITE_SUPABASE_ANON_KEY=(.*)$').Matches[0].Groups[1].Value
Start-Sleep -Seconds 6

$s = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = "jane.student@test.local"; password = "Student123!" } | ConvertTo-Json)
$SH = @{ apikey = $anon; Authorization = "Bearer $($s.access_token)" }

$hist = (Invoke-RestMethod -Uri "$base/functions/v1/student-scores" -Method Get -Headers $SH).history
if ($hist.Count -eq 0) { throw "no graded attempts" }
$aid = $hist[0].id
Write-Host "attempt: $aid ($($hist[0].test.title))"

$d = Invoke-RestMethod -Uri "$base/functions/v1/student-scores/$aid" -Method Get -Headers $SH
$rev = $d.review
Write-Host "review items: $($rev.Count) (full test structure)"
$numSeq = $true
$i = 1
foreach ($r in $rev) { if ($r.question_number -ne $i) { $numSeq = $false }; $i++ }
Write-Host "sequential numbering: $numSeq"
Write-Host "first: Q$($rev[0].question_number) [$($rev[0].section_name)] $($rev[0].module_name) correct=$(if ($null -eq $rev[0].is_correct) {'null'} else {$rev[0].is_correct}) unanswered=$($rev[0].unanswered)"
$un = @($rev | Where-Object { $_.unanswered }).Count
Write-Host "unanswered items: $un"
$mc = @($rev | Where-Object { $_.question_type -eq 'multiple_choice' })[0]
Write-Host "MC item: choices=$($mc.choices.Count) sel=$($mc.selected_choice_id) your_answer='$($mc.your_answer)' correct_answers=$($mc.correct_answers.Count)"

$tt = (Invoke-RestMethod -Uri "$base/functions/v1/student-tests" -Method Get -Headers $SH).tests
$tt | ForEach-Object { Write-Host "test list: $($_.title) sec=$($_.sections) mod=$($_.modules) q=$($_.questions)" }
Write-Host "=== STUDENT UI E2E OK ==="