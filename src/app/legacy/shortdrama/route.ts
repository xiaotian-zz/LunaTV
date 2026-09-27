import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { buildLegacyNav, renderLegacyPageWithConfig } from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版短剧页（对应主站 /shortdrama）：分类胶囊 + 封面网格 + 搜索 + 加载更多。
 * 纯 ES5 + XHR，兼容约束见 src/lib/legacy-html.ts。
 * 数据端点与主站一致：/api/shortdrama/categories、/api/shortdrama/list、/api/shortdrama/search。
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
        title: '短剧',
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
      title: '短剧',
      siteName,
      body: `
${buildPageNav('shortdrama')}
<h2 class="pt">短剧频道 · 精彩短剧一刷到底</h2>
<div class="searchrow card">
  <input type="text" id="kw" placeholder="搜索短剧名称...">
  <button class="btn" id="go" type="button">搜 索</button>
  <button class="btn gray" id="clearBtn" type="button" style="display:none">清除搜索</button>
</div>
<div id="cats"><div class="loading">分类加载中…</div></div>
<div id="results" style="text-align:center"><div class="loading">加载中…</div></div>
<div style="text-align:center"><a class="btn" id="more" href="javascript:void(0)" style="display:none;width:60%">加载更多</a></div>`,
      script: shortDramaScript(),
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

function shortDramaScript(): string {
  return `
(function () {
  var PAGE = 20;
  var catsBox = document.getElementById('cats');
  var box = document.getElementById('results');
  var more = document.getElementById('more');
  var kw = document.getElementById('kw');
  var go = document.getElementById('go');
  var clearBtn = document.getElementById('clearBtn');

  var cats = [];
  var cat = 0;
  var page = 1;
  var mode = 'cat'; // 'cat' | 'search'
  var q = '';
  var busy = false;

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  function renderItem(it) {
    var sub = [];
    if (it.episode_count) sub.push('共' + it.episode_count + '集');
    if (it.update_time) sub.push(esc(String(it.update_time).replace('T', ' ').substring(0, 10)));
    return '<a class="item" href="/legacy/shortdrama/play?id=' + encodeURIComponent(it.id) +
      '&name=' + encodeURIComponent(it.name || '') + '">' +
      '<span class="pic" style="background-image:url(' + esc(lunaImg(it.cover)) + ')"></span>' +
      (it.score ? '<span class="rate' + lunaRateClass(it.score) + '">' + esc(it.score) + '</span>' : '') +
      '<span class="t">' + esc(it.name) + '</span>' +
      '<span class="s">' + (sub.join(' · ') || '&nbsp;') + '</span></a>';
  }

  function load(append) {
    if (busy) return;
    busy = true;
    more.innerHTML = '加载中…';
    var url;
    if (mode === 'search') {
      url = '/api/shortdrama/search?query=' + encodeURIComponent(q) + '&page=' + page + '&size=' + PAGE;
    } else {
      url = '/api/shortdrama/list?categoryId=' + cat + '&page=' + page + '&size=' + PAGE;
    }
    lunaXhr('GET', url, null, function (status, data) {
      busy = false;
      more.innerHTML = '加载更多';
      var list = (data && data.list) || [];
      var hasMore = !!(data && data.hasMore);
      if (status !== 200 || !list.length) {
        if (!append) box.innerHTML = '<div class="loading">暂无内容</div>';
        more.style.display = 'none';
        return;
      }
      var html = '';
      for (var i = 0; i < list.length; i++) html += renderItem(list[i]);
      if (append) {
        var div = document.createElement('div');
        div.innerHTML = html;
        while (div.firstChild) box.appendChild(div.firstChild);
      } else {
        box.innerHTML = html;
      }
      more.style.display = hasMore ? 'inline-block' : 'none';
      page += 1;
    });
  }

  function resetState() {
    page = 1;
    box.innerHTML = '';
    more.style.display = 'none';
  }

  function renderCats() {
    var html = '<div class="tabgrp">分类筛选</div><div class="pillbox"><div class="tabrow">';
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      html += '<a class="tab' + (c.type_id === cat ? ' cur' : '') + '" href="javascript:void(0)" data-id="' +
        esc(c.type_id) + '">' + esc(c.type_name) + '</a>';
    }
    html += '</div></div>';
    catsBox.innerHTML = html;
    var nodes = catsBox.getElementsByTagName('a');
    for (var k = 0; k < nodes.length; k++) {
      nodes[k].onclick = function () {
        cat = parseInt(this.getAttribute('data-id'), 10) || 0;
        mode = 'cat';
        q = '';
        kw.value = '';
        catsBox.style.display = 'block';
        clearBtn.style.display = 'none';
        renderCats();
        resetState();
        load(false);
      };
    }
  }

  function loadCats() {
    lunaXhr('GET', '/api/shortdrama/categories', null, function (status, data) {
      if (status === 200 && data && data.length) {
        cats = data;
        // 去掉第一个「短剧」总分类（导航已有短剧入口，无需重复占位）
        if (cats[0] && cats[0].type_name === '短剧') cats = cats.slice(1);
        if (!cats.length) {
          catsBox.innerHTML = '<div class="loading">暂无分类</div>';
          box.innerHTML = '<div class="loading">暂无内容</div>';
          return;
        }
        cat = cats[0].type_id;
        renderCats();
        load(false);
      } else {
        catsBox.innerHTML = '<div class="loading">分类加载失败</div>';
        box.innerHTML = '<div class="loading">暂无内容</div>';
      }
    });
  }

  function doSearch() {
    var v = kw.value.replace(/^\\s+|\\s+$/g, '');
    if (!v) return;
    mode = 'search';
    q = v;
    catsBox.style.display = 'none';
    clearBtn.style.display = 'block';
    resetState();
    load(false);
  }

  go.onclick = doSearch;
  kw.onkeydown = function (e) {
    var key = e.keyCode || e.which;
    if (key === 13) doSearch();
  };
  clearBtn.onclick = function () {
    mode = 'cat';
    q = '';
    kw.value = '';
    catsBox.style.display = 'block';
    clearBtn.style.display = 'none';
    renderCats();
    resetState();
    load(false);
  };
  more.onclick = function () { load(true); };

  loadCats();
})();`;
}
