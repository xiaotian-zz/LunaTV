import { getRandomUserAgent } from './user-agent';

// 请求限制器 - 进一步优化用户体验
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 500; // 减少到500ms，更快响应

// 智能延时：根据URL类型调整延时
function getSmartDelay(url: string): { min: number; max: number } {
  // 移动端API通常更宽松，可以减少延时
  if (url.includes('m.douban.com')) {
    return { min: 100, max: 400 }; // 移动端API：100-400ms
  }
  // 桌面端API需要更谨慎
  if (url.includes('movie.douban.com')) {
    return { min: 300, max: 800 }; // 桌面端API：300-800ms
  }
  return { min: 200, max: 500 }; // 默认：200-500ms
}

function smartRandomDelay(url: string): Promise<void> {
  const { min, max } = getSmartDelay(url);
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * JSON API 内存缓存：
 * - 命中时完全跳过限流延时与外网请求（同一 URL 5 分钟内只打一次豆瓣）
 * - inflight 去重：并发冷启动时同一 URL 只发一次外网请求
 * - 豆瓣榜单/分类数据小时级变化，5 分钟缓存对访问速度收益最大
 */
const dataCache = new Map<string, { data: unknown; expires: number }>();
const DATA_CACHE_TTL = 5 * 60 * 1000;
const DATA_CACHE_MAX = 300;
const inflightRequests = new Map<string, Promise<unknown>>();

/**
 * 通用的豆瓣数据获取函数
 * @param url 请求的URL
 * @returns Promise<T> 返回指定类型的数据
 */
export async function fetchDoubanData<T>(url: string): Promise<T> {
  const now = Date.now();
  const cached = dataCache.get(url);
  if (cached && cached.expires > now) {
    return cached.data as T;
  }

  const inflight = inflightRequests.get(url);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const request = (async () => {
    // 请求限流：确保请求间隔（仅缓存未命中时走到这里）
    const time = Date.now();
    const timeSinceLastRequest = time - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest),
      );
    }
    lastRequestTime = Date.now();

    // 智能延时：根据API类型调整
    await smartRandomDelay(url);

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 优化到10秒

    // 设置请求选项
    const fetchOptions = {
      signal: controller.signal,
      headers: {
        'User-Agent': getRandomUserAgent(),
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://movie.douban.com/',
        // 随机添加Origin，但概率更低以减少复杂性
        ...(Math.random() > 0.8 ? { Origin: 'https://movie.douban.com' } : {}),
      },
    };

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  inflightRequests.set(url, request);

  try {
    const data = await request;
    // 容量保护：超限时先清过期项，仍超限则淘汰最早写入的条目（Map 保持插入顺序）
    if (dataCache.size >= DATA_CACHE_MAX) {
      const nowMs = Date.now();
      for (const [key, value] of dataCache) {
        if (value.expires <= nowMs) dataCache.delete(key);
      }
      while (dataCache.size >= DATA_CACHE_MAX) {
        const oldest = dataCache.keys().next().value;
        if (oldest === undefined) break;
        dataCache.delete(oldest);
      }
    }
    dataCache.set(url, { data, expires: Date.now() + DATA_CACHE_TTL });
    return data;
  } finally {
    inflightRequests.delete(url);
  }
}

/**
 * 获取豆瓣HTML页面数据的函数
 * @param url 请求的URL
 * @returns Promise<string> 返回HTML字符串
 */
export async function fetchDoubanHtml(url: string): Promise<string> {
  // 请求限流：确保请求间隔
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest),
    );
  }
  lastRequestTime = Date.now();

  // 智能延时：根据API类型调整
  await smartRandomDelay(url);

  // 添加超时控制 - 增加到30秒用于多页获取
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  // 设置请求选项
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent': getRandomUserAgent(),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      Referer: 'https://www.douban.com/',
      // 添加更多真实浏览器请求头
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
  };

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
