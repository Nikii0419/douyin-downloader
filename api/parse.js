
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

// 获取图文原图地址
function getOriginalImageUrl(image) {
  if (!image || typeof image !== "object") {
    return normalizeUrl(image);
  }

  const originalCandidates = [
    image.origin_image_info?.url_list,
    image.origin_image?.url_list,
    image.url_list,
    image.urlList
  ];

  for (const candidate of originalCandidates) {
    const urls = getUrlList(candidate);

    if (urls.length) {
      return urls[urls.length - 1];
    }
  }

  const fallbackCandidates = [
    image.origin_image_info,
    image.origin_image,
    image.origin_image_url,
    image.download_url_list,
    image.download_url,
    image.display_image,
    image.display_image_url,
    image.image_url
  ];

  for (const candidate of fallbackCandidates) {
    const urls = getUrlList(candidate);

    if (urls.length) {
      return urls[urls.length - 1];
    }
  }

  return "";
}

function firstUrl(obj) {
  const urls = getUrlList(obj);
  return urls[0] || "";
}

// 从页面数据中寻找抖音作品详情
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

// 提取抖音作品 ID
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

// 请求抖音作品分享页面
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

// 抖音图文作品备用详情接口
async function fetchAwemeDetail(awemeId) {
  const endpoint = new URL(
    "https://api.amemv.com/aweme/v1/aweme/detail/"
  );

  endpoint.search = new URLSearchParams({
    aweme_id: String(awemeId),
    aid: "6383",
    device_platform: "web",
    version_code: "190500",
    version_name: "19.5.0"
  }).toString();

  const response = await fetch(endpoint.toString(), {
    headers: {
      "User-Agent": MOBILE_UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://www.douyin.com/"
    },
    signal: AbortSignal.timeout(18000)
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const item = data?.aweme_detail;

  if (
    Number(data?.status_code) !== 0 ||
    !item ||
    String(item.aweme_id) !== String(awemeId)
  ) {
    return null;
  }

  return item;
}

// ================================
// B站解析：支持短链接、BV长链接、AV长链接
// ================================
async function parseBilibili(inputUrl) {
  const parsedInput = new URL(inputUrl);
  const inputHost = parsedInput.hostname.toLowerCase();

  const isShortLink = inputHost === "b23.tv";

  const isLongLink =
    inputHost === "bilibili.com" ||
    inputHost.endsWith(".bilibili.com");

  if (!isShortLink && !isLongLink) {
    throw new Error("不是有效的 B站链接。");
  }

  let finalUrl = inputUrl;
  let bvid = "";
  let aid = "";

  let pageNo = Math.max(
    1,
    Number(parsedInput.searchParams.get("p")) || 1
  );

  // 先从原始链接提取 BV 号
  const directBvid =
    inputUrl.match(/\/video\/(BV[0-9A-Za-z]+)/i) ||
    inputUrl.match(/\b(BV[0-9A-Za-z]{10})\b/i);

  // 同时兼容 AV 号
  const directAid =
    inputUrl.match(/\/video\/av(\d+)/i) ||
    inputUrl.match(/\bav(\d+)\b/i);

  if (directBvid) {
    bvid = directBvid[1];
  } else if (directAid) {
    aid = directAid[1];
  }

  // 长链接已经包含 BV/AV 号时，直接解析，不访问网页
  // 短链接没有视频 ID 时，才请求跳转地址
  if (!bvid && !aid) {
    if (!isShortLink) {
      throw new Error(
        "长链接中没有识别到 BV 号或 AV 号，请确认是具体视频页面。"
      );
    }

    let resolved;

    try {
      resolved = await fetch(inputUrl, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          "Referer": "https://www.bilibili.com/",
          "Accept": "text/html,application/xhtml+xml,*/*"
        },
        signal: AbortSignal.timeout(20000)
      });
    } catch (e) {
      throw new Error("B站短链接跳转失败：" + e.message);
    }

    if (!resolved.ok) {
      throw new Error(
        "B站短链接访问失败，HTTP " + resolved.status +
        "。可以尝试使用视频长链接。"
      );
    }

    finalUrl = resolved.url || inputUrl;

    const finalHost = new URL(finalUrl).hostname.toLowerCase();

    if (
      finalHost !== "bilibili.com" &&
      !finalHost.endsWith(".bilibili.com")
    ) {
      throw new Error("短链接没有跳转到有效的 B站视频页面。");
    }

    const finalParsed = new URL(finalUrl);

    pageNo = Math.max(
      1,
      Number(finalParsed.searchParams.get("p")) || 1
    );

    const foundBvid =
      finalUrl.match(/\/video\/(BV[0-9A-Za-z]+)/i) ||
      finalUrl.match(/\b(BV[0-9A-Za-z]{10})\b/i);

    const foundAid =
      finalUrl.match(/\/video\/av(\d+)/i) ||
      finalUrl.match(/\bav(\d+)\b/i);

    if (foundBvid) {
      bvid = foundBvid[1];
    } else if (foundAid) {
      aid = foundAid[1];
    }
  }

  if (!bvid && !aid) {
    throw new Error(
      "没有识别到视频 BV 号或 AV 号，暂不支持该类型的 B站分享链接。"
    );
  }

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com/",
    "Accept": "application/json, text/plain, */*"
  };

  // 获取作品信息
  const viewUrl = new URL(
    "https://api.bilibili.com/x/web-interface/view"
  );

  if (bvid) {
    viewUrl.searchParams.set("bvid", bvid);
  } else {
    viewUrl.searchParams.set("aid", aid);
  }

  const viewRes = await fetch(viewUrl.toString(), {
    headers,
    signal: AbortSignal.timeout(18000)
  });

  if (!viewRes.ok) {
    throw new Error(
      "B站作品信息获取失败，HTTP " + viewRes.status
    );
  }

  const viewJson = await viewRes.json();

  if (viewJson.code !== 0 || !viewJson.data) {
    throw new Error(
      "B站暂时无法提供作品信息：" +
      (viewJson.message || "接口返回异常")
    );
  }

  const item = viewJson.data;
  const pages = Array.isArray(item.pages) ? item.pages : [];

  const selectedPage =
    pages.find(page => Number(page.page) === pageNo) ||
    pages[0];

  if (!selectedPage || !selectedPage.cid) {
    throw new Error("没有找到该视频的播放分P信息。");
  }

  // 获取视频播放地址
  const playUrl = new URL(
    "https://api.bilibili.com/x/player/playurl"
  );

  if (bvid) {
    playUrl.searchParams.set("bvid", bvid);
  } else {
    playUrl.searchParams.set("avid", String(item.aid || aid));
  }

  playUrl.searchParams.set("cid", String(selectedPage.cid));
  playUrl.searchParams.set("qn", "32");
  playUrl.searchParams.set("fnval", "1");
  playUrl.searchParams.set("fnver", "0");
  playUrl.searchParams.set("fourk", "0");
  playUrl.searchParams.set("platform", "html5");
  playUrl.searchParams.set("high_quality", "0");

  const playRes = await fetch(playUrl.toString(), {
    headers: {
      ...headers,
      "Referer":
        "https://www.bilibili.com/video/" +
        (item.bvid || bvid || "") + "/"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!playRes.ok) {
    throw new Error(
      "B站播放地址获取失败，HTTP " + playRes.status
    );
  }

  const playJson = await playRes.json();
  const durl = playJson?.data?.durl?.[0];

  const mediaUrl =
    durl?.url ||
    durl?.backup_url?.[0] ||
    "";

  if (playJson.code !== 0 || !mediaUrl) {
    throw new Error(
      "B站没有返回可直接下载的 MP4 地址：" +
      (playJson.message || "可能需要登录或该视频有播放权限限制")
    );
  }

  const safeMediaUrl = normalizeUrl(mediaUrl);

  if (!safeMediaUrl) {
    throw new Error("B站返回的媒体地址无效。");
  }

  return {
    type: "video",
    videoUrl: safeMediaUrl,
    description: item.title || "B站视频",
    author: item.owner?.name || "",
    cover: normalizeUrl(item.pic || "")
  };
}

// ================================
// 主解析入口
// ================================
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
        error: "请提供作品分享链接。"
      });
    }

    const urls = input.match(/https?:\/\/[^\s，。]+/g) || [];

    // 优先识别 B站链接
    let bilibiliUrl = "";

    for (const url of urls) {
      try {
        const host = new URL(url).hostname.toLowerCase();

        if (
          host === "b23.tv" ||
          host === "bilibili.com" ||
          host.endsWith(".bilibili.com")
        ) {
          bilibiliUrl = url;
          break;
        }
      } catch {}
    }

    if (bilibiliUrl) {
      const result = await parseBilibili(bilibiliUrl);
      return res.status(200).json(result);
    }

    // 原有抖音识别逻辑
    const candidate = urls.find(url =>
      /douyin\.com|iesdouyin\.com/i.test(url)
    );

    if (!candidate) {
      return res.status(400).json({
        error: "没有识别到有效的抖音或 B站链接。"
      });
    }

    const parsed = new URL(candidate);

    if (!/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/i.test(parsed.hostname)) {
      return res.status(400).json({
        error: "暂不支持该平台链接。"
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

    // 第五步：备用详情接口
    const currentImages =
      item?.images ||
      item?.image_post_info?.images ||
      [];

    if (
      !item ||
      !Array.isArray(currentImages) ||
      currentImages.length === 0
    ) {
      try {
        const detailItem = await fetchAwemeDetail(awemeId);

        if (detailItem) {
          const detailImages =
            detailItem.images ||
            detailItem.image_post_info?.images ||
            [];

          if (
            !item ||
            (Array.isArray(detailImages) && detailImages.length > 0)
          ) {
            item = detailItem;
          }
        }
      } catch (e) {
        console.error(
          "Douyin detail API fallback failed:",
          e.message
        );
      }
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

    // 第六步：解析图文作品
    const imageObjects =
      item.images ||
      item.image_post_info?.images ||
      [];

    const images = [
      ...new Set(
        imageObjects
          .map(getOriginalImageUrl)
          .filter(Boolean)
      )
    ];

    const video = item.video || {};

    // 第七步：解析普通视频
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
    console.error("Media parse error:", e);

    return res.status(502).json({
      error: e.message || "解析服务暂时不可用，请稍后重试。"
    });
  }
}
