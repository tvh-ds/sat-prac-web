$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:54321"
$anon = (Get-Content "D:\SAT website\frontend\.env" | Select-String '^VITE_SUPABASE_ANON_KEY=(.*)$').Matches[0].Groups[1].Value

$s = Invoke-RestMethod -Uri "$base/auth/v1/token?grant_type=password" -Method Post -Headers @{ apikey = $anon; "Content-Type" = "application/json" } -Body (@{ email = "jane.student@test.local"; password = "Student123!" } | ConvertTo-Json)
$H = @{ apikey = $anon; Authorization = "Bearer $($s.access_token)"; "Content-Type" = "application/json" }
$today = (Get-Date).ToString("yyyy-MM-dd")

# 1. create deck
$d = (Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/decks" -Method Post -Headers $H -Body (@{ name = "SAT Words"; description = "high-frequency"; color = "#7f1d1d" } | ConvertTo-Json)).deck
Write-Host "1. deck created: $($d.name) ($($d.id))"

# 2. single card
$c1 = (Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/cards" -Method Post -Headers $H -Body (@{ deck_id = $d.id; word = "ubiquitous"; definition = "present everywhere"; part_of_speech = "adjective"; tags = @("common") } | ConvertTo-Json)).card
Write-Host "2. card created: $($c1.word)"

# 3. bulk import (tsv + csv)
$bulk = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/cards/import" -Method Post -Headers $H -Body (@{ deck_id = $d.id; text = "meticulous	showing great attention to detail; very careful
pragmatic	dealing with things sensibly, practical
tenacious,holding firmly; persistent,example: her tenacious grip
ephemeral,lasting a very short time
ubiquitous	duplicate word line" } | ConvertTo-Json)
Write-Host "3. import: $($bulk.imported) imported, $($bulk.skipped) skipped (dup expected)"

# 4. study queue (all new -> due)
$study = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/study?deck_id=$($d.id)" -Method Get -Headers $H
Write-Host "4. study queue: due=$($study.due_count) cards=$($study.cards.Count)"
$first = $study.cards[0]
Write-Host "   first: $($first.card.word) state=$($first.state.status)"

# 5. reviews: good(3), again(1), easy(4), hard(2)
$r1 = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/review" -Method Post -Headers $H -Body (@{ card_id = $first.card.id; rating = 3; mode = "study"; response_ms = 1200; reviewed_on = $today } | ConvertTo-Json)
Write-Host "5a. good -> interval=$($r1.next_state.interval_days)d status=$($r1.next_state.status) due=$($r1.next_state.due_at.Substring(0,10))"
$c2 = $study.cards[1].card
$r2 = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/review" -Method Post -Headers $H -Body (@{ card_id = $c2.id; rating = 1; mode = "study"; reviewed_on = $today } | ConvertTo-Json)
Write-Host "5b. again -> interval=$($r2.next_state.interval_days)d status=$($r2.next_state.status)"
$c3 = $study.cards[2].card
$r3 = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/review" -Method Post -Headers $H -Body (@{ card_id = $c3.id; rating = 4; mode = "study"; reviewed_on = $today } | ConvertTo-Json)
Write-Host "5c. easy -> interval=$($r3.next_state.interval_days)d status=$($r3.next_state.status)"
$c4 = $study.cards[3].card
$r4 = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/review" -Method Post -Headers $H -Body (@{ card_id = $c4.id; rating = 2; mode = "study"; reviewed_on = $today } | ConvertTo-Json)
Write-Host "5d. hard -> interval=$($r4.next_state.interval_days)d status=$($r4.next_state.status)"

# 6. study queue now: only 'again' card remains due (dup card skipped has no state -> also due)
$study2 = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/study?deck_id=$($d.id)" -Method Get -Headers $H
Write-Host "6. study after reviews: due=$($study2.due_count) (again card + new dup)"
$stillDue = @($study2.cards | Where-Object { $_.card.id -eq $c2.id }).Count
Write-Host "   again-card still due: $($stillDue -gt 0)"

# 7. sprint mode
$sprint = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/sprint?deck_id=$($d.id)" -Method Get -Headers $H
Write-Host "7. sprint cards: $($sprint.cards.Count)"
$missed = $sprint.cards[0]
Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/review" -Method Post -Headers $H -Body (@{ card_id = $missed.id; rating = 1; mode = "sprint"; reviewed_on = $today } | ConvertTo-Json) | Out-Null
$sp2 = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/review" -Method Post -Headers $H -Body (@{ card_id = $sprint.cards[1].id; rating = 4; mode = "sprint"; reviewed_on = $today } | ConvertTo-Json)
Write-Host "   sprint reviews posted, no SM-2 state returned: $($null -eq $sp2.next_state)"

# 8. dashboard
$db = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab" -Method Get -Headers $H
$deck = $db.decks[0]
Write-Host "8. dashboard: cards=$($db.totals.cards) due=$($db.totals.due) new=$($db.totals.fresh) today=$($db.today.reviewed) streak=$($db.streak.current) best=$($db.streak.best) heatmapDays=$($db.heatmap.Count)"
Write-Host "   deck: $($deck.name) cards=$($deck.card_count) due=$($deck.due_count) new=$($deck.new_count)"

# 9. edit + delete
$upd = (Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/cards/$($c1.id)" -Method Patch -Headers $H -Body (@{ definition = "present, appearing, or found everywhere" } | ConvertTo-Json)).card
Write-Host "9a. card updated: $($upd.definition.Substring(0,20))..."
$deckUpd = (Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/decks/$($d.id)" -Method Patch -Headers $H -Body (@{ color = "#1d4ed8" } | ConvertTo-Json)).deck
Write-Host "9b. deck color: $($deckUpd.color)"
Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/cards/$($c1.id)" -Method Delete -Headers $H | Out-Null
$delDeck = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/decks/$($d.id)" -Method Delete -Headers $H
Write-Host "9c. deleted card + deck: ok=$($delDeck.ok)"

# 10. all-decks study (no deck_id)
$all = Invoke-RestMethod -Uri "$base/functions/v1/student-vocab/study" -Method Get -Headers $H
Write-Host "10. all-decks study: $($all.cards.Count) cards"
Write-Host "=== VOCAB E2E OK ==="