/* eslint-disable no-console */
// ------------------------------------------------------------------
// 会话活跃日志工具（proxy.ts 用；login route 有本地实现，互不影响）
// ------------------------------------------------------------------

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    'localstorage' | 'redis' | 'upstash' | 'kvrocks' | 'sqlite' | undefined) ||
  'localstorage';

function getClientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0].trim();
  }
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return headers.get('cf-connecting-ip') || 'unknown';
}

// IP 归属地查询：主用 ip-api.com，备用 ip.useragentinfo.com，均为 3s 超时
async function getIpLocation(ip: string): Promise<string> {
  if (
    ip === 'unknown' ||
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.')
  ) {
    return '本地网络';
  }
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?lang=zh-CN&fields=status,country,regionName,city`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        // 去重相邻重复（如"中国 广东 广东"）
        const parts = [data.country, data.regionName, data.city].filter(
          Boolean,
        );
        const deduped = parts.filter((v, i) => i === 0 || v !== parts[i - 1]);
        return deduped.join(' ');
      }
    }
  } catch {}
  try {
    const res = await fetch(`https://ip.useragentinfo.com/json?ip=${ip}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.country || data.province || data.city) {
        const parts = [data.country, data.province, data.city].filter(Boolean);
        const deduped = parts.filter((v, i) => i === 0 || v !== parts[i - 1]);
        return deduped.join(' ');
      }
    }
  } catch {}
  return '未知';
}

// 解析 User-Agent 获取设备/浏览器/OS 信息
function parseUserAgent(ua: string): {
  device: string;
  browser: string;
  os: string;
} {
  const isTablet = /iPad|Tablet/i.test(ua);
  const isMobile = /Mobile|Android|iPhone/i.test(ua);
  const device = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /QQBrowser\//.test(ua)
      ? 'QQ浏览器'
      : /MicroMessenger\//.test(ua)
        ? '微信'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari/.test(ua)
              ? 'Safari'
              : 'Other';

  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Other';

  return { device, browser, os };
}

// ------------------------------------------------------------------
// 会话活跃日志：cookie 有效期内（7 天）用户不会重复走登录接口，
// 登录日志因此缺少"当天活跃"记录。此函数在认证通过时按
// 用户+天 节流补记一条 loginMethod='session' 的日志，
// 与真实登录记录区分展示。
// ------------------------------------------------------------------

// 内存节流表：username -> 已记录的日期（YYYY-MM-DD）。
// 重启后清空最多导致当天多记一条，无碍。
const sessionLoggedToday = new Map<string, string>();

export async function recordSessionActivity(
  headers: Headers,
  username: string,
): Promise<void> {
  if (STORAGE_TYPE === 'localstorage') return;
  if (!username) return;

  const today = new Date().toISOString().slice(0, 10);
  if (sessionLoggedToday.get(username) === today) return;
  sessionLoggedToday.set(username, today);

  try {
    const ip = getClientIp(headers);
    const location = await getIpLocation(ip);
    const userAgent = headers.get('user-agent') || '';
    const { device, browser, os } = parseUserAgent(userAgent);
    const { db } = await import('@/lib/db');
    await db.addLoginLog({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      username,
      loginTime: Date.now(),
      ip,
      location,
      userAgent,
      device,
      browser,
      os,
      loginMethod: 'session',
    });
  } catch (error) {
    console.error('记录会话活跃日志失败:', error);
  }
}
