
function findVideoItem(data) {
  if (!data || typeof data !== "object") return null;

  const visited = new Set();
  const stack = [data];

  function isVideoItem(obj) {
    if (!obj || typeof obj !== "object") return false;

    const video = obj.video;

    return Boolean(
      video &&
      (
        video.play_addr?.url_list?.length ||
        video.download_addr?.url_list?.length
      )
    );
  }

  while (stack.length) {
    const current = stack.pop();

    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;

    visited.add(current);

    // 直接就是视频详情
    if (isVideoItem(current)) {
      return current;
    }

    // 常见视频详情字段
    const directCandidates = [
      current.aweme_detail,
      current.awemeDetail,
      current.videoInfoRes?.aweme_detail,
      current.videoInfoRes?.item_list?.[0],
      current.item,
      current.itemInfo
    ];

    for (const item of directCandidates) {
      if (isVideoItem(item)) return item;
    }

    // 常见列表结构
    if (Array.isArray(current.item_list)) {
      for (const item of current.item_list) {
        if (isVideoItem(item)) return item;
      }
    }

    // 继续递归检查其他嵌套字段
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return null;
}
