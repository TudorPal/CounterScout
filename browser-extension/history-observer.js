// FACEIT's team table uses clickable rows, not <a href> links. Observe only
// public history response IDs; never inspect request headers or credentials.
(() => {
  const idPattern=/^1-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  function capture(url,data) {
    try {
      const source=new URL(url,location.origin);
      if(source.protocol!=='https:' || !['www.faceit.com','api.faceit.com'].includes(source.hostname)) return;
    } catch {return;}
    // Search is triggered through FACEIT's own visible Search UI. Only team
    // identities are forwarded, never a whole response or account data.
    if(/\/search\//.test(String(url))) {
      const teams=new Map(), uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
      let teamResponse=/\/teams(?:\?|\/|$)/i.test(String(url));
      function search(value,scope='',depth=0) {
        if(depth>12 || teams.size>=30 || !value || typeof value!=='object') return;
        if(Array.isArray(value)) {value.forEach(v=>search(v,scope,depth+1));return;}
        const type=String(value.type || value.entity_type || value.entityType || '');
        if(/^(?:player|user|club|organizer|tournament)$/i.test(type)) return;
        const isTeam=/teams?/i.test(scope) || /teams?/i.test(type) || value.team_id || value.teamId;
        if(isTeam) teamResponse=true;
        const id=value.team_id || value.teamId || value.id || value.guid;
        const name=value.name || value.nickname;
        const game=String((typeof value.game==='string'?value.game:value.game?.id) || value.game_id || '').slice(0,30);
        if(isTeam && uuid.test(String(id)) && typeof name==='string' && (!game || ['cs2','csgo'].includes(game))) teams.set(id,{id,name:name.slice(0,80),nickname:String(value.nickname || '').slice(0,80),game,members:Array.isArray(value.members)?value.members.length:value.members_count ?? value.members ?? ''});
        for(const [key,v] of Object.entries(value)) {
          if(/^(?:players?|users?|members|roster|organizers?|tournaments?|clubs?)$/i.test(key)) continue;
          if(/teams?/i.test(key)) teamResponse=true;
          search(v,/teams?/i.test(key)?key:/teams?/i.test(type)?'teams':scope,depth+1);
        }
      }
      search(data,/\/teams(?:\?|\/|$)/i.test(String(url))?'teams':'');
      if(teamResponse) window.postMessage({type:'COUNTERSCOUT_SEARCH_TEAMS',teams:[...teams.values()]},location.origin);
    }
    const team=location.pathname.match(/\/teams\/([a-f0-9-]{36})(?:\/|$)/i)?.[1];
    if(!team || !/\/(?:api\/)?stats\//.test(String(url)) || !String(url).includes(team)) return;
    const ids=new Set();
    function walk(value,depth=0) {
      if(depth>15 || ids.size>=100) return;
      if(typeof value==='string' && idPattern.test(value)) ids.add(value);
      else if(Array.isArray(value)) value.forEach(v=>walk(v,depth+1));
      else if(value && typeof value==='object') Object.entries(value).forEach(([key,v])=>{
        if(/^(?:match_id|matchId|matchid)$/i.test(key) && typeof v==='string') ids.add(v);
        else walk(v,depth+1);
      });
    }
    walk(data);
    if(ids.size) window.postMessage({type:'COUNTERSCOUT_HISTORY_IDS',team_id:team,ids:[...ids]},location.origin);
  }
  const nativeFetch=window.fetch;
  window.fetch=async function(...args) {
    const response=await nativeFetch.apply(this,args);
    const url=typeof args[0]==='string'?args[0]:args[0]?.url;
    if(response.ok && /\/(?:stats|search)\//.test(url || '')) response.clone().json().then(data=>capture(url,data)).catch(()=>{});
    return response;
  };
  const nativeOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,...args) {
    this.addEventListener('load',()=>{
      if(this.status>=200 && this.status<300 && /\/(?:stats|search)\//.test(String(url))) {
        try {capture(url,this.responseType==='json'?this.response:JSON.parse(this.responseText));}catch{}
      }
    },{once:true});
    return nativeOpen.call(this,method,url,...args);
  };
})();
