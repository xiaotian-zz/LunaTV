import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  buildLegacyNav,
  escapeHtml,
  renderLegacyPageWithConfig,
} from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版用户中心（对应主站用户菜单/我的页）：
 * - 收藏列表（GET /api/favorites → Record<"source+id", Favorite>）海报网格
 * - 播放记录（GET /api/playrecords → Record<"source+id", PlayRecord>）"看到第x集"列表
 * - 退出登录（POST /api/logout 清除 user_auth/auth cookie）
 * 用户名从请求 cookie 服务端解析（getAuthInfoFromCookie，与主站一致）。
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
        title: '我的',
        siteName,
        body:
          buildLegacyNav('profile') +
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

  const username = escapeHtml(authInfo.username || '');
  const body = `
${buildLegacyNav('profile')}
<div class="banner"><span class="bt">当前用户：${username}</span><span class="bs">收藏与播放记录保存在本站账户下</span></div>
<div class="ptabs" style="margin-top:12px"><a class="ptab cur" id="tabFav" href="javascript:void(0)">我的收藏</a><a class="ptab src" id="tabPr" href="javascript:void(0)">播放记录</a></div>
<div id="paneFav">
  <div class="sec-h" style="margin-top:12px"><span class="st">我的收藏（<span id="favCount">0</span>）</span></div>
  <div id="favBox" style="text-align:center"><div class="loading">加载中…</div></div>
</div>
<div id="panePr" style="display:none">
  <div class="sec-h" style="margin-top:12px"><span class="st">播放记录（<span id="prCount">0</span>）</span></div>
  <div id="prBox"><div class="loading">暂未加载</div></div>
</div>
<div class="sec" style="margin-top:12px">
  <div class="sec-h"><span class="st">设置</span></div>
  <div class="card" style="margin-top:8px">
    <div class="setg">
      <div class="setl">豆瓣数据代理</div>
      <div class="setd">选择获取豆瓣数据的方式</div>
      <select class="setsel" id="selDoubanData">${DOUBAN_DATA_OPTIONS_HTML}</select>
      <input class="setin" id="inDoubanProxyUrl" placeholder="自定义豆瓣数据代理地址" style="display:none">
      <div class="thanks" id="thxDoubanData" style="display:none"></div>
    </div>
    <div class="setg">
      <div class="setl">豆瓣图片代理</div>
      <div class="setd">选择获取豆瓣图片的方式</div>
      <select class="setsel" id="selDoubanImg">${DOUBAN_IMG_OPTIONS_HTML}</select>
      <input class="setin" id="inDoubanImgUrl" placeholder="自定义豆瓣图片代理地址" style="display:none">
      <div class="thanks" id="thxDoubanImg" style="display:none"></div>
    </div>
    <div class="setg">
      <div class="setl">Bangumi 数据代理</div>
      <div class="setd">服务器无法访问 api.bgm.tv 时可切换反代</div>
      <select class="setsel" id="selBangumiApi">${BANGUMI_API_OPTIONS_HTML}</select>
      <input class="setin" id="inBangumiApiProxy" placeholder="自定义 Bangumi 反代地址" style="display:none">
    </div>
    <div class="setg">
      <div class="setl">Bangumi 图片代理</div>
      <div class="setd">选择获取 Bangumi 封面图片的方式</div>
      <select class="setsel" id="selBangumiImg">${BANGUMI_IMG_OPTIONS_HTML}</select>
      <input class="setin" id="inBangumiImgUrl" placeholder="自定义 Bangumi 图片代理地址" style="display:none">
    </div>
    <a class="btn gray" id="resetBtn" href="javascript:void(0)" style="margin-top:14px">恢复默认设置</a>
  </div>
</div>
<a class="btn gray" id="logoutBtn" href="javascript:void(0)" style="margin-top:12px">退出登录</a>`;

  return new NextResponse(
    await renderLegacyPageWithConfig({
      title: '我的',
      siteName,
      body,
      script: profileScript(),
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

/** 四个代理下拉的选项（label/value 与主站 SettingsPanel 完全一致） */
const DOUBAN_DATA_OPTIONS = [
  ['direct', '直连（服务器直接请求豆瓣）'],
  ['cors-proxy-zwei', 'Cors Proxy By Zwei'],
  ['cmliussss-cdn-tencent', '豆瓣 CDN By CMLiussss（腾讯云）'],
  ['cmliussss-cdn-ali', '豆瓣 CDN By CMLiussss（阿里云）'],
  ['cmliussss-unified', '豆瓣 CDN By CMLiussss（统一域名）'],
  ['custom', '自定义代理'],
];
const DOUBAN_IMG_OPTIONS = [
  ['direct', '直连（浏览器直接请求豆瓣）'],
  ['server', '服务器代理（由服务器代理请求豆瓣）'],
  ['img3', '豆瓣官方精品 CDN（阿里云）'],
  ['cmliussss-cdn-tencent', '豆瓣 CDN By CMLiussss（腾讯云）'],
  ['cmliussss-cdn-ali', '豆瓣 CDN By CMLiussss（阿里云）'],
  ['baidu', '百度图片代理（境内CDN，Chrome可能触发下载）'],
  ['custom', '自定义代理'],
];
const BANGUMI_API_OPTIONS = [
  ['server', '服务端转发（默认，访问官方 api.bgm.tv）'],
  ['cmliussss', 'Bangumi 反代 By CMLiussss（解决服务器被墙）'],
  ['corsapi', 'Cloudflare Worker 代理 By Smone'],
  ['sakura', '桜色镜像站（bangumi.lol，第三方镜像）'],
  ['custom', '自定义反代地址'],
];
const BANGUMI_IMG_OPTIONS = [
  ['server', '服务器代理（默认，由服务器代理请求）'],
  ['cmliussss', 'Bangumi 图片 CDN By CMLiussss'],
  ['corsapi', 'Cloudflare Worker 代理 By Smone'],
  ['sakura', '桜色镜像站（bangumi.lol，第三方镜像）'],
  ['direct', '直连（浏览器直接请求 lain.bgm.tv）'],
  ['custom', '自定义代理'],
];

function optionsHtml(opts: string[][]): string {
  return opts
    .map(
      ([v, label]) =>
        `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`,
    )
    .join('');
}

const DOUBAN_DATA_OPTIONS_HTML = optionsHtml(DOUBAN_DATA_OPTIONS);
const DOUBAN_IMG_OPTIONS_HTML = optionsHtml(DOUBAN_IMG_OPTIONS);
const BANGUMI_API_OPTIONS_HTML = optionsHtml(BANGUMI_API_OPTIONS);
const BANGUMI_IMG_OPTIONS_HTML = optionsHtml(BANGUMI_IMG_OPTIONS);

function profileScript(): string {
  return `
(function () {
  var favBox = document.getElementById('favBox');
  var prBox = document.getElementById('prBox');

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  // ===== 设置面板（localStorage key 与主站 SettingsPanel 一致，初始值跟随后台 RUNTIME_CONFIG） =====
  function rcVal(k) {
    var RC = window.RUNTIME_CONFIG || {};
    return RC[k];
  }
  // 主站 getThanksInfo：仅 cors-proxy-zwei 与 CMLiussss CDN 显示致谢
  function thxFor(v) {
    if (v === 'cors-proxy-zwei') return { text: 'Thanks to @Zwei', url: 'https://github.com/bestzwei' };
    if (v === 'cmliussss-cdn-tencent' || v === 'cmliussss-cdn-ali' || v === 'cmliussss-unified') {
      return { text: 'Thanks to @CMLiussss', url: 'https://github.com/cmliu' };
    }
    return null;
  }
  function bindSet(selId, lsKey, rcKey, defVal, inId, inKey, inRcKey, thxId) {
    var sel = document.getElementById(selId);
    var input = inId ? document.getElementById(inId) : null;
    var thx = thxId ? document.getElementById(thxId) : null;
    // 与主站一致：localStorage ?? RUNTIME_CONFIG ?? 默认值
    var saved = null;
    var savedUrl = '';
    try { saved = localStorage.getItem(lsKey); } catch (e) {}
    if (saved === null || saved === undefined) saved = rcKey ? rcVal(rcKey) : null;
    if (saved === null || saved === undefined) saved = defVal;
    if (input) {
      try { savedUrl = localStorage.getItem(inKey); } catch (e1) {}
      if (savedUrl === null || savedUrl === undefined) savedUrl = inRcKey ? (rcVal(inRcKey) || '') : '';
    }
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === saved) { sel.selectedIndex = i; break; }
    }
    function syncRow() {
      if (input) input.style.display = sel.value === 'custom' ? 'block' : 'none';
    }
    function syncThanks() {
      if (!thx) return;
      var info = thxFor(sel.value);
      if (info) {
        thx.style.display = 'block';
        thx.innerHTML = '<a href="' + info.url + '" target="_blank" rel="noopener">' + info.text + '</a>';
      } else {
        thx.style.display = 'none';
        thx.innerHTML = '';
      }
    }
    syncRow();
    syncThanks();
    if (input) input.value = savedUrl;
    sel.onchange = function () {
      try { localStorage.setItem(lsKey, sel.value); } catch (e2) {}
      syncRow();
      syncThanks();
    };
    if (input) {
      input.onchange = function () {
        try { localStorage.setItem(inKey, input.value); } catch (e3) {}
      };
    }
  }
  bindSet('selDoubanData', 'doubanDataSource', 'DOUBAN_PROXY_TYPE', 'direct', 'inDoubanProxyUrl', 'doubanProxyUrl', 'DOUBAN_PROXY', 'thxDoubanData');
  bindSet('selDoubanImg', 'doubanImageProxyType', 'DOUBAN_IMAGE_PROXY_TYPE', 'server', 'inDoubanImgUrl', 'doubanImageProxyUrl', 'DOUBAN_IMAGE_PROXY', 'thxDoubanImg');
  bindSet('selBangumiApi', 'bangumiApiType', null, 'cmliussss', 'inBangumiApiProxy', 'bangumiApiProxy', null, null);
  bindSet('selBangumiImg', 'bangumiImageProxyType', 'BANGUMI_IMAGE_PROXY_TYPE', 'cmliussss', 'inBangumiImgUrl', 'bangumiImageProxyUrl', 'BANGUMI_IMAGE_PROXY', null);

  // 恢复默认设置（对齐主站 handleResetSettings：把后台 RUNTIME_CONFIG 值写回 localStorage）
  document.getElementById('resetBtn').onclick = function () {
    var RC = window.RUNTIME_CONFIG || {};
    var dd = RC.DOUBAN_PROXY_TYPE || 'direct';
    var dp = RC.DOUBAN_PROXY || '';
    var di = RC.DOUBAN_IMAGE_PROXY_TYPE || 'server';
    var du = RC.DOUBAN_IMAGE_PROXY || '';
    var bi = RC.BANGUMI_IMAGE_PROXY_TYPE || 'cmliussss';
    var bu = RC.BANGUMI_IMAGE_PROXY || '';
    try {
      localStorage.setItem('doubanDataSource', dd);
      localStorage.setItem('doubanProxyUrl', dp);
      localStorage.setItem('doubanImageProxyType', di);
      localStorage.setItem('doubanImageProxyUrl', du);
      localStorage.setItem('bangumiApiType', 'cmliussss');
      localStorage.setItem('bangumiApiProxy', '');
      localStorage.setItem('bangumiImageProxyType', bi);
      localStorage.setItem('bangumiImageProxyUrl', bu);
    } catch (e4) {}
    location.reload();
  };

  // DB key 形如 "source+id"；豆瓣收藏 key 无真实采集源
  function parseKey(k) {
    var i = String(k).indexOf('+');
    if (i < 0) return { source: '', id: String(k) };
    return { source: String(k).slice(0, i), id: String(k).slice(i + 1) };
  }
  function isVodKey(p) {
    return p.source && p.id && p.source.indexOf('douban') !== 0;
  }
  function playHref(p, it) {
    return '/legacy/play?source=' + encodeURIComponent(p.source) +
      '&id=' + encodeURIComponent(p.id) +
      '&title=' + encodeURIComponent(it.title || '');
  }
  function detailHref(p, it) {
    var m = /[0-9]{6,}/.exec((p.source || '') + '+' + (p.id || ''));
    return '/legacy/detail?title=' + encodeURIComponent(it.title || '') +
      '&year=' + encodeURIComponent(it.year || '') +
      '&douban_id=' + encodeURIComponent(m ? m[0] : '');
  }
  function toList(map) {
    var arr = [];
    for (var k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k) && map[k]) {
        arr.push({ key: k, it: map[k] });
      }
    }
    arr.sort(function (a, b) { return (b.it.save_time || 0) - (a.it.save_time || 0); });
    return arr;
  }

  // 收藏：海报网格，点击进入对应影片
  function renderFavs(list) {
    document.getElementById('favCount').innerHTML = String(list.length);
    if (!list.length) {
      favBox.innerHTML = '<div class="loading">暂无收藏</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i].it;
      var p = parseKey(list[i].key);
      var href = isVodKey(p) ? playHref(p, it) : detailHref(p, it);
      var sub = [];
      if (it.year) sub.push(esc(it.year));
      if (it.source_name) sub.push(esc(it.source_name));
      html += '<a class="item" href="' + href + '">' +
        '<span class="pic" style="background-image:url(' + esc(lunaImg(it.cover)) + ')"></span>' +
        '<span class="t">' + esc(it.title) + '</span>' +
        '<span class="s">' + (sub.join(' · ') || '&nbsp;') + '</span></a>';
    }
    favBox.innerHTML = html;
  }

  // 播放记录：列表带"看到第x集"，点击继续播放
  function renderPrs(list) {
    document.getElementById('prCount').innerHTML = String(list.length);
    if (!list.length) {
      prBox.innerHTML = '<div class="loading">暂无播放记录</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i].it;
      var p = parseKey(list[i].key);
      var href = isVodKey(p)
        ? playHref(p, it) + '&index=' + encodeURIComponent(it.index || 1)
        : detailHref(p, it);
      var sub = '看到第' + (it.index || 1) + '集' +
        (it.total_episodes ? ' / 共' + it.total_episodes + '集' : '') +
        (it.remarks ? ' · ' + esc(it.remarks) : '');
      html += '<a class="lrow" href="' + href + '">' +
        '<span class="lthumb" style="background-image:url(' + esc(lunaImg(it.cover)) + ')"></span>' +
        '<span class="lt">' + esc(it.title) + '</span>' +
        '<span class="ls">' + sub + '</span>' +
        '<span class="lgo">继续播放</span></a>';
    }
    prBox.innerHTML = html;
  }

  // 收藏/播放记录标签卡切换（播放记录首次切到时懒加载，iOS 9 串行 XHR）
  var prLoaded = false;
  function setTab(t) {
    var favOn = t === 'fav';
    document.getElementById('tabFav').className = favOn ? 'ptab cur' : 'ptab';
    document.getElementById('tabPr').className = favOn ? 'ptab src' : 'ptab src cur';
    document.getElementById('paneFav').style.display = favOn ? 'block' : 'none';
    document.getElementById('panePr').style.display = favOn ? 'none' : 'block';
    if (!favOn && !prLoaded) {
      prLoaded = true;
      loadPrs();
    }
  }
  document.getElementById('tabFav').onclick = function () { setTab('fav'); };
  document.getElementById('tabPr').onclick = function () { setTab('pr'); };

  function loadPrs() {
    lunaXhr('GET', '/api/playrecords', null, function (status2, data2) {
      if (status2 === 200 && data2) {
        renderPrs(toList(data2));
      } else {
        prBox.innerHTML = '<div class="loading">' +
          esc((data2 && data2.error) || '播放记录加载失败') + '</div>';
      }
    });
  }

  function load() {
    lunaXhr('GET', '/api/favorites', null, function (status, data) {
      if (status === 200 && data) {
        renderFavs(toList(data));
      } else {
        favBox.innerHTML = '<div class="loading">' +
          esc((data && data.error) || '收藏加载失败') + '</div>';
      }
    });
  }

  document.getElementById('logoutBtn').onclick = function () {
    lunaXhr('POST', '/api/logout', null, function () {
      location.href = '/legacy';
    });
  };

  load();
})();`;
}
