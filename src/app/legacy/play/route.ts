import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { buildLegacyNav, renderLegacyPageWithConfig } from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版播放页：原生 HLS（<video src=m3u8>）播放，无需 hls.js。
 * 前端 ES5 拉取 /api/detail 渲染选集；URL 参数与主站 /play 一致
 * （title/year/douban_id/stype/source/id）；直连失败自动降级到同源代理重试。
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
        title: '播放',
        siteName,
        body: `<div class="card"><h2 class="pt">请先登录</h2>
<p class="hint">登录后即可播放</p>
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
      title: '播放',
      siteName,
      body: `
${buildLegacyNav('')}
<h2 class="pt" id="vtitle">加载中…</h2>
<video id="player" controls playsinline webkit-playsinline preload="auto" x-webkit-airplay="allow"></video>
<div id="pmsg" class="msg"></div>
<div class="ptabs"><a class="ptab cur" id="ptabEps" href="javascript:void(0)">选集</a><a class="ptab src" id="ptabSrc" href="javascript:void(0)">换源</a></div>
<div id="paneEps">
  <div class="navrow">
    <a class="nav" id="prevBtn" href="javascript:void(0)">&#8249; 上一集</a>
    <a class="nav" id="nextBtn" href="javascript:void(0)">下一集 &#8250;</a>
  </div>
  <div class="eps" id="eps"></div>
</div>
<div id="paneSrc" style="display:none">
  <div class="srchint">换源（<span id="vcount">0</span>）· 点击卡片切换播放版本</div>
  <div class="row" id="vrow"><div class="loading">加载版本中…</div></div>
</div>
<div class="hero">
  <span class="herobg" id="herobg"></span>
  <span class="herograd"></span>
  <div class="heroinner">
    <div class="htags" id="htags"></div>
    <h1 class="htitle" id="htitle"></h1>
    <p class="hdesc" id="hdesc"></p>
    <div><a class="herofav" id="favBtn" href="javascript:void(0)">&#9825; 加入收藏</a></div>
  </div>
</div>
<div class="tabs" id="tabs">
  <a class="tab cur" href="javascript:void(0)" data-t="ov">概览</a>
  <a class="tab" href="javascript:void(0)" data-t="ac">演员</a>
  <a class="tab" href="javascript:void(0)" data-t="rc">推荐</a>
  <a class="tab" href="javascript:void(0)" data-t="cm">短评</a>
</div>
<div id="tabbody"></div>
<div id="fmsg" class="msg"></div>`,
      script: playScript(),
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

function playScript(): string {
  return `
(function () {
  // URL 参数与主站 /play 一致：title/year/douban_id/stype/source/id（另加 index 记录集数）
  var source = lunaQs('source');
  var id = lunaQs('id');
  var title = lunaQs('title');
  var year = lunaQs('year');
  var doubanId = lunaQs('douban_id');
  var stype = lunaQs('stype');
  var cur = parseInt(lunaQs('index') || '0', 10) || 0;

  var video = document.getElementById('player');
  var epsBox = document.getElementById('eps');
  var verRow = document.getElementById('vrow');
  var tabBody = document.getElementById('tabbody');
  var episodes = [];
  var episodes_titles = [];
  var useProxy = false;
  var switching = false; // 自动降级重载期间忽略 onerror，避免误报最终失败
  var curDetail = null;  // 当前源详情（渲染概览信息）
  var favOn = false;
  // tabs 状态
  var curTab = 'ov';
  var dbData = null;     // 豆瓣详情（演员/推荐）
  var infoHtml = '<div class="empty">暂无简介</div>';
  var cmHtml = null;     // 短评缓存（懒加载）
  // 播放进度记忆（主站 PlayRecord：play_time/total_time 秒，index 1-based）
  var prKey = source + '+' + id;
  var resumeTime = 0;    // 待恢复的秒数（canplay 后一次性 seek）
  var resumed = false;
  var lastSave = 0;      // timeupdate 节流时间戳

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  function currentUrl() {
    var u = episodes[cur];
    if (!u) return '';
    if (useProxy) return '/api/proxy/m3u8?url=' + encodeURIComponent(u);
    return u;
  }

  function updateNav() {
    var prev = document.getElementById('prevBtn');
    var next = document.getElementById('nextBtn');
    prev.style.visibility = cur > 0 ? 'visible' : 'hidden';
    next.style.visibility = cur < episodes.length - 1 ? 'visible' : 'hidden';
  }

  // ===== 播放进度记忆（与主站 PlayRecord 同结构，接口 /api/playrecords） =====
  function buildRecord() {
    var d = curDetail || {};
    return {
      title: d.title || title || '',
      source_name: d.source_name || '',
      cover: d.poster || '',
      year: d.year || year || '',
      index: cur + 1, // 主站 PlayRecord.index 为 1-based
      total_episodes: episodes.length,
      play_time: Math.floor(video.currentTime || 0),
      total_time: Math.floor(video.duration || 0),
      save_time: Date.now(),
      search_title: d.title || title || '',
      douban_id: doubanId ? Number(doubanId) : undefined,
      type: stype || undefined,
      remarks: d.remarks || undefined,
      original_episodes: d.original_episodes || undefined
    };
  }

  function saveRecord() {
    if (!episodes.length || !video.currentTime) return;
    var rec = buildRecord();
    if (!rec.title) return;
    lunaXhr('POST', '/api/playrecords', { key: prKey, record: rec }, function () {});
  }

  // 读取播放记录恢复进度（同一集且进度 >30s 且不在片尾 95% 内才恢复，与主站一致）
  function loadResume() {
    lunaXhr('GET', '/api/playrecords', null, function (status, data) {
      if (status !== 200 || !data) return;
      var rec = data[prKey];
      if (!rec || Number(rec.index) !== cur + 1) return;
      var t = Number(rec.play_time) || 0;
      if (t > 30) resumeTime = t;
    });
  }

  function tryResume() {
    if (resumed || !resumeTime) return;
    var dur = video.duration || 0;
    // 主站逻辑：接近片尾不恢复（从头看）
    if (dur && resumeTime > dur * 0.95) {
      resumed = true;
      return;
    }
    try { video.currentTime = resumeTime; } catch (e) {}
    resumed = true;
  }

  // 主站小屏标题行格式：片名 > 第x集
  function updateTitle() {
    var d = curDetail || {};
    var t = esc(d.title || title || '播放');
    if (episodes.length > 1) {
      var ep = episodes_titles[cur] || ('第 ' + (cur + 1) + ' 集');
      t += ' <span style="color:#6b7280;font-weight:normal;font-size:15px">&gt; ' + esc(ep) + '</span>';
    }
    document.getElementById('vtitle').innerHTML = t;
  }

  function syncUrl() {
    try {
      history.replaceState(null, '', '/legacy/play?title=' + encodeURIComponent(title) +
        '&year=' + encodeURIComponent(year) +
        '&douban_id=' + encodeURIComponent(doubanId) +
        '&stype=' + encodeURIComponent(stype) +
        '&source=' + encodeURIComponent(source) +
        '&id=' + encodeURIComponent(id) + '&index=' + cur);
    } catch (e) {}
  }

  function play(i) {
    if (!episodes.length) return;
    if (cur !== i && episodes.length) saveRecord(); // 换集前保存当前集进度
    cur = Math.max(0, Math.min(i, episodes.length - 1));
    // 新集恢复状态重置（从头播放，记录恢复由 loadResume 决定）
    resumed = false;
    resumeTime = 0;
    lastSave = Date.now();
    video.src = currentUrl();
    video.load();
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
    var nodes = epsBox.getElementsByTagName('a');
    for (var k = 0; k < nodes.length; k++) {
      nodes[k].className = k === cur ? 'ep cur' : 'ep';
    }
    updateTitle();
    if (curDetail) renderHero(null); // 换集时同步 Hero 集数胶囊
    syncUrl();
    updateNav();
  }

  function renderEps() {
    var html = '';
    for (var i = 0; i < episodes.length; i++) {
      var label = (episodes.length > 1 && episodes_titles[i]) ? episodes_titles[i] : ('第' + (i + 1) + '集');
      html += '<a class="ep" href="javascript:void(0)" data-i="' + i + '">' + esc(label) + '</a>';
    }
    epsBox.innerHTML = html;
    var nodes = epsBox.getElementsByTagName('a');
    for (var k = 0; k < nodes.length; k++) {
      nodes[k].onclick = function () {
        play(parseInt(this.getAttribute('data-i'), 10));
      };
    }
  }

  function loadDetail() {
    lunaXhr('GET', '/api/detail?source=' + encodeURIComponent(source) +
      '&id=' + encodeURIComponent(id) + '&title=' + encodeURIComponent(title), null,
      function (status, data) {
        if (status !== 200 || !data || !data.episodes || !data.episodes.length) {
          document.getElementById('vtitle').innerHTML = '加载失败';
          lunaShow('pmsg', '获取播放信息失败，可在换源面板选择其他版本', 'err');
          return;
        }
        episodes = data.episodes;
        episodes_titles = data.episodes_titles || [];
        curDetail = data;
        updateTitle();
        renderHero(null);
        renderInfo(null);
        loadDoubanInfo();
        checkFav();
        loadResume();
        if (cur >= episodes.length) cur = 0;
        renderEps();
        play(cur);
      });
  }

  // ===== 选集/换源面板（主站 EpisodeSelector：选集绿 tab + 换源蓝 tab） =====
  function setPane(p) {
    var epsOn = p === 'eps';
    document.getElementById('ptabEps').className = epsOn ? 'ptab cur' : 'ptab';
    document.getElementById('ptabSrc').className = epsOn ? 'ptab src' : 'ptab src cur';
    document.getElementById('paneEps').style.display = epsOn ? 'block' : 'none';
    document.getElementById('paneSrc').style.display = epsOn ? 'none' : 'block';
  }

  // ===== Tabs（主站 PlayInfoPanel：概览/演员/推荐/短评，选中蓝色下划线） =====
  function setTab(t) {
    curTab = t;
    var tabs = document.getElementById('tabs').getElementsByTagName('a');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].className = tabs[i].getAttribute('data-t') === t ? 'tab cur' : 'tab';
    }
    renderTab();
  }

  function renderTab() {
    if (curTab === 'ov') {
      tabBody.innerHTML = infoHtml;
    } else if (curTab === 'ac') {
      renderActors();
    } else if (curTab === 'rc') {
      renderRecs();
    } else if (curTab === 'cm') {
      if (cmHtml === null) {
        tabBody.innerHTML = '<div class="loading">加载短评中…</div>';
        loadComments();
      } else {
        tabBody.innerHTML = cmHtml;
      }
    }
  }

  function renderActors() {
    var cel = (dbData && (dbData.celebrities || dbData.actors)) || [];
    var html = '';
    var i;
    for (i = 0; i < cel.length; i++) {
      var c = cel[i] || {};
      if (!c.name) continue;
      html += '<span class="acard"><span class="aav" style="background-image:url(' +
        esc(lunaImg(c.avatar || '')) + ')"></span>' +
        '<span class="an">' + esc(c.name) + '</span>' +
        '<span class="ar">' + esc(c.role || '演员') + '</span></span>';
    }
    if (!html && dbData && dbData.cast && dbData.cast.length) {
      html = '<div class="card">' + esc(dbData.cast.join('、')) + '</div>';
    }
    tabBody.innerHTML = html || '<div class="empty">暂无演员数据</div>';
  }

  function renderRecs() {
    var recs = (dbData && dbData.recommendations) || [];
    var html = '';
    var i;
    for (i = 0; i < recs.length; i++) {
      var r = recs[i] || {};
      if (!r.title) continue;
      html += '<a class="vcard" href="/legacy/detail?title=' + encodeURIComponent(r.title) +
        '&year=' + encodeURIComponent(r.year || '') +
        '&douban_id=' + encodeURIComponent(r.id || '') +
        '&stype=' + encodeURIComponent(stype) + '">' +
        '<span class="vpic" style="background-image:url(' + esc(lunaImg(r.poster)) + ')"></span>' +
        '<span class="vt">' + esc(r.title) + '</span>' +
        (r.rate && r.rate !== '0' ? '<span class="vtag">★ ' + esc(r.rate) + '</span>' : '') +
        '</a>';
    }
    tabBody.innerHTML = html || '<div class="empty">暂无推荐</div>';
  }

  function loadComments() {
    lunaXhr('GET', '/api/douban/comments?id=' + encodeURIComponent(doubanId) + '&start=0&limit=15&sort=new', null,
      function (status, data) {
        var list = (data && data.code === 200 && data.data && data.data.comments) || [];
        var html = '';
        var i;
        for (i = 0; i < list.length; i++) {
          var cm = list[i] || {};
          if (!cm.content) continue;
          var stars = '';
          if (cm.rating && cm.rating >= 1 && cm.rating <= 5) {
            for (var k = 0; k < cm.rating; k++) stars += '&#9733;';
          }
          html += '<div class="ccard">' +
            '<span class="cav" style="background-image:url(' + esc(lunaImg(cm.avatar)) + ')"></span>' +
            '<span class="cn">' + esc(cm.username || '豆瓣网友') + '</span>' +
            '<span class="ct">' + esc(cm.time || '') + (cm.location ? ' · ' + esc(cm.location) : '') + '</span>' +
            (stars ? '<p class="cr">' + stars + '</p>' : '') +
            '<p class="cc">' + esc(cm.content) + '</p></div>';
        }
        cmHtml = html || '<div class="empty">暂无短评</div>';
        if (curTab === 'cm') tabBody.innerHTML = cmHtml;
      });
  }

  // ===== Hero 横幅（主站 PlayInfoPanel：大背景图 + 标签胶囊 + 大标题 + 简介 + 收藏按钮） =====
  function renderHero(db) {
    var d = curDetail || {};
    var poster = (db && db.poster) || d.poster || '';
    var rate = (db && db.rate && db.rate !== '0' && db.rate !== '0.0') ? db.rate : '';
    var bg = document.getElementById('herobg');
    if (poster) bg.style.backgroundImage = 'url(' + lunaImg(poster) + ')';
    var tags = '';
    if (d.source_name) tags += '<span class="htag">' + esc(d.source_name) + '</span>';
    var y = (db && db.year) || d.year || year;
    if (y) tags += '<span class="htag">' + esc(y) + '</span>';
    if (rate) tags += '<span class="htag gold">&#9733; ' + esc(rate) + '</span>';
    if (episodes.length > 1) {
      tags += '<span class="htag">' + esc(episodes_titles[cur] || ('第 ' + (cur + 1) + ' 集')) + '</span>';
    }
    document.getElementById('htags').innerHTML = tags;
    document.getElementById('htitle').innerHTML = esc(d.title || title || '');
    document.getElementById('hdesc').innerHTML = esc((db && db.plot_summary) || d.desc || '');
  }

  // ===== 概览 tab（主站 OverviewTab：基本信息行 + 豆瓣字段 + 彩色胶囊） =====
  function renderInfo(db) {
    var d = curDetail || {};
    var genres = (db && db.genres && db.genres.length) ? db.genres.join(' / ')
      : (d.class || d.type_name || '');
    var y = (db && db.year) || d.year || year;
    var rate = (db && db.rate && db.rate !== '0' && db.rate !== '0.0') ? db.rate
      : ((d.metadata && d.metadata.vote_average) || '');

    // 基本信息行：类型（绿）+ 年份 + 源名（边框胶囊）+ 类型名（灰）
    var html = '<div class="ovb">';
    if (genres) html += '<span class="og">' + esc(genres) + '</span>';
    if (y) html += '<span style="margin-left:8px">' + esc(y) + '</span>';
    if (d.source_name) html += '<span class="ob">' + esc(d.source_name) + '</span>';
    if (d.type_name) html += '<span class="ot">' + esc(d.type_name) + '</span>';
    html += '</div>';

    // 豆瓣详情字段行
    if (db) {
      if (rate) {
        html += '<div class="frow"><span class="fk">豆瓣评分: </span><span class="frate">' + esc(rate) + '</span></div>';
      }
      if (db.directors && db.directors.length) {
        html += '<div class="frow"><span class="fk">导演: </span><span class="fv">' + esc(db.directors.join('、')) + '</span></div>';
      }
      if (db.screenwriters && db.screenwriters.length) {
        html += '<div class="frow"><span class="fk">编剧: </span><span class="fv">' + esc(db.screenwriters.join('、')) + '</span></div>';
      }
      if (db.cast && db.cast.length) {
        html += '<div class="frow"><span class="fk">主演: </span><span class="fv">' + esc(db.cast.join('、')) + '</span></div>';
      }
      if (db.first_aired) {
        html += '<div class="frow"><span class="fk">' + (db.episodes ? '首播: ' : '上映: ') + '</span><span class="fv">' + esc(db.first_aired) + '</span></div>';
      }
      // 彩色胶囊：国家(蓝)/语言(紫)/共x集(绿)/单集时长(橙/红)
      var chips = '';
      var i;
      if (db.countries) {
        for (i = 0; i < db.countries.length && i < 2; i++) {
          chips += '<span class="chip c-blue">' + esc(db.countries[i]) + '</span>';
        }
      }
      if (db.languages) {
        for (i = 0; i < db.languages.length && i < 2; i++) {
          chips += '<span class="chip c-purple">' + esc(db.languages[i]) + '</span>';
        }
      }
      if (db.episodes) chips += '<span class="chip c-green">共' + esc(db.episodes) + '集</span>';
      if (db.episode_length) chips += '<span class="chip c-orange">单集' + esc(db.episode_length) + '分钟</span>';
      if (db.movie_duration) chips += '<span class="chip c-red">' + esc(db.movie_duration) + '分钟</span>';
      if (chips) html += '<div class="chips">' + chips + '</div>';
    }

    var desc = (db && db.plot_summary) || d.desc || '';
    if (desc) html += '<p class="idesc">' + esc(desc) + '</p>';

    infoHtml = html || '<div class="empty">暂无简介</div>';
    if (curTab === 'ov') tabBody.innerHTML = infoHtml;
  }

  function loadDoubanInfo() {
    if (!doubanId) return;
    lunaXhr('GET', '/api/douban/details?id=' + encodeURIComponent(doubanId), null,
      function (status, data) {
        if (status === 200 && data && data.code === 200 && data.data) {
          dbData = data.data;
          renderHero(dbData);
          renderInfo(dbData);
        }
      });
  }

  // ===== 收藏（主站同一接口） =====
  function favKey() { return source + '+' + id; }

  function updateFavBtn() {
    var btn = document.getElementById('favBtn');
    btn.innerHTML = favOn ? '&#10084; 已加入收藏' : '&#9825; 加入收藏';
    btn.className = favOn ? 'herofav on' : 'herofav';
  }

  function checkFav() {
    lunaXhr('GET', '/api/favorites?key=' + encodeURIComponent(favKey()), null, function (st, d) {
      favOn = !!(d && d.title);
      updateFavBtn();
    });
  }

  document.getElementById('favBtn').onclick = function () {
    if (favOn || !curDetail) return;
    var d = curDetail;
    var fav = {
      source_name: d.source_name || source,
      total_episodes: episodes.length,
      title: d.title || title,
      year: d.year || year,
      cover: d.poster || '',
      save_time: new Date().getTime(),
      search_title: title,
      origin: 'vod'
    };
    lunaXhr('POST', '/api/favorites', { key: favKey(), favorite: fav }, function (st, d2) {
      if (st === 200) {
        favOn = true;
        updateFavBtn();
        lunaShow('fmsg', '已加入收藏', 'ok');
      } else {
        lunaShow('fmsg', '收藏失败，请重试', 'err');
      }
    });
  };

  // ===== 换源面板（复刻主站播放页右侧列表：按源分组版本卡片，当前源绿框高亮） =====
  function updateVerCur() {
    var cards = verRow.getElementsByTagName('a');
    for (var i = 0; i < cards.length; i++) {
      var m = cards[i].getAttribute('data-source') === source &&
        cards[i].getAttribute('data-id') === id;
      cards[i].className = m ? 'vcard cur' : 'vcard';
    }
  }

  function renderVersions() {
    lunaXhr('GET', '/api/search?q=' + encodeURIComponent(title), null, function (status, data) {
      if (status !== 200 || !data) {
        verRow.innerHTML = '<div class="loading">版本加载失败</div>';
        return;
      }
      var list = data.results || [];
      var seen = {};
      var groups = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it.source || !it.id || seen[it.source]) continue;
        seen[it.source] = true;
        groups.push(it);
      }
      document.getElementById('vcount').innerHTML = groups.length;
      if (!groups.length) {
        verRow.innerHTML = '<div class="loading">没有其他可用版本</div>';
        return;
      }
      var html = '';
      for (var j = 0; j < groups.length; j++) {
        var v = groups[j];
        html += '<a class="vcard" href="javascript:void(0)" data-source="' + esc(v.source) +
          '" data-id="' + esc(v.id) + '">' +
          '<span class="vpic" style="background-image:url(' + esc(lunaImg(v.poster)) + ')"></span>' +
          '<span class="vt">' + esc(v.title || title) + '</span>' +
          '<span class="vtag">' + esc(v.source_name || v.source) + '</span>' +
          '<span class="curtag">当前源</span></a>';
      }
      verRow.innerHTML = html;
      var cards = verRow.getElementsByTagName('a');
      for (var k = 0; k < cards.length; k++) {
        cards[k].onclick = function () {
          var ns = this.getAttribute('data-source');
          var nid = this.getAttribute('data-id');
          if (ns === source && nid === id) return;
          // 就地换源：重置降级状态，重新拉取该源详情
          source = ns;
          id = nid;
          cur = 0;
          useProxy = false;
          switching = false;
          epsBox.innerHTML = '';
          lunaShow('pmsg', '', '');
          updateVerCur();
          syncUrl();
          loadDetail();
        };
      }
      updateVerCur();
    });
  }

  loadDetail();
  renderVersions();
  renderTab();

  // Tabs 点击切换（概览/演员/推荐/短评）
  (function () {
    var tabs = document.getElementById('tabs').getElementsByTagName('a');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].onclick = function () { setTab(this.getAttribute('data-t')); };
    }
  })();

  // 选集/换源面板切换（主站 EpisodeSelector 双 tab）
  document.getElementById('ptabEps').onclick = function () { setPane('eps'); };
  document.getElementById('ptabSrc').onclick = function () { setPane('src'); };

  // 播放进度：canplay 后一次性 seek 恢复；timeupdate 节流 10s 保存；离开页面时保存
  video.addEventListener('canplay', tryResume);
  video.addEventListener('timeupdate', function () {
    tryResume();
    var now = Date.now();
    if (now - lastSave > 10000) {
      lastSave = now;
      saveRecord();
    }
  });
  window.addEventListener('pagehide', saveRecord);
  window.addEventListener('beforeunload', saveRecord);

  // 直连失败自动降级：第一次错误 → 静默切代理重试；代理也失败 → 提示换源
  video.onerror = function () {
    if (switching) return;
    if (!useProxy) {
      useProxy = true;
      switching = true;
      lunaShow('pmsg', '直连线路播放失败，已自动切换代理线路…', '');
      play(cur);
      setTimeout(function () { switching = false; }, 4000);
    } else {
      lunaShow('pmsg', '代理线路也无法播放，请在换源面板选择其他版本', 'err');
    }
  };

  document.getElementById('prevBtn').onclick = function () { play(cur - 1); };
  document.getElementById('nextBtn').onclick = function () { play(cur + 1); };
})();`;
}
