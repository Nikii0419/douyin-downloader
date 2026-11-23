
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const BASE_HEADERS = {
  "User-Agent": MOBILE_UA,
  "Referer": "https://www.iesdouyin.com/",
  "Accept": "text/html,application/xhtml+xml,application/json,*/*",
  "Accept-Language": "zh-CN,zh;q=0.9"
};

// 提取 ttwid 游客 Cookie
async function getTtwid() {
  const response = await fetch(
    "https://ttwid.bytedance.com/ttwid/union/register/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": MOBILE_UA,
        "Referer": "https://www.douyin.com/"
      },
      body: JSON.stringify({
        region: "cn",
        aid: 1768,
        needFid: false,
        service: "www.douyin.com",
        migrate_info: {
          ticket: "",
          source: "node"
        },
        cbUrlProtocol: "https",
        union: true
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  const cookieHeaders =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") || ""];

  for (const header of cookieHeaders) {
    const match = header.match(/(?:^|[,;\s])ttwid=([^;,\s]+)/i);
    if (match) return match[1];
  }

  return "";
}

// 提取页面中的 JSON
function extractRouterData(html) {
  const markers = [
    "_ROUTER_DATA",
    "__UNIVERSAL_DATA_FOR_REHYDRATION__"
  ];

  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx < 0) continue;

    const start = html.indexOf("{", idx);
    if (start < 0) continue;

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
            break;
          }
        }
      }
    }
  }

  return null;
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";

  let url = value.trim();

  if (url.startsWith("//")) {
    url = "https:" + url;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function getUrlList(value) {
  if (!value) return [];

  if (typeof value === "string") {
    const url = normalizeUrl(value);
    return url ? [url] : [];
  }

  if (Array.isArray(value)) {
    return [...new Set(value.flatMap(getUrlList))];
  }

  if (typeof value === "object") {
    const result = [];

    if (value.url_list) {
      result.push(...getUrlList(value.url_list));
    }

    if (value.url) {
      result.push(...getUrlList(value.url));
    }

    if (typeof value.uri === "string") {
      const url = normalizeUrl(value.uri);
      if (url) result.push(url);
    }

    return [...new Set(result)];
  }

  return [];
}

function getOriginalImageUrl(image) {
  if (!image || typeof image !== "object") {
    return normalizeUrl(image);
  }

  const candidates = [
    image.download_url_list,
    image.download_url,
    image.origin_image,
    image.origin_image_url,
    image.origin_image_info,
    image.url_list
  ];

  for (const candidate of candidates) {
    const urls = getUrlList(candidate);
    if (urls.length) return urls[0];
  }

  const fallback = [
    image.display_image,
    image.display_image_url,
    image.image_url
  ];

  for (const candidate of fallback) {
    const urls = getUrlList(candidate);
    if (urls.length) return urls[0];
  }

  return "";
}

function firstUrl(obj) {
  const urls = getUrlList(obj);
  return urls[0] || "";
}

function findAweme(data) {
  const seen = new Set();
  const stack = [data];

  while (stack.length) {
    const obj = stack.pop();

    if (!obj || typeof obj !== "object" || seen.has(obj)) {
      continue;
    }

    seen.add(obj);

    if (Array.isArray(obj)) {
      stack.push(...obj);
      continue;
    }

    const items = obj.videoInfoRes?.item_list;

    if (Array.isArray(items) && items.length) {
      return items[0];
    }

    if (
      obj.aweme_id &&
      (
        obj.video ||
        obj.images ||
        obj.image_post_info
      )
    ) {
      return obj;
    }

    stack.push(...Object.values(obj));
  }

  return null;
}

function findAwemeId(data, html, finalUrl) {
  const fromUrl =
    finalUrl.match(/\/(?:video|note|slides)\/(\d+)/)?.[1] ||
    finalUrl.match(/[?&](?:modal_id|aweme_id|item_ids)=(\d+)/)?.[1];

  if (fromUrl) return fromUrl;

  const fromHtml =
    html.match(/"aweme_id"\s*:\s*"(\d+)"/)?.[1] ||
    html.match(/"itemId"\s*:\s*"(\d+)"/)?.[1] ||
    html.match(/"lastPath"\s*:\s*"(\d+)"/)?.[1];

  if (fromHtml) return fromHtml;

  const seen = new Set();
  const stack = [data];

  while (stack.length) {
    const obj = stack.pop();

    if (!obj || typeof obj !== "object" || seen.has(obj)) {
      continue;
    }

    seen.add(obj);

    if (!Array.isArray(obj)) {
      const id = obj.itemId || obj.lastPath || obj.aweme_id;

      if (typeof id === "string" && /^\d{15,25}$/.test(id)) {
        return id;
      }

      stack.push(...Object.values(obj));
    } else {
      stack.push(...obj);
    }
  }

  return "";
}

async function fetchSharePage(url, cookie) {
  const headers = { ...BASE_HEADERS };

  if (cookie) {
    headers.Cookie = "ttwid=" + cookie;
  }

  return fetch(url, {
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(25000)
  });
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

    // 第一步：访问分享短链接，获取作品 ID
    const redirect = await fetch(candidate, {
      redirect: "follow",
      headers: BASE_HEADERS,
      signal: AbortSignal.timeout(25000)
    });

    if (!redirect.ok) {
      throw new Error(
        `分享链接访问失败，HTTP ${redirect.status}`
      );
    }

    const finalUrl = redirect.url || candidate;
    const initialHtml = await redirect.text();

    let routerData = extractRouterData(initialHtml);

    let awemeId = findAwemeId(
      routerData,
      initialHtml,
      finalUrl
    );

    if (!awemeId) {
      awemeId =
        finalUrl.match(/\/(?:video|note|slides)\/(\d+)/)?.[1] ||
        initialHtml.match(/\/(?:video|note|slides)\/(\d+)/)?.[1];
    }

    if (!awemeId) {
      throw new Error(
        "无法识别作品 ID，请重新复制抖音分享链接。"
      );
    }

    const path = new URL(finalUrl).pathname;
    const kind = /\/(?:note|slides)\//.test(path)
      ? "note"
      : "video";

    const sharePage =
      `https://www.iesdouyin.com/share/${kind}/${awemeId}/`;

    // 第二步：申请游客 Cookie
    let ttwid = "";

    try {
      ttwid = await getTtwid();
    } catch (e) {
      console.error("ttwid registration failed:", e.message);
    }

    // 第三步：携带 Cookie 请求作品页面
    let pageRes = await fetchSharePage(sharePage, ttwid);
    let html = await pageRes.text();

    if (!pageRes.ok) {
      throw new Error(
        `作品页面访问失败，HTTP ${pageRes.status}`
      );
    }

    routerData = extractRouterData(html);
    let item = findAweme(routerData);

    // 第四步：如果第一次没有详情，重新申请 Cookie 再试一次
    if (!item) {
      try {
        const newCookie = await getTtwid();

        if (newCookie) {
          ttwid = newCookie;
        }
      } catch (e) {
        console.error("ttwid retry failed:", e.message);
      }

      pageRes = await fetchSharePage(sharePage, ttwid);
      html = await pageRes.text();

      if (!pageRes.ok) {
        throw new Error(
          `作品页面重试失败，HTTP ${pageRes.status}`
        );
      }

      routerData = extractRouterData(html);
      item = findAweme(routerData);
    }

    if (!item) {
      console.error(
        "Douyin page diagnostic:",
        {
          awemeId,
          htmlLength: html.length,
          hasRouterData: !!routerData,
          hasVideoInfoRes: html.includes("videoInfoRes"),
          hasItemList: html.includes("item_list"),
          hasTtwid: !!ttwid
        }
      );

      throw new Error(
        "抖音已返回页面，但仍未提供作品详情。可能是作品权限限制或平台风控，请稍后重试。"
      );
    }

    // 图文作品
    const imageObjects =
      item.images ||
      item.image_post_info?.images ||
      [];

    const images = imageObjects
      .map(getOriginalImageUrl)
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

    throw new Error(
      "已经找到作品详情，但没有获取到可用的视频或图片地址。"
    );

  } catch (e) {
    console.error("Douyin parse error:", e);

    return res.status(502).json({
      error: e.message || "解析服务暂时不可用，请稍后重试。"
    });
  }
}
