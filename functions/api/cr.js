// Cloudflare Pages Function: đọc Bốc thăm / Kết quả / Xếp hạng từ Chess-Results cho app.
// Route: /api/cr?t=<mã giải tnr>
// Hỗ trợ 2 dạng giải:
//  - Cá nhân (kể cả đồng đội tính theo tổng điểm cá nhân): xếp cặp art=2&rd=N, xếp hạng art=1&rd=N
//  - Đội đấu đội (team, ví dụ nội dung Đôi): bốc thăm đội art=2&rd=N, xếp hạng đội art=0&rd=N
// Trả JSON: {t, at, title, team, n, rounds:{"1":{pairs:[{bd,w,wc,b,bc,res,bye}],res:k}}, rank:{"1":[[hạng,tên,clb,điểm]]}}
// - Toàn bộ kết quả lưu đệm 60 giây.
// - Trang của vòng đã có đủ kết quả được lưu đệm 6 giờ, nên mỗi phút chỉ còn đọc lại trang chính + vòng đang đấu.
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const TTL = 60;
const DONE_TTL = 21600;

export async function onRequestGet(context) {
  const { request } = context;
  const u = new URL(request.url);
  const t = (u.searchParams.get('t') || '').trim();
  if (!/^\d{5,9}$/.test(t)) return j({ error: 'Thiếu mã giải (t)' }, 400);
  const cache = caches.default;
  const key = new Request('https://cr-cache.local/v4/' + t);
  if (!u.searchParams.has('fresh')) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  try {
    const base = await get(t, 'art=0');
    const team = /<t[hd][^>]*>\s*(?:<[^>]+>\s*)*Đội\s*(?:<\/[^>]+>\s*)*<\/t[hd]>/i.test(base) && /HS1|Ván cờ|Matchpoints/i.test(base);
    const rds = new Set();
    for (const m of base.matchAll(/art=2(?:&amp;|&)rd=(\d+)/g)) rds.add(+m[1]);
    for (const m of base.matchAll(/art=[01](?:&amp;|&)rd=(\d+)/g)) rds.add(+m[1]);
    let maxR = Math.max(0, ...rds);
    if (maxR > 15) maxR = 15;
    const tot = base.match(/V\d+\s*\/\s*(\d+)/);
    const n = Math.max(maxR, tot ? +tot[1] : 0);
    const list = []; for (let r = 1; r <= maxR; r++) list.push(r);
    const pairPages = await Promise.all(list.map(r => page(cache, t, 'art=2&rd=' + r).catch(() => ({ html: '', hit: false }))));
    const rounds = {};
    let prevSig = '';
    list.forEach((r, i) => {
      const { html, hit } = pairPages[i];
      // Chess-Results có thể trả về trang của vòng khác khi vòng r chưa xếp cặp -> kiểm tra nhãn "r. Ván"/"Round r"
      const lab = html.match(/(\d+)\.\s*(?:Ván|Round|Runde)\b/i);
      if (lab && +lab[1] !== r) return;
      const pairs = team ? parseTeamPairs(html) : parsePairs(html);
      const sig = pairs.map(p => p.w + '|' + p.b).join(';');
      if (!pairs.length || sig === prevSig) return; // trùng hệt vòng trước = chưa có vòng này
      prevSig = sig;
      const res = pairs.filter(p => p.res).length;
      const done = pairs.every(p => p.res || p.bye);
      rounds[r] = { pairs, res, done };
      if (done && !hit) keep(context, cache, t, 'art=2&rd=' + r, html);
    });
    const rankR = list.filter(r => rounds[r] && rounds[r].res > 0);
    const rq = r => (team ? 'art=0&rd=' : 'art=1&rd=') + r;
    const rankPages = await Promise.all(rankR.map(r => page(cache, t, rq(r)).catch(() => ({ html: '', hit: false }))));
    const rank = {};
    rankR.forEach((r, i) => {
      const { html, hit } = rankPages[i];
      const L = team ? parseTeamRank(html) : parseRank(html);
      if (L.length) { rank[r] = L; if (rounds[r].done && !hit) keep(context, cache, t, rq(r), html); }
    });
    Object.keys(rounds).forEach(r => { delete rounds[r].done; });
    const title = (base.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1];
    const out = { t, at: Date.now(), title: title ? txt(title) : '', team, n, rounds, rank };
    const res = j(out, 200, TTL);
    context.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return j({ error: 'Không đọc được Chess-Results: ' + (e && e.message || e) }, 502);
  }
}

// chess-results.com chuyển hướng sang các máy s1/s2/s3; gọi thẳng máy con, lỗi thì thử máy khác
const HOSTS = ['s1.chess-results.com', 's2.chess-results.com', 's3.chess-results.com', 'chess-results.com'];
async function get(t, q) {
  let last = '';
  for (const h of HOSTS) {
    try {
      const url = 'https://' + h + '/tnr' + t + '.aspx?lan=29&SNode=S0&' + q;
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'vi,en;q=0.8', 'accept': 'text/html,application/xhtml+xml' }, redirect: 'follow', cf: { cacheTtl: 30 } });
      if (r.ok) return await r.text();
      last = 'HTTP ' + r.status + ' (' + h + ')';
    } catch (e) { last = (e && e.message || 'lỗi mạng') + ' (' + h + ')'; }
  }
  throw new Error(last);
}
function pk(t, q) { return new Request('https://cr-cache.local/p4/' + t + '?' + q); }
async function page(cache, t, q) {
  const h = await cache.match(pk(t, q));
  if (h) return { html: await h.text(), hit: true };
  return { html: await get(t, q), hit: false };
}
function keep(context, cache, t, q, html) {
  context.waitUntil(cache.put(pk(t, q), new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=' + DONE_TTL } })).catch(() => {}));
}

function dec(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&frac12;/g, '½').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
}
function txt(h) { return dec(String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }
function nm(s) { return txt(s).replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
// Tách dòng/ô bền với bảng lồng nhau: mỗi dòng = đoạn giữa hai thẻ <tr>, mỗi ô = đoạn giữa hai thẻ <td>/<th>
function rows(html) {
  const out = [];
  const segs = String(html || '').split(/<tr\b/i).slice(1);
  for (let seg of segs) {
    seg = seg.split(/<\/tr>|<table\b/i)[0];
    const parts = seg.split(/<(?=t[dh]\b)/i).slice(1);
    const cells = [];
    for (const p of parts) {
      const th = /^th/i.test(p);
      let h = p.slice(p.indexOf('>') + 1);
      h = h.split(/<\/t[dh]>/i)[0];
      cells.push({ th, h, t: txt(h) });
    }
    if (cells.length) out.push(cells);
  }
  return out;
}
const RES = /^(1\s*-\s*0|0\s*-\s*1|½\s*-\s*½|0\s*-\s*0|\+\s*-\s*-|-\s*-\s*\+|-\s*-\s*-|1\s*-\s*½|½\s*-\s*1|½\s*-\s*0|0\s*-\s*½)$/;
const BYE = /miễn đấu|bye|spielfrei|nicht ausgelost|không xếp cặp/i;
const CLUB = /clb|club|verein/;
const FED = /^(lđ|ld|fed|lđ\.|liên đoàn)$/;
function clubCols(low) {
  let c = low.map((x, i) => CLUB.test(x) ? i : -1).filter(i => i >= 0);
  if (!c.length) c = low.map((x, i) => FED.test(x) ? i : -1).filter(i => i >= 0);
  return c;
}

function parsePairs(html) {
  const R = rows(html), out = [];
  let hdr = null;
  for (const c of R) {
    const low = c.map(x => x.t.toLowerCase());
    if (!hdr && low.some(x => /kết quả|result|ergebnis/.test(x)) && low.some(x => /^(white|trắng|weiß|đỏ)$/.test(x))) {
      hdr = { bd: 0, res: low.findIndex(x => /kết quả|result|ergebnis/.test(x)) };
      hdr.clubs = clubCols(low);
      continue;
    }
    const pl = c.map((x, i) => /snr=\d+/.test(x.h) ? i : -1).filter(i => i >= 0);
    if (!pl.length || !/^\d+(\.\d+)?$/.test(c[0].t)) continue;
    const iw = pl[0], ib = pl.length > 1 ? pl[1] : -1;
    const byeCell = ib < 0 ? c.findIndex((x, i) => i > iw && BYE.test(x.t)) : -1;
    if (ib < 0 && byeCell < 0) continue;
    let res = '';
    if (hdr && hdr.res > iw && hdr.res < (ib >= 0 ? ib : byeCell) && c[hdr.res]) res = c[hdr.res].t;
    else { const k = c.findIndex((x, i) => i > iw && i < (ib >= 0 ? ib : byeCell) && RES.test(x.t)); if (k >= 0) res = c[k].t; }
    res = RES.test(res) ? res.replace(/\s*-\s*/, ' - ') : (ib < 0 && res ? res : '');
    let wc = '', bc = '';
    if (hdr && hdr.clubs.length) {
      const a = hdr.clubs.find(i => i > iw), b = hdr.clubs.find(i => ib >= 0 && i > ib);
      if (a != null && c[a]) wc = c[a].t; if (b != null && c[b]) bc = c[b].t;
    }
    out.push({ bd: c[0].t, w: nm(c[iw].h), wc, b: ib >= 0 ? nm(c[ib].h) : '', bc, res, bye: ib < 0 });
  }
  return out;
}

// Bốc thăm đội: "Số | Đội | Đội | KQ | : | KQ"
function parseTeamPairs(html) {
  const R = rows(html), out = [];
  let hdr = null;
  for (const c of R) {
    const low = c.map(x => x.t.toLowerCase());
    if (!hdr) {
      const d = low.map((x, i) => /^(đội|team|mannschaft)$/.test(x) ? i : -1).filter(i => i >= 0);
      if (d.length >= 2) { hdr = { a: d[0], b: d[1], c: low.indexOf(':') }; }
      continue;
    }
    if (!c[0] || !/^\d+$/.test(c[0].t) || !c[hdr.a] || !c[hdr.b]) continue;
    const w = nm(c[hdr.a].h), b = nm(c[hdr.b].h);
    if (!w) continue;
    const bye = !b || BYE.test(b);
    let res = '';
    const ci = hdr.c >= 0 && c[hdr.c] && c[hdr.c].t === ':' ? hdr.c : c.findIndex((x, i) => i > hdr.b && x.t === ':');
    if (ci > 0 && c[ci - 1] && c[ci + 1] && c[ci - 1].t !== '' && c[ci + 1].t !== '') res = c[ci - 1].t + ' : ' + c[ci + 1].t;
    out.push({ bd: c[0].t, w, wc: '', b: bye ? '' : b, bc: '', res, bye });
  }
  return out;
}

function parseRank(html) {
  const R = rows(html), out = [];
  let hdr = null;
  for (const c of R) {
    const low = c.map(x => x.t.toLowerCase());
    if (!hdr && low.some(x => /^(hạng|rk\.?|rg\.?)$/.test(x)) && low.some(x => /^(điểm|pts\.?|pkt\.?)$/.test(x))) {
      const cl = clubCols(low);
      hdr = { rk: low.findIndex(x => /^(hạng|rk\.?|rg\.?)$/.test(x)), pts: low.findIndex(x => /^(điểm|pts\.?|pkt\.?)$/.test(x)), club: cl.length ? cl[0] : -1 };
      continue;
    }
    if (!hdr) continue;
    const ip = c.findIndex(x => /snr=\d+/.test(x.h));
    if (ip < 0 || !c[hdr.pts]) continue;
    out.push([c[hdr.rk] ? c[hdr.rk].t : '', nm(c[ip].h), hdr.club >= 0 && c[hdr.club] ? c[hdr.club].t : '', c[hdr.pts].t]);
  }
  // chess-results để trống hạng khi đồng hạng -> lấy hạng của dòng trên
  for (let i = 1; i < out.length; i++) if (!out[i][0]) out[i][0] = out[i - 1][0];
  return out;
}

// Xếp hạng đội: "Hạng | Số | Đội | Ván cờ | + | = | - | HS1 | HS2 | HS3" -> [hạng, đội, '+a =b -c', HS1]
function parseTeamRank(html) {
  const R = rows(html), out = [];
  let hdr = null;
  for (const c of R) {
    const low = c.map(x => x.t.toLowerCase());
    if (!hdr) {
      if (low.some(x => /^(hạng|rk\.?)$/.test(x)) && low.some(x => /^(đội|team|mannschaft)$/.test(x))) {
        hdr = { rk: low.findIndex(x => /^(hạng|rk\.?)$/.test(x)), tm: low.findIndex(x => /^(đội|team|mannschaft)$/.test(x)),
          w: low.indexOf('+'), d: low.indexOf('='), l: low.indexOf('-'), hs: low.findIndex(x => /^(hs1|tb1|wtg1)$/.test(x)) };
      }
      continue;
    }
    if (!c[hdr.tm]) continue;
    const name = nm(c[hdr.tm].h);
    if (!name || /^(đội|team)$/i.test(name)) continue;
    const pts = hdr.hs >= 0 && c[hdr.hs] ? c[hdr.hs].t : '';
    const wdl = [hdr.w, hdr.d, hdr.l].every(i => i >= 0 && c[i]) ? '+' + c[hdr.w].t + ' =' + c[hdr.d].t + ' -' + c[hdr.l].t : '';
    out.push([c[hdr.rk] ? c[hdr.rk].t : '', name, wdl, pts]);
  }
  for (let i = 1; i < out.length; i++) if (!out[i][0]) out[i][0] = out[i - 1][0];
  return out;
}

function j(o, status, ttl) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': ttl ? 'public, max-age=' + Math.min(30, ttl) + ', s-maxage=' + ttl : 'no-store'
    }
  });
}
