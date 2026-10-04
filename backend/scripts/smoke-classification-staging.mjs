// Owned rollback-style fixture; no production access and no paid model calls.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import dotenv from '../worker/node_modules/dotenv/lib/main.js';
import assert from 'node:assert/strict';

const root=process.cwd();
const account=dotenv.parse(fs.readFileSync('backend/scripts/.env'));
const worker=dotenv.parse(fs.readFileSync('backend/worker/.env'));
const ref='wgkggknyndgaoyazdhdf';
if(new URL(account.SUPABASE_URL).hostname!==`${ref}.supabase.co` || new URL(worker.SUPABASE_URL).hostname!==`${ref}.supabase.co`)throw new Error('Staging reference mismatch');
const artifact=process.argv[2];if(!artifact || !fs.existsSync(path.join(artifact,'manifest.json')))throw new Error('Provide a fixture baseline artifact path');
const serviceToken=randomBytes(32).toString('hex');
fs.mkdirSync('tmp',{recursive:true});
const log=fs.openSync('tmp/classification-smoke-services.log','a');
const ml=spawn(path.resolve('ml-service/.venv/Scripts/python.exe'),['-m','uvicorn','grit_ml.api:create_app','--factory','--host','127.0.0.1','--port','8082'],{
  cwd:path.resolve('ml-service'),env:{...process.env,ML_SERVICE_TOKEN:serviceToken,ML_ARTIFACT_PATH:path.resolve(artifact)},stdio:['ignore',log,log],windowsHide:true});
const workerProcess=spawn(process.execPath,[path.resolve('backend/worker/node_modules/tsx/dist/cli.mjs'),path.resolve('backend/worker/src/server.ts')],{
  cwd:path.resolve('backend/worker'),env:{...process.env,...worker,PORT:'8002',ML_SERVICE_URL:'http://127.0.0.1:8082',ML_SERVICE_TOKEN:serviceToken},stdio:['ignore',log,log],windowsHide:true});
const imp=randomUUID(),draft=randomUUID();let created=false;
async function rest(table,method='GET',body,query=''){
  const response=await fetch(`${account.SUPABASE_URL}/rest/v1/${table}${query}`,{method,headers:{apikey:account.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${account.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});
  if(!response.ok)throw new Error(`${table}: ${response.status}`);return response.status===204?null:response.json();
}
async function waitFor(url,headers={}){for(let i=0;i<60;i++){try{const r=await fetch(url,{headers});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw new Error('Service failed to start');}
try{
  await Promise.all([waitFor('http://127.0.0.1:8082/health',{Authorization:`Bearer ${serviceToken}`}),waitFor('http://127.0.0.1:8002/health')]);
  const profiles=await rest('profiles','GET',null,'?select=id&role=eq.admin&limit=1');const actor=profiles[0]?.id;if(!actor)throw new Error('Admin fixture unavailable');
  await rest('pdf_imports','POST',{id:imp,storage_path:`classification-fixtures/${imp}.pdf`,original_filename:'Classification integration fixture',status:'completed',content_scope:'full_test',text_quality:{document_family:'full_test'},deterministic_review_status:'passed',created_by:actor});created=true;
  await rest('draft_questions','POST',{id:draft,pdf_import_id:imp,page_number:1,section:'math',question_type:'student_produced',prompt:'Linear equations in one variable 3 fixture index 9',review_state:'complete',status:'needs_review'});
  const rejected=await fetch('http://127.0.0.1:8002/classify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({import_id:imp,actor_id:actor})});assert.equal(rejected.status,401);
  const queued=await fetch('http://127.0.0.1:8002/classify',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${worker.WORKER_AUTH_TOKEN}`},body:JSON.stringify({import_id:imp,actor_id:actor,draft_ids:[draft]})});assert.equal(queued.status,202);
  const job=(await queued.json()).job;
  let suggestions;
  for(let i=0;i<60;i++){suggestions=await rest('classification_suggestions','GET',null,`?job_id=eq.${job.id}`);if(suggestions[0]?.status==='ready')break;if(suggestions[0]?.status==='failed')throw new Error('Classification prediction failed: '+suggestions[0].error_category);await new Promise(r=>setTimeout(r,500));}
  assert.equal(suggestions[0].status,'ready');assert.equal(suggestions[0].prediction.model_version,job.model_version);
  const auth=await fetch(`${account.SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:account.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:account.APP_ADMIN_EMAIL,password:account.APP_ADMIN_PASSWORD})});
  if(!auth.ok)throw new Error('Staging admin login failed');const token=(await auth.json()).access_token;
  const headers={apikey:account.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const status=await fetch(`${account.SUPABASE_URL}/functions/v1/admin-pdf-imports/${imp}/classification`,{headers});assert.equal(status.status,200);
  const decision=await fetch(`${account.SUPABASE_URL}/functions/v1/admin-pdf-imports/${imp}/classification/suggestions/${suggestions[0].id}/decision`,{method:'POST',headers,body:JSON.stringify({decision:'accept',labels:{domain:'Algebra',skill:'Linear equations in one variable',difficulty:3},replace_existing:false})});assert.equal(decision.status,200);
  const saved=await rest('draft_questions','GET',null,`?id=eq.${draft}&select=domain,skill,difficulty,status,review_state,question_id`);
  assert.equal(saved[0].difficulty,3);assert.equal(saved[0].question_id,null);assert.equal(saved[0].review_state,'complete');assert.equal(saved[0].status,'needs_review');
  console.log('PASS: real staging queue → local worker → private fixture ML API → predictions → deployed admin status/decision → draft labels; publication unchanged.');
}finally{
  if(created)await rest('pdf_imports','DELETE',null,`?id=eq.${imp}`);
  ml.kill();workerProcess.kill();fs.closeSync(log);
}
