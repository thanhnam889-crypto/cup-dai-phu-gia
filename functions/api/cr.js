// Cloudflare Pages Function: đọc Bốc thăm / Kết quả / Xếp hạng từ Chess-Results cho app.
// Route: /api/cr?t=<mã giải tnr>   (vd t=1541784 Cờ tướng, t=1541790 Cờ tướng úp)
// Trả JSON: {t, at, rounds:{"1":{pairs:[{bd,w,wc,b,bc,res,bye}],res:n}}, rank:{"1":[[hạng,tên,clb,điểm]]}}
// Kết quả được lưu đệm 60 giây ở máy chủ Cloudflare để không gọi Chess-Results quá nhiều.
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const TTL = 60;

export async function onRequestGet(context) {
  const { request } = context;
  const u = new URL(request.url);
  const t = (u.searchParams.get('t') || '').trim();
  if (!/^\d{5,9}$/.test(t)) return j({ error: 'Thiếu mã giải (t)' }, 400);
  const cache = caches.default;
  const key = new Request('https://cr-cache.local/v3/' + t);
  if (!u.searchParams.has('fresh')) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  try {
    const base = await get(t, 'art=0');
    const rds = new Set();
    for (const m of base.matchAll(/art=2(?:&amp;|&)rd=(\d+)/g)) rds.add(+m[1]);
    for (const m of base.matchAll(/art=1(?:&amp;|&)rd=(\d+)/g)) rds.add(+m[1]);
    let maxR = Math.max(0, ...rds);
    if (maxR > 15) maxR = 15;
    const list = []; for (let r = 1; r <= maxR; r++) list.push(r);
    const pairPages = await Promise.all(list.map(r => get(t, 'art=2&rd=' + r).catch(() => '')));
    const rounds = {};
    let prevSig = '';
    list.forEach((r, i) => {
      const html = pairPages[i];
      // Chess-Results có thể trả về trang của vòng khác khi vòng r chưa xếp cặp -> kiểm tra nhãn "r. Ván"/"Round r"
      const lab = html.match(/(\d+)\.\s*(?:Ván|Round|Runde)\b/i);
      if (lab && +lab[1] !== r) return;
      const pairs = parsePairs(html);
      const sig = pairs.map(p => p.w + '|' + p.b).join(';');
      if (!pairs.length || sig === prevSig) return; // trùng hệt vòng trước = chưa có vòng này
      prevSig = sig;
      rounds[r] = { pairs, res: pairs.filter(p => p.res).length };
    });
    const rankR = list.filter(r => rounds[r] && rounds[r].res > 0);
    const rankPages = await Promise.all(rankR.map(r => get(t, 'art=1&rd=' + r).catch(() => '')));
    const rank = {};
    rankR.forEach((r, i) => { const L = parseRank(rankPages[i]); if (L.length) rank[r] = L; });
    const title = (base.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1];
    const out = { t, at: Date.now(), title: title ? txt(title) : '', rounds, rank };
    const res = j(out, 200, TTL);
    context.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return j({ error: 'Không đọc được Chess-Results: ' + (e && e.message || e) }, 502);
  }
}

async function get(t, q) {
  const url = 'https://chess-results.com/tnr' + t + '.aspx?lan=29&' + q;
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'vi,en;q=0.8' }, redirect: 'follow', cf: { cacheTtl: 30 } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.text();
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

function parsePairs(html) {
  const R = rows(html), out = [];
  let hdr = null;
  for (const c of R) {
    const low = c.map(x => x.t.toLowerCase());
    if (!hdr && low.some(x => /kết quả|result|ergebnis/.test(x)) && low.some(x => /^(white|trắng|weiß)$/.test(x))) {
      hdr = { bd: 0, res: low.findIndex(x => /kết quả|result|ergebnis/.test(x)) };
      hdr.clubs = low.map((x, i) => /clb|club|verein/.test(x) ? i : -1).filter(i => i >= 0);
      continue;
    }
    const pl = c.map((x, i) => /snr=\d+/.test(x.h) ? i : -1).filter(i => i >= 0);
    if (!pl.length || !/^\d+$/.test(c[0].t)) continue;
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
    out.push({ bd: +c[0].t, w: nm(c[iw].h), wc, b: ib >= 0 ? nm(c[ib].h) : '', bc, res, bye: ib < 0 });
  }
  return out;
}

function parseRank(html) {
  const R = rows(html), out = [];
  let hdr = null;
  for (const c of R) {
    const low = c.map(x => x.t.toLowerCase());
    if (!hdr && low.some(x => /^(hạng|rk\.?|rg\.?)$/.test(x)) && low.some(x => /^(điểm|pts\.?|pkt\.?)$/.test(x))) {
      hdr = { rk: low.findIndex(x => /^(hạng|rk\.?|rg\.?)$/.test(x)), pts: low.findIndex(x => /^(điểm|pts\.?|pkt\.?)$/.test(x)), club: low.findIndex(x => /clb|club|verein/.test(x)) };
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
