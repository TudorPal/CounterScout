export const ID = '(?:1-)?[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}';
export function matchId(url) {
  try { const u=new URL(url); if(u.protocol!=='https:' || !['www.faceit.com','faceit.com'].includes(u.hostname)) return null;
    return u.pathname.match(new RegExp('/cs2/room/('+ID+')(?=/|$)'))?.[1] ?? null; } catch { return null; }
}
export function demoDownload(item) {
  const url = new URL(item.url), host = url.hostname;
  const paths = [item.filename || '', url.pathname];
  return url.protocol==='https:' && paths.some(path=>/\.dem(?:\.(?:gz|zst))?$/i.test(path)) && (host.endsWith('.faceit-cdn.net') || host === 'faceit-cdn.net' || host.endsWith('.faceit.com') || host.endsWith('.backblazeb2.com'));
}
export function associateDownload(item, arms, now=Date.now()) {
  if(!demoDownload(item)) return null;
  const fromRoom=matchId(item.referrer);
  if(fromRoom) return fromRoom;
  const recent=[...new Map(arms.filter(a=>now-a.at>=0 && now-a.at<30_000).map(a=>[a.match_id,a])).values()];
  const byUrl=recent.filter(a=>decodeURIComponent(item.url).includes(a.match_id));
  if(byUrl.length===1) return byUrl[0].match_id;
  // An ambiguous download is never attributed to the wrong roster.
  return recent.length===1 ? recent[0].match_id : null;
}
export function publicMatch(raw) {
  const p=raw.payload || raw;
  if(!new RegExp('^'+ID+'$').test(p.id || p.match_id || '')) throw new Error('Invalid match metadata');
  const teams={};
  for(const key of ['faction1','faction2']) {
    const t=p.teams?.[key] || {};
    teams[key]={id:t.id || t.faction_id, name:t.name, nickname:t.nickname, score:t.score,
      roster:(t.roster || t.players || []).map(r=>({nickname:r.nickname || r.name,game_player_name:r.game_player_name,game_player_id:/^\d{17}$/.test(String(r.game_player_id || ''))?r.game_player_id:undefined}))};
  }
  return {id:p.id || p.match_id, game:p.game, status:p.status, finished_at:p.finished_at || p.finishedAt,
    teams, results:{score:p.results?.score}, voting:{map:{pick:p.voting?.map?.pick || []}}};
}

export function demoUrls(raw) {
  const p=raw.payload || raw;
  const urls=p.demo_url || p.demo_urls || [];
  if(!Array.isArray(urls)) return [];
  return [...new Set(urls.filter(value=>{
    if(typeof value!=='string') return false;
    try {return demoDownload({url:value});} catch {return false;}
  }))].slice(0,5);
}
