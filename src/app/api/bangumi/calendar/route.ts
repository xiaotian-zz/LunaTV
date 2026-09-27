import { NextRequest, NextResponse } from 'next/server';

import { GetBangumiCalendarData } from '@/lib/bangumi.server';

export const runtime = 'nodejs';

/**
 * Bangumi 每日放送代理端点。
 * 主站 /douban?type=anime 的「每日放送」由浏览器直连 api.bgm.tv；
 * iOS 9.3 轻量版无法直连（无 fetch/现代 TLS），改由服务端代理并
 * 按 weekday 过滤（Mon/Tue/.../Sun），字段映射与主站 doubanListOptions 一致。
 */
export async function GET(request: NextRequest) {
  const weekday = new URL(request.url).searchParams.get('weekday') || '';

  const calendar = await GetBangumiCalendarData();
  if (!Array.isArray(calendar) || !calendar.length) {
    return NextResponse.json(
      { code: 500, message: 'error', list: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const day = weekday
    ? calendar.find((d) => d.weekday && d.weekday.en === weekday)
    : calendar[0];
  const items = day ? day.items : [];

  const list = items.map((item) => ({
    id: item.id != null ? String(item.id) : '',
    title: item.name_cn || item.name || '',
    poster:
      item.images?.large ||
      item.images?.common ||
      item.images?.medium ||
      item.images?.small ||
      item.images?.grid ||
      '/placeholder-poster.jpg',
    rate: item.rating?.score ? item.rating.score.toFixed(1) : '',
    year: item.air_date ? String(item.air_date).split('-')[0] || '' : '',
  }));

  return NextResponse.json(
    { code: 200, message: 'success', list },
    {
      headers: {
        // 日历数据低频变化（服务端另有 300s revalidate），允许边缘缓存
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    },
  );
}
