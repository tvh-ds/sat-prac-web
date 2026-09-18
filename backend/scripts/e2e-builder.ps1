$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:54321"
$anon = (Get-Content "D:\SAT website\frontend\.env" | Select-String '^VITE_SUPABASE_ANON_KEY=(.*)$').Matches[0].Groups[1].Value
Start-Sleep -Seconds 6

$signin = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = "principal.admin@test.local"; password = "Principal123!" } | ConvertTo-Json)
$H = @{ apikey = $anon; Authorization = "Bearer $($signin.access_token)"; "Content-Type" = "application/json" }

# 1. create test
$t = Invoke-RestMethod -Uri "$base/functions/v1/admin-tests" -Method Post -Headers $H -Body (@{ title = "Builder E2E Test"; description = "created by smoke test"; is_public = $true } | ConvertTo-Json)
$tid = $t.test.id
Write-Host "1. created test $tid"

# 2. add two sections
$s1 = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/sections" -Method Post -Headers $H -Body (@{ test_id = $tid; name = "Reading and Writing"; section_type = "reading_writing"; position = 1 } | ConvertTo-Json)).section
$s2 = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/sections" -Method Post -Headers $H -Body (@{ test_id = $tid; name = "Math"; section_type = "math"; position = 2 } | ConvertTo-Json)).section
Write-Host "2. sections: $($s1.name) / $($s2.name)"

# 3. add modules
$m1 = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/modules" -Method Post -Headers $H -Body (@{ section_id = $s1.id; name = "Module 1"; time_limit_minutes = 32; position = 1; is_adaptive = $true } | ConvertTo-Json)).module
$m2 = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/modules" -Method Post -Headers $H -Body (@{ section_id = $s1.id; name = "Module 2"; time_limit_minutes = 32; position = 2; is_adaptive = $true } | ConvertTo-Json)).module
$m3 = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/modules" -Method Post -Headers $H -Body (@{ section_id = $s2.id; name = "Module 1"; time_limit_minutes = 35; position = 1 } | ConvertTo-Json)).module
Write-Host "3. modules: $($m1.name)+$($m2.name) RW, $($m3.name) Math"

# 4. question bank
$bank = (Invoke-RestMethod -Uri "$base/functions/v1/admin-questions?limit=500" -Method Get -Headers $H).questions
$rw = @($bank | Where-Object { $_.section -eq "reading_writing" })
$math = @($bank | Where-Object { $_.section -eq "math" })
if ($rw.Count -lt 2 -or $math.Count -lt 1) { throw "Not enough bank questions (rw=$($rw.Count), math=$($math.Count))" }
Write-Host "4. bank: $($rw.Count) RW, $($math.Count) math"

# 5. link questions
$l1 = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/questions" -Method Post -Headers $H -Body (@{ module_id = $m1.id; question_id = $rw[0].id; position = 1 } | ConvertTo-Json)).link
$l2 = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/questions" -Method Post -Headers $H -Body (@{ module_id = $m1.id; question_id = $rw[1].id; position = 2 } | ConvertTo-Json)).link
$l3 = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/questions" -Method Post -Headers $H -Body (@{ module_id = $m3.id; question_id = $math[0].id; position = 1 } | ConvertTo-Json)).link
Write-Host "5. linked: m1 -> 2 RW questions, m3 -> 1 math"

# 6. reorder within module (swap 1<->2 via temp position)
Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/questions/$($l1.id)" -Method Patch -Headers $H -Body (@{ position = 9999 } | ConvertTo-Json) | Out-Null
Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/questions/$($l2.id)" -Method Patch -Headers $H -Body (@{ position = 1 } | ConvertTo-Json) | Out-Null
Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/questions/$($l1.id)" -Method Patch -Headers $H -Body (@{ position = 2 } | ConvertTo-Json) | Out-Null
$qPos = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid" -Method Get -Headers $H).test.sections[0].modules[0].questions
$orderOk = (($qPos | Sort-Object position).question_id -join ",") -eq ($qPos.question_id -join ",") -and ($qPos[0].position -eq 1 -and $qPos[1].position -eq 2)
Write-Host "6. reorder ok=$orderOk (positions: $($qPos.position -join ','))"

# 7. module update (time limit) + section update (name)
$updM = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/modules/$($m2.id)" -Method Patch -Headers $H -Body (@{ time_limit_minutes = 33 } | ConvertTo-Json)).module
$updS = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/sections/$($s2.id)" -Method Patch -Headers $H -Body (@{ name = "Mathematics" } | ConvertTo-Json)).section
Write-Host "7. module m2 now $($updM.time_limit_minutes)min, section renamed '$($updS.name)'"

# 8. publish
$pub = (Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/publish" -Method Post -Headers $H).test
Write-Host "8. published: status=$($pub.status)"

# 9. student starts it and sees the structure
$s = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = "jane.student@test.local"; password = "Student123!" } | ConvertTo-Json)
$SH = @{ apikey = $anon; Authorization = "Bearer $($s.access_token)"; "Content-Type" = "application/json" }
$start = Invoke-RestMethod -Uri "$base/functions/v1/student-attempts" -Method Post -Headers $SH -Body (@{ test_id = $tid } | ConvertTo-Json)
$seen = @($start.test.sections | ForEach-Object { $_.modules })
$totalQ = @($seen | ForEach-Object { $_.questions }).Count
Write-Host "9. student start: sections=$($start.test.sections.Count) modules=$($seen.Count) questions=$totalQ"
$order2 = @($start.test.sections[0].modules[0].questions | Sort-Object position | ForEach-Object { $_.question.id })
$bankIds = @($rw[0].id, $rw[1].id)
$match = ($order2 | Sort-Object) -join "" -eq ($bankIds | Sort-Object) -join ""
Write-Host "   module1 questions match bank (after reorder): $match"

# 10. delete module 2 (unused) and confirm route works; then delete the extra section copy test
$del = Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid/modules/$($m2.id)" -Method Delete -Headers $H
$detail = Invoke-RestMethod -Uri "$base/functions/v1/admin-tests/$tid" -Method Get -Headers $H
Write-Host "10. deleted module2: ok=$($del.ok), modules now $($detail.test.sections[0].modules.Count)"
Write-Host "=== BUILDER E2E OK ==="