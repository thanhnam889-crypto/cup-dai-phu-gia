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

function doGet() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('reg');
  if (hit) return out_(hit);
  var data;
  try { data = build_(); } catch (e) { data = { updated: null, count: 0, list: [], error: String(e && e.message || e) }; }
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
