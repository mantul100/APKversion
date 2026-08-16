// frontend/pos-ui.js - small glue to detect session and load main POS UI (uses existing index.html layout earlier)
(function(){
  async function init(){
    var saved = localStorage.getItem('jagopos_data');
    if(!saved) return; // login page will handle
    var session = JSON.parse(saved);
    // minimal main app mount
    // For simplicity, redirect to legacy index.html path or render inline UI
    // If full POS UI exists in repo, load it; else show confirmation
    const root = document.getElementById('app-root'); root.innerHTML = `<div class="min-h-screen p-6"><div class="max-w-4xl mx-auto bg-white rounded p-6 shadow">`+
      `<h2 class="text-2xl font-bold">Selamat datang, ${session.nama || session.admin || 'Admin'}</h2>`+
      `<p class="text-sm text-slate-600 mt-2">Toko: ${session.toko || ''} • Sheet: ${session.sheetId || ''}</p>`+
      `<div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4"><div class="col-span-2"><div id="katalogArea" class="border rounded p-4">Memuat katalog...</div></div><div id="sidebar" class="p-4 border rounded">`+
      `<button id="btnOpenPos" class="w-full bg-blue-600 text-white py-2 rounded">Buka POS</button><div class="mt-3 text-xs text-slate-500">Sync status <span id="syncSummary">OK</span></div></div></div></div></div>`;
    document.getElementById('btnOpenPos').onclick = ()=>{ alert('POS utama belum diintegrasikan ke single-file demo. Anda bisa buka versi lama di repo atau tunggu PR merge.'); };
  }
  window.addEventListener('load', init);
})();
