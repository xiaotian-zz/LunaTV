# LunaTV 更新报告：安全加固 + 登录交互修复 + 性能优化 + 请求风暴修复

> **日期**：2026-09-18
> **范围**：登录链路安全加固（5 项漏洞修复）+ 登录按钮交互修复 + 访问速度优化（3 项）+ 收藏/提醒请求风暴修复
> **最终状态**：✅ typecheck 零错误 · ✅ lint 0 errors · ✅ build 成功 · ✅ Docker 部署实测通过
> **改动规模**：14 个文件，+655 / -540 行

---

## 目录

1. [安全加固：登录链路 5 项漏洞修复](#一安全加固登录链路-5-项漏洞修复)
2. [登录按钮交互修复](#二登录按钮交互修复)
3. [性能优化（3 项）](#三性能优化3-项)
4. [收藏/提醒请求风暴修复（重点）](#四收藏提醒请求风暴修复重点)
5. [Docker 部署实测](#五docker-部署实测)
6. [破坏性变更与升级说明](#六破坏性变更与升级说明)
7. [验证结果](#七验证结果)

---

## 一、安全加固：登录链路 5 项漏洞修复

对登录页面及整条认证链路（`/api/login`、`/api/register`、`proxy.ts` 中间件、session cookie、Telegram/OIDC 登录）做了安全审查，发现并修复 5 项漏洞。

### 1.1 漏洞总览

| #   | 漏洞                     | 攻击场景                                                   | 修复方案                                                                                                        |
| --- | ------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | cookie 明文存储密码      | XSS 或本机嗅探可直接从 cookie 读到用户密码                 | 改存 HMAC-SHA256 哈希，服务端哈希比对；`secure` 标志按请求协议动态设置                                          |
| 2   | `X-Forwarded-For` 可伪造 | 攻击者伪造 XFF 头冒充内网 IP，直接以 owner 身份进入        | 默认不信任 XFF；仅当显式配置 `TRUST_PROXY=true`（部署在可信反代后）才启用；信任网络免登录 cookie 附带 HMAC 签名 |
| 3   | 会话签名无限重放         | 窃取一次签名可永久重放，永不过期                           | 签名覆盖 `${username}:${timestamp}`，服务端校验 7 天新鲜度（`SIGNATURE_FRESHNESS_MS`）                          |
| 4   | 内部请求标识头可伪造     | 伪造 `x-internal-request` 等客户端头获取完整 server-config | 移除该分支，仅信任服务端网络层判定                                                                              |
| 5   | 敏感凭据写入日志         | 服务器日志泄露密码、认证数据                               | 移除 Telegram 登录等处全部凭据类日志                                                                            |

### 1.2 认证逻辑收敛到 auth.ts

签名生成/校验逻辑原本散落在 login、register、oidc callback、complete-register、telegram verify 等多处（各有一份实现），本次全部收敛到 [src/lib/auth.ts](../src/lib/auth.ts)：

- `generateSignature()`：HMAC-SHA256（Web Crypto `crypto.subtle`），输出十六进制签名
- `generateAuthCookie()`：签名覆盖 `${username}:${timestamp}`，cookie 内 `password` 字段存 HMAC 哈希而非明文
- `SIGNATURE_FRESHNESS_MS`：7 天新鲜度常量，服务端逐请求校验
- `getLocalPasswordHash()` / `verifyLocalPasswordHash()`：localstorage 模式密码基准值改为 `HMAC(PASSWORD, PASSWORD)`

### 1.3 proxy.ts 中间件重构

[src/proxy.ts](../src/proxy.ts) 大幅重构（+270/-270 行级别）：

- `getTrustedClientIP()`：默认直连 socket IP，XFF 解析仅在 `TRUST_PROXY=true` 时启用（[proxy.ts L128-133](../src/proxy.ts#L128-L133)）
- 信任网络配置增加模块级缓存（`trustedNetworkCache` + TTL），避免每请求查库
- 认证 cookie 校验统一走 `auth.ts`，包含时间戳新鲜度验证

### 1.4 受影响文件

| 文件                                                                                                    | 变更                                                |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [src/lib/auth.ts](../src/lib/auth.ts)                                                                   | 新增统一签名/校验/哈希函数（+89 行）                |
| [src/proxy.ts](../src/proxy.ts)                                                                         | 中间件重构：IP 判定、签名校验、配置缓存             |
| [src/app/api/login/route.ts](../src/app/api/login/route.ts)                                             | 去重逻辑，改走 auth.ts，cookie 哈希化（-71 行级别） |
| [src/app/api/register/route.ts](../src/app/api/register/route.ts)                                       | 同上                                                |
| [src/app/api/auth/oidc/callback/route.ts](../src/app/api/auth/oidc/callback/route.ts)                   | OIDC 回调签名逻辑收敛                               |
| [src/app/api/auth/oidc/complete-register/route.ts](../src/app/api/auth/oidc/complete-register/route.ts) | 同上                                                |
| [src/app/api/telegram/verify/route.ts](../src/app/api/telegram/verify/route.ts)                         | 移除凭据日志 + 逻辑收敛（-89 行级别）               |
| [src/lib/admin-auth.ts](../src/lib/admin-auth.ts)                                                       | 管理端认证同步适配                                  |

---

## 二、登录按钮交互修复

用户反馈两个问题：

1. **按钮在背景图片加载完成前不可用**
2. **iOS 17 及更早版本的自带浏览器中按钮不能用**

**根因**：按钮存在 `disabled` 解锁逻辑（输入有效后才启用），且相关动画/CSS 在旧版 WebKit 上行为异常。

**修复**（[src/app/login/page.tsx](../src/app/login/page.tsx)）：

- 彻底移除 `disabled` 逻辑，按钮**任何时刻都可点击**
- 点击时校验：未填用户名 → 提示 **"请输入用户名"**；只填用户名未填密码 → 提示 **"请输入访问密码"**
- 不依赖输入状态驱动 UI，规避旧版 WebKit 的交互异常

**Docker 实测**：空表单点击出现提示、只填用户名出现密码提示、`admin/admin1234` 正常登录、React hydration 正常（无原生表单提交刷新页面的问题）。

---

## 三、性能优化（3 项）

### 3.1 豆瓣数据请求：5 分钟内存缓存 + 并发去重

[src/lib/douban.ts](../src/lib/douban.ts) 的 `fetchDoubanData()` 增加两层防线：

```ts
const dataCache = new Map<string, { data: unknown; expires: number }>();
const DATA_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const DATA_CACHE_MAX = 300; // 容量上限，超出先清过期再淘汰最旧
const inflightRequests = new Map<string, Promise<unknown>>(); // inflight 去重
```

- **缓存命中**：直接返回，跳过 500ms 串行限流、200-800ms 随机延时与外网请求
- **并发去重**：冷启动并发请求同一 URL 时只发一次外网请求（首页同时请求多个榜单时收益显著）

### 3.2 server-config 接口：HTTP 缓存头 + 去噪

[src/app/api/server-config/route.ts](../src/app/api/server-config/route.ts)：

- 新增 `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- 删除 4 处调试 `console.log`

### 3.3 必应壁纸：内存缓存摊平并发

[src/app/api/bing-wallpaper/route.ts](../src/app/api/bing-wallpaper/route.ts)：

- 新增 60 秒内存缓存（`wallpaperMemoryCache`），登录页高并发加载时只发一次外网请求（壁纸本身一天一换，无实时性要求）
- Unsplash 备用源补 `next: { revalidate: 600 }`

---

## 四、收藏/提醒请求风暴修复（重点）

### 4.1 现象

Docker 日志被 `[收藏性能]` / `[提醒性能]` / `✅ [性能良好]` 刷屏，用户询问"一直重复会不会影响速度"。

### 4.2 结论

- **不会持续影响速度**：实测这些请求全部集中在首页加载的第 0 秒（5 秒内 70 次 `/api/favorites` + 61 次 `/api/reminders`），之后稳态为 0——不是轮询
- **但首屏那一瞬间 131 个请求确实拖慢首屏速度**，且服务端日志噪音极大

### 4.3 根因

[src/hooks/useFavoritesQuery.ts](../src/hooks/useFavoritesQuery.ts) 的 `useIsFavoritedQuery`（及同构的 `useIsRemindedQuery`）为每个视频卡片分配**独立 queryKey**：

```ts
// 修复前：每张卡片独立缓存条目、独立全量请求
queryKey: ['favorites', 'check', source, id],
queryFn: async () => {
  const response = await fetch('/api/favorites');  // 全量接口！
  ...
}
```

首页 ~70 张 `VideoCard` + `ShortDramaCard` 各自调用 → **每张卡片都全量请求一次** `/api/favorites`。

### 4.4 修复

改用 TanStack Query 的 `select` 派生模式（[useFavoritesQuery.ts L138-148](../src/hooks/useFavoritesQuery.ts#L138-L148)）：

```ts
export function useIsFavoritedQuery(
  source: string,
  id: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    ...favoritesQueryOptions, // 复用全局共享的 ['favorites'] 缓存
    enabled: options?.enabled,
    select: (data: Record<string, Favorite>) => !!data[`${source}+${id}`],
  });
}
```

- 整站只发 **1 次** `/api/favorites`，所有卡片从共享缓存派生各自的布尔状态
- `select` 结果经 TanStack 结构共享，不会引发多余重渲染
- **乐观更新完全兼容**：收藏/取消收藏的 mutation 本就写入共享 `['favorites']` 缓存（`setQueryData`），派生状态即时联动；`invalidateQueries({ queryKey: ['favorites'] })` 也只触发一次重取

### 4.5 实测结果

| 指标                             | 修复前  | 修复后                                            |
| -------------------------------- | ------- | ------------------------------------------------- |
| `/api/favorites`（每次首页加载） | 70 次   | **2 次**（共享列表查询 + 数组查询，均为必要开销） |
| `/api/reminders`（每次首页加载） | 61 次   | **1 次**                                          |
| 服务端日志（每次首页加载）       | ~131 条 | **3 条**                                          |

剩余的 2 次收藏请求来自 `['favorites']`（状态检查）与 `['favorites', 'array']`（收藏列表页）两个不同用途的共享查询，符合设计。

---

## 五、Docker 部署实测

`docker compose up -d --build` 重建后完整验证：

| 测试项                                   | 结果              |
| ---------------------------------------- | ----------------- |
| 容器启动（moontv-core + moontv-kvrocks） | ✅                |
| 空表单点击登录 → "请输入用户名"          | ✅                |
| 只填用户名 → "请输入访问密码"            | ✅                |
| admin/admin1234 登录成功进入首页         | ✅                |
| React hydration 正常（无原生提交刷新）   | ✅                |
| 首页 `/api/favorites` 请求次数           | ✅ 70 → 2         |
| 首页 `/api/reminders` 请求次数           | ✅ 61 → 1         |
| 服务端收藏/提醒日志量                    | ✅ 与前端请求一致 |

---

## 六、破坏性变更与升级说明

| 变更                                    | 影响                                             | 处理方式                                  |
| --------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| cookie 密码字段明文 → HMAC 哈希         | 旧 cookie 校验失败                               | **所有用户需重新登录**（预期行为）        |
| 签名格式覆盖 `${username}:${timestamp}` | 旧签名失效                                       | 同上，重新登录即签发新格式                |
| XFF 信任默认关闭                        | 部署在反向代理后的信任网络（内网免登录）功能失效 | 需显式设置环境变量 **`TRUST_PROXY=true`** |
| localstorage 模式密码基准改为 HMAC 哈希 | 单机模式首次升级后需重新验证密码                 | 按提示重新登录即可                        |

---

## 七、验证结果

```
✅ typecheck        tsc --noEmit 零错误
✅ lint             eslint src → 0 errors（2153 条存量 no-console 警告，非本次引入）
✅ build            next build 成功（140 路由）
✅ Docker           compose build + up 成功，功能/性能实测全部通过
```
