# GitHub 开源项目搜索神器

一个纯前端的 GitHub 公开仓库检索工具，浏览器端直连 GitHub REST Search API，支持关键词搜索、高级 qualifier 语法、本地二次精排与近期热榜。零后端、零构建、可直接部署到任意静态托管平台。

- 纯静态站点（HTML + CSS + JS），无 Node/Python/数据库依赖
- 浏览器直连 `https://api.github.com`，可选 Personal Token 或第三方代理镜像
- 兼容深色/浅色主题，适配桌面与移动端
- Token 仅保留在页面内存，永不持久化、永不发送给第三方代理

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [本地预览](#本地预览)
- [部署方式（任选其一）](#部署方式任选其一)
  - [方式一：Git 连接（推荐）](#方式一git-连接推荐)
  - [方式二：Direct Upload 直传](#方式二direct-upload-直传)
- [配置说明](#配置说明)
- [安全说明](#安全说明)
- [免责声明](#免责声明)
- [License](#license)

---

## 功能特性

### 仓库搜索

- 关键词搜索 + GitHub qualifier 语法，例：`language:go stars:>1000 topic:cli license:mit`
- 排序：综合匹配 / 最多 Star / 最多 Fork / 最近更新 / Help Wanted
- 过滤：语言、最低 Star、最近更新时间、匹配字段（名称 / 描述 / 主题 / README）
- 本地二次精排：标题命中加权 + 多词覆盖率 + 中文优先 + Star 密度修正（不请求 GitHub）
- 结果缓存：基于 `query|page|sort` 键缓存，重复搜索秒级返回
- 关键词高亮：优先使用 API 返回的 `text-match`，不可用时本地匹配
- 搜索历史：localStorage 持久化，可一键清除

### 近期热榜仓库

| 榜单 | 时间窗口 | Star 门槛 | 排序方式 |
|------|----------|-----------|----------|
| 月榜 | 近 30 天创建 | ≥ 50 | 按总 Star |
| 周榜 | 近 7 天创建 | ≥ 20 | 按总 Star |
| 发现榜 | 近 7 天更新 | > 10 | Fisher-Yates 洗牌随机 100 |

- 支持中文项目 / English 切换
- 列表卡片点击直达 GitHub 仓库页
- 刷新按钮带视觉反馈（高亮 + 旋转 + 卡片半透明 + 提示文案）

### API 与身份

- Personal Token：Fine-grained Token 推荐，仅页面内存，仅直连官方 API
- 第三方代理镜像：内置 GH-Proxy、LLKK 节点，匿名访问，启用前自动检测可用性
- Token 与代理互斥：使用代理时不携带 Token

---

## 技术栈

| 类别 | 选型 |
|------|------|
| 页面 | 原生 HTML5 + 原生 CSS3（CSS 变量 + Grid + Flexbox） |
| 脚本 | 原生 JavaScript（无框架、无打包工具、无依赖） |
| 数据源 | GitHub REST Search API（`/search/repositories`） |
| 持久化 | `localStorage`（仅 `gh_search_history`、`gh_theme_preference`、`gh_api_proxy`） |
| 部署 | 任意静态托管平台（Cloudflare Pages / GitHub Pages / Vercel / Netlify） |

---

## 项目结构

```
.
├── index.html          # 页面骨架与内联弹窗（Token/代理/功能说明面板）
├── assets/
│   ├── app.js          # 全部业务逻辑（搜索、热榜、精排、Token、代理、主题）
│   └── styles.css     # 全局样式 + 深浅主题 + 响应式布局
└── favicon.ico         # 站点图标
```

> 本项目无 `package.json`、无构建步骤、无后端服务。直接部署即可。

---

## 本地预览

由于浏览器对 `file://` 协议下的 fetch 有跨域限制，需用任意静态服务器启动：

```powershell
# 方式 A：Python（任意版本均可）
python -m http.server 8000

# 方式 B：Node http-server（需全局安装）
npx http-server -p 8000

# 方式 C：PowerShell 内置（无需安装）
# 见仓库内 _srv.ps1（如已移除，可用 A/B 任一）
```

打开浏览器访问 `http://localhost:8000` 即可。

---

## 部署方式（任选其一）

本项目是纯静态站点，无需任何转换或改造，下面两种方式**任选其一**即可上线。

### 方式一：Git 连接（推荐）

适合持续集成，推送代码后自动部署。

1. 将本目录推送到 GitHub / GitLab 仓库
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Create → Pages → Connect to Git
3. 选择刚才推送的仓库
4. 在 **Build configuration** 中按下表填写：

   | 字段 | 值 |
   |------|----|
   | Framework preset | `None` |
   | Build command | （留空） |
   | Build output directory | `/`（根目录就是站点根） |
   | Root directory | （留空） |
   | Environment variables | （无需） |

5. 点击 **Save and Deploy**，等待 30 秒左右即可获得 `https://<project-name>.pages.dev` 域名

> 后续每次 `git push` 到默认分支都会自动触发重新部署。

### 方式二：Direct Upload 直传

适合一次性发布、无 Git 历史或临时预览。

**选项 A：通过 Wrangler CLI（推荐）**

```powershell
# 安装 Wrangler（如未安装）
npm install -g wrangler

# 登录 Cloudflare
npx wrangler login

# 在本目录下执行
cd c:\Users\Administrator\Desktop\github
npx wrangler pages deploy . --project-name=github-search
```

**选项 B：通过 Dashboard 拖拽上传**

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Direct Upload
2. 创建项目名（如 `github-search`）
3. 将本目录所有文件（`index.html`、`assets/`、`favicon.ico`）整体拖入上传区
4. 部署完成后获得 `https://<project-name>.pages.dev` 域名

---

## 配置说明

### Personal Token（可选）

用于突破未认证 IP 的 API 速率限制（10 次/分钟 → 按账号独立计算）。

- 推荐使用 GitHub **Fine-grained Token**（细粒度，可零权限）
- Token 仅保留在当前标签页内存，**不写入** localStorage / sessionStorage / IndexedDB / Cookie
- 仅在直连 `https://api.github.com` 时作为请求头发送
- 刷新或关闭页面后自动失效
- 启用 Token 后不能切换第三方代理，刷新页面自动切回官方 API

获取步骤详见页面内「🔑 Personal Token 设置」面板的「📖 如何获取 Token？」教程。

### 第三方代理镜像（可选）

用于国内网络无法直连 `api.github.com` 的场景。

内置已实测可用节点：

| 名称 | 地址 | 说明 |
|------|------|------|
| GitHub 官方 | `https://api.github.com` | 默认，需直连能力 |
| GH-Proxy | `https://gh-proxy.com/https://api.github.com` | 国内优化 · 匿名 |
| LLKK | `https://gh.llkk.cc/https://api.github.com` | 国内优化 · 匿名 |

- 启用前自动检测 Search API 可用性、CORS、JSON 格式，检测失败不切换
- 代理模式绝不携带 Token
- 自定义代理地址须以 `/` 或 `http(s)://` 开头，由前端校验

### 本地存储

| 键 | 用途 | 可清除 |
|----|------|--------|
| `gh_search_history` | 搜索历史 | 是，页面内「清除搜索历史」按钮 |
| `gh_theme_preference` | 主题偏好（light/dark） | 切换主题即更新 |
| `gh_api_proxy` | 代理地址持久化 | 「恢复默认」按钮 |

---

## 安全说明

项目已在前端实现多层防护：

- **XSS**：用户文本字段（owner/name/description/topics/license）经 `escapeHtml` 处理后插入 innerHTML
- **URL 协议白名单**：外部链接经 `safeUrl()` 校验，仅允许 `http://`、`https://`、`//host`，拦截 `javascript:`、`data:`、`vbscript:`
- **头像域名白名单**：`safeAvatar()` 仅允许 `*.githubusercontent.com`、`*.github.com`
- **外部链接安全**：所有外链均含 `rel="noopener noreferrer"`
- **localStorage 防护**：读写均 `try/catch + JSON.parse`，防原型污染
- **竞态防护**：使用 `AbortController` 取消旧请求，避免响应错位
- **Token 隔离**：Token 仅页面内存，代理请求不携带认证头

如发现安全漏洞，请勿在公开 Issue 中提交，优先通过私密渠道联系维护者。

---

## 免责声明

- 本站是独立开发的浏览器端公开仓库检索工具，**不隶属于 GitHub，不代表 GitHub**
- 默认通过 GitHub REST Search API 获取数据；启用第三方代理时，请求由对应服务转发
- GitHub 名称及相关标识的权利归 GitHub, Inc. 所有，本站使用该名称仅为说明数据来源，不表示授权、认可、赞助或合作关系
- 近期热榜与本地二次精排均为本站派生展示，**不是 GitHub Trending 或 GitHub 官方排名/推荐**
- 第三方代理服务由独立运营方提供，可用性、日志与隐私规则以运营方说明为准
- 检索结果受 API 索引状态、速率限制、`incomplete_results` 等因素影响，具体信息以 [GitHub 官方页面](https://github.com/search) 和对应仓库页面为准

---

## License

本项目源码以 MIT 协议开源，可自由使用、修改、分发。

GitHub API、仓库内容、License 信息等数据权利归相应权利人所有。


![image](https://raw.githubusercontent.com/Ozero-top/OpenHub/refs/heads/main/OpenHun.png)
