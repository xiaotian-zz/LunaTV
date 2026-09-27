import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { buildLegacyNav, renderLegacyPageWithConfig } from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版详情页：豆瓣条目 → 标题聚合搜索 → 按源分组展示可用版本，
 * 复刻主站“选源进入播放”的流程。纯 ES5 + XHR。
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);

  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || '聚合TV';
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType !== 'localstorage') {
    try {
      siteName = (await getConfig()).SiteConfig.SiteName || siteName;
    } catch {
      // 配置读取失败时用默认站点名
    }
  }

  if (!authInfo || !authInfo.username) {
    return new NextResponse(
      await renderLegacyPageWithConfig({
        title: '详情',
        siteName,
        body: `<div class="card"><h2 class="pt">请先登录</h2>
<a class="btn" style="margin-top:12px" href="/legacy">去登录</a></div>`,
      }),
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // iOS Safari 会启发式缓存无缓存头的 HTML，导致轻量版改版后设备仍显示旧页
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  return new NextResponse(
    await renderLegacyPageWithConfig({
      title: '详情',
      siteName,
      body: `
${buildLegacyNav('')}
<div class="card"><div id="vinfo"><div class="loading">加载中…</div></div></div>
<div id="smsg" class="msg"></div>
<div id="versions"></div>`,
      script: detailScript(),
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // iOS Safari 会启发式缓存无缓存头的 HTML，导致轻量版改版后设备仍显示旧页
        'Cache-Control': 'no-store',
      },
    },
  );
}

function detailScript(): string {
  return `
(function () {
  var title = lunaQs('title');
  var doubanId = lunaQs('douban_id');
  var year = lunaQs('year');
  var stype = lunaQs('stype');
  var infoBox = document.getElementById('vinfo');
  var verBox = document.getElementById('versions');

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  lunaXhr('GET', '/api/search?q=' + encodeURIComponent(title), null, function (status, data) {
    if (status !== 200 || !data) {
      infoBox.innerHTML = '<h2 class="pt">' + esc(title) + '</h2><div class="loading">加载失败，请返回重试</div>';
      lunaShow('smsg', '搜索失败，请重试', 'err');
      return;
    }
    var list = data.results || [];

    // 头部信息：取第一个有海报的结果展示
    var poster = '';
    for (var i = 0; i < list.length; i++) { if (list[i].poster) { poster = list[i].poster; break; } }
    var head = '<span class="dposter" style="background-image:url(' + esc(lunaImg(poster)) + ')"></span>' +
      '<div class="dmeta"><h2 class="pt">' + esc(title) + '</h2>' +
      (year ? '<p class="s">年份：' + esc(year) + '</p>' : '') +
      (doubanId ? '<p class="s">豆瓣ID：' + esc(doubanId) + '</p>' : '') +
      '</div>';
    infoBox.innerHTML = head;

    // 按源分组，每组取第一个结果作为可用版本
    var seen = {};
    var groups = [];
    for (var j = 0; j < list.length; j++) {
      var it = list[j];
      if (!it.source || !it.id || seen[it.source]) continue;
      seen[it.source] = true;
      groups.push(it);
    }
    if (!groups.length) {
      verBox.innerHTML = '<div class="loading">没有找到可播放的版本</div>';
      return;
    }
    var html = '<div class="tabgrp">播放版本（' + groups.length + '个源）</div><div class="card">';
    for (var k = 0; k < groups.length; k++) {
      var v = groups[k];
      var epCount = (v.episodes && v.episodes.length) || 0;
      var sub = (epCount ? epCount + '集' : '') + (v.remarks ? ' · ' + v.remarks : '');
      // 播放页 URL 参数与主站 /play 一致：title/year/douban_id/stype/source/id
      html += '<a class="ver" href="/legacy/play?title=' + encodeURIComponent(v.title || title) +
        '&year=' + encodeURIComponent(year) +
        '&douban_id=' + encodeURIComponent(doubanId) +
        '&stype=' + encodeURIComponent(stype) +
        '&source=' + encodeURIComponent(v.source) +
        '&id=' + encodeURIComponent(v.id) + '&index=0">' +
        '<span class="vname">' + esc(v.source_name || v.source) + '</span>' +
        '<span class="s">' + esc(sub || '可播放') + '</span></a>';
    }
    verBox.innerHTML = html + '</div>';
  });
})();`;
}
