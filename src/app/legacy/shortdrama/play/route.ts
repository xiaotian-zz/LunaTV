import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { buildLegacyNav, renderLegacyPageWithConfig } from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版短剧播放页：/api/shortdrama/detail 解析播放地址，
 * <video> 原生播放（服务端已优先返回代理地址），标题 + 选集 + 上一集/下一集。
 * 纯 ES5 + XHR，兼容约束见 src/lib/legacy-html.ts。
 */

/** 本组页面的导航：统一使用 buildLegacyNav（含直播/短剧项） */
function buildPageNav(cur: string): string {
  return buildLegacyNav(cur);
}

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
        title: '短剧播放',
        siteName,
        body: `<div class="card"><h2 class="pt">请先登录</h2>
<p class="hint">登录后即可播放</p>
<a class="btn" style="margin-top:12px" href="/legacy">去登录</a></div>`,
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
      title: '短剧播放',
      siteName,
      body: `
${buildPageNav('shortdrama')}
<h2 class="pt" id="vtitle">加载中…</h2>
<video id="player" controls playsinline webkit-playsinline preload="auto" x-webkit-airplay="allow"></video>
<div id="pmsg" class="msg"></div>
<div class="navrow">
  <a class="nav" id="prevBtn" href="javascript:void(0)">&#8249; 上一集</a>
  <a class="nav" id="nextBtn" href="javascript:void(0)">下一集 &#8250;</a>
</div>
<div class="eps" id="eps"></div>
<p class="hint">播放地址由服务端实时解析，首次加载稍慢请耐心等待。</p>`,
      script: playScript(),
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

function playScript(): string {
  return `
(function () {
  // URL 参数：id（短剧 ID）、name（剧名，供备用 API 解析）、ep（当前集，从 1 开始）
  var id = lunaQs('id');
  var name = lunaQs('name');
  var cur = parseInt(lunaQs('ep') || '1', 10) || 1;
  var total = 1;

  var video = document.getElementById('player');
  var epsBox = document.getElementById('eps');
  var loading = false;

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  function updateNav() {
    var prev = document.getElementById('prevBtn');
    var next = document.getElementById('nextBtn');
    prev.style.visibility = cur > 1 ? 'visible' : 'hidden';
    next.style.visibility = cur < total ? 'visible' : 'hidden';
  }

  function renderEps() {
    var html = '';
    for (var i = 1; i <= total; i++) {
      html += '<a class="ep' + (i === cur ? ' cur' : '') + '" href="javascript:void(0)" data-i="' + i + '">第' + i + '集</a>';
    }
    epsBox.innerHTML = html;
    var nodes = epsBox.getElementsByTagName('a');
    for (var k = 0; k < nodes.length; k++) {
      nodes[k].onclick = function () {
        play(parseInt(this.getAttribute('data-i'), 10));
      };
    }
  }

  function syncUrl() {
    try {
      history.replaceState(null, '', '/legacy/shortdrama/play?id=' + encodeURIComponent(id) +
        '&name=' + encodeURIComponent(name) + '&ep=' + cur);
    } catch (e) {}
  }

  function play(ep) {
    if (loading || !id) return;
    loading = true;
    cur = ep;
    lunaShow('pmsg', '', '');
    document.getElementById('vtitle').innerHTML = '解析第' + ep + '集…';
    var url = '/api/shortdrama/detail?id=' + encodeURIComponent(id) +
      '&episode=' + ep +
      (name ? '&name=' + encodeURIComponent(name) : '');
    lunaXhr('GET', url, null, function (status, data) {
      loading = false;
      if (status !== 200 || !data || !data.url) {
        document.getElementById('vtitle').innerHTML = esc(name || '短剧');
        lunaShow('pmsg', (data && data.error) || '该集暂时无法播放，请稍后重试或换一集', 'err');
        return;
      }
      total = data.totalEpisodes || 1;
      if (data.episode) cur = data.episode; // 服务端可能自动跳过失效集
      document.getElementById('vtitle').innerHTML = esc(data.title || name || '短剧') + ' · 第' + cur + '集';
      video.src = data.url;
      video.load();
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
      renderEps();
      updateNav();
      syncUrl();
    });
  }

  document.getElementById('prevBtn').onclick = function () {
    if (cur > 1) play(cur - 1);
  };
  document.getElementById('nextBtn').onclick = function () {
    if (cur < total) play(cur + 1);
  };

  if (!id) {
    document.getElementById('vtitle').innerHTML = '参数错误';
    lunaShow('pmsg', '缺少短剧 ID，请从短剧页进入', 'err');
  } else {
    play(cur);
  }
})();`;
}
