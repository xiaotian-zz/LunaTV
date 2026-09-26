import { NextResponse } from 'next/server';

// 播放卡死自动诊断报告（内存存储，进程重启即清空）
// 用于远程诊断 iOS 26 MMS「有缓冲但不播」类问题；
// 快照不含敏感信息（URL 仅保留截断后的路径）
const reports: Record<string, unknown>[] = [];
const MAX_REPORTS = 20;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    reports.unshift({
      ...(typeof body === 'object' && body !== null ? body : {}),
      serverTs: Date.now(),
    });
    if (reports.length > MAX_REPORTS) {
      reports.length = MAX_REPORTS;
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ reports });
}
