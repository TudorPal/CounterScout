// Chrome smoke test using the reported Anubis demo's isolated v9 test cache.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preview} from '../frontend/node_modules/vite/dist/node/index.js';
const {chromium}=await import(pathToFileURL(resolve(process.env.COUNTERSCOUT_PLAYWRIGHT)).href);
const server=await preview({root:resolve('frontend'),configFile:resolve('frontend/vite.config.ts'),preview:{host:'127.0.0.1',port:5189,strictPort:true}});
let browser;
try {
  const timeline=JSON.parse(readFileSync(process.argv[2] || '.cache/retake-stats-v9.json','utf8'));
  const info=JSON.parse(readFileSync('demos/faceit_1-ef180cd7-d179-4e09-96a7-c04b98b410ac_ec0d8fde53906d7736b7.roster.json','utf8'));
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body={};
    if(path.endsWith('/bridge/library'))body={matches:[],commands:[],imports:[]};
    else if(path.endsWith('/ingest/status'))body={run_id:0,last_completed_run_id:0};
    else if(path.includes('/match-info/'))body=info;
    else if(path.endsWith('/revision'))body={revision:'retake-v9-isolated'};
    else if(path.endsWith('/timeline'))body=timeline;
    else if(path.endsWith('.png'))return route.fulfill({contentType:'image/png',body:readFileSync('backend/data/radars/de_anubis.png')});
    else if(path.startsWith('/api/radars/'))body={map_name:'de_anubis',pos_x:-2796,pos_y:3328,scale:5.22,image_url:'/api/radars/de_anubis.png'};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:5189/replay/test.dem/stats');
  await page.getByText('Rating ≈',{exact:true}).first().waitFor();
  const row=page.getByText('-AdN-_',{exact:true}).locator('..');
  assert.match(await row.innerText(),/-AdN-_\s+14\s+7\s/,'Post-match suicide is excluded in rendered statistics');
  assert.match(await page.getByText(/Rating ≈ and Swing ≈ are local estimates/).innerText(),/not official/);
  mkdirSync('.cache/ui-preview',{recursive:true});
  await page.screenshot({path:'.cache/ui-preview/retake-stats.png'});
  await page.getByRole('link',{name:'Insights',exact:true}).click();
  await page.getByText('Swing ≈',{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('checkbox',{name:'Show Retake players',exact:true}).isChecked(),true);
  assert.equal(await page.getByRole('checkbox',{name:'Show 7yringe',exact:true}).isChecked(),true);
  assert.deepEqual(errors,[]);
  console.log('Actual Anubis browser check: 17 rounds, corrected AdN deaths, rating/swing disclosure and stable Retake player table passed.');
} finally {await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
