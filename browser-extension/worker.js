import {associateDownload, demoUrls, matchId, publicMatch} from './shared.mjs';
const BASE='http://127.0.0.1:8000/api/ingest/faceit/bridge';
let processing=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function config() { return chrome.storage.local.get(['token','enabled']); }
async function local(path,body) {
  const {token}=await config();
  if(!token) throw new Error('Paste the pairing code from Import first.');
  const r=await fetch(BASE+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'X-CS2-Bridge-Version':chrome.runtime.getManifest().version,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=await r.json();
  if(!r.ok) throw new Error(typeof data.detail==='string'?data.detail:'Local app request failed ('+r.status+')');
  return data;
}
async function status(text) { await chrome.storage.local.set({status:text}); }
function tabMessage(tabId,message,timeout=18000) {
  let timer;
  return Promise.race([chrome.tabs.sendMessage(tabId,message),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('FACEIT did not respond. Refresh the match room after reloading the extension, then retry.')),timeout);
  })]).finally(()=>clearTimeout(timer));
}
async function waitForContent(tabId,roomId) {
  for(let attempt=0;attempt<20;attempt++) {
    const page=await tabMessage(tabId,{type:'capture'},1000).catch(()=>null);
    if(page && (!roomId || page.match_id===roomId)) {
      if(page.bridge_version!==chrome.runtime.getManifest().version) throw new Error('Refresh the FACEIT tab to load the updated extension, then retry.');
      return page;
    }
    await delay(500);
  }
  throw new Error('The FACEIT page did not load. Check the opened tab for a login or consent prompt, then retry.');
}
async function detail(id,tabId) {
  if(tabId == null) {
    const tabs=await chrome.tabs.query({url:'https://www.faceit.com/*'});
    tabId=tabs.find(tab=>matchId(tab.url)===id)?.id;
  }
  if(tabId != null) {
    const captured=await tabMessage(tabId,{type:'detail',match_id:id}).catch(()=>null);
    if(captured?.data) return publicMatch(captured.data);
  }
  const r=await fetch('https://api.faceit.com/match/v2/match/'+id,{signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw new Error('FACEIT metadata returned '+r.status+'. Open the match room, sign in normally, and sync it again.');
  return publicMatch(await r.json());
}
async function syncPage(tabId,teamId='',commandId=null) {
  const page=await tabMessage(tabId,{type:'capture'});
  const ids=page.match_id?[page.match_id]:page.ids;
  if(!ids.length) throw new Error('No CS2 match links found. Open the team’s Stats/history page and load its matches, then choose Sync current page.');
  const matches=[]; let failed=0;
  for(const id of ids.slice(0,60)) {
    try {
      const match=await detail(id,tabId), team=teamId || page.team_id;
      if(match.game && !['cs2','csgo'].includes(match.game)) continue;
      if(team && !Object.values(match.teams).some(t=>t.id===team)) continue;
      matches.push(match);
    } catch { failed++; }
    await delay(300);
  }
  if(!matches.length) throw new Error('FACEIT did not return match metadata. Sign in to FACEIT normally, then sync again.');
  await local('/matches',{team_id:teamId || page.team_id || '',command_id:commandId,matches});
  await status('Synced '+matches.length+' matches'+(failed?' ('+failed+' unavailable)':'')+'. Open Import to browse them.');
}
async function processCommands() {
  if(processing) return;
  // Lock before the first await: wake, ping and alarms can arrive together.
  processing=true;
  let claimed=false;
  try {
    const {token,enabled}=await config(); if(!token || !enabled) return;
    const {active_command:interrupted}=await chrome.storage.local.get('active_command');
    if(interrupted) {
      const error='The extension restarted during this request. Retry in Import; any completed downloads will still be imported.';
      if(interrupted.kind==='download') await local('/command-result',{command_id:interrupted.id,error,download_count:interrupted.download_count || 0,expected_count:interrupted.expected_count});
      else if(interrupted.kind==='search') await local('/search-results',{command_id:interrupted.id,teams:[],error});
      else await local('/matches',{team_id:interrupted.team_id || '',command_id:interrupted.id,matches:[],error});
      await chrome.storage.local.remove('active_command');
    }
    const {command}=await local('/commands');
    if(!command) return;
    claimed=true;
    let tab, downloadCount=0, expectedCount, heartbeat, stage='opening_room';
    const progress=async(next=stage)=>{
      stage=next;
      await local('/progress',{command_id:command.id,stage,expected_count:expectedCount});
    };
    try {
      await chrome.storage.local.set({active_command:command});
      await progress();
      heartbeat=setInterval(()=>void progress().catch(()=>{}),15000);
      const url=new URL(command.url);
      if(url.protocol!=='https:' || url.hostname!=='www.faceit.com') throw new Error('Invalid FACEIT URL');
      const kind=command.kind || 'team';
      if(kind==='download' && matchId(command.url)!==command.match_id || kind==='team' && !url.pathname.startsWith('/en/teams/') || kind==='search' && url.pathname!=='/en') throw new Error('Invalid command URL');
      if(!['team','search','download'].includes(kind)) throw new Error('Unsupported command');
      tab=await chrome.tabs.create({url:command.url,active:kind==='download'});
      if(kind==='search') {
        await status('Finding FACEIT teams…');
        await waitForContent(tab.id);
        await progress('searching_teams');
        const found=await tabMessage(tab.id,{type:'search-teams',query:command.query},60000);
        if(found?.error) throw new Error(found.error);
        await local('/search-results',{command_id:command.id,teams:found?.teams || []});
        await status('Team search complete. Choose the team in Import.');
        await chrome.tabs.remove(tab.id);
        return;
      }
      if(kind==='download') {
        await status('Opening the match room and downloading its available demos…');
        await waitForContent(tab.id,command.match_id);
        await progress('reading_demo_links');
        const result=await tabMessage(tab.id,{type:'download-details',match_id:command.match_id});
        if(result?.error) throw new Error(result.error);
        if(result?.metadata?.id!==command.match_id) throw new Error('FACEIT match details did not load. Sign in normally, then retry.');
        const metadata=publicMatch(result.metadata), urls=demoUrls(result);
        if(!urls.length) throw new Error('No demo links are available for this match. Download normally in the room; the extension will still import completed demos.');
        expectedCount=urls.length;
        await progress('starting_downloads');
        await chrome.storage.local.set({active_command:{...command,expected_count:expectedCount}});
        for(const [index,url] of urls.entries()) {
          const suffix=new URL(url).pathname.match(/\.dem(?:\.(?:gz|zst))?$/i)?.[0] || '.dem';
          const id=await chrome.downloads.download({url,filename:`faceit_${command.match_id}_map${index+1}${suffix}`,conflictAction:'uniquify',saveAs:false});
          downloadCount++;
          await chrome.storage.local.set({active_command:{...command,expected_count:expectedCount,download_count:downloadCount}});
          await chrome.storage.local.set({['download_'+id]:{match_id:command.match_id,tab_id:tab.id,metadata,command_id:command.id,download_count:urls.length}});
          const [item]=await chrome.downloads.search({id});
          if(item?.state==='complete') await importCompleted(item);
        }
        await local('/command-result',{command_id:command.id,download_count:downloadCount,expected_count:expectedCount});
        await status(`Downloading ${downloadCount} demo${downloadCount===1?'':'s'}. Completed files will be imported automatically.`);
        return; // Keep the explicitly opened room available to the user.
      }
      await status('Reading FACEIT team history…');
      await progress('reading_history');
      let page;
      for(let attempt=0;attempt<30;attempt++) {
        page=await tabMessage(tab.id,{type:'capture'},1000).catch(()=>null);
        if(page?.ids?.length) break;
        await delay(1000);
      }
      if(!page?.ids?.length) throw new Error('FACEIT history did not load. Open the team’s Stats page in Chrome, dismiss any consent/login prompt yourself, then click Sync current page in the extension.');
      await syncPage(tab.id,command.team_id,command.id);
      await chrome.tabs.remove(tab.id); // Only the temporary tab we created.
    } catch(e) {
      const error=String(e.message || e).slice(0,500);
      if(command.kind==='search') await local('/search-results',{command_id:command.id,teams:[],error});
      else if(command.kind==='download') await local('/command-result',{command_id:command.id,download_count:downloadCount,expected_count:expectedCount,error});
      else await local('/matches',{team_id:command.team_id || '',command_id:command.id,matches:[],error});
      await status(e.message);
      // Leave a blocked temporary tab for the user to handle login/consent.
    } finally {
      clearInterval(heartbeat);
      await chrome.storage.local.remove('active_command');
    }
  } catch(e) { await status(e.message); }
  finally {processing=false;if(claimed) void processCommands();}
}

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  const origin=sender.url ? new URL(sender.url).origin : '';
  const popup=sender.id===chrome.runtime.id && !sender.tab;
  const app=['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3000'].includes(origin);
  const faceit=origin==='https://www.faceit.com';
  const execute=async()=>{
    if(message.type==='arm' && faceit && matchId(sender.url)===message.match_id) {
      const {arms=[]}=await chrome.storage.local.get('arms');
      await chrome.storage.local.set({arms:[...arms.filter(a=>Date.now()-a.at<30000),{match_id:message.match_id,at:Date.now(),tab_id:sender.tab.id}]});
      return {ok:true};
    }
    if(message.type==='wake' && (popup || app)) { void processCommands(); return {ok:true}; }
    if(message.type==='connection-status' && (popup || app)) {
      const {token,enabled}=await config();
      if(!token) return {connected:false,error:'Pair the extension using the code below.'};
      try {await local('/ping');void processCommands();return {connected:true,enabled:Boolean(enabled),version:chrome.runtime.getManifest().version};}
      catch(e){return {connected:false,error:e.message};}
    }
    if(message.type==='connect' && popup) {
      await chrome.storage.local.set({token:message.token,enabled:message.enabled});
      await local('/ping');
      await chrome.alarms.create('bridge',{periodInMinutes:0.5});
      await status('Connected to CounterScout.');
      void processCommands();
      return {ok:true};
    }
    if(message.type==='sync' && popup) {
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab?.url?.startsWith('https://www.faceit.com/')) throw new Error('Open a FACEIT team Stats page or CS2 match room first.');
      await syncPage(tab.id); return {ok:true};
    }
    throw new Error('Unsupported bridge message');
  };
  execute().then(reply).catch(e=>reply({error:e.message})); return true;
});

chrome.downloads.onCreated.addListener(item=>{
  (async()=>{
    if(item.byExtensionId===chrome.runtime.id) return; // Explicit commands register their own match/roster after download().
    const {enabled}=await config(); if(!enabled) return;
    const {arms=[]}=await chrome.storage.local.get('arms');
    let id;
    try { id=associateDownload(item,arms); } catch { return; }
    if(!id) return;
    const arm=arms.find(a=>a.match_id===id);
    const key='download_'+item.id;
    await chrome.storage.local.set({[key]:{match_id:id,tab_id:arm?.tab_id}});
    // Save public metadata while the room is still open. A large download can
    // finish long after the user closes its tab; no session data is retained.
    try {
      const metadata=await detail(id,arm?.tab_id);
      const current=(await chrome.storage.local.get(key))[key];
      if(current && !importing.has(item.id)) await chrome.storage.local.set({[key]:{...current,metadata}});
    } catch { /* Retry metadata lookup when the download completes. */ }
    // Handles a very small download finishing before this async listener.
    const [latest]=await chrome.downloads.search({id:item.id});
    if(latest?.state==='complete') await importCompleted(latest);
  })().catch(e=>status(e.message));
});
const importing=new Set();
async function importCompleted(item) {
  if(item.state!=='complete') return;
  if(importing.has(item.id)) return;
  const {enabled}=await config(); if(!enabled) return;
  const key='download_'+item.id, saved=(await chrome.storage.local.get(key))[key];
  if(!saved) return;
  if(importing.has(item.id)) return; // Another event may have run during get().
  importing.add(item.id);
  try {
    const metadata=saved.metadata || await detail(saved.match_id,saved.tab_id);
    await local('/imports',{match_id:saved.match_id,path:item.filename,metadata});
    await chrome.storage.local.remove(key);
    await status('Demo queued for import. Progress is shown in Import.');
  } catch(e) { await status('Import failed: '+e.message+' Your download was preserved.'); }
  finally { importing.delete(item.id); }
}
chrome.downloads.onChanged.addListener(change=>{
  if(change.state?.current==='complete') chrome.downloads.search({id:change.id}).then(([item])=>item && importCompleted(item)).catch(e=>status(e.message));
  if(change.state?.current==='interrupted') chrome.storage.local.get('download_'+change.id).then(async all=>{
    const saved=all['download_'+change.id];
    if(!saved) return;
    const error='Chrome stopped a demo download ('+(change.error?.current || 'interrupted')+'). Open Chrome Downloads to resume it, or retry from the match room.';
    if(saved.command_id) await local('/command-result',{command_id:saved.command_id,download_count:saved.download_count || 0,error});
    await status(error);
  }).catch(()=>{});
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='bridge') {
  void processCommands();
  // Resume completed-but-not-queued imports after a worker restart/offline app.
  chrome.storage.local.get(null).then(async all=>{
    for(const key of Object.keys(all).filter(k=>k.startsWith('download_'))) {
      const [item]=await chrome.downloads.search({id:Number(key.slice(9))});
      if(item?.state==='complete') await importCompleted(item);
    }
  }).catch(()=>{});
}});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('bridge',{periodInMinutes:0.5}));
chrome.runtime.onStartup.addListener(()=>chrome.alarms.create('bridge',{periodInMinutes:0.5}));
