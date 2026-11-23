
function extractRouterData(html) {
  const marker = "window._ROUTER_DATA";
  const markerIndex = html.indexOf(marker);

  if (markerIndex === -1) return null;

  const start = html.indexOf("{", markerIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;

      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function findVideoItem(data) {
  if (!data || typeof data !== "object") return null;

  // 优先从抖音页面的 loaderData 中提取
  const loaderData = data.loaderData || {};

  for (const [key, value] of Object.entries(loaderData)) {
    if (
      /^(video|note)_/.test(key) &&
      value?.videoInfoRes?.item_list?.[0]
    ) {
      return value.videoInfoRes.item_list[0];
    }
  }

  // 兼容其他页面数据结构
  const visited = new Set();
  const stack = [data];

  while (stack.length) {
    const current = stack.pop();

    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current.item_list) && current.item_list[0]?.video) {
      return current.item_list[0];
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return null;
}

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

    const urls = input.match(/https?:\/\/[^\s，。]+/g) || [];
    const candidate = urls.find(url =>
      /douyin\.com|iesdouyin\.com/i.test(url)
    );

    if (!candidate) {
      return res.status(400).json({
        error: "没有识别到有效的抖音链接。"
      });
    }

    const parsed = new URL(candidate);

    if (!/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/i.test(parsed.hostname)) {
      return res.status(400).json({
        error: "仅支持抖音链接。"
      });
    }

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Referer": "https://www.douyin.com/",
      "Accept": "text/html,application/xhtml+xml,application/json,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9"
    };

    // 第一步：跟踪分享短链接
    const redirect = await fetch(candidate, {
      method: "GET",
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
      finalUrl.match(/\/(?:video|note|share\/video)\/(\d+)/)?.[1] ||
      finalUrl.match(/[?&](?:modal_id|aweme_id)=(\d+)/)?.[1] ||
      input.match(/(?:视频|作品)?\s*(\d{15,20})/)?.[1];

    // 第二步：如果 URL 中没有 ID，从分享页 HTML 提取
    const initialHtml = await redirect.text();

    if (!awemeId) {
      awemeId =
        initialHtml.match(/"aweme_id"\s*:\s*"(\d+)"/)?.[1] ||
        initialHtml.match(/\/video\/(\d+)/)?.[1] ||
        initialHtml.match(/modal_id["']?\s*[:=]\s*["']?(\d+)/)?.[1];
    }

    if (!awemeId) {
      throw new Error(
        "无法获取视频 ID。请确认作品公开且分享链接有效。"
      );
    }

    // 第三步：请求抖音 SSR 分享页面
    const sharePage =
      `https://www.iesdouyin.com/share/video/${awemeId}/?from_ssr=1`;

    const pageRes = await fetch(sharePage, {
      method: "GET",
      redirect: "follow",
      headers
    });

    if (!pageRes.ok) {
      throw new Error(
        `抖音视频页面访问失败，HTTP ${pageRes.status}`
      );
    }

    const html = await pageRes.text();

    if (!html || html.length < 100) {
      throw new Error(
        "抖音返回的分享页面内容为空，可能触发访问限制。"
      );
    }

    // 第四步：提取页面内嵌数据
    const routerData = extractRouterData(html);

    if (!routerData) {
      throw new Error(
        "没有找到抖音视频页面数据（_ROUTER_DATA），可能受到访问限制或页面结构已变化。"
      );
    }

    const item = findVideoItem(routerData);

    if (!item) {
      throw new Error(
        "页面已打开，但没有找到视频详情。作品可能已删除、设为私密，或页面数据结构已变化。"
      );
    }

    // 第五步：提取视频地址
    const video = item.video || {};

    const rawUrl =
      video.play_addr?.url_list?.[0] ||
      video.download_addr?.url_list?.[0];

    if (!rawUrl) {
      throw new Error(
        "已找到视频信息，但没有获取到视频播放地址。"
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
