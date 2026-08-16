/* IndexedDB helper - simple wrapper */
(function(global){
  const DB_NAME = 'jagopos_local_v1';
  const DB_VERSION = 1;
  const stores = ['products_cache','sync_queue','hold_bills','shifts'];

  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e){
        const db = e.target.result;
        stores.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id', autoIncrement: true }); });
      };
      req.onsuccess = function(e){ resolve(e.target.result); };
      req.onerror = function(e){ reject(e); };
    });
  }

  async function getStore(txMode, storeName){
    const db = await openDB();
    const tx = db.transaction(storeName, txMode);
    return { store: tx.objectStore(storeName), tx, db };
  }

  async function add(storeName, value){
    const s = await getStore('readwrite', storeName);
    return new Promise((resolve,reject)=>{
      const req = s.store.add(value);
      req.onsuccess = ()=>{ resolve(req.result); };
      req.onerror = ()=> reject(req.error);
    });
  }

  async function put(storeName, value){
    const s = await getStore('readwrite', storeName);
    return new Promise((resolve,reject)=>{
      const req = s.store.put(value);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }

  async function getAll(storeName){
    const s = await getStore('readonly', storeName);
    return new Promise((resolve,reject)=>{
      const req = s.store.getAll();
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }

  async function del(storeName, key){
    const s = await getStore('readwrite', storeName);
    return new Promise((resolve,reject)=>{
      const req = s.store.delete(key);
      req.onsuccess = ()=> resolve(true);
      req.onerror = ()=> reject(req.error);
    });
  }

  global.JagoIDB = { add, put, getAll, del };
})(window);
