# 📝 Analisis & Rangkuman Masalah Koneksi PWA MAR Offline

Dokumen ini menjelaskan mengapa PWA MAR Offline mengalami error **"Sync gagal: Failed to fetch"** (CORS blocked) saat mencoba melakukan sinkronisasi dengan token, serta bagaimana langkah-langkah mengatasinya secara menyeluruh.

---

## 🔍 Penyebab Utama (Kenapa Error Terjadi?)

Ada **4 masalah utama** yang terjadi secara bersamaan di backend dan frontend:

### 1. Masalah Terbesar: Kesalahan Setelan Akses Apps Script (CORS Blocked)
* **Gejala:** Console log browser menampilkan error:
  `Access to fetch at '...' from origin '...' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present`.
* **Penyebab:** Setelan deployment Web App di Google Apps Script dikonfigurasi dengan opsi **"Who has access: Anyone with Google account"**.
  * Saat PWA (dari luar) melakukan request POST, Google Apps Script mencoba mengalihkan (redirect) request tersebut ke halaman Login Akun Google.
  * Halaman login Google ini menolak request lintas asal (Cross-Origin), sehingga browser memblokirnya karena kebijakan CORS.

### 2. Clasp Salah Sasaran (Script ID Berbeda)
* **Penyebab:** Berkas konfigurasi `.clasp.json` lokal mengarah ke ID project Apps Script yang lama/salah (`1owD8uXtBI...`), sedangkan editor yang Anda buka di browser adalah project aktif yang baru (`17sBKK-x3qXzL7t...`).
  * Akibatnya, setiap kali Anda melakukan perbaikan kode dan menjalankan `clasp push`, kodenya masuk ke project hantu yang tidak aktif, sehingga kode di project aktif Anda tetap versi lama.

### 3. File Frontend (`app.js`) Ikut Ter-push ke Server Apps Script
* **Penyebab:** Folder `mar-offline/` tidak dimasukkan ke dalam daftar `.claspignore`.
  * Saat `clasp push` berjalan, file `mar-offline/app.js` ikut diunggah ke Google Apps Script.
  * Karena Apps Script V8 engine berjalan di sisi server (tidak memiliki objek `window`, `document`, atau `navigator`), baris kode `window.addEventListener(...)` di `app.js` menyebabkan crash server langsung: `ReferenceError: window is not defined`. Ini merusak fungsi `doPost` dan `doGet` secara instan.

### 4. Sistem Token Belum Terhubung ke Spreadsheet
* **Penyebab:** PWA mengirimkan token acak berupa string hex (contoh: `641397b2bdf74e20a5d5`). Namun, fungsi otentikasi di `Auth.gs` hanya mencari berdasarkan `email` atau `mechanic_id` (seperti `MECH-001`). 
  * Spreadsheet sheet `Config_Mechanics` tidak memiliki kolom `offline_token` untuk memetakan token acak tersebut ke mekanik yang berhak.

---

## 🛠️ Cara Mengatasinya (Solusi Langkah demi Langkah)

Semua perbaikan kode di bawah ini telah disalin dan di-push ke project Anda yang aktif. Berikut langkah verifikasi dan setelannya:

### Langkah 1: Ubah Akses Web App ke "Anyone" (Mengatasi CORS)
Akses Web App harus dibuka untuk umum agar PWA bisa mengirim data tanpa memicu halaman login Google:
1. Buka **Google Apps Script Editor** untuk project `17sBKK-x3qXzL7tRlejsXE1kQXGwF-CQtCoCdhA4ZWE4_E2NSq0ZUwtqo`.
2. Klik tombol **Deploy** (kanan atas) ──► **Manage deployments** (Kelola penerapan).
3. Klik ikon pensil ✏️ (**Edit**) pada deployment aktif Anda.
4. Pada pilihan **"Who has access"** (Siapa yang memiliki akses), ubah dari *"Anyone with Google account"* menjadi **"Anyone"** (Siapa saja).
5. Klik **Deploy** ──► **Done**.

### Langkah 2: Tambahkan Kolom Token di Spreadsheet
Database harus bisa mengenali token acak dari PWA:
1. Buka Google Spreadsheet Anda.
2. Masuk ke sheet **`Config_Mechanics`**.
3. Tambahkan kolom baru di sebelah paling kanan dengan nama header persis: **`offline_token`**.
4. Di baris mekanik yang bersangkutan (misal `MECH-001`), isi kolom `offline_token` tersebut dengan token Anda: `641397b2bdf74e20a5d5`.

### Langkah 3: Integrasikan Kode Token di `Auth.js` dan `ConfigService.js`
*(Catatan: Anda baru saja mengembalikan/revert berkas Auth.js di folder kerja Anda. Agar sistem token bekerja kembali, kode di bawah harus dimasukkan kembali).*

#### A. Pada `Auth.js` (Tambahkan parser token context):
```javascript
// Tambahkan variabel context di bagian atas file
var _tokenContextEmail = null;

function setTokenContext(token) {
  _tokenContextEmail = null;
  if (!token) return;
  var tokenTrimmed = token.trim();
  
  // 1. Cari berdasarkan offline_token di sheet Config_Mechanics
  var mech = getMechanicByOfflineToken(tokenTrimmed);
  if (mech && (mech.is_active === true || mech.is_active === 'TRUE' || mech.is_active === 'true')) {
    _tokenContextEmail = mech.email;
    return;
  }
  
  // 2. Fallback ke email
  var tokenLower = tokenTrimmed.toLowerCase();
  if (tokenLower.indexOf('@') !== -1) {
    mech = getMechanicByEmail(tokenLower);
    if (mech && (mech.is_active === true || mech.is_active === 'TRUE' || mech.is_active === 'true')) {
      _tokenContextEmail = mech.email;
      return;
    }
  }
  
  // 3. Fallback ke mechanic_id
  mech = getMechanicById(tokenTrimmed.toUpperCase());
  if (mech && (mech.is_active === true || mech.is_active === 'TRUE' || mech.is_active === 'true')) {
    _tokenContextEmail = mech.email;
    return;
  }
}

function getTokenContextEmail() {
  return _tokenContextEmail;
}
```

Ubah juga awal fungsi `getCurrentUser()` agar membaca token context:
```javascript
function getCurrentUser() {
  try {
    var tokenEmail = (typeof getTokenContextEmail === 'function') ? getTokenContextEmail() : null;
    if (tokenEmail) return tokenEmail;
    // ... sisa kode getActiveUser
```

#### B. Pada `ConfigService.js` (Tambahkan fungsi pencari token):
```javascript
function getMechanicByOfflineToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    var tokenTrimmed = token.trim();
    var mechanics = loadMechanics();
    for (var i = 0; i < mechanics.length; i++) {
      var t = mechanics[i].offline_token;
      if (t && typeof t === 'string' && t.trim() === tokenTrimmed) {
        return mechanics[i];
      }
    }
    return null;
  } catch (e) {
    Log.exception('getMechanicByOfflineToken', e);
    return null;
  }
}
```

### Langkah 4: Pastikan PWA mengarah ke deployment yang benar

> ⚠️ **URL deployment SENGAJA tidak ditulis di dokumen ini.**
>
> Sampai 22 Sep 2026 bagian ini memuat URL-nya secara harfiah — dan URL itu
> sudah usang berbulan-bulan. Siapa pun yang mengikutinya akan mengarahkan PWA
> ke deployment yang beku: mekanik tetap bisa login, tetap bisa mengirim, dan
> tidak ada satu pun galat yang muncul. Pekerjaannya cuma masuk ke sistem yang
> salah, dan tak ada yang tahu sampai gajinya tidak tercatat.
>
> Nilai yang berlaku hidup di **satu** tempat: `CONFIG.API_URL`, baris awal
> `app.js`. Baca dari sana. Jangan menyalinnya ke dokumen mana pun — salinan
> kedua pasti menyimpang suatu hari, dan dokumenlah yang lebih sering dibaca
> orang yang baru bergabung.

**Jangan pernah membuat deployment baru.** URL-nya tertanam di `CONFIG.API_URL`
dan di setiap tautan bertoken yang sudah dipegang mekanik. Deployment baru
berarti URL baru: aplikasi lama tetap jalan, tetap menerima pekerjaan, dan
diam-diam menulis ke tempat yang sudah ditinggalkan. Perbarui deployment yang
**sudah ada** dengan `--deploymentId` yang sama.

Setelah mengubah `app.js`, naikkan **DUA** nomor versi sekaligus:

- `APP_VERSION` di `app.js`
- `CACHE` di `sw.js`

Keduanya, bukan salah satu. Pernah terjadi `APP_VERSION` tertinggal di v26
sementara `CACHE` sudah v34 — peramban memuat kode baru di atas cache lama, dan
gejalanya membingungkan berhari-hari sebelum ketahuan sebabnya.
