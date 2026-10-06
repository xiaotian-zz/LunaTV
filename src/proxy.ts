/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  getAuthInfoFromCookie,
  SIGNATURE_FRESHNESS_MS,
  verifyLocalPasswordHash,
} from '@/lib/auth';

/**
 * proxy.ts（Next.js 16 middleware 新约定）
 *
 * 职责一：旧设备全站自动切换（iOS 9.3 适配）
 * 现代前端（Tailwind v4 CSS + 新版 JS 语法）在 Safari 9 上无法运行：
 * CSS 层 oklch/@property/级联层全不支持导致整页样式失效，JS 层可选链等
 * 新语法直接 SyntaxError 白屏。因此 iOS 9.x 及以下设备访问任意主站页面时，
 * 一律 302 到 /legacy 轻量版（纯 ES5 + XHR + 原生 HLS，见 src/app/legacy）。
 *
 * 说明：iOS 9.3 时代的 UA 版本号真实可信（不存在新系统伪装低版本号的情况，
 * 反向伪装只发生在 iOS 26 报 18_x），按主版本 <= 9 判定即可。
 *
 * 职责二：服务端强制登录
 * 未登录访问页面 302 到 /login（携带 redirect 回跳参数），API 返回 401
 * （客户端 fetchWithAuth 收到 401 会自动跳登录页）。
 * 相比被删的旧版 middleware 的关键修复：
 * 1. localstorage 模式 cookie 校验改用 HMAC 哈希比对（verifyLocalPasswordHash），
 *    旧版明文对比在 cookie 改为哈希存储后必然失败，会导致登录死循环
 * 2. 数据库模式签名校验增加 7 天新鲜度检查（防窃取后无限重放）
 * 3. 受信网络自动登录 cookie 的 secure 标志按请求协议动态设置（http 部署可用）
 * 4. 放行 /legacy 及轻量版数据 API（iOS 9 轻量版有独立登录页，不强制主站登录）
 */

// ------------------------------------------------------------------
// iOS 9.x 及以下重定向到 /legacy
// ------------------------------------------------------------------

function getLegacyRedirect(request: NextRequest): NextResponse | null {
  const ua = request.headers.get('user-agent') || '';
  const m = /(?:iPhone|iPad|iPod).*?OS (\d+)_/.exec(ua);
  if (!m) return null;

  const major = parseInt(m[1], 10);
  if (major > 9) return null;

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

// ------------------------------------------------------------------
// 信任网络配置缓存（从 API 获取）
// ------------------------------------------------------------------

let trustedNetworkCache: { enabled: boolean; trustedIPs: string[] } | null =
  null;
let trustedNetworkCacheTime = 0;
let trustedNetworkFetched = false;
let trustedNetworkVersion = ''; // 跟踪配置版本，用于立即失效缓存

const CACHE_TTL = 86400000; // 24 小时缓存（配置变化时通过 cookie 版本号立即刷新）

// 从环境变量获取信任网络配置（优先）
function getTrustedNetworkFromEnv(): {
  enabled: boolean;
  trustedIPs: string[];
} | null {
  const trustedIPs = process.env.TRUSTED_NETWORK_IPS;
  if (!trustedIPs) return null;

  return {
    enabled: true,
    trustedIPs: trustedIPs
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
  };
}

// 从 API 获取信任网络配置（数据库）
async function getTrustedNetworkFromAPI(
  request: NextRequest,
): Promise<{ enabled: boolean; trustedIPs: string[] } | null> {
  const now = Date.now();

  // 检查缓存是否有效
  if (trustedNetworkFetched && trustedNetworkCache !== null) {
    if (now - trustedNetworkCacheTime < CACHE_TTL) {
      if (!trustedNetworkCache.enabled) {
        return null;
      }
      return trustedNetworkCache;
    }
  }

  // 如果已经获取过且结果是"未配置"，使用长缓存时间
  if (trustedNetworkFetched && trustedNetworkCache === null) {
    if (now - trustedNetworkCacheTime < CACHE_TTL) {
      return null;
    }
  }

  try {
    const url = new URL('/api/server-config', request.url);
    url.searchParams.set('key', 'TrustedNetworkConfig');

    const response = await fetch(url.toString(), {
      headers: {
        'x-internal-request': 'true',
      },
    });

    trustedNetworkFetched = true;
    trustedNetworkCacheTime = now;

    if (response.ok) {
      const data = await response.json();
      if (data.TrustedNetworkConfig) {
        trustedNetworkCache = {
          enabled: data.TrustedNetworkConfig.enabled ?? false,
          trustedIPs: data.TrustedNetworkConfig.trustedIPs || [],
        };

        if (!trustedNetworkCache.enabled) {
          return null;
        }

        return trustedNetworkCache;
      }
    }

    // API 返回但没有配置 - 标记为禁用而不是 null，这样走禁用缓存逻辑
    trustedNetworkCache = { enabled: false, trustedIPs: [] };
  } catch {
    // 请求失败时标记为禁用，使用长缓存时间避免频繁重试
    trustedNetworkCache = { enabled: false, trustedIPs: [] };
  }

  return null;
}

// 获取信任网络配置（环境变量优先，然后数据库）
async function getTrustedNetworkConfig(
  request: NextRequest,
): Promise<{ enabled: boolean; trustedIPs: string[] } | null> {
  // 环境变量优先
  const envConfig = getTrustedNetworkFromEnv();
  if (envConfig) return envConfig;

  // 检查 cookie 中的配置版本号
  // 管理页面保存配置时会更新这个 cookie，版本号变化时强制刷新缓存
  const cookieVersion = request.cookies.get('tn-version')?.value || '';
  if (cookieVersion && cookieVersion !== trustedNetworkVersion) {
    // 版本号变了，强制清除缓存，立即重新获取
    trustedNetworkCache = null;
    trustedNetworkFetched = false;
    trustedNetworkVersion = cookieVersion;
  }

  // 尝试从数据库获取（内部已处理禁用状态的缓存优化）
  return await getTrustedNetworkFromAPI(request);
}

// 获取客户端 IP
function getClientIP(request: NextRequest): string {
  // 按优先级获取客户端 IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

// 简化的 IP/CIDR 匹配（Edge Runtime 兼容）
function isIPInCIDR(clientIP: string, cidr: string): boolean {
  // 处理通配符
  if (cidr === '*') return true;

  // 检测 IPv6
  const isClientIPv6 = clientIP.includes(':');
  const isCIDRIPv6 = cidr.includes(':');

  // IPv4 和 IPv6 不能互相匹配
  if (isClientIPv6 !== isCIDRIPv6) return false;

  if (isClientIPv6) {
    // IPv6 简化匹配：只支持精确匹配和简单前缀匹配
    if (cidr.includes('/')) {
      const [network] = cidr.split('/');
      // 简化：检查是否以相同前缀开始
      return clientIP
        .toLowerCase()
        .startsWith(network.toLowerCase().replace(/:+$/, ''));
    }
    return clientIP.toLowerCase() === cidr.toLowerCase();
  }

  // IPv4 CIDR 匹配
  if (cidr.includes('/')) {
    const [network, maskStr] = cidr.split('/');
    const mask = parseInt(maskStr, 10);

    const networkParts = network.split('.').map(Number);
    const clientParts = clientIP.split('.').map(Number);

    if (clientParts.length !== 4 || networkParts.length !== 4) return false;
    if (clientParts.some((p) => isNaN(p)) || networkParts.some((p) => isNaN(p)))
      return false;

    // 转换为 32 位整数
    const networkInt =
      (networkParts[0] << 24) |
      (networkParts[1] << 16) |
      (networkParts[2] << 8) |
      networkParts[3];
    const clientInt =
      (clientParts[0] << 24) |
      (clientParts[1] << 16) |
      (clientParts[2] << 8) |
      clientParts[3];

    // 生成掩码
    const maskInt = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;

    return (networkInt & maskInt) === (clientInt & maskInt);
  }

  // 精确 IP 匹配
  return clientIP === cidr;
}

// 检查 IP 是否在信任网络中
function isIPTrusted(clientIP: string, trustedIPs: string[]): boolean {
  return trustedIPs.some((trustedIP) => isIPInCIDR(clientIP, trustedIP.trim()));
}

// 生成信任网络的自动登录 cookie
async function generateTrustedAuthCookie(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next();

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const username = process.env.USERNAME || 'admin';
  // secure 标志按请求协议动态设置：http 直连部署（如 IP:3000）下 secure cookie
  // 不会被浏览器存储，必须与 login 路由的 generateAuthCookie 策略保持一致
  const isHttps = request.nextUrl.protocol === 'https:';

  if (storageType === 'localstorage') {
    // localstorage 模式：cookie 只存密码的 HMAC 哈希（与 generateAuthCookie 一致）
    const authInfo = {
      password: process.env.PASSWORD
        ? 'trusted-network-placeholder'
        : undefined,
      trustedNetwork: true,
      loginTime: Date.now(),
    };
    response.cookies.set('user_auth', JSON.stringify(authInfo), {
      httpOnly: false,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 天
    });
  } else {
    // 数据库模式：设置受信网络标记 cookie（无签名，仅当受信网络匹配时才发放，
    // 后续请求靠 trustedNetwork 标记放行）
    const authInfo = {
      username,
      trustedNetwork: true,
      timestamp: Date.now(),
      loginTime: Date.now(),
      role: 'owner',
    };
    response.cookies.set('user_auth', JSON.stringify(authInfo), {
      httpOnly: false,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 天
    });
  }

  return response;
}

// ------------------------------------------------------------------
// 主入口
// ------------------------------------------------------------------

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. 处理 /adult/ 路径前缀，重写为实际 API 路径
  if (pathname.startsWith('/adult/')) {
    // 移除 /adult 前缀
    const newPathname = pathname.replace(/^\/adult/, '');

    // 创建新的 URL
    const url = request.nextUrl.clone();
    url.pathname = newPathname || '/';

    // 添加 adult=1 参数（如果还没有）
    if (!url.searchParams.has('adult')) {
      url.searchParams.set('adult', '1');
    }

    // 重写请求
    const response = NextResponse.rewrite(url);

    // 设置响应头标识成人内容模式
    response.headers.set('X-Content-Mode', 'adult');

    // 继续执行认证检查（对于 API 路径）
    if (newPathname.startsWith('/api')) {
      // 将重写后的请求传递给认证逻辑
      const modifiedRequest = new NextRequest(url, request);
      return handleAuthentication(modifiedRequest, newPathname, response);
    }

    return response;
  }

  // 2. iOS 9.x 及以下全站重定向（仅页面请求；API 与 legacy 自身不处理）
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/legacy')) {
    const legacyRedirect = getLegacyRedirect(request);
    if (legacyRedirect) return legacyRedirect;
  }

  // 3. 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  // 4. 认证检查
  return handleAuthentication(request, pathname);
}

// ------------------------------------------------------------------
// 认证逻辑
// ------------------------------------------------------------------

// 提取认证处理逻辑为单独的函数
async function handleAuthentication(
  request: NextRequest,
  pathname: string,
  response?: NextResponse,
) {
  // 检查信任网络模式（环境变量优先，然后数据库）
  const trustedNetworkConfig = await getTrustedNetworkConfig(request);
  if (
    trustedNetworkConfig?.enabled &&
    trustedNetworkConfig.trustedIPs.length > 0
  ) {
    const clientIP = getClientIP(request);

    if (isIPTrusted(clientIP, trustedNetworkConfig.trustedIPs)) {
      // 检查是否已经有有效的认证 cookie
      const existingAuth = getAuthInfoFromCookie(request);
      if (
        existingAuth &&
        (existingAuth.password ||
          existingAuth.trustedNetwork ||
          existingAuth.signature)
      ) {
        return response || NextResponse.next();
      }

      // 没有认证 cookie，自动生成并设置
      return generateTrustedAuthCookie(request);
    }
  }

  const storageType =
    (process.env.NEXT_PUBLIC_STORAGE_TYPE as
      | 'localstorage'
      | 'redis'
      | 'upstash'
      | 'kvrocks'
      | 'sqlite'
      | undefined) || 'localstorage';

  if (!process.env.PASSWORD) {
    // 未配置密码的本地模式 = 免登录（与 /api/login 的放行策略保持一致）
    if (storageType === 'localstorage') {
      return response || NextResponse.next();
    }
    // 数据库模式未配置密码属于错误配置，导向警告页
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // 受信网络标记放行（cookie 由受信网络自动登录发放）
  if (authInfo.trustedNetwork) {
    return response || NextResponse.next();
  }

  // localstorage 模式：cookie 中存的是密码的 HMAC 哈希，
  // 用 HMAC 基准值比对（旧版明文对比在 cookie 改哈希后必然失败）
  if (storageType === 'localstorage') {
    const isValid = await verifyLocalPasswordHash(authInfo.password);
    if (!isValid) {
      return handleAuthFailure(request, pathname);
    }
    return response || NextResponse.next();
  }

  // 数据库模式：必须有用户名和签名
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // 验证签名（含 7 天新鲜度检查，防重放）
  const isValidSignature = await verifyUserSignature(
    authInfo.username,
    authInfo.signature,
    authInfo.timestamp,
    process.env.PASSWORD || '',
  );

  if (isValidSignature) {
    return response || NextResponse.next();
  }

  // 签名验证失败或不存在签名
  return handleAuthFailure(request, pathname);
}

// 验证用户签名：HMAC-SHA256(username:timestamp, PASSWORD)，签名数据与
// generateAuthCookie 的生成逻辑保持一致，并校验签名新鲜度（7 天）
async function verifyUserSignature(
  username: string,
  signature: string,
  timestamp: number | undefined,
  secret: string,
): Promise<boolean> {
  if (!secret) return false;

  // 新鲜度检查：签名时间戳缺失或超过有效期即拒绝（与 cookie 7 天 maxAge 一致）
  if (!timestamp || Date.now() - timestamp > SIGNATURE_FRESHNESS_MS) {
    return false;
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(`${username}:${timestamp}`);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData,
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string,
): NextResponse {
  // 如果是 API 路由，返回 401 状态码（客户端 fetchWithAuth 收到 401 自动跳登录）
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否则重定向到登录页面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    // 页面白名单
    '/login',
    '/register',
    '/oidc-register',
    '/warning',
    // iOS 9 轻量版（独立登录体系）
    '/legacy',
    // 无需认证的 API（轻量版数据源、播放代理、OIDC 回调、观影室等）
    '/api/login',
    '/api/register',
    '/api/logout',
    '/api/cron',
    '/api/server-config',
    '/api/tvbox',
    '/api/live/',
    '/api/parse',
    '/api/bing-wallpaper',
    '/api/proxy/',
    '/api/telegram/',
    '/api/auth/oidc/',
    '/api/watch-room/',
    '/api/cache/',
    '/api/douban/',
    '/api/bangumi/',
    '/api/shortdrama/',
    '/api/source-browser/',
    '/api/detail',
    '/api/search',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 匹配规则：排除纯静态资源（页面/API/legacy 的放行在函数内处理，
// 因为认证需要覆盖 API 路由返回 401）
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.json|sw.js|icons/|logo.png|screenshot.png).*)',
  ],
};
