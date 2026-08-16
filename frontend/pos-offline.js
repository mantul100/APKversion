// pos-offline.js
// Registers service worker, patches callAPI to support offline queueing and adds barcode parser utilities.
(function(){
  // register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/frontend/service-worker.js').then(reg=> console.log('SW registered', reg)).catch(err=>console.warn('SW reg failed', err));
  }

  // Listen messages from SW to trigger sync
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', function(e){
    if (e.data && e.data.type === 'SYNC_QUEUED_TRANSACTIONS') {
      window.dispatchEvent(new Event('triggerSyncFromSW'));
    }
  });

  // Utility: parse weighted barcode
  window.parseWeightedBarcode = function(code){
    // Example prefix '22' -> 2 + 5 digits product id + 5 digits weight grams
    if (typeof code !== 'string') code = ''+code;
    if (code.startsWith('22') && code.length >= 12) {
      const prodPart = code.substr(2,5);
      const weightPart = code.substr(7,5);
      return { type: 'weighed', productId: prodPart.replace(/^0+/,''), weightGram: parseInt(weightPart,10) };
    }
    return { type: 'barcode', barcode: code };
  };

  // Patch callAPI from index.html if exists
  function patchCallAPI(){
    if (!window.callAPI) return;
    const originalCall = window.callAPI;
    window.callAPI = async function(action, data, sheetId){
      // For checkout & offline-sensitive actions, intercept when offline
      const offlineActions = ['prosesCheckout'];
      const isOffline = !navigator.onLine;
      if (offlineActions.includes(action)) {
        // ensure payload minimal: remove any price fields if present
        const safeData = JSON.parse(JSON.stringify(data));
        if (Array.isArray(safeData.keranjang)) {
          safeData.keranjang = safeData.keranjang.map(i => ({ id: i.id, qty: i.qty, modifierText: i.modifierText || '' }));
        }
        const payload = { action: action, sheetId: sheetId, data: safeData };
        if (isOffline) {
          // save to IndexedDB sync_queue
          await JagoIDB.add('sync_queue', { created_at: new Date().toISOString(), payload, is_synced:false, attempts:0 });
          return { status:'offline_queued', pesan:'Transaksi disimpan lokal (offline)', offlineInvoice: 'INV-OFF-' + Date.now() };
        }
        try {
          // online - send to server normally
          return await originalCall.call(this, action, data, sheetId);
        } catch(e) {
          // on network failure save to queue
          await JagoIDB.add('sync_queue', { created_at: new Date().toISOString(), payload, is_synced:false, attempts:0 });
          return { status:'offline_queued', pesan:'Transaksi disimpan lokal (network error)', offlineInvoice: 'INV-OFF-' + Date.now() };
        }
      }
      return originalCall.call(this, action, data, sheetId);
    };
  }

  // Attempt to patch periodically until callAPI is present
  (function tryPatch(i){
    if (window.callAPI) { patchCallAPI(); return; }
    if (i > 20) return; // give up after ~2s
    setTimeout(()=>tryPatch(i+1), 100);
  })(0);

  // Sync routine from page context (invoked by SW message or online event)
  async function trySyncQueued(){
    const queued = await JagoIDB.getAll('sync_queue');
    if (!queued || !queued.length) return;
    // send in bulk to backend endpoint /sync/transactions
    const batch = queued.map(q => ({ id: q.id, payload: q.payload }));
    try {
      const res = await fetch('/server/sync/transactions', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ items: batch }) });
      if (res.ok) {
        const result = await res.json();
        // Remove or mark items by response
        for (const r of result.items || []) {
          if (r.status === 'ok' || r.status === 'processed') {
            await JagoIDB.del('sync_queue', r.local_id);
          } else if (r.status === 'conflict') {
            // mark as needing review (let it remain) - update attempts
            const all = await JagoIDB.getAll('sync_queue');
            const local = all.find(x=>x.id===r.local_id);
            if (local) { local.attempts = (local.attempts||0)+1; await JagoIDB.put('sync_queue', local); }
          }
        }
      }
    } catch(e) {
      console.warn('Sync failed', e);
    }
  }

  window.addEventListener('online', trySyncQueued);
  window.addEventListener('triggerSyncFromSW', trySyncQueued);

})();
