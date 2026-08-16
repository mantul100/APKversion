// frontend/pos-ui.js
// Inject UI components (shift modal, sync status badge, review queue) and wire handlers
(function(){
  // ensure JagoIDB is available
  function ready(fn){ if (window.JagoIDB) return fn(); setTimeout(()=>ready(fn),100); }

  ready(function(){
    // insert sync status badge in header
    var badge = document.createElement('div');
    badge.id = 'syncStatusBadge';
    badge.style.position = 'fixed';
    badge.style.right = '16px';
    badge.style.top = '16px';
    badge.style.zIndex = 99999;
    badge.innerHTML = '<div id="syncBadgeInner" class="bg-amber-100 text-amber-800 px-3 py-2 rounded-full text-xs font-bold shadow">SYNC: OK</div>';
    document.body.appendChild(badge);

    // inject shift modal (hidden)
    var modalHtml = '' +
      '<div id="shiftModal" class="fixed inset-0 bg-black/40 hidden items-center justify-center z-50">' +
      '  <div class="bg-white p-6 rounded-2xl w-[420px] shadow-lg">' +
      '    <h3 class="font-bold text-lg mb-3">Buka / Tutup Shift</h3>' +
      '    <div id="shiftBody">' +
      '      <div class="mb-3"><label class="text-xs font-bold">Saldo Awal Laci (Rp)</label><input id="shiftStartCash" type="number" class="w-full border rounded p-2 mt-1"></div>' +
      '      <div class="mb-3"><label class="text-xs font-bold">Saldo Aktual Laci (Rp)</label><input id="shiftCloseCash" type="number" class="w-full border rounded p-2 mt-1"></div>' +
      '    </div>' +
      '    <div class="flex gap-2 justify-end mt-4">' +
      '      <button id="btnCloseShift" class="px-4 py-2 bg-red-500 text-white rounded">Tutup Shift</button>' +
      '      <button id="btnOpenShift" class="px-4 py-2 bg-green-600 text-white rounded">Buka Shift</button>' +
      '      <button id="btnCancelShift" class="px-4 py-2 border rounded">Batal</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    var div = document.createElement('div'); div.innerHTML = modalHtml; document.body.appendChild(div.firstChild);

    // inject review-needed panel
    var reviewPanel = document.createElement('div');
    reviewPanel.id = 'reviewPanel';
    reviewPanel.style.position = 'fixed';
    reviewPanel.style.left = '16px';
    reviewPanel.style.bottom = '16px';
    reviewPanel.style.zIndex = 99999;
    reviewPanel.innerHTML = '<div id="reviewInner" class="bg-white p-3 rounded-xl shadow text-xs max-h-48 overflow-auto hidden"><strong>Review Needed</strong><div id="reviewList"></div></div>';
    document.body.appendChild(reviewPanel);

    // add button in header to open shift modal
    var header = document.querySelector('.bg-white.h-14');
    if (header) {
      var btn = document.createElement('button');
      btn.className = 'ml-4 px-3 py-1 rounded-lg bg-slate-100 text-slate-600 text-sm';
      btn.innerText = 'Shift';
      btn.onclick = function(){ document.getElementById('shiftModal').classList.remove('hidden'); document.getElementById('shiftModal').classList.add('flex'); };
      header.appendChild(btn);
    }

    // wire buttons
    document.getElementById('btnCancelShift').onclick = function(){ document.getElementById('shiftModal').classList.add('hidden'); document.getElementById('shiftModal').classList.remove('flex'); };
    document.getElementById('btnOpenShift').onclick = async function(){
      var val = parseInt(document.getElementById('shiftStartCash').value) || 0;
      showLoading(true, 'Membuka shift...');
      try{
        var res = await callAPI('openShift', { starting_cash: val, user: sessionUser.nama }, sessionUser.sheetId);
        showLoading(false);
        if (res && res.status === 'ok') { showToast('Shift dibuka', 'success'); document.getElementById('shiftModal').classList.add('hidden'); document.getElementById('shiftModal').classList.remove('flex'); }
        else showToast(res.pesan || 'Gagal buka shift','error');
      }catch(e){ showLoading(false); showToast('Gagal koneksi','error'); }
    };
    document.getElementById('btnCloseShift').onclick = async function(){
      var val = parseInt(document.getElementById('shiftCloseCash').value) || 0;
      showLoading(true, 'Menutup shift...');
      try{
        var res = await callAPI('closeShift', { actual_cash: val }, sessionUser.sheetId);
        showLoading(false);
        if (res && res.status === 'ok') { showToast('Shift ditutup. Selisih: Rp ' + (res.diff||0), 'success'); document.getElementById('shiftModal').classList.add('hidden'); document.getElementById('shiftModal').classList.remove('flex'); }
        else showToast(res.pesan || 'Gagal tutup shift','error');
      }catch(e){ showLoading(false); showToast('Gagal koneksi','error'); }
    };

    // Sync status updater
    async function updateSyncStatus(){
      try{
        var q = await JagoIDB.getAll('sync_queue');
        var count = (q && q.length) || 0;
        var el = document.getElementById('syncBadgeInner');
        if (!navigator.onLine) { el.className='bg-red-100 text-red-700 px-3 py-2 rounded-full text-xs font-bold shadow'; el.innerText = 'SYNC: OFFLINE ('+count+')'; }
        else if (count>0) { el.className='bg-amber-100 text-amber-800 px-3 py-2 rounded-full text-xs font-bold shadow'; el.innerText = 'SYNC: PENDING ('+count+')'; }
        else { el.className='bg-emerald-100 text-emerald-800 px-3 py-2 rounded-full text-xs font-bold shadow'; el.innerText = 'SYNC: OK'; }

        // update review panel
        var reviewHtml = '';
        if (q && q.length) {
          var needs = q.filter(x => x.attempts && x.attempts>0);
          if (needs.length) {
            document.getElementById('reviewInner').classList.remove('hidden');
            reviewHtml = needs.map(function(n){ return '<div class="p-2 border-b">Local#'+n.id+' - attempts: '+(n.attempts||0)+' <button data-id="'+n.id+'" class="btnRetry ml-2 text-blue-600">Retry</button></div>'; }).join('');
            document.getElementById('reviewList').innerHTML = reviewHtml;
            document.querySelectorAll('.btnRetry').forEach(function(b){ b.onclick = async function(){ var id = b.getAttribute('data-id'); var all = await JagoIDB.getAll('sync_queue'); var item = all.find(x=>x.id==id); if (item){ await JagoIDB.put('sync_queue', item); window.dispatchEvent(new Event('triggerSyncFromSW')); showToast('Retry queued', 'info'); } }; });
          } else {
            document.getElementById('reviewInner').classList.add('hidden');
          }
        } else { document.getElementById('reviewInner').classList.add('hidden'); }
      }catch(e){ console.warn('updateSyncStatus', e); }
    }

    setInterval(updateSyncStatus, 2000);
    window.addEventListener('online', updateSyncStatus);
    window.addEventListener('offline', updateSyncStatus);
    updateSyncStatus();

  });
})();
