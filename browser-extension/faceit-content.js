(() => {
  const ID='(?:1-)?[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}';
  const room=()=>location.pathname.match(new RegExp('/cs2/room/('+ID+')(?=/|$)'))?.[1];
  const team=()=>location.pathname.match(new RegExp('/teams/('+ID+')(?=/|$)'))?.[1];
  const captured=new Map();
  let searching=false, searchResults=null;
  window.addEventListener('message',event=>{
    if(event.source===window && event.origin===location.origin && event.data?.type==='COUNTERSCOUT_SEARCH_TEAMS' && searching) {
      searchResults=(event.data.teams || []).slice(0,30);return;
    }
    if(event.source!==window || event.origin!==location.origin || event.data?.type!=='COUNTERSCOUT_HISTORY_IDS' || event.data.team_id!==team()) return;
    const valid=(event.data.ids || []).filter(id=>typeof id==='string' && new RegExp('^'+ID+'$').test(id)).slice(0,100);
    captured.set(team(),[...new Set([...(captured.get(team()) || []),...valid])].slice(0,100));
  });
  const ids=()=>[...new Set([...(captured.get(team()) || []),...Array.from(document.querySelectorAll('a[href]')).map(a=>{
    try { const u=new URL(a.href); return u.hostname==='www.faceit.com' ? u.pathname.match(new RegExp('/cs2/room/('+ID+')(?=/|$)'))?.[1] : null; } catch{return null;}
  }).filter(Boolean)])].slice(0,60);
  const safeMatch=raw=>{
    const p=raw.payload || raw, teams={};
    for(const key of ['faction1','faction2']) {
      const t=p.teams?.[key] || {};
      teams[key]={id:t.id || t.faction_id,name:t.name,nickname:t.nickname,score:t.score,
        roster:(t.roster || t.players || []).map(r=>({nickname:r.nickname || r.name,game_player_name:r.game_player_name,game_player_id:/^\d{17}$/.test(String(r.game_player_id || ''))?r.game_player_id:undefined}))};
    }
    return {id:p.id || p.match_id,game:p.game,status:p.status,finished_at:p.finished_at || p.finishedAt,teams,
      results:{score:p.results?.score},voting:{map:{pick:p.voting?.map?.pick || []}}};
  };
  async function detail(id,downloads=false) {
    if(!new RegExp('^'+ID+'$').test(id)) throw new Error('Invalid match ID');
    const r=await fetch('/api/match/v2/match/'+id,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
    if(!r.ok) throw new Error('FACEIT match details unavailable ('+r.status+'). Sign in to FACEIT normally, then retry.');
    const raw=await r.json(), p=raw.payload || raw;
    return downloads?{metadata:safeMatch(raw),demo_url:p.demo_url || p.demo_urls || []}:safeMatch(raw);
  }
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=el=>el.getClientRects().length>0;
  async function waitFor(find) {
    for(let i=0;i<40;i++) {const value=find();if(value)return value;await delay(250);}
    throw new Error('FACEIT Search did not load. Dismiss any login/consent prompt yourself, or paste the team URL instead.');
  }
  async function searchTeams(query) {
    if(typeof query!=='string' || query.trim().length<2 || query.length>80) throw new Error('Invalid team search');
    searching=true;searchResults=null;
    try {
      const trigger=await waitFor(()=>[...document.querySelectorAll('button')].find(el=>visible(el) && /^search$/i.test(el.getAttribute('aria-label') || el.textContent.trim())));
      trigger.click();
      const input=await waitFor(()=>[...document.querySelectorAll('input')].find(el=>visible(el) && /^search$/i.test(el.placeholder)));
      // Use the native setter so React's change handler sees the new value.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,query.trim());
      input.dispatchEvent(new Event('input',{bubbles:true}));
      const tab=await waitFor(()=>[...document.querySelectorAll('[role="tab"],button')].find(el=>visible(el) && /^teams$/i.test(el.textContent.trim())));
      tab.click();
      await waitFor(()=>searchResults!==null);
      return {teams:searchResults};
    } finally {searching=false;}
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message.type==='capture') { reply({bridge_version:chrome.runtime.getManifest().version,team_id:team() || '',match_id:room(),ids:ids(),title:document.querySelector('h4')?.textContent || document.title}); return; }
    if(message.type==='detail') { detail(message.match_id).then(data=>reply({data})).catch(e=>reply({error:e.message})); return true; }
    if(message.type==='download-details' && room()===message.match_id) {detail(message.match_id,true).then(reply).catch(e=>reply({error:e.message}));return true;}
    if(message.type==='search-teams') {searchTeams(message.query).then(reply).catch(e=>reply({error:e.message}));return true;}
  });
  document.addEventListener('click',event=>{
    const button=event.target instanceof Element ? event.target.closest('button,a,[role="button"]') : null;
    const id=room();
    if(id && /(?:watch|download)\s+demo/i.test(button?.textContent || '')) {
      chrome.runtime.sendMessage({type:'arm',match_id:id}).catch(()=>{});
    }
  },true);
})();
