$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:54321"
$anon = (Get-Content "D:\SAT website\frontend\.env" | Select-String '^VITE_SUPABASE_ANON_KEY=(.*)$').Matches[0].Groups[1].Value
Start-Sleep -Seconds 8
$signin = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = "jane.student@test.local"; password = "Student123!" } | ConvertTo-Json)
$H = @{ apikey = $anon; Authorization = "Bearer $($signin.access_token)"; "Content-Type" = "application/json" }

# 1. start or resume attempt
$existing = $null
try {
  $existing = Invoke-RestMethod -Uri "$base/functions/v1/student-attempts/current" -Method Get -Headers $H
  Write-Host "0. resumed existing attempt $($existing.attempt.id)"
} catch { }
if ($existing) {
  $aid = $existing.attempt.id
  $start = $existing
} else {
  $start = Invoke-RestMethod -Uri "$base/functions/v1/student-attempts" -Method Post -Headers $H -Body (@{ test_id = "00000000-0000-0000-0000-000000000401" } | ConvertTo-Json)
  $aid = $start.attempt_id
  Write-Host "1. started attempt $aid"
}
$sections = $start.test.sections
Write-Host "   sections: $($sections.Count)"
$mods = @($sections | ForEach-Object { $_.modules })
Write-Host "   modules: $($mods.Count)"
$firstMod = $sections[0].modules[0]
$hasPassage = @($firstMod.questions | Where-Object { $_.question.passage }).Count -gt 0
Write-Host "   first module: $($firstMod.name) q=$($firstMod.questions.Count) passage_included=$hasPassage"

# 2. current (resume path, no test_id)
$cur = Invoke-RestMethod -Uri "$base/functions/v1/student-attempts/current" -Method Get -Headers $H
Write-Host "2. current: attempt=$($cur.attempt.id) curMod=$($cur.attempt.current_module_id) modules=$($cur.modules.Count) seconds_left=$($cur.modules[0].seconds_left)"

# 3. save a response: answer q1 (choice) + mark q2 for review
$q1 = $firstMod.questions[0].question
$q2 = $firstMod.questions[1].question
$c1 = ($q1.choices | Sort-Object position)[0]
$r1 = Invoke-RestMethod -Uri "$base/functions/v1/student-responses" -Method Post -Headers $H -Body (@{
  attempt_id = $aid; question_id = $q1.id; module_id = $firstMod.id
  selected_choice_id = $c1.id; marked_for_review = $false; time_spent_seconds = 5
} | ConvertTo-Json)
Write-Host "3a. saved q1 -> choice $($c1.label)"
$r2 = Invoke-RestMethod -Uri "$base/functions/v1/student-responses" -Method Post -Headers $H -Body (@{
  attempt_id = $aid; question_id = $q2.id; module_id = $firstMod.id
  marked_for_review = $true; time_spent_seconds = 3
} | ConvertTo-Json)
Write-Host "3b. saved q2 -> marked=$($r2.response.marked_for_review)"

# 4-5. advance through every remaining module, answer one question each, then submit
$allMods = @($sections | ForEach-Object { $_.modules })
for ($i = 1; $i -lt $allMods.Count; $i++) {
  $adv = Invoke-RestMethod -Uri "$base/functions/v1/student-attempts/advance" -Method Post -Headers $H -Body (@{ attempt_id = $aid; module_id = $allMods[$i].id; time_spent_seconds = 20 } | ConvertTo-Json)
  Write-Host "4.$i advanced -> $($adv | ConvertTo-Json -Compress)"
  $qq = $allMods[$i].questions[0].question
  if ($qq.question_type -eq "multiple_choice") {
    $cc = ($qq.choices | Sort-Object position)[0]
    Invoke-RestMethod -Uri "$base/functions/v1/student-responses" -Method Post -Headers $H -Body (@{ attempt_id = $aid; question_id = $qq.id; module_id = $allMods[$i].id; selected_choice_id = $cc.id; time_spent_seconds = 4 } | ConvertTo-Json) | Out-Null
  }
}
$sub = Invoke-RestMethod -Uri "$base/functions/v1/student-submit" -Method Post -Headers $H -Body (@{ attempt_id = $aid } | ConvertTo-Json)
Write-Host "5. submitted -> $($sub | ConvertTo-Json -Compress)"

# 6. score report
$score = Invoke-RestMethod -Uri "$base/functions/v1/student-scores/$aid" -Method Get -Headers $H
Write-Host "6. score report: status=$($score.attempt.status) reviewItems=$($score.review.Count) score=$($score.attempt.score.raw_score)/$($score.attempt.score.total_questions)"
$first = $score.review[0]
Write-Host "   item1: correct=$($first.is_correct) your_answer=$($first.your_answer) correct_answers=$($first.correct_answers.Count)"
Write-Host "=== FRONTEND FLOW OK ==="