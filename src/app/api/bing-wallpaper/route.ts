import { NextResponse } from 'next/server';

// 使用 10 分钟缓存，平衡随机性和性能
export const revalidate = 600; // 10 分钟

// Unsplash Source 虽标记为 deprecated，但仍可用且无需 API key
// 主题筛选为风景/自然，更适合做壁纸
const UNSPLASH_URL = 'https://source.unsplash.com/1920x1080/?landscape,nature';

// 最终兜底：Lorem Picsum（图片同样来自 Unsplash，随机主题）
function getPicsumUrl() {
  return `https://picsum.photos/1920/1080?random=${Date.now()}`;
}

// 公共响应头（10 分钟缓存）
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=600, s-maxage=600',
  'CDN-Cache-Control': 'public, s-maxage=600',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=600',
};

// 1 分钟内存缓存：登录页高并发加载时摊平外网请求（壁纸本身一天一换，无实时性要求）
let wallpaperMemoryCache: { data: unknown; expires: number } | null = null;
const WALLPAPER_MEMORY_TTL = 60_000;

export async function GET() {
  const now = Date.now();
  if (wallpaperMemoryCache && wallpaperMemoryCache.expires > now) {
    return NextResponse.json(wallpaperMemoryCache.data, {
      headers: CACHE_HEADERS,
    });
  }

  try {
    // 随机选择壁纸来源：70% Bing, 30% 备用源
    const useBing = Math.random() < 0.7;

    // ---------- 主源：Bing 每日壁纸 ----------
    if (useBing) {
      try {
        // Bing 随机壁纸（从过去 0-7 天中随机选择）
        const randomIdx = Math.floor(Math.random() * 8);
        const response = await fetch(
          `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${randomIdx}&n=1&mkt=zh-CN`,
          { next: { revalidate: 600 } },
        );

        if (response.ok) {
          const data = await response.json();

          if (data.images && data.images[0]) {
            const imageUrl = `https://www.bing.com${data.images[0].url}`;

            const payload = {
              url: imageUrl,
              copyright: data.images[0].copyright,
              title: data.images[0].title,
              source: 'bing',
            };
            wallpaperMemoryCache = {
              data: payload,
              expires: Date.now() + WALLPAPER_MEMORY_TTL,
            };

            return NextResponse.json(payload, { headers: CACHE_HEADERS });
          }
        }
      } catch (bingError) {
        console.warn('Bing 壁纸获取失败，降级到 Unsplash:', bingError);
      }
      // Bing 失败 → 继续尝试 Unsplash
    }

    // ---------- 备用源1：Unsplash Source 随机风景图 ----------
    try {
      const unsplashResponse = await fetch(UNSPLASH_URL, {
        // 跟随重定向获取最终图片 URL
        redirect: 'follow',
        // 5 秒超时，避免卡住
        signal: AbortSignal.timeout(5000),
        // 结果缓存 10 分钟，避免每次登录页加载都实时请求
        next: { revalidate: 600 },
      });

      if (unsplashResponse.ok) {
        const finalUrl = unsplashResponse.url;

        const payload = {
          url: finalUrl,
          copyright: 'Unsplash - Free high-quality photos',
          title: 'Unsplash Landscape',
          source: 'unsplash',
        };
        wallpaperMemoryCache = {
          data: payload,
          expires: Date.now() + WALLPAPER_MEMORY_TTL,
        };

        return NextResponse.json(payload, { headers: CACHE_HEADERS });
      }
    } catch (unsplashError) {
      console.warn(
        'Unsplash Source 获取失败，降级到 Lorem Picsum:',
        unsplashError,
      );
    }

    // ---------- 最终兜底：Lorem Picsum ----------
    const loremUrl = getPicsumUrl();
    return NextResponse.json(
      {
        url: loremUrl,
        copyright: 'Lorem Picsum - Free random images',
        title: 'Random Photo',
        source: 'picsum',
      },
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    console.error('Error fetching wallpaper:', error);

    // 总兜底：Lorem Picsum
    const loremUrl = getPicsumUrl();
    return NextResponse.json(
      {
        url: loremUrl,
        copyright: 'Lorem Picsum - Free random images',
        title: 'Random Photo',
        source: 'picsum',
      },
      { headers: CACHE_HEADERS },
    );
  }
}
