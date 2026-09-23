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

export interface PrefetchLoaderOptions {
  /**
   * playlist（m3u8）响应转换器（如去广告过滤）。
   * 在 parsePlaylist 抽取分片 URL 之前执行——预取定位的是过滤后
   * 真实会播放的分片列表。与分片预取天然不冲突：过滤只作用于
   * m3u8（playlistLoader），预取只作用于分片（fragLoader）。
   */
  transformPlaylist?: (body: string) => string;
}

export function createPrefetchLoaders(
  concurrency: number,
  BaseLoader: any, // Hls.DefaultConfig.loader（XHR loader 类）
  options?: PrefetchLoaderOptions,
): PrefetchLoaderFactory {
  const transformPlaylist = options?.transformPlaylist;
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
      controller?: AbortController;
      aborted?: boolean;
    }
  >();
  const cacheLimit = concurrency + 2;
  let disabled = false;
  let disabledAt = 0;
  // 熔断冷却：60s 后半开重试，反复熔断冷却翻倍（上限 10 分钟）。
  // 源站限速/风控是波动的，永久熔断会让整个会话退化为串行加载
  let cooldownMs = 60_000;
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

  // 冷却期满后半开重试：重置统计恢复预取
  const maybeReenable = () => {
    if (!disabled) return;
    if (now() - disabledAt >= cooldownMs) {
      disabled = false;
      okCount = 0;
      failCount = 0;
      cooldownMs = Math.min(cooldownMs * 2, 600_000);
    }
  };

  const prefetch = (url: string) => {
    maybeReenable();
    if (disabled || cache.has(url)) return;
    const entry: {
      status: 'pending' | 'ready';
      promise?: Promise<ArrayBuffer>;
      data?: ArrayBuffer;
      controller?: AbortController;
      aborted?: boolean;
    } = { status: 'pending' };
    // 🔧 fetch 可取消：seek/abort 时释放连接，避免 stale 预取占满
    // 浏览器同域连接池导致新位置加载排队转圈（HTTP/1.1 源站仅 6 条连接）
    entry.controller = new AbortController();
    entry.promise = fetch(url, {
      method: 'GET',
      credentials: 'omit',
      signal: entry.controller.signal,
    })
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
      .catch((err: unknown) => {
        cache.delete(url);
        // 主动取消（seek/abort/destroy）不计入失败统计，不触发熔断
        if (entry.aborted) {
          throw new Error('prefetch aborted');
        }
        failCount += 1;
        if (shouldDisable()) {
          disabled = true;
          disabledAt = now();
        }
        throw err instanceof Error ? err : new Error('prefetch failed');
      });
    cache.set(url, entry);
    evictOldest();
  };

  // 取消指定分片的 pending 预取（释放连接），ready 缓存保留（可复用）
  const cancelPrefetch = (url: string) => {
    const entry = cache.get(url);
    if (entry && entry.status === 'pending' && !entry.aborted) {
      entry.aborted = true;
      try {
        entry.controller?.abort();
      } catch {
        /* 已 abort 或不可取消 */
      }
      cache.delete(url);
    }
  };

  let lastPrefetchBatch: string[] = []; // 最近一批预取的分片 URL（abort 时批量取消）

  const prefetchAfter = (url: string) => {
    if (disabled || concurrency <= 0) return;
    const idx = indexByUrl.get(url);
    if (idx === undefined) return;
    const batch: string[] = [];
    for (let i = 1; i <= concurrency; i += 1) {
      const next = fragUrls[idx + i];
      if (next) {
        prefetch(next);
        batch.push(next);
      }
    }
    lastPrefetchBatch = batch;
  };

  // 取消当前分片之后的一整批预取（seek/abort 时释放连接）
  const cancelPrefetchBatch = () => {
    for (const u of lastPrefetchBatch) {
      cancelPrefetch(u);
    }
    lastPrefetchBatch = [];
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
    // 当前加载请求的状态：abort/新请求取代后，迟到的 promise 回调必须被丢弃，
    // 否则 hls.js 收到已废弃分片的 onSuccess 会导致内部状态错乱 → 停止调度缓冲
    private loadState: { cancelled: boolean } | null = null;

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

      // 防御：上一请求未被 abort 就发起新加载（异常时序），清理旧加载
      if (this.loadState && !this.loadState.cancelled) {
        this.loadState.cancelled = true;
        this.inner.abort();
      }
      const state = { cancelled: false };
      this.loadState = state;

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
        const savedConfig = config;
        const savedCallbacks = callbacks;
        // raced 标志：超时/成功/失败三者只执行其一
        let raced = false;
        // 超时保底：预取因任何原因无响应时回退原生加载，防挂死转圈
        const timer = setTimeout(() => {
          if (raced) return;
          raced = true;
          try {
            entry.controller?.abort();
          } catch {
            /* 已 abort */
          }
          if (!state.cancelled && this.loadState === state) {
            try {
              this.inner.load(savedContext, savedConfig, savedCallbacks);
            } catch {
              /* 忽略 */
            }
          }
        }, 10000);
        entry.promise
          .then((data) => {
            if (raced) return;
            raced = true;
            clearTimeout(timer);
            // 已取消或已被新请求取代：丢弃迟到回调
            if (state.cancelled || this.loadState !== state) return;
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
            if (raced) return;
            raced = true;
            clearTimeout(timer);
            // 已取消或已被新请求取代：不回退加载
            if (state.cancelled || this.loadState !== state) return;
            // 预取失败或被 abort（含 seek 时 cancelPrefetchBatch 取消了
            // 主加载正在等待的批次成员）：只要当前 load 仍有效就必须
            // 回退原生加载。否则该分片永远无回调 → hls.js 停止调度
            // → 转圈卡死（连续拖动进度条时的挂死根因）
            if (this.callbacks === callbacks) {
              this.inner.load(savedContext, savedConfig, savedCallbacks);
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
      // 🔧 真正的取消语义：hls.js seek/重新调度时会调用 abort，
      // 1) 当前加载请求标记取消（丢弃迟到回调）
      // 2) 取消 pending 主加载的预取 Promise 关联与后续预取批次，释放连接
      if (this.loadState) {
        this.loadState.cancelled = true;
      }
      const url: string = this.context?.url;
      if (url) {
        const entry = cache.get(url);
        if (entry && entry.status === 'pending') {
          cancelPrefetch(url);
        }
      }
      cancelPrefetchBatch();
      this.inner.abort();
    }

    destroy() {
      if (this.loadState) {
        this.loadState.cancelled = true;
      }
      const url: string = this.context?.url;
      if (url) {
        const entry = cache.get(url);
        if (entry && entry.status === 'pending') {
          cancelPrefetch(url);
        }
      }
      cancelPrefetchBatch();
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
          // 先做 playlist 转换（去广告过滤），再在过滤结果上抽取分片 URL。
          // 仅 media playlist（含 EXTINF）需要转换，master playlist 原样保留
          if (
            transformPlaylist &&
            typeof response?.data === 'string' &&
            response.data.includes('#EXTINF')
          ) {
            try {
              response.data = transformPlaylist(response.data);
            } catch {
              /* 转换失败保留原始内容 */
            }
          }
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
