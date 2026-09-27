import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  buildLegacyNav,
  escapeHtml,
  LEGACY_SEC_ICONS,
  renderLegacyPageWithConfig,
} from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版：
 * - 无参数：复刻主站首页布局（欢迎横幅 + 热门电影/热门剧集/热门综艺 三个横向滚动区块）
 * - ?type=xxx：豆瓣浏览页（分类胶囊 + 海报网格 + 分页加载），对应主站 /douban?type=xxx
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
  const needUsername = storageType !== 'localstorage';
  const sp = new URL(request.url).searchParams;
  const type = sp.get('type') || '';

  let body: string;
  let script: string;
  let title = '首页';
  if (!loggedIn) {
    body = loginBody(needUsername);
    script = loginScript(needUsername);
  } else if (!type) {
    body = homeBody(authInfo.username || '');
    script = homeScript();
  } else {
    title = '分类';
    const init = resolveInit(type);
    body = browseBody(init, type);
    script = browseScript(init);
  }

  return new NextResponse(
    await renderLegacyPageWithConfig({
      title,
      siteName,
      body,
      script,
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

function loginBody(needUsername: boolean): string {
  return `
<div class="card">
  <h2 class="pt">登录</h2>
  <div id="msg" class="msg"></div>
  ${needUsername ? '<input type="text" id="username" placeholder="用户名" autocapitalize="off">' : ''}
  <input type="password" id="password" placeholder="访问密码">
  <button class="btn" id="loginBtn" type="button">立即登录</button>
</div>`;
}

function loginScript(needUsername: boolean): string {
  return `
(function () {
  var needUsername = ${needUsername};
  var btn = document.getElementById('loginBtn');
  btn.onclick = function () {
    var username = needUsername ? document.getElementById('username').value : '';
    var password = document.getElementById('password').value;
    if (needUsername && !username) { lunaShow('msg', '请输入用户名', 'err'); return; }
    if (!password) { lunaShow('msg', '请输入密码', 'err'); return; }
    btn.disabled = true;
    var payload = { password: password };
    if (needUsername) payload.username = username;
    lunaXhr('POST', '/api/login', payload, function (status, data) {
      btn.disabled = false;
      if (status === 200) {
        location.reload();
      } else {
        lunaShow('msg', (data && data.error) || '登录失败，请重试', 'err');
      }
    });
  };
})();`;
}

/** 根据 URL 参数解析浏览页类型（参数风格与主站导航一致 /douban?type=xxx） */
function resolveInit(type: string) {
  // 对齐主站 Sidebar href：电影 /douban?type=movie、剧集 type=tv、动漫 type=anime、综艺 type=show
  if (type === 'movie') return { type: 'movie', nav: 'movie' };
  if (type === 'anime') return { type: 'anime', nav: 'anime' };
  if (type === 'show') return { type: 'show', nav: 'show' };
  return { type: 'tv', nav: 'tv' };
}

/** 首页：复刻主站 HomeClient 布局（欢迎横幅 + 三个区块） */
function homeBody(username: string): string {
  // 问候语按 Asia/Shanghai 时区时段划分，与主站 HomeClient 一致
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }).format(new Date()),
  );
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const bannerHtml = `<div class="banner"><span class="bt">${escapeHtml(
    greeting,
  )}${username ? '，' + escapeHtml(username) : ''} 👋</span><span class="bs">发现更多精彩影视内容</span></div>`;

  const sec = (key: string, id: string, title: string, href: string): string =>
    `<div class="sec"><div class="sec-h"><span class="st">${LEGACY_SEC_ICONS[key]}${escapeHtml(
      title,
    )}</span><a class="more" href="${href}">查看更多</a></div><div class="row" id="${id}"><div class="loading">加载中…</div></div></div>`;

  return `
${buildLegacyNav('home')}
${bannerHtml}
${sec('movie', 'row-movie', '热门电影', '/legacy?type=movie')}
${sec('tv', 'row-tv', '热门剧集', '/legacy?type=tv')}
${sec('show', 'row-show', '热门综艺', '/legacy?type=show')}`;
}

/** 首页脚本：按主站 useHomePageQueries 的数据源串行加载三个区块（iOS 9 并发 XHR 受限） */
function homeScript(): string {
  return `
(function () {
  var SECS = [
    { id: 'row-movie', kind: 'movie', category: '热门', type: '全部' },
    { id: 'row-tv', kind: 'tv', category: 'tv', type: 'tv' },
    { id: 'row-show', kind: 'tv', category: 'show', type: 'show' }
  ];
  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }
  function renderItem(it, kind) {
    return '<a class="item" href="/legacy/detail?title=' + encodeURIComponent(it.title || '') +
      '&year=' + encodeURIComponent(it.year || '') +
      '&douban_id=' + encodeURIComponent(it.id || '') +
      '&stype=' + encodeURIComponent(kind || '') + '">' +
      '<span class="pic" style="background-image:url(' + esc(lunaImg(it.poster)) + ')"></span>' +
      (it.rate && it.rate !== '0' ? '<span class="rate' + lunaRateClass(it.rate) + '">' + esc(it.rate) + '</span>' : '') +
      '<span class="t">' + esc(it.title) + '</span></a>';
  }
  function loadSec(i) {
    var s = SECS[i];
    if (!s) return;
    var box = document.getElementById(s.id);
    if (!box) return;
    var url = '/api/douban/categories?kind=' + encodeURIComponent(s.kind) +
      '&category=' + encodeURIComponent(s.category) +
      '&type=' + encodeURIComponent(s.type) + '&limit=20&start=0';
    lunaXhr('GET', url, null, function (status, data) {
      var list = (data && data.list) || [];
      if (status !== 200 || !list.length) {
        box.innerHTML = '<div class="loading">暂无内容</div>';
      } else {
        var html = '';
        for (var j = 0; j < list.length; j++) html += renderItem(list[j], s.kind);
        box.innerHTML = html;
      }
      loadSec(i + 1);
    });
  }
  loadSec(0);
})();`;
}

/** 浏览页：对应主站 /douban?type=xxx（大标题 + 分类/地区选择卡 + 海报网格 + 分页） */
function browseBody(init: { type: string; nav: string }, type: string): string {
  const heading =
    type === 'movie'
      ? '电影'
      : type === 'anime'
        ? '动漫'
        : type === 'show'
          ? '综艺'
          : '剧集';
  // 主站 getPageDescription：动漫默认「每日放送」显示 Bangumi 文案
  const sub =
    type === 'anime' ? '来自 Bangumi 番组计划的精选内容' : '来自豆瓣的精选内容';
  return `
${buildLegacyNav(init.nav)}
<h1 class="bigh">${escapeHtml(heading)}</h1>
<p class="bigsub" id="bigsub">${escapeHtml(sub)}</p>
<div class="card selcard">
  <div class="selrow"><span class="sellab">分类</span><span id="primRow"></span></div>
  <div class="selrow"><span class="sellab" id="secLab">地区</span><span id="secRow"></span></div>
</div>
<div id="results" style="text-align:center"></div>
<div style="text-align:center"><a class="btn" id="more" href="javascript:void(0)" style="display:none;width:60%">加载更多</a></div>`;
}

function browseScript(init: { type: string; nav: string }): string {
  return `
(function () {
  var primBox = document.getElementById('primRow');
  var secBox = document.getElementById('secRow');
  var secLab = document.getElementById('secLab');
  var box = document.getElementById('results');
  var more = document.getElementById('more');

  var PAGE = 24;
  var INIT = ${JSON.stringify(init)};

  // 分类/地区选项与主站 DoubanSelector 完全一致（value 为主站查询值）
  var CONF = {
    movie: {
      prim: [['全部','全部'],['热门电影','热门'],['最新电影','最新'],['豆瓣高分','豆瓣高分'],['冷门佳片','冷门佳片']],
      sec: [['全部','全部'],['华语','华语'],['欧美','欧美'],['韩国','韩国'],['日本','日本']],
      secLabel: '地区', defPrim: '热门', defSec: '全部'
    },
    tv: {
      prim: [['全部','全部'],['最近热门','最近热门']],
      sec: [['全部','tv'],['国产','tv_domestic'],['欧美','tv_american'],['日本','tv_japanese'],['韩国','tv_korean'],['动漫','tv_animation'],['纪录片','tv_documentary']],
      secLabel: '地区', defPrim: '最近热门', defSec: 'tv'
    },
    show: {
      prim: [['全部','全部'],['最近热门','最近热门']],
      sec: [['全部','show'],['国内','show_domestic'],['国外','show_foreign']],
      secLabel: '地区', defPrim: '最近热门', defSec: 'show'
    },
    anime: {
      prim: [['每日放送','每日放送'],['番剧','番剧'],['剧场版','剧场版']],
      // 地区 value 与主站 MultiLevelSelector 一致（英文 code）
      sec: [['全部','all'],['华语','chinese'],['欧美','western'],['韩国','korean'],['日本','japanese']],
      secLabel: '地区', defPrim: '每日放送', defSec: 'all'
    }
  };

  // 每日放送的星期行（主站 WeekdaySelector：默认选中今天）
  var WEEKDAYS = [['周一','Mon'],['周二','Tue'],['周三','Wed'],['周四','Thu'],
    ['周五','Fri'],['周六','Sat'],['周日','Sun']];
  var WMAP = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var today = WMAP[new Date().getDay()];

  // 每日放送默认选中今天（主站 WeekdaySelector 行为），其余默认 CONF.defSec
  // 注意：参数传入而非读取 state（state 初始化时尚未赋值，读它会 TypeError 导致整页无数据）
  function defaultSec(type, prim) {
    if (type === 'anime' && prim === '每日放送') return today;
    return CONF[type].defSec;
  }

  var state = {
    type: INIT.type,
    prim: CONF[INIT.type].defPrim,
    sec: defaultSec(INIT.type, CONF[INIT.type].defPrim),
    pageStart: 0, busy: false };

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  // 二级行：动漫「每日放送」显示星期（主站 WeekdaySelector），其余显示分类配置
  function secRow() {
    if (state.type === 'anime' && state.prim === '每日放送') {
      return { opts: WEEKDAYS, label: '星期' };
    }
    return { opts: CONF[state.type].sec, label: CONF[state.type].secLabel };
  }

  function renderPills() {
    var c = CONF[state.type];
    var row = secRow();
    var bigsub = document.getElementById('bigsub');
    if (bigsub) {
      bigsub.innerHTML = esc(
        state.type === 'anime' && state.prim === '每日放送'
          ? '来自 Bangumi 番组计划的精选内容'
          : '来自豆瓣的精选内容'
      );
    }
    var i, html = '';
    for (i = 0; i < c.prim.length; i++) {
      html += '<a class="pill' + (state.prim === c.prim[i][1] ? ' cur' : '') +
        '" href="javascript:void(0)" data-v="' + esc(c.prim[i][1]) + '">' + esc(c.prim[i][0]) + '</a>';
    }
    primBox.innerHTML = html;
    html = '';
    for (i = 0; i < row.opts.length; i++) {
      html += '<a class="pill' + (state.sec === row.opts[i][1] ? ' cur' : '') +
        '" href="javascript:void(0)" data-v="' + esc(row.opts[i][1]) + '">' + esc(row.opts[i][0]) + '</a>';
    }
    secBox.innerHTML = html;
    secLab.innerHTML = esc(row.label);
    var nodes = primBox.getElementsByTagName('a');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].onclick = function () {
        if (state.prim === this.getAttribute('data-v')) return;
        state.prim = this.getAttribute('data-v');
        state.sec = defaultSec(state.type, state.prim);
        state.pageStart = 0;
        box.innerHTML = '';
        renderPills();
        load(false);
      };
    }
    nodes = secBox.getElementsByTagName('a');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].onclick = function () {
        if (state.sec === this.getAttribute('data-v')) return;
        state.sec = this.getAttribute('data-v');
        state.pageStart = 0;
        box.innerHTML = '';
        renderPills();
        load(false);
      };
    }
  }

  function renderItem(it) {
    var sub = [];
    if (it.year) sub.push(esc(it.year));
    if (it.rate && it.rate !== '0') sub.push('评分 ' + esc(it.rate));
    return '<a class="item" href="/legacy/detail?title=' + encodeURIComponent(it.title || '') +
      '&year=' + encodeURIComponent(it.year || '') +
      '&douban_id=' + encodeURIComponent(it.id || '') +
      '&stype=' + encodeURIComponent(state.type || '') + '">' +
      '<span class="pic" style="background-image:url(' + esc(lunaImg(it.poster)) + ')"></span>' +
      (it.rate && it.rate !== '0' ? '<span class="rate' + lunaRateClass(it.rate) + '">' + esc(it.rate) + '</span>' : '') +
      '<span class="t">' + esc(it.title) + '</span>' +
      '<span class="s">' + (sub.join(' · ') || '&nbsp;') + '</span></a>';
  }

  // 数据端点与主站 doubanListOptions 一致：
  // 全部/番剧/剧场版 → /api/douban/recommends（豆瓣 recommends）；
  // 具体分类（热门电影/最近热门/冷门佳片等）→ /api/douban/categories（coded 值）
  // 注意：recommends 的同名参数只能出现一次（searchParams 取首个）
  function recUrl(kind, category, format, region) {
    return '/api/douban/recommends?kind=' + encodeURIComponent(kind) +
      '&category=' + encodeURIComponent(category || 'all') +
      '&format=' + encodeURIComponent(format || 'all') +
      '&region=' + encodeURIComponent(region || 'all') +
      '&year=all&platform=all&sort=all&label=all';
  }
  function buildUrl() {
    var p = '&limit=' + PAGE + '&start=' + state.pageStart;
    if (state.type === 'movie') {
      if (state.prim === '全部') return recUrl('movie', 'all', 'all', 'all') + p;
      return '/api/douban/categories?kind=movie&category=' + encodeURIComponent(state.prim) +
        '&type=' + encodeURIComponent(state.sec) + p;
    }
    if (state.type === 'tv') {
      if (state.prim === '全部') return recUrl('tv', 'all', '电视剧', 'all') + p;
      return '/api/douban/categories?kind=tv&category=' + encodeURIComponent('最近热门') +
        '&type=' + encodeURIComponent(state.sec) + p;
    }
    if (state.type === 'show') {
      if (state.prim === '全部') return recUrl('tv', 'all', '综艺', 'all') + p;
      return '/api/douban/categories?kind=tv&category=show&type=' + encodeURIComponent(state.sec) + p;
    }
    // anime：每日放送=Bangumi 日历（主站默认）；番剧=tv 动画电视剧；剧场版=movie 动画
    // （region 取值同主站 MultiLevelSelector 英文 code）
    if (state.type === 'anime') {
      if (state.prim === '每日放送') {
        return '/api/bangumi/calendar?weekday=' + encodeURIComponent(state.sec);
      }
      if (state.prim === '番剧') {
        return recUrl('tv', '动画', '电视剧', state.sec) + p;
      }
      return recUrl('movie', '动画', 'all', state.sec) + p;
    }
  }

  function load(append) {
    if (state.busy) return;
    state.busy = true;
    more.innerHTML = '加载中…';
    lunaXhr('GET', buildUrl(), null, function (status, data) {
      state.busy = false;
      more.innerHTML = '加载更多';
      var list = (data && data.list) || [];
      // 分页边界与主站一致：不足一页即无下一页（每日放送仅一页，自然隐藏）
      var canMore = list.length >= PAGE;
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
      more.style.display = canMore ? 'inline-block' : 'none';
      if (canMore) state.pageStart += PAGE;
    });
  }

  more.onclick = function () { load(true); };

  renderPills();
  load(false);
})();`;
}
