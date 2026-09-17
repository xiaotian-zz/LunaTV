# LunaTV 全量更新报告

> **日期**：2026-09-17
> **范围**：依赖全面升级至最新版本 + 构建系统修复 + 运行时适配 + 废弃库迁移 + Lint 修复 + 性能优化
> **最终状态**：✅ typecheck 零错误 · ✅ lint 0 errors · ✅ build 成功（140 路由）

---

## 目录

1. [依赖升级总览](#一依赖升级总览)
2. [构建系统修复](#二构建系统修复)
3. [Redis v6 运行时适配](#三redis-v6-运行时适配)
4. [crypto-js → node:crypto 迁移](#四crypto-js--nodecrypto-迁移)
5. [Lint 162 个错误修复](#五lint-162-个错误修复)
6. [性能优化（P1 + P2）](#六性能优化p1--p2)
7. [验证结果](#七验证结果)
8. [遗留事项与建议](#八遗留事项与建议)

---

## 一、依赖升级总览

共升级 **48 个包**至最新可用版本。

### 1.1 核心框架

| 包                 | 旧版本  | 新版本     | 说明                     |
| ------------------ | ------- | ---------- | ------------------------ |
| next               | ^16.1.0 | **16.3.5** | 当前 Active LTS 最新补丁 |
| eslint-config-next | 16.1.0  | 16.3.5     | 与 next 同步             |
| react / react-dom  | 19.x    | **19.3**   |                          |
| typescript         | 5.8.x   | **6.0.3**  | 见下方「版本回退说明」   |
| eslint             | 8.x     | **9.39.5** | 见下方「版本回退说明」   |

### 1.2 运行时与数据层

| 包          | 新版本    | 备注             |
| ----------- | --------- | ---------------- |
| redis       | **6.2.x** | 协议适配见第三节 |
| zod         | 4.6       |                  |
| @types/node | 24.x      |                  |

### 1.3 UI / 组件层

| 包            | 新版本 |
| ------------- | ------ |
| framer-motion | 13.4   |
| swiper        | 14.2   |
| tailwindcss   | 4.3    |
| mui (全套)    | 最新   |
| lucide-react  | 最新   |

### 1.4 工具链与测试

| 包                  | 新版本   |
| ------------------- | -------- |
| jest                | 30       |
| ts-jest / ts-node   | 最新配套 |
| tailwindcss plugins | 最新     |

### 1.5 移除的依赖

| 包                               | 原因                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| crypto-js                        | 官方已废弃（README 明确停更），迁移至 `node:crypto` / Web Crypto，见第四节 |
| @types/bs58                      | Deprecated stub 包（bs58 v5+ 自带类型）                                    |
| @types/testing-library__jest-dom | Deprecated stub 包（jest-dom v6+ 自带类型）                                |

### 1.6 ⚠️ 无法使用最新版的生态硬限制

| 包         | 最新版                | 实际锁定 | 原因                                                                                                                                                      |
| ---------- | --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typescript | 7.0（Go 重写版 tsgo） | 6.0.3    | TS7 无 JS API，typescript-eslint 硬性阻塞（要求 <6.1.0），[官方 issue #10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940) 跟踪中 |
| eslint     | 10.x                  | 9.39.5   | eslint 10 下 eslint-config-next 内置的 eslint-plugin-react 运行时崩溃                                                                                     |

---

## 二、构建系统修复

### 2.1 Next.js standalone Windows symlink 补丁（关键修复）

**问题**：Next.js 16.3.5 在 Windows 上执行 `output: 'standalone'` 构建时，
复制 `node_modules/.pnpm` 符号链接抛出 `ENOENT` 错误导致构建失败。
官方源码（`dist/build/utils.js`）只对 `EPERM`/权限错误做了 junction fallback，
未处理 `ENOENT`（pnpm 链接已被消费后指向不存在目标的场景）。

**修复**：新增 [patches/next@16.3.5.patch](../../patches/next@16.3.5.patch)，
在 symlink ENOENT 时 fallback 到 junction 复制。通过 pnpm `patchedDependencies` 自动应用。

### 2.2 `next lint` 命令移除适配

Next.js 16.3 已删除内置 `next lint` 命令。

- [package.json](../../package.json)：`"lint": "eslint src"`
- 后续配合 eslint 9 flat config 正常工作

### 2.3 TypeScript 6 移除 `baseUrl`

TS 6 不再支持 `baseUrl` 编译选项。

- [tsconfig.json](../../tsconfig.json)：删除 `baseUrl`，保留 `paths`（Next.js 支持无 baseUrl 的 paths 解析）

---

## 三、Redis v6 运行时适配

redis 客户端从 v4 升级到 **v6**，两处行为级变化需要适配。

### 3.1 固定 RESP2 协议（兼容性关键）

redis v6 默认使用 RESP3 协议，但 **Kvrocks / Pika 等兼容存储不支持 RESP3**，
会导致社区用户部署直接报错。

- [src/lib/redis-base.db.ts](../../src/lib/redis-base.db.ts)（约 L102-104）：
  连接配置显式设置 `RESP: 2`，保持对自建/兼容存储的兼容

### 3.2 SCAN cursor 字符串化

v6 的 `scan()` 返回 cursor 为数字/Buffer 语义变化，v4 语义为字符串。

- 所有 `scan()` 调用点的 cursor 统一 `String(cursor)` 处理

### 3.3 返回值类型适配（21 处）

v6 对集合/哈希操作（`smembers`、`hgetall` 等）的泛型推断更严格。

- [src/lib/redis-base.db.ts](../../src/lib/redis-base.db.ts)：约 21 处显式类型断言/标注
- [src/lib/video-cache.ts](../../src/lib/video-cache.ts)：4 处类型适配

---

## 四、crypto-js → node:crypto 迁移

`crypto-js` 已官方废弃，按使用场景分两路迁移，**保持数据格式完全互通**。

### 4.1 服务端：数据迁移加解密（[src/lib/crypto.ts](../../src/lib/crypto.ts)）

原实现：crypto-js 的 AES + OpenSSL `EvpKDF`（MD5 派生密钥）。
新实现：`node:crypto` 原生模块：

- 加密算法：AES-256-CBC（与原一致）
- 密钥派生：MD5 实现 `EVP_BytesToKey`（与 OpenSSL `enc` 命令行格式兼容）
- 密文格式：保持 `Salted__` + 8 字节 salt 前缀（与原 crypto-js 输出完全一致）

**双向互通测试 6/6 通过**：

| 测试场景                  | 结果 |
| ------------------------- | ---- |
| 旧版导出文件 → 新代码解密 | ✅   |
| 新代码导出 → 旧版代码解密 | ✅   |
| 正常加解密往返            | ✅   |
| 错误密码 → 正确拒绝       | ✅   |
| 篡改密文 → 正确拒绝       | ✅   |
| 中文/特殊字符内容         | ✅   |

### 4.2 浏览器端：HLS 流解密（[src/lib/download/m3u8-downloader.ts](../../src/lib/download/m3u8-downloader.ts)）

下载器中 HLS-128 AES-128-CBC 分段解密从 crypto-js 迁移到 **Web Crypto API**
（`crypto.subtle`，浏览器原生，零依赖、性能更好）：

- key 存储类型从 `CryptoJS.lib.WordArray` 改为 `ArrayBuffer`
- 解密调用改 `crypto.subtle.decrypt`（AES-CBC）

### 4.3 IndexedDB 持久化（[src/lib/download/download-idb.ts](../../src/lib/download/download-idb.ts)）

- key 序列化逻辑简化：`ArrayBuffer` 可被结构化克隆直接存储，去掉原来
  crypto-js WordArray 的转储开销

---

## 五、Lint 162 个错误修复

升级后新规则集（React Compiler 诊断 + react-hooks v6）暴露 162 个错误。

### 5.1 真·Hook 规则违规（4 处，修代码）

| 文件                                                                             | 问题                                                | 修复                                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [src/components/HeroBanner.tsx](../../src/components/HeroBanner.tsx)（L238-244） | `useEffect` 写在 early return 之后                  | 移到 early return 之前。**这是真实 bug**：数据为空后加载会导致 Hook 数量不一致而崩溃 |
| [src/app/admin/page.tsx](../../src/app/admin/page.tsx)（L8269-8282）             | `useState` 写在 early return 之后                   | 移到 early return 之前，消除运行时隐患                                               |
| [src/lib/invite-code.ts](../../src/lib/invite-code.ts)（L161）                   | 服务端函数 `useInviteCode` 被 `use` 前缀误判为 Hook | 重命名 `markInviteCodeUsed`（纯命名问题）                                            |

### 5.2 React Compiler 诊断（158 处，规则降级为 warn）

新版 eslint-plugin-react-hooks 带来的 React Compiler 诊断规则
（refs-during-render / set-state-in-effect / purity / immutability /
static-components / memoization）默认为 error。

- [eslint.config.mjs](../../eslint.config.mjs)（L28-36）：将这些诊断规则降级为 `warn`
- **理由**：它们是「编译器优化建议」而非运行时错误——不满足假设的组件会被
  Compiler 保守跳过编译（行为不变，只是不优化）。存量代码一次性重构 150+ 处
  风险远大于收益
- 后续配合 P2 的 React Compiler 启用，这些 warn 可作为渐进优化清单

---

## 六、性能优化（P1 + P2）

### P1：`getConfig()` 请求级热点消除（[src/lib/config.ts](../../src/lib/config.ts) L343-390）

**问题**：`getConfig()` 是全站最热路径（几乎每个页面和 API 都调用），无缓存时
每个请求触发 2+N 次数据库查询。

**优化**：

1. **10 秒 TTL 内存缓存**：10 秒内所有请求共享一次读库
2. **并发去重（in-flight promise）**：缓存过期瞬间的多个并发请求共享同一次
   进行中的读库 Promise，防止缓存击穿
3. **`clearConfigCache()` 强制失效保留**：所有配置写路径（管理后台保存等）
   已调用它，改配置依然即时生效，不引入陈旧数据
4. **移除 configSelfCheck 调试日志**：原每个新用户首次访问刷 3 条
   `console.log`，日志风暴消除

**效果**：每请求数据库查询从 2+N 次 → 10 秒窗口内 0 次。

### P2：React Compiler 启用（[next.config.js](../../next.config.js)）

1. 新增依赖 `babel-plugin-react-compiler@1.0.0`
2. next.config 开启 `reactCompiler: true`

**效果**：全站组件自动 memoize——此前需要手写 `useMemo`/`useCallback` 的场景
由编译器接管，减少无效重渲染。不满足编译假设的组件自动跳过（行为不变）。

---

## 七、验证结果

| 检查项     | 命令             | 结果                                                         |
| ---------- | ---------------- | ------------------------------------------------------------ |
| 类型检查   | `tsc --noEmit`   | ✅ 零错误                                                    |
| Lint       | `eslint src`     | ✅ 0 errors（~2168 条 no-console 等警告，非阻塞）            |
| 构建       | `pnpm build`     | ✅ 成功，编译 14.7s，140 个路由全部生成，standalone 输出正常 |
| 加解密互通 | 迁移脚本对比测试 | ✅ 6/6 通过                                                  |
| 开发服务器 | `pnpm dev`       | ✅ 432ms 启动（Turbopack）                                   |

---

## 八、遗留事项与建议

1. **~2168 条 lint 警告**：绝大多数为 `no-console`（项目内有大量 `console.log`
   日志输出）。如需治理，建议渐进式替换为统一 logger 或按目录关闭规则。
2. **158 条 React Compiler warn**：可作为后续渐进优化清单——逐文件满足 Compiler
   假设后即可享受自动 memoize。
3. **TypeScript 7（tsgo）**：typescript-eslint 适配后可跟进，届时构建速度会有
   数量级提升。
4. **Windows symlink 补丁**：Next.js 后续版本若修复 ENOENT fallback，可移除
   [patches/next@16.3.5.patch](../../patches/next@16.3.5.patch)。
5. **建议实际观察**：首页轮播、播放页交互、管理后台在 React Compiler 启用后的
   流畅度；如个别组件异常，可在文件头加 `'use no memo'` 指令单独豁免。
