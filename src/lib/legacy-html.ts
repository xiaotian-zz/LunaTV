/**
 * iOS 9.3（Safari 9）轻量版页面外壳
 *
 * 输出的 HTML 必须兼容 2016 年的 Safari 9，硬性约束：
 * - CSS：禁止 CSS 变量(var)、Grid、flex gap、oklch、@property（Safari 9 均不支持）；
 *   布局用 inline-block / float + margin，颜色用具体色值
 * - JS：只允许 ES5（var、function、无箭头/模板字符串/解构/async），
 *   请求用 XMLHttpRequest（iOS 9.3 无 fetch），URL 参数手动解析（无 URLSearchParams）
 * - 视频：iOS 9.3 原生支持 HLS，<video src="m3u8"> 直接播放，无需 hls.js
 *
 * 视觉规格 1:1 对齐主站浅色主题（globals.css html:not(.dark) + MobileHeader + HomeClient）：
 * - body 浅色渐变 #e6f3fb→#d3dde6（fixed）、文字 gray-800
 * - 顶栏 64px bg-white/90（无 backdrop-filter 用 0.94 不透明度补偿），站点名 green-600
 * - 卡片 rounded-lg、海报 2:3、评分徽章 rounded-full 动态配色
 * - 分类胶囊 rgba(17,24,39,0.05)、选中 #d7f5e8 底 + #009873 字（主站绿胶囊）
 * - 交互主色 green-600 #16a34a（欢迎横幅 #d7f5e8 底 #009873 字）
 */

import { getConfig } from '@/lib/config';

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LEGACY_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-box-sizing: border-box; }
body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #1f2937; font-size: 15px; line-height: 1.5;
  background: #eaf3f7;
  background-image: -webkit-linear-gradient(top, #e6f3fb 0%, #eaf3f7 18%, #f7f7f3 38%, #e9ecef 60%, #dbe3ea 80%, #d3dde6 100%);
  background-image: linear-gradient(180deg, #e6f3fb 0%, #eaf3f7 18%, #f7f7f3 38%, #e9ecef 60%, #dbe3ea 80%, #d3dde6 100%);
  background-attachment: fixed;
  -webkit-text-size-adjust: 100%; }
a { text-decoration: none; color: inherit; }

/* ===== 顶栏（主站 MobileHeader：h-16 bg-white/90 + green-600 站点名） ===== */
.topbar { position: fixed; top: 0; left: 0; right: 0; height: 64px; padding: 0 16px;
  background: #fff; background: rgba(255,255,255,0.94);
  border-bottom: 1px solid rgba(229,231,235,0.9); z-index: 10; }
.topbar .brand { display: inline-block; line-height: 64px; font-size: 20px; font-weight: bold;
  color: #16a34a; }
.topbar .back { float: left; line-height: 64px; margin-right: 14px; color: #4b5563;
  font-weight: normal; font-size: 15px; }
.wrap { padding: 76px 16px 32px; max-width: 1280px; margin: 0 auto; }

/* ===== 顶部导航（主站横向导航：白底、图标+文字、选中绿字+绿下划线） ===== */
.mnav { background: #ffffff; border-bottom: 1px solid #eef1f4; margin: 0 -14px 14px;
  padding: 0 6px; overflow-x: auto; white-space: nowrap; text-align: center;
  -webkit-overflow-scrolling: touch; }
.mnav a { display: inline-block; vertical-align: top; padding: 13px 9px 11px;
  font-size: 14px; color: #374151; border-bottom: 2px solid transparent; }
.mnav a svg { width: 15px; height: 15px; vertical-align: -2.5px; margin-right: 3px; }
.mnav a.cur { color: #16a34a; font-weight: bold; border-bottom-color: #16a34a; }

/* ===== 欢迎横幅（主站 HomeClient：bg-#d7f5e8 + text-#009873） ===== */
.banner { background: #d7f5e8; background: rgba(215,245,232,0.92);
  border: 1px solid rgba(255,255,255,0.5); border-radius: 12px; -webkit-border-radius: 12px;
  padding: 13px 16px; margin-bottom: 14px; }
.banner .bt { display: block; font-size: 17px; font-weight: bold; color: #009873; }
.banner .bs { display: block; font-size: 13px; color: rgba(0,152,115,0.9); margin-top: 2px; }

/* ===== 卡片（主站 VideoCard：rounded-lg、2:3 海报、无框） ===== */
/* 海报统一 104px（与首页横向滚动区块一致），网格按容器宽度自动换行（自适应） */
.item { position: relative; display: inline-block; vertical-align: top; width: 104px;
  margin: 0 10px 16px 0; }
.item .pic { display: block; width: 100%; height: 0; padding-bottom: 150%;
  background: #e5e7eb; background-size: cover; background-position: center;
  border-radius: 8px; -webkit-border-radius: 8px; overflow: hidden; }
.item:active .pic { opacity: 0.85; }
.item .t { display: block; margin-top: 6px; font-size: 13px; color: #1f2937;
  white-space: nowrap; overflow: hidden; -o-text-overflow: ellipsis; text-overflow: ellipsis; }
.item .s { display: block; margin-top: 1px; font-size: 11px; color: #6b7280; }
.item .rate { position: absolute; top: 6px; right: 6px; padding: 1px 7px; font-size: 11px;
  font-weight: bold; color: #fff; border-radius: 99px; -webkit-border-radius: 99px; }
.item .rate.rate-g { background: #22c55e; }
.item .rate.rate-y { background: #eab308; }
.item .rate.rate-n { background: rgba(17,24,39,0.65); color: #f3f4f6; }

/* ===== 浏览页分类选择器（主站 DoubanPage：大标题 + 白卡内 分类/地区 两行胶囊） ===== */
.bigh { font-size: 26px; font-weight: bold; color: #111827; margin: 4px 0 2px; }
.bigsub { font-size: 14px; color: #6b7280; margin: 0 0 14px; }
.selcard { padding: 14px 16px; }
.selrow { margin-bottom: 10px; white-space: nowrap; overflow-x: auto;
  -webkit-overflow-scrolling: touch; }
.selrow:last-child { margin-bottom: 0; }
.sellab { display: inline-block; vertical-align: middle; font-size: 14px;
  color: #6b7280; margin-right: 10px; }
.pill { display: inline-block; vertical-align: middle; padding: 6px 15px; margin: 2px 6px 2px 0;
  font-size: 14px; color: #374151; background: #f3f4f6; border: 1px solid transparent;
  border-radius: 999px; -webkit-border-radius: 999px; }
.pill.cur { background: #ffffff; border-color: #e5e7eb; color: #111827; font-weight: bold;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05); }

/* ===== 分类胶囊（选中态=主站绿胶囊：#d7f5e8 底 + #009873 字） ===== */
.pillbox { background: rgba(17,24,39,0.05); border-radius: 99px;
  -webkit-border-radius: 99px; padding: 4px; margin-bottom: 10px; }
.tabgrp { font-size: 13px; color: #374151; margin: 6px 4px; font-weight: bold; }
.tabrow { margin-bottom: 8px; }
.tab { display: inline-block; vertical-align: top; padding: 7px 14px; margin: 2px 4px;
  font-size: 13px; color: #4b5563; background: transparent; border-radius: 99px;
  -webkit-border-radius: 99px; }
.tab.cur { color: #009873; background: #d7f5e8; font-weight: bold; }

/* ===== 通用控件 ===== */
.card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;
  -webkit-border-radius: 12px; padding: 16px; margin-bottom: 16px; }
input[type=text], input[type=password] { width: 100%; padding: 11px 13px; font-size: 16px;
  border: 1px solid #d1d5db; border-radius: 10px; -webkit-border-radius: 10px;
  background: #ffffff; color: #1f2937; margin-bottom: 12px;
  -webkit-appearance: none; appearance: none; }
.btn { display: block; width: 100%; padding: 12px; font-size: 16px; font-weight: bold;
  text-align: center; color: #fff; background: #16a34a; border: 0; border-radius: 10px;
  -webkit-border-radius: 10px; -webkit-appearance: none; appearance: none; }
.btn:active { background: #15803d; }
.msg { padding: 9px 12px; border-radius: 10px; -webkit-border-radius: 10px;
  margin-bottom: 12px; font-size: 13px; display: none; }
.msg.err { display: block; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
.msg.ok { display: block; background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
.searchrow { margin-bottom: 16px; }
.searchrow input { margin-bottom: 0; }
.searchrow .btn { margin-top: 10px; }

/* ===== 首页区块（主站 HomeClient：SectionTitle 彩色图标 + 查看更多 + ScrollableRow） ===== */
.sec { margin-bottom: 8px; }
.sec-h { margin: 4px 0 9px; }
.sec-h .st { display: inline-block; font-size: 16px; font-weight: bold; color: #111827; }
.sec-h .st svg { width: 17px; height: 17px; vertical-align: -2.5px; margin-right: 5px; }
.sec-h .more { float: right; font-size: 12px; color: #374151; background: #ffffff;
  border: 1px solid #e5e7eb; border-radius: 99px; -webkit-border-radius: 99px; padding: 4px 11px; }
.sec-h .more:active { background: #f3f4f6; }
.row { white-space: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch;
  margin: 0 -14px; padding: 2px 14px 6px; }
/* 首页横向区块与网格共用 .item（104px），此处仅继承 */

/* ===== 播放页换源面板（主站 PlayPage 右侧换源列表：版本卡片、当前源绿框高亮） ===== */
.vcard { display: inline-block; vertical-align: top; width: 96px; margin: 0 9px 10px 0;
  background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;
  -webkit-border-radius: 8px; padding: 6px; }
.vcard:active { background: #f3f4f6; }
.vcard.cur { border-color: #16a34a; background: #f0fdf4; }
.vcard .vpic { display: block; width: 100%; height: 0; padding-bottom: 135%;
  background: #e5e7eb; background-size: cover; background-position: center;
  border-radius: 6px; -webkit-border-radius: 6px; }
.vcard .vt { display: block; margin-top: 5px; font-size: 12px; color: #1f2937;
  white-space: nowrap; overflow: hidden; -o-text-overflow: ellipsis; text-overflow: ellipsis; }
.vcard .vtag { display: inline-block; margin-top: 3px; font-size: 11px; color: #374151;
  background: rgba(17,24,39,0.06); border-radius: 4px; -webkit-border-radius: 4px; padding: 1px 6px; }
.vcard .curtag { display: none; margin-top: 3px; margin-left: 4px; font-size: 11px;
  color: #fff; background: #16a34a; border-radius: 4px; -webkit-border-radius: 4px; padding: 1px 6px; }
.vcard.cur .curtag { display: inline-block; }

/* ===== 播放页 Tabs（主站 PlayInfoPanel：概览/演员/推荐/短评，选中蓝色下划线） ===== */
.tabs { margin: 14px 0 10px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
.tab { display: inline-block; margin: 0 14px; padding: 8px 2px; font-size: 14px;
  color: #6b7280; border-bottom: 2px solid transparent; }
.tabs .tab.cur { color: #2563eb; border-bottom-color: #2563eb; font-weight: bold; }
.acard { display: inline-block; vertical-align: top; width: 72px; margin: 0 10px 12px 0; text-align: center; }
.acard .aav { display: block; width: 72px; height: 0; padding-bottom: 72px;
  background: #e5e7eb; background-size: cover; background-position: center;
  border-radius: 36px; -webkit-border-radius: 36px; }
.acard .an { display: block; margin-top: 4px; font-size: 12px; color: #1f2937;
  white-space: nowrap; overflow: hidden; -o-text-overflow: ellipsis; text-overflow: ellipsis; }
.acard .ar { display: block; font-size: 11px; color: #9ca3af; }
.ccard { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px;
  -webkit-border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.ccard .cav { display: inline-block; width: 30px; height: 0; padding-bottom: 30px;
  vertical-align: middle; background: #e5e7eb; background-size: cover; background-position: center;
  border-radius: 15px; -webkit-border-radius: 15px; }
.ccard .cn { display: inline-block; vertical-align: middle; margin-left: 8px;
  font-size: 13px; color: #1f2937; font-weight: bold; }
.ccard .ct { display: inline-block; vertical-align: middle; margin-left: 8px;
  font-size: 11px; color: #9ca3af; }
.ccard .cr { color: #f59e0b; font-size: 12px; margin-top: 4px; }
.ccard .cc { margin-top: 5px; font-size: 13px; color: #374151; line-height: 1.6; }
.empty { text-align: center; color: #9ca3af; font-size: 13px; padding: 16px 0; }

/* ===== 播放页概览信息（主站信息横幅 + 概览 tab：类型/评分/导演/主演/标签/简介） ===== */
.info .ipic { float: right; width: 92px; height: 0; padding-bottom: 132px; margin: 0 0 8px 12px;
  background: #e5e7eb; background-size: cover; background-position: center;
  border-radius: 8px; -webkit-border-radius: 8px; }
.info .ig { font-size: 13px; color: #4b5563; }
.info .igreen { color: #16a34a; font-weight: bold; }
.info .itag { display: inline-block; margin: 0 2px; font-size: 11px; color: #374151;
  background: rgba(17,24,39,0.06); border-radius: 4px; -webkit-border-radius: 4px; padding: 1px 6px; }
.info .ir { font-size: 13px; color: #4b5563; margin-top: 4px; }
.info .ival { color: #f59e0b; font-weight: bold; font-size: 15px; }
.info .il { font-size: 13px; color: #374151; margin-top: 3px; }
.info .itags { margin-top: 5px; }
.info .tag { display: inline-block; margin: 0 5px 5px 0; font-size: 11px; color: #15803d;
  background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;
  -webkit-border-radius: 4px; padding: 1px 7px; }
.info .idesc { margin-top: 8px; font-size: 13px; color: #4b5563; line-height: 1.65; }

/* ===== 播放页概览 tab（主站 OverviewTab：基本信息行 + 豆瓣字段 + 彩色胶囊） ===== */
.info .ovb { font-size: 15px; color: #1f2937; margin-bottom: 10px; }
.info .ovb .og { color: #16a34a; font-weight: bold; }
.info .ovb .ob { display: inline-block; margin: 0 6px; font-size: 12px; color: #374151;
  border: 1px solid rgba(107,114,128,0.6); border-radius: 4px; -webkit-border-radius: 4px;
  padding: 0 7px; }
.info .ovb .ot { color: #6b7280; }
.info .frow { font-size: 13px; color: #374151; margin-top: 5px; }
.info .frow .fk { font-weight: bold; color: #374151; }
.info .frow .fv { color: #4b5563; }
.info .frow .frate { color: #d97706; font-weight: bold; }
.info .chips { margin-top: 10px; }
.info .chip { display: inline-block; margin: 0 6px 6px 0; font-size: 11px;
  border-radius: 99px; -webkit-border-radius: 99px; padding: 2px 9px; }
.info .chip.c-blue { color: #2563eb; background: rgba(59,130,246,0.1); }
.info .chip.c-purple { color: #9333ea; background: rgba(147,51,234,0.1); }
.info .chip.c-green { color: #16a34a; background: rgba(22,163,74,0.1); }
.info .chip.c-orange { color: #ea580c; background: rgba(249,115,22,0.1); }
.info .chip.c-red { color: #dc2626; background: rgba(239,68,68,0.1); }

/* ===== 播放页 Hero 横幅（主站 PlayInfoPanel：大背景图 + 黑渐变 + 标签胶囊 + 大标题 + 简介 + 收藏） ===== */
.hero { position: relative; min-height: 190px; margin: 12px 0 4px; background: #111827;
  border-radius: 12px; -webkit-border-radius: 12px; overflow: hidden; }
.hero .herobg { position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: #1f2937; background-size: cover; background-position: center top; }
.hero .herograd { position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background-image: -webkit-linear-gradient(left, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.7) 55%, rgba(0,0,0,0.3) 100%),
    -webkit-linear-gradient(bottom, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 100%);
  background-image: linear-gradient(90deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.7) 55%, rgba(0,0,0,0.3) 100%),
    linear-gradient(0deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 100%); }
.hero .heroinner { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px; }
.hero .htags { margin-bottom: 6px; }
.hero .htag { display: inline-block; margin: 0 5px 4px 0; font-size: 11px; font-weight: bold;
  color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.2); border-radius: 99px; -webkit-border-radius: 99px;
  padding: 1px 8px; }
.hero .htag.gold { color: #fff; background: rgba(245,158,11,0.85); border-color: transparent; }
.hero .htitle { font-size: 21px; font-weight: bold; color: #ffffff; line-height: 1.25; }
.hero .hdesc { margin-top: 5px; font-size: 12px; color: rgba(255,255,255,0.8); line-height: 1.6; }
.hero .herofav { display: inline-block; margin-top: 9px; padding: 7px 16px; font-size: 13px;
  font-weight: bold; color: #ffffff; background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.35); border-radius: 99px; -webkit-border-radius: 99px; }
.hero .herofav:active { background: rgba(255,255,255,0.2); }
.hero .herofav.on { color: #fb7185; border-color: rgba(251,113,133,0.6); }

/* ===== 播放页选集/换源面板（主站 EpisodeSelector：选集绿 tab + 换源蓝 tab） ===== */
.ptabs { display: block; margin: 14px 0 0; background: rgba(17,24,39,0.05);
  border-radius: 10px; -webkit-border-radius: 10px; overflow: hidden; }
.ptabs .ptab { display: inline-block; width: 50%; text-align: center; padding: 12px 0;
  font-size: 15px; font-weight: bold; color: #374151; background: rgba(243,244,246,0.6); }
.ptabs .ptab.cur { color: #16a34a; background: #ffffff; }
.ptabs .ptab.src.cur { color: #2563eb; }
.srchint { font-size: 13px; font-weight: bold; color: #111827; margin: 12px 0 8px; }
.favbtn { display: inline-block; margin-top: 10px; padding: 8px 20px; font-size: 14px;
  font-weight: bold; color: #374151; background: #f3f4f6; border: 1px solid #e5e7eb;
  border-radius: 99px; -webkit-border-radius: 99px; }
.favbtn:active { background: #e5e7eb; }

/* ===== 我的页设置面板（主站 SettingsPanel：标签+说明+下拉+自定义输入+Thanks） ===== */
.setg { padding: 12px 0; border-bottom: 1px solid #f3f4f6; }
.setg:first-child { padding-top: 0; }
.setg:last-child { border-bottom: 0; padding-bottom: 0; }
.setl { font-size: 14px; font-weight: bold; color: #111827; }
.setd { font-size: 12px; color: #6b7280; margin-top: 2px; }
.setsel { width: 100%; margin-top: 8px; padding: 10px 12px; font-size: 15px; color: #1f2937;
  background: #f9fafb; border: 1px solid #d1d5db; border-radius: 10px;
  -webkit-border-radius: 10px; -webkit-appearance: none; appearance: none; }
.setin { width: 100%; margin-top: 8px; padding: 9px 12px; font-size: 14px; color: #1f2937;
  background: #ffffff; border: 1px solid #d1d5db; border-radius: 10px;
  -webkit-border-radius: 10px; -webkit-appearance: none; }
.thanks { font-size: 12px; color: #9ca3af; margin-top: 6px; }
.thanks a { color: #16a34a; }

/* ===== 源浏览器（主站 /source-browser：绿色标题卡 + 源胶囊按钮组） ===== */
.pagehero { position: relative; background: #ffffff; border: 1px solid #e5e7eb;
  border-radius: 14px; -webkit-border-radius: 14px; padding: 16px; margin-bottom: 14px; }
.pagehero .ph-t { font-size: 24px; font-weight: bold; color: #16a34a; }
.pagehero .ph-d { font-size: 13px; color: #6b7280; margin-top: 3px; }
.pagehero .ph-b { display: inline-block; margin-top: 8px; padding: 3px 10px; font-size: 12px;
  color: #15803d; background: rgba(22,163,74,0.1); border: 1px solid rgba(22,163,74,0.3);
  border-radius: 8px; -webkit-border-radius: 8px; }
.srcbtn { display: inline-block; margin: 3px 5px 3px 0; padding: 9px 14px; font-size: 14px;
  font-weight: bold; color: #374151; background: #ffffff;
  border: 2px solid #e5e7eb; border-radius: 12px; -webkit-border-radius: 12px; }
.srcbtn.cur { color: #ffffff; background: #16a34a; border-color: #16a34a; }

/* ===== 详情页 ===== */
.dposter { display: inline-block; vertical-align: top; width: 110px; height: 0;
  padding-bottom: 165px; background: #e5e7eb; background-size: cover;
  background-position: center; border-radius: 8px; -webkit-border-radius: 8px; }
.dmeta { display: inline-block; vertical-align: top; margin-left: 14px; max-width: 58%; }
.dmeta .pt { margin-bottom: 6px; }
.ver { display: block; padding: 12px 14px; margin-bottom: 10px; background: #ffffff;
  border: 1px solid #e5e7eb; border-radius: 10px; -webkit-border-radius: 10px; }
.ver:active { background: #f3f4f6; }
.ver .vname { display: block; font-size: 15px; color: #1f2937; font-weight: bold; }
.ver .s { display: block; font-size: 12px; color: #6b7280; margin-top: 2px; }

/* ===== 播放页 ===== */
.navrow { margin-top: 12px; text-align: center; }
.nav { display: inline-block; padding: 9px 22px; margin: 0 6px; font-size: 14px;
  color: #374151; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px;
  -webkit-border-radius: 10px; }
h2.pt { font-size: 19px; color: #1f2937; margin-bottom: 10px; }
video#player { display: block; width: 100%; background: #000;
  border-radius: 10px; -webkit-border-radius: 10px; min-height: 200px; }
.eps { margin-top: 14px; }
.eps .ep { display: inline-block; vertical-align: top; min-width: 44px; padding: 8px 0;
  margin: 0 8px 8px 0; text-align: center; font-size: 14px; color: #374151;
  background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;
  -webkit-border-radius: 8px; }
.eps .ep.cur { color: #fff; background: #16a34a; border-color: #16a34a; font-weight: bold; }
.hint { font-size: 12px; color: #6b7280; margin-top: 10px; }
.loading { color: #6b7280; font-size: 13px; padding: 6px 2px; }

/* ===== 轻量版直播页（频道行：白底圆角卡片 + 频道名 + 分组/线路标签） ===== */
.chlist { margin-top: 4px; }
.ch { display: block; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px;
  -webkit-border-radius: 10px; padding: 11px 13px; margin-bottom: 9px; }
.ch:active { background: #f3f4f6; }
.ch.cur { border-color: #16a34a; background: #f0fdf4; }
.ch .cn { display: inline-block; vertical-align: middle; max-width: 58%; font-size: 14px;
  font-weight: bold; color: #1f2937; white-space: nowrap; overflow: hidden;
  -o-text-overflow: ellipsis; text-overflow: ellipsis; }
.ch .cg { display: inline-block; vertical-align: middle; margin-left: 7px; font-size: 11px;
  color: #374151; background: rgba(17,24,39,0.06); border-radius: 4px;
  -webkit-border-radius: 4px; padding: 1px 6px; }
.ch .cq { float: right; margin: 1px 0 0 8px; font-size: 11px; color: #15803d;
  background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;
  -webkit-border-radius: 4px; padding: 1px 7px; }
.ch .cq.cq-n { color: #374151; background: rgba(17,24,39,0.06); border-color: transparent; }

/* ===== 用户中心（profile：登录横幅 + 播放记录行 + 退出登录） ===== */
.lrow { display: block; overflow: hidden; background: #ffffff;
  border: 1px solid #e5e7eb; border-radius: 10px; -webkit-border-radius: 10px;
  padding: 10px; margin-bottom: 10px; }
.lrow:active { background: #f9fafb; }
.lrow .lthumb { float: left; width: 42px; height: 58px; margin-right: 10px;
  background: #e5e7eb; background-size: cover; background-position: center;
  border-radius: 6px; -webkit-border-radius: 6px; }
.lrow .lt { display: block; font-size: 14px; color: #1f2937; font-weight: bold;
  white-space: nowrap; overflow: hidden; -o-text-overflow: ellipsis; text-overflow: ellipsis; }
.lrow .ls { display: block; font-size: 12px; color: #6b7280; margin-top: 3px; }
.lrow .lgo { display: inline-block; margin-top: 6px; font-size: 12px; font-weight: bold;
  color: #16a34a; background: #f0fdf4; border: 1px solid #bbf7d0;
  border-radius: 99px; -webkit-border-radius: 99px; padding: 3px 12px; }
.btn.gray { background: #6b7280; }
.btn.gray:active { background: #4b5563; }

/* ===== 源浏览器（source-browser：源卡片 + 分类胶囊 + 资源数标签） ===== */
.srcard { display: block; background: #ffffff; border: 1px solid #e5e7eb;
  border-radius: 10px; -webkit-border-radius: 10px; padding: 12px 14px;
  margin-bottom: 10px; }
.srcard:active { background: #f9fafb; }
.srcard .sname { display: inline-block; font-size: 15px; font-weight: bold; color: #1f2937; }
.srcard .scount { float: right; font-size: 12px; color: #16a34a; font-weight: bold;
  background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 99px;
  -webkit-border-radius: 99px; padding: 2px 10px; margin-top: 1px; }
.srcard .sdesc { display: block; font-size: 12px; color: #6b7280; margin-top: 3px;
  word-break: break-all; }
.srcard .stag { display: inline-block; margin-top: 6px; font-size: 11px; color: #374151;
  background: rgba(17,24,39,0.06); border-radius: 4px; -webkit-border-radius: 4px;
  padding: 1px 7px; }
`;

/** 公共 ES5 内联脚本：XHR 封装 + URL 参数解析（iOS 9.3 无 fetch/URLSearchParams） */
const LEGACY_JS = `
function lunaXhr(method, url, data, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      var body = null;
      try { body = JSON.parse(xhr.responseText); } catch (e) {}
      cb(xhr.status, body);
    }
  };
  xhr.send(data ? JSON.stringify(data) : null);
}
function lunaQs(name) {
  var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
  return m ? decodeURIComponent(m[1].replace(/\\+/g, ' ')) : '';
}
function lunaShow(id, text, cls) {
  var el = document.getElementById(id);
  if (!el) return;
  el.className = 'msg ' + (cls || '');
  el.innerHTML = text;
}
function lunaRateClass(rate) {
  var v = parseFloat(rate);
  if (!v || v <= 0) return '';
  if (v >= 8) return ' rate-g';
  if (v >= 6.5) return ' rate-y';
  return ' rate-n';
}
function lunaImg(u) {
  // 图片代理选择（与主站 processImageUrl 同逻辑：localStorage → RUNTIME_CONFIG → 默认）
  if (!u) return '';
  var s = String(u);
  var RC = (typeof window !== 'undefined' && window.RUNTIME_CONFIG) || {};
  // Bangumi 图片（lain.bgm.tv 国内直连困难）
  if (s.indexOf('lain.bgm.tv') >= 0 || s.indexOf('bgm.tv/pic') >= 0) {
    var bt = 'server';
    var bu = '';
    try {
      bt = localStorage.getItem('bangumiImageProxyType') || RC.BANGUMI_IMAGE_PROXY_TYPE || 'server';
      bu = localStorage.getItem('bangumiImageProxyUrl') || RC.BANGUMI_IMAGE_PROXY || '';
    } catch (e) {
      bt = RC.BANGUMI_IMAGE_PROXY_TYPE || 'server';
      bu = RC.BANGUMI_IMAGE_PROXY || '';
    }
    if (bt === 'cmliussss') return s.replace(/lain\\.bgm\\.tv/g, 'img.doubanio.cmliussss.net');
    if (bt === 'sakura') return s.replace(/lain\\.bgm\\.tv/g, 'lain.bangumi.lol').replace(/bgm\\.tv/g, 'bangumi.lol');
    if (bt === 'corsapi') return (bu || 'https://corsapi.smone.workers.dev').replace(/\\/$/, '') + '/?url=' + encodeURIComponent(s);
    if (bt === 'custom') return bu ? bu + encodeURIComponent(s) : '/api/proxy/logo?url=' + encodeURIComponent(s);
    if (bt === 'direct') return s;
    return '/api/proxy/logo?url=' + encodeURIComponent(s);
  }
  if (s.indexOf('doubanio.com') < 0) {
    return '/api/image-proxy?url=' + encodeURIComponent(s);
  }
  // 豆瓣图片代理（direct 按主站逻辑自动修复为 server；localStorage → RUNTIME_CONFIG → server）
  var t = 'server';
  var cu2 = '';
  try {
    t = localStorage.getItem('doubanImageProxyType') || RC.DOUBAN_IMAGE_PROXY_TYPE || 'server';
    cu2 = localStorage.getItem('doubanImageProxyUrl') || RC.DOUBAN_IMAGE_PROXY || '';
    if (t === 'direct') { t = 'server'; localStorage.setItem('doubanImageProxyType', 'server'); }
  } catch (e2) {
    t = RC.DOUBAN_IMAGE_PROXY_TYPE || 'server';
    cu2 = RC.DOUBAN_IMAGE_PROXY || '';
  }
  if (t === 'direct') t = 'server';
  // iOS 9.3 信任库不含 TrustAsia 自签根（cmliussss CDN 证书签发者），
  // 直连 https://img.doubanio.cmliussss.net 会 TLS 验证失败导致海报全挂，回退本站代理
  if (t === 'cmliussss-cdn-tencent' || t === 'cmliussss-cdn-ali' || t === 'cmliussss-unified') {
    return '/api/image-proxy?url=' + encodeURIComponent(s);
  }
  if (t === 'img3') return s.replace(/img\\d+\\.doubanio\\.com/g, 'img3.doubanio.com');
  if (t === 'baidu') return 'https://image.baidu.com/search/down?url=' + encodeURIComponent(s);
  if (t === 'custom') return cu2 ? cu2 + encodeURIComponent(s) : '/api/image-proxy?url=' + encodeURIComponent(s);
  return '/api/image-proxy?url=' + encodeURIComponent(s);
}
`;

/** 主站导航图标（内联 SVG，stroke 继承 currentColor，Safari 9 支持） */
export const LEGACY_NAV_ICONS: Record<string, string> = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m16.6 16.6 4.4 4.4"/></svg>',
  movie:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="m8 2 4 5 4-5"/></svg>',
  anime:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 3 6.5 6M15 3l2.5 3"/><circle cx="12" cy="13" r="7"/></svg>',
  show: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  server:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2"/></svg>',
  shortdrama:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5 20 4.8"/><path d="m2.7 8.4 1.3 10a2 2 0 0 0 2.2 1.8l13.8-2.4a2 2 0 0 0 1.6-2.3L20.3 6.6"/><path d="M4 7.5 2.7 8.4"/><path d="m6.8 9.8 2 .5M12.7 8.8l2 .5M18.5 7.8l2 .5"/></svg>',
};

/** 区块标题图标（主站 SectionTitle：热门电影红 Film / 热门剧集蓝 Tv / 热门综艺粉 Clapperboard） */
export const LEGACY_SEC_ICONS = {
  movie:
    '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="m8 2 4 5 4-5"/></svg>',
  show: '<svg viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
};

/**
 * 顶部导航。参数为当前选中项 key（home/search/movie/tv/anime/show/profile/source），
 * 无匹配则全部不选中。
 * href 风格对齐主站 Sidebar：搜索 /search、电影 /douban?type=movie 等。
 */
export function buildLegacyNav(cur: string): string {
  const items: Array<{
    key: string;
    icon: string;
    label: string;
    href: string;
  }> = [
    { key: 'home', icon: 'home', label: '首页', href: '/legacy' },
    { key: 'search', icon: 'search', label: '搜索', href: '/legacy/search' },
    { key: 'movie', icon: 'movie', label: '电影', href: '/legacy?type=movie' },
    { key: 'tv', icon: 'tv', label: '剧集', href: '/legacy?type=tv' },
    { key: 'anime', icon: 'anime', label: '动漫', href: '/legacy?type=anime' },
    { key: 'show', icon: 'show', label: '综艺', href: '/legacy?type=show' },
    {
      key: 'source',
      icon: 'server',
      label: '源',
      href: '/legacy/source-browser',
    },
    {
      key: 'shortdrama',
      icon: 'shortdrama',
      label: '短剧',
      href: '/legacy/shortdrama',
    },
    { key: 'live', icon: 'live', label: '直播', href: '/legacy/live' },
    { key: 'profile', icon: 'user', label: '我的', href: '/legacy/profile' },
  ];
  return (
    '<div class="mnav">' +
    items
      .map(
        (it) =>
          '<a class="' +
          (it.key === cur ? 'cur' : '') +
          '" href="' +
          it.href +
          '">' +
          LEGACY_NAV_ICONS[it.icon] +
          escapeHtml(it.label) +
          '</a>',
      )
      .join('') +
    '</div>'
  );
}

export interface LegacyPageOptions {
  title: string;
  siteName: string;
  body: string;
  script?: string;
  runtimeConfig?: Record<string, unknown>;
}

/**
 * 构建与主站 layout.tsx 同源的 window.RUNTIME_CONFIG（设置面板/lunaImg 跟随后台设置）。
 * 非本地存储模式从管理后台 SiteConfig 读取，否则回退环境变量默认值。
 */
export async function getLegacyRuntimeConfig(): Promise<
  Record<string, unknown>
> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  let doubanProxyType = process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct';
  let doubanProxy = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
  let doubanImageProxyType =
    process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'server';
  let doubanImageProxy = process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '';
  let fluidSearch = process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false';
  if (storageType !== 'localstorage') {
    try {
      const cfg = await getConfig();
      doubanProxyType = cfg.SiteConfig.DoubanProxyType || doubanProxyType;
      doubanProxy = cfg.SiteConfig.DoubanProxy || doubanProxy;
      doubanImageProxyType =
        cfg.SiteConfig.DoubanImageProxyType || doubanImageProxyType;
      doubanImageProxy = cfg.SiteConfig.DoubanImageProxy || doubanImageProxy;
      fluidSearch = cfg.SiteConfig.FluidSearch ?? fluidSearch;
    } catch {
      // 配置读取失败时回退环境变量默认值
    }
  }
  return {
    STORAGE_TYPE: storageType,
    DOUBAN_PROXY_TYPE: doubanProxyType,
    DOUBAN_PROXY: doubanProxy,
    DOUBAN_IMAGE_PROXY_TYPE: doubanImageProxyType,
    DOUBAN_IMAGE_PROXY: doubanImageProxy,
    BANGUMI_IMAGE_PROXY_TYPE:
      process.env.NEXT_PUBLIC_BANGUMI_IMAGE_PROXY_TYPE || 'server',
    BANGUMI_IMAGE_PROXY: process.env.NEXT_PUBLIC_BANGUMI_IMAGE_PROXY || '',
    FLUID_SEARCH: fluidSearch,
  };
}

/** renderLegacyPage 的便捷包装：自动注入跟随后台设置的 window.RUNTIME_CONFIG */
export async function renderLegacyPageWithConfig(
  opts: LegacyPageOptions,
): Promise<string> {
  const runtimeConfig = await getLegacyRuntimeConfig();
  return renderLegacyPage({ ...opts, runtimeConfig });
}

export function renderLegacyPage(opts: LegacyPageOptions): string {
  const site = escapeHtml(opts.siteName);
  // `<` 转义防止配置值中出现 </script> 提前闭合脚本标签
  const rcJson = JSON.stringify(opts.runtimeConfig || {}).replace(
    /</g,
    '\\u003c',
  );
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${escapeHtml(opts.title)} - ${site}</title>
<script>window.RUNTIME_CONFIG = ${rcJson};</script>
<style>${LEGACY_CSS}</style>
</head>
<body>
<div class="topbar"><a class="back" href="/legacy">&#8249; 首页</a><span class="brand">${site}</span></div>
<div class="wrap">${opts.body}</div>
<script>${LEGACY_JS}</script>
<script>${opts.script || ''}</script>
</body>
</html>`;
}
