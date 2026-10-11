import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {preview} from '../frontend/node_modules/vite/dist/node/index.js';
const {chromium}=await import(pathToFileURL(resolve(process.env.COUNTERSCOUT_PLAYWRIGHT)).href);
const server=await preview({root:resolve('frontend'),configFile:resolve('frontend/vite.config.ts'),preview:{host:'127.0.0.1',port:5189,strictPort:true}});
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const demos=[{demo_file:'old.dem',map_name:'de_anubis',mtime:5000,uploaded_at:10,size_bytes:1000},
    {demo_file:'new.dem',map_name:'de_anubis',mtime:1000,uploaded_at:20,size_bytes:1000},
    {demo_file:'legacy.dem',map_name:'de_anubis',mtime:15,size_bytes:1000}];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const body=path.endsWith('/demos')?demos:path.endsWith('/bridge/library')?{matches:[],commands:[],imports:[]}:path.endsWith('/ingest/status')?{run_id:0,last_completed_run_id:0}:{};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:5189/replay');
  const order=page.getByRole('combobox',{name:'Sort demos by upload date'});
  await order.waitFor();
  const rows=()=>page.locator('button[title^="Open "]').evaluateAll(buttons=>buttons.map(b=>b.title));
  await page.getByRole('button',{name:'Watch →'}).first().waitFor();
  assert.deepEqual(await rows(),['Open new.dem','Open legacy.dem','Open old.dem']);
  assert.equal(await page.getByText(/File date \(upload unknown\)/).count(),1);
  await order.selectOption('oldest');
  assert.deepEqual(await rows(),['Open old.dem','Open legacy.dem','Open new.dem']);
  await page.setViewportSize({width:700,height:900});
  assert.equal(await page.locator('time').count(),3,'Dates remain available on small screens');
  assert.deepEqual(errors,[]);
  console.log('Replay library browser check: upload dates displayed, unknown legacy dates labelled, newest/oldest ordering and small-screen dates passed.');
} finally {await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
