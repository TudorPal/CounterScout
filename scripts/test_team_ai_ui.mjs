// Headless Chrome checks: no real provider requests, isolated Vite preview.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preview} from '../frontend/node_modules/vite/dist/node/index.js';
const {chromium}=await import(pathToFileURL(resolve(process.env.COUNTERSCOUT_PLAYWRIGHT)).href);
const server=await preview({root:resolve('frontend'),configFile:resolve('frontend/vite.config.ts'),preview:{host:'127.0.0.1',port:5189,strictPort:true}});
let browser;
try {
  const timeline={tick_rate:10,tick_max:2900,map_name:'de_cache',players:[{steamid:'own',name:'Alpha',team_num:2},{steamid:'enemy',name:'Opponent',team_num:3}],
    rounds:[{num:1,start_tick:0,freeze_end_tick:20,end_tick:900,winner:'T'},{num:13,start_tick:1000,freeze_end_tick:1020,end_tick:1900,winner:'CT'},{num:14,start_tick:2000,freeze_end_tick:2020,end_tick:2900,winner:'CT'}],
    positions:{own:[{t:20,x:200,y:824,alive:true,tn:2,eq:800,inv:['glock'],hp:100},{t:1020,x:200,y:824,alive:true,tn:3,eq:800,inv:['usp_silencer'],hp:100},{t:2020,x:200,y:824,alive:true,tn:3,eq:4500,inv:['m4a1'],hp:100}],enemy:[]},events:[],grenades:[]};
  const info={demo_file:'cache.dem',team1:{name:'Scouted',players:['Alpha'],players_detailed:[{steamid:'own',name:'Alpha'}]},team2:{name:'Enemy',players:['Opponent']}};
  const round={id:'cache.dem:R14',demo_file:'cache.dem',round:14,side:'CT',buy:'full-buy',active_players:4,won:true,planted_site:'A',plant_seconds:40,equipment:20000,
    routes:[{player:'Alpha',samples:[{seconds:10,location:'radar grid B2'}]}],possible_lurks:[],utility:[{type:'smoke',player:'Alpha',seconds:14,from:'radar grid B2',to:'radar grid C3',landing:[300,724],phase:'preplant'}]};
  const evidence={version:3,team:'Scouted',map:'de_cache',demos:1,rounds:[round],skipped_rounds:0,limitations:['Intent is uncertain.'],
    groups:[{side:'CT',buy:'full-buy',rounds:1,wins:1,planted_sites:{A:1},round_refs:[round.id],common_utility:[{type:'smoke',location:'radar grid C3',throws:1,rounds:1,players:['Alpha'],round_refs:[round.id]}]}]};
  const report={overview:'Observed CT hold with a supporting smoke.',limitations:['Single observed round.'],sections:[{side:'CT',buy:'full-buy',plan:'Alpha sets up near radar grid B2.',utility:'Alpha throws a smoke at 14s.',possible_lurks:'No T lurk inference for this CT setup.',confidence:'low',round_refs:[round.id],
    variations:[{name:'Plan 1 — R14 hold',opening:'Alpha near grid B2; other positions unknown.',timing:'B2 sampled at 10s; no rotation confirmed.',utility:'Alpha smoke B2 → C3 at 14s.',roles:'CT setup, not a lurk.',round_refs:[round.id]}],watch_for:['One round only.'],counterplay:['Consider checking C3; hypothesis only.']}]};
  const snapshot='RESULT\n- Scouted won.\n\nKEY ROUNDS\n- Review R14.\n\nSTANDOUT PLAYERS\n- Alpha led kills.\n\nBOMB / UTILITY\n- One recorded smoke.\n\nCHECK NEXT\n- Review the sampled positions.';
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let reportRequests=0,evidenceRequests=0,snapshotRequests=0,configured=true;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body={};
    if(path.endsWith('/bridge/library'))body={matches:[],commands:[],imports:[]};
    else if(path.endsWith('/ingest/status'))body={run_id:0,last_completed_run_id:0};
    else if(path==='/api/ai/configuration')body={provider:'groq',model:'openai/gpt-oss-120b',configured,paid_fallback:false};
    else if(path==='/api/ai/team/evidence'){
      evidenceRequests++;const request=route.request().postDataJSON();assert.equal(request.team_name,'Scouted');assert.deepEqual(request.demo_files,['cache.dem']);body=evidence;
    }
    else if(path==='/api/ai/team/report'){reportRequests++;body={report,model:'openai/gpt-oss-120b',provider:'groq',cached:reportRequests>1};}
    else if(path==='/api/match-replay/demos')body=[{demo_file:'cache.dem',map_name:'de_cache',team1_name:'Scouted',team2_name:'Enemy'}];
    else if(path.includes('/match-info/'))body=info;
    else if(path.endsWith('/revision'))body={revision:'tactical-ui-test'};
    else if(path.endsWith('/timeline'))body=timeline;
    else if(path.endsWith('.png'))return route.fulfill({contentType:'image/png',body:readFileSync('backend/data/radars/de_cache.png')});
    else if(path.endsWith('/insights') && route.request().method()==='POST'){snapshotRequests++;body={demo_file:'cache.dem',summary:snapshot,model:'test'};}
    else if(path.startsWith('/api/radars/'))body={map_name:'de_cache',pos_x:0,pos_y:1024,scale:1,image_url:'/api/radars/de_cache.png'};
    else if(path.startsWith('/api/callouts/'))body={callouts:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:5189/replay/cache.dem/recap');
  const ai=page.getByRole('region',{name:'AI team tactical analysis'});
  await ai.getByRole('checkbox',{name:'Allow AI evidence upload'}).waitFor();
  assert.equal(reportRequests,0,'Opening AI tab does not use quota');
  assert.equal(await ai.getByRole('button',{name:'Generate AI report'}).isEnabled(),false,'Consent is required');
  await ai.getByRole('button',{name:'Build team evidence'}).click();
  await ai.getByText('CT · Full Buy',{exact:true}).waitFor();
  assert.equal(evidenceRequests,1);assert.equal(reportRequests,0);
  await ai.getByRole('checkbox',{name:'Allow AI evidence upload'}).check();
  await ai.getByRole('button',{name:'Generate AI report'}).click();
  await ai.getByText(report.overview,{exact:true}).waitFor();
  assert.equal(reportRequests,1);assert.equal(evidenceRequests,1,'Reuse displayed local evidence');
  await ai.getByRole('button',{name:'T',exact:true}).click();
  assert.equal(await ai.locator('article').count(),0);
  await ai.getByRole('button',{name:'Both sides',exact:true}).click();
  assert.equal(await ai.locator('article').count(),1);
  await ai.locator('article summary').click();
  await ai.getByRole('heading',{name:'Plan 1 — R14 hold'}).waitFor();
  assert.match(await ai.innerText(),/Setup[\s\S]*Timing \/ rotations[\s\S]*Utility support[\s\S]*Roles \/ possible lurks/);
  assert.match(await ai.innerText(),/Counterplay · coaching hypotheses/i);
  assert.match(await ai.innerText(),/14s · Alpha · smoke/);
  assert.equal(reportRequests,1,'Side/evidence filters do not make new provider requests');
  mkdirSync('.cache/ui-preview',{recursive:true});
  await ai.screenshot({path:'.cache/ui-preview/team-ai.png'});
  await page.locator('summary').filter({hasText:'Match snapshot (all players)'}).click();
  assert.equal(snapshotRequests,0);
  assert.equal(await page.getByRole('button',{name:'Generate snapshot',exact:true}).isEnabled(),false);
  await page.getByRole('checkbox',{name:'Allow match snapshot evidence upload'}).check();
  await page.getByRole('button',{name:'Generate snapshot',exact:true}).click();
  await page.getByRole('heading',{name:'KEY ROUNDS',exact:true}).waitFor();
  assert.equal(snapshotRequests,1);
  assert.equal(await page.getByRole('listitem').filter({hasText:'Review R14.'}).count(),1);
  await page.setViewportSize({width:760,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1500,height:1000});
  await ai.getByRole('link',{name:/Demo 1 · R14/}).first().click();
  await page.getByRole('button',{name:'Round 14',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Round 14',exact:true}).getAttribute('aria-pressed'),'true','Cited round deep-link');
  configured=false;
  await page.goto('http://127.0.0.1:5189/replay/cache.dem/recap');
  await ai.getByText(/AI key not configured/).waitFor();
  await ai.getByRole('button',{name:'Build team evidence'}).click();
  await ai.getByText('CT · Full Buy',{exact:true}).waitFor();
  assert.equal(await ai.getByRole('button',{name:'Generate AI report'}).isEnabled(),false);
  await page.goto('http://127.0.0.1:5189/anti-strat');
  await page.getByRole('combobox',{name:'Scout team'}).fill('Scouted');
  await page.getByRole('option',{name:'Scouted',exact:true}).click();
  await page.getByRole('button',{name:'Select a map…'}).click();
  await page.getByRole('option').filter({hasText:'de_cache'}).click();
  await page.getByRole('button',{name:'Analyze',exact:true}).click();
  await ai.getByRole('button',{name:'Build team evidence'}).click();
  await ai.getByText('CT · Full Buy',{exact:true}).waitFor();
  await page.setViewportSize({width:1000,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('AI team browser checks passed: on-demand consent, local evidence without key, side filters, round deep-links and Anti-Strat integration.');
} finally {await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
