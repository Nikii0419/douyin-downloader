export default async function handler(req, res) {
  try {
    const raw = String(req.query.url || "");
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const allowed = /(^|\.)douyinvod\.com$|(^|\.)douyinpic\.com$|(^|\.)snssdk\.com$|(^|\.)bytecdn\.cn$|(^|\.)zjcdn\.com$|(^|\.)douyin\.com$/;
    if (u.protocol !== "https:" || !allowed.test(host)) return res.status(400).send("Invalid video URL");

    const upstream = await fetch(u.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://www.douyin.com/",
        ...(req.headers.range ? { "Range": req.headers.range } : {})
      }
    });
    if (!upstream.ok && upstream.status !== 206) return res.status(upstream.status).send("视频源暂时无法访问，请重新解析。");

    res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    if (upstream.headers.get("content-length")) res.setHeader("Content-Length", upstream.headers.get("content-length"));
    if (upstream.headers.get("content-range")) res.setHeader("Content-Range", upstream.headers.get("content-range"));
    res.status(upstream.status);
    const inline = req.query.inline === "1";
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="douyin-video.mp4"`);
    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(502).send("下载失败：" + (e.message || "网络错误"));
    else res.end();
  }
}