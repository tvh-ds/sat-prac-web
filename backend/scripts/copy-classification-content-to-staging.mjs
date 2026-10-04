// Production is a strictly GET-only source. Writes are pinned to verified staging.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const CLI = process.env.SUPABASE_CLI_JS;
if (!CLI) throw new Error('Set SUPABASE_CLI_JS to the installed Supabase CLI entrypoint');
const sourceRef = 'ygqndcgpbtmewzkruyuq', targetRef = 'wgkggknyndgaoyazdhdf';
const apply = process.argv.includes('--apply');
const assetsOnly = process.argv.includes('--assets-only');
const manifestFile = 'tmp/classification-content-copy.json';
function cli(args) {
  // Secret API-key responses remain in memory; never relay child output on errors.
  try { return JSON.parse(execFileSync(process.execPath, [CLI, ...args, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw new Error('Supabase credential/project verification failed'); }
}
const projects = cli(['projects', 'list']);
if (!projects.some(p => p.id === targetRef && p.name === 'sat-website-staging') ||
    !projects.some(p => p.id === sourceRef && p.name === 'sat-practice')) throw new Error('Project identity verification failed');
const key = ref => {
  const entries = cli(['projects', 'api-keys', '--project-ref', ref]);
  const item = entries.find(k => k.name === 'service_role');
  if (!item?.api_key || !item.api_key.startsWith('eyJ')) throw new Error('Legacy service credential unavailable');
  return item.api_key;
};
const sourceKey = key(sourceRef), targetKey = key(targetRef);
const sourceUrl = `https://${sourceRef}.supabase.co`, targetUrl = `https://${targetRef}.supabase.co`;
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { source: sourceRef, target: targetRef, tables: {}, assets: { copied: 0, existing: 0, missing: [] } };
function checkpoint() { fs.mkdirSync('tmp', { recursive: true }); fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2)); }
async function sourceGet(path) {
  const response = await fetch(sourceUrl + path, { method: 'GET', headers: { apikey: sourceKey, Authorization: `Bearer ${sourceKey}` }, signal: AbortSignal.timeout(60000) });
  return response;
}
async function read(table, filter='') {
  const all=[];
  for(let offset=0;;offset+=500){
    const response=await sourceGet(`/rest/v1/${table}?select=*&order=id&limit=500&offset=${offset}${filter ? '&'+filter : ''}`);
    if(!response.ok) throw new Error(`Read-only source ${table}: ${response.status}`);
    const batch=await response.json();all.push(...batch);if(batch.length<500)break;
  }
  return all;
}
async function insert(table, rows, transform=x=>x) {
  if (apply && assetsOnly) {
    if (manifest.tables[table] !== rows.length) throw new Error('Row copy is incomplete; rerun without --assets-only');
    return;
  }
  manifest.tables[table] = rows.length;
  if(!apply) { console.log(`${table}: ${rows.length} rows (dry run)`); return; }
  for(let i=0;i<rows.length;i+=100){
    const conflict = table === 'question_choices' ? 'question_id,label' : table === 'draft_question_choices' ? 'draft_question_id,label' : table === 'test_module_questions' ? 'module_id,question_id' : 'id';
    const response=await fetch(`${targetUrl}/rest/v1/${table}?on_conflict=${conflict}`, { method:'POST',
      headers:{apikey:targetKey,Authorization:`Bearer ${targetKey}`,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},
      body:JSON.stringify(rows.slice(i,i+100).map(transform)),signal:AbortSignal.timeout(60000)});
    if(!response.ok) {
      const error=await response.json().catch(()=>({}));
      throw new Error(`Staging insert ${table}: ${response.status} ${error.code ?? ''} ${String(error.message ?? '').slice(0,180)}`);
    }
  }
  checkpoint(); console.log(`${table}: ${rows.length} source rows copied; existing IDs preserved`);
}
function scrub(row) {
  const copy={...row};
  for(const field of ['created_by','human_reviewed_by','review_job_id','decided_by']) if(field in copy)copy[field]=null;
  return copy;
}
const tests=await read('tests','kind=eq.full'); const testIds=new Set(tests.map(t=>t.id));
const imports=await read('pdf_imports');
const passages=await read('passages');
const questions=await read('questions');
const drafts=await read('draft_questions');
await insert('tests',tests,scrub);
await insert('pdf_imports',imports,row=>({...scrub(row),generated_test_id:testIds.has(row.generated_test_id)?row.generated_test_id:null,
  status:['completed','failed','cancelled','needs_review'].includes(row.status)?row.status:'cancelled'}));
await insert('passages',passages,scrub);
await insert('questions',questions,scrub);
await insert('question_choices',await read('question_choices'));
const sections=(await read('test_sections')).filter(s=>testIds.has(s.test_id)); const sectionIds=new Set(sections.map(s=>s.id));
const modules=(await read('test_modules')).filter(m=>sectionIds.has(m.section_id)); const moduleIds=new Set(modules.map(m=>m.id));
await insert('test_sections',sections);await insert('test_modules',modules);
await insert('test_module_questions',(await read('test_module_questions')).filter(q=>moduleIds.has(q.module_id)));
await insert('pdf_import_pages',await read('pdf_import_pages'));
await insert('draft_questions',drafts,scrub);
await insert('draft_question_choices',await read('draft_question_choices'));
await insert('draft_answer_keys',await read('draft_answer_keys'));
await insert('question_sources',await read('question_sources'));
const assets=new Map();
for(const imp of imports) if(imp.storage_path)assets.set(`pdf-imports/${imp.storage_path}`,['pdf-imports',imp.storage_path]);
for(const row of [...questions,...drafts])for(const field of ['stimulus_image_path','stimulus_source_image_path','review_source_image_path'])
  if(row[field])assets.set(`question-assets/${row[field]}`,['question-assets',row[field]]);
console.log(`Referenced assets: ${assets.size}; production writes: 0`);
if(apply){
  const pendingAssets=[...assets];let assetIndex=0;
  await Promise.all(Array.from({length:4},async()=>{while(assetIndex<pendingAssets.length){
    const [asset,[bucket,name]]=pendingAssets[assetIndex++];
    const encoded=name.split('/').map(encodeURIComponent).join('/');
    const found=await fetch(`${targetUrl}/storage/v1/object/info/${bucket}/${encoded}`,{headers:{apikey:targetKey,Authorization:`Bearer ${targetKey}`}});
    if(found.ok){manifest.assets.existing++;manifest.assets.missing=manifest.assets.missing.filter(m=>m!==asset);continue;}
    if(found.status!==404 && found.status!==400)throw new Error(`Staging asset lookup ${found.status}`);
    const response=await sourceGet(`/storage/v1/object/${bucket}/${encoded}`);
    if(response.status===404 || response.status===400){if(!manifest.assets.missing.includes(asset))manifest.assets.missing.push(asset);continue;}
    if(!response.ok)throw new Error(`Read-only asset download ${response.status}`);
    const bytes=await response.arrayBuffer();
    let upload;
    for(let attempt=0;attempt<4;attempt++){
      upload=await fetch(`${targetUrl}/storage/v1/object/${bucket}/${encoded}`,{method:'POST',
        headers:{apikey:targetKey,Authorization:`Bearer ${targetKey}`,'Content-Type':response.headers.get('Content-Type')??'application/octet-stream','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(60000)});
      if(upload.ok || upload.status===409)break;
      if(![429,500,502,503,504,520,522,524].includes(upload.status) || attempt===3)throw new Error(`Staging asset upload ${upload.status}`);
      await new Promise(r=>setTimeout(r,1000*2**attempt));
    }
    manifest.assets.copied++; if(manifest.assets.copied%50===0){checkpoint();console.log(`Assets copied: ${manifest.assets.copied}`);}
  }}));
  checkpoint();console.log(JSON.stringify({tables:manifest.tables,assets:manifest.assets.copied,missing_assets:manifest.assets.missing.length}));
}
