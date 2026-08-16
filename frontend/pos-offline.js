// frontend/pos-offline.js (basic queue & sync) - expects callAPI function available
(function(){
  async function syncQueued(){
    try{
      const queued = await JagoIDB.getAll('sync_queue');
      if(!queued || !queued.length) return;
      for(const item of queued){
        try{
          const res = await window.callAPI(item.payload.action, item.payload.data, item.payload.sheetId);
          if(res && (res.status==='sukses' || res.status==='pending' || res.status==='processed')){
            await JagoIDB.del('sync_queue', item.id);
          } else if(res && res.status==='conflict'){
            item.attempts = (item.attempts||0)+1; await JagoIDB.put('sync_queue', item);
          } else { item.attempts = (item.attempts||0)+1; await JagoIDB.put('sync_queue', item); }
        }catch(e){ /* keep for retry */ }
      }
    }catch(e){ console.warn('syncQueued',e); }
  }
  window.addEventListener('online', syncQueued);
  window.addEventListener('load', ()=>{ if(navigator.onLine) setTimeout(syncQueued,1500); });
})();
