import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { buildLegacyNav, renderLegacyPageWithConfig } from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版源浏览器（对应主站 /source-browser）：
 * - 源列表：GET /api/source-browser/sites → { sources: [{ key, name, api }] }
 * - 源分类：GET /api/source-browser/categories?source=key → { categories: [{ type_id, type_name }] }
 * - 影片列表：GET /api/source-browser/list?source=key&type_id=..&page=n
 *   → { items: [{ id, title, poster, year, remarks }], meta: { page, pagecount, total } }
 * 点击源卡片展开分类 + 影片网格，点击影片直接进 /legacy/play。
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
        title: '源',
        siteName,
        body:
          buildLegacyNav('source') +
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

  const body = `
${buildLegacyNav('source')}
<div class="pagehero">
  <div class="ph-t">源浏览器</div>
  <div class="ph-d">按来源站与分类浏览内容，探索海量影视资源</div>
  <span class="ph-b" id="cntBadge" style="display:none"><span id="srcCount">0</span> 个源可用</span>
</div>
<div class="sec">
  <div class="sec-h"><span class="st">选择来源站</span>
    <span class="stag" id="cntTag" style="display:none"><span id="srcCount2">0</span> 个</span></div>
  <div id="srcList" style="text-align:center"><div class="loading">加载中…</div></div>
</div>
<div id="qbox" class="card" style="display:none;margin-top:12px">
  <input type="text" id="q" placeholder="搜索该源影片名称...">
  <button class="btn" id="qgo" type="button">搜 索</button>
  <button class="btn gray" id="clearBtn" type="button" style="display:none">清除搜索</button>
</div>
<div id="detail" style="display:none;margin-top:12px">
  <div class="sec-h"><span class="st" id="srcTitle"></span>
    <span class="stag" id="totalTag" style="display:none"></span></div>
  <div id="catBox"></div>
  <div id="items" style="text-align:center"></div>
  <div style="text-align:center"><a class="btn" id="moreBtn" href="javascript:void(0)"
    style="display:none;width:60%">加载更多</a></div>
</div>`;

  return new NextResponse(
    await renderLegacyPageWithConfig({
      title: '源',
      siteName,
      body,
      script: sourceBrowserScript(),
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

function sourceBrowserScript(): string {
  return `
(function () {
  var listBox = document.getElementById('srcList');
  var detailBox = document.getElementById('detail');
  var catBox = document.getElementById('catBox');
  var itemsBox = document.getElementById('items');
  var moreBtn = document.getElementById('moreBtn');
  var qbox = document.getElementById('qbox');
  var qInput = document.getElementById('q');
  var qgo = document.getElementById('qgo');
  var clearBtn = document.getElementById('clearBtn');

  var SOURCES = [];
  var state = { key: '', name: '', typeId: '', page: 1, pagecount: 1, busy: false };
  var mode = 'cat'; // 'cat' | 'search'
  var q = '';

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  function renderItem(it) {
    var sub = [];
    if (it.year) sub.push(esc(it.year));
    if (it.remarks) sub.push(esc(it.remarks));
    return '<a class="item" href="/legacy/play?source=' + encodeURIComponent(state.key) +
      '&id=' + encodeURIComponent(it.id || '') +
      '&title=' + encodeURIComponent(it.title || '') + '">' +
      '<span class="pic" style="background-image:url(' + esc(lunaImg(it.poster)) + ')"></span>' +
      '<span class="t">' + esc(it.title) + '</span>' +
      '<span class="s">' + (sub.join(' · ') || '&nbsp;') + '</span></a>';
  }

  // ===== 源列表（主站：胶囊按钮组，选中绿色底白字） =====
  function loadSites() {
    lunaXhr('GET', '/api/source-browser/sites', null, function (status, data) {
      if (status === 401) {
        listBox.innerHTML = '<div class="loading">登录状态已失效，请重新登录</div>';
        return;
      }
      var sources = (data && data.sources) || [];
      if (status !== 200 || !sources.length) {
        listBox.innerHTML = '<div class="loading">' +
          esc((data && data.error) || '暂无可用资源站点') + '</div>';
        return;
      }
      SOURCES = sources;
      var cnt = String(sources.length);
      document.getElementById('srcCount').innerHTML = cnt;
      document.getElementById('srcCount2').innerHTML = cnt;
      document.getElementById('cntBadge').style.display = 'inline-block';
      document.getElementById('cntTag').style.display = 'inline-block';
      var html = '';
      for (var i = 0; i < sources.length; i++) {
        html += '<a class="srcbtn" href="javascript:void(0)" data-i="' + i + '">' +
          esc(sources[i].name) + '</a>';
      }
      listBox.innerHTML = html;
      var cards = listBox.getElementsByTagName('a');
      for (var j = 0; j < cards.length; j++) {
        cards[j].onclick = function () {
          openSource(SOURCES[parseInt(this.getAttribute('data-i'), 10)]);
        };
      }
    });
  }

  function markCurSource() {
    var cards = listBox.getElementsByTagName('a');
    for (var k = 0; k < cards.length; k++) {
      cards[k].className = (SOURCES[parseInt(cards[k].getAttribute('data-i'), 10)] || {}).key === state.key
        ? 'srcbtn cur' : 'srcbtn';
    }
  }

  // ===== 源详情：查询区 + 分类 + 影片（主站选中源后展示） =====
  function openSource(src) {
    if (!src) return;
    state.key = src.key;
    state.name = src.name;
    state.page = 1;
    state.pagecount = 1;
    mode = 'cat';
    q = '';
    qInput.value = '';
    markCurSource();
    document.getElementById('srcTitle').innerHTML = esc(src.name) + ' · 影片列表';
    qbox.style.display = 'block';
    clearBtn.style.display = 'none';
    detailBox.style.display = 'block';
    catBox.innerHTML = '<div class="loading">加载分类中…</div>';
    itemsBox.innerHTML = '';
    moreBtn.style.display = 'none';
    var totalTag = document.getElementById('totalTag');
    if (totalTag) totalTag.style.display = 'none';
    lunaXhr('GET', '/api/source-browser/categories?source=' + encodeURIComponent(src.key),
      null, function (status, data) {
        if (status !== 200) {
          catBox.innerHTML = '<div class="loading">' +
            esc((data && data.error) || '分类加载失败') + '</div>';
          return;
        }
        var cats = data.categories || [];
        if (!cats.length) {
          catBox.innerHTML = '<div class="loading">该源暂无分类</div>';
          return;
        }
        var html = '<div class="pillbox"><div class="tabrow">';
        for (var i = 0; i < cats.length; i++) {
          html += '<a class="tab" href="javascript:void(0)" data-id="' +
            esc(cats[i].type_id) + '">' + esc(cats[i].type_name) + '</a>';
        }
        html += '</div></div>';
        catBox.innerHTML = html;
        var tabs = catBox.getElementsByTagName('a');
        for (var j = 0; j < tabs.length; j++) {
          tabs[j].onclick = function () {
            var old = catBox.getElementsByTagName('a');
            for (var k = 0; k < old.length; k++) old[k].className = 'tab';
            this.className = 'tab cur';
            state.typeId = this.getAttribute('data-id');
            state.page = 1;
            itemsBox.innerHTML = '';
            load(false);
          };
        }
        tabs[0].className = 'tab cur';
        state.typeId = tabs[0].getAttribute('data-id');
        load(false);
      });
  }

  function load(append) {
    if (state.busy || !state.key) return;
    if (mode === 'cat' && !state.typeId) return;
    state.busy = true;
    moreBtn.innerHTML = '加载中…';
    var url;
    if (mode === 'search') {
      url = '/api/source-browser/search?source=' + encodeURIComponent(state.key) +
        '&q=' + encodeURIComponent(q) + '&page=' + state.page;
    } else {
      url = '/api/source-browser/list?source=' + encodeURIComponent(state.key) +
        '&type_id=' + encodeURIComponent(state.typeId) + '&page=' + state.page;
    }
    lunaXhr('GET', url, null, function (status, data) {
      state.busy = false;
      moreBtn.innerHTML = '加载更多';
      if (status !== 200) {
        if (!append) {
          itemsBox.innerHTML = '<div class="loading">' +
            esc((data && data.error) || '列表加载失败') + '</div>';
          moreBtn.style.display = 'none';
        } else {
          // 追加失败保留按钮以便重试（state.page 未前移）
          moreBtn.style.display = 'inline-block';
        }
        return;
      }
      var list = data.items || [];
      var meta = data.meta || {};
      state.pagecount = Number(meta.pagecount) || 1;
      var total = Number(meta.total) || 0;
      var totalTag = document.getElementById('totalTag');
      if (totalTag) {
        totalTag.style.display = total ? 'inline-block' : 'none';
        totalTag.innerHTML = (mode === 'search' ? '找到' : '共') + total + '部资源';
      }
      if (!list.length && !append) {
        itemsBox.innerHTML = '<div class="loading">' + (mode === 'search' ? '未找到相关影片' : '该分类暂无影片') + '</div>';
        moreBtn.style.display = 'none';
        return;
      }
      var html = '';
      for (var i = 0; i < list.length; i++) html += renderItem(list[i]);
      if (append) {
        var div = document.createElement('div');
        div.innerHTML = html;
        while (div.firstChild) itemsBox.appendChild(div.firstChild);
      } else {
        itemsBox.innerHTML = html;
      }
      if (state.page < state.pagecount) {
        moreBtn.style.display = 'inline-block';
        moreBtn.innerHTML = '加载更多（第' + state.page + '/' + state.pagecount + '页）';
        state.page += 1;
      } else {
        moreBtn.style.display = 'none';
      }
    });
  }

  function doSearch() {
    var v = qInput.value.replace(/^\\s+|\\s+$/g, '');
    if (!v || !state.key) return;
    mode = 'search';
    q = v;
    catBox.style.display = 'none';
    clearBtn.style.display = 'inline-block';
    state.page = 1;
    itemsBox.innerHTML = '';
    load(false);
  }

  qgo.onclick = doSearch;
  qInput.onkeydown = function (e) {
    var key = e.keyCode || e.which;
    if (key === 13) doSearch();
  };
  clearBtn.onclick = function () {
    mode = 'cat';
    q = '';
    qInput.value = '';
    catBox.style.display = 'block';
    clearBtn.style.display = 'none';
    state.page = 1;
    itemsBox.innerHTML = '';
    load(false);
  };
  moreBtn.onclick = function () { load(true); };

  loadSites();
})();`;
}
