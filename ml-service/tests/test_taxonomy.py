import json
import subprocess
from pathlib import Path


def test_application_and_service_taxonomy_are_identical():
    root = Path(__file__).resolve().parents[2]
    frontend = root / "frontend/src/lib/satTaxonomy.ts"
    script = """
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[1], 'utf8');
const start = text.indexOf('export const TAXONOMY');
const expression = text.slice(start).match(/=\\s*([\\s\\S]*?)\\s*as const/)[1];
process.stdout.write(JSON.stringify(Function('return (' + expression + ')')()));
"""
    application = json.loads(subprocess.check_output(["node", "-e", script, str(frontend)], text=True))
    service = json.loads((root / "ml-service/src/grit_ml/taxonomy.json").read_text())
    backend = json.loads((root / "backend/supabase/functions/_shared/sat-taxonomy.json").read_text())
    assert application == service == backend
    assert sum(len(domains) for domains in service.values()) == 8
    assert sum(len(skills) for domains in service.values() for skills in domains.values()) == 29
