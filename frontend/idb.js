// frontend/idb.js - minimal IndexedDB wrapper for sync queue
(function(){
  const DBNAME='JagoPOS_IDB_v1'; const DBVER=1; const STORE='sync_queue';
  function open(){ return new Promise((res,rej)=>{ var req=indexedDB.open(DBNAME,DBVER); req.onupgradeneeded=function(e){ var db=e.target.result; if(!db.objectStoreNames.contains(STORE)){ db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true}); } }; req.onsuccess=function(){ res(req.result); }; req.onerror=function(){ rej(req.error); }; }); }
  window.JagoIDB = {
    add: async function(store, obj){ var db=await open(); return new Promise((res,rej)=>{ var tx=db.transaction(STORE,'readwrite'); var s=tx.objectStore(STORE); s.add(obj).onsuccess=()=>res(true); tx.oncomplete=function(){ db.close(); }; tx.onerror=function(){ rej(tx.error); }; }); },
    getAll: async function(store){ var db=await open(); return new Promise((res,rej)=>{ var tx=db.transaction(STORE,'readonly'); var s=tx.objectStore(STORE); var r=s.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); tx.oncomplete=function(){ db.close(); }; }); },
    del: async function(store, id){ var db=await open(); return new Promise((res,rej)=>{ var tx=db.transaction(STORE,'readwrite'); var s=tx.objectStore(STORE); s.delete(id).onsuccess=()=>res(true); tx.oncomplete=function(){ db.close(); }; tx.onerror=()=>rej(tx.error); }); },
    put: async function(store, obj){ var db=await open(); return new Promise((res,rej)=>{ var tx=db.transaction(STORE,'readwrite'); var s=tx.objectStore(STORE); s.put(obj).onsuccess=()=>res(true); tx.oncomplete=function(){ db.close(); }; tx.onerror=()=>rej(tx.error); }); }
  };
})();
