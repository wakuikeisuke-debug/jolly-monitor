import { DurableObject } from "cloudflare:workers";

const GAME_AJAX = "https://yamada.kaizoku-jolly.com/ajax.php?M=main&A=default";
const GAME_MAIN = "https://yamada.kaizoku-jolly.com/?M=Main";

export class JollyState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async get(key) {
    return await this.ctx.storage.get(key);
  }

  async put(key, value) {
    await this.ctx.storage.put(key, value);
  }
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runMonitor(env, false));
  },

  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return json({ ok: true, service: "jolly-monitor" });
      }

      const result = await runMonitor(env, true);
      return json(result);
    } catch (e) {
      return json({
        ok: false,
        error: e && e.message ? e.message : String(e)
      }, 500);
    }
  }
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8" }
  });
}

async function stateStub(env) {
  const id = env.JOLLY_STATE.idFromName("main");
  return env.JOLLY_STATE.get(id);
}

async function stateGet(env, key) {
  const stub = await stateStub(env);
  return await stub.get(key);
}

async function statePut(env, key, value) {
  const stub = await stateStub(env);
  await stub.put(key, value);
}

async function runMonitor(env, manual) {
  if (!env.JOLLY_ID || !env.JOLLY_PASSWORD) {
    throw new Error("Cloudflare Secrets の JOLLY_ID / JOLLY_PASSWORD が未設定です");
  }

  let jar = (await stateGet(env, "cookieJar")) || {};
  let ajax = await fetchAjax(jar);

  if (!ajax.ok) {
    jar = {};
    await login(env, jar);
    ajax = await fetchAjax(jar);

    if (!ajax.ok) {
      throw new Error("ログイン後もJOLLY ROGERのAjax JSONを取得できませんでした");
    }

    await statePut(env, "cookieJar", jar);
  }

  const data = ajax.data;
const activeBuildIds = getActiveBuildIds(data.build_data);

  const current = {
    rubyFull: String(data.full_recovery_date || "").trim() === "",
    collectable: Number(data.gold_collect || 0) >= 1,
    activeBuildIds,
    constructionComplete: false,
    raid: Number(data.raid_monster_flg || 0) === 1,
    checkedAt: new Date().toISOString()
  };

  const previous = (await stateGet(env, "state")) || null;
  const notifications = [];

  if (previous) {
    if (previous.rubyFull === false && current.rubyFull === true) {
      notifications.push("🔴 紅玉が満タンになりました");
    }
    if (previous.collectable === false && current.collectable === true) {
      notifications.push("💰 集金可能な建物があります");
    }
    if (Array.isArray(previous.activeBuildIds)) {
      const finishedBuildIds = previous.activeBuildIds.filter(
        (id) => !current.activeBuildIds.includes(id)
      );

      if (finishedBuildIds.length > 0) {
        notifications.push(
          "🏗️ 建築が完了しました（" + finishedBuildIds.length + "件）"
        );
      }
    }

    // レイド通知は後で有効化
    // if (previous.raid === false && current.raid === true) {
    //   notifications.push("⚔️ レイドモンスターが出現しました");
    // }
  }

  await statePut(env, "state", current);
  await statePut(env, "cookieJar", jar);

  for (const message of notifications) {
    await sendNotification(env, message);
  }

  return {
    ok: true,
    manual,
    current,
    previous,
    notifications,
    ajaxSummary: {
      full_recovery_date: data.full_recovery_date,
      gold_collect: data.gold_collect,
      next_collect_time: data.next_collect_time,
      raid_monster_flg: data.raid_monster_flg,
      build_count: Array.isArray(data.build_data) ? data.build_data.length : null,
      active_build_count: activeBuildIds.length,
      active_build_ids: activeBuildIds
    },
  };
}

function getActiveBuildIds(buildData) {
  if (!Array.isArray(buildData)) return [];

  return buildData
    .filter((b) => Number(b && b.last_time) > 0)
    .map((b) => String(b && b.id ? b.id : ""))
    .filter((id) => id !== "");
}

async function fetchAjax(jar) {
  const url = GAME_AJAX + "&_=" + Date.now();
  const res = await requestWithJar(url, { method: "GET" }, jar, 12);
  const text = await res.text();

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (_) {
    return {
      ok: false,
      finalUrl: res.url,
      preview: text.slice(0, 120)
    };
  }
}


async function login(env, jar) {
  const loginPage = await requestWithJar(
    GAME_AJAX,
    { method: "GET" },
    jar,
    15
  );

  const html = await loginPage.text();

  const skeyMatch = html.match(
    /name=["']skey["'][^>]*value=["']?([^"'>\s]+)/
  );

  if (!skeyMatch) {
    throw new Error("ログイン画面からskeyを取得できませんでした");
  }

  const formMatch = html.match(
    /<form[^>]+action=["']([^"']+)["'][^>]*>/i
  );

  const formUrl = new URL(
    formMatch
      ? formMatch[1]
      : "/smrt/index.php?module=auth&action=auth001&func=auth",
    loginPage.url
  ).toString();

  const body = new URLSearchParams({
    skey: skeyMatch[1],
    id: env.JOLLY_ID,
    password: env.JOLLY_PASSWORD,
    keeplogininfo: "1"
  }).toString();

  const final = await requestWithJar(
    formUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    },
    jar,
    20
  );

  await final.arrayBuffer();
}

async function requestWithJar(url, options, jar, maxRedirects) {
  let currentUrl = url;
  let method = options.method || "GET";
  let body = options.body;
  const baseHeaders = new Headers(options.headers || {});

  for (let i = 0; i <= maxRedirects; i++) {
    const headers = new Headers(baseHeaders);
    const cookie = cookieHeaderFor(jar, currentUrl);

    if (cookie) headers.set("cookie", cookie);

    if (!headers.has("user-agent")) {
      headers.set(
        "user-agent",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
      );
    }

    const res = await fetch(currentUrl, {
      method,
      headers,
      body,
      redirect: "manual"
    });

    storeSetCookies(jar, currentUrl, res);

    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return res;
    }

    const location = res.headers.get("location");
    if (!location) return res;

    const nextUrl = new URL(location, currentUrl).toString();

    // 別ホストへは、そのホストに適合するCookieだけを次ループで再生成する。
    if (
      res.status === 303 ||
      ((res.status === 301 || res.status === 302) && method === "POST")
    ) {
      method = "GET";
      body = undefined;
      baseHeaders.delete("content-type");
    }

    currentUrl = nextUrl;
  }

  throw new Error("リダイレクト上限を超えました");
}

function storeSetCookies(jar, requestUrl, response) {
  let lines = [];

  if (typeof response.headers.getSetCookie === "function") {
    lines = response.headers.getSetCookie();
  } else {
    const one = response.headers.get("set-cookie");
    if (one) lines = [one];
  }

  const request = new URL(requestUrl);

  for (const line of lines) {
    const parts = line.split(";").map((x) => x.trim());
    const first = parts.shift();
    const eq = first ? first.indexOf("=") : -1;

    if (eq <= 0) continue;

    const name = first.slice(0, eq);
    const value = first.slice(eq + 1);

    let domain = request.hostname.toLowerCase();
    let path = "/";
    let expires = null;
    let secure = false;

    for (const attr of parts) {
      const ae = attr.indexOf("=");
      const key = (ae >= 0 ? attr.slice(0, ae) : attr)
        .trim()
        .toLowerCase();
      const val = ae >= 0 ? attr.slice(ae + 1).trim() : "";

      if (key === "domain" && val) {
        domain = val.replace(/^\./, "").toLowerCase();
      } else if (key === "path" && val) {
        path = val;
      } else if (key === "expires" && val) {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expires = t;
      } else if (key === "max-age" && val) {
        const seconds = Number(val);
        if (!Number.isNaN(seconds)) {
          expires = Date.now() + seconds * 1000;
        }
      } else if (key === "secure") {
        secure = true;
      }
    }

    const k = domain + "|" + path + "|" + name;

    if (expires !== null && expires <= Date.now()) {
      delete jar[k];
    } else {
      jar[k] = { name, value, domain, path, expires, secure };
    }
  }
}

function cookieHeaderFor(jar, url) {
  const u = new URL(url);
  const now = Date.now();
  const values = [];

  for (const [key, c] of Object.entries(jar)) {
    if (!c || !c.name) continue;

    if (c.expires !== null && c.expires !== undefined && c.expires <= now) {
      delete jar[key];
      continue;
    }

    const host = u.hostname.toLowerCase();
    const domain = String(c.domain || "").toLowerCase();

    const domainOk = host === domain || host.endsWith("." + domain);
    const pathOk = u.pathname.startsWith(c.path || "/");
    const secureOk = !c.secure || u.protocol === "https:";

    if (domainOk && pathOk && secureOk) {
      values.push(c.name + "=" + c.value);
    }
  }

  return values.join("; ");
}

function extractTagById(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const re = new RegExp(
    "<([a-zA-Z0-9]+)([^>]*\\bid=[\"']" +
      escaped +
      "[\"'][^>]*)>([\\s\\S]*?)<\\/\\1>",
    "i"
  );

  const m = html.match(re);
  if (!m) return null;

  return {
    openTag: "<" + m[1] + m[2] + ">",
    innerHTML: m[3]
  };
}

function getAttr(tag, name) {
  const re = new RegExp("\\b" + name + "=[\"']([^\"']*)[\"']", "i");
  const m = tag.match(re);
  return m ? m[1] : "";
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

async function sendNotification(env, message) {
  const token = String(env.PUSHOVER_APP_TOKEN || "").trim();
  const user = String(env.PUSHOVER_USER_KEY || "").trim();

  if (!token || !user) {
    console.log("NOTIFY SKIPPED: Pushover secrets are not configured");
    return {
      sent: false,
      reason: "PUSHOVER_NOT_CONFIGURED",
      hasToken: !!token,
      hasUser: !!user
    };
  }

  const body = new URLSearchParams({
    token: token,
    user: user,
    title: "JOLLY ROGER",
    message: message,
    priority: "0"
  });

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      "Pushover送信失敗 HTTP " +
      res.status +
      " " +
      text.slice(0, 200)
    );
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_) {}

  if (parsed && parsed.status !== 1) {
    throw new Error(
      "Pushover送信失敗 " + text.slice(0, 200)
    );
  }

  return {
    sent: true,
    status: res.status,
    request:
      parsed && parsed.request
        ? parsed.request
        : null
  };
}
