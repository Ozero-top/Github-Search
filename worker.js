/**
 * 累计访问计数 Worker(Cloudflare Workers + D1)
 * 用途:记录站点访问次数,同一 IP 30 分钟内只计一次
 *
 * 路由规则:
 *   /api/visit  → 计数 + 返回 JSON
 *   其他路径    → 301 跳转到 https://git.ozero.top/
 *
 * 安全策略:
 *   - 爬虫/机器人/无 UA 不计数
 *   - IP 经 SHA-256 哈希后存储,不保留原始 IP
 *   - 同一 IP 30 分钟内只计一次(基于时间戳比较 + 自动清理过期记录)
 *
 * D1 数据表(首次请求自动初始化):
 *   visit_total(id INTEGER PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0)
 *   visit_ip(ip_hash TEXT PRIMARY KEY, last_visit_at INTEGER NOT NULL)
 *
 * D1 绑定名:env.VISITS_DB
 */

// ─────── 配置区(按需修改)───────
const DEDUP_WINDOW_SECONDS = 30 * 60; // 30 分钟去重窗口
const IP_SALT = 'gh-search-visits-2026'; // IP 哈希盐值
const REDIRECT_URL = 'https://git.ozero.top/'; // 非计数路径跳转地址
const API_PATH = '/api/visit'; // 计数接口路径

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

// ─────── D1 初始化 SQL(幂等,首次请求自动建表)───────
// 注意:逐条执行 prepare().run(),避免 D1.exec() 对多语句/多行 SQL 解析不稳定
const SCHEMA_STATEMENTS = [
  'CREATE TABLE IF NOT EXISTS visit_total (id INTEGER PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0);',
  'CREATE TABLE IF NOT EXISTS visit_ip (ip_hash TEXT PRIMARY KEY, last_visit_at INTEGER NOT NULL);',
  'CREATE INDEX IF NOT EXISTS idx_visit_ip_last ON visit_ip(last_visit_at);',
  'INSERT OR IGNORE INTO visit_total (id, total) VALUES (1, 0);',
];

// ─────── 工具函数 ───────

// SHA-256 哈希(IP + 盐值),返回十六进制字符串,不存储原始 IP
async function hashIp(ip) {
  const data = new TextEncoder().encode(ip + IP_SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function safeParseInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

// 千分位格式化:12345 -> "12,345"
function formatNumber(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 检测是否为爬虫/机器人,不计入访问数
function isBot(userAgent) {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return true; // 无 UA 直接跳过
  const botPatterns = [
    'bot', 'crawl', 'spider', 'slurp', 'scan', 'preview',
    'google', 'baidu', 'bing', 'yandex', 'duckduck', 'sogou',
    'facebook', 'twitter', 'linkedin', 'telegram', 'whatsapp',
    'curl', 'wget', 'python', 'node', 'go-http', 'java/',
    'monitor', 'uptime', 'healthcheck', 'headless',
  ];
  for (let i = 0; i < botPatterns.length; i++) {
    if (ua.indexOf(botPatterns[i]) !== -1) return true;
  }
  // 必须包含 Mozilla 才算浏览器
  if (ua.indexOf('mozilla') === -1) return true;
  return false;
}

// 返回 JSON 响应
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

// 返回 301 跳转
function redirectResponse(url) {
  return new Response(null, {
    status: 301,
    headers: { Location: url, 'Cache-Control': 'no-store' },
  });
}

// 初始化 D1 表结构(幂等,逐条执行保证稳定,失败时返回错误便于排查)
async function ensureSchema(env) {
  for (const sql of SCHEMA_STATEMENTS) {
    await env.VISITS_DB.prepare(sql).run();
  }
}

// 清理过期 IP 记录(去重窗口之外),避免 visit_ip 表无限增长
async function cleanExpiredIps(env, now) {
  try {
    const cutoff = now - DEDUP_WINDOW_SECONDS * 1000;
    await env.VISITS_DB.prepare('DELETE FROM visit_ip WHERE last_visit_at < ?;')
      .bind(cutoff)
      .run();
  } catch (err) {
    console.error('D1 cleanup failed:', err);
  }
}

// ─────── 主逻辑 ───────

export default {
  async fetch(request, env, ctx) {
    // 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 非 /api/visit 路径 → 跳转到主站
    if (!url.pathname.startsWith(API_PATH)) {
      return redirectResponse(REDIRECT_URL);
    }

    // 非 GET 请求
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // 未绑定 D1 时优雅降级
    if (!env || !env.VISITS_DB) {
      return jsonResponse({ total: 0, totalFormatted: '0', counted: false, dbBound: false });
    }

    // 初始化表(幂等,出错时把错误透传到响应,便于排查)
    try {
      await ensureSchema(env);
    } catch (err) {
      return jsonResponse({
        total: 0,
        totalFormatted: '0',
        counted: false,
        dbBound: true,
        bot: false,
        error: 'schema_init_failed: ' + (err && err.message ? err.message : String(err)),
      });
    }

    const now = Date.now();

    // 异步清理过期 IP 记录,不阻塞响应
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(cleanExpiredIps(env, now).catch(() => {}));
    }

    // 获取访客 IP(Cloudflare 自动注入 CF-Connecting-IP)
    const ip =
      request.headers.get('CF-Connecting-IP') ||
      (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
      'unknown';

    // 爬虫/机器人不计数
    const userAgent = request.headers.get('User-Agent') || '';
    const bot = isBot(userAgent);

    let counted = false;
    let visitError = null;

    if (!bot) {
      try {
        const ipHash = await hashIp(ip);
        const cutoff = now - DEDUP_WINDOW_SECONDS * 1000;

        // 检查该 IP 是否在 30 分钟窗口内已被计数
        const existing = await env.VISITS_DB.prepare(
          'SELECT 1 FROM visit_ip WHERE ip_hash = ? AND last_visit_at > ?;'
        )
          .bind(ipHash, cutoff)
          .first();

        if (!existing) {
          // 该 IP 在 30 分钟内首次访问,计数 +1
          counted = true;
          // 使用事务批量执行:写入/更新 IP 记录 + 累加总数
          await env.VISITS_DB.batch([
            env.VISITS_DB.prepare(
              'INSERT INTO visit_ip (ip_hash, last_visit_at) VALUES (?, ?) ' +
                'ON CONFLICT(ip_hash) DO UPDATE SET last_visit_at = excluded.last_visit_at;'
            ).bind(ipHash, now),
            env.VISITS_DB.prepare('UPDATE visit_total SET total = total + 1 WHERE id = 1;'),
          ]);
        }
      } catch (err) {
        visitError = (err && err.message ? err.message : String(err));
        console.error('D1 visit operation failed:', err);
      }
    }

    // 读取最新总数
    let total = 0;
    let readError = null;
    try {
      const row = await env.VISITS_DB.prepare('SELECT total FROM visit_total WHERE id = 1;').first();
      if (row && Number.isFinite(row.total)) {
        total = safeParseInt(row.total);
      }
    } catch (err) {
      readError = (err && err.message ? err.message : String(err));
      console.error('D1 read total failed:', err);
    }

    const resp = {
      total,
      totalFormatted: formatNumber(total),
      counted,
      dbBound: true,
      bot,
    };
    if (visitError) resp.error = 'visit_failed: ' + visitError;
    else if (readError) resp.error = 'read_failed: ' + readError;
    return jsonResponse(resp);
  },
};
