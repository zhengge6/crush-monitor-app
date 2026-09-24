import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import {
  adminGet,
  adminList,
  adminListCodes,
  adminUpsertCodes,
  clearAuthSession,
  loadAuthToken,
  loadCachedUser,
  login,
  me,
  type AdminRedeemCode,
  type AdminConversationMeta,
  type AuthUser,
} from "./auth";
import { RELATIONS, type Relation } from "../shared/types";

type Detail = Awaited<ReturnType<typeof adminGet>>["conversation"];
type Tab = "chats" | "codes";

function relationLabel(r: string) {
  return RELATIONS[r as Relation] || r;
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return d.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: sameDay ? undefined : "2-digit",
      day: sameDay ? undefined : "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export default function AdminApp() {
  const [user, setUser] = useState<AuthUser | null>(() => loadCachedUser());
  const [token, setToken] = useState<string | null>(() => loadAuthToken());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("chats");
  const [items, setItems] = useState<AdminConversationMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [codes, setCodes] = useState<AdminRedeemCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newNote, setNewNote] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshMe = useCallback(async () => {
    if (!loadAuthToken()) {
      setUser(null);
      setToken(null);
      return;
    }
    try {
      const u = await me();
      setUser(u);
      setToken(loadAuthToken());
    } catch {
      clearAuthSession();
      setUser(null);
      setToken(null);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const loadList = useCallback(async (query = "") => {
    setLoadingList(true);
    setError("");
    try {
      const res = await adminList({ limit: 50, offset: 0, q: query });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
      setTotal(0);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadCodes = useCallback(async () => {
    setLoadingCodes(true);
    setError("");
    try {
      const res = await adminListCodes();
      setCodes(res.codes || []);
    } catch (e) {
      setError((e as Error).message);
      setCodes([]);
    } finally {
      setLoadingCodes(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === "admin") {
      void loadList("");
      void loadCodes();
    }
  }, [user?.role, loadList, loadCodes]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function doLogout() {
    clearAuthSession();
    setUser(null);
    setToken(null);
    setUsername("");
    setPassword("");
    setItems([]);
    setTotal(0);
    setQ("");
    setDetail(null);
    setCodes([]);
    setError("");
    setCodeMsg("");
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await login(username.trim(), password);
      setUser(res.user);
      setToken(res.token);
      if (res.user.role !== "admin") {
        setError("当前账号不是管理员，请退出后使用管理员账号登录");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await adminGet(id);
      setDetail(res.conversation);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onSearchChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadList(value.trim());
    }, 300);
  }

  function clearSearch() {
    setQ("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void loadList("");
  }

  async function addCode(e: React.FormEvent) {
    e.preventDefault();
    const code = newCode.trim();
    if (!code) return;
    setBusy(true);
    setCodeMsg("");
    setError("");
    try {
      const res = await adminUpsertCodes([
        {
          code,
          active: true,
          unlimited: true,
          note: newNote.trim() || "管理员添加",
          maxDevices: null,
        },
      ]);
      setCodes(res.codes || []);
      setNewCode("");
      setNewNote("");
      setCodeMsg(`已保存「${code}」`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCode(c: AdminRedeemCode) {
    setBusy(true);
    setError("");
    try {
      const res = await adminUpsertCodes([
        {
          code: c.code,
          active: !c.active,
          unlimited: c.unlimited,
          note: c.note,
          maxDevices: c.maxDevices ?? null,
        },
      ]);
      setCodes(res.codes || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = Boolean(token && user && user.role === "admin");

  if (!isAdmin) {
    return (
      <main className="app admin-app">
        <div className="admin-login-card">
          <h1>管理后台</h1>
          <p className="admin-muted">管理员账号登录</p>
          <form onSubmit={submitLogin} className="admin-form">
            <label className="field">
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="field">
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "登录中…" : "登录"}
            </button>
          </form>
          {user && user.role !== "admin" && (
            <button type="button" className="admin-text-btn" onClick={doLogout}>
              退出当前账号
            </button>
          )}
          <a className="admin-back-link" href="/">
            返回分析
          </a>
        </div>
      </main>
    );
  }

  if (detail) {
    const dims = detail.overview?.dimensions || [];
    return (
      <main className="app admin-app">
        <header className="admin-head">
          <button
            type="button"
            className="float-circle"
            aria-label="返回列表"
            onClick={() => setDetail(null)}
          >
            <ChevronLeft size={22} strokeWidth={2.25} />
          </button>
          <div className="admin-head-title">
            <strong>{detail.username}</strong>
            <span>
              {relationLabel(detail.relation)} · {detail.messageCount} 条
            </span>
          </div>
          <a className="admin-text-link" href="/">
            分析
          </a>
        </header>
        <div className="admin-summary">
          <div className="admin-summary-row">
            <span>{formatTime(detail.updatedAt)}</span>
            <span>
              {detail.selfName || "我"} / {detail.otherName || "对方"}
            </span>
          </div>
          {detail.affinity != null && (
            <div className="admin-affinity-hero">
              <span>对方对你的好感度</span>
              <strong>{detail.affinity}</strong>
            </div>
          )}
        </div>
        {dims.length > 0 && (
          <div className="admin-dims">
            {dims.map((d, i) => (
              <div key={d.key || i} className="admin-dim">
                <span>{d.label || d.key}</span>
                <strong>{d.value ?? "—"}</strong>
              </div>
            ))}
          </div>
        )}
        <div className="admin-chat">
          {detail.messages.map((m) => (
            <div
              key={m.id}
              className={`admin-bubble-row ${m.sender === "self" ? "self" : "other"}`}
            >
              <div className="admin-bubble">
                <span className="admin-bubble-who">
                  {m.sender === "self" ? "我" : "对方"}
                </span>
                {m.timestamp && (
                  <time className="admin-bubble-time">{m.timestamp}</time>
                )}
                <p>{m.text}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="app admin-app">
      <header className="admin-head">
        <div className="admin-head-title">
          <strong>管理后台</strong>
          <span>
            {user?.username} · {tab === "chats" ? `对话 ${total}` : `兑换码 ${codes.length}`}
          </span>
        </div>
        <div className="admin-head-actions">
          <button
            type="button"
            className="float-circle"
            aria-label="刷新"
            onClick={() =>
              void (tab === "chats" ? loadList(q.trim()) : loadCodes())
            }
            disabled={loadingList || loadingCodes}
          >
            <RefreshCw size={18} strokeWidth={1.9} />
          </button>
          <button type="button" className="admin-text-btn" onClick={doLogout}>
            退出
          </button>
          <a className="admin-text-link" href="/">
            分析
          </a>
        </div>
      </header>

      <div className="admin-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "chats"}
          className={tab === "chats" ? "selected" : ""}
          onClick={() => setTab("chats")}
        >
          对话记录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "codes"}
          className={tab === "codes" ? "selected" : ""}
          onClick={() => setTab("codes")}
        >
          兑换码
        </button>
      </div>

      {error && <p className="error admin-error">{error}</p>}

      {tab === "codes" ? (
        <div className="admin-codes">
          <form className="admin-code-form" onSubmit={addCode}>
            <label className="field">
              新兑换码
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="例如：疯狂星期四"
                required
              />
            </label>
            <label className="field">
              备注（可选）
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="今日兑换码"
              />
            </label>
            <button className="primary" type="submit" disabled={busy || !newCode.trim()}>
              {busy ? "保存中…" : "添加 / 更新"}
            </button>
            {codeMsg && <p className="admin-code-msg">{codeMsg}</p>}
          </form>
          {loadingCodes ? (
            <p className="admin-empty">加载中…</p>
          ) : (
            <ul className="admin-code-list">
              {codes.map((c) => (
                <li key={c.code} className={`admin-code-item ${c.active ? "" : "off"}`}>
                  <div className="admin-code-main">
                    <strong>{c.code}</strong>
                    <span className="admin-code-tags">
                      {c.unlimited ? "无限" : "有限"}
                      {c.active ? " · 启用" : " · 停用"}
                    </span>
                    {c.note && <span className="admin-code-note">{c.note}</span>}
                  </div>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => void toggleCode(c)}
                    disabled={busy}
                  >
                    {c.active ? "停用" : "启用"}
                  </button>
                </li>
              ))}
              {!codes.length && (
                <li className="admin-empty">
                  <p>还没有兑换码</p>
                  <span>上面添加一个即可</span>
                </li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="admin-toolbar">
            <div className="admin-search-wrap">
              <input
                className="admin-search"
                placeholder="搜索用户 / 关系 / 名字"
                value={q}
                onChange={(e) => onSearchChange(e.target.value)}
              />
              {q && (
                <button
                  type="button"
                  className="admin-search-clear"
                  aria-label="清除"
                  onClick={clearSearch}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          {loadingList && <p className="admin-empty">加载中…</p>}
          <ul className="admin-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="admin-list-item"
                  onClick={() => void openDetail(item.id)}
                >
                  <div className="admin-list-body">
                    <div className="admin-list-main">
                      <strong>{item.username}</strong>
                      <span className="admin-chip">{relationLabel(item.relation)}</span>
                      {item.affinity != null && (
                        <span className="admin-affinity-pill">{item.affinity}</span>
                      )}
                    </div>
                    <div className="admin-list-sub">
                      <span>{formatTime(item.updatedAt)}</span>
                      <span>·</span>
                      <span>{item.messageCount} 条</span>
                      <span>·</span>
                      <span>
                        {item.selfName || "我"} / {item.otherName || "对方"}
                      </span>
                    </div>
                  </div>
                  <ChevronRight
                    className="admin-list-chevron"
                    size={18}
                    strokeWidth={2}
                  />
                </button>
              </li>
            ))}
            {!loadingList && !items.length && (
              <li className="admin-empty">
                <p>暂无对话记录</p>
                <span>登录用户分析后会显示在这里</span>
              </li>
            )}
          </ul>
        </>
      )}
    </main>
  );
}
