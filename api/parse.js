
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "只支持 POST 请求。"
    });
  }

  try {
    const input = String(req.body?.text || "").trim();

    if (!input) {
      return res.status(400).json({
        error: "请提供抖音分享链接。"
      });
    }

    // 提取抖音链接
    const urls = input.match(/https?:\/\/[^\s，。]+/g) || [];
    const candidate = urls.find(u =>
      /douyin\.com|iesdouyin\.com/i.test(u)
    );

    if (!candidate) {
      return res.status(400).json({
        error: "没有识别到有效的抖音链接，请复制完整分享文案或链接。"
      });
    }

    const parsed = new URL(candidate);

    if (!/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/i.test(parsed.hostname)) {
      return res.status(400).json({
        error: "仅支持抖音链接。"
      });
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Referer": "https://www.douyin.com/",
      "Accept": "text/html,application/json,*/*"
    };

    // 获取分享链接跳转地址
    const redirect = await fetch(candidate, {
      redirect: "follow",
      headers
    });

    if (!redirect.ok) {
      throw new Error(
        `抖音分享链接访问失败，HTTP ${redirect.status}`
      );
    }

    const finalUrl = redirect.url || candidate;

    let awemeId =
      finalUrl.match(/\/(?:video|note)\/(\d+)/)?.[1] ||
      finalUrl.match(/[?&]modal_id=(\d+)/)?.[1] ||
      input.match(/(?:视频|作品)?\s*(\d{15,20})/)?.[1];

    // 如果跳转地址没有 ID，从网页内容提取
    if (!awemeId) {
      const html = await redirect.text();

      awemeId =
        html.match(/"aweme_id"\s*:\s*"(\d+)"/)?.[1] ||
        html.match(/\/video\/(\d+)/)?.[1] ||
        html.match(/itemId["']?\s*[:=]\s*["']?(\d+)/)?.[1];
    }

    if (!awemeId) {
      throw new Error(
        "无法提取视频 ID。请检查链接是否有效，作品是否公开，或是否受到抖音访问限制。"
      );
    }

    // 请求抖音视频信息
    const api =
      "https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=" +
      encodeURIComponent(awemeId);

    const detailRes = await fetch(api, {
      headers
    });

    const responseText = await detailRes.text();

    if (!detailRes.ok) {
      throw new Error(
        `抖音视频接口请求失败，HTTP ${detailRes.status}。`
      );
    }

    if (!responseText || !responseText.trim()) {
      throw new Error(
        "抖音视频接口返回了空内容，可能受到访问限制或接口暂时不可用。"
      );
    }

    // 解析 JSON，兼容部分 JSONP 格式
    let json;

    try {
      json = JSON.parse(responseText);
    } catch {
      const jsonp = responseText.match(
        /^[^(]*\(([\s\S]*)\);?\s*$/
      );

      if (jsonp) {
        try {
          json = JSON.parse(jsonp[1]);
        } catch {
          throw new Error(
            "抖音接口返回的数据格式异常，可能触发了风控。"
          );
        }
      } else {
        throw new Error(
          "抖音接口返回的不是有效 JSON，可能触发了风控或接口已变更。"
        );
      }
    }

    const item = json.item_list?.[0];

    if (!item) {
      throw new Error(
        "没有获取到视频信息。作品可能已删除、设为私密，或抖音接口规则已变化。"
      );
    }

    const video = item.video || {};

    const rawUrl =
      video.play_addr?.url_list?.[0] ||
      video.download_addr?.url_list?.[0];

    if (!rawUrl) {
      throw new Error(
        "没有获取到视频播放地址，该作品可能受到访问限制。"
      );
    }

    const videoUrl = rawUrl.replace("/playwm/", "/play/");

    return res.status(200).json({
      videoUrl,
      description: item.desc || "抖音视频",
      author: item.author?.nickname || "",
      cover:
        video.cover?.url_list?.[0] ||
        video.origin_cover?.url_list?.[0] ||
        ""
    });

  } catch (e) {
    console.error("Douyin parse error:", e);

    return res.status(502).json({
      error: e.message || "解析服务暂时不可用，请稍后重试。"
    });
  }
}
