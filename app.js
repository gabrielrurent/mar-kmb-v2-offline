/* ============================================================
   MAR Offline — M1 Mekanik + M2 Create + M3 Approval
   Prinsip: CACHE → ANTRE → SINKRON. Server selalu benar.
   ============================================================ */

var CONFIG = { API_URL: 'https://script.google.com/macros/s/AKfycbwlwlQvOGVF6FdKkYRNlbgdJCets5L-0AfufMB4_79_HzvoQkeE9aZAqkKZiXCZHXnG6Q/exec' };
// SATU sumber kebenaran versi: nama CACHE di sw.js. Nilai di bawah hanya
// cadangan bila Cache API tak tersedia — saat boot, versinya DIBACA dari cache
// service worker yang benar-benar aktif (lihat syncVersionFromCache).
// Dengan begitu rilis cukup mengubah CACHE di sw.js; angka di sini tak bisa lagi
// tertinggal diam-diam seperti dulu (APP_VERSION v26 vs CACHE v34).
var APP_VERSION = 'v49';

// ── Pembaruan versi otomatis ────────────────────────────────────────────────
// sw.js sudah skipWaiting()+clients.claim(), jadi versi baru mengambil alih
// begitu TERUNDUH. Yang dulu hilang: pemicunya. register() hanya mengecek saat
// halaman dimuat, sedangkan PWA di HP mekanik bisa berhari-hari tidak pernah
// dinavigasi ulang — jadi mereka tertinggal di versi lama tanpa tanda apa pun.
var _swReg = null;
var _swReloaded = false;
var _swPendingReload = false;
var _swLastCheck = 0;
var SW_CHECK_MIN_MS = 10 * 60 * 1000;   // sw.js di GitHub Pages max-age=600

/** Minta browser mengecek sw.js baru. Dibatasi agar tak boros kuota. */
function cekPembaruan(paksa) {
  if (!_swReg || !navigator.onLine) return;
  var now = Date.now();
  if (!paksa && (now - _swLastCheck) < SW_CHECK_MIN_MS) return;
  _swLastCheck = now;
  try { _swReg.update(); } catch (e) {}
}

/** Muat ulang sekali saja — dipanggil saat SW baru mengambil alih. */
function _lakukanReloadSW() {
  if (_swReloaded) return;
  _swReloaded = true;
  window.location.reload();
}

// ── Tombol "⬆️ Versi": lihat versi terpasang vs server, lalu perbarui paksa ──
// Versi server dibaca dari sw.js (var CACHE = 'mar-vNN') dengan pembatal cache,
// jadi tak perlu file versi terpisah yang bisa lupa di-bump.
var _vServer = null;

function bacaVersiServer() {
  var url = './sw.js?cek=' + Date.now();
  return fetch(url, {cache: 'no-store'}).then(function(r){ return r.text(); }).then(function(t) {
    var m = t.match(/var CACHE = '(mar-v\d+)'/);
    return m ? m[1].replace('mar-', '') : null;
  });
}

function bukaCekVersi() {
  document.getElementById('vTerpasang').textContent = APP_VERSION;
  document.getElementById('vServer').textContent = 'mengecek…';
  document.getElementById('vBtnUpdate').style.display = 'none';
  document.getElementById('vCatatan').style.display = 'none';
  _setVStatus('⏳ Mengecek…', '#F3F4F6', '#374151');
  showModal('versiModal');

  if (!navigator.onLine) {
    document.getElementById('vServer').textContent = '-';
    _setVStatus('📴 Tidak ada sinyal — sambungkan dulu untuk cek versi', '#FEF2F2', '#991B1B');
    return;
  }
  bacaVersiServer().then(function(v) {
    _vServer = v;
    document.getElementById('vServer').textContent = v || '?';
    if (!v) { _setVStatus('⚠️ Gagal membaca versi server', '#FEF2F2', '#991B1B'); return; }
    if (v === APP_VERSION) {
      _setVStatus('✅ Sudah versi terbaru', '#ECFDF5', '#065F46');
    } else {
      _setVStatus('⬆️ Versi baru tersedia: ' + v, '#FFFBEB', '#92400E');
      document.getElementById('vBtnUpdate').style.display = 'block';
      document.getElementById('vCatatan').style.display = 'block';
    }
  }).catch(function() {
    document.getElementById('vServer').textContent = '?';
    _setVStatus('⚠️ Gagal menghubungi server', '#FEF2F2', '#991B1B');
  });
}

function _setVStatus(teks, bg, fg) {
  var el = document.getElementById('vStatus');
  el.textContent = teks; el.style.background = bg; el.style.color = fg;
}

/**
 * Perbarui paksa: hapus SELURUH cache aplikasi lalu muat ulang.
 * AMAN untuk antrean — outbox ada di IndexedDB, bukan Cache Storage; yang
 * dihapus hanya berkas aplikasi (html/js/ikon) yang toh diunduh ulang.
 * Karena itu juga wajib online: menghapus cache saat offline akan membuat
 * aplikasi tak bisa dibuka sama sekali.
 */
function perbaruiSekarang() {
  if (!navigator.onLine) { toast('📴 Perlu sinyal untuk memperbarui'); return; }
  var btn = document.getElementById('vBtnUpdate');
  btn.disabled = true; btn.textContent = '⏳ Memperbarui…';
  _setVStatus('⏳ Mengunduh versi baru…', '#FFFBEB', '#92400E');

  var langkah = Promise.resolve();
  if (window.caches && caches.keys) {
    langkah = caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }).catch(function(){});
  }
  // Menghapus Cache Storage TIDAK menyentuh IndexedDB, tempat daftar mekanik &
  // unit disimpan — itu sebabnya dulu naik versi tak membuat orang baru muncul.
  // Cukup lupakan STEMPEL WAKTU-nya supaya refs ditarik ulang saat sync
  // berikutnya. JANGAN hapus store lain: outbox ada di sana, dan antrean kerja
  // yang belum terkirim tidak boleh ikut hilang.
  langkah = langkah.then(function(){ return kvSet('refs_at', null).catch(function(){}); }).catch(function(){});
  langkah.then(function() {
    // Daftarkan ulang SW supaya install() berjalan & mengisi cache versi baru.
    if (_swReg && _swReg.update) { try { return _swReg.update(); } catch (e) {} }
  }).then(function() {
    // Reload tanpa menunggu controllerchange — cache sudah kosong, jadi berkas
    // pasti diambil dari jaringan (fetch handler jatuh ke network saat cache miss).
    _swReloaded = true;
    setTimeout(function(){ window.location.reload(); }, 600);
  }).catch(function() {
    btn.disabled = false; btn.textContent = '⬇️ Perbarui Sekarang';
    _setVStatus('⚠️ Gagal memperbarui — coba lagi', '#FEF2F2', '#991B1B');
  });
}

/** Baca versi dari nama cache SW yang aktif → APP_VERSION selalu jujur. */
function syncVersionFromCache() {
  try {
    if (typeof caches === 'undefined' || !caches.keys) return Promise.resolve();
    return caches.keys().then(function(keys) {
      for (var i = 0; i < keys.length; i++) {
        var m = /^mar-(v\d+)$/.exec(keys[i]);
        if (m) { APP_VERSION = m[1]; break; }
      }
    }).catch(function(){});
  } catch (e) { return Promise.resolve(); }
}
var S = { token:null, me:null, role:null, wos:[], refs:null, refsAt:null, pending:[], active:[], approved:[], transfers:[], monitoring:[], monitoringOverall:{}, outbox:[], lastSync:null, syncing:false, tab:'wos', appSub:'pending', showOutbox:false, crossFunc:false, timerStates:{} };
// PERF: katalog referensi (±1400 job) berat — tarik ulang maks 1x/12 jam.
// Ambang "referensi sudah basi" untuk sync OTOMATIS. Dulu 12 jam: menambah
// mekanik baru di spreadsheet baru muncul di HP keesokan harinya, dan tak ada
// cara mempercepatnya — refs disimpan di IndexedDB, jadi muat ulang halaman
// maupun naik versi (yang hanya menghapus Cache Storage) sama sekali tak
// menyentuhnya. Sync MANUAL kini selalu menarik ulang; angka ini tinggal jaring
// pengaman untuk yang tak pernah menekan Sync.
var REFS_TTL_MS = 30*60*1000;
function refsStale() { return !S.refs || !S.refsAt || (Date.now() - new Date(S.refsAt).getTime() > REFS_TTL_MS); }
var db = null;

/* ══ LIVE TIMER (port 1:1 dari SUM V2) ══════════════════════════════════════
   Beda dari SUM: di KMB picker jam TETAP TERLIHAT dan boleh dikoreksi manual.
   Timer hanya mengisinya; angka akhir yang dikirim tetap dari picker. */
var _liveTimerTicker = null;

function getTimerState(woId) {
  if (!S.timerStates) S.timerStates = {};
  if (!S.timerStates[woId]) S.timerStates[woId] = { state:'idle', start_epoch:0, elapsed_ms:0 };
  return S.timerStates[woId];
}
function saveTimerState(woId, state) {
  if (!S.timerStates) S.timerStates = {};
  S.timerStates[woId] = state;
  kvSet('timer_states', S.timerStates);
}

/**
 * Jeda semua WO lain yang masih berjalan.
 * JALUR UANG: tanpa ini dua timer bisa jalan bersamaan → jam dobel-hitung →
 * poin & rupiah salah. Waktu WO yang dijeda tetap tersimpan utuh.
 */
function pauseOtherRunningTimers(currentWoId) {
  var paused = [];
  if (!S.timerStates) return paused;
  for (var id in S.timerStates) {
    if (!S.timerStates.hasOwnProperty(id)) continue;
    if (String(id) === String(currentWoId)) continue;
    var st = S.timerStates[id];
    if (!st || st.state !== 'running') continue;
    st.elapsed_ms = (parseFloat(st.elapsed_ms)||0) + (Date.now() - (parseFloat(st.start_epoch)||Date.now()));
    st.state = 'paused'; st.start_epoch = 0;
    S.timerStates[id] = st; paused.push(id);
  }
  if (paused.length) kvSet('timer_states', S.timerStates);
  return paused;
}

function startLiveTimer(woId) {
  var autoPaused = pauseOtherRunningTimers(woId);   // hanya SATU WO boleh berjalan
  var st = getTimerState(woId);
  st.state = 'running'; st.start_epoch = Date.now();
  saveTimerState(woId, st);
  startTimerTicker(); renderAll();
  if (autoPaused.length) toast('⏸ '+autoPaused.length+' WO lain otomatis dijeda (waktunya tersimpan)');
}
function pauseLiveTimer(woId) {
  var st = getTimerState(woId);
  if (st.state !== 'running') return;
  st.state = 'paused';
  st.elapsed_ms += (Date.now() - st.start_epoch);
  st.start_epoch = 0;
  saveTimerState(woId, st); renderAll();
}
/**
 * Hentikan timer TANPA menghapus waktunya — kalau mekanik menutup form tanpa
 * mengirim, jam kerjanya tidak boleh hilang. Baru dibersihkan setelah masuk
 * antrean kirim (clearTimerAfterSubmit).
 */
function stopLiveTimer(woId) {
  var st = getTimerState(woId);
  var totalMs = (parseFloat(st.elapsed_ms)||0);
  if (st.state === 'running') totalMs += (Date.now() - (parseFloat(st.start_epoch)||Date.now()));
  st.state = 'paused'; st.elapsed_ms = totalMs; st.start_epoch = 0;
  saveTimerState(woId, st); renderAll();
  return totalMs;
}
function clearTimerAfterSubmit(woId) {
  saveTimerState(woId, { state:'idle', start_epoch:0, elapsed_ms:0 });
  renderAll();
}

function msToJamMenit(ms) {
  var tot = Math.round((parseFloat(ms)||0)/60000);
  var j = Math.floor(tot/60), m = tot%60;
  if (j>0 && m>0) return j+' jam '+m+' menit';
  if (j>0) return j+' jam';
  return m+' menit';
}
function formatMsToHms(ms) {
  if (!ms || ms < 0) return '00:00:00';
  var sec = Math.floor(ms/1000);
  var hr = Math.floor(sec/3600);
  var min = Math.floor((sec-(hr*3600))/60);
  sec = sec-(hr*3600)-(min*60);
  if (hr<10) hr='0'+hr; if (min<10) min='0'+min; if (sec<10) sec='0'+sec;
  return hr+':'+min+':'+sec;
}
function formatToDatetimeLocal(date) {
  var pad = function(n){ return (n<10?'0':'')+n; };
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+
    'T'+pad(date.getHours())+':'+pad(date.getMinutes());
}
function showTimerSummary(totalMs, startD, endD) {
  var box = document.getElementById('fTimerSummary');
  if (!box) return;
  if (!totalMs || totalMs <= 0) { box.style.display='none'; box.innerHTML=''; return; }
  box.style.display = 'block';
  box.innerHTML = '✅ Total waktu pengerjaan: <b>'+msToJamMenit(totalMs)+'</b>'+
    '<div style="font-weight:600;font-size:11px;margin-top:3px;opacity:.85">'+
    formatToDatetimeLocal(startD).replace('T',' ')+' → '+formatToDatetimeLocal(endD).replace('T',' ')+'</div>';
}

function startTimerTicker() {
  if (_liveTimerTicker) return;
  _liveTimerTicker = setInterval(function() {
    var hasRunning = false;
    if (S.timerStates) {
      for (var id in S.timerStates) {
        if (S.timerStates[id] && S.timerStates[id].state === 'running') { hasRunning = true; break; }
      }
    }
    if (hasRunning) updateActiveTimerDisplays();
  }, 1000);
}
function updateActiveTimerDisplays() {
  if (!S.timerStates) return;
  for (var woId in S.timerStates) {
    var st = S.timerStates[woId];
    if (!st) continue;
    var curMs = st.elapsed_ms + (st.state==='running' ? (Date.now()-st.start_epoch) : 0);
    var cardDisp = document.getElementById('timer-clock-'+woId);
    if (cardDisp) cardDisp.textContent = formatMsToHms(curMs);
    if (activeWo && String(activeWo.id) === String(woId)) {
      var mDisp = document.getElementById('modalTimerDisplay');
      if (mDisp) mDisp.textContent = formatMsToHms(curMs);
    }
  }
}
function updateModalTimerUI() {
  if (!activeWo) return;
  var st = getTimerState(activeWo.id);
  var disp = document.getElementById('modalTimerDisplay');
  var bStart = document.getElementById('modalBtnStart');
  var bPause = document.getElementById('modalBtnPause');
  var bStop  = document.getElementById('modalBtnStop');
  if (!disp) return;

  disp.textContent = formatMsToHms(st.elapsed_ms + (st.state==='running' ? (Date.now()-st.start_epoch) : 0));

  if (st.state === 'idle') {
    bStart.style.display='inline-block'; bStart.textContent='▶ Start';
    bPause.style.display='none'; bStop.style.display='none';
  } else if (st.state === 'running') {
    bStart.style.display='none';
    bPause.style.display='inline-block'; bStop.style.display='inline-block';
  } else {
    bStart.style.display='inline-block'; bStart.textContent='▶ Resume';
    bPause.style.display='none'; bStop.style.display='inline-block';
  }
}
function modalTimerStart() { if (activeWo) { startLiveTimer(activeWo.id); updateModalTimerUI(); } }
function modalTimerPause() { if (activeWo) { pauseLiveTimer(activeWo.id); updateModalTimerUI(); } }
function modalTimerStop() {
  if (!activeWo) return;
  var cur = getTimerState(activeWo.id);
  var preview = (parseFloat(cur.elapsed_ms)||0) + (cur.state==='running' ? (Date.now()-cur.start_epoch) : 0);
  if (preview > 0 && preview < 60000 &&
      !confirm('Durasi kerja baru '+msToJamMenit(preview)+'.\nYakin hentikan timer dan pakai durasi ini?')) return;
  var totalMs = stopLiveTimer(activeWo.id);
  if (totalMs > 0) {
    var now = new Date(), start = new Date(now.getTime()-totalMs);
    document.getElementById('fStart').value = formatToDatetimeLocal(start);
    document.getElementById('fEnd').value   = formatToDatetimeLocal(now);
    showTimerSummary(totalMs, start, now);
  }
  updateModalTimerUI();
}
/** Blok kontrol timer di kartu WO (Start / Pause / Finish). */
function _timerControls(wo) {
  var st = getTimerState(wo.id);
  var curMs = st.elapsed_ms + (st.state==='running' ? (Date.now()-st.start_epoch) : 0);
  var id = esc(String(wo.id));
  var isRunning = (st.state==='running'), isPaused = (st.state==='paused');
  return '<div class="timerPill">'+
    '<div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:2px">⏱️ LIVE TIMER</div>'+
    '<div class="timerClock" id="timer-clock-'+id+'">'+formatMsToHms(curMs)+'</div>'+
    '<div class="timerBtns">'+
      (isRunning?'':'<button type="button" class="timerBtn btnStart" onclick="startLiveTimer(\''+id+'\')">▶ '+(isPaused?'Resume':'Start')+'</button>')+
      (isRunning?'<button type="button" class="timerBtn btnPause" onclick="pauseLiveTimer(\''+id+'\')">⏸ Pause</button>':'')+
      (st.state!=='idle'?'<button type="button" class="timerBtn btnStop" onclick="openSubmitWithTimer(\''+id+'\')">⏹ Finish &amp; Isi</button>':'')+
    '</div>'+
  '</div>';
}

/** Dipakai tombol "Finish & Isi" di kartu WO: stop timer lalu buka form terisi. */
function openSubmitWithTimer(woId) {
  var totalMs = stopLiveTimer(woId);
  openSubmitForm(woId);
  if (totalMs > 0) {
    var now = new Date(), start = new Date(now.getTime()-totalMs);
    document.getElementById('fStart').value = formatToDatetimeLocal(start);
    document.getElementById('fEnd').value   = formatToDatetimeLocal(now);
    showTimerSummary(totalMs, start, now);
  }
}

/* ── IndexedDB ── */
function openDb() {
  return new Promise(function(res,rej) {
    var r = indexedDB.open('mar_v2',2);
    r.onupgradeneeded = function(e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox',{keyPath:'op_id'});
    };
    r.onsuccess = function() { db = r.result; res(); };
    r.onerror = function() { rej(r.error); };
  });
}
function idbReq(store,mode,fn) {
  return new Promise(function(res,rej) {
    var tx = db.transaction(store,mode);
    var rq = fn(tx.objectStore(store));
    rq.onsuccess = function() { res(rq.result); };
    rq.onerror = function() { rej(rq.error); };
  });
}
function kvGet(k) { return idbReq('kv','readonly',function(s){return s.get(k);}); }
function kvSet(k,v) { return idbReq('kv','readwrite',function(s){return s.put(v,k);}); }
function obAll() { return idbReq('outbox','readonly',function(s){return s.getAll();}); }
function obPut(item) { return idbReq('outbox','readwrite',function(s){return s.put(item);}); }
function obDel(opId) { return idbReq('outbox','readwrite',function(s){return s.delete(opId);}); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'op-'+Date.now()+'-'+Math.random().toString(36).slice(2,10); }

// Nomor urut antrean dalam satu sesi — pemecah seri saat created_at sama persis
// (klik beruntun bisa jatuh di milidetik yang sama).
var _enqSeq = 0;

/** Indikator "sedang mengirim ke-n dari m" di baris info outbox. */
function showSendProgress(idx, total, op) {
  var el = document.getElementById('outboxInfo');
  if (!el) return;
  var label = op ? (opLabel(op) || '') : '';
  el.textContent = '📤 Mengirim ' + idx + '/' + total + (label ? ' · ' + label : '') + '…';
  el.style.color = '#1e40af';
}

/* ── API ── */
function api(action,data,opId) {
  var body = JSON.stringify({token:S.token, action:action, data:data||{}, op_id:opId||undefined});
  return fetch(CONFIG.API_URL, {method:'POST', headers:{'Content-Type':'text/plain'}, body:body})
    .then(function(r){return r.json();});
}

/* ── Install PWA: tombol 1-tap via beforeinstallprompt ── */
var IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
var IS_STANDALONE = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
var _installPrompt = null;
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  _installPrompt = e;
  var b = document.getElementById('installBtn'); if (b) b.style.display = '';
});
window.addEventListener('appinstalled', function() {
  _installPrompt = null;
  var b = document.getElementById('installBtn'); if (b) b.style.display = 'none';
  toast('✅ Terinstal! Buka dari ikon MAR di layar utama.');
});
function doInstall() {
  if (IS_IOS) { showModal('iosModal'); return; } // iOS: tak ada prompt otomatis → panduan
  if (!_installPrompt) { toast('Buka menu Chrome ⋮ → "Instal aplikasi" / "Tambahkan ke layar utama"'); return; }
  _installPrompt.prompt();
  _installPrompt.userChoice.then(function(){ _installPrompt = null; });
}

/* ── Notifikasi ── */
function requestNotifPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
}
function notifyLocal(body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function(reg){ return reg.showNotification('MAR Offline', {body: body, icon: './icon-192.png', badge: './icon-192.png', tag: 'mar-info'}); }).catch(function(){});
    }
  } catch (e) {}
}
/* Periodic Background Sync (PWA ter-instal): Chrome bangunkan SW berkala →
   flush antrean + cek WO pending → push notif. Interval diatur Chrome (≥ jam-jaman). */
function requestPeriodicSync() {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function(reg) {
        if ('periodicSync' in reg) return reg.periodicSync.register('mar-check', {minInterval: 60 * 60 * 1000});
      }).catch(function(){});
    }
  } catch (e) {}
}

/* ── Web Push: daftarkan "alamat pos" HP ini ke server (idempotent) ── */
function _urlB64ToUint8(b64) {
  var pad = new Array((4 - (b64.length % 4)) % 4 + 1).join('=');
  var base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(base);
  var arr = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
function subscribePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!S.token) return;
    navigator.serviceWorker.ready.then(function(reg) {
      return reg.pushManager.getSubscription().then(function(sub) {
        if (sub) return sub;
        return api('get_vapid_key').then(function(r) {
          if (!r.success || !r.result || !r.result.key) return null;
          return reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: _urlB64ToUint8(r.result.key)});
        });
      });
    }).then(function(sub) {
      if (!sub) return;
      var j = sub.toJSON();
      // guard: kirim ulang hanya bila endpoint berubah / belum tercatat (server upsert)
      return kvGet('push_saved').then(function(saved) {
        if (saved === j.endpoint) return;
        return api('save_push_sub', {endpoint: j.endpoint, p256dh: (j.keys && j.keys.p256dh) || '', auth: (j.keys && j.keys.auth) || ''})
          .then(function(r2) { if (r2.success) return kvSet('push_saved', j.endpoint); });
      });
    }).catch(function(){});
  } catch (e) {}
}

/* ── Background Sync: minta Chrome kirim antrean nanti walau app ditutup ── */
function requestBgSync() {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(function(reg){ return reg.sync.register('mar-outbox'); }).catch(function(){});
    }
  } catch (e) {}
}

/* ── Sync ── */
var _syncAgain = false;   // ada permintaan sync yang datang saat sync sedang jalan
function syncNow(manual) {
  // JANGAN buang permintaan ini. Dulu (dan masih terjadi di SUM sebelum diperbaiki):
  // approve beruntun → klik ke-2 & ke-3 datang saat sync pertama masih jalan, lalu
  // dibuang begitu saja. Snapshot antrean sudah diambil sebelum keduanya masuk, jadi
  // hanya WO PERTAMA yang terkirim; sisanya menggantung sampai user menekan Sync
  // manual. Tandai, lalu jalankan ulang otomatis setelah sync ini selesai.
  if (S.syncing) { _syncAgain = true; return Promise.resolve(); }
  if (manual) requestNotifPermission();
  if (!navigator.onLine) { requestBgSync(); if (manual) toast('📴 Offline — data aman di antrean, terkirim otomatis saat ada sinyal'); renderAll(); return Promise.resolve(); }
  S.syncing = true; renderAll();
  return flushOutbox()
    .then(function(sent) {
      if (sent > 0) {
        toast('✅ '+sent+' operasi terkirim — tidak lagi antre');
        if (document.hidden) notifyLocal('✅ '+sent+' operasi terkirim — tidak lagi antre');
      }
      // PERF/R2: mekanik tarik WO-nya; approver TIDAK perlu pull_my_wos (tab
      // WO Saya disembunyikan) — hemat 1 panggilan API per sync.
      // Sync MANUAL selalu menarik referensi (daftar mekanik, unit, katalog job),
      // mengabaikan TTL. Menekan tombol Sync artinya "saya mau data terbaru
      // SEKARANG" — biasanya justru sesudah menambah orang baru di spreadsheet.
      // Sync otomatis tetap patuh TTL supaya tidak boros kuota.
      var perluRefs = manual || refsStale();
      var tasks = [];
      if (S.role === 'mechanic') { tasks.push(pullWos()); if (perluRefs) tasks.push(pullRefs()); }
      else { tasks.push(pullPending()); tasks.push(pullActive()); tasks.push(pullTransfers()); tasks.push(pullMonitoring()); if (perluRefs) tasks.push(pullRefs()); }
      return Promise.all(tasks);
    })
    .then(function() { S.lastSync = new Date().toISOString(); subscribePush(); return kvSet('last_sync',S.lastSync); })
    .catch(function(e) { requestBgSync(); toast('⚠️ Sync gagal: '+e.message); })
    .then(function() { S.syncing = false; return refreshOutbox(); })
    .then(function() {
      renderAll();
      if (_syncAgain) { _syncAgain = false; return syncNow(false); }   // kirim sisa antrean
    });
}
function flushOutbox() {
  var sent = 0;
  return obAll().then(function(items) {
    var queue = items.filter(function(it){return it.status==='queued'||it.status==='failed_retry';});
    // FIFO: getAll IndexedDB terurut op_id (uuid acak) — urutannya praktis acak.
    // Sortir manual supaya operasi dikirim sesuai urutan dibuat; kalau tidak,
    // aksi yang seharusnya mendahului (mis. override sebelum approve WO yang sama)
    // bisa tiba belakangan dan approver menilai angka yang sudah basi.
    queue.sort(function(a,b){
      var ca=String(a.created_at||''), cb=String(b.created_at||'');
      if (ca<cb) return -1; if (ca>cb) return 1;
      return (a.seq||0)-(b.seq||0);
    });
    var _total = queue.length, _idx = 0;
    var chain = Promise.resolve();
    queue.forEach(function(it) {
      chain = chain.then(function() {
        _idx++;
        showSendProgress(_idx, _total, it);   // "📤 Mengirim 2/5 · L1 WO-xxx"
        return api(it.action, it.payload, it.op_id).then(function(r) {
          if (r.success) { it.status='done'; it.result=r.result; sent++; }
          else { it.status='failed'; it.error=(typeof r.error==='string')?r.error:JSON.stringify(r.error); }
          // Perbarui tampilan tiap item selesai — antrean panjang tidak terlihat macet.
          return obPut(it).then(function(){ return refreshOutbox(); }).then(function(){ renderAll(); });
        }).catch(function() { return obPut(it).then(function(){throw new Error('koneksi terputus');}); });
      });
    });
    return chain.then(function(){ return sent; });
  });
}
function pullWos() {
  return api('pull_my_wos').then(function(r) {
    if (!r.success) return;
    S.wos = (r.result && r.result.wos) || [];
    return kvSet('wos', S.wos);
  });
}
function pullRefs() {
  return api('pull_create_refs').then(function(r) {
    if (!r.success) return;
    S.refs = r.result.refs;
    S.refsAt = new Date().toISOString();
    return kvSet('refs', S.refs).then(function(){ return kvSet('refs_at', S.refsAt); });
  });
}
/** MONITORING: ringkasan per mekanik untuk approver (difilter scope di server). */
function pullMonitoring() {
  return api('pull_monitoring').then(function(r) {
    if (!r.success) return;
    S.monitoring = (r.result && r.result.mechanics) || [];
    S.monitoringOverall = (r.result && r.result.overall) || {};
    return kvSet('monitoring', S.monitoring).then(function(){ return kvSet('monitoring_overall', S.monitoringOverall); });
  });
}

/** TRANSFER WO: daftar permintaan menunggu keputusan L1 (sudah difilter scope server). */
function pullTransfers() {
  return api('pull_transfers').then(function(r) {
    if (!r.success) return;
    S.transfers = (r.result && r.result.transfers) || [];
    return kvSet('transfers', S.transfers);
  });
}
function pullPending() {
  return api('pull_pending').then(function(r) {
    if (!r.success) return;
    S.pending = (r.result && r.result.pending) || [];
    return kvSet('pending', S.pending);
  });
}
function pullActive() {
  return api('pull_active').then(function(r) {
    if (!r.success) return;
    S.active = (r.result && r.result.active) || [];
    return kvSet('active', S.active);
  });
}
function pullApproved() {
  return api('pull_approved').then(function(r) {
    if (!r.success) return;
    S.approved = (r.result && r.result.approved) || [];
    return kvSet('approved', S.approved);
  });
}
function refreshOutbox() { return obAll().then(function(o){S.outbox=o||[];}); }

/* ── Login ── */
/** Kunci tombol & tampilkan indikator selama token diperiksa ke server. */
function setLoginLoading(on) {
  var b = document.getElementById('btnLogin'), l = document.getElementById('loginLoading');
  if (b) { b.disabled = !!on; b.textContent = on ? 'Memeriksa…' : 'Masuk'; }
  if (l) l.style.display = on ? 'block' : 'none';
}

function doLogin() {
  var t = document.getElementById('tokenInput').value.trim();
  if (!t) { toast('Isi token dulu'); return; }
  requestNotifPermission(); requestPeriodicSync();
  S.token = t;
  setLoginLoading(true);
  if (navigator.onLine) {
    api('ping').then(function(r) {
      if (r.success) {
        S.me = r.result;
        // Role ASLI dari backend (bukan tebakan). Mekanik = hanya WO Saya.
        S.role = (r.result && r.result.role) ? r.result.role : 'mechanic';
        return kvSet('token',t).then(function() { return kvSet('me',S.me); })
          .then(function() { return kvSet('role',S.role); })
          .then(function() {
            // Hanya non-mekanik (planner/approver) yang perlu refs utk Buat WO.
            if (S.role !== 'mechanic') return pullRefs().catch(function(){});
          })
          .then(function() { showScreen('main'); syncNow(false); });
      } else { setLoginLoading(false); toast('❌ '+(r.error||'Token ditolak')); S.token=null; }
    }).catch(function() { setLoginLoading(false); saveTokenOffline(t); });
  } else { setLoginLoading(false); saveTokenOffline(t); }
}
function saveTokenOffline(t) {
  kvSet('token',t).then(function() { toast('📴 Token disimpan — verifikasi saat ada sinyal'); showScreen('main'); renderAll(); });
}
function doLogout() {
  // AUDIT K2: antrean belum terkirim = laporan kerja/approval yang BELUM masuk server.
  // Logout menghapusnya permanen → wajib peringatan eksplisit.
  var pend = S.outbox.filter(function(o){return o.status==='queued'||o.status==='failed_retry';}).length;
  var msg = pend > 0
    ? '⚠️ PERHATIAN: masih ada '+pend+' operasi BELUM TERKIRIM di antrean.\nLogout akan MENGHAPUS antrean itu PERMANEN (laporan/approval hilang).\n\nSaran: batal, cari sinyal, tekan 🔄 Sync sampai antrean kosong, baru logout.\n\nTetap logout dan hapus antrean?'
    : 'Logout? Data lokal akan dihapus.';
  if (!confirm(msg)) return;
  var tx = db.transaction(['kv','outbox'],'readwrite');
  tx.objectStore('kv').clear();
  tx.objectStore('outbox').clear();
  tx.oncomplete = function() {
    // AUDIT K3: reset HARUS bentuk state lengkap — field hilang = crash setelah re-login
    S = { token:null, me:null, role:null, wos:[], refs:null, refsAt:null, pending:[], active:[], approved:[], transfers:[], monitoring:[], monitoringOverall:{}, outbox:[], lastSync:null, syncing:false, tab:'wos', appSub:'pending', showOutbox:false, crossFunc:false, timerStates:{} };
    showScreen('login');
  };
}

/* ── Tab ── */
function switchTab(tab) { S.tab = tab; renderAll(); }

/* ── M1: Submit form ── */
var activeWo = null;
function openSubmitForm(woId) {
  activeWo = null;
  for (var i=0;i<S.wos.length;i++) if (String(S.wos[i].id)===String(woId)) activeWo=S.wos[i];
  if (!activeWo) return;
  document.getElementById('fTitle').textContent = activeWo.wo_number;
  document.getElementById('fDesc').innerHTML = '<b>'+esc(activeWo.component_name||'')+'</b>'+(activeWo.unit_name?' · '+esc(activeWo.unit_name):'')+
    '<br>📍 '+esc(locLabel(activeWo.location))+' · Kondisi: '+esc(wcLabel(activeWo.work_condition))+
    (activeWo.target_hours?' · Target: '+fmtJamMenit(activeWo.target_hours):'');
  document.getElementById('fKet').textContent = activeWo.keterangan ? '📝 '+activeWo.keterangan : '';
  document.getElementById('fKet').style.display = activeWo.keterangan ? 'block' : 'none';
  document.getElementById('fStart').value=''; document.getElementById('fEnd').value='';
  document.getElementById('fHm').value=''; document.getElementById('fKm').value='';
  document.getElementById('fPart').value='';
  // Tyreman: sembunyikan pilihan spare part (nilainya sudah dikosongkan di atas)
  // HM, KM, dan Spare Part disembunyikan di SEMUA section (1 Agu 2026)
  var _pw = document.getElementById('partWrap'); if (_pw) _pw.style.display='none';
  var _hkw = document.getElementById('hmKmWrap'); if (_hkw) _hkw.style.display='none';
  var tn = document.getElementById('fTransferNote'); if (tn) tn.value='';
  var tsum = document.getElementById('fTimerSummary');
  if (tsum) { tsum.style.display='none'; tsum.innerHTML=''; }
  updateModalTimerUI();
  showModal('submitModal');
}

/**
 * TRANSFER WO — oper pekerjaan ke shift berikutnya (antre offline).
 * Jam mulai diambil dari picker Jam Mulai yang sama dengan submit; jam berhenti
 * ditetapkan server saat permintaan benar-benar diterima. Jam sesi ini baru
 * dihitung kalau Planner menyetujui — kalau ditolak, hangus.
 */
function queueTransfer() {
  if (!activeWo) return;
  var st = document.getElementById('fStart').value;
  if (!st) { toast('Isi Jam Mulai dulu — dipakai menghitung sesi kerja Anda'); return; }
  if (new Date(st).getTime() > Date.now()) { toast('Jam mulai tidak boleh melewati sekarang'); return; }
  var note = (document.getElementById('fTransferNote') || {value:''}).value;

  var op = { op_id:uuid(), seq:(_enqSeq++), action:'request_transfer', wo_id:activeWo.id, wo_number:activeWo.wo_number,
    payload:{wo_id:activeWo.id, transfer_note:note, session_start_time:new Date(st).toISOString()},
    status:'queued', created_at:new Date().toISOString() };

  obPut(op).then(refreshOutbox).then(function() {
    closeModal('submitModal'); renderAll();
    toast(navigator.onLine?'📮 Mengirim permintaan transfer...':'📮 Tersimpan! Terkirim saat ada sinyal');
    syncNow(false);
  });
}
function queueSubmit() {
  var st=document.getElementById('fStart').value, en=document.getElementById('fEnd').value;
  // HM & KM opsional sejak 1 Agu 2026 (input disembunyikan) — kirim apa adanya
  var hm=document.getElementById('fHm').value, km=document.getElementById('fKm').value;
  var part=document.getElementById('fPart').value;
  if (!st||!en) { toast('Jam mulai & selesai wajib'); return; }
  if (new Date(en)<=new Date(st)) { toast('Jam selesai harus setelah mulai'); return; }
  var op = { op_id:uuid(), seq:(_enqSeq++), action:'submit_work', wo_id:activeWo.id, wo_number:activeWo.wo_number,
    payload:{wo_id:activeWo.id, start_time:new Date(st).toISOString(), end_time:new Date(en).toISOString(), hour_meter:hm, kilometers:km, part_category:part},
    status:'queued', created_at:new Date().toISOString() };
  obPut(op).then(refreshOutbox).then(function() {
    clearTimerAfterSubmit(op.wo_id);   // timer baru dibersihkan setelah masuk antrean
    closeModal('submitModal'); renderAll();
    toast(navigator.onLine?'📮 Mengirim...':'📮 Tersimpan! Terkirim saat ada sinyal');
    syncNow(false);
  });
}

/* ── M2: Create WO form ── */
function openCreateForm() {
  if (!S.refs) {
    if (navigator.onLine) {
      toast('⏳ Memuat data referensi...');
      pullRefs().then(function(){ if (S.refs) openCreateForm(); else toast('❌ Gagal memuat referensi'); })
        .catch(function(){ toast('❌ Gagal memuat referensi'); });
    } else { toast('📴 Sync dulu saat ada sinyal untuk memuat referensi'); }
    return;
  }
  // Refs basi / tanpa work_conditions → refresh senyap (sembuhkan cache lama)
  if (navigator.onLine && (refsStale() || !(S.refs.work_conditions && S.refs.work_conditions.length))) { pullRefs().catch(function(){}); }
  // reset form
  var secs = S.refs.sections || [];
  var secHtml = '';
  for (var si=0;si<secs.length;si++) {
    var icons = {tyreman:'🛢️',field:'🚜',workshop:'🏭'};
    secHtml += '<label class="secOpt"><input type="radio" name="cSec" value="'+secs[si]+'"'+(si===0?' checked':'')+'>'+
               '<span class="secCard">'+(icons[secs[si]]||'')+' '+secs[si]+'</span></label>';
  }
  document.getElementById('cSecPicker').innerHTML = secHtml;
  document.getElementById('cWc').innerHTML = '';
  // Fallback bawaan bila refs basi/kosong → dropdown SELALU terisi (key stabil).
  // Factor uang TETAP dihitung server dari Config_Factors, bukan dari sini.
  var wcs = (S.refs && S.refs.work_conditions && S.refs.work_conditions.length)
    ? S.refs.work_conditions
    : [{key:'normal',label:'Shift 1'},{key:'difficult',label:'Shift 2'},{key:'extreme',label:'Kondisi Ekstrim'}];
  for (var wi=0;wi<wcs.length;wi++) {
    document.getElementById('cWc').innerHTML += '<option value="'+esc(wcs[wi].key||wcs[wi].value||wcs[wi])+'">'+esc(wcs[wi].label||wcs[wi])+'</option>';
  }
  document.getElementById('cKet').value='';
  ['cOthersDesc','cOthersBp','cOthersTh','cOthersUf'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('cTeamList').innerHTML='';
  S.crossFunc=false; var _cf=document.getElementById('cCrossFunc'); if(_cf) _cf.checked=false;
  addTeamMember();
  onCreateSectionChange();
  // listeners
  var radios = document.querySelectorAll('input[name="cSec"]');
  for (var ri=0;ri<radios.length;ri++) radios[ri].onchange = onCreateSectionChange;
  showModal('createModal');
}
function onCompChange() {
  var isOthers = document.getElementById('cComp').value === 'COM-OTHERS';
  document.getElementById('cOthersWrap').style.display = isOthers ? 'block' : 'none';
  document.getElementById('cTyreUnit').parentNode.style.display = isOthers ? 'none' : 'block';
  updateCreatePreview();
}
/** Poin & target jam saat membuat WO: hanya L2. 1:1 dgn web (BOLEH_LIHAT_POIN). */
function bolehLihatPoin(){ return S.role === 'superintendent'; }

function updateCreatePreview(){
  var box=document.getElementById('cPreview'); if(!box) return;
  if(!bolehLihatPoin()){ box.style.display='none'; return; }
  var sec=getCreateSection();
  var ocEl=document.getElementById('cOthersCheck');
  var isOthers = ocEl && ocEl.checked;
  var bp=null, ph=null, uf=1.0, name='';
  if (isOthers) {
    bp=parseFloat(document.getElementById('cOthersBp').value)||0;
    ph=parseFloat(document.getElementById('cOthersTh').value)||0;
    uf=parseFloat(document.getElementById('cOthersUf').value)||0;
    name=document.getElementById('cOthersDesc').value||'Others';
  } else if (sec==='tyreman') {
    var cv=document.getElementById('cComp').value;
    var comps=(S.refs&&S.refs.components)||[];
    for(var i=0;i<comps.length;i++){ if(String(comps[i].component_no)===cv){ bp=parseFloat(comps[i].base_points)||0; ph=parseFloat(comps[i].target_hours)||0; name=comps[i].component_name; break; } }
    uf=1.0;
  } else {
    var js=document.getElementById('cCasJob'); var opt=js.options[js.selectedIndex];
    if(opt&&opt.value){ bp=parseFloat(opt.getAttribute('data-bp'))||0; ph=parseFloat(opt.getAttribute('data-ph'))||0; name=opt.textContent; }
    if(sec==='field'){ var uv=document.getElementById('cUnit').value; var units=(S.refs&&S.refs.units)||[]; for(var u=0;u<units.length;u++){ if(String(units[u].unit_id)===uv){ uf=parseFloat(units[u].unit_factor)||1.0; break; } } }
    else uf=1.0; // workshop placeholder
  }
  if (bp===null && ph===null) { box.style.display='none'; return; }
  var wcSel=document.getElementById('cWc'); var wcOpt=wcSel.options[wcSel.selectedIndex];
  document.getElementById('cPreviewBody').innerHTML =
    '<b>'+esc(name||'-')+'</b><br>Base Points: '+(bp||0)+' · Target: '+(ph||0)+' jam<br>Unit Factor: '+(uf||1)+' 🔒 · Kondisi: '+esc(wcOpt?wcOpt.textContent:'-');
  box.style.display='block';
}
function onPwaOthersToggle() {
  var checked = document.getElementById('cOthersCheck').checked;
  document.getElementById('cOthersWrap').style.display = checked ? 'block' : 'none';
  if (checked) {
    // Job manual: sembunyikan SEMUA picker katalog (tyreman & cascade), pakai deskripsi
    document.getElementById('cTyreGroup').style.display = 'none';
    document.getElementById('cCascadeGroup').style.display = 'none';
  } else {
    onCreateSectionChange(); // kembalikan picker sesuai section
  }
  updateCreatePreview();
}
function onCreateSectionChange() {
  var sec = getCreateSection();
  var isTyre = (sec === 'tyreman');
  var isWs = (sec === 'workshop');
  // reset Others state
  document.getElementById('cOthersWrap').style.display = 'none';
  // Others via centang di SEMUA section — TAPI hanya untuk approver. Di WO Others
  // pembuatnya mengetik base_points & target_hours sendiri, dan itu jalur uang.
  // Ini sekadar menyembunyikan; penegakannya di createWorkOrder (server).
  var bolehOthers = (S.role !== 'mechanic');
  var othersCheckRow = document.getElementById('cOthersCheckRow');
  if (othersCheckRow) othersCheckRow.style.display = bolehOthers ? 'block' : 'none';
  var othersCheck = document.getElementById('cOthersCheck');
  if (othersCheck) othersCheck.checked = false;
  document.getElementById('cTyreGroup').style.display = isTyre ? 'block' : 'none';
  document.getElementById('cCascadeGroup').style.display = isTyre ? 'none' : 'block';
  document.getElementById('cUnitGroup').style.display = (isTyre || isWs) ? 'none' : 'block';
  document.getElementById('cModelGroup').style.display = isWs ? 'block' : 'none';
  if (isTyre) {
    var cSel = document.getElementById('cComp');
    cSel.innerHTML = '<option value="">-- Pilih --</option>';
    var comps = S.refs.components || [];
    for (var ci=0;ci<comps.length;ci++) {
      if (String(comps[ci].component_no) === 'COM-OTHERS') continue; // Others lewat centang, bukan dropdown
      cSel.innerHTML += '<option value="'+esc(comps[ci].component_no)+'">'+esc(comps[ci].component_name)+'</option>';
    }
    populateTyreUnits();
  } else {
    populateCascadeRoot(sec);
  }
  refreshCreateMechanics();
  updateCreatePreview();
}
function getCreateSection() {
  var r = document.querySelector('input[name="cSec"]:checked');
  return r ? r.value : 'tyreman';
}
function populateTyreUnits() {
  var sel = document.getElementById('cTyreUnit');
  sel.innerHTML = '<option value="">-- Pilih Unit --</option>';
  var units = S.refs.units || [];
  for (var i=0;i<units.length;i++) sel.innerHTML += '<option value="'+esc(units[i].unit_id)+'">'+esc(units[i].unit_name)+' ('+esc(units[i].unit_type)+')</option>';
}
/**
 * Samakan bentuk unit_model sebelum dibandingkan.
 * pull_create_refs mengirim units.unit_model SUDAH huruf kecil + trim, tapi
 * katalog job (getJobCatalog) mengirim unit_model APA ADANYA dari sheet. Kalau
 * sheet menulis 'Hauler' sementara unit 'hauler', tidak ada yang cocok dan
 * dropdown Unit/Component kosong — versi web tidak kena karena menormalkan
 * kedua sisi.
 */
function _nm(v) { return String(v == null ? '' : v).toLowerCase().trim(); }

function populateCascadeRoot(sec) {
  var jobs = (sec==='workshop') ? (S.refs.jobs_workshop||[]) : (S.refs.jobs_field||[]);
  if (sec === 'field') {
    var validModels = {};
    for (var j=0;j<jobs.length;j++) validModels[_nm(jobs[j].unit_model)] = true;
    var sel = document.getElementById('cUnit');
    sel.innerHTML = '<option value="">-- Pilih Unit --</option>';
    var units = S.refs.units||[];
    for (var u=0;u<units.length;u++) {
      var um = _nm(units[u].unit_model);
      if (!um || !validModels[um]) continue;
      sel.innerHTML += '<option value="'+esc(units[u].unit_id)+'" data-model="'+esc(um)+'">'+esc(units[u].unit_name)+' ('+esc(units[u].unit_type)+')</option>';
    }
  } else {
    var models = {}; for (var mj=0;mj<jobs.length;mj++) models[_nm(jobs[mj].unit_model)]=true;
    var mSel = document.getElementById('cModel');
    mSel.innerHTML = '<option value="">-- Pilih Model --</option>';
    for (var mk in models) mSel.innerHTML += '<option value="'+esc(mk)+'">'+esc(mk)+'</option>';
  }
  document.getElementById('cCasComp').innerHTML = '<option value="">-- Component --</option>';
  document.getElementById('cCasSub').innerHTML = '<option value="">-- Sub Component --</option>';
  document.getElementById('cCasJob').innerHTML = '<option value="">-- Job --</option>';
}
function onCasUnitOrModel() {
  var sec = getCreateSection();
  var jobs = (sec==='workshop') ? (S.refs.jobs_workshop||[]) : (S.refs.jobs_field||[]);
  var model = '';
  if (sec==='workshop') { model = document.getElementById('cModel').value; }
  else { var opt = document.getElementById('cUnit').options[document.getElementById('cUnit').selectedIndex]; model = opt ? (opt.getAttribute('data-model')||'') : ''; }
  var comps = {};
  model = _nm(model);
  for (var i=0;i<jobs.length;i++) { if (_nm(jobs[i].unit_model)===model) comps[jobs[i].component]=true; }
  var sel = document.getElementById('cCasComp');
  sel.innerHTML = '<option value="">-- Component --</option>';
  for (var c in comps) sel.innerHTML += '<option value="'+esc(c)+'">'+esc(c)+'</option>';
  document.getElementById('cCasSub').innerHTML = '<option value="">-- Sub Component --</option>';
  document.getElementById('cCasJob').innerHTML = '<option value="">-- Job --</option>';
}
function onCasComp() {
  var sec = getCreateSection();
  var jobs = (sec==='workshop') ? (S.refs.jobs_workshop||[]) : (S.refs.jobs_field||[]);
  var model = sec==='workshop' ? document.getElementById('cModel').value : (document.getElementById('cUnit').options[document.getElementById('cUnit').selectedIndex]||{}).getAttribute('data-model')||'';
  var comp = document.getElementById('cCasComp').value;
  var subs = {};
  model = _nm(model);
  for (var i=0;i<jobs.length;i++) { if (_nm(jobs[i].unit_model)===model && jobs[i].component===comp) subs[jobs[i].sub_component]=true; }
  var sel = document.getElementById('cCasSub');
  sel.innerHTML = '<option value="">-- Sub Component --</option>';
  for (var s in subs) sel.innerHTML += '<option value="'+esc(s)+'">'+esc(s)+'</option>';
  document.getElementById('cCasJob').innerHTML = '<option value="">-- Job --</option>';
}
function onCasSub() {
  var sec = getCreateSection();
  var jobs = (sec==='workshop') ? (S.refs.jobs_workshop||[]) : (S.refs.jobs_field||[]);
  var model = sec==='workshop' ? document.getElementById('cModel').value : (document.getElementById('cUnit').options[document.getElementById('cUnit').selectedIndex]||{}).getAttribute('data-model')||'';
  var comp = document.getElementById('cCasComp').value;
  var sub = document.getElementById('cCasSub').value;
  var sel = document.getElementById('cCasJob');
  sel.innerHTML = '<option value="">-- Job --</option>';
  for (var i=0;i<jobs.length;i++) {
    var j = jobs[i];
    if (_nm(j.unit_model)===_nm(model) && j.component===comp && j.sub_component===sub) {
      // Angka jam & poin hanya untuk L2 — mekanik dan L1 memilih pekerjaan
      // berdasarkan APA yang dikerjakan, bukan berapa nilainya. data-bp/data-ph
      // tetap dikirim (dipakai saat submit); yang disembunyikan hanya labelnya.
      sel.innerHTML += '<option value="'+esc(j.job_id)+'" data-bp="'+j.base_point+'" data-ph="'+j.plan_hours+'">'+esc(j.job_description)+(bolehLihatPoin()?' ('+j.plan_hours+'jam · '+j.base_point+'pts)':'')+'</option>';
    }
  }
}
function onCrossFuncToggle(){ var cf=document.getElementById('cCrossFunc'); S.crossFunc = !!(cf && cf.checked); refreshCreateMechanics(); }
function refreshCreateMechanics() {
  var sec = getCreateSection();
  var mechs = S.refs ? (S.refs.mechanics||[]) : [];
  var showAll = !!S.crossFunc;
  var rows = document.querySelectorAll('.cTeamSel');
  for (var r=0;r<rows.length;r++) {
    var cur = rows[r].value;
    rows[r].innerHTML = '<option value="">-- Pilih Mekanik --</option>';
    for (var m=0;m<mechs.length;m++) {
      var ms = String(mechs[m].section||'').toLowerCase();
      // Kolom section BOLEH berisi daftar dipisah koma ("tyreman,field"). Dulu
      // dibandingkan sebagai satu string utuh → mekanik ber-section ganda tak
      // pernah cocok dan dropdown kosong. Mekanik TANPA section juga ikut
      // tersaring; sekarang selalu tampil, sama seperti versi web.
      var msList = [];
      if (ms) {
        var parts = ms.split(',');
        for (var pi=0; pi<parts.length; pi++) {
          var v = parts[pi].replace(/^\s+|\s+$/g,'');
          if (v) msList.push(v);
        }
      }
      var cocok = (msList.length === 0) || (msList.indexOf(sec) !== -1);
      // Default: hanya mekanik section terpilih. Lintas fungsi → tampilkan semua (dgn tag section).
      if (!showAll && sec && !cocok) continue;
      var tag = (!cocok && ms) ? ' ['+ms+']' : '';
      rows[r].innerHTML += '<option value="'+esc(mechs[m].mechanic_id)+'">'+esc(mechs[m].mechanic_name)+esc(tag)+'</option>';
    }
    rows[r].value = cur;
  }
}
function addTeamMember() {
  var div = document.createElement('div'); div.className = 'teamRow';
  div.innerHTML = '<select class="cTeamSel inp"></select><button type="button" class="mini gray" onclick="this.parentNode.remove()">✕</button>';
  document.getElementById('cTeamList').appendChild(div);
  refreshCreateMechanics();
}
function queueCreate(keepOpen) {
  var sec = getCreateSection();
  var wc = document.getElementById('cWc').value;
  if (!wc) { toast('Pilih work condition'); return; }
  var payload = { section:sec, work_condition:wc, keterangan:document.getElementById('cKet').value.trim(), location: sec==='workshop'?'workshop':'field' };
  var _oc = document.getElementById('cOthersCheck');
  var pwaOthers = !!(_oc && _oc.checked); // Others via centang, seragam semua section
  if (pwaOthers) {
    var odesc = document.getElementById('cOthersDesc').value.trim();
    var obp = parseFloat(document.getElementById('cOthersBp').value);
    var oth = parseFloat(document.getElementById('cOthersTh').value);
    var ouf = parseFloat(document.getElementById('cOthersUf').value);
    if (!odesc) { toast('Deskripsi job Others wajib diisi'); return; }
    if (isNaN(obp) || obp <= 0) { toast('Base points Others wajib > 0'); return; }
    if (isNaN(oth) || oth <= 0) { toast('Target hours Others wajib > 0'); return; }
    if (isNaN(ouf) || ouf <= 0) { toast('Unit factor Others wajib > 0'); return; }
    payload.component_id = 'COM-OTHERS';
    payload.others_description = odesc;
    payload.others_base_points = obp;
    payload.others_target_hours = oth;
    payload.others_unit_factor = ouf;
  } else if (sec === 'tyreman') {
    var comp = document.getElementById('cComp').value;
    var unit = document.getElementById('cTyreUnit').value;
    if (!comp) { toast('Pilih joblist tyreman'); return; }
    if (!unit) { toast('Pilih unit'); return; }
    payload.component_id = comp; payload.unit_id = unit;
  } else {
    var jobSel = document.getElementById('cCasJob');
    if (!jobSel.value) { toast('Pilih job dari katalog'); return; }
    payload.job_id = jobSel.value;
    if (sec === 'field') {
      var fUnit = document.getElementById('cUnit').value;
      if (!fUnit) { toast('Pilih unit'); return; }
      payload.unit_id = fUnit;
    }
  }
  // team
  var sels = document.querySelectorAll('.cTeamSel');
  var team=[],seen={};
  for (var i=0;i<sels.length;i++) {
    var mid = sels[i].value;
    if (!mid) continue;
    if (seen[mid]) { toast('Mekanik duplikat'); return; }
    seen[mid]=true; team.push({mechanic_id:mid});
  }
  if (!team.length) { toast('Tambah minimal 1 mekanik'); return; }
  payload.team = team;
  var op = { op_id:uuid(), seq:(_enqSeq++), action:'create_wo', payload:payload, status:'queued', created_at:new Date().toISOString(), label:'Buat WO '+sec };
  obPut(op).then(refreshOutbox).then(function() {
    renderAll();
    if (keepOpen) {
      resetCreateFieldsForNext();
      toast('📮 WO diantre — isi WO berikutnya (section & kondisi dipertahankan)');
    } else {
      closeModal('createModal');
      toast(navigator.onLine?'📮 Mengirim...':'📮 Tersimpan! Terkirim saat ada sinyal');
    }
    syncNow(false);
  });
}
function resetCreateFieldsForNext(){
  document.getElementById('cKet').value='';
  ['cOthersDesc','cOthersBp','cOthersTh','cOthersUf'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var oc=document.getElementById('cOthersCheck'); if(oc) oc.checked=false;
  document.getElementById('cTeamList').innerHTML='';
  addTeamMember();
  onCreateSectionChange(); // reset picker utk section aktif (section & kondisi dipertahankan)
}

/* ── M3: Approval ── */
var activeApproval = null;
var cancelWoId = null;
function openCancelForm(woId, woNumber){
  cancelWoId = woId;
  document.getElementById('cxDesc').textContent = woNumber || woId;
  document.getElementById('cxReason').value = '';
  showModal('cancelModal');
}
function queueCancel(){
  var reason = document.getElementById('cxReason').value.trim();
  if (!reason) { toast('Isi alasan pembatalan'); return; }
  var woNum = document.getElementById('cxDesc').textContent;
  var op = { op_id:uuid(), seq:(_enqSeq++), action:'cancel_wo', wo_id:cancelWoId, wo_number:woNum,
    payload:{ wo_id:cancelWoId, reason:reason }, status:'queued', created_at:new Date().toISOString(), label:'Batal '+woNum };
  obPut(op).then(refreshOutbox).then(function(){
    closeModal('cancelModal'); closeModal('approveModal'); renderAll();
    toast(navigator.onLine?'📮 Mengirim...':'📮 Tersimpan!');
    syncNow(false);
  });
}
function openApproveForm(woId) {
  activeApproval = null;
  for (var i=0;i<S.pending.length;i++) if (String(S.pending[i].id)===String(woId)) activeApproval=S.pending[i];
  if (!activeApproval) return;
  var a = activeApproval;
  document.getElementById('aTitle').textContent = a.wo_number;
  var atl = a.timeliness;
  document.getElementById('aDesc').innerHTML = '<b>'+esc(a.component_name||'-')+'</b>'+(a.is_others?' <span class="badge" style="background:#0ea5e9">OTHERS</span>':'')+byMechBadge(a)+'<br>'+
    (a.unit_name?'🚜 '+esc(a.unit_name)+'<br>':'')+
    '📍 Lokasi: '+esc(locLabel(a.location))+'<br>'+
    'Kondisi: '+esc(wcLabel(a.work_condition))+'<br>'+
    'Base Points: '+(a.base_points||0)+' pts<br>'+
    'Target: '+fmtJamMenit(a.target_hours)+' · Aktual: '+fmtJamMenit(a.actual_hours)+
    (atl ? ' ('+esc(atl.label)+' ×'+atl.factor+')' : '')+'<br>'+
    'Unit Factor: '+(a.unit_factor||1)+' 🔒<br>'+
    // Part/HM/KM disembunyikan di layar approval (1 Agu 2026) — 1:1 dgn web
    (a.created_by_name || a.created_by ? '<br>👤 Pembuat: '+esc(a.created_by_name || a.created_by) : '')+
    (a.keterangan ? '<br>📝 '+esc(a.keterangan) : '');
  document.getElementById('aTeam').textContent = 'Tim: '+(a.team||[]).map(function(t){return t.name;}).join(', ');
  document.getElementById('aStatus').textContent = 'Status: '+a.status;
  var isL2 = (a.status === 'pending_superintendent');
  document.getElementById('aBtnL1').style.display = isL2 ? 'none' : 'block';
  document.getElementById('aBtnL2').style.display = isL2 ? 'block' : 'none';
  document.getElementById('aSafety').checked = false;
  document.getElementById('aMtbf').value = 'first_time';
  // ── Override (1:1 dgn modal "Edit Override" web) ──
  document.getElementById('aOvBp').value = '';
  var _th = parseFloat(a.target_hours) || 0;
  document.getElementById('aOvTgtJam').value = _th ? Math.floor(_th) : '';
  document.getElementById('aOvTgtMenit').value = _th ? Math.round((_th - Math.floor(_th)) * 60) : '';
  document.getElementById('aOvStart').value = toDtLocal(a.start_time);
  document.getElementById('aOvEnd').value = toDtLocal(a.end_time);
  var _actNow = document.getElementById('aOvActualNow');
  if (_actNow) _actNow.value = a.actual_hours ? fmtJamMenit(a.actual_hours) : '-';
  // WO yang pernah ditransfer: picker hanya mengoreksi sesi TERAKHIR — jam sesi
  // sebelumnya (partial_hours) tetap ditambahkan server-side, jangan bikin kaget.
  var _ph = parseFloat(a.partial_hours) || 0;
  var _phHint = document.getElementById('aOvPartialHint');
  if (_ph > 0) {
    _phHint.style.display = 'block';
    _phHint.innerHTML = '⚠️ WO ini pernah <b>ditransfer</b>. Picker hanya mengoreksi sesi <b>terakhir</b>; ' +
      fmtJamMenit(_ph) + ' dari sesi sebelumnya tetap ditambahkan otomatis.';
  } else { _phHint.style.display = 'none'; _phHint.innerHTML = ''; }
  aOvHitungDurasi();
  // Judgment BERJENJANG: tulisan L1 diwarisi L2; L2 boleh ubah atau kosongkan.
  var _jd = a.judgment || '';
  document.getElementById('aOvJudgment').value = _jd;
  var _jdSrc = document.getElementById('aOvJdSource');
  if (_jd && isL2 && !(a.judgment_superintendent || '')) {
    _jdSrc.style.display = 'block';
    _jdSrc.innerHTML = '↩️ Catatan ini ditulis <b>L1</b>. Boleh diubah, atau <b>kosongkan</b> untuk menghapus.';
  } else { _jdSrc.style.display = 'none'; _jdSrc.innerHTML = ''; }
  var _ovB = document.getElementById('ovBody'); if (_ovB) _ovB.style.display = 'none';
  var _ovA = document.getElementById('ovArrow'); if (_ovA) _ovA.textContent = '▸';
  renderOverrideLog(a);
  aOvRenderTeam(a.team || []);
  document.getElementById('aReason').value='';
  document.getElementById('aRejectSection').style.display='none';
  // Setelah SEMUA isian di-prefill — kalau dijalankan lebih awal, panel terbaca
  // "berubah" hanya karena sebagian field belum sempat diisi.
  perbaruiPenjagaOverride();
  showModal('approveModal');
}
function toggleRejectSection() {
  var el = document.getElementById('aRejectSection');
  el.style.display = el.style.display==='none' ? 'block' : 'none';
}

// ═══ OVERRIDE L1/L2 (2 Agu 2026) ════════════════════════════════════════════
// Wajib ada di PWA: approver KMB juga bekerja di kondisi sinyal sulit. Antrean
// override memakai seq yang sama dengan approve → outbox FIFO menjamin override
// tersimpan DULU, approve lalu membaca nilai efektif yang baru.

/** Buka/tutup panel Override (default tertutup supaya layar approval rapi). */
function toggleOverride() {
  var b = document.getElementById('ovBody'), a = document.getElementById('ovArrow');
  if (!b) return;
  var open = b.style.display !== 'none';
  b.style.display = open ? 'none' : 'block';
  if (a) a.textContent = open ? '▸' : '▾';
}

/** ISO → nilai <input type="datetime-local"> (waktu lokal). */
function toDtLocal(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return '';
  function p(n){ return (n<10?'0':'')+n; }
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
}

/** Hitung & tampilkan durasi dari picker override waktu kerja. */
function aOvHitungDurasi() {
  var s = document.getElementById('aOvStart').value, e = document.getElementById('aOvEnd').value;
  var box = document.getElementById('aOvDurBox'), txt = document.getElementById('aOvDurText');
  if (!txt) return;
  function warna(bg, br, fg){ box.style.background=bg; box.style.borderColor=br; box.style.color=fg; }
  if (!s || !e) { txt.textContent = '-'; warna('#FFFBEB','#FDE68A','#92400E'); return; }
  var ms = new Date(e).getTime() - new Date(s).getTime();
  if (isNaN(ms) || ms <= 0) {
    txt.textContent = '⚠️ Waktu selesai harus setelah waktu mulai';
    warna('#FEF2F2','#FCA5A5','#991B1B');
    return;
  }
  txt.textContent = msToJamMenit(ms) + ' (' + (Math.round((ms/3600000)*100)/100) + ' jam)';
  warna('#FFFBEB','#FDE68A','#92400E');
}

// Editor tim override: prefilled tim saat ini; bisa tambah/kurang mekanik.
function _aOvRow(selId, selName) {
  var div = document.createElement('div'); div.className = 'teamRow';
  var mechs = (S.refs && S.refs.mechanics) || [];
  var found = false;
  var opts = '<option value="">-- Pilih Mekanik --</option>';
  for (var m=0;m<mechs.length;m++) {
    var sel = (String(mechs[m].mechanic_id)===String(selId)) ? ' selected' : '';
    if (sel) found = true;
    opts += '<option value="'+esc(mechs[m].mechanic_id)+'"'+sel+'>'+esc(mechs[m].mechanic_name)+'</option>';
  }
  // fallback: anggota tim yg tak ada di daftar refs tetap terjaga (jangan hilang senyap)
  if (selId && !found) opts = '<option value="'+esc(selId)+'" selected>'+esc(selName||selId)+'</option>' + opts;
  div.innerHTML = '<select class="aOvSel inp" onchange="perbaruiPenjagaOverride()">'+opts+'</select>' +
                  '<button type="button" class="mini gray" onclick="this.parentNode.remove();perbaruiPenjagaOverride()">✕</button>';
  return div;
}
function aOvRenderTeam(team) {
  var box = document.getElementById('aOvTeam'); if (!box) return;
  box.innerHTML='';
  (team||[]).forEach(function(t){ box.appendChild(_aOvRow(t.mechanic_id, t.name)); });
}
function aOvAddMember() {
  document.getElementById('aOvTeam').appendChild(_aOvRow('', ''));
  perbaruiPenjagaOverride();
}

/** Riwayat override (siapa mengubah apa) di modal approval. */
function renderOverrideLog(wo) {
  var box = document.getElementById('aOvLog');
  if (!box) return;
  var list = (wo && wo.override_summary) || [];
  if (!list.length) { box.style.display='none'; box.innerHTML=''; return; }
  var html = '<div class="ovLogTitle">✏️ Riwayat Override</div>';
  for (var i=0;i<list.length;i++) {
    var ov = list[i];
    html += '<div class="ovLogItem"><span class="ovTag '+(ov.level==='spv'?'l1':'l2')+'">'+(ov.level==='spv'?'L1':'L2')+'</span>' +
      '<span class="ovLogWho">'+esc(ov.by_name||ov.by||'-')+'</span>' +
      (ov.at?'<span class="ovLogTime">'+esc(fmtDateTime(ov.at))+'</span>':'') + '<ul class="ovLogList">';
    for (var c=0;c<(ov.changes||[]).length;c++) {
      var ch = ov.changes[c];
      html += '<li><b>'+esc(ch.label)+'</b>: ' + (ch.from?'<span style="text-decoration:line-through;color:#9CA3AF">'+esc(ch.from)+'</span> → ':'') +
              '<span style="color:#B45309;font-weight:700">'+esc(ch.to)+'</span></li>';
    }
    html += '</ul>';
    if (ov.judgment) html += '<div class="ovJd">🗒️ '+esc(ov.judgment)+'</div>';
    html += '</div>';
  }
  box.innerHTML = html;
  box.style.display = 'block';
}

/**
 * Bandingkan isi panel override dengan nilai WO saat ini.
 *
 * SATU sumber kebenaran untuk DUA hal: tombol "Simpan Override" dan penjagaan
 * tombol Approve. Kalau perhitungannya dipisah, keduanya bisa berbeda pendapat —
 * Approve terkunci karena menganggap ada perubahan, sementara Simpan menjawab
 * "tidak ada perubahan". Approver terjebak tanpa jalan keluar.
 *
 * @return {{payload:Object|null, ubah:boolean, salah:string}}
 *   salah = pesan validasi (isi panel belum sah); ubah = beda dari nilai WO.
 */
function _bacaPerubahanOverride() {
  var kosong = {payload:null, ubah:false, salah:''};
  if (!activeApproval) return kosong;
  var elBp = document.getElementById('aOvBp');
  if (!elBp) return kosong;

  var bp = elBp.value.trim();
  var ovS = document.getElementById('aOvStart').value;
  var ovE = document.getElementById('aOvEnd').value;
  if ((ovS && !ovE) || (!ovS && ovE)) return {payload:null, ubah:true, salah:'Isi waktu Mulai DAN Selesai'};
  if (ovS && ovE && new Date(ovE).getTime() <= new Date(ovS).getTime()) return {payload:null, ubah:true, salah:'Waktu selesai harus setelah mulai'};

  var timeChanged = false;
  if (ovS && ovE) {
    timeChanged = (ovS !== toDtLocal(activeApproval.start_time)) || (ovE !== toDtLocal(activeApproval.end_time));
  }
  var tJam = parseInt(document.getElementById('aOvTgtJam').value, 10) || 0;
  var tMnt = parseInt(document.getElementById('aOvTgtMenit').value, 10) || 0;
  if (tMnt > 59) return {payload:null, ubah:true, salah:'Menit target maksimal 59'};
  var tgtBaru = Math.round((tJam + tMnt/60) * 100) / 100;
  var tgtLama = Math.round((parseFloat(activeApproval.target_hours) || 0) * 100) / 100;
  var tgtChanged = (tgtBaru > 0 && tgtBaru !== tgtLama);

  var sels = document.querySelectorAll('.aOvSel');
  var team=[], seen={};
  for (var i=0;i<sels.length;i++) {
    var mid = sels[i].value;
    if (!mid) continue;
    if (seen[mid]) return {payload:null, ubah:true, salah:'Mekanik duplikat di tim override'};
    seen[mid]=true; team.push({mechanic_id:mid, percentage:100}); // KMB full-point
  }
  var origIds = (activeApproval.team||[]).map(function(t){return String(t.mechanic_id);}).sort().join(',');
  var newIds = team.map(function(t){return String(t.mechanic_id);}).sort().join(',');
  var teamChanged = (newIds !== origIds);
  if (teamChanged && team.length===0) return {payload:null, ubah:true, salah:'Tim override minimal 1 mekanik'};

  // judgment: dibanding nilai EFEKTIF supaya pengosongan warisan L1 oleh L2
  // terkirim sebagai penghapusan, bukan dianggap "tidak berubah"
  var jdBaru = document.getElementById('aOvJudgment').value.trim();
  var jdLama = String(activeApproval.judgment || '').trim();
  var jdChanged = (jdBaru !== jdLama);

  var bpChanged = (bp !== '');
  if (!bpChanged && !timeChanged && !teamChanged && !tgtChanged && !jdChanged) return kosong;

  var payload = { wo_id:activeApproval.id };
  if (bpChanged) payload.base_points = parseFloat(bp);
  if (tgtChanged) payload.target_hours = tgtBaru;
  if (timeChanged) {
    payload.start_time = new Date(ovS).toISOString();
    payload.end_time = new Date(ovE).toISOString();
  }
  if (teamChanged) payload.team = team;
  if (jdChanged) payload.judgment = jdBaru;
  return {payload: payload, ubah: true, salah: ''};
}

/**
 * PENJAGAAN: selama masih ada perubahan override yang BELUM disimpan, tombol
 * Approve dimatikan. Terlalu sering terjadi approver mengetik override/judgment
 * lalu langsung menekan Approve — WO lolos dengan angka lama dan perubahannya
 * hilang tanpa jejak. Ini jalur uang, jadi tak boleh dibiarkan senyap.
 *
 * Reject sengaja TIDAK dikunci: menolak WO membuat override tak relevan, dan
 * mengunci Reject hanya akan menjebak approver.
 */
function perbaruiPenjagaOverride() {
  var d = _bacaPerubahanOverride();
  var perluSimpan = d.ubah;
  var b1 = document.getElementById('aBtnL1'), b2 = document.getElementById('aBtnL2');
  var wr = document.getElementById('aOvWarn');
  [b1, b2].forEach(function(b) {
    if (!b) return;
    b.disabled = perluSimpan;
    b.style.opacity = perluSimpan ? '.45' : '';
    b.style.cursor = perluSimpan ? 'not-allowed' : '';
  });
  if (wr) {
    if (perluSimpan) {
      wr.style.display = 'block';
      wr.innerHTML = d.salah
        ? '⚠️ ' + esc(d.salah)
        : '⚠️ Ada perubahan override yang <b>belum disimpan</b>. Tekan <b>💾 Simpan Override</b> dulu, baru Approve.';
      // buka panelnya — tombol yang dicari harus terlihat, bukan tersembunyi di balik lipatan
      var body = document.getElementById('ovBody');
      if (body && body.style.display === 'none') {
        body.style.display = 'block';
        var ar = document.getElementById('ovArrow'); if (ar) ar.textContent = '▾';
      }
    } else {
      wr.style.display = 'none';
      wr.innerHTML = '';
    }
  }
}

function queueOverride() {
  var d = _bacaPerubahanOverride();
  if (d.salah) { toast(d.salah); return; }
  if (!d.ubah) { toast('Tidak ada perubahan override'); return; }
  var payload = d.payload;
  var op = { op_id:uuid(), seq:(_enqSeq++), action:'save_override', wo_id:activeApproval.id, wo_number:activeApproval.wo_number,
    payload:payload, status:'queued', created_at:new Date().toISOString(), label:'Override '+activeApproval.wo_number };
  obPut(op).then(refreshOutbox).then(function() {
    // Selaraskan salinan lokal dgn yang BARU SAJA diantre. Tanpa ini panel tetap
    // dianggap "belum disimpan" (isian ≠ nilai WO lama) dan Approve terkunci
    // selamanya walau override sudah masuk antrean.
    if (payload.base_points !== undefined) activeApproval.base_points = payload.base_points;
    if (payload.target_hours !== undefined) activeApproval.target_hours = payload.target_hours;
    if (payload.start_time) { activeApproval.start_time = payload.start_time; activeApproval.end_time = payload.end_time; }
    if (payload.judgment !== undefined) activeApproval.judgment = payload.judgment;
    if (payload.team) {
      var mechs = (S.refs && S.refs.mechanics) || [];
      activeApproval.team = payload.team.map(function(t) {
        var nm = t.mechanic_id;
        for (var m=0;m<mechs.length;m++) if (String(mechs[m].mechanic_id)===String(t.mechanic_id)) { nm = mechs[m].mechanic_name; break; }
        return {mechanic_id: t.mechanic_id, name: nm};
      });
      document.getElementById('aTeam').textContent = 'Tim: '+activeApproval.team.map(function(t){return t.name;}).join(', ');
    }
    document.getElementById('aOvBp').value = '';   // sudah masuk base_points di atas
    perbaruiPenjagaOverride();
    renderAll();
    toast(navigator.onLine?'📮 Override dikirim — lanjut Approve':'📮 Override tersimpan (terkirim sebelum approve)');
    syncNow(false);
  });
}
function queueApprove(level) {
  // Lapis kedua penjagaan. Tombolnya sudah di-disable, tapi ini jalur uang —
  // satu klik yang lolos berarti WO disetujui dengan angka lama dan override
  // yang sudah diketik hilang tanpa jejak.
  var _g = _bacaPerubahanOverride();
  if (_g.ubah) { perbaruiPenjagaOverride(); toast(_g.salah || '⚠️ Simpan Override dulu sebelum Approve'); return; }
  var action = level===1 ? 'approve_l1' : 'approve_l2';
  var op = { op_id:uuid(), seq:(_enqSeq++), action:action, wo_id:activeApproval.id, wo_number:activeApproval.wo_number,
    // notes tidak lagi diketik approver (kotak Catatan dihapus). Server yang
    // mengisinya dari judgment efektif, supaya AuditLogs tetap punya konteks
    // tanpa approver mengetik hal yang sama dua kali.
    payload:{ wo_id:activeApproval.id, safety_incident:document.getElementById('aSafety').checked, mtbf_status:document.getElementById('aMtbf').value },
    status:'queued', created_at:new Date().toISOString(), label:(level===1?'L1':'L2')+' '+activeApproval.wo_number };
  obPut(op).then(refreshOutbox).then(function() {
    closeModal('approveModal'); renderAll();
    toast(navigator.onLine?'📮 Mengirim...':'📮 Tersimpan!');
    syncNow(false);
  });
}
function queueReject() {
  var reason = document.getElementById('aReason').value.trim();
  if (!reason) { toast('Isi alasan reject'); return; }
  var stage = activeApproval.status==='pending_superintendent' ? 'superintendent' : 'supervisor';
  var op = { op_id:uuid(), seq:(_enqSeq++), action:'reject', wo_id:activeApproval.id, wo_number:activeApproval.wo_number,
    payload:{ wo_id:activeApproval.id, stage:stage, reason:reason },
    status:'queued', created_at:new Date().toISOString(), label:'Reject '+activeApproval.wo_number };
  obPut(op).then(refreshOutbox).then(function() {
    closeModal('approveModal'); renderAll();
    toast(navigator.onLine?'📮 Mengirim...':'📮 Tersimpan!');
    syncNow(false);
  });
}

/* ── Outbox management ── */
function retryOp(opId) {
  obAll().then(function(items) {
    for (var i=0;i<items.length;i++) { if (items[i].op_id===opId) { items[i].status='failed_retry'; return obPut(items[i]); } }
  }).then(function() { syncNow(true); });
}
function discardOp(opId) {
  if (!confirm('Buang kiriman ini?')) return;
  obDel(opId).then(refreshOutbox).then(renderAll);
}

/* ── Modal ── */
function showModal(id) { document.getElementById(id).style.display='flex'; }
function closeModal(id) {
  document.getElementById(id).style.display='none';
  // Pembaruan versi yang ditahan karena modal terbuka → jalankan sekarang.
  if (_swPendingReload && !adaModalTerbuka()) _lakukanReloadSW();
}
/** Ada modal yang sedang terbuka? Dipakai agar reload tak menghapus isian setengah jalan. */
function adaModalTerbuka() {
  var ms = document.querySelectorAll('.modal');
  for (var i = 0; i < ms.length; i++) if (ms[i].style.display === 'flex') return true;
  return false;
}

/* ── Render ── */
function showScreen(nm) {
  // Versi ditampilkan di layar login — supaya saat ada keluhan, versi yang
  // dipakai bisa langsung dibaca tanpa harus masuk dulu.
  var lv = document.getElementById('loginVersion');
  if (lv) {
    lv.textContent = APP_VERSION;
    // Ketuk label versi = buka layar Cek Versi. Mekanik yang belum login pun
    // bisa memperbarui sendiri tanpa dipandu hapus cache lewat telepon.
    lv.style.cursor = 'pointer';
    lv.title = 'Ketuk untuk cek versi';
    lv.onclick = bukaCekVersi;
  }
  if (nm !== 'login') setLoginLoading(false);
  // 'flex' (bukan 'block') — layar login memakai flexbox agar isinya benar-benar
  // di tengah dan tetap bisa di-scroll saat keyboard HP terbuka.
  document.getElementById('screen-login').style.display = nm==='login'?'flex':'none';
  document.getElementById('screen-main').style.display = nm==='main'?'block':'none';
}
function esc(s) { return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function toast(msg) {
  var t=document.getElementById('toast'); t.textContent=msg; t.style.display='block';
  clearTimeout(t._h); t._h=setTimeout(function(){t.style.display='none';},3500);
}
function toggleOutboxDetail(){ S.showOutbox = !S.showOutbox; renderAll(); }
function opLabel(o){
  var names = {submit_work:'Submit', create_wo:'Buat WO', approve_l1:'L1', approve_l2:'L2', reject:'Reject',
               cancel_wo:'Batal WO', request_transfer:'Transfer WO', save_override:'Override',
               approve_transfer:'Setujui Transfer', reject_transfer:'Tolak Transfer'};
  var base = o.label || names[o.action] || o.action;
  if (o.wo_number && String(base).indexOf(o.wo_number)===-1) base += ' '+o.wo_number;
  return base;
}
function fmtDateTime(iso){
  if(!iso) return '-';
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function badgeFor(wo,pendingOp) {
  if (pendingOp) {
    if (pendingOp.status==='queued') return ['📮 Antre','#b45309'];
    if (pendingOp.status==='failed') return ['❌ Ditolak','#b91c1c'];
    // 'done' TIDAK menimpa: pakai status asli WO agar berubah (Terkirim→L1→L2→Approved) setelah sync
  }
  var s=String(wo.status||'');
  if (s==='pending_mechanic_work') return ['📝 Perlu diisi','#1d4ed8'];
  if (s==='pending_supervisor') return ['⏳ L1','#7c3aed'];
  if (s==='pending_superintendent') return ['⏳ L2','#7c3aed'];
  if (s==='approved') return ['✅ Approved','#15803d'];
  return [s||'-','#475569'];
}
function renderAll() {
  var on=navigator.onLine;
  document.getElementById('netDot').style.background=on?'#22c55e':'#ef4444';
  document.getElementById('netText').textContent=on?'Online':'Offline';
  document.getElementById('syncBtn').innerHTML = S.syncing ? '<span class="spin"></span>Sync…' : '🔄 Sync';
  document.getElementById('lastSync').textContent=(S.lastSync?'Sync: '+new Date(S.lastSync).toLocaleString('id-ID'):'Belum sync')+' · '+APP_VERSION;
  document.getElementById('meName').textContent=S.me?(S.me.name||S.me.mechanic_id):'';
  // tabs
  // Sejak 3 Agu 2026 mekanik juga boleh membuat WO, jadi tab bar tampil untuk
  // SEMUA peran. Yang membedakan tinggal isi tabnya.
  var isApprover = S.role!=='mechanic';
  // L1/L2 (approver): sembunyikan tab "WO Saya" — hanya Buat WO + Approval
  if (isApprover && S.tab==='wos') S.tab='approval';
  document.getElementById('tabBar').style.display = 'flex';
  document.getElementById('tabWos').style.display = isApprover ? 'none' : '';
  // Mekanik hanya WO Saya + Buat WO. Approval & Monitoring tetap milik approver;
  // kalau tab tersimpan dari sesi sebelumnya, kembalikan supaya tak terdampar
  // di layar kosong.
  if (!isApprover && (S.tab==='approval' || S.tab==='monitor')) S.tab='wos';
  document.getElementById('tabWos').className = 'tab'+(S.tab==='wos'?' active':'');
  document.getElementById('tabCreate').className = 'tab'+(S.tab==='create'?' active':'');
  document.getElementById('tabApproval').style.display = isApprover ? '' : 'none';
  document.getElementById('tabApproval').className = 'tab'+(S.tab==='approval'?' active':'');
  document.getElementById('tabMonitor').style.display = isApprover ? '' : 'none';
  document.getElementById('tabMonitor').className = 'tab'+(S.tab==='monitor'?' active':'');
  // outbox info — bisa diklik utk lihat WO mana yg mengantre + waktu masuk antrean
  var queued = S.outbox.filter(function(o){return o.status==='queued'||o.status==='failed_retry';});
  var oi = document.getElementById('outboxInfo');
  oi.textContent = queued.length ? ('📮 '+queued.length+' menunggu sinyal '+(S.showOutbox?'▲':'▼')) : '';
  var od = document.getElementById('outboxDetail');
  if (queued.length && S.showOutbox) {
    od.style.display='block';
    od.innerHTML = queued.map(function(o){
      return '<div class="card" style="padding:10px;margin-bottom:6px">'+
        '<b>'+esc(opLabel(o))+'</b>'+
        '<div class="sub" style="margin:2px 0 0">🕒 Masuk antrean: '+esc(fmtDateTime(o.created_at))+'</div>'+
        '</div>';
    }).join('');
  } else { od.style.display='none'; od.innerHTML=''; }
  // failed outbox
  var failHtml = '';
  S.outbox.filter(function(o){return o.status==='failed';}).forEach(function(o) {
    failHtml += '<div class="card err"><b>'+esc(opLabel(o))+'</b><br>'+esc(o.error||'-')+
      '<br><button class="mini" onclick="retryOp(\''+o.op_id+'\')">🔁 Coba lagi</button> '+
      '<button class="mini gray" onclick="discardOp(\''+o.op_id+'\')">🗑 Buang</button></div>';
  });
  document.getElementById('failedOps').innerHTML = failHtml;
  // content
  var content = document.getElementById('content');
  if (S.tab==='create') { renderCreateTab(content); }
  else if (S.tab==='approval') { renderApprovalTab(content); }
  else if (S.tab==='monitor') { renderMonitorTab(content); }
  else { renderWos(content); }   // 'wos' + jaring pengaman bila S.tab tak dikenal
}

/* ── MONITORING (approver) — cermin halaman Monitoring di web ──
   Menampilkan TOKEN mekanik, bukan URL, sama seperti web sejak 1 Agu 2026. */
function renderMonitorTab(el) {
  var mons = S.monitoring || [];
  if (!mons.length) {
    el.innerHTML = '<div class="empty">Belum ada data monitoring. Tekan 🔄 Sync saat ada sinyal.</div>';
    return;
  }
  var ov = S.monitoringOverall || {};
  var html = '<div class="card" style="padding:12px">'+
    '<b>Ringkasan scope Anda</b><div class="sub" style="margin-top:4px">'+
      '📝 Perlu diisi: <b>'+(ov.pending_mechanic_work||0)+'</b> · '+
      '⏳ L1: <b>'+(ov.pending_l1||0)+'</b> · '+
      '⏳ L2: <b>'+(ov.pending_l2||0)+'</b> · '+
      '✅ Approved: <b>'+(ov.approved||0)+'</b>'+
    '</div></div>';

  html += '<div class="sub">'+mons.length+' mekanik</div>';
  mons.forEach(function(m){
    html += '<div class="card">'+
      '<div class="cardTop"><b>'+esc(m.name||m.id)+'</b>'+
        (m.section?'<span class="badge" style="background:#334155">'+esc(m.section)+'</span>':'')+
      '</div>'+
      '<div class="cardBody">'+esc(m.id)+'<br>'+
        '📝 '+(m.pending_mechanic_work||0)+' · ⏳ L1 '+(m.pending_l1||0)+
        ' · ⏳ L2 '+(m.pending_l2||0)+' · ✅ '+(m.approved||0)+
      '</div>';
    if (m.has_token && m.token) {
      html += '<div style="display:flex;gap:6px;align-items:center;margin-top:8px">'+
        '<input class="inp" style="flex:1;font-family:monospace;font-size:13px" readonly value="'+esc(m.token)+'" onclick="this.select()">'+
        '<button class="mini" onclick="salinToken(\''+esc(m.token)+'\',this)">📋 Copy</button>'+
      '</div>';
    } else {
      html += '<div class="sub" style="color:#b45309;margin-top:6px">⚠️ Belum ada token — jalankan generateMissingTokens di editor GAS.</div>';
    }
    html += '</div>';
  });
  el.innerHTML = html;
}

function salinToken(tok, btn) {
  var semula = btn.textContent;
  var sukses = function(){ btn.textContent='✅'; setTimeout(function(){ btn.textContent=semula; },1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(tok).then(sukses).catch(function(){ toast('Salin manual: '+tok); });
  } else { toast('Salin manual: '+tok); }
}
function renderWos(el) {
  var opByWo={};
  S.outbox.forEach(function(o){if(o.wo_id&&(!opByWo[o.wo_id]||o.created_at>opByWo[o.wo_id].created_at))opByWo[o.wo_id]=o;});
  if (!S.wos.length) { el.innerHTML='<div class="empty">Belum ada kartu WO.<br>Tekan 🔄 Sync saat ada sinyal.</div>'; return; }
  var html='';
  S.wos.forEach(function(wo) {
    var op=opByWo[wo.id]; var b=badgeFor(wo,op);
    var canFill=String(wo.status)==='pending_mechanic_work'&&(!op||op.status==='failed');
    html+='<div class="card"><div class="cardTop"><b>'+esc(wo.wo_number)+'</b><span class="badge" style="background:'+b[1]+'">'+b[0]+'</span>'+
      (wo.is_others?'<span class="badge" style="background:#0ea5e9">OTHERS</span>':'')+'</div>'+
      '<div class="cardBody"><b>'+esc(wo.component_name||'-')+'</b>'+(wo.unit_name?' · '+esc(wo.unit_name):'')+(wo.target_hours?' · Target: '+fmtJamMenit(wo.target_hours):'')+'<br>'+
      '📍 '+esc(locLabel(wo.location))+' · Kondisi: '+esc(wcLabel(wo.work_condition))+'</div>'+
      (wo.keterangan?'<div class="ket">📝 '+esc(wo.keterangan)+'</div>':'')+
      (canFill?_timerControls(wo):'')+
      (canFill?'<button class="big" onclick="openSubmitWithTimer(\''+esc(String(wo.id))+'\')">✍️ Isi & Kirim</button>':'')+
      '</div>';
  });
  el.innerHTML=html;
}
function renderCreateTab(el) {
  if (!S.refs) { el.innerHTML='<div class="empty">Tekan 🔄 Sync untuk memuat data referensi.</div>'; return; }
  el.innerHTML='<button class="big" onclick="openCreateForm()" style="margin-bottom:12px">➕ Buat Work Order Baru</button>'+
    '<div class="sub">Data referensi: '+(S.refs.jobs_field||[]).length+' job field, '+(S.refs.jobs_workshop||[]).length+' job WS, '+(S.refs.components||[]).length+' komponen tyreman</div>';
}
function wcLabel(wc){ return wc==='normal'?'Shift 1':wc==='difficult'?'Shift 2':wc==='extreme'?'Kondisi Ekstrim':(wc||'-'); }
function partLabel(p){ return p==='baru'?'🆕 Sparepart Baru':p==='repair'?'🔧 Repair':p==='kanibal'?'♻️ Kanibal':(p||'Tanpa Part'); }
function locLabel(l){ return l==='field'?'Lapangan':l==='workshop'?'Bengkel':(l||'-'); }
function fmtJamMenit(h){
  h=parseFloat(h)||0;
  if(h<=0) return '-';
  var j=Math.floor(h), m=Math.round((h-j)*60);
  if(m===60){ j++; m=0; }
  if(j>0&&m>0) return j+' jam '+m+' menit';
  if(j>0) return j+' jam';
  return m+' menit';
}
function renderApprovalTab(el) {
  var subs = [['pending','✅ Pending',S.pending.length],['active','⏳ Aktif',S.active.length],
              ['transfer','🔁 Transfer',S.transfers.length],['approved','🏆 Approved',S.approved.length]];
  var bar = '<div class="tabBar" style="display:flex;margin-bottom:12px">'+subs.map(function(s){
    return '<button class="tab'+(S.appSub===s[0]?' active':'')+'" onclick="switchAppSub(\''+s[0]+'\')">'+s[1]+' ('+s[2]+')</button>';
  }).join('')+'</div>';
  var body = S.appSub==='active' ? renderActiveList()
           : S.appSub==='transfer' ? renderTransferList()
           : (S.appSub==='approved' ? renderApprovedList() : renderPendingList());
  el.innerHTML = bar + body;
}
function switchAppSub(sub){
  S.appSub = sub;
  if (sub==='approved' && !S.approved.length && navigator.onLine) { toast('⏳ Memuat approved...'); pullApproved().then(renderAll).catch(function(){}); }
  renderAll();
}
function fmtIdr(n){ n=parseFloat(n)||0; return n.toLocaleString('id-ID'); }
/* AUDIT T1: guard dobel-aksi — op yang masih antre utk WO ini? */
function queuedOpFor(woId){
  for (var i=0;i<S.outbox.length;i++){
    var o=S.outbox[i];
    if (String(o.wo_id)===String(woId) && (o.status==='queued'||o.status==='failed_retry')) return o;
  }
  return null;
}
function queuedNote(qop){ return '<div class="obinfo">📮 '+esc(opLabel(qop))+' — menunggu sinyal (tombol dikunci)</div>'; }
// Nama saja — email dihilangkan dari kartu approval (1:1 dgn web). Approver
// mengenali orang dari namanya; alamat email hanya memenuhi layar HP.
function teamStr(team){ return (team||[]).map(function(t){ return esc(t.name); }).join(', '); }
function ovBadges(wo){ return (wo.has_override_spv?'<span class="badge" style="background:#4338ca">SPV override</span>':'')+(wo.has_override_supt?'<span class="badge" style="background:#7c3aed">SUPT override</span>':''); }
/* Penanda telaah, bukan status: WO yang dibuat mekanik sendiri perlu diperiksa
   lebih teliti (job, unit, susunan tim) daripada buatan sesama approver.
   1:1 dengan badge di web (Approval.html). */
function byMechBadge(wo){ return wo.created_by_is_mechanic ? '<span class="badge" style="background:#6d28d9">👷 Dibuat Mekanik</span>' : ''; }
function cancelBtn(wo){ return '<button class="big secondary" onclick="openCancelForm(\''+esc(String(wo.id))+'\',\''+esc(String(wo.wo_number))+'\')">🗑 Batalkan WO</button>'; }
/* ── TRANSFER WO: keputusan L1 (offline-capable) ── */
function renderTransferList(){
  if (!S.transfers.length) return '<div class="empty">Tidak ada permintaan transfer dalam scope Anda.</div>';
  var mechs = (S.refs && S.refs.mechanics) || [];
  var html = '<div class="sub">'+S.transfers.length+' permintaan menunggu keputusan</div>';

  S.transfers.forEach(function(tr){
    var qop = queuedOpFor(tr.wo_id);
    var opts = mechs.map(function(m){
      return '<option value="'+esc(m.mechanic_id)+'">'+esc(m.mechanic_name)+' ('+esc(m.mechanic_id)+')</option>';
    }).join('');
    var tim = (tr.team||[]).map(function(t){ return esc(t.mechanic_name); }).join(', ');

    html += '<div class="card"><div class="cardTop"><b>'+esc(tr.wo_number)+'</b>'+
      '<span class="badge" style="background:#dd6b20">🔁 TRANSFER</span>'+
      (tr.section?'<span class="badge" style="background:#334155">'+esc(tr.section)+'</span>':'')+'</div>'+
      '<div class="cardBody">'+
        'Diminta oleh <b>'+esc(tr.requested_by_name)+'</b><br>'+
        (tr.keterangan ? '📝 '+esc(tr.keterangan)+'<br>' : '')+
        (tr.transfer_note ? '💬 Catatan mekanik: <i>'+esc(tr.transfer_note)+'</i><br>' : '')+
        (tim ? 'Tim sekarang: '+tim+'<br>' : '')+
        // Dampak jam ditampilkan SEBELUM tombol — keputusan ini menambah jam
        // kerja yang dibayar, jadi angkanya tidak disembunyikan.
        '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:8px;margin-top:8px">'+
          '<b style="color:#0369a1;font-size:12px">DAMPAK JAM KERJA</b><br>'+
          'Sesi ini <b>'+fmtJamMenit(tr.session_hours)+'</b> · tercatat <b>'+fmtJamMenit(tr.partial_hours_now)+'</b> → '+
          '<b style="color:#b45309">'+fmtJamMenit(tr.partial_hours_after)+'</b> bila disetujui<br>'+
          '<span style="font-size:12px;color:#0369a1">Bila ditolak, sesi tersebut hangus.</span>'+
        '</div>'+
      '</div>';

    if (qop) {
      html += queuedNote(qop);
    } else {
      html += '<label style="margin-top:8px">Mekanik penerima *</label>'+
        '<select multiple size="4" class="inp" id="trSel_'+esc(tr.wo_id)+'">'+opts+'</select>'+
        '<div style="font-size:12px;color:#64748b;margin:4px 0 8px">Bisa pilih lebih dari satu. Semua penerima dapat poin penuh.</div>'+
        '<div style="display:flex;gap:8px">'+
          '<button class="big" style="flex:1" onclick="queueApproveTransfer(\''+esc(tr.wo_id)+'\',\''+esc(tr.wo_number)+'\')">✓ Setujui</button>'+
          '<button class="big secondary" style="flex:1;background:#dc2626;color:#fff" onclick="queueRejectTransfer(\''+esc(tr.wo_id)+'\',\''+esc(tr.wo_number)+'\')">✗ Tolak</button>'+
        '</div>';
    }
    html += '</div>';
  });
  return html;
}

function _trSelected(woId){
  var sel = document.getElementById('trSel_'+woId);
  if (!sel) return [];
  var out=[];
  for (var i=0;i<sel.options.length;i++) if (sel.options[i].selected) out.push(sel.options[i].value);
  return out;
}

function queueApproveTransfer(woId, woNumber){
  var targets = _trSelected(woId);
  if (!targets.length) { toast('Pilih minimal satu mekanik penerima'); return; }
  if (!confirm('Setujui transfer '+woNumber+' ke '+targets.length+' mekanik?\n\nJam sesi mekanik sebelumnya akan DIHITUNG, dan semua penerima dapat poin penuh.')) return;
  var op = { op_id:uuid(), seq:(_enqSeq++), action:'approve_transfer', wo_id:woId, wo_number:woNumber,
    payload:{wo_id:woId, target_mechanic_ids:targets},
    status:'queued', created_at:new Date().toISOString() };
  obPut(op).then(refreshOutbox).then(function(){
    renderAll();
    toast(navigator.onLine?'📮 Mengirim...':'📮 Tersimpan! Terkirim saat ada sinyal');
    syncNow(false);
  });
}

function queueRejectTransfer(woId, woNumber){
  var reason = prompt('Alasan menolak transfer:');
  if (!reason || !reason.trim()) { toast('Alasan wajib diisi'); return; }
  if (!confirm('Tolak transfer '+woNumber+'?\n\nSesi kerja mekanik yang mengajukan akan HANGUS.')) return;
  var op = { op_id:uuid(), seq:(_enqSeq++), action:'reject_transfer', wo_id:woId, wo_number:woNumber,
    payload:{wo_id:woId, reason:reason.trim()},
    status:'queued', created_at:new Date().toISOString() };
  obPut(op).then(refreshOutbox).then(function(){
    renderAll();
    toast(navigator.onLine?'📮 Mengirim...':'📮 Tersimpan! Terkirim saat ada sinyal');
    syncNow(false);
  });
}

function renderPendingList(){
  if (!S.pending.length) return '<div class="empty">Tidak ada WO pending dalam scope Anda.</div>';
  var html='<div class="sub">'+S.pending.length+' WO menunggu approval</div>';
  S.pending.forEach(function(wo){
    var isL2 = wo.status==='pending_superintendent';
    var othersBadge = wo.is_others ? '<span class="badge" style="background:#0ea5e9">OTHERS</span>' : '';
    var tl = wo.timeliness;
    var tlBadge = tl ? '<span class="badge" style="background:'+(tl.status==='on_time'?'#15803d':tl.status==='late'?'#b45309':'#b91c1c')+'">⏱️ '+esc(tl.label)+' ×'+tl.factor+'</span>' : '';
    html+='<div class="card"><div class="cardTop"><b>'+esc(wo.wo_number)+'</b><span class="badge" style="background:'+(isL2?'#b45309':'#7c3aed')+'">'+(isL2?'⏳ L2':'⏳ L1')+'</span>'+
      '<span class="badge" style="background:#334155">'+esc(wo.section)+'</span>'+othersBadge+tlBadge+ovBadges(wo)+byMechBadge(wo)+'</div>'+
      '<div class="cardBody"><b>'+esc(wo.component_name||'-')+'</b>'+(wo.unit_name?' · '+esc(wo.unit_name):'')+'<br>'+
      '📍 Lokasi: '+esc(locLabel(wo.location))+'<br>'+
      'Kondisi: '+esc(wcLabel(wo.work_condition))+' · Aktual: '+fmtJamMenit(wo.actual_hours)+' · Target: '+fmtJamMenit(wo.target_hours)+'<br>'+
      'Base: '+(wo.base_points||0)+' pts · Unit Factor: '+(wo.unit_factor||1)+' 🔒<br>'+

      '<br>👥 Tim: '+teamStr(wo.team)+'</div>'+
      (wo.keterangan?'<div class="ket">📝 '+esc(wo.keterangan)+'</div>':'')+
      (function(){ var q=queuedOpFor(wo.id); return q ? queuedNote(q)
        : '<button class="big" onclick="openApproveForm(\''+esc(String(wo.id))+'\')">📋 Review & Approve</button>'+cancelBtn(wo); })()+'</div>';
  });
  return html;
}
function renderActiveList(){
  if (!S.active.length) return '<div class="empty">Tidak ada WO aktif (belum di-submit mekanik).</div>';
  var html='<div class="sub">'+S.active.length+' WO aktif — belum di-submit mekanik</div>';
  S.active.forEach(function(wo){
    var othersBadge = wo.is_others ? '<span class="badge" style="background:#0ea5e9">OTHERS</span>' : '';
    html+='<div class="card"><div class="cardTop"><b>'+esc(wo.wo_number)+'</b><span class="badge" style="background:#1d4ed8">📝 Belum diisi</span>'+
      (wo.section?'<span class="badge" style="background:#334155">'+esc(wo.section)+'</span>':'')+othersBadge+'</div>'+
      '<div class="cardBody"><b>'+esc(wo.component_name||'-')+'</b><br>'+
      '📍 Lokasi: '+esc(locLabel(wo.location))+'<br>'+
      'Kondisi: '+esc(wcLabel(wo.work_condition))+((wo.created_by_name||wo.created_by)?' · Pembuat: '+esc(wo.created_by_name||wo.created_by):'')+'<br>'+
      '👥 Tim: '+(wo.team_names||[]).map(function(n){return esc(n);}).join(', ')+'</div>'+
      (wo.keterangan?'<div class="ket">📝 '+esc(wo.keterangan)+'</div>':'')+
      (function(){ var q=queuedOpFor(wo.id); return q ? queuedNote(q) : cancelBtn(wo); })()+'</div>';
  });
  return html;
}
function renderApprovedList(){
  if (!S.approved.length) return '<div class="empty">Belum ada WO approved.<br>Tekan 🔄 Sync saat online.</div>';
  var html='<div class="sub">'+S.approved.length+' WO approved (maks 100 terbaru)</div>';
  S.approved.forEach(function(wo){
    var othersBadge = wo.is_others ? '<span class="badge" style="background:#0ea5e9">OTHERS</span>' : '';
    var safety = wo.safety_incident ? '<span class="badge" style="background:#b91c1c">SAFETY</span>' : '';
    html+='<div class="card"><div class="cardTop"><b>'+esc(wo.wo_number)+'</b><span class="badge" style="background:#15803d">✅ Approved</span>'+
      (wo.section?'<span class="badge" style="background:#334155">'+esc(wo.section)+'</span>':'')+othersBadge+safety+'</div>'+
      '<div class="cardBody"><b>'+esc(wo.component_name||'-')+'</b><br>'+
      '📍 Lokasi: '+esc(locLabel(wo.location))+'<br>'+
      'Poin: '+(wo.final_points||0)+' · Rp '+fmtIdr(wo.final_idr||0)+'<br>'+
      'Aktual: '+fmtJamMenit(wo.actual_hours)+
      (wo.created_at_str?' · '+esc(wo.created_at_str):'')+'<br>'+
      '👥 Tim: '+(wo.team_names||[]).map(function(n){return esc(n);}).join(', ')+'</div>'+
      (wo.keterangan?'<div class="ket">📝 '+esc(wo.keterangan)+'</div>':'')+
      (function(){ var q=queuedOpFor(wo.id); return q ? queuedNote(q) : cancelBtn(wo); })()+'</div>';
  });
  return html;
}

/* ── Init ── */
window.addEventListener('online',function(){renderAll(); syncNow(false);});
window.addEventListener('offline',renderAll);
openDb().then(function() {
  return Promise.all([kvGet('token'),kvGet('me'),kvGet('wos'),kvGet('refs'),kvGet('pending'),kvGet('last_sync'),kvGet('role'),kvGet('refs_at'),kvGet('active'),kvGet('approved'),kvGet('transfers'),kvGet('timer_states'),kvGet('monitoring'),kvGet('monitoring_overall')]);
}).then(function(v) {
  S.token=v[0]||null; S.me=v[1]||null; S.wos=v[2]||[]; S.refs=v[3]||null; S.pending=v[4]||[]; S.lastSync=v[5]||null; S.role=v[6]||'mechanic'; S.refsAt=v[7]||null; S.active=v[8]||[]; S.approved=v[9]||[]; S.transfers=v[10]||[]; S.timerStates=v[11]||{}; S.monitoring=v[12]||[]; S.monitoringOverall=v[13]||{};
  return refreshOutbox();
}).then(function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(function(reg) {
      _swReg = reg;
      cekPembaruan();                        // cek sekali saat app dibuka
    }).catch(function(){});
    // Auto-reload SEKALI saat SW baru mengambil alih → update otomatis, user TIDAK perlu hapus cache.
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (_swReloaded) return;
      // Jangan buang isian yang sedang diketik: tahan sampai modal ditutup.
      if (adaModalTerbuka()) { _swPendingReload = true; toast('⬆️ Versi baru siap — dimuat setelah jendela ini ditutup'); return; }
      _lakukanReloadSW();
    });
    // PWA sering dibiarkan terbuka berhari-hari tanpa navigasi — tanpa pemicu ini
    // pengecekan versi tak pernah jalan dan HP tetap di versi lama diam-diam.
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') cekPembaruan();
    });
    window.addEventListener('online', cekPembaruan);
  }
  syncVersionFromCache().then(function(){ showScreen(S.token?'main':'login'); renderAll(); });
  showScreen(S.token?'main':'login');
  // Timer bisa masih berjalan dari sesi sebelumnya (state tersimpan di IndexedDB)
  startTimerTicker();
  if (S.token) requestPeriodicSync();
  // iOS: beforeinstallprompt tak pernah ada → tampilkan tombol Instal manual (panduan)
  if (IS_IOS && !IS_STANDALONE) { var _ib = document.getElementById('installBtn'); if (_ib) _ib.style.display = ''; }
  renderAll();
  if (S.token && navigator.onLine) {
    // Refresh role dari server tiap buka (self-heal role lama yg salah — tanpa perlu logout/login).
    api('ping').then(function(r){
      if (r.success && r.result && r.result.role && r.result.role !== S.role) {
        S.role = r.result.role; kvSet('role', S.role); renderAll();
      }
    }).catch(function(){});
    syncNow(false);
  }
});
