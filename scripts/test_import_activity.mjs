import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
const source=readFileSync('frontend/src/utils/importActivity.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {updateImport,importSnapshot,dismissImport,startUpload}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
let now=100000;
const originalNow=Date.now;Date.now=()=>now;
try {
  updateImport({id:'old',label:'Already ready',state:'done',toastDismissed:true,updatedAt:100});
  assert.equal(importSnapshot()[0].toastDismissed,true);
  const upload=startUpload('team.dem');now+=5000;upload.progress(50);
  const progress=importSnapshot().find(item=>item.state==='working');assert.equal(progress.etaSeconds,5);
  now+=1000;upload.progress(100);
  const parsing=importSnapshot().find(item=>item.state==='working');assert.equal(parsing.etaSeconds,undefined);assert.equal(parsing.progress,undefined,'Upload completion is not analysis completion');
  upload.done('team.dem');const ready=importSnapshot().find(item=>item.demo==='team.dem');
  assert.equal(ready.state,'done');dismissImport(ready.id);assert.equal(importSnapshot().find(item=>item.id===ready.id).toastDismissed,true);
  assert.equal(importSnapshot().find(item=>item.id===ready.id).demo,'team.dem','Dismiss keeps the history and replay link');
  const snapshot=importSnapshot();updateImport({id:ready.id,label:ready.label,state:ready.state,demo:ready.demo});assert.equal(importSnapshot(),snapshot,'Unchanged polls do not notify every subscriber');
  console.log('Import activity: upload-only ETA, analysis indeterminate, silent history, preserved dismissals and stable poll snapshots passed.');
} finally {Date.now=originalNow;}
