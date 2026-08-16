// frontend/login.js - helper wrapper to call APIs used by login/register
async function callAPI(action, data, sheetId){
  var payload = { action: action, sheetId: sheetId || (window.JAGO_APP && window.JAGO_APP.session && window.JAGO_APP.session.sheetId) || null, data: data || {} };
  try{
    var res = await fetch(window.API_URL, { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    return await res.json();
  }catch(e){ throw e; }
}

// cekLoginTenant (to be used by frontend)
async function cekLoginTenant(username, password){ return callAPI('cekLoginTenant', { username: username, password: password }); }
