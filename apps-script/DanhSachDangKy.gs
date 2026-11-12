/**
 * Cúp Đại Phú Gia 2026 – Xuất danh sách đăng ký cho app (cup-dai-phu-gia.pages.dev)
 * Dán vào: mở sheet "DANH SÁCH ĐĂNG KÝ GIẢI CỜ 2026" → Tiện ích mở rộng (Extensions) → Apps Script.
 *
 * CHỈ xuất: Họ tên · Chức vụ · Đơn vị · Nội dung thi đấu (nếu có).
 * KHÔNG BAO GIỜ xuất: số điện thoại, địa chỉ, email, Zalo.
 *
 * - Tự nhận cột theo tiêu đề câu hỏi (không cần đúng thứ tự cột).
 * - Tên tự chuẩn: "NGUYỄN THÀNH NAM", "Lê tấn thuỷ" → "Nguyễn Thành Nam", "Lê Tấn Thuỷ".
 * - LOẠI TRÙNG: một người đăng ký nhiều lần → chỉ giữ 1 dòng (vị trí lần đầu, thông tin lần mới nhất).
 *   Trùng họ tên nhưng đơn vị khác hẳn → coi là 2 người khác nhau.
 * - Muốn ẩn 1 dòng (đăng ký thử…): thêm 1 cột tiêu đề "Ẩn" và gõ x vào dòng đó.
 * - Người đăng ký qua điện thoại/Zalo: gõ thêm 1 dòng mới thẳng vào sheet là được.
 */
var SHEET_ID = ''; // để trống = dùng chính file đang gắn script (khuyến nghị)

/* ===== AI (Gemini) cho app: đọc ảnh bàn cờ + đọc ảnh kết quả =====
 * Dán API key Gemini (lấy miễn phí tại https://aistudio.google.com/apikey) vào dòng dưới,
 * giữ nguyên dấu nháy đơn. Script chạy trên máy chủ Google nên không bị chặn vùng. */
var GEMINI_API_KEY = 'DAN_KEY_GEMINI_VAO_DAY';
var GEMINI_MODEL = 'gemini-3.8-flash';

function doGet() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('reg');
  if (hit) return out_(hit);
  var data;
  try { data = build_(); } catch (e) { data = { updated: null, count: 0, list: [], error: String(e && e.message || e) }; }
  data.ai = 5; // 3 = có đọc ảnh bốc thăm, kết quả và bảng xếp hạng; 5 = đọc bàn cờ 2 tầng (nhanh + chính xác)
  try { data.key = !!geminiKey_(); } catch (e) { data.key = null; }
  var json = JSON.stringify(data);
  if (!data.error) { try { cache.put('reg', json, 60); } catch (e) {} }
  return out_(json);
}

function out_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}

function norm_(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
}

function sp_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

// Tên người: luôn viết hoa chữ đầu mỗi từ
function name_(s) {
  return sp_(s).toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
}

// Chức vụ: "P.Giám đốc" → "Phó Giám đốc"; gõ toàn chữ HOA/thường → hoa chữ đầu
function role_(s) {
  s = sp_(s).replace(/^p\s*\.\s*/i, 'Phó ');
  if (s && (s === s.toUpperCase() || s === s.toLowerCase())) { s = s.toLowerCase(); s = s.charAt(0).toUpperCase() + s.slice(1); }
  return s;
}

// Lõi tên đơn vị (bỏ "công ty, TNHH, cổ phần, MTV…") để so khớp
function orgKey_(s) {
  return norm_(s).replace(/\b(cong ty|cty|tnhh|co phan|cp|mtv|trach nhiem huu han|mot thanh vien)\b/g, ' ').replace(/[^a-z0-9]/g, '');
}

function dice_(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  var m = {}, i, hit = 0;
  for (i = 0; i < a.length - 1; i++) { var x = a.substr(i, 2); m[x] = (m[x] || 0) + 1; }
  for (i = 0; i < b.length - 1; i++) { var y = b.substr(i, 2); if (m[y] > 0) { m[y]--; hit++; } }
  return 2 * hit / (a.length + b.length - 2);
}

// Cùng tên: coi là cùng 1 người, trừ khi 2 đơn vị khác hẳn nhau
function samePerson_(a, b) {
  var ka = orgKey_(a.cty), kb = orgKey_(b.cty);
  if (!ka || !kb || ka === kb || ka.indexOf(kb) >= 0 || kb.indexOf(ka) >= 0) return true;
  return dice_(ka, kb) >= 0.5;
}

function pickSheet_(ss) {
  var sh = ss.getSheets();
  for (var i = 0; i < sh.length; i++) { try { if (sh[i].getFormUrl()) return sh[i]; } catch (e) {} }
  return sh[0];
}

// Đọc tab câu trả lời Form: gộp người gửi nhiều lần
function readForm_(sheet) {
  var v = sheet.getDataRange().getValues();
  if (v.length < 2) return { latest: 0, dup: 0, list: [] };
  var h = v[0].map(norm_);
  function col(test) { for (var i = 0; i < h.length; i++) if (test(h[i])) return i; return -1; }
  function priv(x) { return /dien thoai|sdt|so dt|e-?mail|zalo|\bmail\b|dia chi|address|phone/.test(x); }

  var cTs   = col(function (x) { return /dau thoi gian|timestamp/.test(x); });
  var cCty  = col(function (x) { return !priv(x) && /cong ty|don vi|doanh nghiep|co quan|to chuc|company|organi[sz]ation/.test(x); });
  var cCv   = col(function (x) { return !priv(x) && /chuc vu|chuc danh|position|job title|^title$/.test(x); });
  var cName = col(function (x) { return !priv(x) && !/cong ty|don vi|doanh nghiep|co quan|company/.test(x) && /ho (va )?ten|^ten\b|full ?name|^name$/.test(x); });
  var cNd   = col(function (x) { return !priv(x) && /noi dung|thi dau|\bmon\b/.test(x); });
  var cHide = col(function (x) { return /^(an|hide|an dong)$/.test(x); });
  if (cName < 0) return { latest: 0, dup: 0, list: [], error: 'Không tìm thấy cột Tên' };

  var list = [], byName = {}, latest = 0, dup = 0;
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    var n = name_(row[cName]);
    if (!n) continue;
    if (cHide >= 0 && sp_(row[cHide])) continue;
    var it = {
      n: n,
      cv: cCv >= 0 ? role_(row[cCv]) : '',
      cty: cCty >= 0 ? sp_(row[cCty]) : '',
      nd: cNd >= 0 ? sp_(row[cNd]) : ''
    };
    var ts = (cTs >= 0 && row[cTs] instanceof Date) ? row[cTs].getTime() : 0;
    if (ts > latest) latest = ts;
    var k = norm_(n), same = -1, arr = byName[k] || (byName[k] = []);
    for (var j = 0; j < arr.length; j++) { if (samePerson_(list[arr[j]], it)) { same = arr[j]; break; } }
    if (same >= 0) {                       // đăng ký lại → cập nhật thông tin mới, giữ chỗ cũ
      var old = list[same];
      list[same] = { n: it.n, cv: it.cv || old.cv, cty: it.cty || old.cty, nd: it.nd || old.nd };
      dup++;
    } else { arr.push(list.length); list.push(it); }
  }
  return { latest: latest, dup: dup, list: list };
}

// Tìm trang "danh sách tham dự" chính thức (ưu tiên tab tên có "tham dự"; nhận dạng theo tiêu đề Họ tên + Đơn vị).
// Hỗ trợ cả mẫu có dòng tiêu đề phụ "Nội dung thi đấu" -> "Cờ tướng" | "Cờ tướng úp" (đánh X).
function readOfficial_(ss, skip) {
  var sheets = ss.getSheets().filter(function (sh) { return !skip || sh.getSheetId() !== skip.getSheetId(); });
  sheets.sort(function (a, b) { return (/tham du/.test(norm_(b.getName())) ? 1 : 0) - (/tham du/.test(norm_(a.getName())) ? 1 : 0); });
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s], lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (lr < 2 || lc < 3) continue;
    var v = sh.getRange(1, 1, Math.min(lr, 500), Math.min(lc, 30)).getValues();
    var hr = -1, cName = -1, cCty = -1, r, k;
    for (r = 0; r < Math.min(v.length, 15) && hr < 0; r++) {
      var h = v[r].map(norm_), n = -1, c = -1;
      for (k = 0; k < h.length; k++) {
        if (n < 0 && /^ho (va )?ten$/.test(h[k])) n = k;
        if (c < 0 && /^(don vi|co quan|cong ty|doanh nghiep)/.test(h[k])) c = k;
      }
      if (n >= 0 && c >= 0) { hr = r; cName = n; cCty = c; }
    }
    if (hr < 0) continue;
    var H = v[hr].map(norm_), H2 = (v[hr + 1] || []).map(norm_);
    var find = function (re) { for (var q = 0; q < H.length; q++) if (re.test(H[q]) || re.test(H2[q] || '')) return q; return -1; };
    var cCv = find(/^chuc (vu|danh)/), cTuong = find(/^co tuong$/), cUp = find(/^co tuong up$/), cHide = find(/^(an|hide)$/);
    var start = H2.some(function (x) { return /^co tuong/.test(x); }) ? hr + 2 : hr + 1;
    var list = [], seen = {};
    for (r = start; r < v.length; r++) {
      var raw = sp_(v[r][cName]);
      if (/^tong (ky thu|cong|so)/.test(norm_(raw))) break;             // dòng tổng cuối bảng
      var nm = name_(raw.replace(/^(ông|bà|ong|ba)\s+/i, ''));
      if (!nm || seen[norm_(nm)]) continue;                             // bỏ dòng trống + tên trùng
      if (cHide >= 0 && sp_(v[r][cHide])) continue;
      seen[norm_(nm)] = 1;
      var t = cTuong >= 0 && sp_(v[r][cTuong]) !== '', u = cUp >= 0 && sp_(v[r][cUp]) !== '';
      list.push({ n: nm, cv: cCv >= 0 ? role_(v[r][cCv]) : '', cty: sp_(v[r][cCty]),
        nd: t && u ? 'Cờ tướng, Cờ tướng úp' : t ? 'Cờ tướng' : u ? 'Cờ tướng úp' : '' });
    }
    if (list.length) return { name: sh.getName(), list: list };
  }
  return null;
}

// Danh sách cho app = danh sách tham dự chính thức (nếu có) + người mới đăng ký qua Form chưa có trong đó
function build_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var formSh = pickSheet_(ss), form = readForm_(formSh), off = readOfficial_(ss, formSh);
  var upd = form.latest ? new Date(form.latest).toISOString() : null;
  var src = ss.getName() + ' › ' + formSh.getName(); // tên file + tab đang đọc (để app hiện cho Ban tổ chức kiểm tra)
  if (!off) {
    if (form.error) return { updated: null, count: 0, dup: 0, list: [], error: form.error };
    return { updated: upd, src: src, count: form.list.length, dup: form.dup, list: form.list };
  }
  var idx = {}, extra = [], dup = form.dup;
  off.list.forEach(function (it, i) { idx[norm_(it.n)] = i; });
  form.list.forEach(function (it) {
    var k = norm_(it.n);
    if (k in idx) { var o = off.list[idx[k]]; if (!o.cv) o.cv = it.cv; if (!o.cty) o.cty = it.cty; dup++; }
    else extra.push(it);
  });
  var list = off.list.concat(extra);
  return { updated: upd, src: src, count: list.length, dup: dup, official: off.list.length, extra: extra.length, sheet: off.name, list: list };
}


/* ======================= AI qua Apps Script ======================= */
function doPost(e) {
  var req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ error: 'Dữ liệu gửi lên không hợp lệ' }); }
  try {
    if (req.t === 'board') return json_(readBoard_(req));
    if (req.t === 'kq') return json_(readKq_(req));
    if (req.t === 'rank') return json_(readRank_(req));
    if (req.t === 'ping') return json_(req.list ? { ok: true, ai: 5, models: listModels_() } : { ok: true, ai: 5 });
    return json_({ error: 'Yêu cầu không được hỗ trợ' });
  } catch (x) { return json_({ error: String((x && x.message) || x) }); }
}

function json_(o) { return out_(JSON.stringify(o)); }

function geminiKey_() {
  var p = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (p) return p.trim();
  return (GEMINI_API_KEY && GEMINI_API_KEY.indexOf('DAN_KEY') < 0) ? GEMINI_API_KEY.trim() : '';
}

// Giới hạn mỗi máy N lượt / 6 giờ để giữ hạn mức miễn phí
function limit_(dev, kind, max) {
  var c = CacheService.getScriptCache(), k = 'lim_' + kind + '_' + String(dev || 'x').replace(/[^a-z0-9]/gi, '').slice(0, 40);
  var n = +(c.get(k) || 0);
  if (n >= max) return false;
  c.put(k, String(n + 1), 21600);
  return true;
}

// Model dự phòng khi model chính quá tải / hết hạn mức / không có
// Danh sách model ổn định có đọc ảnh (theo trang model của Google, 11/2026), ưu tiên chính xác -> nhẹ.
// Bỏ gemini-flash-latest (trỏ về model chính, hay treo khi quá tải) và gemini-2.5-flash (đã ngừng).
var GEMINI_FALLBACK = ['gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
var lastModel_ = '', lastErrs_ = [];

function callModel_(model, key, body) {
  var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
    { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  var code = r.getResponseCode(), d = {};
  try { d = JSON.parse(r.getContentText()); } catch (x) {}
  if (code === 200) return { ok: true, data: d, code: code };
  var msg = (d.error && d.error.message) || ('Lỗi AI (' + code + ')');
  var retry = !/location|api key|api_key|permission/i.test(msg) && (code === 429 || code === 404 || code >= 500 ||
    /high demand|overloaded|unavailable|try again|not found|not supported for generatecontent|quota|exhausted/i.test(msg));
  return { ok: false, err: msg, retry: retry, code: code };
}

// Danh sách model Gemini dùng được với key này (chẩn đoán)
function listModels_() {
  var key = geminiKey_();if (!key) return [];
  var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key), { muteHttpExceptions: true });
  try { return (JSON.parse(r.getContentText()).models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
    .map(function (m) { return String(m.name).replace('models/', ''); }); } catch (x) { return []; }
}

function gemini_(parts, schema, opt) {
  opt = opt || {};
  var key = geminiKey_();
  if (!key) throw new Error('Chưa dán GEMINI_API_KEY trong Apps Script');
  var first = opt.model || PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || GEMINI_MODEL;
  var cache = CacheService.getScriptCache(), sticky = cache.get('okModel');
  // Thứ tự: model vừa chạy tốt (đỡ phải chờ model đang quá tải) -> model chính -> các model dự phòng; bỏ qua model vừa lỗi
  var all = opt.fallback ? [first].concat(opt.fallback).filter(function (m, k, a) { return a.indexOf(m) === k; })
    : (sticky && !opt.model ? [sticky] : []).concat([first]).concat(sticky ? [sticky] : []).concat(GEMINI_FALLBACK).filter(function (m, k, a) { return a.indexOf(m) === k; });
  var models = all.filter(function (m) { return !cache.get('bad_' + m); });
  if (!models.length && opt.failFast) throw new Error('AI chính đang bận');
  if (!models.length) models = all;
  var body = { contents: [{ parts: parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } };
  if (schema) body.generationConfig.responseSchema = schema;
  if (opt.think) body.generationConfig.thinkingConfig = { thinkingBudget: opt.think };
  if (opt.maxTokens) body.generationConfig.maxOutputTokens = opt.maxTokens;
  var d = null, lastErr = '';
  lastErrs_ = [];
  for (var i = 0; i < models.length && !d; i++) {
    var t0 = Date.now(), res = callModel_(models[i], key, body);
    if (!res.ok && res.code === 400 && body.generationConfig.thinkingConfig && /think/i.test(res.err)) { // model không hỗ trợ "suy nghĩ" -> gọi lại bình thường
      var b2 = JSON.parse(JSON.stringify(body)); delete b2.generationConfig.thinkingConfig; res = callModel_(models[i], key, b2);
    }
    if (res.ok) {
      d = res.data; lastModel_ = models[i];
      try { if (models[i] !== first) cache.put('okModel', models[i], 21600); else cache.remove('okModel'); } catch (x) {}
      break;
    }
    lastErr = res.err;
    lastErrs_.push(models[i] + ' → ' + res.code + ' ' + String(res.err).slice(0, 90) + ' (' + Math.round((Date.now() - t0) / 100) / 10 + 's)');
    if (!res.retry) throw new Error(lastErr);          // lỗi key / chặn vùng… -> báo ngay
    try { cache.put('bad_' + models[i], '1', (models[i] === first && !/high demand|overloaded|unavailable/i.test(String(res.err))) ? 300 : 1800); } catch (x) {}
  }
  if (!d) throw new Error('AI đang quá tải, vui lòng thử lại sau ít phút. (' + lastErr + ')');
  var txt = '';
  try { txt = d.candidates[0].content.parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join(''); } catch (x) {}
  try { return JSON.parse(txt); } catch (x) {
    var m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (y) {} }
    if (opt.salvage) { var sv = opt.salvage(txt); if (sv) return sv; }
    throw new Error('AI trả về dữ liệu không đọc được');
  }
}

/* --- Đọc ảnh bàn cờ: AI chỉ ra 4 góc lưới + tâm từng quân (toạ độ ảnh) -> tự tính hàng/cột bằng phép chiếu phối cảnh --- */
function solve8_(A, b) { // Gauss có chọn trụ
  var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); }), i, j, k;
  for (i = 0; i < n; i++) {
    var p = i; for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (Math.abs(M[p][i]) < 1e-9) return null; var t = M[i]; M[i] = M[p]; M[p] = t;
    for (k = i + 1; k < n; k++) { var f = M[k][i] / M[i][i]; for (j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  var x = new Array(n); for (i = n - 1; i >= 0; i--) { var s = M[i][n]; for (j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
function homog_(src, dst) {
  var A = [], b = [];
  for (var i = 0; i < 4; i++) { var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
  var h = solve8_(A, b); if (!h) return null; h.push(1); return h;
}
function hApply_(h, x, y) { var w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; }
function okPt_(a) { return a && a.length >= 2 && a[0] >= -50 && a[0] <= 1050 && a[1] >= -50 && a[1] <= 1050; }

function readBoard_(req) {
  if (!req.image) return { error: 'Thiếu ảnh' };
  if (!limit_(req.dev, 'board', 80)) return { error: 'Máy này đã dùng nhiều lượt AI, vui lòng thử lại sau vài giờ.' };
  var prompt = [
    'You are an expert Xiangqi (Chinese chess) position reader. The image shows ONE Xiangqi board: a real board with round pieces,',
    'a printed diagram, or an app screenshot. It is usually a MIDDLE-GAME or END-GAME position: many pieces may have been captured and the',
    'remaining pieces can stand anywhere. NEVER assume or "complete" the standard opening setup — report only pieces you actually see.',
    'Grid: 9 vertical lines x 10 horizontal lines; pieces sit ON the intersections; the river (楚河 漢界 or a blank band) lies between',
    'the 5th and 6th horizontal lines. Ignore captured pieces lying outside the grid, and ignore buttons/logos/decorations.',
    '',
    'Coordinates: give image points as y, x normalized to 0-1000 (y from the TOP of the image, x from the LEFT).',
    '1) "corners": the 4 outermost INTERSECTIONS of the grid lines (not the outer decorative frame, not the image edge):',
    '   tl = top-left, tr = top-right, bl = bottom-left, br = bottom-right, as seen in the image; each as {y, x}.',
    '2) "pieces": for EACH piece on the grid (at most 32, list each piece ONCE): "p" = letter, "y","x" = the CENTRE of the piece,',
    '   plus "c" = vertical line counted from the LEFT edge of the grid (1..9) and "r" = horizontal line counted from the TOP edge (1..10).',
    '3) If the river runs vertically in the image (board turned sideways), set "rotated": true (then c = 1..10 from the left, r = 1..9 from the top).',
    'Letters: K general (帥 帅 將 将), A advisor (仕 士), B elephant (相 象), N horse (傌 馬 马), R chariot (俥 車 车), C cannon (炮 砲 包), P soldier (兵 卒).',
    'UPPERCASE = RED side, lowercase = BLACK side (black / dark blue / dark green). Decide the side by the COLOUR of the piece, not by the character.',
    'red_side = "bottom" or "top": where the RED general/palace is in the image.',
    'Return JSON only. note = short Vietnamese note about anything uncertain (empty if none).'
  ].join('\n');
  var I = { type: 'INTEGER' }, PT = { type: 'OBJECT', properties: { y: I, x: I }, required: ['y', 'x'] };
  var schema = { type: 'OBJECT', properties: {
      corners: { type: 'OBJECT', properties: { tl: PT, tr: PT, bl: PT, br: PT }, required: ['tl', 'tr', 'bl', 'br'] },
      pieces: { type: 'ARRAY', maxItems: 32, items: { type: 'OBJECT', properties: { p: { type: 'STRING' }, y: I, x: I, c: I, r: I }, required: ['p', 'y', 'x', 'c', 'r'] } },
      rotated: { type: 'BOOLEAN' },
      red_side: { type: 'STRING', enum: ['bottom', 'top'] },
      note: { type: 'STRING' } }, required: ['corners', 'pieces', 'red_side'] };
  // Đọc bàn cờ: gemini-3.5-flash đọc toạ độ chính xác (~20–30 giây); bận thì chuyển sang bản nhẹ (đổi bằng Script Property GEMINI_MODEL_BOARD)
  var opt = { model: PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL_BOARD') || 'gemini-3.5-flash', maxTokens: 8192,
    fallback: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'],
    think: 2048,
    salvage: function (t) { // câu trả lời bị cắt giữa chừng -> lấy những quân đã đọc được (không phụ thuộc thứ tự khoá)
      var ps = [], objs = t.match(/\{[^{}]*"p"\s*:\s*"[KABNRCPkabnrcp]"[^{}]*\}/g) || [];
      objs.forEach(function (o) { if (ps.length >= 32) return;
        function g(k) { var m = new RegExp('"' + k + '"\\s*:\\s*(-?\\d+)').exec(o); return m ? +m[1] : null; }
        var p = /"p"\s*:\s*"([KABNRCPkabnrcp])"/.exec(o)[1], q = { p: p, y: g('y'), x: g('x'), c: g('c'), r: g('r') };
        if (q.c != null && q.r != null) ps.push(q); });
      var cm = {}; ['tl', 'tr', 'bl', 'br'].forEach(function (k) { var mm = new RegExp('"' + k + '"\\s*:\\s*\\{([^{}]*)\\}').exec(t);
        if (mm) { var y = /"y"\s*:\s*(\d+)/.exec(mm[1]), x = /"x"\s*:\s*(\d+)/.exec(mm[1]); if (y && x) cm[k] = { y: +y[1], x: +x[1] }; } });
      var rs = /"red_side"\s*:\s*"(top|bottom)"/.exec(t);
      return ps.length ? { pieces: ps, corners: cm, red_side: rs ? rs[1] : 'bottom', note: 'AI trả lời bị ngắt — có thể thiếu quân' } : null;
    } };
  if (req.dev === 'kan-test-201278' && req.mdl && /^[\w.-]+$/.test(req.mdl)) opt.model = req.mdl;   // chỉ để BTC thử model
  if (req.dev === 'kan-test-201278' && req.think != null) opt.think = +req.think;
  // App gửi song song 2 lượt: "fast" = bản nhẹ, không suy nghĩ (vài giây); "best" = model chính, không chuyển model khác (bận thì báo ngay)
  if (req.tier === 'fast') { opt.model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL_BOARD_FAST') || 'gemini-3.1-flash-lite';
    opt.fallback = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite']; delete opt.think; opt.maxTokens = 6000; }
  if (req.tier === 'best') { opt.fallback = []; opt.failFast = true; }
  if (!opt.think) delete opt.think;
  var parts = [{ text: prompt }, { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }], o;
  try { o = gemini_(parts, schema, opt); }
  catch (e) { // model chính trả lời hỏng -> đọc lại bằng bản nhẹ
    if (req.tier || !/không đọc được/.test(String(e && e.message))) throw e;
    o = gemini_(parts, schema, { model: 'gemini-3.5-flash-lite', fallback: ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest'], maxTokens: 8192, salvage: opt.salvage });
  }
  var rot = !!o.rotated, H = rot ? 9 : 10, Wd = rot ? 10 : 9, k;
  var PS = (o.pieces || []).slice(0, 40).map(function (q) { return { p: String(q.p || '').trim().charAt(0), pt: (q.y != null && q.x != null) ? [+q.y, +q.x] : q.pt, c: +q.c - 1, r: +q.r - 1 }; })
    .filter(function (q) { return /[KABNRCPkabnrcp]/.test(q.p); });
  // Phép chiếu phối cảnh từ 4 góc lưới -> (cột, hàng)
  var C0 = o.corners || {}, C = {}, h = null, mode = 'dem';
  ['tl', 'tr', 'bl', 'br'].forEach(function (k) { var v = C0[k]; C[k] = v && v.y != null ? [+v.y, +v.x] : v; });
  if (okPt_(C.tl) && okPt_(C.tr) && okPt_(C.bl) && okPt_(C.br)) {
    var src = [C.tl, C.tr, C.bl, C.br].map(function (a) { return [a[1], a[0]]; });
    var area = Math.abs((src[1][0] - src[0][0]) * (src[2][1] - src[0][1]) - (src[1][1] - src[0][1]) * (src[2][0] - src[0][0]));
    if (area > 40000) h = homog_(src, [[0, 0], [Wd - 1, 0], [0, H - 1], [Wd - 1, H - 1]]);
  }
  var geo = null;
  if (h) {
    var errs = [];
    geo = PS.map(function (q) {
      if (!okPt_(q.pt)) return null;
      var uv = hApply_(h, q.pt[1], q.pt[0]), c = Math.round(uv[0]), r = Math.round(uv[1]);
      if (uv[0] < -0.6 || uv[0] > Wd - 0.4 || uv[1] < -0.6 || uv[1] > H - 0.4) return { out: true };
      c = Math.max(0, Math.min(Wd - 1, c)); r = Math.max(0, Math.min(H - 1, r));
      var e = Math.sqrt(Math.pow(uv[0] - c, 2) + Math.pow(uv[1] - r, 2)); errs.push(e);
      return { c: c, r: r, e: e, u: uv[0], v: uv[1] };
    });
    errs.sort(function (a, b) { return a - b; });
    var med = errs.length ? errs[Math.floor(errs.length / 2)] : 1;
    if (errs.length >= Math.max(2, PS.length * 0.6) && med < 0.3) mode = 'hinh'; else geo = null;
  }
  // Đặt quân: ưu tiên quân khớp lưới tốt nhất; trùng ô thì dời sang ô trống kế bên theo hướng lệch
  var grid = [], used = {}, agree = 0, order = PS.map(function (q, i) { return i; });
  for (k = 0; k < H; k++) grid.push(new Array(Wd + 1).join('.').split(''));
  if (geo) order.sort(function (a, b) { return ((geo[a] && geo[a].e) || 9) - ((geo[b] && geo[b].e) || 9); });
  order.forEach(function (i) {
    var q = PS[i], g = geo ? geo[i] : null, c, r;
    if (geo) { if (!g || g.out) return; c = g.c; r = g.r; if (q.c === c && q.r === r) agree++; }
    else { c = q.c; r = q.r; }
    if (!(c >= 0 && c < Wd && r >= 0 && r < H)) return;
    if (used[r + '_' + c] && g) {
      var dc = g.u - c, dr = g.v - r, cand = Math.abs(dc) > Math.abs(dr) ? [[r, c + (dc > 0 ? 1 : -1)], [r + (dr > 0 ? 1 : -1), c]] : [[r + (dr > 0 ? 1 : -1), c], [r, c + (dc > 0 ? 1 : -1)]];
      cand = cand.filter(function (x) { return x[0] >= 0 && x[0] < H && x[1] >= 0 && x[1] < Wd && !used[x[0] + '_' + x[1]]; });
      if (!cand.length) return; r = cand[0][0]; c = cand[0][1];
    }
    if (used[r + '_' + c]) return;
    used[r + '_' + c] = 1; grid[r][c] = q.p;
  });
  var rows = grid.map(function (a) { return a.join(''); });
  return { ok: true, rows: rows, red: o.red_side === 'top' ? 'top' : 'bottom', note: String(o.note || '').slice(0, 300), n: PS.length,
    mode: mode, agree: agree, model: lastModel_, errs: lastErrs_ };
}

/* --- Đọc ảnh biên bản kết quả 1 vòng --- */
function readKq_(req) {
  if (!req.image) return { error: 'Thiếu ảnh' };
  if (!limit_(req.dev, 'kq', 80)) return { error: 'Đã dùng nhiều lượt AI, thử lại sau vài giờ.' };
  var plist = (req.players || []).slice(0, 300).join(', ');
  var prompt = 'Ảnh chụp danh sách CẶP ĐẤU (bốc thăm) hoặc KẾT QUẢ một vòng đấu cờ tướng — thường là bản in từ phần mềm Swiss-Manager '
    + '(cột: Bàn, Số, Tên kỳ thủ bên trái = Đỏ/đi tiên, Điểm, Kết quả, Tên kỳ thủ bên phải = Đen/đi sau, Điểm), hoặc biên bản viết tay.\n'
    + 'Đọc TẤT CẢ các bàn theo đúng thứ tự từ trên xuống. Giữ nguyên bên trái là "a", bên phải là "b".\n'
    + 'Danh sách kỳ thủ đã đăng ký (khớp tên đọc được với tên gần nhất trong danh sách này khi chắc chắn; bỏ chức danh Ông/Bà): ' + plist + '.\n'
    + 'kq: "a" nếu bên trái thắng (1-0, 1 - 0, +/-, 1F-0F, bên phải bỏ cuộc), "b" nếu bên phải thắng (0-1, -/+, 0F-1F), '
    + '"hoa" nếu hòa (½-½, 0.5-0.5, 1/2), "none" nếu ô kết quả trống (danh sách bốc thăm chưa đấu).\n'
    + 'Bàn được miễn đấu (bye, "nghỉ", "miễn đấu", không có đối thủ): ghi b = "BYE".\n'
    + 'vong: số vòng ghi trên tiêu đề ảnh (VD "Vòng 3", "Round 3"), không thấy thì 0. nd: "tuong" nếu tiêu đề là Cờ tướng, "up" nếu Cờ tướng úp, không rõ thì "".';
  var schema = { type: 'OBJECT', properties: {
    vong: { type: 'INTEGER' }, nd: { type: 'STRING' },
    games: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      ban: { type: 'INTEGER' }, a: { type: 'STRING' }, b: { type: 'STRING' }, kq: { type: 'STRING', enum: ['a', 'b', 'hoa', 'none'] } },
      required: ['a', 'b', 'kq'] } } }, required: ['games'] };
  var o = gemini_([{ text: prompt }, { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }], schema);
  var g = (o.games || []).filter(function (x) { return x && (x.a || x.b); }).slice(0, 200).map(function (x) {
    var k = String(x.kq || 'none').toLowerCase();
    return { ban: +x.ban || 0, a: sp_(x.a).replace(/^(ông|bà)\s+/i, '').slice(0, 80), b: sp_(x.b).replace(/^(ông|bà)\s+/i, '').slice(0, 80),
      kq: /^(a|b|hoa|none)$/.test(k) ? k : 'none' };
  });
  return { ok: true, vong: +o.vong || 0, nd: String(o.nd || ''), games: g };
}

/* --- Đọc ảnh BẢNG XẾP HẠNG sau vòng (bản in Swiss-Manager) --- */
function readRank_(req) {
  if (!req.image) return { error: 'Thiếu ảnh' };
  if (!limit_(req.dev, 'kq', 80)) return { error: 'Đã dùng nhiều lượt AI, thử lại sau vài giờ.' };
  var plist = (req.players || []).slice(0, 300).join(', ');
  var prompt = 'Ảnh chụp BẢNG XẾP HẠNG sau một vòng của giải cờ tướng — thường là bản in Swiss-Manager '
    + '(cột: Hạng/Rk, Số/SNo, Tên, Đơn vị/CLB, Điểm/Pts, các hệ số phụ như Đối đầu/DE, Buchholz/BH, Số ván thắng/WIN, Đi sau/BLK…).\n'
    + 'Đọc TẤT CẢ các dòng theo đúng thứ tự hạng từ trên xuống.\n'
    + 'Danh sách kỳ thủ đã đăng ký (khớp tên đọc được với tên gần nhất trong danh sách này khi chắc chắn; bỏ chức danh Ông/Bà): ' + plist + '.\n'
    + 'h: thứ hạng (số). n: tên kỳ thủ. dv: đơn vị/CLB nếu có, không có thì "". d: điểm (số, 0.5 viết là 0.5). '
    + 'hs: các hệ số phụ ghép thành chuỗi ngắn kèm tên cột, VD "BH 21.5 · Thắng 4", không có thì "".\n'
    + 'vong: số vòng ghi trên tiêu đề (VD "sau vòng 5"/"after Round 5"), không thấy thì 0. nd: "tuong" nếu Cờ tướng, "up" nếu Cờ tướng úp, không rõ thì "".';
  var schema = { type: 'OBJECT', properties: {
    vong: { type: 'INTEGER' }, nd: { type: 'STRING' },
    rows: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      h: { type: 'INTEGER' }, n: { type: 'STRING' }, dv: { type: 'STRING' }, d: { type: 'NUMBER' }, hs: { type: 'STRING' } },
      required: ['h', 'n', 'd'] } } }, required: ['rows'] };
  var o = gemini_([{ text: prompt }, { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }], schema);
  var rows = (o.rows || []).filter(function (x) { return x && x.n; }).slice(0, 300).map(function (x, i) {
    return { h: +x.h || (i + 1), n: sp_(x.n).replace(/^(ông|bà)\s+/i, '').slice(0, 80), dv: sp_(x.dv).slice(0, 120),
      d: Math.round((+x.d || 0) * 2) / 2, hs: sp_(x.hs).slice(0, 80) };
  });
  return { ok: true, vong: +o.vong || 0, nd: String(o.nd || ''), rows: rows };
}

/* --- Bấm "Chạy" hàm này 1 lần trong trình soạn Apps Script để cấp quyền và kiểm tra key --- */
function kiemTraGemini() {
  // Lưu key vào kho bảo mật của script -> lần sau dán code mới không cần dán lại key
  if (GEMINI_API_KEY && GEMINI_API_KEY.indexOf('DAN_KEY') < 0) PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', GEMINI_API_KEY.trim());
  var o = gemini_([{ text: 'Trả lời đúng JSON: {"ok":true,"loi_chao":"Xin chào Cúp Đại Phú Gia"}' }]);
  lastErrs_.forEach(function (e) { Logger.log('↷ Bỏ qua: ' + e); });
  Logger.log('✓ Gemini hoạt động tốt từ Apps Script (model: ' + lastModel_ + '): ' + JSON.stringify(o));
  Logger.log('✓ Đã lưu key vào kho bảo mật của script. Bước cuối: Deploy → Manage deployments → ✏️ → New version → Deploy.');
  return o;
}
