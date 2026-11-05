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
  data.ai = 2; // báo cho app biết máy chủ đã có AI
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

function build_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var v = pickSheet_(ss).getDataRange().getValues();
  if (v.length < 2) return { updated: null, count: 0, dup: 0, list: [] };
  var h = v[0].map(norm_);
  function col(test) { for (var i = 0; i < h.length; i++) if (test(h[i])) return i; return -1; }
  function priv(x) { return /dien thoai|sdt|so dt|e-?mail|zalo|\bmail\b|dia chi|address|phone/.test(x); }

  var cTs   = col(function (x) { return /dau thoi gian|timestamp/.test(x); });
  var cCty  = col(function (x) { return !priv(x) && /cong ty|don vi|doanh nghiep|co quan|to chuc|company|organi[sz]ation/.test(x); });
  var cCv   = col(function (x) { return !priv(x) && /chuc vu|chuc danh|position|job title|^title$/.test(x); });
  var cName = col(function (x) { return !priv(x) && !/cong ty|don vi|doanh nghiep|co quan|company/.test(x) && /ho (va )?ten|^ten\b|full ?name|^name$/.test(x); });
  var cNd   = col(function (x) { return !priv(x) && /noi dung|thi dau|\bmon\b/.test(x); });
  var cHide = col(function (x) { return /^(an|hide|an dong)$/.test(x); });
  if (cName < 0) return { updated: null, count: 0, dup: 0, list: [], error: 'Không tìm thấy cột Tên' };

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
  return { updated: latest ? new Date(latest).toISOString() : null, count: list.length, dup: dup, list: list };
}


/* ======================= AI qua Apps Script ======================= */
function doPost(e) {
  var req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ error: 'Dữ liệu gửi lên không hợp lệ' }); }
  try {
    if (req.t === 'board') return json_(readBoard_(req));
    if (req.t === 'kq') return json_(readKq_(req));
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
var GEMINI_FALLBACK = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'];
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

function gemini_(parts, schema) {
  var key = geminiKey_();
  if (!key) throw new Error('Chưa dán GEMINI_API_KEY trong Apps Script');
  var first = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || GEMINI_MODEL;
  var models = [first, first].concat(GEMINI_FALLBACK.filter(function (m) { return m !== first; })); // thử lại model chính 1 lần
  var cache = CacheService.getScriptCache(), sticky = cache.get('okModel');   // model vừa chạy tốt -> gọi thẳng cho nhanh
  if (sticky && sticky !== first) models = [sticky].concat(models.filter(function (m) { return m !== sticky; }));
  lastErrs_ = [];
  var body = { contents: [{ parts: parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } };
  if (schema) body.generationConfig.responseSchema = schema;
  var d = null, lastErr = '';
  for (var i = 0; i < models.length && !d; i++) {
    var t0 = Date.now(), res = callModel_(models[i], key, body);
    if (res.ok) {
      d = res.data; lastModel_ = models[i];
      try { if (models[i] !== first) cache.put('okModel', models[i], 1800); else cache.remove('okModel'); } catch (x) {}
      break;
    }
    lastErr = res.err;
    lastErrs_.push(models[i] + ' → ' + res.code + ' ' + String(res.err).slice(0, 90) + ' (' + Math.round((Date.now() - t0) / 100) / 10 + 's)');
    if (!res.retry) throw new Error(lastErr);          // lỗi key / chặn vùng… -> báo ngay
    if (i < models.length - 1) Utilities.sleep(i === 0 ? 1500 : 400);
  }
  if (!d) throw new Error('AI đang quá tải, vui lòng thử lại sau ít phút. (' + lastErr + ')');
  var txt = '';
  try { txt = d.candidates[0].content.parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join(''); } catch (x) {}
  try { return JSON.parse(txt); } catch (x) {
    var m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('AI trả về dữ liệu không đọc được');
  }
}

/* --- Đọc ảnh bàn cờ -> 10 hàng x 9 cột --- */
function readBoard_(req) {
  if (!req.image) return { error: 'Thiếu ảnh' };
  if (!limit_(req.dev, 'board', 40)) return { error: 'Máy này đã dùng nhiều lượt AI, vui lòng thử lại sau vài giờ.' };
  var prompt = [
    'You are an expert Xiangqi (Chinese chess) position reader. The image shows a Xiangqi board',
    '(a real board with round pieces, a printed diagram, or an app screenshot). Read EVERY piece and its exact point.',
    'Geometry: 9 vertical lines (files) x 10 horizontal lines (ranks). Pieces sit ON the line intersections, not inside squares.',
    'The river (楚河 漢界 or a blank band) separates the 5th and 6th horizontal lines.',
    'Return JSON only: {"rows":[10 strings],"red_side":"bottom"|"top","note":"short note about anything uncertain, in Vietnamese"}.',
    '- rows[0] = the horizontal line nearest the TOP of the image, rows[9] = nearest the BOTTOM.',
    '- Each string has exactly 9 characters, LEFT to RIGHT as seen in the image.',
    '- If the photo is rotated so that the river is vertical, first rotate the board mentally so that the river is horizontal.',
    '- Letters: K=general (帥 帅 將 将), A=advisor (仕 士), B=elephant (相 象), N=horse (傌 馬 马), R=chariot (俥 車 车),',
    '  C=cannon (炮 砲 包), P=soldier (兵 卒). UPPERCASE = RED pieces, lowercase = BLACK pieces (black / dark green / dark blue).',
    '  Decide the side by the COLOR of the piece/character, not by the character alone. Use "." for an empty point.',
    '- Ignore captured pieces placed outside the board.',
    '- Sanity: each side has exactly 1 general inside its own palace, at most 2 advisors, 2 elephants, 2 horses, 2 chariots, 2 cannons, 5 soldiers.',
    '- red_side = whether the RED general/palace is at the top or bottom of the image.'
  ].join('\n');
  var schema = { type: 'OBJECT', properties: {
      rows: { type: 'ARRAY', items: { type: 'STRING' } },
      red_side: { type: 'STRING', enum: ['bottom', 'top'] },
      note: { type: 'STRING' } }, required: ['rows', 'red_side'] };
  var o = gemini_([{ text: prompt }, { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }], schema);
  var rows = (o.rows || []).slice(0, 12).map(function (s) {
    return String(s || '').replace(/[1-9]/g, function (n) { return new Array(+n + 1).join('.'); })
      .replace(/[-_0·*+x]/g, '.').replace(/[^KABNRCPkabnrcp.]/g, '');
  });
  return { ok: true, rows: rows, red: o.red_side === 'top' ? 'top' : 'bottom', note: String(o.note || '').slice(0, 300) };
}

/* --- Đọc ảnh biên bản kết quả 1 vòng --- */
function readKq_(req) {
  if (!req.image) return { error: 'Thiếu ảnh' };
  if (!limit_(req.dev, 'kq', 60)) return { error: 'Đã dùng nhiều lượt AI, thử lại sau vài giờ.' };
  var plist = (req.players || []).slice(0, 300).join(', ');
  var prompt = 'Đây là ảnh ghi kết quả một vòng đấu cờ tướng (bảng in hoặc biên bản viết tay).\n'
    + 'Hãy trích xuất danh sách các ván đấu trong ảnh.\n'
    + 'Danh sách kỳ thủ đã đăng ký (khớp tên đọc được với tên gần nhất trong danh sách này khi có thể): ' + plist + '.\n'
    + 'Chỉ trả về JSON: {"games":[{"a":"Tên kỳ thủ bên trái","b":"Tên kỳ thủ bên phải","kq":"a"}]}\n'
    + 'kq: "a" nếu bên A thắng, "b" nếu bên B thắng, "hoa" nếu hòa, "none" nếu chưa có kết quả.';
  var o = gemini_([{ text: prompt }, { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }]);
  var g = (o.games || []).filter(function (x) { return x && (x.a || x.b); }).slice(0, 200).map(function (x) {
    var k = String(x.kq || 'none').toLowerCase();
    return { a: String(x.a || '').slice(0, 80), b: String(x.b || '').slice(0, 80), kq: /^(a|b|hoa|none)$/.test(k) ? k : 'none' };
  });
  return { ok: true, games: g };
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
