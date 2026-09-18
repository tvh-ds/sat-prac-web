# End-to-end verification of the backend against the local Supabase stack.
# Prereqs: `supabase start` + `supabase functions serve` running in backend/.
$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:54321"

Push-Location "D:\SAT website\backend"
$statusEnv = (cmd /c "npx --yes supabase@2.115.0 status -o env 2>nul" | Out-String)
Pop-Location
$anonKey = ([regex]::Match($statusEnv, 'ANON_KEY="([^"]+)"')).Groups[1].Value.Trim()
$svcKey = ([regex]::Match($statusEnv, 'SERVICE_ROLE_KEY="([^"]+)"')).Groups[1].Value.Trim()
if (-not $anonKey) { $anonKey = ([regex]::Match($statusEnv, 'PUBLISHABLE_KEY="([^"]+)"')).Groups[1].Value.Trim() }
if (-not $svcKey) { $svcKey = ([regex]::Match($statusEnv, 'SECRET_KEY="([^"]+)"')).Groups[1].Value.Trim() }
Write-Host "anon=$anonKey"

$anonHeaders = @{ apikey = $anonKey; "Content-Type" = "application/json" }
$svcHeaders = @{ apikey = $svcKey; Authorization = "Bearer $svcKey"; "Content-Type" = "application/json" }

function Invoke-Fn($token, $fn, $method, $body) {
  $h = @{ apikey = $anonKey; Authorization = "Bearer $token"; "Content-Type" = "application/json" }
  if ($body -eq $null) { return Invoke-RestMethod -Uri "$base/functions/v1/$fn" -Method $method -Headers $h }
  return Invoke-RestMethod -Uri "$base/functions/v1/$fn" -Method $method -Headers $h -Body ($body | ConvertTo-Json -Depth 10)
}

Write-Host "=== Cleanup previous e2e users ==="
$existingUsers = Invoke-RestMethod -Uri "$base/auth/v1/admin/users?per_page=1000" -Method Get -Headers $svcHeaders
foreach ($u in $existingUsers.users) {
  if ($u.email -in @("admin.e2e@test.local", "student.e2e@test.local")) {
    Invoke-RestMethod -Uri "$base/auth/v1/admin/users/$($u.id)" -Method Delete -Headers $svcHeaders | Out-Null
    Write-Host "removed user $($u.email)"
  }
}

Write-Host "=== 1. Bootstrap admin user ==="
$admin = Invoke-RestMethod -Uri "$base/auth/v1/admin/users" -Method Post -Headers $svcHeaders -Body '{"email":"admin.e2e@test.local","password":"AdminPass123!","email_confirm":true,"user_metadata":{"full_name":"E2E Admin"}}'
docker exec supabase_db_backend psql -U postgres -d postgres -q -c "update public.profiles set role='admin' where id='$($admin.id)';"
Write-Host "admin created: $($admin.id)"

Write-Host "=== 2. Admin login ==="
$adminLogin = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers $anonHeaders -Body '{"email":"admin.e2e@test.local","password":"AdminPass123!"}'
Write-Host "admin token ok"

Write-Host "=== 3. Admin creates student (admin-students) ==="
$student = Invoke-Fn $adminLogin.access_token "admin-students" "Post" @{
  email = "student.e2e@test.local"
  temporary_password = "StudentPass123!"
  full_name = "E2E Student"
  grade_level = "11"
  school = "Demo High"
}
Write-Host "student created: $($student.student_id)"

Write-Host "=== 4. Student login + list tests (student-tests) ==="
$studentLogin = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers $anonHeaders -Body '{"email":"student.e2e@test.local","password":"StudentPass123!"}'
$tests = Invoke-Fn $studentLogin.access_token "student-tests" "Get" $null
Write-Host "available tests: $($tests.tests.Count)"
if ($tests.tests.Count -eq 0) { throw "No tests visible to student" }
$testId = $tests.tests[0].id
Write-Host "using test: $testId"

Write-Host "=== 5. Start attempt (student-attempts) ==="
$started = Invoke-Fn $studentLogin.access_token "student-attempts" "Post" @{ test_id = $testId }
$attemptId = $started.attempt_id
Write-Host "attempt: $attemptId"
$modules = $started.test.sections | ForEach-Object { $_.modules } | ForEach-Object { $_ }
Write-Host "modules: $($modules.Count)"

Write-Host "=== 6. Save responses (student-responses) ==="
$firstModule = $modules | Sort-Object position | Select-Object -First 1
$questions = $firstModule.questions | Sort-Object position
foreach ($q in $questions) {
  $qid = $q.question_id
  $choice = $q.question.choices | Select-Object -First 1
  Invoke-Fn $studentLogin.access_token "student-responses" "Post" @{
    attempt_id = $attemptId
    question_id = $qid
    module_id = $firstModule.id
    selected_choice_id = $choice.id
    marked_for_review = $false
    time_spent_seconds = 30
  } | Out-Null
  Write-Host "saved response for q: $qid -> choice $($choice.label)"
}
Invoke-Fn $studentLogin.access_token "student-responses" "Post" @{
  attempt_id = $attemptId
  question_id = $questions[0].question_id
  module_id = $firstModule.id
  marked_for_review = $true
} | Out-Null

Write-Host "=== 7. Resume attempt (student-attempts/current) ==="
$currentUrl = "$base/functions/v1/student-attempts/current?test_id=$testId"
$h = @{ apikey = $anonKey; Authorization = "Bearer $($studentLogin.access_token)" }
$resumed = Invoke-RestMethod -Uri $currentUrl -Method Get -Headers $h
Write-Host "resumed: responses saved=$($resumed.responses.Count), modules=$($resumed.modules.Count)"

Write-Host "=== 8. Submit attempt (student-submit) ==="
$sub = Invoke-Fn $studentLogin.access_token "student-submit" "Post" @{ attempt_id = $attemptId }
Write-Host "submitted: raw_score=$($sub.raw_score) / $($sub.total_questions) acc=$($sub.accuracy)"

Write-Host "=== 9. Score report (student-scores) ==="
$report = Invoke-RestMethod -Uri "$base/functions/v1/student-scores/$attemptId" -Method Get -Headers $h
Write-Host "report: sections=$($report.attempt.score.section_scores.PSObject.Properties.Count), review items=$($report.review.Count)"

Write-Host "=== 10. Admin progress (admin-progress) ==="
$ah = @{ apikey = $anonKey; Authorization = "Bearer $($adminLogin.access_token)" }
$students = Invoke-RestMethod -Uri "$base/functions/v1/admin-progress/students" -Method Get -Headers $ah
$me = $students.students | Where-Object { $_.id -eq $student.student_id }
Write-Host "student row: attempts=$($me.total_attempts) accuracy=$($me.accuracy)"
$detail = Invoke-RestMethod -Uri "$base/functions/v1/admin-progress/students/$($student.student_id)" -Method Get -Headers $ah
Write-Host "student detail: attempts=$($detail.attempts.Count) topics=$($detail.topics.Count)"
$attemptDetail = Invoke-RestMethod -Uri "$base/functions/v1/admin-progress/attempts/$attemptId" -Method Get -Headers $ah
Write-Host "attempt detail: responses=$($attemptDetail.responses.Count) status=$($attemptDetail.attempt.status)"

Write-Host "=== 11. Admin question bank CRUD (admin-questions) ==="
$newQ = Invoke-Fn $adminLogin.access_token "admin-questions" "Post" @{
  section = "math"
  question_type = "multiple_choice"
  prompt = "E2E question: what is 2 + 2?"
  domain = "algebra"
  difficulty = 1
  correct_answer = "B"
  choices = @(
    @{ label = "A"; text = "3"; is_correct = $false; position = 1 },
    @{ label = "B"; text = "4"; is_correct = $true; position = 2 },
    @{ label = "C"; text = "5"; is_correct = $false; position = 3 }
  )
}
Write-Host "question created: $($newQ.question.id)"
Invoke-RestMethod -Uri "$base/functions/v1/admin-questions/$($newQ.question.id)" -Method Patch -Headers $ah -Body (@{
  correct_answer = "A"
  explanation = "2+2=4"
} | ConvertTo-Json -Depth 5) | Out-Null
Write-Host "question updated"
$del = Invoke-RestMethod -Uri "$base/functions/v1/admin-questions/$($newQ.question.id)" -Method Delete -Headers $ah
Write-Host "question deleted: ok=$($del.ok)"

Write-Host "=== ALL E2E CHECKS PASSED ==="