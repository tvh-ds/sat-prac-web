@echo off
cd /d "D:\SAT website\backend\worker"
npx tsx scripts/import-ocr-folder.ts "D:\SAT website\Tests Unparsed\Digital SAT Tests" "D:\SAT website\Tests Unparsed\post_ocr" 2025 2026 --report tmp/import-pass-24.json --only "202503asiav2,202503asiav3,202503usv2,202505asiav1,202506asiav1-rw,202506asiav3,202506asiav4,202508asiav1,202508asiav2-rw,202508asiav3-rw,202509asiav1,202509asiav2,202509us01,202509us06,202509usv7,202510usv1,202510usv2,202510usv3,202512asiav1,202605asIav1-rw,202605usv1-rw,202606asiav1,202606asiav2,202606asiav3" > tmp\import-pass-24.log 2>&1
