import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { buildLegacyNav, renderLegacyPageWithConfig } from '@/lib/legacy-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * iOS 9.3 轻量版直播页（对应主站 /live）：直播源 → 分组 → 频道列表，页面内 video 原生 HLS 播放。
 * 纯 ES5 + XHR，兼容约束见 src/lib/legacy-html.ts。
 * 数据端点与主站一致：/api/live/sources、/api/live/channels?source=xxx。
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
        title: '直播',
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
      title: '直播',
      siteName,
      body: `
${buildPageNav('live')}
<video id="player" controls playsinline webkit-playsinline preload="auto" x-webkit-airplay="allow"></video>
<div id="pmsg" class="msg"></div>
<div class="sec-h" style="margin-top:14px"><span class="st">直播源</span></div>
<div id="sources"><div class="loading">加载中…</div></div>
<div class="searchrow card" style="margin-top:12px">
  <input type="text" id="kw" placeholder="按频道名称过滤">
</div>
<div class="sec-h"><span class="st">频道分组</span></div>
<div id="groups"><div class="loading">等待直播源…</div></div>
<div class="chlist" id="chlist"><div class="loading">等待频道列表…</div></div>
<p class="hint">点击频道即播；HLS 线路 iOS 原生支持，FLV 线路可能无法播放。</p>`,
      script: liveScript(),
    }),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

function liveScript(): string {
  return `
(function () {
  var video = document.getElementById('player');
  var sourcesBox = document.getElementById('sources');
  var groupsBox = document.getElementById('groups');
  var listBox = document.getElementById('chlist');
  var kw = document.getElementById('kw');

  var sources = [];
  var channels = [];
  var groups = [];
  var grouped = {};
  var curSource = '';
  var curGroup = '';
  var curUrl = '';

  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s == null ? '' : s)));
    return d.innerHTML;
  }

  function lineTag(u) {
    u = (u || '').toLowerCase();
    if (u.indexOf('.m3u8') > -1) return 'HLS';
    if (u.indexOf('.flv') > -1 || u.indexOf('/flv') > -1) return 'FLV';
    if (u.indexOf('.mp4') > -1) return 'MP4';
    return '直播';
  }

  function playCh(ch) {
    if (!ch || !ch.url) return;
    curUrl = ch.url;
    video.src = ch.url;
    video.load();
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
    lunaShow('pmsg', '', '');
    renderList();
  }

  function visibleChannels() {
    var q = kw.value.replace(/^\\s+|\\s+$/g, '').toLowerCase();
    var base = q ? channels : (grouped[curGroup] || []);
    if (!q) return base;
    var out = [];
    for (var i = 0; i < base.length; i++) {
      var nm = (base[i].name || '').toLowerCase();
      if (nm.indexOf(q) > -1) out.push(base[i]);
    }
    return out;
  }

  function renderList() {
    var list = visibleChannels();
    if (!list.length) {
      listBox.innerHTML = '<div class="loading">' +
        (kw.value.replace(/^\\s+|\\s+$/g, '') ? '没有匹配的频道' : '该分组暂无频道') + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var tag = lineTag(c.url);
      html += '<a class="ch' + (c.url === curUrl ? ' cur' : '') + '" href="javascript:void(0)" data-i="' + i + '">' +
        '<span class="cq' + (tag === 'FLV' ? ' cq-n' : '') + '">' + tag + '</span>' +
        '<span class="cn">' + esc(c.name) + '</span>' +
        (c.group ? '<span class="cg">' + esc(c.group) + '</span>' : '') +
        '</a>';
    }
    listBox.innerHTML = html;
    var nodes = listBox.getElementsByTagName('a');
    for (var k = 0; k < nodes.length; k++) {
      nodes[k].onclick = function () {
        var c = list[parseInt(this.getAttribute('data-i'), 10)];
        if (c) playCh(c);
      };
    }
  }

  function buildGroups() {
    groups = [];
    grouped = {};
    for (var i = 0; i < channels.length; i++) {
      var g = channels[i].group || '其他';
      if (!grouped[g]) { grouped[g] = []; groups.push(g); }
      grouped[g].push(channels[i]);
    }
    if (!curGroup || !grouped[curGroup]) curGroup = groups[0] || '';
  }

  function renderGroups() {
    var html = '';
    for (var j = 0; j < groups.length; j++) {
      var g = groups[j];
      html += '<a class="tab' + (g === curGroup ? ' cur' : '') + '" href="javascript:void(0)" data-g="' + esc(g) + '">' +
        esc(g) + ' (' + grouped[g].length + ')</a>';
    }
    groupsBox.innerHTML = html || '<div class="loading">暂无分组</div>';
    var nodes = groupsBox.getElementsByTagName('a');
    for (var k = 0; k < nodes.length; k++) {
      nodes[k].onclick = function () {
        curGroup = this.getAttribute('data-g');
        kw.value = '';
        renderGroups();
        renderList();
      };
    }
  }

  function renderSources() {
    var html = '';
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      html += '<a class="tab' + (s.key === curSource ? ' cur' : '') + '" href="javascript:void(0)" data-k="' + esc(s.key) + '">' +
        esc(s.name) + (s.channelNumber ? ' (' + s.channelNumber + ')' : '') + '</a>';
    }
    sourcesBox.innerHTML = html || '<div class="loading">没有可用直播源</div>';
    var nodes = sourcesBox.getElementsByTagName('a');
    for (var k = 0; k < nodes.length; k++) {
      nodes[k].onclick = function () {
        loadChannels(this.getAttribute('data-k'));
      };
    }
  }

  function loadChannels(key) {
    curSource = key;
    renderSources();
    groupsBox.innerHTML = '<div class="loading">加载中…</div>';
    listBox.innerHTML = '<div class="loading">加载中…</div>';
    lunaXhr('GET', '/api/live/channels?source=' + encodeURIComponent(key), null, function (status, data) {
      if (status !== 200 || !data || !data.success || !data.data || !data.data.length) {
        channels = [];
        groups = [];
        grouped = {};
        curGroup = '';
        curUrl = '';
        groupsBox.innerHTML = '<div class="loading">暂无分组</div>';
        listBox.innerHTML = '<div class="loading">暂无频道</div>';
        return;
      }
      channels = data.data;
      curUrl = '';
      buildGroups();
      renderGroups();
      renderList();
      if (channels.length) playCh(channels[0]);
    });
  }

  kw.onkeyup = function () { renderList(); };

  lunaXhr('GET', '/api/live/sources', null, function (status, data) {
    if (status !== 200 || !data || !data.success || !data.data || !data.data.length) {
      sourcesBox.innerHTML = '<div class="loading">没有可用直播源</div>';
      groupsBox.innerHTML = '<div class="loading">暂无分组</div>';
      listBox.innerHTML = '<div class="loading">暂无频道</div>';
      return;
    }
    sources = data.data;
    curSource = sources[0].key;
    renderSources();
    loadChannels(curSource);
  });
})();`;
}
