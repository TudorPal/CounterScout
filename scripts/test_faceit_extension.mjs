// Run without Chrome: exercise production helpers and service-worker events.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {associateDownload,demoDownload,demoUrls,matchId,publicMatch} from '../browser-extension/shared.mjs';
const TEAM='caf177f0-ef92-498c-9097-53a02409a800';
const MATCH='1-e53c7d0e-5bf2-419d-abba-3ee4e410732a';
const OTHER='1-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const room='https://www.faceit.com/en/cs2/room/'+MATCH;
const item={id:42,url:'https://demos.faceit-cdn.net/cs2/'+MATCH+'.dem.zst',filename:'C:\\Downloads\\match.dem.zst',referrer:room,state:'in_progress'};
assert.equal(matchId(room+'/scoreboard'),MATCH);
assert.equal(matchId('https://evil.test/en/cs2/room/'+MATCH),null);
assert.equal(matchId('http://www.faceit.com/en/cs2/room/'+MATCH),null);
assert.ok(demoDownload(item));
assert.ok(!demoDownload({...item,url:'https://evil.test/match.dem.zst'}));
assert.ok(!demoDownload({...item,url:'http://demos.faceit-cdn.net/match.dem.zst'}));
assert.equal(associateDownload(item,[]),MATCH,'A room referrer directly identifies the match');
assert.equal(associateDownload({...item,referrer:'',url:'https://demos.faceit-cdn.net/demo.dem'},[{match_id:MATCH,at:100}],101),MATCH);
assert.equal(associateDownload({...item,referrer:'',url:'https://demos.faceit-cdn.net/demo.dem'},[{match_id:MATCH,at:100},{match_id:OTHER,at:100}],101),null,'Ambiguous downloads are never guessed');
assert.equal(associateDownload({...item,referrer:'',url:'https://demos.faceit-cdn.net/demo.dem'},[{match_id:MATCH,at:100}],30101),null,'Expired clicks cannot attribute a later download');
assert.equal(associateDownload({...item,referrer:''},[{match_id:MATCH,at:100},{match_id:MATCH,at:101}],102),MATCH,'Repeated clicks on one match are not ambiguous');
const raw={payload:{id:MATCH,game:'cs2',status:'FINISHED',teams:{faction1:{id:TEAM,name:'Transpiratii',roster:[{nickname:'Tspeck',game_player_id:'76561198000000001',email:'private'}]},faction2:{id:'opponent',name:'Opponent',roster:[{nickname:'enemy'}]}},voting:{map:{pick:['de_cache','de_ancient']}},results:{score:{faction1:0,faction2:2}},demo_url:['signed_url'],token:'secret'}};
const clean=publicMatch(raw);
assert.equal(clean.teams.faction1.name,'Transpiratii');
assert.equal(clean.teams.faction1.roster[0].game_player_id,'76561198000000001');
assert.ok(!JSON.stringify(clean).includes('private'));
assert.ok(!('token' in clean) && !('demo_url' in clean),'Only public roster/match fields leave FACEIT');
const signed1='https://demos.faceit-cdn.net/cache.dem.zst?signature=private-link';
const signed2='https://demos.faceit-cdn.net/ancient.dem.gz?signature=private-link';
assert.deepEqual(demoUrls({demo_url:[signed1,signed2,signed1,'https://evil.test/a.dem','not a url']}),[signed1,signed2]);
assert.deepEqual(demoUrls({demo_url:'wrong shape'}),[]);

// The team table has no <a href>. Capture IDs from normal public stats fetches.
const messages=[], response={ok:true,clone:()=>({json:async()=>[{matchId:MATCH}, {match_id:OTHER}]})};
function XHR() {}
XHR.prototype.open=function(){};
const fakeWindow={fetch:async()=>response,postMessage:message=>messages.push(message)};
vm.runInNewContext(readFileSync(new URL('../browser-extension/history-observer.js',import.meta.url),'utf8'),{
  window:fakeWindow,location:{pathname:'/en/teams/'+TEAM+'/stats',origin:'https://www.faceit.com'},XMLHttpRequest:XHR,URL
});
await fakeWindow.fetch('https://www.faceit.com/api/stats/v1/stats/time/teams/'+TEAM+'/games/cs2?size=30');
await new Promise(r=>setImmediate(r));
assert.deepEqual(Array.from(messages[0].ids),[MATCH,OTHER]);
await fakeWindow.fetch('https://www.faceit.com/api/stats/v1/stats/time/users/another/games/cs2');
await new Promise(r=>setImmediate(r));
assert.equal(messages.length,1,'Unrelated player statistics are not collected');
const searchMessages=[], searchWindow={fetch:async()=>({ok:true,clone:()=>({json:async()=>({payload:{teams:{results:[{id:TEAM,name:'Transpiratii',members:[1,2,3,4,5],token:'never'},
  {id:'556c62be-5c60-4dd1-90ae-fcf7827136d1',name:'Transpiratii',members_count:3}]},players:[{id:OTHER.slice(2),nickname:'not a team'}]}})})}),postMessage:message=>searchMessages.push(message)};
vm.runInNewContext(readFileSync(new URL('../browser-extension/history-observer.js',import.meta.url),'utf8'),{window:searchWindow,location:{pathname:'/en',origin:'https://www.faceit.com'},XMLHttpRequest:XHR,URL});
await searchWindow.fetch('/api/search/v1/teams?query=Transpiratii');await new Promise(r=>setImmediate(r));
assert.equal(searchMessages[0].teams.length,2);
assert.equal(searchMessages[0].teams[0].members,5);
assert.ok(!JSON.stringify(searchMessages).includes('never'));
await searchWindow.fetch('https://evil.test/search/v1/teams');await new Promise(r=>setImmediate(r));
assert.equal(searchMessages.length,1,'Search observation never collects unrelated third-party responses');

// Exercise the production isolated content script, including native Search UI
// interaction and the separate allowlisted metadata/download URL responses.
let contentMessage, pageMessage, searchClicked=false, teamsClicked=false;
class Input {set value(value){this._value=value;}get value(){return this._value;}getClientRects(){return [1];}dispatchEvent(){}}
const input=new Input();input.placeholder='Search';
const trigger={getClientRects:()=>[1],getAttribute:()=> 'Search',textContent:'Search',click:()=>{searchClicked=true;}};
const teamsTab={getClientRects:()=>[1],textContent:'TEAMS',click:()=>{teamsClicked=true;pageMessage({source:contentWindow,origin:'https://www.faceit.com',data:{type:'COUNTERSCOUT_SEARCH_TEAMS',teams:searchMessages[0].teams}});}};
const contentWindow={addEventListener(type,fn){if(type==='message')pageMessage=fn;}};
const contentLocation={pathname:'/en/cs2/room/'+MATCH,origin:'https://www.faceit.com'};
vm.runInNewContext(readFileSync(new URL('../browser-extension/faceit-content.js',import.meta.url),'utf8'),{
  window:contentWindow,location:contentLocation,URL,AbortSignal,Event,HTMLInputElement:Input,setTimeout,
  document:{title:'FACEIT',addEventListener(){},querySelector(){return null;},querySelectorAll(selector){return selector==='input'?[input]:selector==='button'?[trigger]:selector==='a[href]'?[]:[teamsTab];}},
  chrome:{runtime:{onMessage:{addListener(fn){contentMessage=fn;}}}},
  fetch:async()=>({ok:true,json:async()=>({...raw.payload,demo_url:[signed1,signed2]})})
});
const contentSend=message=>new Promise(resolve=>contentMessage(message,{},resolve));
const searched=await contentSend({type:'search-teams',query:'Transpiratii'});
assert.ok(searchClicked && teamsClicked);
assert.equal(input.value,'Transpiratii');
assert.equal(searched.teams.length,2);
const details=await contentSend({type:'detail',match_id:MATCH});
assert.ok(!JSON.stringify(details).includes('private-link'));
const detailsForDownload=await contentSend({type:'download-details',match_id:MATCH});
assert.equal(detailsForDownload.demo_url.length,2);
assert.equal(detailsForDownload.metadata.teams.faction1.name,'Transpiratii');

// The app handshake replies immediately with connection state, never a token.
let appMessage;
const appEvents=[],appWindow={addEventListener(type,fn){appMessage=fn;},postMessage(message){appEvents.push(message);}};
vm.runInNewContext(readFileSync(new URL('../browser-extension/app-content.js',import.meta.url),'utf8'),{
  window:appWindow,location:{origin:'http://localhost:5173'},chrome:{runtime:{sendMessage:async message=>message.type==='connection-status'?{connected:true,enabled:true,version:'0.2.2'}:{ok:true}}}
});
assert.equal(appEvents[0].type,'COUNTERSCOUT_BRIDGE_READY');
appMessage({source:appWindow,origin:'http://localhost:5173',data:{type:'COUNTERSCOUT_BRIDGE_STATUS_REQUEST',request_id:'request-1'}});
await new Promise(r=>setImmediate(r));
assert.equal(appEvents[1].request_id,'request-1');
assert.equal(appEvents[1].connected,true);
appMessage({source:{},origin:'https://evil.test',data:{type:'COUNTERSCOUT_BRIDGE_STATUS_REQUEST',request_id:'evil'}});
await new Promise(r=>setImmediate(r));
assert.equal(appEvents.length,2);

// Drive the actual module's registered Chrome events with a local mock.
const storage={token:'paired-test-code',enabled:true},calls=[],listeners={},downloads=new Map([[42,item]]),commands=[],createdTabs=[],removedTabs=[];
let nextDownload=100;
let availableUrls=[signed1,signed2];
const event=name=>({addListener(fn){listeners[name]=fn;}});
globalThis.chrome={runtime:{id:'test-extension',getManifest:()=>({version:'0.2.2'}),onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup')},
  storage:{local:{async get(keys){if(keys==null)return {...storage};return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,storage[k]]));},async set(value){Object.assign(storage,value);},async remove(key){delete storage[key];}}},
  tabs:{async sendMessage(id,message){if(message.type==='detail')return {data:clean};if(message.type==='download-details')return {metadata:clean,demo_url:availableUrls};if(message.type==='search-teams')return {teams:searchMessages[0].teams};return {bridge_version:'0.2.2',match_id:MATCH,ids:[],team_id:''};},async query(){return [{id:7,url:room}];},async create(options){createdTabs.push(options);return {id:10};},async remove(id){removedTabs.push(id);}},
  downloads:{onCreated:event('created'),onChanged:event('changed'),async search({id}){return [downloads.get(id)].filter(Boolean);},async download(options){const id=nextDownload++,download={id,url:options.url,filename:'C:\\Downloads\\'+options.filename,state:'complete',byExtensionId:'test-extension'};downloads.set(id,download);listeners.created(download);listeners.changed({id,state:{current:'complete'}});return id;}},
  alarms:{onAlarm:event('alarm'),async create(){}}};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/commands')?{command:commands.shift() || null}:{state:'queued',connected:true}};};
const worker=readFileSync(new URL('../browser-extension/worker.js',import.meta.url),'utf8')
  .replace("'./shared.mjs'",JSON.stringify(new URL('../browser-extension/shared.mjs',import.meta.url).href));
await import('data:text/javascript;base64,'+Buffer.from(worker).toString('base64'));
const tick=()=>new Promise(r=>setImmediate(r));
listeners.created(item);await tick();await tick();
assert.ok(storage.download_42);
assert.ok(!calls.some(c=>c.url.endsWith('/imports')),'Never import a partial download');
downloads.set(42,{...item,state:'complete'});
listeners.changed({id:42,state:{current:'complete'}});await tick();await tick();
const imports=calls.filter(c=>c.url.endsWith('/imports'));
assert.equal(imports.length,1);
const sent=JSON.parse(imports[0].options.body);
assert.equal(sent.match_id,MATCH);
assert.equal(sent.path,item.filename);
assert.equal(sent.metadata.teams.faction1.name,'Transpiratii');
assert.equal(imports[0].options.headers.Authorization,'Bearer paired-test-code');
assert.ok(!storage.download_42);
listeners.changed({id:42,state:{current:'complete'}});await tick();await tick();
assert.equal(calls.filter(c=>c.url.endsWith('/imports')).length,1,'Completion events cannot queue duplicates');
const denied=await new Promise(resolve=>listeners.message({type:'connect',token:'evil',enabled:true},{id:'test-extension',url:'https://evil.test',tab:{id:1}},resolve));
assert.ok(denied.error);
assert.equal(storage.token,'paired-test-code','A webpage cannot replace the pairing code');
const appSender={id:'test-extension',url:'http://localhost:5173/ingest',tab:{id:9}};
const send=message=>new Promise(resolve=>listeners.message(message,appSender,resolve));
const connection=await send({type:'connection-status'});
assert.deepEqual(connection,{connected:true,enabled:true,version:'0.2.2'});
await tick();await tick();
commands.push({id:'download-test',kind:'download',match_id:MATCH,url:room});
await Promise.all([send({type:'wake'}),send({type:'wake'}),send({type:'wake'})]);for(let i=0;i<40;i++)await tick();
assert.equal(createdTabs.length,1,'Concurrent wake events claim only one command');
assert.equal(createdTabs.at(-1).active,true,'Explicit download opens a visible match room');
assert.equal(calls.filter(c=>c.url.endsWith('/imports')).length,3,'Both completed maps import, even when completion raced registration');
const result=calls.find(c=>c.url.endsWith('/command-result'));
assert.equal(JSON.parse(result.options.body).download_count,2);
assert.equal(JSON.parse(result.options.body).expected_count,2);
assert.equal(result.options.headers['X-CS2-Bridge-Version'],'0.2.2');
assert.ok(!storage.active_command,'A completed command does not leave restart-recovery state');
assert.deepEqual(calls.filter(c=>c.url.endsWith('/progress')).map(c=>JSON.parse(c.options.body).stage),['opening_room','reading_demo_links','starting_downloads']);
assert.ok(!JSON.stringify(calls).includes('private-link'),'Signed demo URLs stay inside Chrome');
assert.equal(removedTabs.length,0,'Download commands do not close the match room');
commands.push({id:'search-test',kind:'search',query:'Transpiratii',url:'https://www.faceit.com/en'});
await send({type:'wake'});for(let i=0;i<30;i++)await tick();
assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('/search-results')).options.body).teams.length,2);
assert.equal(removedTabs.length,1,'Only the temporary search tab is closed');
availableUrls=[];
commands.push({id:'no-demos',kind:'download',match_id:MATCH,url:room});
await send({type:'wake'});for(let i=0;i<30;i++)await tick();
const noDemos=JSON.parse(calls.filter(c=>c.url.endsWith('/command-result')).at(-1).options.body);
assert.equal(noDemos.command_id,'no-demos');
assert.match(noDemos.error,/No demo links/);
assert.equal(nextDownload,102,'Unavailable matches never guess demo URLs from voting picks');
storage.download_200={match_id:MATCH,command_id:'download-test',download_count:2};
listeners.changed({id:200,state:{current:'interrupted'},error:{current:'NETWORK_FAILED'}});await tick();await tick();
assert.match(JSON.parse(calls.filter(c=>c.url.endsWith('/command-result')).at(-1).options.body).error,/NETWORK_FAILED/);
assert.ok(storage.download_200,'Interrupted download metadata stays available for a Chrome resume');
storage.active_command={id:'interrupted-worker',kind:'download',match_id:MATCH,expected_count:2,download_count:1};
await send({type:'wake'});for(let i=0;i<20;i++)await tick();
const interrupted=JSON.parse(calls.filter(c=>c.url.endsWith('/command-result')).at(-1).options.body);
assert.equal(interrupted.command_id,'interrupted-worker');
assert.match(interrupted.error,/extension restarted/);
assert.equal(interrupted.expected_count,2);
assert.ok(!storage.active_command);
storage.enabled=false;listeners.created({...item,id:43});await tick();await tick();
assert.ok(!storage.download_43,'Disabled automatic imports stay disabled');
assert.equal((await send({type:'connection-status'})).enabled,false,'Paused is distinct from disconnected');
globalThis.fetch=originalFetch;
console.log('FACEIT extension: URLs, attribution, ambiguity, public metadata, team-history observation, completed downloads, pairing and disable controls passed.');
