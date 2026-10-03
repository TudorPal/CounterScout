// The app can wake the worker, but cannot access its pairing token or cookies.
if (['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3000'].includes(location.origin)) {
  window.addEventListener('message', event => {
    if(event.source === window && event.origin === location.origin && event.data?.type === 'COUNTERSCOUT_BRIDGE_WAKE') {
      chrome.runtime.sendMessage({type:'wake'}).catch(()=>{});
    }
    if(event.source===window && event.origin===location.origin && event.data?.type==='COUNTERSCOUT_BRIDGE_STATUS_REQUEST' && typeof event.data.request_id==='string') {
      const request_id=event.data.request_id;
      chrome.runtime.sendMessage({type:'connection-status'}).then(result=>window.postMessage({type:'COUNTERSCOUT_BRIDGE_STATUS',request_id,...result},location.origin))
        .catch(()=>window.postMessage({type:'COUNTERSCOUT_BRIDGE_STATUS',request_id,connected:false,error:'Reload the extension and this page.'},location.origin));
    }
  });
  window.postMessage({type:'COUNTERSCOUT_BRIDGE_READY'},location.origin);
}
