// Netlify Function: đọc ảnh kết quả cờ tướng bằng Google Gemini, trả về JSON các ván đấu.
// Cần biến môi trường GEMINI_API_KEY trên Netlify. (Tùy chọn GEMINI_MODEL, mặc định gemini-2.0-flash)
export default async (req) => {
  if (req.method !== 'POST') return j({ error: 'Chỉ nhận POST' }, 405);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return j({ error: 'Chưa cấu hình GEMINI_API_KEY trên Netlify.' });
  let body;
  try { body = await req.json(); } catch (e) { return j({ error: 'Dữ liệu không hợp lệ' }); }
  const image = body && body.image;
  const mime = (body && body.mime) || 'image/jpeg';
  const players = (body && body.players) || [];
  if (!image) return j({ error: 'Thiếu ảnh' });

  const plist = players.join(', ');
  const prompt =
`Đây là ảnh ghi kết quả một vòng đấu cờ tướng (có thể là bảng in hoặc biên bản viết tay).
Hãy trích xuất danh sách các ván đấu trong ảnh.
Danh sách kỳ thủ đã đăng ký (hãy khớp tên đọc được với tên gần nhất trong danh sách này khi có thể): ${plist}.
Chỉ trả về DUY NHẤT một JSON hợp lệ, KHÔNG kèm giải thích, theo đúng dạng:
{"games":[{"a":"Tên kỳ thủ bên trái","b":"Tên kỳ thủ bên phải","kq":"a"}]}
Trong đó kq là: "a" nếu bên A thắng, "b" nếu bên B thắng, "hoa" nếu hòa, "none" nếu chưa có kết quả.`;

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const payload = {
    contents: [{ parts: [ { text: prompt }, { inline_data: { mime_type: mime, data: image } } ] }],
    generationConfig: { temperature: 0, response_mime_type: 'application/json' }
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) return j({ error: (d && d.error && d.error.message) || ('Lỗi AI (' + r.status + ')') });
    let txt = '';
    try { txt = d.candidates[0].content.parts[0].text || ''; } catch (e) { txt = ''; }
    let parsed;
    try { parsed = JSON.parse(txt); }
    catch (e) { const m = txt.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { games: [] }; }
    return j({ games: (parsed && parsed.games) || [] });
  } catch (e) {
    return j({ error: 'Không gọi được AI: ' + e.message });
  }
};
function j(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } }); }
