// Vercel Serverless Function (chạy ở Mỹ - iad1) — đọc ảnh kết quả cờ tướng bằng Google Gemini.
// Vì chạy ở Mỹ nên KHÔNG bị Gemini chặn vùng châu Á như Cloudflare.
// Cần biến môi trường GEMINI_API_KEY trên Vercel. (Tùy chọn GEMINI_MODEL, mặc định gemini-3.8-flash)
// App (ở Cloudflare) gọi sang đây theo kiểu cross-origin nên có xử lý CORS + preflight OPTIONS.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Chỉ nhận POST' }); return; }

  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(200).json({ error: 'Chưa cấu hình GEMINI_API_KEY trên Vercel.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  if (!body) body = {};
  const image = body.image;
  const mime = body.mime || 'image/jpeg';
  const players = body.players || [];
  if (!image) { res.status(200).json({ error: 'Thiếu ảnh' }); return; }

  const plist = players.join(', ');
  const prompt =
`Đây là ảnh ghi kết quả một vòng đấu cờ tướng (có thể là bảng in hoặc biên bản viết tay).
Hãy trích xuất danh sách các ván đấu trong ảnh.
Danh sách kỳ thủ đã đăng ký (hãy khớp tên đọc được với tên gần nhất trong danh sách này khi có thể): ${plist}.
Chỉ trả về DUY NHẤT một JSON hợp lệ, KHÔNG kèm giải thích, theo đúng dạng:
{"games":[{"a":"Tên kỳ thủ bên trái","b":"Tên kỳ thủ bên phải","kq":"a"}]}
Trong đó kq là: "a" nếu bên A thắng, "b" nếu bên B thắng, "hoa" nếu hòa, "none" nếu chưa có kết quả.`;

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const payload = {
    contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: mime, data: image } } ] }],
    generationConfig: { temperature: 0, response_mime_type: 'application/json' }
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) { res.status(200).json({ error: (d && d.error && d.error.message) || ('Lỗi AI (' + r.status + ')') }); return; }
    let txt = '';
    try { txt = d.candidates[0].content.parts[0].text || ''; } catch (e) { txt = ''; }
    let parsed;
    try { parsed = JSON.parse(txt); }
    catch (e) { const m = txt.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { games: [] }; }
    res.status(200).json({ games: (parsed && parsed.games) || [] });
  } catch (e) {
    res.status(200).json({ error: 'Không gọi được AI: ' + e.message });
  }
}
