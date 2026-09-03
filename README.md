# GitHub 开源项目搜索神器

一个浏览器端的 GitHub 公开仓库检索工具:页面直连 GitHub REST Search API,支持关键词搜索、高级 qualifier 语法、本地二次精排(更新日期优先)与近期热榜。前端为纯静态站点(HTML + CSS + JS,零构建、零依赖),另附带一个**可选的** Cloudflare Worker + D1 访问计数服务。

- 纯静态前端(HTML + CSS + JS),无 Node/Python/构建工具依赖,可直接部署到任意静态托管平台
- 浏览器直连 `https://api.github.com`,可选 Personal Token 或第三方代理镜像
- Soft UI(新拟物)设计风格,深色/浅色双主题,默认跟随系统,适配桌面与移动端
- Token 仅保留在页面内存,永不持久化、永不发送给第三方代理
- 可选服务端访问计数:Cloudflare Worker + D1,IP 经 SHA-256 加盐哈希存储,同一 IP 30 分钟去重,爬虫不计数;不部署也不影响前端使用

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [本地预览](#本地预览)
- [部署方式](#部署方式)
  - [第一部分:前端静态站点(必需)](#第一部分前端静态站点必需)
  - [第二部分:访问计数 Worker + D1(可选)](#第二部分访问计数-worker--d1可选)
- [配置说明](#配置说明)
- [访问计数 API 契约](#访问计数-api-契约)
- [本地存储](#本地存储)
- [安全说明](#安全说明)
- [免责声明](#免责声明)
- [License](#license)

---

## 功能特性

### 仓库搜索

- 关键词搜索 + GitHub qualifier 语法,例:`language:go stars:>1000 topic:cli license:mit`
- 排序:综合匹配 / 最多 Star / 最多 Fork / 最近更新 / Help Wanted
- 过滤:语言、最低 Star、最近更新时间、匹配字段(名称 / 描述 / 主题 / README)
- 中文查询增强:纯中文查询自动限定 `in:name,description,topics` 以避开 README 噪音;多词查询自动加引号短语提升整词匹配权重
- **本地二次精排(🧠 开关,不请求 GitHub)**:先按**仓库更新时间(`pushed_at`)降序**,同更新时间再按相关性得分(标题命中加权、多词覆盖率、中文优先、Star 密度修正)排序;切换即时生效,命中缓存零请求
- 结果缓存:基于 `query|page|sort` 的内存缓存(LRU 上限),重复搜索秒级返回
- 关键词高亮:优先使用 API 返回的 `text-match`,不可用时浏览器本地匹配
- 搜索历史:`localStorage` 持久化(最多 8 条),可一键清除
- 查询状态写入 URL Hash,可分享、可前进后退
- 请求竞态防护:`AbortController` 自动取消过期请求,避免响应错位

### 近期热榜仓库

| 榜单 | 查询条件 | 排序方式 | 数量 |
|------|----------|----------|------|
| 月榜 | 近 30 天**创建** · Star ≥ 50 · 排除 fork/归档 | 按总 Star | Top 100 |
| 周榜 | 近 7 天**创建** · Star ≥ 20 · 排除 fork/归档 | 按总 Star | Top 100 |
| 发现榜 | 近 7 天**更新** · Star > 10 · 排除 fork/归档 | 按更新时间取 100,客户端 Fisher-Yates 洗牌 | 随机 100 |

- 支持**中文项目 / English** 切换:首次打开按浏览器语言与系统时区自动选择,之后可手动切换;中文/英文项目根据仓库名与描述中的 CJK 字符近似识别
- 查询附带语种扩展词(中文:`开源 OR 框架 OR 教程 OR 平台 OR 中文`;英文:`framework OR library OR tutorial OR platform OR awesome`),提升榜单相关性
- 发现榜每次点击「刷新」重新洗牌,让更多新项目被发现
- 榜单为本站派生展示,**不是 GitHub Trending 或 GitHub 官方排名**

### API 与身份

- **Personal Token(🔑)**:推荐 Fine-grained Token(可零权限、90 天有效期);仅保留在当前标签页内存,仅在目标为 `https://api.github.com` 时才发送 `Authorization` 头;刷新/关闭页面即失效;与代理互斥
- **第三方代理镜像(🌐)**:内置 GH-Proxy、LLKK 节点;启用前自动检测 Search API 可达性、CORS、JSON 格式与数据结构(10 秒超时),检测失败不切换;代理模式绝不携带 Token;代理地址持久化在本地,刷新页面恢复官方直连
- 面板内置「📖 如何获取 Token」图文教程与配额说明

### 访问计数(可选服务端)

- 页面空闲时(`requestIdleCallback`)异步上报,5 秒超时,不阻塞首屏;接口不可用时计数位显示 `0`,不报错
- 服务端:爬虫/机器人/无 UA 不计数;IP 经 SHA-256 加盐哈希后存储,不保留原始 IP;同一 IP 30 分钟内只计一次;过期 IP 记录自动清理
- D1 表结构首次请求自动创建,无需手动迁移

---

## 技术栈

| 类别 | 选型 |
|------|------|
| 页面 | 原生 HTML5 + 原生 CSS3(CSS 变量 + Grid + Flexbox,Soft UI 双主题) |
| 脚本 | 原生 JavaScript(无框架、无打包工具、无依赖) |
| 数据源 | GitHub REST Search API(`/search/repositories`,`X-GitHub-Api-Version: 2022-11-28`) |
| 前端持久化 | `localStorage`(搜索历史 / 主题 / 代理地址) |
| 服务端(可选) | Cloudflare Workers + D1 SQLite(访问计数) |
| 部署 | 静态部分:任意静态托管(Cloudflare Pages / GitHub Pages / Vercel / Netlify / Nginx);计数部分:Cloudflare Workers |

---

## 项目结构

```
.
├── index.html          # 页面骨架与内联面板(代理设置 / Token / 功能说明)
├── worker.js           # 可选:Cloudflare Worker 访问计数 API(需绑定 D1)
├── assets/
│   ├── app.js          # 全部前端业务逻辑(搜索、热榜、精排、Token、代理、主题、计数上报)
│   └── styles.css      # Soft UI 双主题样式 + 响应式布局
└── favicon.ico         # 站点图标
```

> 本项目无 `package.json`、无构建步骤。前端直接部署即可;`worker.js` 仅在需要自部署访问计数时使用。

---

## 本地预览

由于浏览器对 `file://` 协议下的 fetch 有跨域限制,需用任意静态服务器启动:

```powershell
# 方式 A:Python(任意版本均可)
python -m http.server 8000

# 方式 B:Node http-server(需全局安装)
npx http-server -p 8000
```

打开浏览器访问 `http://localhost:8000` 即可。本地预览时访问计数功能默认请求线上 Worker 地址,不影响其他功能。

---

## 部署方式

### 第一部分:前端静态站点(必需)

前端是纯静态文件,任选一种托管方式:

- **Cloudflare Pages / GitHub Pages / Vercel / Netlify**:连接 Git 仓库或直接拖拽上传 `index.html`、`assets/`、`favicon.ico` 即可,无需构建命令
- **Nginx / 任意静态服务器**:将项目目录设为站点根目录。Docker 环境也可直接用官方 Nginx 镜像挂载本目录:

  ```powershell
  docker run -d --name github-search -p 8080:80 -v "C:\path\to\project:/usr/share/nginx/html:ro" nginx:stable-alpine
  ```

### 第二部分:访问计数 Worker + D1(可选)

不部署此部分时,页脚访问计数显示 `0`,其余功能完全不受影响。

#### 步骤 1:创建 D1 数据库

在 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Storage & Databases → D1 SQL Database** 中创建数据库(如命名 `gh-search-visits`),记下 **Database ID**。无需手动建表,Worker 首次请求会自动初始化。

#### 步骤 2:部署 Worker

**方式 A:Wrangler CLI(推荐)**

在项目根目录创建 `wrangler.toml`(自行填入数据库 ID):

```toml
name = "github-search-visits"
main = "worker.js"
compatibility_date = "2024-09-01"

[[d1_databases]]
binding = "VISITS_DB"
database_name = "gh-search-visits"
database_id = "<你的 D1 数据库 ID>"
```

然后执行:

```powershell
npm install -g wrangler
npx wrangler login
npx wrangler deploy
```

**方式 B:Dashboard 在线编辑器**

Workers & Pages → Create Worker → 把 `worker.js` 全文粘贴进编辑器并部署,然后在该 Worker 的 **Settings → Bindings** 中添加 **D1 database binding**:

- Variable name:`VISITS_DB`(大小写敏感,必须与代码一致)
- D1 database:选择上一步创建的数据库

保存后重新部署一次。

#### 步骤 3:让前端指向你的 Worker

前端计数地址定义在 [assets/app.js](assets/app.js) 中:

```js
var VISIT_API_URL = 'https://git.com/api/visit';
```

改为你自己的 Worker 地址(如 `https://github-search-visits.<你的子域>.workers.dev/api/visit`);若 Worker 与站点同域部署,也可直接写相对路径 `/api/visit`。

> **注意**:`worker.js` 中所有非 `/api/visit` 路径都会 301 跳转到主站(常量 `REDIRECT_URL`),如需修改跳转目标或与前端同域部署,请同步调整该常量。

#### 步骤 4:验证

浏览器访问 `https://<你的-worker-域名>/api/visit`,正常应返回:

```json
{ "total": 1, "totalFormatted": "1", "counted": true, "dbBound": true, "bot": false }
```

- `dbBound: true` 表示 D1 绑定生效;若为 `false` 说明绑定未配置或未重新部署
- 返回中如出现 `error` 字段(`schema_init_failed` / `visit_failed` / `read_failed`),其值为具体错误信息,可据此排查

---

## 配置说明

### Worker 可配置常量(worker.js 顶部配置区)

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `DEDUP_WINDOW_SECONDS` | `1800`(30 分钟) | 同一 IP 去重窗口 |
| `IP_SALT` | `gh-search-visits-2026` | IP 哈希盐值,**自部署时建议修改**为随机字符串 |
| `REDIRECT_URL` | `https://git.ozero.top/` | 非计数路径的 301 跳转地址 |
| `API_PATH` | `/api/visit` | 计数接口路径 |
| D1 绑定名 | `VISITS_DB` | 必须在 Worker 绑定中同名配置 |

### Personal Token(可选)

用于突破未认证 IP 的 API 速率限制(未认证按出口 IP 共享配额,认证后按账号独立计算)。

- 推荐使用 GitHub **Fine-grained Token**(Public Repositories read-only、所有权限 No access、90 天有效期)
- Token 仅保留在当前标签页内存,**不写入** localStorage / sessionStorage / IndexedDB / Cookie
- 仅在直连 `https://api.github.com` 时作为请求头发送(代码中校验协议、主机名与端口)
- 刷新或关闭页面后自动失效;启用 Token 后不能切换代理
- 获取步骤详见页面内「🔑 Personal Token 设置」面板的「📖 如何获取 Token?」教程

### 第三方代理镜像(可选)

用于国内网络无法直连 `api.github.com` 的场景。内置实测节点:

| 名称 | 地址 | 说明 |
|------|------|------|
| GitHub 官方 | `https://api.github.com` | 默认,需直连能力 |
| GH-Proxy | `https://gh-proxy.com/https://api.github.com` | 国内优化 · 匿名 |
| LLKK | `https://gh.llkk.cc/https://api.github.com` | 国内优化 · 匿名 |

- 启用前自动检测:HTTP 状态、`Content-Type: application/json`、返回结构(`total_count`/`items`)、CORS 可达性,10 秒超时
- 代理模式绝不携带 Token;自定义代理地址不允许包含查询参数、片段或控制字符
- 代理服务由第三方运营,可用性与隐私规则以运营方为准

---

## 访问计数 API 契约

`GET /api/visit`(支持 `OPTIONS` 预检;允许跨域,`Cache-Control: no-store`)

响应字段:

| 字段 | 类型 | 说明 |
|------|------|------|
| `total` | number | 累计访问总数 |
| `totalFormatted` | string | 千分位格式化后的总数,如 `"12,345"` |
| `counted` | boolean | 本次请求是否计入(去重窗口内重复访问、爬虫均为 `false`) |
| `dbBound` | boolean | D1 绑定是否生效;`false` 表示未配置绑定,服务降级返回 0 |
| `bot` | boolean | 本次请求是否被识别为爬虫/机器人 |
| `error` | string? | 异常时出现,值为 `schema_init_failed: ...` / `visit_failed: ...` / `read_failed: ...` |

D1 表结构(首次请求幂等创建):

```sql
visit_total(id INTEGER PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0);
visit_ip(ip_hash TEXT PRIMARY KEY, last_visit_at INTEGER NOT NULL);
CREATE INDEX idx_visit_ip_last ON visit_ip(last_visit_at);
```

---

## 本地存储

| 键 | 用途 | 生命周期 / 清除方式 |
|----|------|--------------------|
| `gh_search_history` | 搜索历史(最多 8 条) | 页面内「清除搜索历史」按钮 |
| `gh_theme_preference` | 主题偏好(`light` / `dark`) | 切换主题即更新;未手动锁定时跟随系统 |
| `gh_api_proxy` | 代理地址持久化 | 代理设置面板「恢复默认」按钮 |
| `gh_token_hint_dismissed` | Token 提示条关闭状态 | 仅 UI 状态标记 |

> Personal Token **不在此列**:它只存在于页面 JavaScript 内存中,不落任何持久化存储。

---

## 安全说明

前端多层防护:

- **XSS**:用户文本字段(owner / name / description / topics / license 等)经 `escapeHtml` 转义后插入 DOM
- **URL 协议白名单**:外部链接经 `safeUrl()` 校验,仅允许 `http://`、`https://`、`//host`,拦截 `javascript:`、`data:`、`vbscript:`
- **头像域名白名单**:`safeAvatar()` 仅允许 `*.githubusercontent.com`、`*.github.com`
- **外部链接安全**:所有外链均含 `rel="noopener noreferrer"`
- **Token 隔离**:`Authorization` 头仅在目标主机严格为 `api.github.com`(HTTPS、无端口)时发送,代理请求不携带任何认证信息
- **代理地址校验**:拒绝控制字符、查询参数与 URL 片段
- **竞态防护**:`AbortController` 取消旧请求,避免响应错位
- **存储防护**:localStorage 读写均 `try/catch + JSON.parse`

访问计数服务端:

- **IP 隐私**:不存储原始 IP,仅存 `SHA-256(IP + 盐值)` 哈希,且盐值建议自部署时更换
- **爬虫过滤**:常见爬虫 UA 关键字 + 必须包含 `Mozilla` 标识,机器人不计数
- **数据最小化**:`visit_ip` 表只保留去重窗口内的哈希记录,过期记录异步自动删除
- **降级容错**:未绑定 D1 时接口正常返回(`dbBound: false`),不影响前端

如发现安全漏洞,请勿在公开 Issue 中提交,优先通过私密渠道联系维护者。

---

## 免责声明

- 本站是独立开发的浏览器端公开仓库检索工具,**不隶属于 GitHub,不代表 GitHub**
- 默认通过 GitHub REST Search API 获取数据;启用第三方代理时,请求由对应服务转发
- GitHub 名称及相关标识的权利归 GitHub, Inc. 所有,本站使用该名称仅为说明数据来源,不表示授权、认可、赞助或合作关系
- 近期热榜与本地二次精排均为本站派生展示,**不是 GitHub Trending 或 GitHub 官方排名/推荐**
- 第三方代理服务由独立运营方提供,可用性、日志与隐私规则以运营方说明为准
- 检索结果受 API 索引状态、速率限制、返回上限、缓存及 `incomplete_results` 等因素影响,具体信息以 [GitHub 官方页面](https://github.com/search) 和对应仓库页面为准

---

## License

本项目源码以 MIT 协议开源,可自由使用、修改、分发。

GitHub API、仓库内容、License 信息等数据权利归相应权利人所有。


![image](https://raw.githubusercontent.com/Ozero-top/OpenHub/refs/heads/main/OpenHun.png)
