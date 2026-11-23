
const ALLOWED_HOSTS = [
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

const MAX_IMAGES = 30;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;

function checkUrl(value) {
  try {
    const u = new URL(value);
    const allowed = ALLOWED_HOSTS.some(
      domain => u.hostname === domain ||
        u.hostname.endsWith("." + domain)
    );
    return u.protocol === "https:" && allowed ? u : null;
  } catch {
    return null;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];

    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (
        (crc & 1) ? 0xedb88320 : 0
      );
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const year = Math.max(1980, now.getFullYear());

  const dosTime =
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    Math.floor(now.getSeconds() / 2);

  const dosDate =
    ((year - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = file.data;
    const crc = crc32(data);

    // ZIP 本地文件头：不压缩，直接保存原始图片字节
    const local = Buffer.alloc(30 + name.length);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    localParts.push(local, data);

    // ZIP 中央目录
    const central = Buffer.alloc(46 + name.length);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    centralParts.push(central);

    offset += local.length + data.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralData, end]);
}

function getExtension(type) {
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif"
  };

  return map[type] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const images = req.body?.images;

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).send("没有收到图片地址。");
    }

    if (images.length > MAX_IMAGES) {
      return res.status(400).send(
        `一次最多打包 ${MAX_IMAGES} 张图片。`
      );
    }

    const files = [];
    let totalSize = 0;

    for (let i = 0; i < images.length; i++) {
      const source = checkUrl(images[i]);

      if (!source) {
        throw new Error(`第 ${i + 1} 张图片地址不受支持。`);
      }

      const upstream = await fetch(source.toString(), {
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Referer": "https://www.douyin.com/"
        }
      });

      if (!upstream.ok) {
        throw new Error(`第 ${i + 1} 张图片获取失败。`);
      }

      // 再次检查跳转后的域名
      const finalUrl = checkUrl(upstream.url || source.toString());

      if (!finalUrl) {
        throw new Error(`第 ${i + 1} 张图片跳转地址不受支持。`);
      }

      const contentType = (
        upstream.headers.get("content-type") || ""
      ).split(";")[0].toLowerCase();

      const ext = getExtension(contentType);

      if (!ext) {
        throw new Error(
          `第 ${i + 1} 个文件不是支持的图片格式。`
        );
      }

      const length = Number(
        upstream.headers.get("content-length") || 0
      );

      if (length > MAX_IMAGE_SIZE) {
        throw new Error(`第 ${i + 1} 张图片超过大小限制。`);
      }

      const data = Buffer.from(
        await upstream.arrayBuffer()
      );

      if (!data.length || data.length > MAX_IMAGE_SIZE) {
        throw new Error(`第 ${i + 1} 张图片大小异常。`);
      }

      totalSize += data.length;

      if (totalSize > MAX_TOTAL_SIZE) {
        throw new Error("图片总大小超过限制，请分批下载。");
      }

      files.push({
        name: `image-${String(i + 1).padStart(2, "0")}.${ext}`,
        data
      });
    }

    const zip = makeZip(files);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="douyin-images.zip"'
    );
    res.setHeader("Content-Length", zip.length);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(zip);

  } catch (e) {
    console.error("ZIP error:", e);

    return res.status(502).send(
      e.message || "ZIP 打包失败，请稍后重试。"
    );
  }
}
