# LunaTV 更新报告：iOS 15～17 以下版本兼容适配 + 热门短剧时间显示修复

> **日期**：2026-09-19
> **范围**：iOS 15～17 以下（Safari/WebKit < 16.4）兼容性适配（正则后行断言补丁 + 内联垫片 + 登录水合兜底 + CSS 渐变兼容层）+ 热门短剧 "Invalid Date" 修复
> **最终状态**：✅ build 成功 · ✅ Docker 部署通过 · ✅ iOS 15.4 真机实测通过
> **改动规模**：10 个文件（新增 2 个），源码约 +460 / -16 行（不含 lockfile）

---

## 目录

1. [iOS 15～17 以下兼容性适配（重点）](#一ios-1517-以下兼容性适配重点)
2. [热门短剧 "Invalid Date" 修复](#二热门短剧-invalid-date-修复)
3. [其他变更](#三其他变更)
4. [Docker 部署实测](#四docker-部署实测)
5. [升级与部署说明](#五升级与部署说明)
6. [验证结果](#六验证结果)

---

## 一、iOS 15～17 以下兼容性适配（重点）

### 1.1 问题现象（iOS 15.4 真机实测）

| 现象                       | 说明                                    |
| -------------------------- | --------------------------------------- |
| 登录按钮不可见 / 不可点    | 页面白底白字，按钮与背景融为一体        |
| 点击登录后页面刷新而非登录 | URL 变成 `login?`，触发原生表单提交     |
| 背景图缺失                 | 渐变背景整体失效                        |
| 部分页面整块内容不渲染     | 客户端 chunk 加载即崩溃，React 水合失败 |

而 iOS 17+、Android Chrome 一切正常——典型的**旧版 WebKit 兼容性**问题。

### 1.2 根因分析：三层拦截点

#### 层 1（致命）：正则后行断言 `(?<=...)`

`mdast-util-gfm-autolink-literal@2.0.1`（依赖链：`react-markdown` → `remark-gfm` → 此包，**进入客户端包**）的邮箱匹配正则使用了后行断言：

```js
[/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu, findEmail];
```

JavaScriptCore（Safari 内核）**直到 16.4 才支持后行断言**。iOS 15.4 上模块解析阶段直接抛出：

```
SyntaxError: Invalid regular expression: invalid group specifier name
```

该错误发生在模块顶层，**整个 chunk 直接崩溃 → React 永远无法水合 → 所有交互失效**。这是最核心的根因。

> 排查结论：扫描项目全部依赖（`node_modules/.pnpm`），共 112 个文件含后行断言，逐一分析后确认**唯一会进入客户端包的就是这个包**——其余全部属于 eslint/prettier/jest/next 服务端等开发工具或服务端代码，不会到达浏览器。

#### 层 2：缺失的现代运行时 API

| API                           | 最低 Safari 版本       | 使用位置                                                       |
| ----------------------------- | ---------------------- | -------------------------------------------------------------- |
| `AbortSignal.timeout()`       | **17.0**               | `src/lib/utils.ts`、`shortdrama.client.ts`、`play/page.tsx` 等 |
| `Promise.withResolvers()`     | **17.4**               | 客户端代码                                                     |
| `Array.prototype.at`          | 15.4                   | 客户端代码（iOS 15.4 以下缺失）                                |
| `Array.prototype.findLast`    | 15.4                   | 客户端代码                                                     |
| `Object.hasOwn`               | 15.4                   | 客户端代码                                                     |
| `crypto.randomUUID`           | 15.4（且需安全上下文） | 客户端代码                                                     |
| `String.prototype.replaceAll` | 13.1                   | 客户端代码                                                     |

#### 层 3：Tailwind v4 的 `oklab` 渐变插值

Tailwind v4 渐变默认使用 `in oklab` 插值语法，**Safari < 16.2 解析失败导致整条渐变规则被丢弃**——登录按钮、标题、logo 全部变成白底白字不可见。

#### 为何现有错误上报完全无感知

现有的 `ChunkErrorGuard` 等错误守卫组件基于 `useEffect` 上报——**水合失败时 useEffect 永远不会运行**，崩溃静默无感知。需要不依赖 React 的上报通道。

### 1.3 修复一：pnpm patch 移除后行断言（根因修复）

新增补丁文件 [patches/mdast-util-gfm-autolink-literal@2.0.1.patch](../patches/mdast-util-gfm-autolink-literal@2.0.1.patch)，通过 `pnpm patch-commit` 注册到 [pnpm-workspace.yaml](../pnpm-workspace.yaml)：

**修改前：**

```js
[/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu, findEmail];
```

**修改后：**

```js
// PATCH (LunaTV, Safari < 16.4 compat): removed lookbehind assertion.
[/(?:)([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu, findEmail];
```

**行为等价性**：后行断言在此处是**冗余的**——该包的 `findEmail` 处理器（`previous(match, true)`）已通过 charCode 强制执行完全相同的规则（位置为开头，或前一个字符是 `\s` / `\p{P}` / `\p{S}`），与同文件中本就无后行断言的 `findUrl` 依赖的机制一致。已用 8 个用例（邮箱在行首/空格后/标点后/字母中间等）验证补丁前后解析结果完全一致。

**验证**：`pnpm build` 后产物 `.next/static` 中已无 `(?<=^`；Docker 容器内 `/app/.next/static` 同样验证通过。

### 1.4 修复二：内联垫片脚本 polyfillScript.ts（新增）

新增 [src/lib/polyfillScript.ts](../src/lib/polyfillScript.ts)，在 [src/app/layout.tsx](../src/app/layout.tsx) 的 `<head>` 最前面注入：

```tsx
<head>
  {/* 旧版 Safari 兼容垫片 + 全局错误上报 + 登录水合失败兜底 */}
  <script dangerouslySetInnerHTML={{ __html: POLYFILL_SCRIPT }} />
  ...
```

**为什么必须是内联 `<script>` 而不是模块导入**：RootLayout 是服务端组件，`import '@/lib/polyfills'` 只在 Node 服务端执行，**根本不会进入浏览器客户端包**——垫片在旧浏览器上从未生效过。内联脚本随 SSR HTML 直出，在 HTML 解析阶段同步执行，**先于所有 `_next/static` chunk**，即使任何 JS 包加载失败也保证运行。

**垫片清单**（全部带特性检测，现代浏览器零开销）：

| 垫片                                         | 对应 Safari 缺失版本 |
| -------------------------------------------- | -------------------- |
| `AbortSignal.timeout`                        | < 17.0               |
| `Promise.withResolvers`                      | < 17.4               |
| `Array.prototype.at`                         | < 15.4               |
| `Array.prototype.findLast` / `findLastIndex` | < 15.4               |
| `Object.hasOwn`                              | < 15.4               |
| `crypto.randomUUID`                          | < 15.4               |
| `String.prototype.replaceAll`                | < 13.1               |

**全局错误上报**（不依赖 React 水合）：

- 监听 `window.error` 与 `unhandledrejection`，通过 `navigator.sendBeacon`（降级 `fetch`）发送到 `/api/client-log`（免认证端点）
- 服务端日志以 `[ClientLog]` 前缀可见，UA/页面 URL 一并上报
- 防刷保护：每次页面加载上限 20 条、相同错误去重

**实现约束**：内联脚本不被 SWC 转译，因此**全部使用 ES6 语法**（无 `?.`、`??`），字符串内不含反引号 / `${` / `</script>`。

### 1.5 修复三：登录页水合失败兜底

即使所有包正常，若未来某个 chunk 在旧设备上再崩溃，登录也不能被"卡死"。机制（[src/app/login/page.tsx](../src/app/login/page.tsx) + [polyfillScript.ts](../src/lib/polyfillScript.ts)）：

1. React 水合成功后设置 `window.__LUNA_REACT_HYDRATED = true`
2. 登录表单标记 `data-luna-login-form='1'`
3. 内联脚本在**捕获阶段**监听 `submit`：
   - 无论水合是否成功，一律 `preventDefault()`（杜绝原生提交导致的页面刷新）
   - 水合已完成 → 交还 React 的 `onSubmit` 处理
   - 水合失败 → **原生 JS 直接调用 `/api/login` 完成登录**，包含与 React 一致的空值校验（"请输入用户名" / "请输入访问密码"）、401 提示"密码错误"、错误横幅 UI

**结果：旧设备上任何情况下都能完成登录。**

### 1.6 修复四：browserslist 降级目标

[package.json](../package.json) 新增：

```json
"browserslist": [
  "chrome >= 80",
  "edge >= 88",
  "firefox >= 80",
  "safari >= 13",
  "ios_saf >= 13"
]
```

确保 SWC/PostCSS 按目标降级语法与 CSS，而不是按默认目标（会保留 iOS 15 无法执行的语法）。

### 1.7 修复五：CSS 渐变兼容层

[src/app/globals.css](../src/app/globals.css) 末尾新增 `@supports not` 兼容层：在不支持 `oklab` 渐变的浏览器（Safari < 16.2）中，将 `--tw-gradient-position` 插值空间降级为标准 sRGB，覆盖全部 8 个渐变方向（`to-t/tr/r/br/b/bl/l/tl` 及 `bg-linear-*` 别名）。现代浏览器不受影响。

---

## 二、热门短剧 "Invalid Date" 修复

### 2.1 现象

iOS 15.4 上首页"热门短剧"所有卡片的时间标签显示 **"Invalid Date"**（Chrome/Android 正常）。

### 2.2 根因

Apple CMS 采集源的 `vod_time` 是**空格分隔**的日期串：`"2026-09-18 23:16:00"`。

- Chrome（V8）：宽容解析，能出结果
- Safari（JavaScriptCore）：`new Date("2026-09-18 23:16:00")` 返回 **Invalid Date**，且**不抛异常**——所以 `try/catch` 根本拦不住，原代码的 catch 分支形同虚设

```ts
const date = new Date(updateTime); // Safari → Invalid Date
return date.toLocaleDateString('zh-CN'); // → "Invalid Date"
```

### 2.3 修复（双层）

**层 1 — 服务端源头规范化**（[src/lib/shortdrama.server.ts](../src/lib/shortdrama.server.ts)）：

**修改前：**

```ts
update_time: item.vod_time || new Date().toISOString(),
```

**修改后：**

```ts
update_time: item.vod_time
  ? item.vod_time.replace(' ', 'T') // 兼容 Safari：空格分隔的日期串 iOS 15 无法解析
  : new Date().toISOString(),
```

`"2026-09-18T23:16:00"` 是 ES 规范支持的 ISO 格式，所有浏览器一致。服务端排序 `new Date(b.update_time) - new Date(a.update_time)` 同样受益。

**层 2 — 客户端显示兜底**（[src/components/ShortDramaCard.tsx](../src/components/ShortDramaCard.tsx)）：兼容已缓存/已下发旧格式数据的场景，并补上真正的无效值检查：

```ts
const date = new Date(updateTime.replace(' ', 'T'));
if (isNaN(date.getTime())) return updateTime; // 真无效时显示原始字符串
return date.toLocaleDateString('zh-CN');
```

---

## 三、其他变更

| 变更                                                | 说明                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| 新增 devDependency `jest-environment-jsdom@^30.5.2` | Jest 30 起需单独安装 jsdom 环境，修复 `pnpm test` 的环境缺失报错 |

---

## 四、Docker 部署实测

`docker compose up -d --build` 重建后完整验证：

| 测试项                                                         | 结果 |
| -------------------------------------------------------------- | ---- |
| 容器启动（moontv-core + moontv-kvrocks）                       | ✅   |
| 登录页 HTTP 200                                                | ✅   |
| 容器内 `/app/.next/static` 无后行断言 `(?<=^`                  | ✅   |
| 容器内客户端 chunk 含补丁版 mdast 代码                         | ✅   |
| **iOS 15.4 真机**：登录页加载、背景/按钮可见                   | ✅   |
| **iOS 15.4 真机**：登录成功进入首页                            | ✅   |
| **iOS 15.4 真机**：热门短剧时间正常显示（不再是 Invalid Date） | ✅   |

---

## 五、升级与部署说明

- **无破坏性变更**：本次不涉及认证/Cookie/数据结构，无需重新登录
- **补丁自动生效**：Dockerfile 已 COPY `pnpm-workspace.yaml` 与 `patches/` 目录，镜像构建时 `pnpm install` 自动应用补丁；本地开发重新 `pnpm install` 即可
- **给旧设备用户**：建议清一次 Safari 缓存（设置 → Safari → 清除历史记录与网站数据），避免旧版 HTML/JS 缓存干扰
- **后续新增依赖注意**：引入新客户端依赖时，留意是否使用后行断言（`(?<=` / `(?<!`）或 Safari 16/17 以下缺失的 API；构建后可用 `grep -rlF '(?<=^' .next/static` 快速自检

---

## 六、验证结果

```
✅ build            pnpm build 成功（客户端产物无后行断言）
✅ 补丁等价性        8 用例对比补丁前后 mdast 解析结果，完全一致
✅ 依赖排查          全部依赖 112 个含后行断言文件逐一分析，客户端包仅 1 处已补丁
✅ API 兼容扫描      src 中无其他 iOS 15.4 缺失的 API（requestVideoFrameCallback 15.4 已原生支持）
✅ Docker            compose build + up 成功，容器内产物验证通过
✅ iOS 15.4 真机     登录 / 页面加载 / 短剧时间显示 全部正常
```
