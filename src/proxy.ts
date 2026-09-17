/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  generateSignature,
  getAuthInfoFromCookie,
  SIGNATURE_FRESHNESS_MS,
  verifyLocalPasswordHash,
} from '@/lib/auth';
import { getConfig } from '@/lib/config';

// 信任网络配置缓存（从 API 获取）
let trustedNetworkCache: {
  enabled: boolean;
  trustedIPs: string[];
  blockAdminAccess: boolean;
} | null = null;
let trustedNetworkCacheTime = 0;
let trustedNetworkFetched = false;
let trustedNetworkVersion = ''; // 跟踪配置版本，用于立即失效缓存

const CACHE_TTL = 86400000; // 24 小时缓存（配置变化时通过 cookie 版本号立即刷新）

// 从环境变量获取信任网络配置（优先）
function getTrustedNetworkFromEnv(): {
  enabled: boolean;
  trustedIPs: string[];
  blockAdminAccess: boolean;
} | null {
  const trustedIPs = process.env.TRUSTED_NETWORK_IPS;
  if (!trustedIPs) return null;

  return {
    enabled: true,
    trustedIPs: trustedIPs
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
    blockAdminAccess: false,
  };
}

// 从配置中心获取信任网络配置（数据库模式）。
// 直接读取配置，不再通过 HTTP 自调用 /api/server-config（该端点在 matcher 中
// 无需认证，且自定义请求头可被任意伪造——曾可借此读取信任 IP 列表）。
async function getTrustedNetworkFromConfig(): Promise<{
  enabled: boolean;
  trustedIPs: string[];
  blockAdminAccess: boolean;
} | null> {
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

  try {
    const config = await getConfig();

    trustedNetworkFetched = true;
    trustedNetworkCacheTime = now;

    if (config.TrustedNetworkConfig) {
      trustedNetworkCache = {
        enabled: config.TrustedNetworkConfig.enabled ?? false,
        trustedIPs: config.TrustedNetworkConfig.trustedIPs || [],
        blockAdminAccess: config.TrustedNetworkConfig.blockAdminAccess === true,
      };

      if (!trustedNetworkCache.enabled) {
        return null;
      }

      return trustedNetworkCache;
    }

    // 配置中心没有该配置 - 标记为禁用，走禁用缓存逻辑
    trustedNetworkCache = {
      enabled: false,
      trustedIPs: [],
      blockAdminAccess: false,
    };
  } catch {
    // 读取失败时标记为禁用，使用长缓存时间避免频繁重试
    trustedNetworkFetched = true;
    trustedNetworkCacheTime = now;
    trustedNetworkCache = {
      enabled: false,
      trustedIPs: [],
      blockAdminAccess: false,
    };
  }

  return null;
}

// 获取信任网络配置（环境变量优先，然后数据库）
async function getTrustedNetworkConfig(request: NextRequest): Promise<{
  enabled: boolean;
  trustedIPs: string[];
  blockAdminAccess: boolean;
} | null> {
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

  // 尝试从配置中心获取（内部已处理禁用状态的缓存优化）
  return await getTrustedNetworkFromConfig();
}

// 信任网络专用 IP 判定：仅当显式配置 TRUST_PROXY=true（部署在可信反代后、
// 反代会覆盖 XFF 头）时才信任请求头。默认（直连部署）下 x-forwarded-for /
// x-real-ip 均可被客户端任意伪造——曾可借此伪造内网 IP 命中信任列表，
// 直接获得 owner 会话。默认返回 'unknown'，使自动登录保守跳过。
function getTrustedClientIP(request: NextRequest): string {
  if (process.env.TRUST_PROXY !== 'true') {
    return 'unknown';
  }

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

// 常见弱默认密码/凭据黑名单（小写比对）。命中时视同未配置密码，
// 强制走 /warning 页而不是静默放行——这类值通常来自教程截图、示例配置复制粘贴。
const WEAK_DEFAULT_CREDENTIALS = new Set([
  'admin',
  'admin123',
  'password',
  'password123',
  '123456',
  '12345678',
  'changeme',
  'letmein',
  'lunatv',
  'moontv',
]);

function isWeakDefaultCredential(value: string): boolean {
  return WEAK_DEFAULT_CREDENTIALS.has(value.toLowerCase());
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

// 生成信任网络的自动登录 cookie（带签名，防伪造/篡改）
async function generateTrustedAuthCookie(
  request: NextRequest,
): Promise<NextResponse> {
  const response = NextResponse.next();

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const username = process.env.USERNAME || 'admin';
  // secure 按请求协议动态判定：HTTPS 下仅加密传输，HTTP 直连下仍保持可用
  const secure = request.nextUrl.protocol === 'https:';
  const timestamp = Date.now();

  if (storageType === 'localstorage') {
    // localstorage 模式：设置密码哈希 cookie（绝不存明文密码）
    const authInfo: Record<string, unknown> = {
      loginTime: timestamp,
    };
    if (process.env.PASSWORD) {
      authInfo.password = await generateSignature(
        process.env.PASSWORD,
        process.env.PASSWORD,
      );
    }
    response.cookies.set('user_auth', JSON.stringify(authInfo), {
      httpOnly: false, // 客户端需读取 username/role（PWA）；password 已哈希非明文
      secure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 天
    });
  } else {
    // 数据库模式：带签名的信任标记 cookie（防伪造 {trustedNetwork:true} 提权）
    const authInfo: Record<string, unknown> = {
      username,
      trustedNetwork: true,
      timestamp,
      loginTime: timestamp,
      role: 'owner',
    };
    if (process.env.PASSWORD) {
      authInfo.signature = await generateSignature(
        `${username}:${timestamp}`,
        process.env.PASSWORD,
      );
    }
    response.cookies.set('user_auth', JSON.stringify(authInfo), {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 天
    });
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 处理 /adult/ 路径前缀，重写为实际 API 路径
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

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  return handleAuthentication(request, pathname);
}

// 提取认证处理逻辑为单独的函数
async function handleAuthentication(
  request: NextRequest,
  pathname: string,
  response?: NextResponse,
) {
  // 🔥 检查信任网络模式（环境变量优先，然后配置中心）
  const trustedNetworkConfig = await getTrustedNetworkConfig(request);
  if (
    trustedNetworkConfig?.enabled &&
    trustedNetworkConfig.trustedIPs.length > 0
  ) {
    const clientIP = getTrustedClientIP(request);

    if (isIPTrusted(clientIP, trustedNetworkConfig.trustedIPs)) {
      // 加固开关：禁止信任网络访客访问后台
      // 命中 /admin 或 /api/admin/* 时，跳过自动登录分支，落到下方密码/签名校验
      const isAdminPath =
        pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
      if (trustedNetworkConfig.blockAdminAccess && isAdminPath) {
        // 不签发也不复用 trustedNetwork cookie，让请求走标准认证流程
        // 后面 authInfo.trustedNetwork 短路那里还会再拦一次（针对已有 cookie 的情况）
      } else {
        console.log(
          `[Middleware] Trusted network auto-login for IP: ${clientIP}`,
        );

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

        // 没有认证 cookie，自动生成并设置（带签名）
        return await generateTrustedAuthCookie(request);
      }
    }
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (!process.env.PASSWORD) {
    // 未设置密码，重定向到警告页面
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  if (isWeakDefaultCredential(process.env.PASSWORD)) {
    // 已设置密码，但命中常见弱默认值黑名单（admin/admin123/password等）——
    // 用不同的 reason 参数区分，避免用户误以为环境变量没生效
    const warningUrl = new URL('/warning', request.url);
    warningUrl.searchParams.set('reason', 'weak-password');
    return NextResponse.redirect(warningUrl);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // localstorage 模式：在middleware中完成验证
  // cookie 里的 password 存的是哈希（非明文），与 HMAC(PASSWORD, PASSWORD) 比对
  if (storageType === 'localstorage') {
    const storedHash = authInfo.password;
    if (!(await verifyLocalPasswordHash(storedHash))) {
      return handleAuthFailure(request, pathname);
    }
    return response || NextResponse.next();
  }

  // 其他模式：验证签名或信任网络标记
  // 🔥 信任网络模式：检查 trustedNetwork 标记
  // 信任 cookie 必须带有效签名（防伪造 {trustedNetwork:true} 直接提权），
  // 且当前 IP 仍在信任列表内（离开信任网络后 cookie 立即失效，防重放）
  if (authInfo.trustedNetwork) {
    const trustValid =
      trustedNetworkConfig?.enabled &&
      trustedNetworkConfig.trustedIPs.length > 0 &&
      isIPTrusted(
        getTrustedClientIP(request),
        trustedNetworkConfig.trustedIPs,
      ) &&
      !!authInfo.username &&
      !!authInfo.signature &&
      typeof authInfo.timestamp === 'number' &&
      (await verifySignature(
        `${authInfo.username}:${authInfo.timestamp}`,
        authInfo.signature,
        process.env.PASSWORD || '',
      ));

    if (!trustValid) {
      return handleAuthFailure(request, pathname);
    }

    // 加固开关：信任网络访客的 cookie 不允许进入后台
    if (
      trustedNetworkConfig?.blockAdminAccess &&
      (pathname.startsWith('/admin') || pathname.startsWith('/api/admin'))
    ) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response || NextResponse.next();
  }

  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // 验证签名（如果存在）
  if (authInfo.signature) {
    // 新鲜度校验：签名覆盖时间戳，超过 7 天即失效（防窃取后无限期重放）
    const isFresh =
      typeof authInfo.timestamp === 'number' &&
      Date.now() - authInfo.timestamp < SIGNATURE_FRESHNESS_MS;

    const isValidSignature =
      isFresh &&
      (await verifySignature(
        `${authInfo.username}:${authInfo.timestamp}`,
        authInfo.signature,
        process.env.PASSWORD || '',
      ));

    // 签名验证通过即可
    if (isValidSignature) {
      return response || NextResponse.next();
    }
  }

  // 签名验证失败或不存在签名
  return handleAuthFailure(request, pathname);
}

// 验证签名
async function verifySignature(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

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
  // 如果是 API 路由，返回 401 状态码
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
    '/api/telegram/', // Telegram API 端点
    '/api/cache/', // 缓存 API 端点（内部使用，无需认证）
    '/api/client-log', // 客户端日志收集端点（无需认证）
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配规则
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|register|oidc-register|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/tvbox|api/live/merged|api/parse|api/bing-wallpaper|api/proxy/|api/telegram/|api/auth/oidc/|api/watch-room/).*)',
  ],
};
