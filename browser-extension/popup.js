const token=document.getElementById('token'),enabled=document.getElementById('enabled'),status=document.getElementById('status');
chrome.storage.local.get(['token','enabled','status']).then(data=>{token.value=data.token || '';enabled.checked=!!data.enabled;status.textContent=data.status || 'Not connected yet.';});
async function request(type,button) {
  button.disabled=true;status.textContent='Working…';
  try {
    const result=await chrome.runtime.sendMessage({type,token:token.value.trim(),enabled:enabled.checked});
    if(result?.error) throw new Error(result.error);
    status.textContent=(await chrome.storage.local.get('status')).status || 'Done.';
  } catch(e) {status.textContent=e.message;} finally{button.disabled=false;}
}
document.getElementById('connect').onclick=e=>request('connect',e.target);
document.getElementById('sync').onclick=e=>request('sync',e.target);
