/**
 * 旧版 Safari/iOS WebKit 兼容脚本（内联注入版）
 *
 * 背景：iOS 17 以下的 Safari 缺少较新的运行时 API（如 AbortSignal.timeout
 * 仅 Safari 17+ 支持），导致客户端代码抛错、React 水合失败，表现为：
 * 1. 点击登录触发原生表单提交（页面刷新）
 * 2. 现有的错误上报组件（ChunkErrorGuard 等）基于 useEffect，水合失败时
 *    不会运行，导致崩溃完全无感知
 *
 * 为什么必须用内联 <script> 而不是模块导入：
 * RootLayout 是服务端组件，其模块导入（import '@/lib/polyfills'）只在 Node
 * 服务端执行，不会进入浏览器客户端包——垫片在旧浏览器上从未生效。
 * 内联脚本随 SSR HTML 直出，在 HTML 解析阶段同步执行，先于所有
 * _next/static chunk 脚本，即使任何 JS 包加载或执行失败也能保证运行。
 *
 * 注意：
 * 1. 内联脚本不会被 SWC 转译，因此全部使用 ES6 语法（无 ?. 和 ??），
 *    与 package.json 的 browserslist（safari >= 13）保持一致
 * 2. 字符串内不得包含反引号、${ 或 </script>（会破坏模板字符串或 HTML）
 */

export const POLYFILL_SCRIPT = `(function () {
  'use strict';
  var w = window;

  // ======== 运行时 API 垫片（均有特性检测，现代浏览器零开销） ========

  // AbortSignal.timeout — Safari 17+
  // 被 src/lib/utils.ts、shortdrama.client.ts、play/page.tsx 等客户端代码使用
  if (typeof w.AbortSignal !== 'undefined' && typeof w.AbortSignal.timeout !== 'function') {
    w.AbortSignal.timeout = function (ms) {
      var controller = new AbortController();
      setTimeout(function () {
        try {
          controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        } catch (_) {
          controller.abort();
        }
      }, ms);
      return controller.signal;
    };
  }

  // Promise.withResolvers — Safari 17.4+
  if (typeof w.Promise !== 'undefined' && typeof w.Promise.withResolvers !== 'function') {
    w.Promise.withResolvers = function () {
      var resolve, reject;
      var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }

  // Array.prototype.at — Safari 15.4+
  if (!Array.prototype.at) {
    Array.prototype.at = function (index) {
      var len = this.length >>> 0;
      var i = Math.trunc(index) || 0;
      if (i < 0) i += len;
      if (i < 0 || i >= len) return undefined;
      return this[i];
    };
  }

  // Array.prototype.findLast / findLastIndex — Safari 15.4+
  if (!Array.prototype.findLast) {
    Array.prototype.findLast = function (fn, thisArg) {
      for (var i = this.length - 1; i >= 0; i--) {
        if (fn.call(thisArg, this[i], i, this)) return this[i];
      }
      return undefined;
    };
  }
  if (!Array.prototype.findLastIndex) {
    Array.prototype.findLastIndex = function (fn, thisArg) {
      for (var i = this.length - 1; i >= 0; i--) {
        if (fn.call(thisArg, this[i], i, this)) return i;
      }
      return -1;
    };
  }

  // Object.hasOwn — Safari 15.4+
  if (typeof Object.hasOwn !== 'function') {
    Object.hasOwn = function (obj, prop) {
      return Object.prototype.hasOwnProperty.call(obj, prop);
    };
  }

  // String.prototype.replaceAll — Safari 13.1+
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (search, replacement) {
      if (search instanceof RegExp) {
        if (!search.global) {
          throw new TypeError('String.prototype.replaceAll called with a non-global RegExp argument');
        }
        return this.replace(search, replacement);
      }
      return this.split(search).join(replacement);
    };
  }

  // crypto.randomUUID — Safari 15.4+（且需要 secure context）
  if (
    typeof w.crypto !== 'undefined' &&
    typeof w.crypto.randomUUID !== 'function' &&
    typeof w.crypto.getRandomValues === 'function'
  ) {
    w.crypto.randomUUID = function () {
      var bytes = new Uint8Array(16);
      w.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
      var parts = [];
      for (var i = 0; i < bytes.length; i++) {
        parts.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16));
      }
      var s = parts.join('');
      return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
    };
  }

  // ======== 全局错误上报：诊断旧浏览器水合失败等客户端崩溃 ========
  // 错误发送到 /api/client-log（免认证端点），服务端日志中以 [ClientLog] 可见
  try {
    var REPORT_LIMIT = 20;
    var reportedKeys = {};
    var reportCount = 0;
    var sending = false;

    var sendReport = function (level, message, extra) {
      if (sending || reportCount >= REPORT_LIMIT) return;
      var msg = String(message);
      var key = level + '|' + msg.slice(0, 200);
      if (reportedKeys[key]) return; // 相同错误每次页面加载只上报一次
      reportedKeys[key] = true;
      reportCount++;
      sending = true;
      var payload;
      try {
        payload = JSON.stringify({
          level: level,
          message: msg.slice(0, 500),
          data: {
            href: w.location ? w.location.href : '',
            userAgent: w.navigator ? w.navigator.userAgent : '',
            extra: extra ? String(extra).slice(0, 2000) : '',
          },
          timestamp: Date.now(),
        });
      } catch (_) {
        sending = false;
        return;
      }
      try {
        if (w.navigator && typeof w.navigator.sendBeacon === 'function') {
          w.navigator.sendBeacon('/api/client-log', new Blob([payload], { type: 'application/json' }));
          sending = false;
        } else {
          fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          })
            .catch(function () {})
            .then(function () { sending = false; });
        }
      } catch (_) {
        sending = false;
      }
    };

    w.addEventListener('error', function (event) {
      var err = event && event.error;
      var message = (event && event.message) || (err && err.message) || 'unknown script error';
      var extra = (err && err.stack) || (event && event.filename) || '';
      sendReport('error', message, extra);
    });

    w.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      var message =
        typeof reason === 'string'
          ? reason
          : (reason && reason.message) || String(reason || 'unhandled rejection');
      var extra = (reason && reason.stack) || '';
      sendReport('error', message, extra);
    });
  } catch (_) {}

  // ======== 登录页水合失败兜底 ========
  // React 水合失败时 onSubmit 不会挂载，点击登录会触发原生表单提交（页面刷新）。
  // 此处理器在捕获阶段拦截登录表单提交（data-luna-login-form 标记）：
  // 水合成功时交给 React 处理；水合失败时用原生 fetch 直接完成登录，
  // 保证旧设备一定能登录。
  try {
    var fallbackInFlight = false;

    var showFallbackError = function (form, msg) {
      var old = form.querySelector('[data-luna-fallback-error]');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var div = document.createElement('div');
      div.setAttribute('data-luna-fallback-error', '1');
      div.setAttribute('role', 'alert');
      div.style.cssText =
        'display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-size:14px;line-height:1.4;';
      div.textContent = msg;
      var btn = form.querySelector('button[type="submit"]');
      if (btn && btn.parentNode) form.insertBefore(div, btn);
      else form.appendChild(div);
    };

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.nodeType !== 1) return;
      if (form.getAttribute('data-luna-login-form') !== '1') return;

      // 无论水合是否成功，都阻止原生表单提交（页面刷新）
      e.preventDefault();

      // 水合已完成 → React 的 onSubmit 处理器接管
      if (w.__LUNA_REACT_HYDRATED) return;

      if (fallbackInFlight) return;
      fallbackInFlight = true;

      var pwdInput = form.querySelector('#password');
      var userInput = form.querySelector('#username');
      var password = pwdInput ? pwdInput.value : '';
      var username = userInput ? userInput.value.trim() : '';

      var btn = form.querySelector('button[type="submit"]');

      var finishError = function (msg) {
        fallbackInFlight = false;
        if (btn) btn.disabled = false;
        showFallbackError(form, msg);
      };

      // 空值校验：与 React handleSubmit 逻辑一致
      if (userInput && !username) { finishError('请输入用户名'); return; }
      if (!password) { finishError('请输入访问密码'); return; }

      if (btn) btn.disabled = true;

      // 计算 redirect（从 URL query 解析）
      var redirect = '/';
      try {
        var m = w.location.search.match(/[?&]redirect=([^&]+)/);
        if (m) redirect = decodeURIComponent(m[1]);
      } catch (_) {}

      var payload = { password: password };
      if (userInput) payload.username = username;

      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (res.ok) {
            w.location.href = redirect;
            return;
          }
          if (res.status === 401) {
            finishError('密码错误');
          } else {
            res.json()
              .catch(function () { return {}; })
              .then(function (data) {
                finishError((data && data.error) || '服务器错误');
              });
          }
        })
        .catch(function () {
          finishError('网络错误，请稍后重试');
        });
    }, true);
  } catch (_) {}
})();`;
