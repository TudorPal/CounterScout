import { reviewedSyncNames } from './shared.mjs';
const token=document.getElementById('token'),enabled=document.getElementById('enabled'),status=document.getElementById('status');
let draft=null, reviewedNames={};
const review=document.getElementById('review'),matchSelect=document.getElementById('review-match');
const names=[document.getElementById('team1'),document.getElementById('team2')];
const applyHistory=document.getElementById('apply-history');
const expandedNames=()=>draft?reviewedSyncNames(draft.matches,reviewedNames,applyHistory.checked):{};
function showMatch() {
  const m=draft.matches[Number(matchSelect.value)];
  ['faction1','faction2'].forEach((key,i)=>{
    names[i].value=expandedNames()[m.id]?.[key] ?? m.teams[key].name ?? m.teams[key].nickname ?? '';
    document.getElementById('roster'+(i+1)).textContent=m.teams[key].roster.map(p=>p.game_player_name || p.nickname).join(' · ') || 'Roster unavailable';
  });
}
function openDraft(value,edits={}) {
  draft=value;reviewedNames=edits;review.hidden=false;matchSelect.replaceChildren();
  draft.matches.forEach((m,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=(m.teams.faction1.name || 'Team 1')+' vs '+(m.teams.faction2.name || 'Team 2');matchSelect.append(option);});
  showMatch();status.textContent='Review team names, then Confirm & sync.';
}
chrome.storage.local.get(['sync_draft','sync_reviewed_names']).then(data=>{if(data.sync_draft)openDraft(data.sync_draft,data.sync_reviewed_names || {});});
matchSelect.onchange=showMatch;
applyHistory.onchange=showMatch;
names.forEach((input,i)=>input.addEventListener('input',()=>{
  const reference=draft.matches[Number(matchSelect.value)],key=['faction1','faction2'][i];
  reviewedNames[reference.id] ??= {};reviewedNames[reference.id][key]=input.value.trim();
  void chrome.storage.local.set({sync_reviewed_names:reviewedNames});
}));
chrome.storage.local.get(['token','enabled','status']).then(data=>{token.value=data.token || '';enabled.checked=!!data.enabled;if(!draft)status.textContent=data.status || 'Not connected yet.';});
async function request(type,button) {
  button.disabled=true;status.textContent='Working…';
  try {
    const result=await chrome.runtime.sendMessage({type,token:token.value.trim(),enabled:enabled.checked,reviewed_names:expandedNames()});
    if(result?.error) throw new Error(result.error);
    if(result?.draft) {openDraft(result.draft);return;}
    if(type==='confirm-sync' || type==='cancel-sync') {draft=null;review.hidden=true;}
    status.textContent=(await chrome.storage.local.get('status')).status || 'Done.';
  } catch(e) {status.textContent=e.message;} finally{button.disabled=false;}
}
document.getElementById('connect').onclick=e=>request('connect',e.target);
document.getElementById('sync').onclick=e=>request('sync',e.target);
document.getElementById('confirm-sync').onclick=e=>request('confirm-sync',e.target);
document.getElementById('cancel-sync').onclick=e=>request('cancel-sync',e.target);
