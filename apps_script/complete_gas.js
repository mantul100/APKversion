// apps_script/complete_gas.js
/*
  Full Apps Script (improved) - copy into your Apps Script project
  Includes: rate-limiter (CacheService), Audit_Logs, Shifts (open/close), Payment_Requests, processCheckout with LockService
  NOTE: This file is a copy for convenience. You must paste into Apps Script editor and deploy.
*/

// CONFIG via Script Properties
var MASTER_DB_ID = PropertiesService.getScriptProperties().getProperty('MASTER_DB_ID') || '';
var TEMPLATE_ID = PropertiesService.getScriptProperties().getProperty('TEMPLATE_ID') || '';
var JAGO_API_KEY = PropertiesService.getScriptProperties().getProperty('JAGO_API_KEY') || '';

function jsonResponse(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e){
  try{
    var raw = e.postData && e.postData.contents;
    if (!raw) return jsonResponse({ status:'error', pesan:'Empty POST' });
    var params = JSON.parse(raw);
    var action = params.action;
    var sheetId = params.sheetId || null;
    var data = params.data || {};

    // rate-limit per sheetId
    var rl = checkRateLimit(sheetId || 'global');
    if (!rl.ok) return jsonResponse({ status:'error', pesan: rl.pesan });

    // simple api_key check if set
    if (JAGO_API_KEY) {
      var key = (data && data.api_key) || params.api_key || null;
      if (!key || key !== JAGO_API_KEY) return jsonResponse({ status:'error', pesan:'Unauthorized' });
    }

    switch(action){
      case 'prosesCheckout': return jsonResponse(prosesCheckout(sheetId, data));
      case 'bulkSync': return jsonResponse(processBulkSync(sheetId, data.items||[]));
      case 'openShift': return jsonResponse(openShift(sheetId, data));
      case 'closeShift': return jsonResponse(closeShift(sheetId, data));
      case 'paymentWebhook': return jsonResponse(handlePaymentWebhook(sheetId, data));
      // add other actions mapping to functions as needed
      default: return jsonResponse({ status:'error', pesan:'Unknown action '+action });
    }
  }catch(err){ return jsonResponse({ status:'error', pesan: err.toString() }); }
}

// Rate limiter using CacheService: allow X requests per minute per key
function checkRateLimit(key){
  try{
    var cache = CacheService.getScriptCache();
    var cacheKey = 'rl_' + key;
    var raw = cache.get(cacheKey);
    var limit = 60; // requests per minute
    if (!raw){ cache.put(cacheKey, '1', 60); return { ok:true }; }
    var count = parseInt(raw,10) || 0;
    if (count > limit) return { ok:false, pesan:'Rate limit exceeded' };
    cache.put(cacheKey, String(count+1), 60);
    return { ok:true };
  }catch(e){ return { ok:true }; }
}

// Audit log helper
function audit(sheetId, userId, action, meta){
  try{
    var ss = SpreadsheetApp.openById(sheetId);
    var sh = ss.getSheetByName('Audit_Logs'); if(!sh) sh = ss.insertSheet('Audit_Logs');
    sh.appendRow([ 'AUD-' + new Date().getTime().toString().slice(-6), new Date(), userId||'', action, JSON.stringify(meta||{}) ]);
  }catch(e){ /* ignore */ }
}

// Shifts: open/close
function openShift(sheetId, data){
  try{
    var ss = SpreadsheetApp.openById(sheetId);
    var sh = ss.getSheetByName('Shifts'); if(!sh) sh = ss.insertSheet('Shifts');
    var id = 'S-' + new Date().getTime().toString().slice(-6);
    var user = data.user || 'unknown';
    var starting = Number(data.starting_cash) || 0;
    sh.appendRow([id, new Date(), '', user, starting, '', 'OPEN']);
    audit(sheetId, user, 'openShift', { shiftId:id, starting:starting });
    return { status:'ok', shiftId:id };
  }catch(e){ return { status:'error', pesan:e.toString() }; }
}

function closeShift(sheetId, data){
  try{
    var ss = SpreadsheetApp.openById(sheetId);
    var sh = ss.getSheetByName('Shifts'); if(!sh) return { status:'error', pesan:'No shifts sheet' };
    var rows = sh.getDataRange().getValues();
    // find last open shift
    var lastIndex = -1; for(var i=rows.length-1;i>=1;i--){ if(rows[i][6] === 'OPEN'){ lastIndex = i; break; } }
    if (lastIndex === -1) return { status:'error', pesan:'No open shift' };
    var expected = Number(rows[lastIndex][4]||0);
    var actual = Number(data.actual_cash) || 0;
    var diff = actual - expected;
    sh.getRange(lastIndex+1, 3).setValue(new Date()); // closed_at col index 3
    sh.getRange(lastIndex+1, 6).setValue(actual);
    sh.getRange(lastIndex+1, 7).setValue('CLOSED');
    audit(sheetId, data.user || '', 'closeShift', { expected:expected, actual:actual, diff:diff });
    if (diff !== 0){
      // lock user in Data_Pengguna - set status LOCKED
      try{
        var shUser = ss.getSheetByName('Data_Pengguna'); if(shUser){ var urows = shUser.getDataRange().getValues(); for(var j=1;j<urows.length;j++){ if(urows[j][1] === (data.user||'')){ shUser.getRange(j+1,5).setValue('LOCKED'); } } }
      }catch(e){}
    }
    return { status:'ok', diff:diff };
  }catch(e){ return { status:'error', pesan: e.toString() }; }
}

// Payment webhook
function handlePaymentWebhook(sheetId, data){
  try{
    var ss = SpreadsheetApp.openById(sheetId);
    var sh = ss.getSheetByName('Payment_Requests'); if(!sh) sh = ss.insertSheet('Payment_Requests');
    var rows = sh.getDataRange().getValues();
    for(var i=1;i<rows.length;i++){
      if(rows[i][0] === data.payment_reference){ sh.getRange(i+1,4).setValue(data.status); sh.getRange(i+1,6).setValue(new Date()); audit(sheetId,'SYSTEM','paymentWebhook',{ref:data.payment_reference,status:data.status}); return { status:'ok' }; }
    }
    return { status:'error', pesan:'ref not found' };
  }catch(e){ return { status:'error', pesan:e.toString() }; }
}

// processBulkSync & processCheckout reuse earlier implementations (simplified)
function processBulkSync(sheetId, items){
  var results = [];
  for(var i=0;i<items.length;i++){
    try{ var res = prosesCheckout(sheetId, items[i]); if(res && (res.status==='sukses' || res.status==='pending')) results.push({ local_id: items[i].local_id || null, status:'processed', idTransaksi: res.idTransaksi || res.idTransaksi||null }); else results.push({ local_id: items[i].local_id||null, status:'conflict', pesan: res.pesan||'gagal' }); }catch(e){ results.push({ local_id: items[i].local_id||null, status:'error', pesan: e.toString() }); }
  }
  return { items: results };
}

function prosesCheckout(sheetId, dataOrder){
  var lock = LockService.getScriptLock(); if(!lock.tryLock(10000)) return { status:'gagal', pesan:'Sistem sibuk' };
  try{
    var ss = SpreadsheetApp.openById(sheetId);
    var sheetProduk = ensureSheet(ss,'Master_Produk'); var sheetStok = ensureSheet(ss,'Master_Stok'); var sheetTrans = ensureSheet(ss,'Log_Transaksi'); var sheetPayment = ensureSheet(ss,'Payment_Requests');
    var idTrans = 'JGP-' + new Date().getTime().toString().slice(-6);
    var gudang = dataOrder.gudang || 'Gudang Utama'; var kasir = dataOrder.kasir || 'Kasir'; var metode = dataOrder.metodeBayar || 'Tunai'; var priceType = dataOrder.priceType || 'hargaUmum';
    var prodArr = sheetProduk.getDataRange().getValues(); var stokArr = sheetStok.getDataRange().getValues(); var prodMap = {}; for(var p=1;p<prodArr.length;p++){ prodMap[prodArr[p][0]]={ nama:prodArr[p][2], hargaUmum:Number(prodArr[p][6]||0), hargaGrosir:Number(prodArr[p][7]||0), hargaMember:Number(prodArr[p][8]||0), is_weighted: prodArr[p][9]===true||prodArr[p][9]==='TRUE' }; }
    var stokMap = {}; for(var s=1;s<stokArr.length;s++){ stokMap[ stokArr[s][0]+'||'+stokArr[s][2] ] = { rowIndex:s+1, stok:Number(stokArr[s][3]||0) }; }
    // validate
    for(var i=0;i<(dataOrder.keranjang||[]).length;i++){ var it = dataOrder.keranjang[i]; var key = it.id+'||'+gudang; if(!stokMap[key]){ lock.releaseLock(); return { status:'gagal', pesan:'Produk tidak ditemukan di gudang' }; } if(stokMap[key].stok < Number(it.qty)){ lock.releaseLock(); return { status:'gagal', pesan:'Stok tidak cukup untuk '+it.id }; } }
    var total=0;
    for(var i2=0;i2<(dataOrder.keranjang||[]).length;i2++){ var it=dataOrder.keranjang[i2]; var prod=prodMap[it.id]; var unit=prod.hargaUmum; if(priceType==='hargaGrosir') unit=prod.hargaGrosir; if(priceType==='hargaMember') unit=prod.hargaMember; if(prod.is_weighted && it.weightGram){ unit=(unit/1000)*Number(it.weightGram); }
      var subtotal = unit * Number(it.qty); total += subtotal; var key2 = it.id+'||'+gudang; var stokObj = stokMap[key2]; var newStok = stokObj.stok - Number(it.qty); sheetStok.getRange(stokObj.rowIndex,4).setValue(newStok); stokObj.stok=newStok; var nameSnap = prod.nama + (it.modifierText?(' ('+it.modifierText+')'):''); sheetTrans.appendRow([idTrans, new Date(), kasir, dataOrder.customer||'Umum', gudang, it.id, nameSnap, Number(it.qty), unit, it.diskon||0, subtotal, metode]); var logMut=ensureSheet(ss,'Log_Mutasi'); logMut.appendRow(['MUT-'+new Date().getTime().toString().slice(-6), new Date(), 'KELUAR', it.id, Number(it.qty), 'Sale '+idTrans, kasir]); }
    if(metode !== 'Tunai'){ var payRef='PAY-'+ new Date().getTime().toString().slice(-6); sheetPayment.appendRow([payRef, idTrans, metode, 'PENDING', total, new Date()]); audit(sheetId, kasir, 'checkout_pending', {id:idTrans, total:total}); lock.releaseLock(); return { status:'pending', idTransaksi:idTrans, payment_reference:payRef, payment_url:'https://mockpay.example/qr/'+payRef, total:total }; }
    audit(sheetId, kasir, 'checkout', { id:idTrans, total:total }); lock.releaseLock(); return { status:'sukses', idTransaksi:idTrans, total:total };
  }catch(e){ try{ lock.releaseLock(); }catch(ee){} return { status:'gagal', pesan:e.toString() }; }
}

// helper ensureSheet same as earlier
function ensureSheet(ss, name){ var sh=ss.getSheetByName(name); if(!sh) sh=ss.insertSheet(name); return sh; }
