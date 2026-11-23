// Đọc kết quả Chess-Results cho các giải trong data/cr/list.json -> ghi data/cr/<mã>.json
// Chạy bằng GitHub Actions (5 phút/lần trong giờ thi đấu). App đọc file qua raw.githubusercontent.com.
// Vòng đã có đủ kết quả thì giữ nguyên, không đọc lại (đỡ tải cho Chess-Results).
import fs from 'fs';
import { txt, parsePairs, parseTeamPairs, parseRank, parseTeamRank } from './crlib.mjs';
const UA = 'Mozilla/5.0 (compatible; LienDoanCoGiaLai-app/1.0; +https://cup-dai-phu-gia.pages.dev/ld)';
const HOSTS = ['chess-results.com', 's1.chess-results.com', 's2.chess-results.com'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(t, q) {
  let last = '';
  for (const h of HOSTS) {
    for (let k = 0; k < 2; k++) {
      try {
        const r = await fetch('https://' + h + '/tnr' + t + '.aspx?lan=29&SNode=S0&' + q, { headers: { 'user-agent': UA, 'accept-language': 'vi,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
        if (r.ok) { await sleep(400); return await r.text(); }
        last = 'HTTP ' + r.status + ' ' + h;
      } catch (e) { last = (e && e.message) + ' ' + h; }
      await sleep(1500);
    }
  }
  throw new Error(last);
}
const LIST = JSON.parse(fs.readFileSync('data/cr/list.json', 'utf8'));
const now = Date.now(), force = process.argv.includes('--all');
let changed = 0;
for (const it of LIST) {
  const t = String(it.t);
  const from = Date.parse(it.from + 'T00:00:00+07:00') - 86400000, to = Date.parse(it.to + 'T23:59:59+07:00') + 86400000;
  if (!force && (now < from || now > to)) continue;
  const file = 'data/cr/' + t + '.json';
  let old = null; try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  try {
    const base = await get(t, 'art=0');
    const team = /<t[hd][^>]*>\s*(?:<[^>]+>\s*)*Đội\s*(?:<\/[^>]+>\s*)*<\/t[hd]>/i.test(base) && /HS1|Ván cờ|Matchpoints/i.test(base);
    const rds = new Set();
    for (const m of base.matchAll(/art=2(?:&amp;|&)rd=(\d+)/g)) rds.add(+m[1]);
    for (const m of base.matchAll(/art=[01](?:&amp;|&)rd=(\d+)/g)) rds.add(+m[1]);
    let maxR = Math.min(15, Math.max(0, ...rds));
    const tot = base.match(/V\d+\s*\/\s*(\d+)/);
    const n = Math.max(maxR, tot ? +tot[1] : 0);
    const rounds = {}, rank = {};
    let prevSig = '';
    for (let r = 1; r <= maxR; r++) {
      const o = old && old.rounds && old.rounds[r];
      if (o && o.done && old.team === team && (old.rank && old.rank[r])) { rounds[r] = o; rank[r] = old.rank[r]; prevSig = o.pairs.map(p => p.w + '|' + p.b).join(';'); continue; }
      const html = await get(t, 'art=2&rd=' + r);
      const lab = html.match(/(\d+)\.\s*(?:Ván|Round|Runde)\b/i);
      if (lab && +lab[1] !== r) continue;
      const pairs = team ? parseTeamPairs(html) : parsePairs(html);
      const sig = pairs.map(p => p.w + '|' + p.b).join(';');
      if (!pairs.length || sig === prevSig) continue;
      prevSig = sig;
      const res = pairs.filter(p => p.res).length;
      rounds[r] = { pairs, res, done: pairs.every(p => p.res || p.bye) };
      if (res > 0) {
        const L = team ? parseTeamRank(await get(t, 'art=0&rd=' + r)) : parseRank(await get(t, 'art=1&rd=' + r));
        if (L.length) rank[r] = L; else rounds[r].done = false;
      }
    }
    const title = (base.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1];
    const out = { t, ten: it.ten || '', title: title ? txt(title) : '', team, n, rounds, rank };
    const sameAsOld = old && JSON.stringify({ ...old, at: 0 }) === JSON.stringify({ ...out, at: 0 });
    if (sameAsOld) { console.log(t, 'không đổi'); continue; }
    out.at = now;
    fs.writeFileSync(file, JSON.stringify(out));
    changed++;
    console.log(t, 'cập nhật: vòng', Object.keys(rounds).join(','), '| xếp hạng', Object.keys(rank).join(','));
  } catch (e) {
    console.log(t, 'LỖI', e.message);
  }
}
console.log('Số file thay đổi:', changed);
