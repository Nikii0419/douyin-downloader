
function extractRouterData(html) {
  const idx = html.indexOf("_ROUTER_DATA");
  if (idx < 0) return null;

  const eq = html.indexOf("=", idx);
  if (eq < 0) return null;

  const start = html.indexOf("{", eq);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const c = html[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
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

function firstUrl(obj) {
  const urls = obj?.url_list || [];
  const url = urls.find(
    u => typeof u === "string" && /^https?:|^\/\//i.test(u)
  );

  if (!url) return "";
  return url.startsWith("//") ? "https:" + url : url;
}

function findAweme(data) {
  const loaderData = data?.loaderData || {};
  const diagnostics = [];

  // 优先按抖音分享页的真实数据结构提取
  for (const [key, page] of Object.entries(loaderData)) {
    const result = page?.videoInfoRes;
    const items = result?.item_list || [];

    if (items.length) {
      return { item: items[0], diagnostics };
    }

    diagnostics.push({
      key,
      fields: Object.keys(page || {}),
      status: result?.status_code ?? null
    });
  }

  // 兼容其他嵌套结构
  const seen = new Set();
  const stack = [data];

  while (stack.length) {
    const obj = stack.pop();

    if (!obj || typeof obj !== "object" || seen.has(obj)) continue;
    seen.add(obj);

    if (
      obj.aweme_id &&
      (
        obj.video ||
        (Array.isArray(obj.images) && obj.images.length)
      )
    ) {
      return { item: obj, diagnostics };
    }

    if (Array.isArray(obj)) {
      stack.push(...obj);
    } else {
      stack.push(...Object.values(obj));
    }
  }

  return { item: null, diagnostics };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "只支持 POST 请求。" });
  }

  try {
    const input = String(req.body?.text || "").trim();

    if (!input) {
      return res.status(400).json({ error: "请提供抖音分享链接。" });
    }

    const urls = input.match(/https?:\/\/[^\s，。]+/g) || [];
    const candidate = urls.find(u =>
      /douyin\.com|iesdouyin\.com/i.test(u)
    );

    if (!candidate) {
      return res.status(400).json({ error: "没有识别到有效的抖音链接。" });
    }

    const parsed = new URL(candidate);

    if (!/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/i.test(parsed.hostname)) {
      return res.status(400).json({ error: "仅支持抖音链接。" });
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Referer": "https://www.douyin.com/",
      "Accept": "text/html,application/xhtml+xml,application/json,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9"
    };

    const redirect = await fetch(candidate, {
      redirect: "follow",
      headers
    });

    if (!redirect.ok) {
      throw new Error(`分享链接访问失败，HTTP ${redirect.status}`);
    }

    const finalUrl = redirect.url || candidate;

    let awemeId =
      finalUrl.match(/\/(?:video|note|slides)\/(\d+)/)?.[1] ||
      finalUrl.match(/[?&](?:modal_id|aweme_id|item_ids)=(\d+)/)?.[1] ||
      input.match(/(?:视频|作品)?\s*(\d{15,20})/)?.[1];

    const initialHtml = await redirect.text();

    if (!awemeId) {
      awemeId =
        initialHtml.match(/"aweme_id"\s*:\s*"(\d+)"/)?.[1] ||
        initialHtml.match(/\/(?:video|note|slides)\/(\d+)/)?.[1];
    }

    if (!awemeId) {
      throw new Error("无法获取作品 ID，请确认分享链接有效。");
    }

    const path = new URL(finalUrl).pathname;
    const kind = /\/(?:note|slides)\//.test(path) ? "note" : "video";

    const sharePage =
      `https://www.iesdouyin.com/share/${kind}/${awemeId}/`;

    const pageRes = await fetch(sharePage, {
      redirect: "follow",
      headers
    });

    if (!pageRes.ok) {
      throw new Error(`作品页面访问失败，HTTP ${pageRes.status}`);
    }

    const html = await pageRes.text();

    if (!html || html.length < 100) {
      throw new Error("抖音返回的作品页面内容为空。");
    }

    const routerData = extractRouterData(html);

    if (!routerData) {
      throw new Error("没有找到页面作品数据，可能触发抖音访问限制。");
    }

    const found = findAweme(routerData);
    const item = found.item;

    if (!item) {
      console.error("Douyin loaderData diagnostics:", found.diagnostics);
      throw new Error(
        "没有找到作品详情。抖音页面数据结构可能已变化，或当前访问受到限制。"
      );
    }

    const images = (item.images || [])
      .map(image => firstUrl(image))
      .filter(Boolean);

    const video = item.video || {};
    const rawVideo =
      firstUrl(video.play_addr) ||
      firstUrl(video.download_addr);

    if (images.length > 0) {
      return res.status(200).json({
        type: "images",
        description: item.desc || "抖音图文作品",
        author: item.author?.nickname || "",
        cover: firstUrl(video.cover) || images[0],
        images
      });
    }

    if (rawVideo) {
      return res.status(200).json({
        type: "video",
        videoUrl: rawVideo.replace("/playwm/", "/play/"),
        description: item.desc || "抖音视频",
        author: item.author?.nickname || "",
        cover:
          firstUrl(video.cover) ||
          firstUrl(video.origin_cover) ||
          ""
      });
    }

    throw new Error("已找到作品，但没有获取到可下载的视频或图片地址。");

  } catch (e) {
    console.error("Douyin parse error:", e);

    return res.status(502).json({
      error: e.message || "解析服务暂时不可用，请稍后重试。"
    });
  }
}
