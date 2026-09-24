import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import {
  adminAnalyze,
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
import { exportDialogue } from "../shared/export-chat";
import { downloadLongShot, downloadText } from "./export-shot";
import { topEmotions } from "../shared/labels";
import { topIntents } from "../shared/intents";
import { replyRating } from "../shared/ratings";
import { ACTIONS, RELATIONS, STAGES, type Relation } from "../shared/types";

type Detail = Awaited<ReturnType<typeof adminGet>>["conversation"];
type Tab = "chats" | "codes";

function relationLabel(r: string) {
  return RELATIONS[r as Relation] || r;
}

const mediaText =
  /^\[(?:图片|语音|视频|动画表情|表情包|文件|不支持的消息|撤回消息)\]$/;

function tagLabel(
  line: NonNullable<Detail["lines"]>[number] | undefined,
  sender: "self" | "other",
) {
  if (!line) return "";
  if (line.skipped) return line.skipped;
  if (sender === "other") {
    const emotions = topEmotions(line.emotions).map(
      (item) => `${item.label} ${item.percent}`,
    );
    const intents = topIntents(line.intents).map(
      (item) => `${item.label} ${item.percent}`,
    );
    return [
      emotions.length ? `情绪 ${emotions.join(" ")}` : "",
      intents.length ? `意图 ${intents.join(" ")}` : "",
    ]
      .filter(Boolean)
      .join("  ");
  }
  const rating = replyRating(line.scoreValue);
  if (rating) return `回复评级 ${rating.label}`;
  return typeof line.scoreValue === "number" ? "回复评级 待判断" : "";
}

function messageCovered(
  message: Detail["messages"][number],
  line: NonNullable<Detail["lines"]>[number] | undefined,
) {
  if (mediaText.test(message.text.trim())) return true;
  if (!line) return false;
  if (line.skipped) return true;
  if (message.sender === "other") return Boolean(line.emotions || line.intents);
  return typeof line.scoreValue === "number";
}

function HeartMark() {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#FF6A3D" />
      <path
        d="M16 23.5S7.2 17.8 9 12.2c1.8-5.2 7-2.6 7 0 0-2.6 5.2-5.2 7 0 1.8 5.6-7 11.3-7 11.3"
        fill="#fff"
      />
    </svg>
  );
}

function Replay({
  detail,
  onBack,
  onUpdate,
}: {
  detail: Detail;
  onBack: () => void;
  onUpdate: (detail: Detail) => void;
}) {
  const [busy, setBusy] = useState<"analyze" | "shot" | "">("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const lines = new Map((detail.lines || []).map((line) => [line.id, line]));
  const missing = detail.messages.some(
    (message) => !messageCovered(message, lines.get(message.id)),
  );
  const fileBase = (detail.otherName || detail.username || "对话").replace(
    /[\\/:*?"<>|]/g,
    "_",
  );
  const action = detail.overview?.action
    ? ACTIONS[detail.overview.action]
    : undefined;
  const stage = detail.overview?.stage
    ? STAGES[detail.overview.stage] || detail.overview.stage
    : "";
  return (
    <main className="app">
      <div className="workspace">
        <header className="grok-head">
          <button
            type="button"
            className="float-circle"
            aria-label="返回列表"
            onClick={onBack}
          >
            <ChevronLeft size={22} strokeWidth={2.25} />
          </button>
          <div className="title-pill" aria-label="已同步的分析">
            <span className="title-logo">
              <HeartMark />
            </span>
            <span className="title-text">
              {detail.otherName || detail.username || "好感度分析"}
            </span>
          </div>
          <div className="head-right">
            <span className="auth-chip">{relationLabel(detail.relation)}</span>
          </div>
        </header>
        <div className="admin-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy !== ""}
            onClick={() => {
              setErr("");
              downloadText(
                `${fileBase}.txt`,
                exportDialogue(detail.messages, detail.selfName, detail.otherName),
              );
            }}
          >
            导出文本
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy !== ""}
            onClick={() => {
              setBusy("shot");
              setErr("");
              setNote("");
              void downloadLongShot(
                `${fileBase}.png`,
                detail.otherName || "好感度分析",
                detail.affinity,
                detail.messages.map((message) => ({
                  sender: message.sender,
                  text: message.text,
                  timestamp: message.timestamp,
                  tag: tagLabel(lines.get(message.id), message.sender),
                })),
              )
                .catch((e: Error) => setErr(e.message || "长截图失败"))
                .finally(() => setBusy(""));
            }}
          >
            {busy === "shot" ? "正在生成…" : "导出长截图"}
          </button>
          {missing ? (
            <button
              type="button"
              className="primary"
              disabled={busy !== ""}
              onClick={() => {
                setBusy("analyze");
                setErr("");
                setNote("");
                void adminAnalyze(detail.id)
                  .then((body) => {
                    onUpdate(body.conversation);
                    setNote(
                      body.cached
                        ? "标签已在缓存里，没有重新分析。"
                        : "分析已写入这条对话。之后打开直接看标签。",
                    );
                  })
                  .catch((e: Error) => setErr(e.message || "分析失败"))
                  .finally(() => setBusy(""));
              }}
            >
              {busy === "analyze" ? "分析中，请稍候…" : "分析并缓存"}
            </button>
          ) : (
            <span className="admin-cached">标签已缓存</span>
          )}
        </div>
        {busy === "analyze" && (
          <p className="admin-status" role="status">
            正在逐句分析。长对话可能要几分钟，完成后会存进这条记录。
          </p>
        )}
        {note && (
          <p className="admin-status" role="status">
            {note}
          </p>
        )}
        {err && (
          <p className="error admin-action-error" role="alert">
            {err}
          </p>
        )}
        {detail.affinity != null && (
          <div className="affinity-banner">
            <span>对方对你的好感度</span>
            <strong>{detail.affinity}</strong>
            {stage && <small>{stage}</small>}
          </div>
        )}
        <div className="chat-scroll">
          <div className="timestamp">
            {detail.selfName || "我"} / {detail.otherName || "对方"} ·{" "}
            {formatTime(detail.updatedAt)} · {detail.username}
          </div>
          {!lines.size && (
            <p className="admin-replay-note">
              这条是旧同步，只有聊天原文。前端再完成一次分析后，情绪、意图和回复评级会一起出现在这里，不需要在后台重跑。
            </p>
          )}
          {detail.messages.map((m, i) => {
            const line = lines.get(m.id);
            const prev = detail.messages[i - 1];
            return (
              <div key={m.id} className={`message ${m.sender}`}>
                {m.timestamp && m.timestamp !== prev?.timestamp && (
                  <div className="timestamp">
                    {m.timestamp.replace(/^\d{4}年/, "")}
                  </div>
                )}
                <div className="message-row">
                  <div className="message-content">
                    <div className="bubble">{m.text}</div>
                    {tagLabel(line, m.sender) && (
                      <div className={`admin-tag-line ${m.sender}`}>
                        {tagLabel(line, m.sender)}
                      </div>
                    )}
                    {line && (
                      <div className={`message-tags ${m.sender}`}>
                        {line.skipped ? (
                          <span className="pending-tag">{line.skipped}</span>
                        ) : m.sender === "other" ? (
                          <>
                            <div className="analysis-row emotion-row">
                              <span className="analysis-row-label">情绪</span>
                              {topEmotions(line.emotions).map((emotion) => (
                                <span
                                  key={emotion.key}
                                  className={`emotion-tag emotion-${emotion.key}`}
                                >
                                  <span>{emotion.label}</span>
                                  <b>{emotion.percent}</b>
                                </span>
                              ))}
                            </div>
                            <div className="analysis-row intent-row">
                              <span className="analysis-row-label">意图</span>
                              {topIntents(line.intents).map((intent) => (
                                <span
                                  key={intent.key}
                                  className={`intent-tag intent-${intent.key}`}
                                >
                                  <span>{intent.label}</span>
                                  <b>{intent.percent}</b>
                                </span>
                              ))}
                            </div>
                          </>
                        ) : (
                          <span className="reply-tag">
                            <span>回复评级：</span>
                            <b>
                              {replyRating(line.scoreValue)?.label ?? "待判断"}
                            </b>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="bottom-chrome">
          {action && (
            <div className="subtle-hint">
              <span>{action.label}</span>
            </div>
          )}
          <div className="status-strip" role="status">
            <span className="completed">已同步的分析结果，后台不再调用模型</span>
          </div>
        </div>
      </div>
    </main>
  );
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
    return (
      <Replay
        detail={detail}
        onBack={() => setDetail(null)}
        onUpdate={setDetail}
      />
    );
  }

  return (
    <main className="app">
      <div className="workspace">
      <header className="grok-head">
        <span className="float-circle" aria-hidden="true" />
        <div className="title-pill">
          <span className="title-logo">
            <HeartMark />
          </span>
          <span className="title-text">
            {tab === "chats" ? `对话 ${total}` : `兑换码 ${codes.length}`}
          </span>
        </div>
        <div className="head-right">
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
      <div className="chat-scroll admin-panel">

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
                      <span className="admin-relation-chip">{relationLabel(item.relation)}</span>
                      {item.affinity != null && (
                        <span className="admin-list-badge">{item.affinity}</span>
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
      </div>
      </div>
    </main>
  );
}
