import { NextRequest, NextResponse } from 'next/server';

/**
 * 旧设备全站自动切换（iOS 9.3 适配）
 *
 * 现代前端（Tailwind v4 CSS + 新版 JS 语法）在 Safari 9 上无法运行：
 * CSS 层 oklch/@property/级联层全不支持导致整页样式失效，JS 层可选链等
 * 新语法直接 SyntaxError 白屏。因此 iOS 9.x 及以下设备访问任意主站页面时，
 * 一律 302 到 /legacy 轻量版（纯 ES5 + XHR + 原生 HLS，见 src/app/legacy）。
 *
 * 说明：iOS 9.3 时代的 UA 版本号真实可信（不存在新系统伪装低版本号的情况，
 * 反向伪装只发生在 iOS 26 报 18_x），按主版本 <= 9 判定即可。
 */
export const config = {
  // 排除 API、legacy 自身与静态资源，避免重定向循环
  matcher: [
    '/((?!api|legacy|_next/static|_next/image|icons|favicon.ico|manifest.json|sw.js).*)',
  ],
};

export default function proxy(request: NextRequest) {
  const ua = request.headers.get('user-agent') || '';
  const m = /(?:iPhone|iPad|iPod).*?OS (\d+)_/.exec(ua);
  if (!m) return NextResponse.next();

  const major = parseInt(m[1], 10);
  if (major > 9) return NextResponse.next();

  const url = request.nextUrl.clone();
  // 播放页保留 query（source/id/title/index 对 legacy 播放页同样有意义）
  if (url.pathname.startsWith('/play')) {
    url.pathname = '/legacy/play';
    return NextResponse.redirect(url);
  }

  url.pathname = '/legacy';
  url.search = '';
  return NextResponse.redirect(url);
}
