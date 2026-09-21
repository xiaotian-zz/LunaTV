/**
 * hls.js 并发分片预取 loader
 *
 * 背景：hls.js 默认一次只加载一个分片（串行）。单连接被源站限速或 RTT 高时，
 * 缓冲增长速度 ≈ 单连接吞吐，容易卡顿。本模块在主分片加载的同时，
 * 预取后续 N 个分片到内存，主加载命中缓存时零等待返回，可将缓冲速度提升 2-3 倍。
 *
 * 组成：
 * - playlistLoader：拦截 m3u8 响应，解析分片 URL 列表（供预取定位"后续分片"）
 * - fragLoader：包装默认 XHR loader：
 *     1) 命中预取缓存 → 立即 onSuccess（零网络等待）
 *     2) 预取进行中 → 等待同一 Promise（去重，不发重复请求）
 *     3) 未命中 → 正常加载，并触发预取后续 N 个分片
 *
 * 安全策略：
 * - 内存上限：缓存最多 concurrency + 2 个分片，FIFO 淘汰（每片约 1-2MB）
 * - 失败熔断：预取失败率超 50%（窗口 20 次）自动停用，回退原生串行
 * - Byte-Range 分片（EXT-X-BYTERANGE）不支持预取，原样直连
 * - abort/destroy 透传给内部 loader，预取请求自然完成入缓存（seek 回来可复用）
 */

const PREFETCH_WINDOW_STATS = 20; // 熔断统计窗口
const PREFETCH_FAIL_RATE_LIMIT = 0.5; // 失败率熔断阈值

export interface PrefetchLoaderFactory {
  fragLoader: any;
  playlistLoader: any;
}

export function createPrefetchLoaders(
  concurrency: number,
  BaseLoader: any, // Hls.DefaultConfig.loader（XHR loader 类）
): PrefetchLoaderFactory {
  // ---------- 共享状态 ----------
  const fragUrls: string[] = []; // 按播放顺序的分片 URL 列表
  const indexByUrl = new Map<string, number>();
  // 预取缓存：url -> 数据或进行中的 Promise
  const cache = new Map<
    string,
    {
      status: 'pending' | 'ready';
      promise?: Promise<ArrayBuffer>;
      data?: ArrayBuffer;
    }
  >();
  const cacheLimit = concurrency + 2;
  let disabled = false;
  let okCount = 0;
  let failCount = 0;

  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  const makeStats = (byteLength: number) => {
    const t = now();
    return {
      loading: { start: t, first: t, end: t },
      total: byteLength,
      loaded: byteLength,
      bwEstimate: 0,
    };
  };

  // ---------- 预取 ----------
  const evictOldest = () => {
    while (cache.size > cacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const shouldDisable = () => {
    const total = okCount + failCount;
    return (
      total >= PREFETCH_WINDOW_STATS &&
      failCount / total > PREFETCH_FAIL_RATE_LIMIT
    );
  };

  const prefetch = (url: string) => {
    if (disabled || cache.has(url)) return;
    const entry: {
      status: 'pending' | 'ready';
      promise?: Promise<ArrayBuffer>;
      data?: ArrayBuffer;
    } = { status: 'pending' };
    entry.promise = fetch(url, { method: 'GET', credentials: 'omit' })
      .then((res) => {
        if (!res.ok) throw new Error(`prefetch HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => {
        entry.status = 'ready';
        entry.data = data;
        okCount += 1;
        return data;
      })
      .catch(() => {
        cache.delete(url);
        failCount += 1;
        if (shouldDisable()) disabled = true;
        throw new Error('prefetch failed');
      });
    cache.set(url, entry);
    evictOldest();
  };

  const prefetchAfter = (url: string) => {
    if (disabled || concurrency <= 0) return;
    const idx = indexByUrl.get(url);
    if (idx === undefined) return;
    for (let i = 1; i <= concurrency; i += 1) {
      const next = fragUrls[idx + i];
      if (next) prefetch(next);
    }
  };

  // ---------- m3u8 分片 URL 解析 ----------
  const parsePlaylist = (body: string, baseUrl: string) => {
    try {
      const lines = body.split('\n');
      const urls: string[] = [];
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        // 忽略 #EXT 开头以外的标签行，非注释行即分片或子 playlist
        try {
          urls.push(new URL(line, baseUrl).toString());
        } catch {
          /* 跳过非法行 */
        }
      }
      if (urls.length < 2) return; // master playlist（无分片）不做处理
      fragUrls.length = 0;
      indexByUrl.clear();
      urls.forEach((u, i) => {
        fragUrls.push(u);
        indexByUrl.set(u, i);
      });
    } catch {
      /* 解析失败不影响主链路 */
    }
  };

  const toPlaylistBody = (data: any): string | null => {
    if (!data) return null;
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    return null;
  };

  // ---------- loaders ----------
  class PrefetchFragLoader {
    private inner: any;
    private context: any;
    private config: any;
    private callbacks: any;

    constructor(config: any) {
      this.inner = new BaseLoader(config);
    }

    load(context: any, config: any, callbacks: any) {
      const url: string = context?.url;
      const hasRange = context?.rangeStart !== undefined;

      // Byte-Range 分片：不支持预取，直连
      if (!url || hasRange) {
        this.inner.load(context, config, callbacks);
        return;
      }

      const entry = cache.get(url);
      if (entry?.status === 'ready' && entry.data) {
        cache.delete(url); // 用后即弃，控制内存
        const data = entry.data;
        callbacks.onSuccess(
          { url, data },
          makeStats(data.byteLength),
          context,
          undefined,
        );
        prefetchAfter(url);
        return;
      }

      if (entry?.status === 'pending' && entry.promise) {
        // 去重：等待进行中的预取，避免重复请求
        const savedContext = context;
        entry.promise
          .then((data) => {
            cache.delete(url);
            callbacks.onSuccess(
              { url, data },
              makeStats(data.byteLength),
              savedContext,
              undefined,
            );
            prefetchAfter(url);
          })
          .catch(() => {
            // 预取失败：回退原生加载（仅当未被 abort/destroy）
            if (this.callbacks === callbacks) {
              this.inner.load(savedContext, config, callbacks);
            }
          });
        this.context = context;
        this.config = config;
        this.callbacks = callbacks;
        return;
      }

      // 未命中：正常加载 + 触发预取
      this.context = context;
      this.config = config;
      this.callbacks = callbacks;
      this.inner.load(context, config, callbacks);
      prefetchAfter(url);
    }

    abort() {
      this.inner.abort();
    }

    destroy() {
      this.inner.destroy();
    }
  }

  class PrefetchPlaylistLoader {
    private inner: any;

    constructor(config: any) {
      this.inner = new BaseLoader(config);
    }

    load(context: any, config: any, callbacks: any) {
      const wrappedCallbacks = {
        ...callbacks,
        onSuccess: (
          response: any,
          stats: any,
          ctx: any,
          networkDetails: any,
        ) => {
          const body = toPlaylistBody(response?.data);
          if (body) {
            parsePlaylist(body, response?.url || context?.url || '');
          }
          callbacks.onSuccess(response, stats, ctx, networkDetails);
        },
      };
      this.inner.load(context, config, wrappedCallbacks);
    }

    abort() {
      this.inner.abort();
    }

    destroy() {
      this.inner.destroy();
    }
  }

  return {
    fragLoader: PrefetchFragLoader as any,
    playlistLoader: PrefetchPlaylistLoader as any,
  };
}
