import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { buildLegacyNav, renderLegacyPageWithConfig } from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版搜索页（对应主站 /search）：搜索框 + 聚合结果网格。
 * 纯 ES5 + XHR，兼容约束见 src/lib/legacy-html.ts。
 */
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  const loggedIn = !!(authInfo && authInfo.username);

  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || '聚合TV';
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType !== 'localstorage') {
    try {
      siteName = (await getConfig()).SiteConfig.SiteName || siteName;
    } catch {
      // 配置读取失败时用默认站点名
    }
  }

  if (!loggedIn) {
    return new NextResponse(
      await renderLegacyPageWithConfig({
        title: '搜索',
        siteName,
        body:
          '<div class="card"><h2 class="pt">请先登录</h2>' +
          '<a class="btn" href="/legacy">去登录</a></div>',
      }),
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  return new NextResponse(
    await renderLegacyPageWithConfig({
      title: '搜索',
      siteName,
      body: `
${buildLegacyNav('search')}
<div class="searchrow card">
  <input type="text" id="kw" placeholder="输入影视名称搜索">
  <button class="btn" id="go" type="button">搜 索</button>
  <div id="smsg" class="msg"></div>
</div>
<div id="results"><div class="loading">输入片名开始搜索</div></div>`,
      script: searchScript(),
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

function searchScript(): string {
  return `
(function () {
  var go = document.getElementById('go');
  var kw = document.getElementById('kw');
  var box = document.getElementById('results');

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  function doSearch() {
    var q = kw.value.replace(/^\\s+|\\s+$/g, '');
    if (!q) return;
    box.innerHTML = '<div class="loading">搜索中…</div>';
    lunaShow('smsg', '', '');
    lunaXhr('GET', '/api/search?q=' + encodeURIComponent(q), null, function (status, data) {
      if (status !== 200 || !data) {
        box.innerHTML = '';
        lunaShow('smsg', '搜索失败，请重试', 'err');
        return;
      }
      var list = data.results || [];
      if (!list.length) { box.innerHTML = '<div class="loading">没有找到相关结果</div>'; return; }
      var html = '';
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var epCount = (it.episodes && it.episodes.length) || 0;
        var sub = esc(it.source_name || '') + (epCount ? ' · ' + epCount + '集' : '') +
          (it.remarks ? ' · ' + esc(it.remarks) : '');
        html += '<a class="item" href="/legacy/play?source=' + encodeURIComponent(it.source || '') +
          '&id=' + encodeURIComponent(it.id || '') +
          '&title=' + encodeURIComponent(it.title || '') + '">' +
          '<span class="pic" style="background-image:url(' + esc(lunaImg(it.poster)) + ')"></span>' +
          '<span class="t">' + esc(it.title) + '</span>' +
          '<span class="s">' + sub + '</span></a>';
      }
      box.innerHTML = html;
    });
  }

  go.onclick = doSearch;
  kw.onkeydown = function (e) {
    var key = e.keyCode || e.which;
    if (key === 13) doSearch();
  };
})();`;
}
