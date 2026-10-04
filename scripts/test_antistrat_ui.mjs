// Run after the frontend build. Requires Playwright (or COUNTERSCOUT_PLAYWRIGHT
// pointing to its index.mjs) and Chrome. All API requests use isolated fixtures.
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preview} from '../frontend/node_modules/vite/dist/node/index.js';

const {chromium}=await import(process.env.COUNTERSCOUT_PLAYWRIGHT?pathToFileURL(resolve(process.env.COUNTERSCOUT_PLAYWRIGHT)).href:'playwright');
const server=await preview({root:resolve('frontend'),configFile:resolve('frontend/vite.config.ts'),preview:{host:'127.0.0.1',port:5189,strictPort:true}});
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1800,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const library=[{demo_file:'cache.dem',map_name:'de_cache',team1_name:'Scouted',team2_name:'Enemy'},
    {demo_file:'nuke.dem',map_name:'de_nuke',team1_name:'Scouted',team2_name:'Other'},
    {demo_file:'mirage.dem',map_name:'de_mirage',team1_name:'Other',team2_name:'Enemy'}];
  const info={demo_file:'cache.dem',team1:{name:'Scouted',players:['Alpha'],players_detailed:[{steamid:'own',name:'Alpha'}]},team2:{name:'Enemy',players:['Opponent']}};
  const timeline={tick_rate:10,tick_max:900,map_name:'de_cache',players:[{steamid:'own',name:'Alpha',team_num:2},{steamid:'enemy',name:'Opponent',team_num:3}],
    rounds:[{num:1,start_tick:0,freeze_end_tick:20,end_tick:900,winner:'T'}],
    positions:{own:[{t:20,x:200,y:824,alive:true,tn:2},{t:35,x:250,y:774,alive:true,tn:2},{t:50,x:300,y:724,alive:true,tn:2},{t:100,x:400,y:624,alive:true,tn:2}],enemy:[]},
    events:[{tick:200,type:'bomb_plant',data:{site:'A',planter:'own'}}],
    grenades:[{type:'smokegrenade',thrower:'own',detonate_tick:50,points:[[40,250,774],[50,350,674]]},
      {type:'flashbang',thrower:'own',detonate_tick:80,points:[[60,500,600],[80,600,500]]}]};
  let rosterRequests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body={};
    if(path==='/api/match-replay/demos')body=library;
    else if(path.startsWith('/api/match-info/')){rosterRequests++;body=info;}
    else if(path.endsWith('/revision'))body={revision:'ui-fixture-v8'};
    else if(path.endsWith('/timeline'))body=timeline;
    else if(path.endsWith('.png'))return route.fulfill({contentType:'image/png',body:readFileSync('backend/data/radars/de_cache.png')});
    else if(path.startsWith('/api/radars/'))body={map_name:'de_cache',pos_x:0,pos_y:1024,scale:1,image_url:'/api/radars/de_cache.png'};
    else if(path.startsWith('/api/callouts/'))body={callouts:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:5189/anti-strat');
  await page.getByRole('combobox',{name:'Scout team'}).fill('Scouted');
  await page.getByRole('option',{name:'Scouted',exact:true}).click();
  assert.equal(rosterRequests,0,'Team-first selection uses compact catalog, not every demo timeline');
  await page.getByRole('button',{name:'Select a map…'}).click();
  assert.equal(await page.getByRole('option').filter({hasText:'de_mirage'}).count(),0,'Only selected team maps');
  await page.getByRole('option').filter({hasText:'de_cache'}).click();
  await page.getByRole('button',{name:'Analyze',exact:true}).click();
  const explorer=page.getByRole('region',{name:'Team movement and utility explorer'});
  await explorer.waitFor();
  assert.equal(await explorer.getByRole('combobox').count(),0,'No player or utility dropdown');
  assert.equal(await explorer.getByRole('checkbox',{name:'Show Alpha'}).isChecked(),true);
  assert.equal(await explorer.getByText('Opponent',{exact:true}).count(),0);
  await explorer.getByRole('button',{name:'Utility',exact:true}).click();
  await explorer.locator('summary').click();
  assert.match(await explorer.locator('summary').innerText(),/\(2\)/);
  await explorer.getByRole('button',{name:'Flash',exact:true}).click();
  assert.equal(await explorer.getByRole('button',{name:'Flash',exact:true}).getAttribute('aria-pressed'),'false');
  assert.match(await explorer.locator('summary').innerText(),/\(1\)/);
  await explorer.getByRole('checkbox',{name:'Show Alpha'}).uncheck();
  assert.match(await explorer.locator('summary').innerText(),/\(0\)/);
  await explorer.getByRole('checkbox',{name:'Show Alpha'}).check();
  await explorer.getByRole('button',{name:/Highlight/}).click();
  assert.match(await explorer.getByRole('status').innerText(),/Alpha.*Smoke.*R1/);
  await explorer.getByRole('button',{name:'Movement',exact:true}).click();
  await explorer.getByRole('slider').fill('30');
  await explorer.locator('canvas').scrollIntoViewIfNeeded();
  const box=await explorer.locator('canvas').boundingBox();
  await page.mouse.move(box.x+250/1024*box.width,box.y+250/1024*box.height);
  assert.match(await explorer.getByRole('status').innerText(),/Alpha.*Match 1.*R1/);
  await page.mouse.move(0,0);
  mkdirSync('.cache/ui-preview',{recursive:true});
  await page.screenshot({path:'.cache/ui-preview/antistrat-players.png',fullPage:true});
  await page.setViewportSize({width:1100,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No page horizontal overflow');
  assert.deepEqual(errors,[]);
  console.log('Anti-Strat browser checks passed: team-first maps, roster toggles, utility chips, throw/path identification, responsive layout.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.httpServer.close(resolve));
}
