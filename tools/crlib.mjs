// Bộ đọc bảng Chess-Results (dùng chung logic với functions/api/cr.js)
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

export { txt, parsePairs, parseTeamPairs, parseRank, parseTeamRank };
