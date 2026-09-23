import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 禁用缓存

/**
 * GET /api/ad-filter
 * 获取去广告配置（公开接口，无需认证）
 * 支持两种模式：
 * - 不带参数：只返回开关状态
 * - ?full=true：返回完整代码和版本号（含开关状态）
 */
export async function GET(request: Request) {
  try {
    const config = await getConfig();
    const { searchParams } = new URL(request.url);
    const full = searchParams.get('full') === 'true';

    const enabled = config.SiteConfig?.CustomAdFilterEnabled !== false;
    const version = config.SiteConfig?.CustomAdFilterVersion || 0;

    if (full) {
      // 返回完整代码和版本号
      return NextResponse.json({
        enabled,
        code: config.SiteConfig?.CustomAdFilterCode || '',
        version,
      });
    } else {
      // 只返回开关状态
      return NextResponse.json({
        enabled,
      });
    }
  } catch (error) {
    console.error('获取去广告配置失败:', error);
    return NextResponse.json(
      { error: '获取配置失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
