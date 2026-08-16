// apps_script/complete_gas.js
/*
  Full Apps Script (improved) - UPDATED for Reserve-only flow and global Manager PIN
  Paste into your Apps Script project (Code.gs). Ensure you set Script Properties:
    MASTER_DB_ID, TEMPLATE_ID, JAGO_API_KEY (optional), MANAGER_PIN (global manager PIN, plain or hashed as you prefer)
*/

// CONFIG via Script Properties
var MASTER_DB_ID = PropertiesService.getScriptProperties().getProperty('MASTER_DB_ID') || '';
var TEMPLATE_ID = PropertiesService.getScriptProperties().getProperty('TEMPLATE_ID') || '';
var JAGO_API_KEY = PropertiesService.getScriptProperties().getProperty('JAGO_API_KEY') || '';
var MANAGER_PIN = PropertiesService.getScriptProperties().getProperty('MANAGER_PIN') || '';

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
      case 'verifyManagerPin': return jsonResponse(verifyManagerPin(data.pin));
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
    var limit = 120; // requests per minute (tuned higher for POS)
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

// verifyManagerPin - compares provided pin to MANAGER_PIN Script Property
function verifyManagerPin(pin){
  try{
    if (!MANAGER_PIN) return { status:'error', pesan:'Manager PIN not configured' };
    if (!pin) return { status:'error', pesan:'PIN kosong' };
    if (String(pin) === String(MANAGER_PIN)) return { status:'ok' }; else return { status:'error', pesan:'PIN salah' };
  }catch(e){ return { status:'error', pesan:e.toString() }; }
}

// Payment webhook & reservation handling
function handlePaymentWebhook(sheetId, data){
  try{
    var ss = SpreadsheetApp.openById(sheetId);
    var sh = ss.getSheetByName('Payment_Requests'); if(!sh) sh = ss.insertSheet('Payment_Requests');
    var payments = sh.getDataRange().getValues();
    for(var i=1;i<payments.length;i++){
      if(payments[i][0] === data.payment_reference){
        sh.getRange(i+1,4).setValue(data.status);
        sh.getRange(i+1,6).setValue(new Date());
        audit(sheetId,'SYSTEM','paymentWebhook',{ref:data.payment_reference,status:data.status});
        // find reservation entry and act accordingly
        var resSh = ss.getSheetByName('Reservations');
        if(resSh){
          var rows = resSh.getDataRange().getValues();
          for(var r=1;r<rows.length;r++){
            if(rows[r][1] === data.payment_reference){
              var resStatus = data.status.toUpperCase();
              if(resStatus === 'PAID'){
                // finalize reservation: deduct stock and create Log_Transaksi entries
                var items = JSON.parse(rows[r][6] || '[]');
                var gudang = rows[r][4] || 'Gudang Utama';
                var kasir = rows[r][7] || 'Kasir';
                var reservationId = rows[r][0];
                var lock = LockService.getScriptLock(); lock.tryLock(10000);
                try{
                  var stokSh = ss.getSheetByName('Master_Stok'); if(!stokSh) stokSh = ss.insertSheet('Master_Stok');
                  var stokArr = stokSh.getDataRange().getValues();
                  // build map
                  var stokMap = {};
                  for(var si=1; si<stokArr.length; si++){ stokMap[ stokArr[si][0] + '||' + stokArr[si][2] ] = { rowIndex: si+1, stok: Number(stokArr[si][3]||0) }; }
                  var transSh = ss.getSheetByName('Log_Transaksi'); if(!transSh) transSh = ss.insertSheet('Log_Transaksi');
                  var mutSh = ss.getSheetByName('Log_Mutasi'); if(!mutSh) mutSh = ss.insertSheet('Log_Mutasi');
                  var allOk = true; var insufficient = [];
                  for(var it=0; it<items.length; it++){
                    var itObj = items[it]; var key = itObj.id + '||' + gudang;
                    if(!stokMap[key] || stokMap[key].stok < Number(itObj.qty)) { allOk = false; insufficient.push(itObj); }
                  }
                  if(!allOk){
                    // mark reservation as REVIEW_NEEDED
                    resSh.getRange(r+1,5).setValue('REVIEW_NEEDED');
                    audit(sheetId,'SYSTEM','reservation_review_needed',{reservation:reservationId,insufficient:insufficient});
                    lock.releaseLock();
                    return { status:'conflict', pesan:'Stok tidak cukup saat konfirmasi pembayaran. Review needed.' };
                  }
                  // deduct and record
                  var idTrans = rows[r][2] || ('JGP-' + new Date().getTime().toString().slice(-6));
                  for(var it2=0; it2<items.length; it2++){
                    var itObj = items[it2]; var key2 = itObj.id + '||' + gudang; var stokObj = stokMap[key2]; var newStok = stokObj.stok - Number(itObj.qty);
                    stokSh.getRange(stokObj.rowIndex,4).setValue(newStok); stokObj.stok = newStok;
                    var nameSnap = itObj.nama + (itObj.modifierText?(' ('+itObj.modifierText+')'):'');
                    transSh.appendRow([idTrans, new Date(), kasir, rows[r][3]||'Umum', gudang, itObj.id, nameSnap, Number(itObj.qty), Number(itObj.harga)||0, itObj.diskon||0, Number(itObj.qty)*Number(itObj.harga)||0, rows[r][8]||'NONCASH']);
                    mutSh.appendRow(['MUT-'+new Date().getTime().toString().slice(-6), new Date(), 'KELUAR', itObj.id, Number(itObj.qty), 'Sale '+idTrans, kasir]);
                  }
                  // mark reservation completed
                  resSh.getRange(r+1,5).setValue('COMPLETED');
                  audit(sheetId,'SYSTEM','reservation_completed',{reservation:reservationId, transaction:idTrans});
                  lock.releaseLock();
                  return { status:'ok', idTransaksi:idTrans };
                }catch(err){ try{ lock.releaseLock(); }catch(e){} resSh.getRange(r+1,5).setValue('ERROR'); audit(sheetId,'SYSTEM','reservation_error',{err:err.toString()}); return { status:'error', pesan:err.toString() }; }
              } else if(resStatus === 'FAILED' || resStatus === 'CANCELLED'){
                resSh.getRange(r+1,5).setValue('CANCELLED');
                audit(sheetId,'SYSTEM','reservation_cancelled',{ref:data.payment_reference});
                return { status:'ok', pesan:'Reservation cancelled' };
              } else {
                resSh.getRange(r+1,5).setValue(resStatus);
                return { status:'ok' };
              }
            }
          }
        }
        return { status:'ok' };
      }
    }
    return { status:'error', pesan:'Payment reference not found' };
  }catch(e){ return { status:'error', pesan:e.toString() }; }
}

// processBulkSync & processCheckout
function processBulkSync(sheetId, items){
  var results = [];
  for(var i=0;i<items.length;i++){
    try{ var res = prosesCheckout(sheetId, items[i]); if(res && (res.status==='sukses' || res.status==='pending')) results.push({ local_id: items[i].local_id || null, status:'processed', idTransaksi: res.idTransaksi || res.idTransaksi||null }); else results.push({ local_id: items[i].local_id||null, status:'conflict', pesan: res.pesan||'gagal' }); }catch(e){ results.push({ local_id: items[i].local_id||null, status:'error', pesan: e.toString() }); }
  }
  return { items: results };
}

function prosesCheckout(sheetId, dataOrder){
  // Reserve-only: do not deduct stock for non-cash until webhook PAID
  var lock = LockService.getScriptLock(); if(!lock.tryLock(10000)) return { status:'gagal', pesan:'Sistem sibuk' };
  try{
    var ss = SpreadsheetApp.openById(sheetId);
    var sheetProduk = ensureSheet(ss,'Master_Produk'); var sheetStok = ensureSheet(ss,'Master_Stok'); var sheetTrans = ensureSheet(ss,'Log_Transaksi'); var sheetPayment = ensureSheet(ss,'Payment_Requests'); var resSh = ensureSheet(ss,'Reservations');
    // ensure headers for Reservations (ID, payment_ref, txId, customer, gudang, status, items_json, kasir, metode)
    var resHeader = resSh.getRange(1,1,1,9).getValues()[0]; if(!resHeader || resHeader[0] !== 'ReservationID'){ resSh.clear(); resSh.appendRow(['ReservationID','PaymentRef','TxId','Customer','Gudang','Status','ItemsJSON','Kasir','Metode']); }

    var idTrans = 'JGP-' + new Date().getTime().toString().slice(-6);
    var gudang = dataOrder.gudang || 'Gudang Utama'; var kasir = dataOrder.kasir || 'Kasir'; var metode = dataOrder.metodeBayar || 'Tunai'; var priceType = dataOrder.priceType || 'hargaUmum';
    var prodArr = sheetProduk.getDataRange().getValues(); var stokArr = sheetStok.getDataRange().getValues(); var prodMap = {}; for(var p=1;p<prodArr.length;p++){ prodMap[prodArr[p][0]]={ nama:prodArr[p][2], hargaUmum:Number(prodArr[p][6]||0), hargaGrosir:Number(prodArr[p][7]||0), hargaMember:Number(prodArr[p][8]||0), is_weighted: prodArr[p][9]===true||prodArr[p][9]==='TRUE' }; }
    var stokMap = {}; for(var s=1;s<stokArr.length;s++){ stokMap[ stokArr[s][0]+'||'+stokArr[s][2] ] = { rowIndex: s+1, stok: Number(stokArr[s][3]||0) }; }

    // Validate existence (don't reduce stok for non-cash)
    for(var i=0;i<(dataOrder.keranjang||[]).length;i++){
      var it = dataOrder.keranjang[i];
      if(!prodMap[it.id]){ lock.releaseLock(); return { status:'gagal', pesan:'Produk tidak ditemukan: '+it.id }; }
      if(metode === 'Tunai'){
        var key = it.id+'||'+gudang; if(!stokMap[key] || stokMap[key].stok < Number(it.qty)){ lock.releaseLock(); return { status:'gagal', pesan:'Stok tidak cukup untuk '+it.id }; }
      }
    }

    var total=0; var snapshotItems = [];
    for(var i2=0;i2<(dataOrder.keranjang||[]).length;i2++){
      var it = dataOrder.keranjang[i2]; var prod = prodMap[it.id]; var unit = prod.hargaUmum;
      if(priceType==='hargaGrosir') unit=prod.hargaGrosir; if(priceType==='hargaMember') unit=prod.hargaMember;
      if(prod.is_weighted && it.weightGram){ unit=(unit/1000)*Number(it.weightGram); }
      var subtotal = unit * Number(it.qty); total += subtotal;
      snapshotItems.push({ id: it.id, nama: prod.nama, qty: it.qty, harga: unit, modifierText: it.modifierText || '' });
    }

    if(metode !== 'Tunai'){
      var payRef = 'PAY-' + new Date().getTime().toString().slice(-6);
      sheetPayment.appendRow([payRef, idTrans, metode, 'PENDING', total, new Date()]);
      resSh.appendRow(['RES-'+new Date().getTime().toString().slice(-6), payRef, idTrans, dataOrder.customer||'Umum', gudang, 'RESERVED', JSON.stringify(snapshotItems), kasir, metode]);
      audit(sheetId, kasir, 'checkout_reserved', { id: idTrans, payRef: payRef, total: total });
      lock.releaseLock();
      return { status:'pending', idTransaksi:idTrans, payment_reference: payRef, payment_url: 'https://mockpay.example/qr/' + payRef, total: total };
    }

    // Tunai -> deduct immediately (existing flow)
    for(var j=0;j<snapshotItems.length;j++){
      var item = snapshotItems[j];
      var key2 = item.id + '||' + gudang; var stokObj = stokMap[key2]; var newStok = stokObj.stok - Number(item.qty);
      sheetStok.getRange(stokObj.rowIndex,4).setValue(newStok); stokObj.stok=newStok;
      var nameSnap = item.nama + (item.modifierText?(' ('+item.modifierText+')'):'');
      sheetTrans.appendRow([idTrans, new Date(), kasir, dataOrder.customer||'Umum', gudang, item.id, nameSnap, Number(item.qty), item.harga, 0, Number(item.qty)*item.harga, metode]);
      var logMut = ensureSheet(ss,'Log_Mutasi'); logMut.appendRow(['MUT-'+new Date().getTime().toString().slice(-6), new Date(), 'KELUAR', item.id, Number(item.qty), 'Penjualan: '+idTrans, kasir]);
    }
    audit(sheetId, kasir, 'checkout', { id: idTrans, total: total });
    lock.releaseLock();
    return { status:'sukses', idTransaksi: idTrans, total: total };
  }catch(e){ try{ lock.releaseLock(); }catch(ee){} return { status:'gagal', pesan:e.toString() }; }
}

// helper ensureSheet
function ensureSheet(ss, name){ var sh=ss.getSheetByName(name); if(!sh) sh=ss.insertSheet(name); return sh; }
