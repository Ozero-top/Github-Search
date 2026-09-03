(function () {
  var themeToggleBtn = document.getElementById('themeToggle');
  var colorSchemeQuery = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

  function readThemePreference() {
    try {
      var saved = localStorage.getItem('gh_theme_preference');
      return saved === 'light' || saved === 'dark' ? saved : '';
    } catch (_) {
      return '';
    }
  }

  function getSystemTheme() {
    return colorSchemeQuery && colorSchemeQuery.matches ? 'light' : 'dark';
  }

  function applyTheme(theme, persist) {
    var nextTheme = theme === 'light' ? 'light' : 'dark';
    var targetTheme = nextTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    document.documentElement.style.colorScheme = nextTheme;
    if (persist) {
      try { localStorage.setItem('gh_theme_preference', nextTheme); } catch (_) {}
    }
    if (!themeToggleBtn) return;
    var label = targetTheme === 'light' ? '切换到浅色模式' : '切换到深色模式';
    themeToggleBtn.setAttribute('aria-label', label);
    themeToggleBtn.setAttribute('title', label);
    themeToggleBtn.setAttribute('aria-pressed', nextTheme === 'light' ? 'true' : 'false');
    themeToggleBtn.setAttribute('data-target-theme', targetTheme);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', function () {
      var currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      applyTheme(currentTheme === 'light' ? 'dark' : 'light', true);
    });
  }
  if (colorSchemeQuery) {
    var syncSystemTheme = function (event) {
      if (!readThemePreference()) applyTheme(event.matches ? 'light' : 'dark', false);
    };
    if (colorSchemeQuery.addEventListener) colorSchemeQuery.addEventListener('change', syncSystemTheme);
    else if (colorSchemeQuery.addListener) colorSchemeQuery.addListener(syncSystemTheme);
  }
  applyTheme(readThemePreference() || getSystemTheme(), false);

  // 默认始终使用官方 https://api.github.com。
  // 代理和 Token 都不持久化,刷新页面后恢复匿名直连。
  var DEFAULT_API = 'https://api.github.com';
  var API_BASE = DEFAULT_API;
  var LOCAL_BEARER = '';
  var GITHUB_API_VERSION = '2022-11-28';

  // 清理旧版本遗留的持久化 Token 密文。新版本不再读取或写入这些键。
  try {
    localStorage.removeItem('gh_api_token');
    localStorage.removeItem('gh_api_token_persisted');
    localStorage.removeItem('gh_token_hint_dismissed');
  } catch (_) {}

  function isOfficialGitHubApiRequest(url) {
    try {
      var target = new URL(url, location.href);
      return target.protocol === 'https:' &&
        target.hostname.toLowerCase() === 'api.github.com' &&
        !target.port;
    } catch (_) {
      return false;
    }
  }

  function normalizeProxyBase(value) {
    var raw = String(value || '').trim();
    if (!raw) return DEFAULT_API;
    if (/[\u0000-\u001f\u007f]/.test(raw) || raw.indexOf('?') !== -1 || raw.indexOf('#') !== -1) {
      throw new Error('代理地址不能包含控制字符、查询参数或片段');
    }
    if (raw.charAt(0) === '/') {
      if (raw.slice(0, 2) === '//' || raw.slice(0, 2) === '/\\') {
        throw new Error('同站代理必须是单斜杠开头的路径');
      }
      var relativeTarget = new URL(raw, location.href);
      if (!/^https?:$/.test(relativeTarget.protocol) || relativeTarget.origin !== location.origin) {
        throw new Error('相对代理路径必须与当前页面同源');
      }
      return relativeTarget.pathname.replace(/\/+$/,'') || '/';
    }
    var target = new URL(raw);
    if (target.protocol !== 'https:' || !target.hostname || target.username || target.password) {
      throw new Error('第三方代理必须是无账号信息的 HTTPS 地址');
    }
    return (target.origin + target.pathname).replace(/\/+$/,'');
  }

  function hasConfiguredToken() {
    return !!LOCAL_BEARER;
  }

  function isSupportedGitHubToken(value) {
    var token = String(value || '').trim();
    return /^(?:ghp_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{20,251})$/.test(token);
  }

  function buildFetchHeaders(requestUrl, extra, withTextMatch) {
    var accept = withTextMatch
      ? 'application/vnd.github.v3.text-match+json'
      : 'application/vnd.github+json';
    var h = { 'Accept': accept, 'X-GitHub-Api-Version': GITHUB_API_VERSION };
    var officialRequest = isOfficialGitHubApiRequest(requestUrl);
    if (extra) {
      for (var k in extra) {
        if (!Object.prototype.hasOwnProperty.call(extra,k)) continue;
        if (!officialRequest && String(k).toLowerCase() === 'authorization') continue;
        h[k] = extra[k];
      }
    }
    if (LOCAL_BEARER && officialRequest && isSupportedGitHubToken(LOCAL_BEARER)) {
      h['Authorization'] = 'Bearer ' + LOCAL_BEARER;
    }
    return h;
  }

  function buildFetchOptions(requestUrl, signal, withTextMatch) {
    return {
      signal: signal,
      headers: buildFetchHeaders(requestUrl, undefined, withTextMatch),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store'
    };
  }

  function refreshApiLabel() {
    var rateEl = document.getElementById('rateLabel');
    if (rateEl) {
      rateEl.textContent = API_BASE !== DEFAULT_API
        ? '代理匿名模式(不发送 Token)'
        : (LOCAL_BEARER ? '已认证(Token,仅直连 GitHub)' : '未认证(默认按出口 IP 限流)');
    }
    if (LOCAL_BEARER) hideRateHint();
    else showRateHintIfApplicable();
    var el = document.getElementById('apiModeLabel');
    if (!el) return;
    var parts = [];
    if (API_BASE !== DEFAULT_API) parts.push('代理:' + (API_BASE.length > 40 ? API_BASE.slice(0,40)+'…' : API_BASE));
    el.textContent = parts.length ? ' · [' + parts.join(' | ') + ']' : '';
  }

  var LANG_COLORS = {
    'JavaScript':'#f1e05a','TypeScript':'#3178c6','Python':'#3572A5','Java':'#b07219',
    'Go':'#00ADD8','Rust':'#dea584','C':'#555555','C++':'#f34b7d','C#':'#178600',
    'PHP':'#4F5D95','Ruby':'#701516','Swift':'#F05138','Kotlin':'#A97BFF','Shell':'#89e051',
    'HTML':'#e34c26','CSS':'#563d7c','Vue':'#41b883','Dart':'#00B4AB','Scala':'#c22d40',
    'Lua':'#000080','Elixir':'#6e4a7e','Haskell':'#5e5086','Objective-C':'#438eff',
    'PowerShell':'#012456','R':'#198CE7','Makefile':'#427819','Dockerfile':'#384d54',
    'Markdown':'#083fa1','Jupyter Notebook':'#DA5B0B','Svelte':'#ff3e00','Zig':'#ec915c',
    'Erlang':'#B83998','Perl':'#0298c3','OCaml':'#3be133','Assembly':'#6E4C13',
    'Solidity':'#AA5C5C','Julia':'#a270ba','Crystal':'#000100'
  };
  function langColor(lang) {
    return Object.prototype.hasOwnProperty.call(LANG_COLORS, lang) ? LANG_COLORS[lang] : '#7d8590';
  }

  /* DOM */
  var input = document.getElementById('q');
  var btn = document.getElementById('btn');
  var sortSel = document.getElementById('sort');
  var langSel = document.getElementById('lang');
  var starsSel = document.getElementById('stars');
  var pushedSel = document.getElementById('pushed');
  var inFieldSel = document.getElementById('inField');
  var rerankCb = document.getElementById('rerank');
  var clearBtn = document.getElementById('clear');
  var statusEl = document.getElementById('status');
  var resultsEl = document.getElementById('results');
  var pagerEl = document.getElementById('pager');
  var logo = document.getElementById('logo');
  var trendingSection = document.getElementById('trending-section');
  var trendingEl = document.getElementById('trending');
  var trendingSub = document.getElementById('trending-sub');
  var trendingStatusEl = document.getElementById('trending-status');
  var trendingPagerEl = document.getElementById('trending-pager');
  var trendingBadge = document.getElementById('trendingBadge');
  var rankingTitle = document.getElementById('rankingTitle');
  var rankingPeriodEl = document.getElementById('rankingPeriod');
  var rankingPeriodBtns = document.querySelectorAll('.ranking-period-tab');
  var rankingLanguageEl = document.getElementById('rankingLanguage');
  var rankingLanguageBtns = document.querySelectorAll('.ranking-language-tab');
  var resultsSection = document.getElementById('results-section');
  var resultsHeader = document.getElementById('results-header');
  var historyEl = document.getElementById('history');

  /* 搜索状态 */
  var currentQ = '';
  var page = 1;
  var totalPages = 1;
  var totalCount = 0;
  var loading = false;
  var currentController = null;
  var ignoreHash = false;

  /* 近期项目热榜状态 */
  var trendingItems = [];
  var trendingPage = 1;
  var trendingPerPage = 10;
  var trendingTotalPages = 10;
  var trendingLoaded = false;
  var trendingController = null; // 并发刷新时中断上一次请求,防止多次请求占用配额和内存
  var trendingPeriod = 'monthly';
  var trendingLanguage = detectTrendingLanguage();
  var trendingViewCache = Object.create(null);

  /* ---------- 工具 ---------- */
  function detectTrendingLanguage() {
    var browserLanguages = [];
    try {
      browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages
        : [navigator.language || navigator.userLanguage || ''];
    } catch (_) {}
    var primaryLanguage = String(browserLanguages[0] || '').toLowerCase();
    if (/^zh(?:-|$)/.test(primaryLanguage)) return 'zh';

    var timeZone = '';
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    if (/^(?:Asia\/(?:Shanghai|Chongqing|Harbin|Urumqi|Hong_Kong|Macau|Taipei)|Etc\/GMT-8|PRC)$/i.test(timeZone)) {
      return 'zh';
    }
    if (primaryLanguage || timeZone) return 'en';
    return 'zh';
  }

  function trendingText(zhText, enText) {
    return trendingLanguage === 'en' ? enText : zhText;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  // 外链协议白名单:只允许无账号信息的绝对 HTTPS URL。
  function safeUrl(u) {
    if (!u) return '';
    try {
      var parsed = new URL(String(u).trim());
      if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return '';
      return parsed.href;
    } catch (_) {
      return '';
    }
  }
  function safeGitHubRepoUrl(u) {
    var normalized = safeUrl(u);
    if (!normalized) return '';
    try {
      return new URL(normalized).hostname.toLowerCase() === 'github.com' ? normalized : '';
    } catch (_) {
      return '';
    }
  }
  // 安全打开 URL:经过协议白名单验证后在新标签页打开
  function safeOpenUrl(u) {
    var safe = safeUrl(u);
    if (!safe) return;
    window.open(safe, '_blank', 'noopener,noreferrer');
  }
  // 头像 URL 白名单:仅允许 GitHub 官方头像源,防止外链/恶意资源加载
  function safeAvatar(u) {
    var normalized = safeUrl(u);
    if (!normalized) return '';
    try {
      var host = new URL(normalized).hostname.toLowerCase();
    } catch (e) { return ''; }
    return host === 'avatars.githubusercontent.com' ? normalized : '';
  }
  function relativeTime(iso) {
    if (!iso) return '';
    var d = new Date(iso); var now = new Date();
    var diff = Math.max(0, (now - d) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff/60) + '分钟前';
    if (diff < 86400) return Math.floor(diff/3600) + '小时前';
    if (diff < 2592000) return Math.floor(diff/86400) + '天前';
    if (diff < 31536000) return Math.floor(diff/2592000) + '个月前';
    return Math.floor(diff/31536000) + '年前';
  }
  function formatNumber(n) {
    n = Number(n);
    if (!Number.isFinite(n) || n < 0) return '0';
    if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,'') + 'm';
    if (n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/,'') + 'k';
    return String(Math.floor(n));
  }
  // 仓库体积(KB → 人类可读)
  function formatSizeKB(kb) {
    if (kb == null) return '';
    kb = Number(kb) || 0;
    if (!kb) return '';
    if (kb < 1024) return kb + ' KB';
    if (kb < 1048576) return (kb/1024).toFixed(1).replace(/\.0$/,'') + ' MB';
    return (kb/1048576).toFixed(2).replace(/\.00$/,'') + ' GB';
  }
  // 构造"仓库属性"徽标(Public / License / Archived / Disabled / Template / Mirror)
  function repoBadges(repo) {
    var b = ['<span class="badge">' + (repo.private ? 'Private' : 'Public') + '</span>'];
    if (repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION') {
      var licUrl = repo.license.url && repo.license.url.indexOf('http') === 0
        ? repo.license.url : 'https://spdx.org/licenses/' + encodeURIComponent(repo.license.spdx_id) + '.html';
      b.push('<a class="badge license" href="' + escapeHtml(safeUrl(licUrl)) + '" target="_blank" rel="noopener noreferrer" title="查看许可证">' + escapeHtml(repo.license.spdx_id) + '</a>');
    }
    if (repo.archived) b.push('<span class="badge archived" title="仓库已归档,只读">Archived</span>');
    if (repo.disabled) b.push('<span class="badge disabled" title="仓库已被禁用">Disabled</span>');
    if (repo.is_template) b.push('<span class="badge template" title="这是一个模板仓库,可一键生成">Template</span>');
    if (repo.mirror_url) b.push('<a class="badge mirror" href="' + escapeHtml(safeUrl(repo.mirror_url)) + '" target="_blank" rel="noopener noreferrer" title="镜像自外部仓库">Mirror</a>');
    return b.join('');
  }
  // 构造"Wiki / Issues / Pages / 默认分支 / 仓库大小"快捷入口(基于 GitHub 固定 URL 规则,不用额外请求)
  function repoQuickLinks(repo) {
    var base = safeGitHubRepoUrl(repo.html_url).replace(/\/+$/,'');
    if (!base) return '';
    var links = [];
    if (repo.has_wiki)   links.push('<a href="' + escapeHtml(safeUrl(base + '/wiki')) + '" target="_blank" rel="noopener noreferrer">📖 Wiki</a>');
    if (repo.has_issues) links.push('<a href="' + escapeHtml(safeUrl(base + '/issues')) + '" target="_blank" rel="noopener noreferrer">🐛 Issues</a>');
    if (repo.has_pages) {
      // 多数 Pages 地址是 https://owner.github.io/repo 或用户/Org 站点 https://owner.github.io
      var owner = (repo.owner && repo.owner.login) ? String(repo.owner.login).toLowerCase() : '';
      var name = String(repo.name || '').toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner)) owner = '';
      if (!/^[a-z0-9._-]{1,100}$/.test(name)) name = '';
      var pagesUrl = (owner && (name === owner + '.github.io' || name === owner + '.github.com'))
        ? 'https://' + owner + '.github.io/'
        : (owner && name ? 'https://' + owner + '.github.io/' + encodeURIComponent(name) + '/' : base + '/pages');
      links.push('<a href="' + escapeHtml(safeUrl(pagesUrl)) + '" target="_blank" rel="noopener noreferrer">📰 Pages</a>');
    }
    var branch = repo.default_branch ? String(repo.default_branch) : '';
    if (branch) links.push('<a href="' + escapeHtml(safeUrl(base + '/tree/' + encodeURIComponent(branch))) + '" target="_blank" rel="noopener noreferrer" title="默认分支 🌿 ' + escapeHtml(branch) + '">🌿 ' + escapeHtml(branch.length > 14 ? branch.slice(0,14)+'…' : branch) + '</a>');
    var size = formatSizeKB(repo.size);
    if (size) links.push('<span style="color:var(--fg-subtle);padding:0 4px;">📦 ' + size + '</span>');
    return links.length ? '<div class="quick-links">' + links.join('') + '</div>' : '';
  }
  // 关键词高亮:两种策略(优先用 GitHub text_matches 精确片段,其次按用户关键词做正则高亮)
  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
  function highlightText(text, repo, rawQuery) {
    var s = text == null ? '' : String(text);
    if (!s) return s;
    // 策略 A: text_matches 精确命中
    var ranges = null;
    if (repo && Array.isArray(repo.text_matches)) {
      // 找出仓库自身字段(非 issue/commit) 的匹配片段
      var frags = [];
      for (var i = 0; i < repo.text_matches.length; i++) {
        var m = repo.text_matches[i] || {};
        if (m.fragment == null) continue;
        frags.push({ fragment: String(m.fragment), matches: m.matches || [] });
      }
      // 先在 fragment 里找当前 text 的子串(因为 fragment 可能多字段拼接),做 substring 定位
      for (var j = 0; j < frags.length; j++) {
        var f = frags[j].fragment;
        var idx = -1;
        try { idx = f.toLowerCase().indexOf(s.toLowerCase()); } catch (ee) { idx = -1; }
        if (idx >= 0) {
          // fragment 内匹配的 matches 记录了相对 fragment 的偏移
          var matches = frags[j].matches || [];
          var rangesArr = [];
          for (var k = 0; k < matches.length; k++) {
            var mm = matches[k] || {};
            var startMm = Number(mm.indices && mm.indices[0]) || Number(mm.start_index) || 0;
            var endMm   = Number(mm.indices && mm.indices[1]) || Number(mm.end_index)   || 0;
            // 把 fragment 相对偏移映射到 s 的相对偏移
            var localStart = startMm - idx;
            var localEnd   = endMm   - idx;
            if (localEnd > 0 && localStart < s.length && localEnd > localStart) {
              rangesArr.push([ Math.max(0, localStart), Math.min(s.length, localEnd) ]);
            }
          }
          if (rangesArr.length) { ranges = rangesArr; break; }
        }
      }
    }
    if (!ranges) {
      // 策略 B: 从 rawQuery 中提取普通关键词(去掉 qualifier / 符号),做一次安全正则高亮
      if (rawQuery) {
        var cleaned = String(rawQuery)
          .replace(/[a-zA-Z0-9_-]+:\S+/g,' ')      // qualifier:xxx
          .replace(/[<>=!*?()\[\]{}~@#$%^&|+\/\\,.;:`'"-]/g,' ')
          .replace(/\s+/g,' ').trim();
        if (cleaned) {
          var words = cleaned.split(' ').filter(function (w) { return w && w.length >= 1; });
          if (words.length) {
            try {
              var re = new RegExp('(?![^&;]+;)(?!<[^<>]*?)(' + words.map(escapeRegExp).join('|') + ')(?![^<>]*?>)', 'ig');
              return escapeHtml(s).replace(re, '<mark class="hl">$1</mark>');
            } catch (err) { /* fallthrough */ }
          }
        }
      }
      return escapeHtml(s);
    }
    // 策略 A:按 ranges 区间拼 <mark>
    ranges.sort(function (a,b) { return a[0]-b[0]; });
    var merged = [];
    for (var mi = 0; mi < ranges.length; mi++) {
      var r0 = ranges[mi];
      if (merged.length && r0[0] <= merged[merged.length-1][1]) {
        merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], r0[1]);
      } else merged.push([r0[0], r0[1]]);
    }
    var out = '';
    var cur = 0;
    for (var mj = 0; mj < merged.length; mj++) {
      var ms = merged[mj][0], me = merged[mj][1];
      if (ms < cur) continue;
      out += escapeHtml(s.substring(cur, ms));
      out += '<mark class="hl">' + escapeHtml(s.substring(ms, me)) + '</mark>';
      cur = me;
    }
    out += escapeHtml(s.substring(cur));
    return out;
  }
  function timeAgo(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff/60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff/3600) + ' 小时前';
    if (diff < 2592000) return Math.floor(diff/86400) + ' 天前';
    if (diff < 31536000) return Math.floor(diff/2592000) + ' 个月前';
    return Math.floor(diff/31536000) + ' 年前';
  }
  function dateAgo(days) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function scrollTop(el) {
    var r = el.getBoundingClientRect();
    var top = r.top + window.pageYOffset - 80;
    window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' });
  }

  /* ---------- 近期项目热榜 ---------- */
  function trendingRelativeTime(iso) {
    if (trendingLanguage !== 'en') return relativeTime(iso);
    if (!iso) return '';
    var d = new Date(iso);
    var diff = Math.max(0, (new Date() - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff/60) + 'm ago';
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
    if (diff < 2592000) return Math.floor(diff/86400) + 'd ago';
    if (diff < 31536000) return Math.floor(diff/2592000) + 'mo ago';
    return Math.floor(diff/31536000) + 'y ago';
  }

  function renderTrendingPage() {
    var start = (trendingPage - 1) * trendingPerPage;
    var slice = trendingItems.slice(start, start + trendingPerPage);
    trendingEl.innerHTML = '';
    if (!slice.length) {
      trendingStatusEl.textContent = trendingText('暂无数据', 'No projects found');
      renderTrendingPager();
      return;
    }
    trendingStatusEl.textContent = '';
    var frag = document.createDocumentFragment();
    slice.forEach(function (repo) {
      var owner = (repo.owner && repo.owner.login) || '';
      var safeAv = repo.owner && repo.owner.avatar_url ? safeAvatar(repo.owner.avatar_url) : '';
      var avatar = safeAv
        ? '<img class="avatar" src="' + escapeHtml(safeAv) + '" alt="" loading="lazy" width="26" height="26">'
        : '<span class="avatar"></span>';
      var lang = repo.language
        ? '<span><span class="lang-dot" style="background:' + langColor(repo.language) + '"></span>' + escapeHtml(repo.language) + '</span>'
        : '';
      var desc = repo.description ? escapeHtml(repo.description) : trendingText('暂无简介', 'No description');
      var timeline = '';
      if (repo.created_at) {
        timeline = '<span class="time" title="' +
          trendingText('创建于 ', 'Created ') + escapeHtml(repo.created_at.slice(0,10)) + '">' +
          trendingText('创建 ', 'Created ') + trendingRelativeTime(repo.created_at) + '</span>';
      }
      var extras = [];
      var branch = repo.default_branch ? String(repo.default_branch) : '';
      if (branch) extras.push('<span title="' + trendingText('默认分支 ', 'Default branch ') + '🌿 ' + escapeHtml(branch) + '">🌿 ' + escapeHtml(branch.length > 12 ? branch.slice(0,12)+'…' : branch) + '</span>');
      var size = formatSizeKB(repo.size);
      if (size) extras.push('<span title="' + trendingText('仓库体积', 'Repository size') + '">📦 ' + size + '</span>');
      var badges = repoBadges(repo);
      var el = document.createElement('div');
      el.className = 'tcard clickable';
      el.setAttribute('data-href', safeGitHubRepoUrl(repo.html_url));
      el.innerHTML =
        '<div class="tcard-title">' +
          avatar +
          '<div class="tname">' +
            '<span class="owner">' + escapeHtml(owner) + '</span>' +
            '<a href="' + escapeHtml(safeGitHubRepoUrl(repo.html_url)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(repo.name) + '</a>' +
            '<span style="margin-left:6px">' + badges + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="tcard-desc">' + desc + '</div>' +
        '<div class="tcard-meta">' +
          '<span>★ ' + formatNumber(repo.stargazers_count) + '</span>' +
          '<span>⑂ ' + formatNumber(repo.forks_count) + '</span>' +
          '<span>👁 ' + formatNumber(repo.watchers_count || 0) + '</span>' +
          '<span>⚠ ' + formatNumber(repo.open_issues_count || 0) + '</span>' +
          lang + timeline + extras.join('') +
        '</div>';
      frag.appendChild(el);
    });
    trendingEl.appendChild(frag);
    renderTrendingPager();
  }

  function renderTrendingPager() {
    trendingPagerEl.innerHTML = '';
    if (trendingTotalPages <= 1) return;
    var prev = document.createElement('button');
    prev.textContent = trendingText('上一页', 'Previous');
    prev.disabled = trendingPage <= 1;
    prev.addEventListener('click', function () { trendingPage--; renderTrendingPage(); scrollTop(trendingSection); });
    trendingPagerEl.appendChild(prev);
    function appendPageButton(p) {
      var b = document.createElement('button');
      b.textContent = String(p);
      if (p === trendingPage) b.classList.add('active');
      b.addEventListener('click', function () { trendingPage = p; renderTrendingPage(); scrollTop(trendingSection); });
      trendingPagerEl.appendChild(b);
    }
    function appendEllipsis() {
      var e = document.createElement('span');
      e.className = 'ellipsis';
      e.textContent = '…';
      trendingPagerEl.appendChild(e);
    }
    var pages = [1];
    var from = Math.max(2, trendingPage - 2);
    var to = Math.min(trendingTotalPages - 1, trendingPage + 2);
    if (from > 2) pages.push(-1);
    for (var i = from; i <= to; i++) pages.push(i);
    if (to < trendingTotalPages - 1) pages.push(-1);
    if (trendingTotalPages > 1) pages.push(trendingTotalPages);
    pages.forEach(function (p) {
      if (p === -1) appendEllipsis();
      else appendPageButton(p);
    });
    var next = document.createElement('button');
    next.textContent = trendingText('下一页', 'Next');
    next.disabled = trendingPage >= trendingTotalPages;
    next.addEventListener('click', function () { trendingPage++; renderTrendingPage(); scrollTop(trendingSection); });
    trendingPagerEl.appendChild(next);
    var info = document.createElement('span');
    info.className = 'info';
    info.textContent = trendingLanguage === 'en'
      ? 'Page ' + trendingPage + '/' + trendingTotalPages + ' · ' + trendingPerPage + ' per page'
      : '第 ' + trendingPage + '/' + trendingTotalPages + ' 页 · 每页 ' + trendingPerPage + ' 个';
    trendingPagerEl.appendChild(info);
  }

  function getTrendingViewKey() {
    return trendingLanguage + ':' + trendingPeriod;
  }

  /* 发现榜:随机 100 个最近更新的项目
     - 单次 API 请求取最近更新的项目(per_page=100)
     - 客户端 Fisher-Yates 洗牌,每次刷新都随机排列
     - 让访问者发现更多最近活跃的开源项目
  */
  // Fisher-Yates 洗牌:不修改原数组,返回新数组
  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function getTrendingConfig() {
    var periods = {
      discover: { days: 3,  minStars: 1,   zhName: '发现榜', enName: 'Discover', zhRange: '近 3 天创建 · Star≥1',   enRange: 'Created in the past 3 days · Stars≥1' },
      weekly:   { days: 7,  minStars: 20,  zhName: '周榜',   enName: 'Weekly',   zhRange: '近 7 天创建 · Star≥20',  enRange: 'Created in the past 7 days · Stars≥20' },
      monthly:  { days: 30, minStars: 50,  zhName: '月榜',   enName: 'Monthly',  zhRange: '近 30 天创建 · Star≥50', enRange: 'Created in the past 30 days · Stars≥50' }
    };
    var period = periods[trendingPeriod] || periods.monthly;
    var isEnglish = trendingLanguage === 'en';
    // 精简关键词:去除"工具/项目/系统/tool/app"等过于宽泛的通用词,改用更具针对性的词
    // 提升搜索精准度,避免匹配大量无关仓库
    var languageQuery = isEnglish
      ? 'framework OR library OR tutorial OR platform OR awesome'
      : '开源 OR 框架 OR 教程 OR 平台 OR 中文';
    var periodName = isEnglish ? period.enName : period.zhName;
    var range = isEnglish ? period.enRange : period.zhRange;

    // 发现榜:随机 100 个最近更新的项目(单请求 + 客户端洗牌)
    if (trendingPeriod === 'discover') {
      return {
        language: trendingLanguage,
        query: languageQuery + ' in:name,description fork:false archived:false pushed:>=' + dateAgo(7) + ' stars:>10',
        sort: 'updated',
        badge: (isEnglish ? 'English · ' : '中文 · ') + periodName + ' 随机刷新100个有趣项目',
        badgeTitle: isEnglish
          ? 'Random 100 recently updated projects. Refresh to reshuffle.'
          : '随机 100 个最近 7 天更新的项目 · 随机刷新100个',
        sub: isEnglish
          ? 'Recently updated · Refresh to reshuffle'
          : '发现项目 · 随机刷新100个',
        loading: isEnglish ? 'Loading discover projects…' : '正在获取发现榜项目…',
        refreshing: isEnglish ? 'Refreshing discover projects…' : '正在刷新发现榜项目…',
        empty: isEnglish ? 'No matching projects' : '暂无匹配项目'
      };
    }

    // 月榜/周榜:原有逻辑不变(按总 Star 排序)
    return {
      language: trendingLanguage,
      query: languageQuery + ' in:name,description fork:false archived:false created:>=' + dateAgo(period.days) + ' stars:>=' + period.minStars,
      sort: 'stars',
      badge: (isEnglish ? 'English · ' : '中文 · ') + periodName + ' Top 100',
      badgeTitle: isEnglish
        ? 'Approximate language detection using repository names and GitHub descriptions'
        : '根据仓库名称和 API 返回的仓库描述近似识别项目语言',
      sub: range + (isEnglish
        ? ' · English projects · Sorted by stars · Approximate detection'
        : ' · 中文项目 · 按总 Star 排序 · 近似识别'),
      loading: isEnglish ? 'Loading ' + periodName.toLowerCase() + ' projects…' : '正在获取' + periodName + '项目…',
      refreshing: isEnglish ? 'Refreshing ' + periodName.toLowerCase() + ' projects…' : '正在刷新' + periodName + '项目…',
      empty: isEnglish ? 'No matching projects in this period' : '该周期暂无匹配项目'
    };
  }

  function updateTrendingControls() {
    if (trendingSection) {
      trendingSection.setAttribute('aria-label', trendingText('近期热榜项目', 'Recent project rankings'));
    }
    if (rankingTitle) rankingTitle.textContent = trendingText('近期热榜项目', 'Recent Project Rankings');
    if (rankingPeriodEl) rankingPeriodEl.setAttribute('aria-label', trendingText('项目榜单周期', 'Ranking period'));
    rankingPeriodBtns.forEach(function (periodBtn) {
      var period = periodBtn.getAttribute('data-period');
      var selected = period === trendingPeriod;
      periodBtn.classList.toggle('is-active', selected);
      periodBtn.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (period === 'discover') periodBtn.textContent = trendingText('发现榜', 'Discover');
      else if (period === 'weekly') periodBtn.textContent = trendingText('周榜', 'Weekly');
      else if (period === 'monthly') periodBtn.textContent = trendingText('月榜', 'Monthly');
    });
    if (rankingLanguageEl) {
      rankingLanguageEl.setAttribute('aria-label', trendingText('项目语言', 'Project language'));
      rankingLanguageEl.title = trendingText(
        '首次打开时根据浏览器语言和系统时区自动选择，可手动切换',
        'Automatically selected from browser language and system time zone; you can switch manually'
      );
    }
    rankingLanguageBtns.forEach(function (languageBtn) {
      var language = languageBtn.getAttribute('data-language');
      var selected = language === trendingLanguage;
      languageBtn.classList.toggle('is-active', selected);
      languageBtn.setAttribute('aria-selected', selected ? 'true' : 'false');
      languageBtn.textContent = language === 'zh' ? '中文项目' : 'English projects';
    });
    var config = getTrendingConfig();
    if (trendingBadge) {
      // 仅发现榜显示徽章,月榜/周榜不显示(避免冗余信息)
      if (trendingPeriod === 'discover') {
        trendingBadge.textContent = config.badge;
        trendingBadge.title = config.badgeTitle;
        trendingBadge.style.display = '';
      } else {
        trendingBadge.style.display = 'none';
      }
    }
    if (trendingSub) trendingSub.textContent = config.sub;
    if (refreshTrendingBtn) {
      refreshTrendingBtn.title = trendingText('刷新当前榜单', 'Refresh current ranking');
      var refreshLabel = document.getElementById('refreshTrendingLabel');
      if (refreshLabel) refreshLabel.textContent = trendingText('刷新', 'Refresh');
    }
  }

  function useTrendingView(period, language) {
    var nextPeriod = period === 'weekly' || period === 'monthly' || period === 'discover' ? period : 'monthly';
    var nextLanguage = language === 'en' ? 'en' : 'zh';
    if (trendingPeriod === nextPeriod && trendingLanguage === nextLanguage) return;
    try { if (trendingController) trendingController.abort(); } catch (_) {}
    trendingPeriod = nextPeriod;
    trendingLanguage = nextLanguage;
    trendingPage = 1;
    trendingItems = [];
    trendingTotalPages = 1;
    trendingLoaded = false;
    trendingEl.innerHTML = '';
    trendingPagerEl.innerHTML = '';
    updateTrendingControls();
    loadTrending(false);
  }

  function filterTrendingItems(items, language) {
    return items.filter(function (repo) {
      if (!repo || typeof repo !== 'object') return false;
      var topics = Array.isArray(repo.topics) ? repo.topics.join(' ') : '';
      var text = [repo.name, repo.full_name, repo.description, topics].filter(Boolean).join(' ');
      var hasChinese = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
      if (language === 'zh') return hasChinese;
      return !hasChinese && /[A-Za-z]/.test(text);
    }).slice(0, 100);
  }

  function loadTrending(force) {
    var config = getTrendingConfig();
    var requestKey = getTrendingViewKey();
    updateTrendingControls();

    if (!force && Object.prototype.hasOwnProperty.call(trendingViewCache, requestKey)) {
      trendingItems = trendingViewCache[requestKey];
      trendingTotalPages = Math.max(1, Math.ceil(trendingItems.length / trendingPerPage));
      trendingPage = Math.min(trendingPage, trendingTotalPages);
      trendingLoaded = true;
      trendingStatusEl.style.display = trendingItems.length ? 'none' : '';
      trendingStatusEl.className = 'status';
      trendingStatusEl.textContent = trendingItems.length ? '' : config.empty;
      trendingSection.setAttribute('aria-busy', 'false');
      renderTrendingPage();
      stopRefreshSpin();
      return;
    }

    // 强制刷新保留当前卡片但降低透明度,提供视觉反馈且不造成布局抖动;
    // 切换榜单时清空旧卡片并显示加载状态。
    if (force && trendingLoaded && trendingItems.length) {
      trendingEl.style.opacity = '0.4';
      trendingEl.style.transition = 'opacity .3s';
    } else {
      trendingLoaded = false;
      trendingStatusEl.className = 'status';
      trendingStatusEl.textContent = config.loading;
      trendingStatusEl.style.display = '';
      trendingEl.innerHTML = '';
      trendingPagerEl.innerHTML = '';
    }
    trendingSection.setAttribute('aria-busy', 'true');

    // 中断上一次未完成请求:防止切换或刷新产生并发与旧响应覆盖。
    try { if (trendingController) trendingController.abort(); } catch (_) {}
    trendingController = new AbortController();
    var controller = trendingController;

    // 统一单请求:发现榜/月榜/周榜都用单次 API 请求
    // 发现榜用 sort=updated 取最近更新项目,月榜/周榜用 sort=stars 按热度排序
    var sortParam = config.sort || 'stars';
    var url = API_BASE + '/search/repositories?q=' + encodeURIComponent(config.query) + '&sort=' + encodeURIComponent(sortParam) + '&order=desc&per_page=100';
    fetch(url, buildFetchOptions(url, controller.signal, false))
      .then(function (res) {
        if (res.status === 403) {
          var ra = res.headers.get('Retry-After');
          var raSec = ra ? parseInt(String(ra).replace(/[^\d]/g,''), 10) : NaN;
          raSec = (raSec >= 0 && raSec <= 86400) ? raSec : NaN;
          throw new Error('请求过于频繁(速率限制 10 次/分钟)' + (isNaN(raSec) ? ',请稍后再试' : ',请 ' + raSec + ' 秒后重试'));
        }
        if (!res.ok) throw new Error('请求失败:HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (requestKey !== getTrendingViewKey() || controller !== trendingController) return;
        var items = filterTrendingItems(Array.isArray(data && data.items) ? data.items : [], config.language);
        // 发现榜:客户端随机打乱顺序,让更多项目有机会被看到
        // 月榜/周榜保持按 Star 排序,不洗牌
        if (trendingPeriod === 'discover' && items.length > 1) {
          items = shuffleArray(items);
        }
        trendingViewCache[requestKey] = items;
        trendingItems = items;
        trendingTotalPages = Math.max(1, Math.ceil(items.length / trendingPerPage));
        if (trendingPage > trendingTotalPages) trendingPage = 1;
        trendingLoaded = true;
        trendingSection.setAttribute('aria-busy', 'false');
        renderTrendingPage();
        if (force) {
          // force 模式:不立即恢复 opacity/停止 spinning,等达到最小动画时长后统一处理,
          // 保证用户能看到"刷新中"反馈(避免请求过快导致反馈一闪而过)
          var elapsed = performance.now() - _refreshStartTime;
          var remaining = Math.max(0, _minSpinDuration - elapsed);
          setTimeout(function () {
            if (requestKey !== getTrendingViewKey() || controller !== trendingController) return;
            trendingEl.style.opacity = '1';
            stopRefreshSpin();
            _refreshing = false;
            if (refreshTrendingBtn) refreshTrendingBtn.classList.remove('is-refreshing');
            if (_refreshSpinTimer) { clearTimeout(_refreshSpinTimer); _refreshSpinTimer = null; }
            // 不显示"已刷新"提示,避免布局跳动;仅在无数据时显示提示
            if (!items.length) {
              trendingStatusEl.className = 'status';
              trendingStatusEl.style.display = '';
              trendingStatusEl.textContent = config.empty;
            }
          }, remaining);
        } else {
          // 非 force 模式:走原本逻辑(初始化加载、切换榜单等)
          trendingStatusEl.className = 'status';
          trendingStatusEl.style.display = items.length ? 'none' : '';
          trendingStatusEl.textContent = items.length ? '' : config.empty;
        }
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return;
        if (requestKey !== getTrendingViewKey() || controller !== trendingController) return;
        stopRefreshSpin();
        trendingEl.style.opacity = '1';  // 恢复透明度
        _refreshing = false;
        if (refreshTrendingBtn) refreshTrendingBtn.classList.remove('is-refreshing');
        if (_refreshSpinTimer) { clearTimeout(_refreshSpinTimer); _refreshSpinTimer = null; }
        trendingSection.setAttribute('aria-busy', 'false');
        if (!trendingLoaded) {
          trendingStatusEl.className = 'status error';
          // 安全:远端响应头/状态消息可能被伪造,这里统一用 textContent 写入,不进入 innerHTML
          trendingStatusEl.textContent = (e && e.message) ? String(e.message) : '获取仓库榜单出错';
          trendingStatusEl.style.display = '';
        } else {
          // 强制刷新失败时,短暂显示错误提示后自动隐藏(不替换已有卡片)
          trendingStatusEl.className = 'status error';
          trendingStatusEl.textContent = (e && e.message) ? String(e.message) : '刷新失败,请稍后重试';
          trendingStatusEl.style.display = '';
          if (_statusHideTimer) clearTimeout(_statusHideTimer);
          _statusHideTimer = setTimeout(function () {
            trendingStatusEl.style.display = 'none';
          }, 3000);
        }
      });
  }
  function showTrending(show) {
    trendingSection.style.display = show ? '' : 'none';
    resultsSection.style.display = show ? 'none' : '';
  }

  /* ---------- 热榜刷新按钮 ---------- */
  var refreshTrendingBtn = document.getElementById('refreshTrending');
  var refreshTrendingIcon = document.getElementById('refreshTrendingIcon');
  var _refreshSpinTimer = null;
  var _statusHideTimer = null;  // "已刷新"提示的隐藏定时器(与旋转定时器分离,避免互相覆盖)
  var _refreshing = false;  // 防抖:防止短时间内重复点击导致请求被 abort
  function startRefreshSpin() {
    if (!refreshTrendingIcon) return;
    refreshTrendingIcon.classList.add('spinning');
  }
  function stopRefreshSpin() {
    if (!refreshTrendingIcon) return;
    refreshTrendingIcon.classList.remove('spinning');
  }
  var _refreshStartTime = 0;
  // spinning 至少持续时长(毫秒),保证用户能看到刷新动画
  var _minSpinDuration = 700;
  function forceRefreshTrending() {
    if (_refreshing) return;
    _refreshing = true;
    _refreshStartTime = performance.now();
    var key = getTrendingViewKey();
    delete trendingViewCache[key];
    startRefreshSpin();
    // 按钮添加 is-refreshing class,提供明显的"刷新中"视觉反馈
    if (refreshTrendingBtn) refreshTrendingBtn.classList.add('is-refreshing');
    // 不显示 statusEl 文字,避免布局跳动;仅用 spinning + opacity + 按钮高亮提供视觉反馈
    loadTrending(true);
    // 兜底定时器:5 秒后若仍在刷新,强制停止(防止网络异常导致一直 spinning)
    if (_refreshSpinTimer) clearTimeout(_refreshSpinTimer);
    _refreshSpinTimer = setTimeout(function () {
      if (!_refreshing) return;
      stopRefreshSpin();
      _refreshing = false;
      if (refreshTrendingBtn) refreshTrendingBtn.classList.remove('is-refreshing');
      if (trendingEl) trendingEl.style.opacity = '1';
    }, 5000);
  }
  rankingPeriodBtns.forEach(function (periodBtn) {
    periodBtn.addEventListener('click', function () {
      useTrendingView(periodBtn.getAttribute('data-period') || 'monthly', trendingLanguage);
    });
  });
  rankingLanguageBtns.forEach(function (languageBtn) {
    languageBtn.addEventListener('click', function () {
      useTrendingView(trendingPeriod, languageBtn.getAttribute('data-language') || 'zh');
    });
  });
  if (refreshTrendingBtn) {
    refreshTrendingBtn.addEventListener('mouseenter', function () { this.style.color = 'var(--accent-fg)'; this.style.borderColor = 'var(--accent-fg)'; });
    refreshTrendingBtn.addEventListener('mouseleave', function () { this.style.color = ''; this.style.borderColor = ''; });
  }
  // 使用事件委托绑定刷新按钮的 click,避免 DOM 变化导致监听器丢失
  document.addEventListener('click', function (e) {
    var target = e.target.closest ? e.target.closest('#refreshTrending') : null;
    if (target && !target.disabled) {
      // 阻止按钮点击导致默认滚动跳动
      e.preventDefault();
      forceRefreshTrending();
    }
  });

  /* ---------- 搜索 ---------- */
  // 已知 qualifier key(用于"用户手写 qualifier 检测")
  var QUAL_KEYS = ['in','language','stars','pushed','created','topic','license','org','user','repo'
    ,'fork','archived','is','followers','size','has','good-first-issues','help-wanted-issues','template','mirror'];
  function containsAnyQual(q) {
    // 粗略检测 q 里是否有任何 "key:" 格式 qualifier(用户手写)
    for (var i=0;i<QUAL_KEYS.length;i++) {
      if (new RegExp('(^|\\s)'+QUAL_KEYS[i]+':','i').test(q)) return true;
    }
    return false;
  }
  function hasCJKChars(s) { return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(s || ''); }

  // -------------------------
  // 客户端二次精排 (🧠 本地重排)
  // 打分规则:
  //   A. 命中位置(大头):full_name 完全相等 >> name 完整命中 token >> name 部分命中 >> description 命中 >> topics 命中
  //   B. 多词覆盖率:每个 token 独立命中给分,缺词扣分
  //   C. 中文关键词 + 仓库含中文:额外加分(减少国内搜中文出来的纯英文仓库)
  //   D. star 密度修正:log10(stars+1) / (years_old + 0.5),避免老仓库躺赢
  //   E. 轻微保留原序稳定(位置分相同时,原 GitHub 顺序 idx 越小越前)
  // -------------------------
  function tokenizeFreeText(raw) {
    // 提取纯 free-text:剥掉 qualifier key:value、引号、括号、空白
    if (!raw) return [];
    var s = String(raw).replace(/"[^"]*"/g,' ');
    s = s.replace(/(?:^|\s)([a-z][a-z0-9_-]*):\S+/gi, ' '); // 去掉 qualifier
    var tokens = [];
    // 中英文混分词:英文按空白/标点切,CJK 按字符单独成 token(也保留连续 CJK 词组)
    var re = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+|[a-zA-Z0-9_.-]+/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var tok = m[0].toLowerCase();
      if (tok.length === 0) continue;
      // CJK 长串:同时保留整体 + 单字(提升单字子匹配能力但权重不高,靠重复词频)
      if (hasCJKChars(tok)) {
        if (tok.length >= 2) tokens.push(tok); // 整段中文词优先
        // 不推单字,噪声太大
      } else {
        tokens.push(tok);
        // 英文词常见的点/下划线分隔再拆一次(如 vue-element-admin → 保留原词 + 各片段)
        var parts = tok.split(/[._-]+/).filter(function (x) { return x.length >= 2; });
        if (parts.length > 1) parts.forEach(function (p) { tokens.push(p.toLowerCase()); });
      }
    }
    // 去重但保留数量(用 Map 记录词频)
    var freq = Object.create(null);
    tokens.forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });
    var unique = [];
    for (var k in freq) if (Object.prototype.hasOwnProperty.call(freq,k)) unique.push({ t:k, f:freq[k] });
    return unique;
  }

  function countSubstr(haystack, needle) {
    if (!haystack || !needle) return 0;
    var h = String(haystack).toLowerCase();
    var n = String(needle).toLowerCase();
    if (n.length > h.length) return 0;
    var c = 0, idx = 0;
    while ((idx = h.indexOf(n, idx)) !== -1) { c++; idx += n.length; }
    return c;
  }

  function rerankItems(items, rawQuery) {
    if (!items || !items.length) return items;
    // 用户纯 qualifier 搜索(没有自由文本) → 不重排,避免 qualifier 语义下的主观打乱
    var tokens = tokenizeFreeText(rawQuery);
    if (tokens.length === 0) return items;
    var queryHasCJK = hasCJKChars(rawQuery);

    // 先把每个仓库的常用字段转小写一次性缓存,减少重复 O(N)
    var prepared = items.map(function (repo, idx) {
      var owner = (repo.owner && repo.owner.login) || '';
      var name = String(repo.name || '').toLowerCase();
      var fullName = String(repo.full_name || (owner + '/' + repo.name)).toLowerCase();
      var desc = String(repo.description || '').toLowerCase();
      var topics = (repo.topics || []).map(function (x) { return String(x).toLowerCase(); });
      var stars = Math.max(0, parseInt(repo.stargazers_count,10) || 0);
      var created = repo.created_at ? new Date(repo.created_at).getTime() : Date.now();
      // 更新时间:GitHub Search API 返回 pushed_at 表示仓库最近推送时间。
      // 缺失时退化为 0,排序时自然落到最后(避免 NaN 干扰)。
      var pushed = repo.pushed_at ? new Date(repo.pushed_at).getTime() : 0;
      var now = Date.now();
      var yearsOld = Math.max(0.1, (now - created) / 31536000000);
      var starDensity = Math.log10(stars + 1) / (yearsOld + 0.5);
      var textHasCJK = hasCJKChars(desc) || hasCJKChars(repo.name) || hasCJKChars(repo.description);
      return { repo:repo, idx:idx, owner:owner, name:name, fullName:fullName, desc:desc, topics:topics,
        stars:stars, starDensity:starDensity, textHasCJK:textHasCJK, pushed:pushed };
    });

    prepared.forEach(function (r) {
      var score = 0;
      var covered = 0;
      tokens.forEach(function (tok) {
        var tf = tok.f || 1;
        var t = tok.t;
        var tLen = t.length;
        var scoreTok = 0;

        // A. 命中位置
        if (r.fullName === t) scoreTok += 120 * tf;                           // full_name 完全相等
        else if (r.name === t) scoreTok += 90 * tf;                           // name 完全相等
        else {
          var nameHits = countSubstr(r.name, t);
          if (nameHits > 0) scoreTok += 55 * tf * Math.min(2, nameHits);      // name 子串命中
          var ownerHits = countSubstr(r.owner.toLowerCase(), t);
          if (ownerHits > 0) scoreTok += 18 * tf * Math.min(2, ownerHits);    // owner 命中(轻量)
        }
        var descHits = countSubstr(r.desc, t);
        if (descHits > 0) {
          // CJK 描述命中加分稍高(中文描述命中很有意义)
          var weight = (tLen >= 2 && hasCJKChars(t)) ? 1.4 : 1.0;
          scoreTok += 20 * tf * Math.min(2.5, descHits) * weight;            // description 命中
        }
        var topicCount = 0;
        r.topics.forEach(function (top) {
          if (top === t) topicCount += 2;
          else if (countSubstr(top, t) > 0) topicCount += 1;
        });
        if (topicCount > 0) scoreTok += 14 * tf * Math.min(2, topicCount);

        if (scoreTok > 0) covered++;
        score += scoreTok;
      });

      // B. 覆盖率:全部命中 → 大加分;覆盖率越低扣分越重
      var total = tokens.length;
      if (total > 1) {
        var ratio = covered / total;
        score *= (0.5 + 0.5 * ratio * ratio);
        if (covered === total) score += 30;       // 全部命中额外奖励
        else if (covered === 0) score -= 200;     // 一个都没命中(qualifier 命中但内容无关)→ 打下去
      }

      // C. 中文关键词 + 仓库有中文 → 额外奖励
      if (queryHasCJK && r.textHasCJK) score += 12;

      // D. star 密度修正(不要超过位置分数的影响,因此取 Math.log 压缩)
      score += Math.min(25, r.starDensity * 1.8);

      // E. 稳定性:在最末尾保留非常轻量的原序优势,防止同分随意跳位
      score -= r.idx * 0.0001;

      r._score = score;
    });

    // 排序规则(按重要性递减):
    //   1. 更新日期(pushed_at)降序 → 最近更新排前(用户指定排序维度)
    //   2. 相关性得分降序 → 同更新时间下,更匹配的靠前
    //   3. 原索引升序 → 稳定排序,避免同分乱跳
    prepared.sort(function (a, b) {
      if (a.pushed !== b.pushed) return b.pushed - a.pushed;
      if (b._score !== a._score) return b._score - a._score;
      return a.idx - b.idx;
    });
    return prepared.map(function (x) { return x.repo; });
  }

  function buildQuery() {
    var parts = [];
    var raw = input.value.trim();
    if (!raw && !langSel.value && !starsSel.value && !pushedSel.value) return '';

    var q_lower = raw.toLowerCase();
    var userWroteQual = containsAnyQual(raw);
    var inMode = inFieldSel ? inFieldSel.value : 'auto';

    // 1) 关键词处理:若用户没写 qualifier → 把纯 free-text 关键词提取出来
    //    若包含 CJK 或多个英文词 → 拆出 token 后做 "精确片段 OR 分散匹配" 的双路提升精准度
    var freePart = '';
    if (raw) {
      if (userWroteQual) {
        // 用户手写了 qualifier,整个交给 GitHub 原样处理
        freePart = raw;
      } else {
        // 纯自由文本查询 → 加双引号片段提升"整词/整句"权重(GitHub best-match 会加分)
        var tokens = raw.trim().split(/\s+/).filter(Boolean);
        if (tokens.length >= 2) {
          // 多词:先放原串片段,再放每个独立词,兼顾"都包含"和"精准顺序"
          // 示例:"状态管理" react →  '"状态管理 react" 状态 管理 react'
          var phrase = '"' + raw.replace(/"/g,'') + '"';
          freePart = phrase + ' ' + raw;
        } else {
          freePart = raw;
        }
        // 纯 CJK 查询 → 在 best-match 时再加 in:name,description,topics 避免 README 噪音
        // 但仅当用户未手动指定 inMode=包含 README 时
        if (inMode === 'auto' && hasCJKChars(raw)) {
          parts.push('in:name,description,topics');
        }
      }
      parts.unshift(freePart); // 关键词放最前
    }

    // 2) in: 字段限定(显式选择,或 auto 无 CJK 时不强加)
    if (inMode !== 'auto' && !new RegExp('(^|\\s)in:','i').test(q_lower)) {
      parts.push('in:' + inMode);
    }

    // 3) 下拉过滤器(用户手写过同类 qualifier 的不再叠加)
    function hasQual(k) { return new RegExp('(^|\\s)'+k+':','i').test(q_lower); }

    if (langSel.value && !hasQual('language')) parts.push('language:' + langSel.value);
    if (starsSel.value && !hasQual('stars')) parts.push('stars:>' + starsSel.value);
    if (pushedSel.value && !hasQual('pushed')) {
      var days = { week:7, month:30, quarter:90, halfyear:180, year:365 }[pushedSel.value];
      parts.push('pushed:>' + dateAgo(days));
    }
    return parts.join(' ');
  }
  function buildSortParam() {
    var v = sortSel.value;
    if (v === 'best-match') return '';
    return '&sort=' + v + '&order=desc';
  }

  function safeDecodeURIComponent(s) {
    try { return decodeURIComponent(s); } catch (_) { return s; }
  }
  function readFiltersFromHash() {
    var h = location.hash.slice(1);
    if (!h) return null;
    var p = Object.create(null);
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > -1) p[safeDecodeURIComponent(kv.slice(0,i))] = safeDecodeURIComponent(kv.slice(i+1));
    });
    return p;
  }
  function writeHash() {
    var parts = [];
    if (input.value.trim()) parts.push('q=' + encodeURIComponent(input.value.trim()));
    if (sortSel.value !== 'best-match') parts.push('sort=' + sortSel.value);
    if (langSel.value) parts.push('lang=' + encodeURIComponent(langSel.value));
    if (starsSel.value) parts.push('stars=' + starsSel.value);
    if (pushedSel.value) parts.push('pushed=' + pushedSel.value);
    if (inFieldSel && inFieldSel.value !== 'auto') parts.push('in=' + inFieldSel.value);
    if (rerankCb && rerankCb.checked) parts.push('rr=1');
    if (page > 1) parts.push('p=' + page);
    var newHash = parts.join('&');
    if (newHash === location.hash.slice(1)) return;
    ignoreHash = true;
    if (newHash) location.hash = newHash; else history.replaceState(null,'', location.pathname + location.search);
    setTimeout(function () { ignoreHash = false; }, 50);
  }
  function applyHashToForm() {
    var p = readFiltersFromHash();
    if (!p) return false;
    // 注意:p 中的值已被 readFiltersFromHash → safeDecodeURIComponent 解码一次,
    // 这里不能再二次 decodeURIComponent,否则会出现双重解码导致 %2520 等被还原成空格
    input.value = p.q || '';
    sortSel.value = p.sort || 'best-match';
    langSel.value = p.lang || '';
    starsSel.value = p.stars || '';
    pushedSel.value = p.pushed || '';
    if (inFieldSel) inFieldSel.value = p.in || 'auto';
    if (rerankCb) rerankCb.checked = (p.rr === '1');
    page = p.p ? (parseInt(p.p,10) || 1) : 1;
    return true;
  }

  // 安全读取搜索历史:JSON.parse 仅接受字符串数组,过滤掉任何非字符串项
  // (防 localStorage 被外部脚本/插件篡改为对象或包含 __proto__ 等危险属性)
  function readHistoryArray() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem('gh_search_history') || '[]'); } catch (e) { return []; }
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (x) { return typeof x === 'string'; }).slice(0, 50);
  }
  function writeHistoryArray(arr) {
    try { localStorage.setItem('gh_search_history', JSON.stringify(arr.slice(0, 8))); } catch (e) {}
  }
  function pushHistory(q) {
    if (!q) return;
    var arr = readHistoryArray().filter(function (x) { return x !== q; });
    arr.unshift(q); arr = arr.slice(0, 8);
    writeHistoryArray(arr);
    renderHistory();
  }
  function removeHistory(q, ev) {
    if (ev) ev.stopPropagation();
    var arr = readHistoryArray().filter(function (x) { return x !== q; });
    writeHistoryArray(arr);
    renderHistory();
  }
  function renderHistory() {
    var arr = readHistoryArray();
    historyEl.innerHTML = '';
    if (clearHistoryBtn) clearHistoryBtn.hidden = !arr.length;
    if (!arr.length) return;
    var label = document.createElement('span');
    label.className = 'history-label'; label.textContent = '最近搜索:';
    historyEl.appendChild(label);
    arr.forEach(function (q) {
      var c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = escapeHtml(q) + '<span class="x" title="删除">×</span>';
      c.addEventListener('click', function () { input.value = q; page = 1; doSearch(); });
      c.querySelector('.x').addEventListener('click', function (ev) { removeHistory(q, ev); });
      historyEl.appendChild(c);
    });
  }

  var searchCache = Object.create(null);
  var SEARCH_CACHE_MAX = 40; // LRU-like 上限:防止无限不同 query 把内存吃爆
  function cacheGet(key) {
    var v = searchCache[key];
    if (v == null) return undefined;
    // 命中即刷新"更新时序",简单用新增删实现 LRU
    delete searchCache[key];
    searchCache[key] = v;
    return v;
  }
  function cachePut(key, value) {
    if (value == null) return;
    if (Object.prototype.hasOwnProperty.call(searchCache, key)) delete searchCache[key];
    searchCache[key] = value;
    var keys = Object.keys(searchCache);
    if (keys.length <= SEARCH_CACHE_MAX) return;
    // 超上限:一次性清掉最早的 1/4(避免每次 put 都删)
    var drop = keys.slice(0, Math.max(1, Math.ceil(SEARCH_CACHE_MAX / 4)));
    for (var i = 0; i < drop.length; i++) delete searchCache[drop[i]];
  }
  function doSearch() {
    var query = buildQuery();
    if (!query) { input.focus(); return; }
    currentQ = query;
    if (loading && currentController) currentController.abort();
    loading = true;
    btn.disabled = true;
    showTrending(false);
    statusEl.style.display = '';
    statusEl.className = 'status';
    statusEl.textContent = page === 1 ? '搜索中…' : '加载中…';
    resultsHeader.textContent = '';
    pagerEl.innerHTML = '';
    if (page === 1) resultsEl.innerHTML = '';

    // 命中缓存直接渲染(翻页/回退不重复请求,节省配额、提速)
    var cacheKey = query + '|' + page + '|' + sortSel.value;
    var cached = cacheGet(cacheKey);
    if (cached) {
      renderSearchResults(cached, query);
      loading = false; btn.disabled = false;
      return;
    }

    currentController = new AbortController();
    var url = API_BASE + '/search/repositories?q=' + encodeURIComponent(query) +
      buildSortParam() + '&per_page=20&page=' + page;

    fetch(url, buildFetchOptions(url, currentController.signal, true))
      .then(function (res) {
        if (res.status === 403) {
          var ra = res.headers.get('Retry-After');
          // Retry-After 来自远端响应头,可能被恶意代理伪造数字以外字符;强制转数字+范围裁剪,避免拼接到 DOM 后被注入
          var raSec = ra ? parseInt(String(ra).replace(/[^\d]/g,''), 10) : NaN;
          raSec = (raSec >= 0 && raSec <= 86400) ? raSec : NaN;
          throw new Error('请求过于频繁(速率限制 10 次/分钟)' + (isNaN(raSec) ? ',请稍后再试' : ',请 ' + raSec + ' 秒后重试'));
        }
        if (res.status === 422) throw new Error('搜索语法错误,请检查关键词或筛选(如 stars:>1000 language:go topic:cli)');
        if (!res.ok) throw new Error('请求失败:HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        cachePut(cacheKey, data);
        renderSearchResults(data, query);
      })
      .catch(function (e) {
        if (e.name === 'AbortError') return;
        statusEl.className = 'status error';
        // 高危修复:e.message 可能受代理/响应头影响,错误文本一律 escapeHtml 后再拼静态 HTML,避免注入
        var safeMsg = escapeHtml((e && e.message) ? String(e.message) : '搜索出错');
        statusEl.innerHTML = safeMsg + '<br><button class="retry" id="retry">重试</button>';
        var rb = document.getElementById('retry');
        if (rb) rb.addEventListener('click', function () { doSearch(); });
        pagerEl.innerHTML = '';
      })
      .then(function () { loading = false; btn.disabled = false; });
  }

  function renderSearchResults(data, query) {
    var raw = input.value.trim();
    var enabled = !!(rerankCb && rerankCb.checked);
    var items = Array.isArray(data && data.items)
      ? data.items.filter(function (repo) { return repo && typeof repo === 'object'; })
      : [];
    if (enabled && items.length) {
      try { items = rerankItems(items, raw); } catch (e) {}
    }
    var parsedTotal = Number(data && data.total_count);
    totalCount = Number.isFinite(parsedTotal) && parsedTotal > 0 ? Math.floor(parsedTotal) : 0;
    totalPages = Math.min(50, Math.max(1, Math.ceil(totalCount / 20)));
    if (page > totalPages) page = totalPages;
    var incomplete = !!(data && data.incomplete_results);
    var incTip = incomplete
      ? ' · <span style="color:var(--attention-fg)" title="GitHub 超时,只返回了部分结果,建议缩小关键词或加筛选条件">⚠ 结果可能不完整</span>'
      : '';
    if (!items.length && page === 1) {
      resultsEl.innerHTML = '';
      statusEl.style.display = '';
      statusEl.innerHTML = '没有找到匹配 <b style="color:var(--fg-default)">' + escapeHtml(query) + '</b> 的仓库。'
        + '<br><button class="retry" id="retry">重试</button> · 试试去掉部分筛选条件';
      var rb = document.getElementById('retry');
      if (rb) rb.addEventListener('click', function () { page = 1; doSearch(); });
      resultsHeader.innerHTML = '0 个结果' + incTip;
    } else if (!items.length) {
      statusEl.style.display = '';
      statusEl.className = 'status';
      statusEl.innerHTML = '该页暂无数据,请返回上一页或重新搜索。';
      resultsEl.innerHTML = '';
      resultsHeader.innerHTML = '共 <b>' + formatNumber(totalCount) + '</b> 个仓库 · 第 <b>' + page + '</b>/' + totalPages + ' 页' + incTip;
      renderPager();
    } else {
      statusEl.style.display = 'none';
      resultsEl.innerHTML = '';
      renderResults(items, raw);
      var tag = enabled ? ' · <span style="color:var(--accent-fg)">🧠 已本地精排</span>' : '';
      resultsHeader.innerHTML = '共 <b>' + formatNumber(totalCount) + '</b> 个仓库 · 第 <b>' + page + '</b>/' + totalPages + ' 页 · 本页 ' + items.length + ' 个' + tag + incTip;
      renderPager();
    }
    if (page === 1) pushHistory(input.value.trim());
    writeHash();
  }

  function renderPager() {
    pagerEl.innerHTML = '';
    if (totalPages <= 1) {
      var info0 = document.createElement('span');
      info0.className = 'info';
      info0.textContent = '第 1 页 · 共 ' + totalCount + ' 个';
      pagerEl.appendChild(info0);
      return;
    }
    var prev = document.createElement('button');
    prev.textContent = '上一页';
    prev.disabled = page <= 1;
    prev.addEventListener('click', function () { page--; doSearch(); scrollTop(resultsSection); });
    pagerEl.appendChild(prev);

    function mkBtn(p) {
      var b = document.createElement('button');
      b.textContent = String(p);
      if (p === page) b.classList.add('active');
      b.addEventListener('click', function () { page = p; doSearch(); scrollTop(resultsSection); });
      return b;
    }
    function mkEllipsis() { var e = document.createElement('span'); e.className = 'ellipsis'; e.textContent = '…'; return e; }

    // 页码按钮:始终显示 1,当前页前后 2 个,末页
    var pages = [1];
    var from = Math.max(2, page - 2);
    var to = Math.min(totalPages - 1, page + 2);
    if (from > 2) pages.push(-1); // 省略
    for (var p = from; p <= to; p++) pages.push(p);
    if (to < totalPages - 1) pages.push(-1);
    if (totalPages > 1) pages.push(totalPages);
    pages.forEach(function (p) {
      pagerEl.appendChild(p === -1 ? mkEllipsis() : mkBtn(p));
    });

    var next = document.createElement('button');
    next.textContent = '下一页';
    next.disabled = page >= totalPages;
    next.addEventListener('click', function () { page++; doSearch(); scrollTop(resultsSection); });
    pagerEl.appendChild(next);

    var info = document.createElement('span');
    info.className = 'info';
    info.textContent = page + '/' + totalPages + ' 页';
    pagerEl.appendChild(info);
  }

  function renderResults(items, rawQuery) {
    var frag = document.createDocumentFragment();
    items.forEach(function (repo) {
      var owner = (repo.owner && repo.owner.login) || '';
      var el = document.createElement('div');
      el.className = 'repo clickable';
      el.setAttribute('data-href', safeGitHubRepoUrl(repo.html_url));
      var topicItems = Array.isArray(repo.topics) ? repo.topics : [];
      var topics = topicItems.slice(0, 6).map(function (t) {
        return '<span class="topic" data-topic="' + escapeHtml(t) + '">' + highlightText(t, repo, rawQuery) + '</span>';
      }).join('');
      var homepage = '';
      if (repo.homepage) {
        var h = String(repo.homepage);
        var isTg = /^https?:\/\/(t\.me|telegram\.me)\//i.test(h);
        homepage = '<a class="home" href="' + escapeHtml(safeUrl(h)) + '" target="_blank" rel="noopener noreferrer" title="' + (isTg ? 'Telegram' : '主页') + '">' + (isTg ? '✈️ Telegram' : '🌐 主页') + '</a>';
      }
      var lang = repo.language
        ? '<span class="lang"><span class="lang-dot" style="background:' + langColor(repo.language) + '"></span>' + escapeHtml(repo.language) + '</span>' : '';
      var safeAv = repo.owner && repo.owner.avatar_url ? safeAvatar(repo.owner.avatar_url) : '';
      var avatar = safeAv
        ? '<img class="avatar" src="' + escapeHtml(safeAv) + '" alt="" loading="lazy" width="28" height="28">'
        : '';
      var fullNameHtml =
            '<a class="full-name" href="' + escapeHtml(safeGitHubRepoUrl(repo.html_url)) + '" target="_blank" rel="noopener noreferrer">' +
              '<span class="owner">' + highlightText(owner, repo, rawQuery) + '</span> / ' + highlightText(repo.name, repo, rawQuery) +
            '</a>';
      var descHtml = repo.description
        ? '<div class="repo-desc">' + highlightText(repo.description, repo, rawQuery) + '</div>'
        : '';
      var badges = repoBadges(repo);
      var quickLinks = repoQuickLinks(repo);
      el.innerHTML =
        '<div class="repo-head">' +
          avatar +
          '<div class="head-main">' +
            fullNameHtml +
            badges +
          '</div>' +
          quickLinks +
        '</div>' +
        descHtml +
        (topics ? '<div class="repo-topics">' + topics + '</div>' : '') +
        '<div class="repo-meta">' +
          '<span>★ ' + formatNumber(repo.stargazers_count) + '</span>' +
          '<span>⑂ ' + formatNumber(repo.forks_count) + '</span>' +
          '<span>👁 ' + formatNumber(repo.watchers_count) + '</span>' +
          '<span>⚠ ' + formatNumber(repo.open_issues_count) + '</span>' + lang +
          '<span title="' + escapeHtml(repo.created_at) + '">创建 ' + timeAgo(repo.created_at) + '</span>' +
          '<span title="' + escapeHtml(repo.updated_at) + '">更新 ' + timeAgo(repo.updated_at) + '</span>' +
          homepage +
        '</div>';
      frag.appendChild(el);
    });
    resultsEl.appendChild(frag);
    resultsEl.querySelectorAll('.topic').forEach(function (t) {
      t.addEventListener('click', function () {
        input.value = 'topic:' + t.getAttribute('data-topic');
        page = 1;
        doSearch();
      });
    });
  }

  /* ---------- 事件 ---------- */

  btn.addEventListener('click', function () { page = 1; doSearch(); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); page = 1; doSearch(); } });
  [sortSel, langSel, starsSel, pushedSel].concat(inFieldSel ? [inFieldSel] : []).forEach(function (sel) {
    sel.addEventListener('change', function () { if (currentQ || input.value.trim()) { page = 1; doSearch(); } });
  });
  // 🧠 精排开关:切换立即生效(命中缓存 → 0 新请求,秒开)
  if (rerankCb) {
    rerankCb.addEventListener('change', function () {
      if (currentQ) { page = page || 1; doSearch(); }
      else writeHash();
    });
    // 切换精排视觉反馈:选中时切换为「按下」状态(由 CSS .is-active 接管样式)
    var toggleLabel = document.getElementById('rerankToggle');
    if (toggleLabel) {
      var syncLabel = function () {
        if (rerankCb.checked) toggleLabel.classList.add('is-active');
        else toggleLabel.classList.remove('is-active');
      };
      rerankCb.addEventListener('change', syncLabel);
      syncLabel();
    }
  }

  // ---------- 清除历史 ----------
  function clearAllHistory() {
    try { localStorage.removeItem('gh_search_history'); } catch (e) {}
    renderHistory();
  }
  var clearHistoryBtn = document.getElementById('clearHistory');
  if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearAllHistory);

  // ---------- 设置面板(仅代理/加速节点) ----------
  var settingsMask = document.getElementById('settingsMask');
  var settingsPanel = document.getElementById('settingsPanel');
  var openSettingsBtn = document.getElementById('openSettings');
  var closeSettingsBtn = document.getElementById('closeSettings');
  var cfgProxyInput = document.getElementById('cfgProxy');
  var cfgSaveBtn = document.getElementById('cfgSave');
  var cfgResetBtn = document.getElementById('cfgReset');
  var cfgClearHistoryBtn = document.getElementById('cfgClearHistory');
  var cfgMsgEl = document.getElementById('cfgMsg');
  var proxyPresetBtns = document.querySelectorAll('button.preset');
  var proxyCheckController = null;

  function setProxyMessage(color, message) {
    if (!cfgMsgEl) return;
    cfgMsgEl.style.color = color;
    cfgMsgEl.textContent = message;
  }

  function syncProxyPresetSelection() {
    var value = cfgProxyInput ? cfgProxyInput.value.trim().replace(/\/+$/, '') : '';
    proxyPresetBtns.forEach(function (btn) {
      var selected = (btn.getAttribute('data-url') || '').replace(/\/+$/, '') === value;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function setProxySettingsBusy(busy) {
    if (cfgSaveBtn) {
      cfgSaveBtn.disabled = busy;
      cfgSaveBtn.textContent = busy ? '正在检测…' : '检测并启用';
    }
    if (cfgProxyInput) cfgProxyInput.disabled = busy;
    proxyPresetBtns.forEach(function (btn) { btn.disabled = busy; });
  }

  function cancelProxyCheck() {
    if (proxyCheckController) {
      try { proxyCheckController.abort(); } catch (_) {}
      proxyCheckController = null;
    }
    setProxySettingsBusy(false);
  }

  function testProxyBase(base) {
    var controller = new AbortController();
    var timedOut = false;
    proxyCheckController = controller;
    var timeoutId = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, 10000);
    var testUrl = base + '/search/repositories?q=' +
      encodeURIComponent('octocat in:name') + '&per_page=1';

    return fetch(testUrl, buildFetchOptions(testUrl, controller.signal, false))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var contentType = String(res.headers.get('Content-Type') || '').toLowerCase();
        if (contentType.indexOf('application/json') === -1) {
          throw new Error('响应不是 GitHub JSON');
        }
        var remaining = res.headers.get('X-RateLimit-Remaining');
        return res.json().then(function (data) {
          if (!data || typeof data.total_count !== 'number' || !Array.isArray(data.items)) {
            throw new Error('返回数据不是 GitHub Search API 格式');
          }
          return { remaining: /^\d+$/.test(String(remaining || '')) ? remaining : '' };
        });
      })
      .then(function (result) {
        clearTimeout(timeoutId);
        if (proxyCheckController === controller) proxyCheckController = null;
        return result;
      }, function (err) {
        clearTimeout(timeoutId);
        if (proxyCheckController === controller) proxyCheckController = null;
        if (timedOut) throw new Error('连接超时(10 秒)');
        if (err && err.name === 'AbortError') throw new Error('检测已取消');
        if (err instanceof TypeError) throw new Error('网络不可达或浏览器 CORS 校验失败');
        throw err;
      });
  }

  // ---------- Personal Token 独立面板 ----------
  var tokenMask = document.getElementById('tokenMask');
  var tokenPanel = document.getElementById('tokenPanel');
  var tokenQuickBtn = document.getElementById('tokenQuickBtn');
  var rateLabelBtn = document.getElementById('rateLabelBtn');
  var rateHintEl = document.getElementById('rateHint');
  var closeTokenBtn = document.getElementById('closeToken');
  var tokenCloseBtn = document.getElementById('tokenCloseBtn');
  var tokenSaveBtn = document.getElementById('tokenSaveBtn');
  var tokenClearBtn = document.getElementById('tokenClearBtn');
  var tokenInputEl = document.getElementById('tokenInput');
  var tokenMsgEl = document.getElementById('tokenMsg');
  var tokenToggleTutBtn = document.getElementById('tokenToggleTutorial');
  var tokenTutorialBox = document.getElementById('tokenTutorialBox');
  if (tokenToggleTutBtn && tokenTutorialBox) {
    tokenToggleTutBtn.addEventListener('click', function () {
      var show = tokenTutorialBox.style.display === 'none';
      tokenTutorialBox.style.display = show ? 'block' : 'none';
      tokenToggleTutBtn.textContent = show ? '📖 收起教程' : '📖 如何获取 Token?';
    });
  }
  function openTokenPanel() {
    if (tokenInputEl) {
      tokenInputEl.value = '';
      tokenInputEl.setAttribute('placeholder', LOCAL_BEARER
        ? '当前会话已有 Token,重新输入可替换'
        : 'ghp_xxxxxxxxxxxxxxx 或 github_pat_xxxxxx');
    }
    if (tokenMsgEl) tokenMsgEl.textContent = '';
    if (tokenTutorialBox) tokenTutorialBox.style.display = 'none';
    if (tokenToggleTutBtn) tokenToggleTutBtn.textContent = '📖 如何获取 Token?';
    if (tokenMask) tokenMask.style.display = 'block';
    if (tokenPanel) tokenPanel.style.display = 'block';
  }
  function closeTokenPanel() {
    if (tokenInputEl) tokenInputEl.value = '';
    if (tokenMask) tokenMask.style.display = 'none';
    if (tokenPanel) tokenPanel.style.display = 'none';
  }
  function hideRateHint() {
    if (rateHintEl) rateHintEl.style.display = 'none';
  }
  function showRateHintIfApplicable() {
    // rateHintEl 只在 footer 存在时生效(目前 footer 已移除,保留兼容旧 DOM)
    var hasTk = !!LOCAL_BEARER;
    if (!rateHintEl) return;
    if (hasTk) { rateHintEl.style.display = 'none'; return; }
    var dismissed = false;
    try { dismissed = localStorage.getItem('gh_rate_hint_dismissed') === '1'; } catch(_) {}
    rateHintEl.style.display = dismissed ? 'none' : '';
  }
  if (tokenQuickBtn) tokenQuickBtn.addEventListener('click', function () {
    try { localStorage.setItem('gh_rate_hint_dismissed','1'); } catch(_) {}
    hideRateHint(); openTokenPanel();
  });
  if (rateLabelBtn) rateLabelBtn.addEventListener('click', function () {
    try { localStorage.setItem('gh_rate_hint_dismissed','1'); } catch(_) {}
    hideRateHint(); openTokenPanel();
  });
  if (closeTokenBtn) closeTokenBtn.addEventListener('click', closeTokenPanel);
  if (tokenCloseBtn) tokenCloseBtn.addEventListener('click', closeTokenPanel);
  if (tokenMask) tokenMask.addEventListener('click', closeTokenPanel);
  // Token 保存逻辑(独立于代理保存)
  if (tokenSaveBtn) tokenSaveBtn.addEventListener('click', function () {
    var tokenNew = tokenInputEl ? tokenInputEl.value.trim() : '';
    if (!tokenNew) {
      if (tokenMsgEl) {
        tokenMsgEl.style.color = 'var(--danger-fg)';
        tokenMsgEl.textContent = '请输入 GitHub Personal Token,或点击“清除 Token”退出认证模式。';
      }
      return;
    }
    if (!isSupportedGitHubToken(tokenNew)) {
      if (tokenMsgEl) {
        tokenMsgEl.style.color = 'var(--danger-fg)';
        tokenMsgEl.textContent = 'Token 格式无效。仅接受 ghp_ 或 github_pat_ 开头的 GitHub Personal Token。';
      }
      return;
    }
    if (location.protocol !== 'file:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      if (!window.confirm('你当前访问的是公网域名。Token 将只保留在当前标签页内存,并仅用于浏览器直连 https://api.github.com。请确认页面来源可信后继续。')) return;
    }
    var proxyWasDisabled = API_BASE !== DEFAULT_API;
    API_BASE = DEFAULT_API;
    LOCAL_BEARER = tokenNew;
    if (tokenInputEl) tokenInputEl.value = '';
    refreshApiLabel();
    searchCache = Object.create(null);
    if (tokenMsgEl) {
      tokenMsgEl.style.color = 'var(--success-fg)';
      tokenMsgEl.textContent = '✓ Token 仅在当前标签页内存中生效,只直连 GitHub 官方 API' +
        (proxyWasDisabled ? ';第三方代理已自动关闭' : '') + '。';
    }
    hideRateHint();
    try { localStorage.setItem('gh_rate_hint_dismissed','1'); } catch(_) {}
    if (currentQ) { page = 1; doSearch(); } else { forceRefreshTrending(); }
  });
  // 清除当前标签页内存中的 Token
  if (tokenClearBtn) tokenClearBtn.addEventListener('click', function () {
    LOCAL_BEARER = '';
    if (tokenInputEl) tokenInputEl.value = '';
    refreshApiLabel();
    searchCache = Object.create(null);
    if (tokenMsgEl) { tokenMsgEl.style.color = 'var(--success-fg)'; tokenMsgEl.textContent = '✓ 已清除当前会话 Token,回退到未认证(默认按出口 IP 限流)'; }
    showRateHintIfApplicable();
    if (currentQ) { page = 1; doSearch(); } else { forceRefreshTrending(); }
  });

  // ---------- 精准度说明面板 ----------
  var accuracyMask = document.getElementById('accuracyMask');
  var accuracyPanel = document.getElementById('accuracyPanel');
  var openAccuracyBtn = document.getElementById('openAccuracy');
  var closeAccuracyBtn = document.getElementById('closeAccuracy');
  function openAccuracy() {
    if (accuracyMask) {
      accuracyMask.style.display = 'flex';
      try { accuracyMask.scrollTop = 0; } catch(e){}  // 滚动容器已迁移到 mask
    }
    if (accuracyPanel) accuracyPanel.style.display = 'block';
  }
  function closeAccuracy() {
    if (accuracyMask) accuracyMask.style.display = 'none';
    if (accuracyPanel) accuracyPanel.style.display = 'none';
  }
  if (openAccuracyBtn) openAccuracyBtn.addEventListener('click', openAccuracy);
  if (closeAccuracyBtn) closeAccuracyBtn.addEventListener('click', closeAccuracy);
  if (accuracyMask) accuracyMask.addEventListener('click', closeAccuracy);
  // 面板位于 mask 内部,点击面板自身时必须阻止冒泡,否则会触发 mask.click → closeAccuracy
  if (accuracyPanel) accuracyPanel.addEventListener('click', function (e) { e.stopPropagation(); });

  function openSettings() {
    if (cfgProxyInput) cfgProxyInput.value = API_BASE;
    syncProxyPresetSelection();
    if (cfgMsgEl) {
      cfgMsgEl.style.color = hasConfiguredToken() ? 'var(--attention-fg)' : 'var(--accent-fg)';
      cfgMsgEl.textContent = hasConfiguredToken()
        ? '当前为 Token 直连模式。如需启用第三方代理,请先清除 Token。'
        : '选择节点后点击“检测并启用”；检测失败不会切换当前 API。';
    }
    if (settingsMask) settingsMask.style.display = 'block';
    if (settingsPanel) settingsPanel.style.display = 'block';
  }
  function closeSettings() {
    cancelProxyCheck();
    if (settingsMask) settingsMask.style.display = 'none';
    if (settingsPanel) settingsPanel.style.display = 'none';
  }
  if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettings);
  // 过滤器栏新增「⚙ 代理设置」按钮也直接打开代理设置面板
  var proxQuickBtn = document.getElementById('proxQuickBtn');
  if (proxQuickBtn) proxQuickBtn.addEventListener('click', openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if (settingsMask) settingsMask.addEventListener('click', closeSettings);
  // 加速节点预设快捷填入
  proxyPresetBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-url') || '';
      if (cfgProxyInput) cfgProxyInput.value = url;
      syncProxyPresetSelection();
      setProxyMessage('var(--accent-fg)', '已选择 ' + (btn.querySelector('span') ? btn.querySelector('span').textContent : '节点') + '，点击“检测并启用”。');
    });
  });
  if (cfgProxyInput) cfgProxyInput.addEventListener('input', syncProxyPresetSelection);
  if (cfgClearHistoryBtn) cfgClearHistoryBtn.addEventListener('click', function () {
    clearAllHistory();
    setProxyMessage('var(--success-fg)', '✓ 已清除所有最近搜索记录');
  });
  if (cfgSaveBtn) cfgSaveBtn.addEventListener('click', function () {
    var proxy = cfgProxyInput ? cfgProxyInput.value.trim() : '';
    var nextApiBase;
    try {
      nextApiBase = normalizeProxyBase(proxy);
    } catch (err) {
      setProxyMessage('var(--danger-fg)', err && err.message ? err.message : '代理地址无效');
      return;
    }
    var nextIsOfficial = isOfficialGitHubApiRequest(nextApiBase);
    if (!nextIsOfficial && hasConfiguredToken()) {
      setProxyMessage('var(--danger-fg)', '无法启用第三方代理:当前已配置 Token。请先到 Personal Token 面板清除 Token;代理请求绝不携带 Token。');
      return;
    }
    if (nextIsOfficial) {
      API_BASE = DEFAULT_API;
      searchCache = Object.create(null);
      refreshApiLabel();
      setProxyMessage('var(--success-fg)', '✓ 已启用 GitHub 官方 API。');
      if (currentQ) { page = 1; doSearch(); } else { forceRefreshTrending(); }
      return;
    }

    setProxySettingsBusy(true);
    setProxyMessage('var(--accent-fg)', '正在通过该节点调用 GitHub Search API…');
    testProxyBase(nextApiBase).then(function (result) {
      API_BASE = nextApiBase;
      searchCache = Object.create(null);
      refreshApiLabel();
      syncProxyPresetSelection();
      var remaining = result.remaining ? '，当前搜索额度余量 ' + result.remaining : '';
      setProxyMessage('var(--success-fg)', '✓ 检测通过并已启用匿名代理' + remaining + '。刷新页面自动切回官方源。');
      if (currentQ) { page = 1; doSearch(); } else { forceRefreshTrending(); }
    }).catch(function (err) {
      setProxyMessage('var(--danger-fg)', '检测失败，未切换当前 API：' +
        (err && err.message ? err.message : '未知错误'));
    }).then(function () {
      setProxySettingsBusy(false);
    });
  });
  if (cfgResetBtn) cfgResetBtn.addEventListener('click', function () {
    cancelProxyCheck();
    try { localStorage.removeItem('gh_api_proxy'); } catch (e) {}
    if (cfgProxyInput) cfgProxyInput.value = DEFAULT_API;
    API_BASE = DEFAULT_API; searchCache = Object.create(null); refreshApiLabel();
    syncProxyPresetSelection();
    setProxyMessage('var(--success-fg)', '✓ 已恢复默认直连 api.github.com。Token 与搜索历史未改动。');
    if (currentQ) { page = 1; doSearch(); } else { forceRefreshTrending(); }
  });
  window.addEventListener('pagehide', function () {
    LOCAL_BEARER = '';
    if (tokenInputEl) tokenInputEl.value = '';
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (tokenPanel && tokenPanel.style.display === 'block') closeTokenPanel();
      else if (accuracyPanel && accuracyPanel.style.display === 'block') closeAccuracy();
      else if (settingsPanel && settingsPanel.style.display === 'block') closeSettings();
      if (tokenTutorialBox && tokenTutorialBox.style.display === 'block') {
        tokenTutorialBox.style.display = 'none';
        if (tokenToggleTutBtn) tokenToggleTutBtn.textContent = '📖 如何获取 Token?';
      }
    }
  });

  clearBtn.addEventListener('click', function () {
    input.value = ''; langSel.value = ''; starsSel.value = ''; pushedSel.value = ''; sortSel.value = 'best-match';
    if (inFieldSel) inFieldSel.value = 'auto';
    currentQ = ''; page = 1;
    resultsEl.innerHTML = ''; pagerEl.innerHTML = ''; statusEl.style.display = 'none';
    showTrending(true);
    forceRefreshTrending();
    history.replaceState(null,'', location.pathname + location.search);
    input.focus();
  });
  logo.addEventListener('click', function () {
    input.value = ''; langSel.value = ''; starsSel.value = ''; pushedSel.value = ''; sortSel.value = 'best-match';
    if (inFieldSel) inFieldSel.value = 'auto';
    currentQ = ''; page = 1; trendingPage = 1;
    resultsEl.innerHTML = ''; pagerEl.innerHTML = ''; statusEl.style.display = 'none';
    showTrending(true);
    forceRefreshTrending();
    history.replaceState(null,'', location.pathname + location.search);
    input.focus();
  });

  // 卡片点击事件委托:点击卡片空白区域打开项目地址
  function handleCardClick(e) {
    var target = e.target;
    if (target.closest('a')) return;
    if (target.closest('.topic')) return;
    var card = target.closest('.clickable');
    if (!card) return;
    var href = card.getAttribute('data-href');
    if (!href) return;
    safeOpenUrl(href);
  }
  if (resultsEl) resultsEl.addEventListener('click', handleCardClick);
  if (trendingEl) trendingEl.addEventListener('click', handleCardClick);

  window.addEventListener('hashchange', function () {
    if (ignoreHash) return;
    if (applyHashToForm()) {
      if (input.value.trim() || langSel.value || starsSel.value || pushedSel.value) doSearch();
      else showTrending(true);
    }
  });

  /* ---------- 自定义下拉组件 ----------
     替代原生 <select>,解决深色模式下原生下拉容器底部白底/灰边问题。
     保留原生 <select>(隐藏),仅用于读写 .value 与派发 change 事件,
     上层用 <button> + <ul> 渲染深蓝灰(#161b22)下拉列表。 */
  function enhanceSelect(select) {
    if (!select || select.dataset.enhanced) return;
    select.dataset.enhanced = '1';

    var wrapper = document.createElement('div');
    wrapper.className = 'cs cs-' + select.id;
    wrapper.dataset.csFor = select.id;
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    if (select.title) trigger.title = select.title;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var valueSpan = document.createElement('span');
    valueSpan.className = 'cs-value';
    var arrow = document.createElement('span');
    arrow.className = 'cs-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    trigger.appendChild(valueSpan);
    trigger.appendChild(arrow);

    var list = document.createElement('ul');
    list.className = 'cs-options';
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    function updateValue() {
      var sel = select.options[select.selectedIndex];
      valueSpan.textContent = sel ? sel.textContent : '';
      for (var i = 0; i < list.children.length; i++) {
        var li = list.children[i];
        li.classList.toggle('cs-selected', li.dataset.value === select.value);
        li.setAttribute('aria-selected', String(li.dataset.value === select.value));
      }
    }

    for (var i = 0; i < select.options.length; i++) {
      (function (opt) {
        var li = document.createElement('li');
        li.className = 'cs-option';
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        li.textContent = opt.textContent;
        li.tabIndex = -1;
        if (opt.selected) li.classList.add('cs-selected');
        li.addEventListener('click', function () {
          select.value = opt.value;
          updateValue();
          close();
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        list.appendChild(li);
      })(select.options[i]);
    }

    function positionList() {
      var rect = trigger.getBoundingClientRect();
      var scrollY = window.pageYOffset || document.documentElement.scrollTop;
      var scrollX = window.pageXOffset || document.documentElement.scrollLeft;
      list.style.top = (rect.bottom + scrollY + 4) + 'px';
      list.style.left = (rect.left + scrollX) + 'px';
      list.style.minWidth = rect.width + 'px';
    }
    function open() {
      // 把 list 移到 body 层级,脱离所有父级层叠上下文(backdrop-filter / transform / z-index 等)
      // 确保下拉列表始终显示在最前方,不被热榜卡片、section-title 等遮挡
      document.body.appendChild(list);
      list.hidden = false;
      list.style.position = 'absolute';
      positionList();
      trigger.setAttribute('aria-expanded', 'true');
      var sel = list.querySelector('.cs-selected');
      if (sel) { sel.focus(); sel.scrollIntoView({ block: 'nearest' }); }
      else if (list.firstChild) list.firstChild.focus();
    }
    function close() {
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
    function toggle() { list.hidden ? open() : close(); }

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      toggle();
    });
    document.addEventListener('click', function (e) {
      if (!wrapper.contains(e.target) && !list.contains(e.target)) close();
    });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        open();
      }
    });
    list.addEventListener('keydown', function (e) {
      var items = list.children;
      var idx = -1;
      for (var j = 0; j < items.length; j++) {
        if (items[j] === document.activeElement) { idx = j; break; }
      }
      if (e.key === 'Escape') { close(); trigger.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(idx + 1, items.length - 1)].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(idx - 1, 0)].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (idx >= 0) items[idx].click(); }
    });
    // 滚动或 resize 时关闭/重新定位,避免列表脱离触发器
    // 注意:必须排除 list 自身的滚动事件(e.target === list),否则用户拖动滚动条时会立即关闭
    window.addEventListener('scroll', function (e) {
      if (!list.hidden && e.target !== list) close();
    }, true);
    window.addEventListener('resize', function () { if (!list.hidden) { positionList(); } }, true);

    wrapper.appendChild(trigger);
    wrapper.appendChild(list);

    // 隐藏原生 select(保留可访问性与 .value 读写)
    select.style.position = 'absolute';
    select.style.width = '1px';
    select.style.height = '1px';
    select.style.opacity = '0';
    select.style.pointerEvents = 'none';
    select.style.overflow = 'hidden';
    select.style.border = '0';
    select.style.padding = '0';
    select.style.margin = '0';
    select.style.left = '0';
    select.style.top = '0';
    select.setAttribute('aria-hidden', 'true');
    select.setAttribute('tabindex', '-1');

    updateValue();
    // 覆写 .value setter,使外部(applyHashToForm / clear 等)设置值时同步刷新自定义 UI
    var desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (desc) {
      Object.defineProperty(select, 'value', {
        get: function () { return desc.get.call(this); },
        set: function (v) { desc.set.call(this, v); updateValue(); },
        configurable: true
      });
    }
    select.addEventListener('change', updateValue);
  }

  [sortSel, langSel, starsSel, pushedSel].concat(inFieldSel ? [inFieldSel] : []).forEach(enhanceSelect);

  /* ---------- 初始化 ---------- */
  if (window.matchMedia && window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)').matches) {
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
  }
  refreshApiLabel();
  showRateHintIfApplicable();   // Token 提示(首次才显示,用户有 Token 或点过后自动隐藏)
  renderHistory();
  var initHash = readFiltersFromHash();
  if (initHash && (initHash.q || initHash.lang || initHash.stars || initHash.pushed)) {
    applyHashToForm();
    doSearch();
  } else {
    // 首次加载热门项目(非强制,保持 init 文案)
    loadTrending(false);
  }

  /* ---------- 累计访问计数(KV 计数,同一 IP 30 分钟内只计一次) ---------- */
   /* ---------- 下面地址需要修改为实际的计数地址 ---------- */
  var VISIT_API_URL = 'https://git.com/api/visit';

  function updateVisitCount(value) {
    var el = document.getElementById('visitCount');
    if (el && value != null) el.textContent = value;
  }

  function trackVisit() {
    var url = VISIT_API_URL || '/api/visit';
    // 5 秒超时,防止 workers.dev 被墙时一直卡在 "…"
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 5000);
    fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal })
      .then(function (res) { clearTimeout(timeoutId); return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.totalFormatted != null) {
          updateVisitCount(data.totalFormatted);
        } else if (data && data.total != null) {
          updateVisitCount(String(data.total));
        } else {
          updateVisitCount('0');
        }
      })
      .catch(function () {
        clearTimeout(timeoutId);
        // 接口不可用时显示 0,不报错
        updateVisitCount('0');
      });
  }

  // 页面空闲时上报访问,避免阻塞首屏渲染
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(trackVisit, { timeout: 3000 });
  } else {
    setTimeout(trackVisit, 800);
  }
})();
