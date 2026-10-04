// Restore missing PDFs only from matching workspace originals into verified staging.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import dotenv from '../worker/node_modules/dotenv/lib/main.js';
import * as mupdf from '../worker/node_modules/mupdf/dist/mupdf.js';

const expected = 'https://wgkggknyndgaoyazdhdf.supabase.co';
const env = dotenv.parse(fs.readFileSync('backend/scripts/.env'));
if (env.SUPABASE_URL?.replace(/\/$/, '') !== expected || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Staging reference verification failed');
console.log('Verified staging reference: wgkggknyndgaoyazdhdf');
const headers = {apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
const manifestPath = 'tmp/classification-content-copy.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const response = await fetch(expected+'/rest/v1/pdf_imports?select=id,storage_path,original_filename,file_size,page_count', {headers});
if(!response.ok)throw new Error(`Staging import read failed: ${response.status}`);
const imports = await response.json();
const workspace = path.resolve('Tests Unparsed');
const localPdfs = fs.readdirSync(workspace,{recursive:true}).filter(name=>String(name).toLowerCase().endsWith('.pdf'));
const result = {recovered:[],unresolved:[]};
for(const asset of manifest.assets.missing.filter(a=>a.startsWith('pdf-imports/'))){
  const storagePath=asset.slice('pdf-imports/'.length);
  const imp=imports.find(i=>i.storage_path===storagePath);
  if(!imp){result.unresolved.push({asset,reason:'import_missing'});continue}
  const candidates=[];
  if(storagePath.startsWith('local-batch/'))candidates.push(path.resolve(workspace,'Digital SAT Tests',storagePath.slice('local-batch/'.length)));
  if(imp.original_filename==='Full RW Question Bank With Key.pdf')candidates.push(path.resolve(workspace,imp.original_filename));
  const sameName=localPdfs.filter(name=>path.basename(String(name))===imp.original_filename);
  if(sameName.length===1)candidates.push(path.resolve(workspace,String(sameName[0])));
  const local=candidates.find(p=>p.startsWith(workspace+path.sep)&&fs.existsSync(p));
  if(!local){result.unresolved.push({asset,original_filename:imp.original_filename,file_size:imp.file_size,page_count:imp.page_count,reason:'local_original_missing'});continue}
  const bytes=fs.readFileSync(local);
  if(imp.file_size!=null&&Number(imp.file_size)!==bytes.length){result.unresolved.push({asset,reason:'size_mismatch'});continue}
  const doc=mupdf.Document.openDocument(new Uint8Array(bytes),'application/pdf');
  const pages=doc.countPages();doc.destroy();
  if(imp.page_count!=null&&imp.page_count!==pages){result.unresolved.push({asset,reason:'page_count_mismatch'});continue}
  const encoded=storagePath.split('/').map(encodeURIComponent).join('/');
  const info=await fetch(expected+'/storage/v1/object/info/pdf-imports/'+encoded,{headers});
  if(!info.ok&&![400,404].includes(info.status))throw new Error(`Staging storage lookup failed: ${info.status}`);
  if(process.argv.includes('--apply')&&!info.ok){
    const upload=await fetch(expected+'/storage/v1/object/pdf-imports/'+encoded,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(120000)});
    if(!upload.ok){
      const failure=await upload.json().catch(()=>({}));
      result.unresolved.push({asset,original_filename:imp.original_filename,reason:'storage_rejection',status:upload.status,message:String(failure.message??failure.error??'').slice(0,150)});
      fs.writeFileSync('tmp/classification-pdf-recovery.json',JSON.stringify(result,null,2));
      continue;
    }
  }
  result.recovered.push({asset,local:path.relative(process.cwd(),local),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,pages,applied:process.argv.includes('--apply')});
}
fs.writeFileSync('tmp/classification-pdf-recovery.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({matching_originals:result.recovered.length,unresolved:result.unresolved.length,applied:process.argv.includes('--apply')}));
