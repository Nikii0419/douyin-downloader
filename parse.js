export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const input = String(req.body?.text || "").trim();
    if (!input) return res.status(400).json({ error: "请提供抖音分享链接。" });

    const urls = input.match(/https?:\/\/[^\s，。]+/g) || [];
    const candidate = urls.find(u => /douyin\.com|iesdouyin\.com/i.test(u));
    if (!candidate) return res.status(400).json({ error: "没有识别到有效的抖音链接，请复制完整分享文案或链接。" });

    const parsed = new URL(candidate);
    if (!/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/i.test(parsed.hostname))
      return res.status(400).json({ error: "仅支持抖音链接。" });

    const redirect = await fetch(candidate, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }
    });
    const finalUrl = redirect.url || candidate;
    let awemeId = finalUrl.match(/\/(?:video|note)\/(\d+)/)?.[1]
      || finalUrl.match(/[?&]modal_id=(\d+)/)?.[1]
      || input.match(/(?:视频|作品)?\s*(\d{15,20})/)?.[1];

    if (!awemeId) {
      const html = await redirect.text();
      awemeId = html.match(/"aweme_id"\s*:\s*"(\d+)"/)?.[1]
        || html.match(/\/video\/(\d+)/)?.[1];
    }
    if (!awemeId) return res.status(422).json({ error: "无法从该分享链接提取视频 ID。链接可能已失效、作品不可见或抖音风控拦截。" });

    const api = "https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=" + encodeURIComponent(awemeId);
    const detailRes = await fetch(api, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://www.douyin.com/"
      }
    });
    if (!detailRes.ok) throw new Error("抖音接口暂时无法访问，请稍后重试。");
    const json = await detailRes.json();
    const item = json.item_list?.[0];
    if (!item) throw new Error("抖音未返回视频数据，可能需要更新解析规则。");

    const video = item.video || {};
    const rawUrl = video.play_addr?.url_list?.[0] || video.download_addr?.url_list?.[0];
    if (!rawUrl) throw new Error("没有获取到视频地址，该作品可能受到访问限制。");

    // Prefer the play endpoint over playwm where the upstream URL uses that path.
    const videoUrl = rawUrl.replace("/playwm/", "/play/");
    return res.status(200).json({
      videoUrl,
      description: item.desc || "抖音视频",
      author: item.author?.nickname || "",
      cover: video.cover?.url_list?.[0] || video.origin_cover?.url_list?.[0] || ""
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || "解析服务暂时不可用。" });
  }
}