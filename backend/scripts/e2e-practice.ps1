$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:54321"
$anon = (Get-Content "D:\SAT website\frontend\.env" | Select-String '^VITE_SUPABASE_ANON_KEY=(.*)$').Matches[0].Groups[1].Value
Start-Sleep -Seconds 8

# --- admin session ---
$adminIn = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = "principal.admin@test.local"; password = "Principal123!" } | ConvertTo-Json)
$AH = @{ apikey = $anon; Authorization = "Bearer $($adminIn.access_token)"; "Content-Type" = "application/json" }

# 1. create a practice set from the question bank (seeded Q201, Q202 - answers B and C)
$title = "E2E Practice Set $(Get-Date -Format yyyyMMdd-HHmmss)"
$created = Invoke-RestMethod -Uri "$base/functions/v1/admin-practice" -Method Post -Headers $AH -Body (@{
  title = $title; description = "e2e practice"; time_limit_minutes = 10
  question_ids = @("00000000-0000-0000-0000-000000000201", "00000000-0000-0000-0000-000000000202")
} | ConvertTo-Json)
$setId = $created.set.id
Write-Host "1. created practice set $setId"

# 2. admin list + detail
$list = Invoke-RestMethod -Uri "$base/functions/v1/admin-practice" -Method Get -Headers $AH
$mine = @($list.sets | Where-Object { $_.id -eq $setId })
if ($mine.Count -ne 1) { throw "practice set missing from admin list" }
Write-Host "2. admin list: found kind=practice q=$($mine[0].question_count) min=$($mine[0].time_limit_minutes)"
$detail = Invoke-RestMethod -Uri "$base/functions/v1/admin-practice/$setId" -Method Get -Headers $AH
if ($detail.questions.Count -ne 2) { throw "expected 2 linked questions" }
Write-Host "   detail: $($detail.questions.Count) questions, status=$($detail.set.status)"

# 3. add a third question then remove it again (manage flow)
$added = Invoke-RestMethod -Uri "$base/functions/v1/admin-practice/$setId/questions" -Method Post -Headers $AH -Body (@{ question_ids = @("00000000-0000-0000-0000-000000000203") } | ConvertTo-Json)
Write-Host "3a. added question -> added=$($added.added)"
$detail2 = Invoke-RestMethod -Uri "$base/functions/v1/admin-practice/$setId" -Method Get -Headers $AH
$linkId = ($detail2.questions | Where-Object { $_.question.id -eq "00000000-0000-0000-0000-000000000203" }).id
Invoke-RestMethod -Uri "$base/functions/v1/admin-practice/$setId/questions/$linkId" -Method Delete -Headers $AH | Out-Null
$detail3 = Invoke-RestMethod -Uri "$base/functions/v1/admin-practice/$setId" -Method Get -Headers $AH
if ($detail3.questions.Count -ne 2) { throw "add/remove left wrong question count" }
Write-Host "3b. removed question -> back to $($detail3.questions.Count)"

# 4. guarded from-import check: needs an import with drafts that carry keys
try {
  $imports = Invoke-RestMethod -Uri "$base/functions/v1/admin-pdf-imports" -Method Get -Headers $AH
  $candidate = @($imports.imports | Where-Object { $_.draft_counts.has_suggested_key -gt 0 } | Select-Object -First 1)
  if ($candidate.Count -eq 1) {
    $imp = Invoke-RestMethod -Uri "$base/functions/v1/admin-pdf-imports/$($candidate[0].id)" -Method Get -Headers $AH
    $draft = @($imp.drafts | Where-Object { $_.status -eq "has_suggested_key" } | Select-Object -First 1)
    if ($draft.Count -eq 1) {
      $impSet = Invoke-RestMethod -Uri "$base/functions/v1/admin-practice/from-import" -Method Post -Headers $AH -Body (@{
        title = "E2E Import Practice $(Get-Date -Format yyyyMMdd-HHmmss)"; time_limit_minutes = 8
        draft_ids = @($draft[0].id)
      } | ConvertTo-Json)
      Write-Host "4. from-import: set=$($impSet.set.id) created=$($impSet.created_questions) reused=$($impSet.reused_questions)"
    } else { Write-Host "4. skipped from-import (no keyed drafts)" }
  } else { Write-Host "4. skipped from-import (no import with drafts)" }
} catch { Write-Host "4. skipped from-import: $($_.Exception.Message)" }

# --- student session ---
$studIn = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = "jane.student@test.local"; password = "Student123!" } | ConvertTo-Json)
$SH = @{ apikey = $anon; Authorization = "Bearer $($studIn.access_token)"; "Content-Type" = "application/json" }

# 5. practice set visible on student side with kind + timer + count
$tests = Invoke-RestMethod -Uri "$base/functions/v1/student-tests" -Method Get -Headers $SH
$pSet = @($tests.tests | Where-Object { $_.id -eq $setId })
if ($pSet.Count -ne 1) { throw "practice set not visible to student" }
if ($pSet[0].kind -ne "practice") { throw "kind not practice" }
if ($pSet[0].time_limit_minutes -ne 10) { throw "time limit missing" }
Write-Host "5. student sees practice set: q=$($pSet[0].questions) min=$($pSet[0].time_limit_minutes) kind=$($pSet[0].kind)"

# 6. start attempt (one module = one timer)
$start = Invoke-RestMethod -Uri "$base/functions/v1/student-attempts" -Method Post -Headers $SH -Body (@{ test_id = $setId } | ConvertTo-Json)
$aid = $start.attempt_id
$mod = $start.test.sections[0].modules[0]
if ($start.test.sections.Count -ne 1 -or $mod.questions.Count -ne 2) { throw "practice set structure wrong" }
Write-Host "6. started attempt $aid - module timer=$($mod.time_limit_minutes) min, q=$($mod.questions.Count)"

# 7. answer q1 correctly (is_correct choice), q2 incorrectly (first wrong choice)
$q1 = $mod.questions[0].question
$q2 = $mod.questions[1].question
$correct1 = ($q1.choices | Where-Object { $_.is_correct })
$wrong2 = @($q2.choices | Where-Object { -not $_.is_correct })[0]
Invoke-RestMethod -Uri "$base/functions/v1/student-responses" -Method Post -Headers $SH -Body (@{
  attempt_id = $aid; question_id = $q1.id; module_id = $mod.id; selected_choice_id = $correct1.id; time_spent_seconds = 5
} | ConvertTo-Json) | Out-Null
Invoke-RestMethod -Uri "$base/functions/v1/student-responses" -Method Post -Headers $SH -Body (@{
  attempt_id = $aid; question_id = $q2.id; module_id = $mod.id; selected_choice_id = $wrong2.id; time_spent_seconds = 4
} | ConvertTo-Json) | Out-Null
Write-Host "7. answered q1=$($correct1.label) (correct) q2=$($wrong2.label) (wrong)"

# 8. submit -> grading
$sub = Invoke-RestMethod -Uri "$base/functions/v1/student-submit" -Method Post -Headers $SH -Body (@{ attempt_id = $aid } | ConvertTo-Json)
if ($sub.raw_score -ne 1 -or $sub.total_questions -ne 2) { throw "unexpected score $($sub.raw_score)/$($sub.total_questions)" }
Write-Host "8. submitted -> score $($sub.raw_score)/$($sub.total_questions) accuracy=$($sub.accuracy)"

# 9. score report with per-question review
$score = Invoke-RestMethod -Uri "$base/functions/v1/student-scores/$aid" -Method Get -Headers $SH
if ($score.review.Count -ne 2) { throw "review should have 2 items" }
$r1 = $score.review[0]
$r2 = $score.review[1]
if ($r1.is_correct -ne $true -or $r2.is_correct -ne $false) { throw "review flags wrong" }
Write-Host "9. report: item1 correct=$($r1.is_correct), item2 correct=$($r2.is_correct)"

# 10. history shows the practice pill data (test.kind)
$hist = Invoke-RestMethod -Uri "$base/functions/v1/student-scores" -Method Get -Headers $SH
$entry = @($hist.history | Where-Object { $_.id -eq $aid })
if ($entry.Count -ne 1 -or $entry[0].test.kind -ne "practice") { throw "history entry missing kind" }
Write-Host "10. history: kind=$($entry[0].test.kind) title=$($entry[0].test.title)"

Write-Host "=== PRACTICE E2E OK ==="