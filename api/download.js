
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).send("Method Not Allowed");
    }

    const raw = String(req.query.url || "");
    if (!raw) {
      return res.status(400).send("Missing URL");
    }

    const u = new URL(raw);

    const allowedHosts = [
      "douyinvod.com",
      "douyinpic.com",
      "douyincdn.com",
      "byteimg.com",
      "bytecdn.cn",
      "pstatp.com",
      "snssdk.com",
      "zjcdn.com",
      "douyin.com",
      "iesdouyin.com"
    ];

    function isAllowed(hostname) {
      return allowedHosts.some(
        domain => hostname === domain || hostname.endsWith("." + domain)
      );
    }

    if (u.protocol !== "https:" || !isAllowed(u.hostname.toLowerCase())) {
      return res.status(400).send("Invalid media URL");
    }

    const upstream = await fetch(u.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://www.douyin.com/",
        ...(req.headers.range ? { "Range": req.headers.range } : {})
      }
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).send("媒体源暂时无法访问，请重新解析。");
    }

    // 检查跳转后的最终域名，避免跳转到非授权地址
    const finalUrl = new URL(upstream.url || u.toString());

    if (
      finalUrl.protocol !== "https:" ||
      !isAllowed(finalUrl.hostname.toLowerCase())
    ) {
      return res.status(403).send("Media redirect blocked");
    }

    const contentType = (
      upstream.headers.get("content-type") || ""
    ).split(";")[0].toLowerCase();

    const isImage = contentType.startsWith("image/");
    const isVideo = contentType.startsWith("video/");

    if (!isImage && !isVideo) {
      return res.status(415).send("不支持的媒体格式。");
    }

    let extension = "bin";

    const extensions = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm"
    };

    extension = extensions[contentType] || (isImage ? "jpg" : "mp4");

    const inline = req.query.inline === "1";
    const index = Math.max(1, Number(req.query.index) || 1);

    const filename = isImage
      ? `douyin-image-${index}.${extension}`
      : `douyin-video.${extension}`;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (upstream.headers.get("content-length")) {
      res.setHeader("Content-Length", upstream.headers.get("content-length"));
    }

    if (upstream.headers.get("content-range")) {
      res.setHeader("Content-Range", upstream.headers.get("content-range"));
    }

    if (isVideo) {
      res.setHeader("Accept-Ranges", "bytes");
    }

    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${filename}"`
    );

    res.status(upstream.status);

    if (!upstream.body) {
      return res.end();
    }

    const reader = upstream.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (res.destroyed) {
        await reader.cancel();
        return;
      }

      if (!res.write(Buffer.from(value))) {
        await new Promise(resolve => res.once("drain", resolve));
      }
    }

    res.end();

  } catch (e) {
    console.error("Media download error:", e);

    if (!res.headersSent) {
      res.status(502).send("下载失败：" + (e.message || "网络错误"));
    } else {
      res.end();
    }
  }
}
