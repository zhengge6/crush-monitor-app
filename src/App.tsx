import { useVirtualizer } from "@tanstack/react-virtual";
import {
  loadConversation,
  saveConversation,
  upsertSide,
  findSide,
  loadCredentials,
  saveCredentials,
  loadRedeemSession,
  applyCacheEpoch,
  saveRedeemSession,
  getDeviceId,
  type SavedConversation,
  type SideSnapshot,
  type JevCredentials,
  type RedeemSession,
} from "./storage";
import { INTENTS, topIntents } from "../shared/intents";
import { REPLY_RATINGS, replyRating } from "../shared/ratings";
import { EMOTIONS, topEmotions } from "../shared/labels";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  X,
  RotateCcw,
  Plus,
  ArrowRight,
  Check,
  ExternalLink,
  ChevronLeft,
  ChevronDown,
  Copy,
  Monitor,
  Mic,
  AudioLines,
} from "lucide-react";
import { parseChat, toMessages, mergeMessages } from "../shared/parser";
import { compactLines } from "../shared/sync-snapshot";
import {
  RUBRIC,
  ACTIONS,
  RELATIONS,
  statusLabel,
  meanQuality,
  type Message,
  type Relation,
  type Parsed,
} from "../shared/types";
import { exampleText } from "../shared/fixtures";
import { AI_IMPORT_PROMPT } from "./importPrompt";
import { useAnalysis } from "./useAnalysis";
import {
  loadAuthToken,
  loadCachedUser,
  login as authLogin,
  register as authRegister,
  logout as authLogout,
  me as authMe,
  syncConversation,
  getClientConversationId,
  resetClientConversationId,
  type AuthUser,
} from "./auth";

/** Relation chip order: new Chinese social frames first, then classics. */
const RELATION_ORDER: Relation[] = [
  "friend",
  "advisor",
  "platonic",
  "crush",
  "new",
  "couple",
];

/** Grok-style A–D onboarding picks → relation defaults. Extra types live in settings. */
const ONBOARD_OPTIONS: {
  key: string;
  label: string;
  relation: Relation;
}[] = [
  { key: "A", label: "暧昧 / 恋爱对象", relation: "crush" },
  { key: "B", label: "朋友 / 同事", relation: "friend" },
  { key: "C", label: "社交平台互动", relation: "platonic" },
  { key: "D", label: "先随便聊聊用途", relation: "advisor" },
];

const PROVIDER_OPTIONS = [
  {
    id: "typesafe" as const,
    name: "TypeSafe",
    keyUrl: "https://console.typesafe.ai/",
  },
  {
    id: "vercel" as const,
    name: "Vercel AI Gateway",
    keyUrl: "https://vercel.com/d?to=/%5Bteam%5D/~/ai-gateway/api-keys",
  },
  {
    id: "openrouter" as const,
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/settings/keys",
  },
];

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const dragY = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);

  // Stable close ref so focus-trap mounts once (inline close would thrash IME).
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    const sheetEl = ref.current;
    const active = document.activeElement;
    const editingInside =
      !!sheetEl &&
      active instanceof HTMLElement &&
      sheetEl.contains(active) &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable);
    // Focus dialog shell only when no field inside already owns focus.
    if (!editingInside) sheetEl?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),select,textarea,input,a[href]",
          ) || [],
        );
        if (!nodes.length) return;
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (old && document.contains(old) && typeof old.focus === "function") {
        try {
          old.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const setOffset = (y: number, animate: boolean) => {
    const el = sheet.current;
    if (!el) return;
    el.style.transition = animate
      ? "transform 0.38s cubic-bezier(0.32, 0.72, 0, 1)"
      : "none";
    el.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    startY.current = e.clientY;
    dragY.current = 0;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dy = Math.max(0, e.clientY - startY.current);
    dragY.current = dy;
    setOffset(dy, false);
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragY.current > 120) {
      setOffset(window.innerHeight, true);
      setTimeout(close, 280);
    } else {
      setOffset(0, true);
    }
  };

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={(n) => {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = n;
          (sheet as React.MutableRefObject<HTMLDivElement | null>).current = n;
        }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal sheet"
      >
        <div
          className="sheet-grabber"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <header>
          <h2>{title}</h2>
          <button className="circle-btn ghost" aria-label="关闭" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}


async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function App() {
  const a = useAnalysis();
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [self, setSelf] = useState(""),
    [other, setOther] = useState("Crush"),
    [relation, setRelation] = useState<Relation>("crush");
  const [raw, setRaw] = useState(""),
    [parsed, setParsed] = useState<Parsed[]>([]),
    [role, setRole] = useState(""),
    [importing, setImporting] = useState(false),
    [settings, setSettings] = useState(false),
    [detail, setDetail] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [toast, setToast] = useState("");
  const [pasteSheet, setPasteSheet] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [importPhase, setImportPhase] = useState<"prep" | "paste">("prep");
  const [promptCopied, setPromptCopied] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlap, setOverlap] = useState<Message[] | null>(null);
  const [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState("");
  const [creds, setCreds] = useState<JevCredentials>(() => loadCredentials());
  const [keyDraft, setKeyDraft] = useState(""),
    [showKey, setShowKey] = useState(false),
    [showAdvanced, setShowAdvanced] = useState(false);
  const [redeemDraft, setRedeemDraft] = useState(""),
    [redeemSession, setRedeemSession] = useState<RedeemSession | null>(() =>
      loadRedeemSession(),
    ),
    [redeemBusy, setRedeemBusy] = useState(false),
    [redeemMsg, setRedeemMsg] = useState(""),
    [quotaLeft, setQuotaLeft] = useState<number | null>(null),
    // false = open unlimited access (default matches REDEEM_ENABLED=false deploy)
    [redeemEnabled, setRedeemEnabled] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(() =>
    loadCachedUser(),
  );
  const [authToken, setAuthToken] = useState<string | null>(() =>
    loadAuthToken(),
  );
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginTab, setLoginTab] = useState<"login" | "register">("login");
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const pendingAfterLogin = useRef<(() => void) | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientConvId = useRef<string>(getClientConversationId());
  const examplePending = useRef(false);
  const [trialLeft, setTrialLeft] = useState<number | null>(3);
  const [trialLimit, setTrialLimit] = useState(3);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockRedeem, setUnlockRedeem] = useState("");
  const [kbPad, setKbPad] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 150,
    getItemKey: useCallback((i: number) => messages[i].id, [messages]),
    overscan: 8,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 100,
  });

  // Keyboard pad ONLY while composer (or input in bottom-chrome) is focused.
  // visualViewport shrink from browser chrome must not lift the composer.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const composerFocused = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      const chrome = composerRef.current?.closest(".bottom-chrome");
      if (!chrome?.contains(el)) return false;
      const tag = el.tagName;
      return tag === "TEXTAREA" || tag === "INPUT";
    };
    const sync = () => {
      if (!composerFocused()) {
        setKbPad(0);
        return;
      }
      const overlap = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      setKbPad(overlap > 40 ? overlap : 0);
    };
    const onFocusOut = () => requestAnimationFrame(sync);
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", onFocusOut);
    sync();
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    getDeviceId(); // ensure cookie+localStorage seeded early
    let live = true;
    loadConversation()
      .then((saved) => {
        if (!live) return;
        if (saved?.schema === 1) {
          sidesRef.current = saved.sides ?? [];
          setMessages(saved.messages);
          setSelf(saved.self);
          setOther(saved.other);
          setRelation(saved.relation);
          a.restore(saved);
        }
        setReady(true);
      })
      .catch(() => {
        if (live) {
          setStorageError(
            "本机记录读取失败，请检查浏览器存储权限。为避免覆盖旧记录，暂不自动保存。",
          );
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (a.status === "error" && a.error) setNotice(a.error);
  }, [a.status, a.error]);

  // Learn whether redeem gate is on; never force-open activate sheet when off.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (applyCacheEpoch(body?.cacheEpoch)) {
          saveRedeemSession(null);
          setRedeemSession(null);
          setNotice("兑换状态已重置，请重新输入兑换码");
        }
        const on = body?.redeem?.enabled !== false;
        setRedeemEnabled(!!on);
        // Only auto-open activate sheet when redeem gate is actually required.
        if (on && ready) {
          const c = loadCredentials();
          const r = loadRedeemSession();
          if (!c.apiKey.trim() && !r?.token) setSettings(true);
        }
      } catch {
        /* offline: keep open-access default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  useEffect(() => {
    if (!loadAuthToken()) return;
    let cancelled = false;
    void authMe()
      .then((u) => {
        if (cancelled) return;
        setAuthUser(u);
        setAuthToken(loadAuthToken());
      })
      .catch(() => {
        if (cancelled) return;
        setAuthUser(null);
        setAuthToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshQuota();
  }, [ready, authToken, redeemSession?.token]);

  useEffect(() => {
    if (a.status === "error" && a.error) {
      // Server hard-gate after trial
      if (
        /试玩|登录或输入兑换码|AUTH_OR_REDEEM/i.test(a.error) ||
        a.error.includes("免费试玩")
      ) {
        setUnlockOpen(true);
      }
    }
  }, [a.status, a.error]);

  useEffect(() => {
    if (settings) {
      const c = loadCredentials();
      setCreds(c);
      setKeyDraft(c.apiKey);
      setShowKey(false);
      setShowAdvanced(!!c.apiKey);
      const r = loadRedeemSession();
      setRedeemSession(r);
      setRedeemDraft(r?.code || "");
      setRedeemMsg("");
      void refreshQuota(r);
    }
  }, [settings]);

  async function refreshQuota(session?: RedeemSession | null) {
    try {
      const s = session === undefined ? loadRedeemSession() : session;
      const deviceId = getDeviceId();
      const q = new URLSearchParams({ deviceId });
      const headers: Record<string, string> = { "X-Device-Id": deviceId };
      if (s?.token) {
        q.set("token", s.token);
        headers["X-Redeem-Token"] = s.token;
      }
      const tok = loadAuthToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(`/api/quota?${q}`, { headers });
      if (!res.ok) return;
      const body = await res.json();
      if (body.unlimited) {
        setQuotaLeft(null);
        setTrialLeft(null);
      } else if (body.trial && typeof body.trial.remaining === "number") {
        setTrialLeft(body.trial.remaining);
        if (typeof body.trial.limit === "number") setTrialLimit(body.trial.limit);
        setQuotaLeft(body.trial.remaining);
      } else {
        setQuotaLeft(
          typeof body.remainingToday === "number" ? body.remainingToday : null,
        );
      }
    } catch {
      /* offline ok */
    }
  }

  async function submitRedeem() {
    const code = redeemDraft.trim();
    if (!code) {
      setRedeemMsg("请输入兑换码");
      return;
    }
    setRedeemBusy(true);
    setRedeemMsg("");
    try {
      const deviceId = getDeviceId();
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId,
        },
        body: JSON.stringify({ code, deviceId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "兑换失败");
      const next: RedeemSession = {
        token: body.token,
        code: body.code || code.trim(),
        expiresAt: body.expiresAt,
      };
      saveRedeemSession(next);
      setRedeemSession(next);
      setQuotaLeft(
        typeof body.remainingToday === "number" ? body.remainingToday : null,
      );
      setRedeemMsg(
        body.unlimited
          ? "兑换成功 · VIP 无限次数（不限设备）"
          : `兑换成功 · 今日剩余 ${body.remainingToday}/${body.dailyLimit} 次`,
      );
    } catch (e) {
      setRedeemMsg((e as Error).message);
    } finally {
      setRedeemBusy(false);
    }
  }

  const pendingSave = useRef<SavedConversation | null>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    lastSavedMessages = useRef<Message[] | null>(null),
    sidesRef = useRef<SideSnapshot[]>([]);
  const flushSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void saveConversation(pendingSave.current).catch(() =>
      setStorageError(
        "本机保存失败，可能存储空间不足。当前页面仍可使用，请勿刷新以免丢失未保存记录。",
      ),
    );
  };
  useEffect(() => {
    if (!ready || storageError) return;
    if (messages.length) {
      const draft: SavedConversation = {
        schema: 1,
        rubric: RUBRIC,
        messages,
        self,
        other,
        relation,
        lines: a.lines,
        events: a.events,
        overview: a.overview,
        trend: a.trend,
        analyzedCount: a.analyzedCount,
        completed: a.status === "complete",
      };
      sidesRef.current = upsertSide(sidesRef.current, draft);
      draft.sides = sidesRef.current;
      pendingSave.current = draft;
    } else pendingSave.current = null;
    if (lastSavedMessages.current !== messages || a.status !== "loading") {
      lastSavedMessages.current = messages;
      flushSave();
    } else if (!saveTimer.current)
      saveTimer.current = setTimeout(flushSave, 750);
  }, [
    ready,
    messages,
    self,
    other,
    relation,
    a.lines,
    a.events,
    a.overview,
    a.trend,
    a.analyzedCount,
    a.status,
  ]);
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) flushSave();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);
  // Sync analyzed conversation to server (logged-in or trial guest, debounce 2s).
  useEffect(() => {
    if (!messages.length) return;
    if (!a.overview && a.status !== "complete") return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const dims =
        a.overview?.affinityDimensions?.map((d) => ({
          key: d.key,
          label: d.label,
          value: d.judgment?.value ?? null,
        })) ?? undefined;
      void syncConversation({
        clientConversationId: clientConvId.current,
        deviceId: getDeviceId(),
        source: authToken ? "user" : "trial",
        relation,
        selfName: self,
        otherName: other,
        affinity: a.overview?.affinity?.value ?? null,
        messages: messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          text: m.text,
          timestamp: m.timestamp,
        })),
        lines: compactLines(a.lines),
        overview: a.overview
          ? {
              affinity: {
                value: a.overview.affinity?.value ?? null,
                confidence: a.overview.affinity?.confidence,
                status: a.overview.affinity?.status,
              },
              dimensions: dims,
              stage: a.overview.stage,
              action: a.overview.action,
              status: a.status,
            }
          : undefined,
      }).catch(() => {
        /* sync failure must not block analysis */
      });
    }, 800);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [
    authToken,
    messages,
    relation,
    self,
    other,
    a.overview,
    a.lines,
    a.status,
  ]);

  const stay = useRef(true);
  useEffect(() => {
    if (messages.length && stay.current)
      virtual.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messages.length]);
  const busy = a.status === "loading",
    ov = a.overview,
    value = ov?.affinity.value,
    quality = meanQuality(messages, a.lines);
  const last = a.trend.at(-1),
    previous = a.trend.at(-2);
  const delta =
    a.status === "complete" && last?.value != null && previous?.value != null
      ? last.value - previous.value
      : null;
  function hasUnlimitedAccess() {
    // Login alone is not enough — need redeem/VIP session (or own API key).
    if (loadCredentials().apiKey.trim()) return true;
    if (loadRedeemSession()?.token) return true;
    return false;
  }
  function openUnlock(pending?: () => void) {
    if (pending) pendingAfterLogin.current = pending;
    setLoginErr("");
    setUnlockRedeem("");
    setUnlockOpen(true);
  }
  function start(ms: Message[], opts?: { example?: boolean }) {
    setMessages(ms);
    setInput("");
    const example = !!opts?.example || examplePending.current;
    examplePending.current = false;
    if (!example && !hasUnlimitedAccess()) {
      if (trialLeft !== null && trialLeft <= 0) {
        openUnlock(() => start(ms, opts));
        setNotice("免费试玩次数已用完，请输入兑换码");
        return;
      }
    }
    if (redeemEnabled && !hasUnlimitedAccess() && !example) {
      const c = loadCredentials();
      const r = loadRedeemSession();
      if (!c.apiKey.trim() && !r?.token && trialLeft !== null && trialLeft <= 0) {
        openUnlock(() => start(ms, opts));
        return;
      }
    }
    a.run(ms, relation, { example });
    // Optimistic trial tick for real runs (server is source of truth)
    if (!example && !hasUnlimitedAccess() && trialLeft !== null && trialLeft > 0) {
      setTrialLeft((n) => (n === null ? n : Math.max(0, n - 1)));
    }
    void refreshQuota();
  }
  function add(
    ms: Message[],
    mode: "auto" | "append" | "skip" = "auto",
    opts?: { example?: boolean },
  ) {
    const m = mergeMessages(messages, ms, mode);
    if (m.ambiguous) {
      setOverlap(ms);
      return;
    }
    if (!m.added) {
      setNotice("没有新增消息，这段已经分析过了。");
      setInput("");
      return;
    }
    setNotice("");
    start(m.messages, opts);
  }
  function prepare(text: string, opts?: { example?: boolean }) {
    if (!text.trim()) return;
    if (text.length > 250000) {
      setNotice("这次粘贴超过25万字符，请分几次追加；历史记录不会被截断。");
      return;
    }
    examplePending.current = !!opts?.example;
    const p = parseChat(text);
    const names = [...new Set(p.messages.map((x) => x.speaker))];
    if (
      messages.length &&
      self &&
      !p.warnings.length &&
      names.every((n) => n === self || n === other)
    ) {
      add(toMessages(p.messages, self), "auto", opts);
      return;
    }
    setRaw(text);
    setParsed(p.messages);
    setRole(names.includes(self) ? self : names.includes("我") ? "我" : "");
    setImporting(true);
  }
  function confirmImport() {
    try {
      if (!role) {
        setNotice("请先选择聊天里的你");
        return;
      }
      // Soft redeem gate only when redeem fully enabled AND no trial/login
      if (redeemEnabled && !hasAccess && !hasUnlimitedAccess() && (trialLeft ?? 0) <= 0) {
        setImporting(false);
        openUnlock();
        return;
      }
      if (!hasUnlimitedAccess() && trialLeft !== null && trialLeft <= 0 && !examplePending.current) {
        setImporting(false);
        openUnlock(() => confirmImport());
        return;
      }
      const names = [...new Set(parsed.map((x) => x.speaker))];
      setSelf(role);
      setOther(names.find((n) => n !== role) || "Crush");
      setImporting(false);
      add(toMessages(parsed, role), "auto", {
        example: examplePending.current,
      });
    } catch (e) {
      setNotice((e as Error).message || "开始分析失败，请重试");
      setImporting(false);
    }
  }
  /** Clear local UI + IndexedDB workspace; server copies already synced stay for admin review. */
  function clear() {
    resetClientConversationId();
    clientConvId.current = getClientConversationId();
    a.reset();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    pendingSave.current = null;
    void saveConversation(null)
      .then(() => setStorageError(""))
      .catch(() => setStorageError("本机记录删除失败，请重试清空。"));
    sidesRef.current = [];
    setMessages([]);
    setInput("");
    setSelf("");
    setOther("Crush");
    setNotice("");
    setSettings(false);
    setDetail(null);
  }
  function persistCreds(next: JevCredentials) {
    setCreds(next);
    saveCredentials(next);
  }
  const names = [...new Set(parsed.map((x) => x.speaker))];
  const pasteParsed = pasteDraft.trim() ? parseChat(pasteDraft) : null;
  const pasteSpeakers = pasteParsed
    ? [...new Set(pasteParsed.messages.map((m) => m.speaker))]
    : [];
  const pasteNamed = pasteSpeakers.filter((n) => n !== "未分配");
  const pasteHint = pasteParsed
    ? {
        ok:
          pasteParsed.messages.length > 0 &&
          !pasteSpeakers.includes("未分配") &&
          pasteNamed.length >= 1 &&
          pasteNamed.length <= 2,
        count: pasteParsed.messages.length,
        speakers: pasteNamed.length,
        unassigned: pasteSpeakers.includes("未分配"),
      }
    : { ok: false, count: 0, speakers: 0, unassigned: false };
  const chosen = messages.find((m) => m.id === detail),
    result = detail ? a.lines[detail] : undefined;
  const activeProvider =
    PROVIDER_OPTIONS.find((p) => p.id === creds.provider) || PROVIDER_OPTIONS[0];
  const hasAccess =
    !redeemEnabled || !!(creds.apiKey.trim() || redeemSession?.token);

  const closeSettings = useCallback(() => setSettings(false), []);
  const closeImporting = useCallback(() => setImporting(false), []);
  const showCopiedToast = useCallback((msg = "指令已复制") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }, []);
  const markPromptCopied = useCallback(() => {
    setPromptCopied(true);
    showCopiedToast("指令已复制");
    if (promptCopiedTimer.current) clearTimeout(promptCopiedTimer.current);
    promptCopiedTimer.current = setTimeout(() => setPromptCopied(false), 2000);
  }, [showCopiedToast]);
  const copyAiPrompt = useCallback(async () => {
    if (copyBusy) return;
    setCopyBusy(true);
    const ok = await copyText(AI_IMPORT_PROMPT);
    setCopyBusy(false);
    if (ok) markPromptCopied();
  }, [copyBusy, markPromptCopied]);
  const closePasteSheet = useCallback(() => {
    setPasteSheet(false);
    setPasteDraft("");
    setImportPhase("prep");
    setPromptCopied(false);
    setPromptOpen(false);
  }, []);
  const openPasteSheet = useCallback(() => {
    setPasteDraft("");
    setImportPhase("prep");
    setPromptCopied(false);
    setPromptOpen(false);
    setPasteSheet(true);
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);
  const closeOverlap = useCallback(() => setOverlap(null), []);
  const closeLogin = useCallback(() => {
    setLoginOpen(false);
    setLoginErr("");
    pendingAfterLogin.current = null;
  }, []);
  const closeUnlock = useCallback(() => {
    setUnlockOpen(false);
    setLoginErr("");
    setUnlockRedeem("");
    pendingAfterLogin.current = null;
  }, []);
  async function submitAuth() {
    const u = loginUser.trim();
    const p = loginPass;
    if (!u || !p) {
      setLoginErr("请填写用户名和密码");
      return;
    }
    setLoginBusy(true);
    setLoginErr("");
    try {
      const res =
        loginTab === "register"
          ? await authRegister(u, p)
          : await authLogin(u, p);
      setAuthUser(res.user);
      setAuthToken(res.token);
      setLoginOpen(false);
      setLoginPass("");
      void refreshQuota();
      // Login alone does not unlock analyze — keep unlock sheet if open.
      if (unlockOpen) {
        setLoginErr("登录成功。继续分析仍需输入兑换码。");
        pendingAfterLogin.current = null;
      } else {
        const pending = pendingAfterLogin.current;
        pendingAfterLogin.current = null;
        if (pending && hasUnlimitedAccess()) pending();
      }
    } catch (e) {
      setLoginErr((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }
  async function submitUnlockRedeem() {
    const code = unlockRedeem.trim();
    if (!code) {
      setLoginErr("请输入兑换码");
      return;
    }
    setLoginBusy(true);
    setLoginErr("");
    try {
      const deviceId = getDeviceId();
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId,
        },
        body: JSON.stringify({ code, deviceId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "兑换失败");
      const next: RedeemSession = {
        token: body.token,
        code: body.code || code,
        expiresAt: body.expiresAt,
      };
      saveRedeemSession(next);
      setRedeemSession(next);
      setTrialLeft(null);
      setUnlockOpen(false);
      void refreshQuota();
      const pending = pendingAfterLogin.current;
      pendingAfterLogin.current = null;
      if (pending) pending();
    } catch (e) {
      setLoginErr((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }

    const shellStyle = {
    ["--kb-pad" as string]: `${kbPad}px`,
  } as CSSProperties;

  return (
    <main className="app" style={shellStyle}>
      <div className="workspace">
        <header className="grok-head">
          <button
            className="float-circle"
            aria-label="返回"
            onClick={() => {
              if (messages.length) setDetail("clear");
            }}
          >
            <ChevronLeft size={22} strokeWidth={2.25} />
          </button>
          <div className="title-pill" aria-label="好感度分析">
            <span className="title-logo" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="22" height="22">
                <circle cx="16" cy="16" r="16" fill="#FF6A3D" />
                <path
                  d="M16 23.5S7.2 17.8 9 12.2c1.8-5.2 7-2.6 7 0 0-2.6 5.2-5.2 7 0 1.8 5.6-7 11.3-7 11.3"
                  fill="#fff"
                />
              </svg>
            </span>
            <span className="title-text">好感度分析</span>
          </div>
          <div className="head-right">
            {authUser ? (
              <button
                type="button"
                className="auth-chip"
                title="点击退出登录"
                onClick={() => {
                  if (confirm(`退出账号「${authUser.username}」？`)) {
                    void authLogout().then(() => {
                      setAuthUser(null);
                      setAuthToken(null);
                    });
                  }
                }}
              >
                {authUser.username}
              </button>
            ) : (
              <button
                type="button"
                className="auth-login-btn"
                onClick={() => {
                  setLoginTab("login");
                  setLoginErr("");
                  setLoginOpen(true);
                }}
              >
                登录
              </button>
            )}
            <button
              className="float-circle"
              aria-label="设置"
              onClick={() => setSettings(true)}
            >
              <Monitor size={18} strokeWidth={1.9} />
            </button>
          </div>
        </header>

        {value != null && (
          <button
            type="button"
            className="affinity-banner"
            onClick={() => setDetail("overview")}
          >
            <span>对方对你的好感度</span>
            <strong key={value}>{value}</strong>
            {delta != null && delta !== 0 && (
              <small>
                {delta > 0 ? "+" : ""}
                {delta}
              </small>
            )}
          </button>
        )}

        <div
          ref={scroller}
          className="chat-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            stay.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          {!messages.length ? (
            <div className="empty">
              <div className="chat-time">今天 {new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
              <div className="onboard-card" role="radiogroup" aria-label="分析类型">
                <h2 className="onboard-title">这次最想分析哪一类？</h2>
                <p className="onboard-sub">选一个就行，之后你可以随时换。</p>
                <div className="onboard-options">
                  {ONBOARD_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      role="radio"
                      aria-checked={relation === opt.relation}
                      className={`onboard-option ${relation === opt.relation ? "selected" : ""}`}
                      onClick={() => setRelation(opt.relation)}
                    >
                      <span className="onboard-letter">{opt.key}</span>
                      <span className="onboard-label">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="import-entry">
                <h3 className="import-entry-title">怎么导入聊天？</h3>
                <p className="import-entry-sub">
                  微信长截图 → 任意 AI 整理成文字 → 贴回来
                </p>
                <button
                  type="button"
                  className="primary import-entry-primary"
                  onClick={openPasteSheet}
                >
                  有截图，开始导入
                </button>
                <div className="import-entry-secondary">
                  <button
                    type="button"
                    className="text-button secondary-link"
                    onClick={openPasteSheet}
                  >
                    直接粘贴文字
                  </button>
                  <span className="import-entry-dot" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    className="text-button secondary-link"
                    onClick={() => prepare(exampleText(0), { example: true })}
                  >
                    用示例试试
                  </button>
                </div>
                {redeemEnabled && !hasAccess && (
                  <button
                    type="button"
                    className="text-button secondary-link import-entry-redeem"
                    onClick={() => setSettings(true)}
                  >
                    填写兑换码
                  </button>
                )}
                <p className="privacy-note">
                  {hasUnlimitedAccess()
                    ? "已兑换解锁"
                    : trialLeft === null
                      ? "已解锁无限次分析"
                      : trialLeft > 0
                        ? `还可试玩 ${trialLeft} 次 · 超额需兑换码`
                        : "试玩已用完 · 请输入兑换码"}
                </p>
              </div>
            </div>
          ) : (
            <div
              style={{
                height: virtual.getTotalSize(),
                position: "relative",
                width: "100%",
              }}
            >
              {virtual.getVirtualItems().map((row) => {
                const i = row.index,
                  m = messages[i];
                const r = a.lines[m.id];
                return (
                  <div
                    key={m.id}
                    data-index={row.index}
                    ref={virtual.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${row.start}px)`,
                    }}
                    id={`message-${m.id}`}
                    className={`message ${m.sender}`}
                  >
                    {(i === 0 || m.timestamp !== messages[i - 1].timestamp) &&
                      m.timestamp && (
                        <div className="timestamp">
                          {m.timestamp.replace(/^\d{4}年/, "")}
                        </div>
                      )}
                    <div className="message-row">
                      <div className="message-content">
                        <div className="bubble">{m.text}</div>
                        {m.kind === "text" && (
                          <div className={`message-tags ${m.sender}`}>
                            {r?.skipped ? (
                              <span className="pending-tag">{r.skipped}</span>
                            ) : m.sender === "other" ? (
                              <>
                                <div className="analysis-row emotion-row">
                                  <span className="analysis-row-label">
                                    情绪
                                  </span>
                                  {r?.emotions ? (
                                    topEmotions(r.emotions).map((emotion) => (
                                      <button
                                        key={emotion.key}
                                        className={`emotion-tag emotion-${emotion.key}`}
                                        onClick={() => setDetail(m.id)}
                                        aria-label={`${emotion.label} ${emotion.percent}，查看情绪分析：${m.text}`}
                                      >
                                        <span>{emotion.label}</span>
                                        <b>{emotion.percent}</b>
                                      </button>
                                    ))
                                  ) : (
                                    <button
                                      className="pending-tag"
                                      disabled={busy}
                                      onClick={() => a.run(messages, relation)}
                                    >
                                      {busy ? "分析中" : "分析情绪"}
                                    </button>
                                  )}
                                </div>
                                <div className="analysis-row intent-row">
                                  <span className="analysis-row-label">
                                    意图
                                  </span>
                                  {r?.intents ? (
                                    topIntents(r.intents).map((intent) => (
                                      <button
                                        key={intent.key}
                                        className={`intent-tag intent-${intent.key}`}
                                        onClick={() => setDetail(m.id)}
                                        aria-label={`${intent.label} ${intent.percent}，查看意图分析：${m.text}`}
                                      >
                                        <span>{intent.label}</span>
                                        <b>{intent.percent}</b>
                                      </button>
                                    ))
                                  ) : (
                                    <button
                                      className="pending-tag"
                                      disabled={busy}
                                      onClick={() => a.run(messages, relation)}
                                    >
                                      {busy ? "分析中" : "分析意图"}
                                    </button>
                                  )}
                                </div>
                              </>
                            ) : r ? (
                              <button
                                className="reply-tag"
                                onClick={() => setDetail(m.id)}
                                aria-label={`查看回复评价：${m.text}`}
                              >
                                <span>回复评级：</span>
                                <b>
                                  {replyRating(r.score.value)?.label ??
                                    "待判断"}
                                </b>
                              </button>
                            ) : (
                              <button
                                className="pending-tag"
                                disabled={busy}
                                onClick={() => a.run(messages, relation)}
                              >
                                {busy ? "分析中" : "评价回复"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bottom-chrome">
          {messages.length > 0 && (ov || quality != null) && (
            <button
              type="button"
              className="subtle-hint"
              onClick={() => setDetail(ov ? "action" : "performance")}
            >
              <span>{ov ? ACTIONS[ov.action]?.label : replyRating(quality)?.label}</span>
              <ArrowRight size={13} />
            </button>
          )}

          {(storageError ||
            notice ||
            busy ||
            a.status === "error" ||
            (messages.length > 0 &&
              (a.status === "complete" || a.status === "idle"))) && (
            <div className="status-strip" role="status">
              {storageError || notice ? (
                <span className={storageError ? "error" : ""}>
                  {storageError || notice}
                </span>
              ) : busy ? (
                <>
                  <span className="working" />
                  分析中 {a.progress.done}/{a.progress.total}
                  <button type="button" onClick={a.cancel}>
                    停止
                  </button>
                </>
              ) : a.status === "error" ? (
                <>
                  <span className="error">{a.error || "分析未完成"}</span>
                  <button type="button" onClick={() => a.run(messages, relation)}>
                    <RotateCcw size={14} />
                    重试
                  </button>
                </>
              ) : a.status === "complete" ? (
                <span className="completed">
                  <Check size={14} />
                  完成
                  {quotaLeft != null && !creds.apiKey && (
                    <em> · 剩 {quotaLeft}</em>
                  )}
                </span>
              ) : messages.length ? (
                <>
                  <span>已暂停</span>
                  <button type="button" onClick={() => a.run(messages, relation)}>
                    继续
                  </button>
                </>
              ) : null}
            </div>
          )}

          <div className="composer" ref={composerRef}>
            <button
              className="float-circle composer-plus"
              aria-label={messages.length ? "新聊天" : "导入聊天"}
              onClick={() =>
                messages.length ? setDetail("clear") : openPasteSheet()
              }
            >
              <Plus size={22} strokeWidth={2.25} />
            </button>
            <div className="composer-pill">
              <textarea
                aria-label="向好感度分析提问"
                disabled={!ready}
                rows={1}
                placeholder="向 好感度分析 提问"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  const t = e.clipboardData.getData("text");
                  if (t.trim()) {
                    e.preventDefault();
                    setInput(t);
                    prepare(t);
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                    prepare(input);
                }}
              />
              <span className="composer-mic" aria-hidden="true">
                <Mic size={18} strokeWidth={1.9} />
              </span>
            </div>
            <button
              className="send-circle"
              aria-label="发送"
              disabled={!input.trim()}
              onClick={() => prepare(input)}
            >
              <AudioLines size={18} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>

      {pasteSheet && (
        <Modal title="导入聊天" close={closePasteSheet}>
          {importPhase === "prep" ? (
            <div className="import-wizard">
              <p className="import-lead">
                先复制下面这段指令，连同微信长截图发给豆包 / ChatGPT / Claude 等
              </p>
              <button
                type="button"
                className={`primary copy-ai-btn ${promptCopied ? "copied" : ""}`}
                onClick={() => void copyAiPrompt()}
                disabled={copyBusy}
              >
                {promptCopied ? (
                  <>
                    <Check size={16} strokeWidth={2.4} />
                    已复制 ✓
                  </>
                ) : (
                  <>
                    <Copy size={16} strokeWidth={2.2} />
                    复制指令
                  </>
                )}
              </button>
              {promptCopied && (
                <p className="import-tip">
                  打开任意 AI，粘贴指令并上传截图，整理好后再回来
                </p>
              )}
              <details
                className="import-prompt-preview soft"
                open={promptOpen}
                onToggle={(e) =>
                  setPromptOpen((e.target as HTMLDetailsElement).open)
                }
              >
                <summary>
                  <ChevronDown size={14} strokeWidth={2.2} />
                  看看指令长什么样
                </summary>
                <pre>{AI_IMPORT_PROMPT}</pre>
              </details>
              <div className="import-wizard-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => setImportPhase("paste")}
                >
                  我已经拿到文字了
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    closePasteSheet();
                    prepare(exampleText(0), { example: true });
                  }}
                >
                  用示例跳过
                </button>
                <button
                  type="button"
                  className="text-button secondary-link"
                  onClick={() => setImportPhase("paste")}
                >
                  跳过，直接粘贴
                </button>
              </div>
            </div>
          ) : (
            <div className="import-wizard">
              <p className="import-lead">把 AI 整理好的聊天贴在下面</p>
              <label className="field soft-label">
                <textarea
                  value={pasteDraft}
                  placeholder={"我：在吗？\n景甜：哈哈你还记得啊"}
                  onChange={(e) => setPasteDraft(e.target.value)}
                  rows={8}
                  aria-label="粘贴聊天文字"
                />
              </label>
              {pasteDraft.trim() ? (
                pasteHint.ok ? (
                  <p className="import-parse-hint">
                    识别到 {pasteHint.count} 条 · {pasteHint.speakers} 个人
                  </p>
                ) : (
                  <p className="import-parse-hint warn">
                    {pasteHint.unassigned
                      ? "没认出发送人。改成一行一条：「我：内容」「对方：内容」。"
                      : pasteHint.speakers > 2
                        ? `认出了 ${pasteHint.speakers} 个人，这里只分析两个人的聊天。`
                        : "还没识别到消息，试试「我：内容」格式"}
                  </p>
                )
              ) : null}
              <div className="import-wizard-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!pasteHint.ok}
                  onClick={() => {
                    const t = pasteDraft;
                    closePasteSheet();
                    prepare(t);
                  }}
                >
                  下一步
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setImportPhase("prep")}
                >
                  返回上一步
                </button>
                <button
                  type="button"
                  className="text-button secondary-link"
                  onClick={() => {
                    closePasteSheet();
                    prepare(exampleText(0), { example: true });
                  }}
                >
                  用示例试试
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {importing && (
        <Modal title="必选 · 哪边是你？" close={closeImporting}>
          <div className="role-callout" role="status">
            <strong>先点选你是哪一边</strong>
            <p>
              微信里自己一侧常显示为「我」。不选的话，下面的「开始分析」会一直是灰色，没法点。
            </p>
          </div>
          <p className="role-step-label">第一步：点选代表你的那一侧</p>
          <div className={`role-options ${role ? "picked" : "need-pick"}`}>
            {names
              .filter((n) => n !== "未分配")
              .map((n) => (
                <button
                  type="button"
                  className={role === n ? "selected" : ""}
                  key={n}
                  onClick={() => setRole(n)}
                >
                  <span className="role-option-name">{n}</span>
                  <span className="role-option-hint">
                    {role === n ? "已选为你" : "点我 · 这是我"}
                  </span>
                </button>
              ))}
            {names.length === 1 && names[0] !== "未分配" && (
              <button
                type="button"
                className={role === "__self_absent__" ? "selected" : ""}
                onClick={() => setRole("__self_absent__")}
              >
                <span className="role-option-name">这些都是对方的话</span>
                <span className="role-option-hint">
                  {role === "__self_absent__" ? "已选" : "点我确认"}
                </span>
              </button>
            )}
          </div>
          {!role && (
            <p className="role-need-hint">↑ 请先点上面其中一个，选完按钮才会亮起</p>
          )}
          <label className="field soft-label">
            预览（可改） · 共 {parsed.length} 条
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setParsed(parseChat(e.target.value).messages);
              }}
            />
          </label>
          {names.includes("未分配") ? (
            <p className="error">
              没认出发送人，所以「开始分析」是灰的。把预览改成一行一条：「我：内容」「对方：内容」。
            </p>
          ) : names.length > 2 ? (
            <p className="error">
              {`认出了 ${names.length} 个名字（${names.join("、")}），超过两个人，按钮不会亮。请改成「我：内容」「对方：内容」。`}
            </p>
          ) : null}
          <button
            className="primary"
            disabled={
              !role ||
              !parsed.length ||
              names.length > 2 ||
              names.includes("未分配") ||
              (!names.includes(role) && role !== "__self_absent__")
            }
            onClick={confirmImport}
          >
            {role ? "开始分析" : "请先选择你是哪一边"}
          </button>
        </Modal>
      )}

      {unlockOpen && (
        <Modal title="继续分析" close={closeUnlock}>
          <p className="activate-lead">
            免费试玩已用完。请输入兑换码解锁后继续使用（登录不能单独解锁分析）。
          </p>
          <label className="field">
            兑换码
            <input
              value={unlockRedeem}
              onChange={(e) => setUnlockRedeem(e.target.value)}
              placeholder="输入兑换码"
              autoComplete="off"
              autoFocus
            />
          </label>
          {loginErr && <p className="error">{loginErr}</p>}
          <button
            className="primary unlock-redeem-btn"
            disabled={loginBusy || !unlockRedeem.trim()}
            onClick={() => void submitUnlockRedeem()}
          >
            {loginBusy ? "请稍候…" : "输入兑换码解锁"}
          </button>
          <div className="unlock-divider">可选</div>
          <p className="activate-lead" style={{ marginTop: 0 }}>
            登录仅用于账号功能，不会解锁分析次数。
          </p>
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={loginTab === "login"}
              className={loginTab === "login" ? "selected" : ""}
              onClick={() => {
                setLoginTab("login");
                setLoginErr("");
              }}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loginTab === "register"}
              className={loginTab === "register" ? "selected" : ""}
              onClick={() => {
                setLoginTab("register");
                setLoginErr("");
              }}
            >
              注册
            </button>
          </div>
          <label className="field">
            用户名
            <input
              value={loginUser}
              onChange={(e) => setLoginUser(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            密码
            <input
              type="password"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              autoComplete={
                loginTab === "register" ? "new-password" : "current-password"
              }
            />
          </label>
          <button
            className="secondary-btn"
            disabled={loginBusy || !loginUser.trim() || loginPass.length < 6}
            onClick={() => void submitAuth()}
          >
            {loginBusy
              ? "请稍候…"
              : loginTab === "register"
                ? "注册账号"
                : "登录账号"}
          </button>
        </Modal>
      )}

      {loginOpen && (
        <Modal title={loginTab === "register" ? "注册" : "登录"} close={closeLogin}>
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={loginTab === "login"}
              className={loginTab === "login" ? "selected" : ""}
              onClick={() => {
                setLoginTab("login");
                setLoginErr("");
              }}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={loginTab === "register"}
              className={loginTab === "register" ? "selected" : ""}
              onClick={() => {
                setLoginTab("register");
                setLoginErr("");
              }}
            >
              注册
            </button>
          </div>
          <label className="field">
            用户名
            <input
              value={loginUser}
              onChange={(e) => setLoginUser(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="3–32 字符"
            />
          </label>
          <label className="field">
            密码
            <input
              type="password"
              value={loginPass}
              onChange={(e) => setLoginPass(e.target.value)}
              autoComplete={
                loginTab === "register" ? "new-password" : "current-password"
              }
              placeholder="至少 6 位"
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitAuth();
              }}
            />
          </label>
          {loginErr && <p className="error">{loginErr}</p>}
          <button
            className="primary"
            disabled={loginBusy || !loginUser.trim() || loginPass.length < 6}
            onClick={() => void submitAuth()}
          >
            {loginBusy
              ? "请稍候…"
              : loginTab === "register"
                ? "注册并登录"
                : "登录"}
          </button>
        </Modal>
      )}

      {settings && (
        <Modal
          title={
            redeemEnabled && !hasAccess ? "激活好感度分析" : "设置"
          }
          close={closeSettings}
        >
          {redeemEnabled && !hasAccess && (
            <p className="activate-lead">
              输入兑换码即可开始分析。没有兑换码也可以在下方高级选项粘贴自己的
              API Key。
            </p>
          )}
          {!redeemEnabled && (
            <p className="activate-lead">
              已开放免费无限次分析（服务端内置 Key）。下方兑换码与个人 API Key
              均为可选。
            </p>
          )}
          <label className="field">
            你们的关系
            <div className="chip-wrap" role="radiogroup" aria-label="关系类型">
              {RELATION_ORDER.map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={relation === k}
                  className={`rel-chip ${relation === k ? "selected" : ""}`}
                  onClick={() => {
                    setRelation(k);
                    if (messages.length) a.run(messages, k);
                  }}
                >
                  {RELATIONS[k]}
                </button>
              ))}
            </div>
          </label>

          {redeemEnabled ? (
            <>
              <label className="field">
                兑换码
                <div className="key-row">
                  <input
                    type="text"
                    inputMode="text"
                    enterKeyHint="done"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="输入管理员发放的兑换码"
                    value={redeemDraft}
                    onChange={(e) => setRedeemDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void submitRedeem();
                      }
                    }}
                    aria-label="兑换码"
                  />
                  <button
                    type="button"
                    className="secondary compact"
                    disabled={redeemBusy}
                    onClick={() => void submitRedeem()}
                  >
                    {redeemBusy ? "…" : "兑换"}
                  </button>
                </div>
              </label>
              {redeemMsg && (
                <p className={redeemMsg.includes("成功") ? "" : "error"}>
                  {redeemMsg}
                </p>
              )}
              {redeemSession && (
                <p>
                  已绑定兑换码 <strong>{redeemSession.code}</strong>
                  {quotaLeft == null
                    ? " · VIP 无限次数（不限设备）"
                    : ` · 今日剩余 ${quotaLeft} 次。每设备每天 3 次（用内置 Key）。无痕模式会重置设备标识`}
                  。
                </p>
              )}
            </>
          ) : (
            redeemSession && (
              <p>
                本机仍保留兑换会话 <strong>{redeemSession.code}</strong>
                （当前开放无限次，兑换码非必需）。
              </p>
            )
          )}

          <button
            type="button"
            className="text-button secondary-link"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "收起高级选项" : "高级：使用自己的 API Key"}
          </button>

          {showAdvanced && (
            <>
              <label className="field">
                模型平台
                <div
                  className="segmented stacked"
                  role="radiogroup"
                  aria-label="平台"
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      role="radio"
                      aria-checked={creds.provider === p.id}
                      className={creds.provider === p.id ? "selected" : ""}
                      onClick={() => {
                        const next = { ...creds, provider: p.id };
                        persistCreds(next);
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                API Key（仅保存在本机，可选覆盖）
                <div className="key-row">
                  <input
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="粘贴你的 Key…"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onBlur={() =>
                      persistCreds({ ...creds, apiKey: keyDraft.trim() })
                    }
                    aria-label="API Key"
                  />
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? "隐藏" : "显示"}
                  </button>
                </div>
              </label>
              <a
                className="external-link"
                href={activeProvider.keyUrl}
                target="_blank"
                rel="noreferrer"
              >
                打开 {activeProvider.name} 控制台获取 Key
                <ExternalLink size={14} />
              </a>
            </>
          )}

          <button
            className="primary"
            onClick={() => {
              persistCreds({ ...creds, apiKey: keyDraft.trim() });
              setSettings(false);
            }}
          >
            完成
          </button>
          <button
            className="secondary"
            disabled={!messages.length}
            onClick={() => {
              const ms = messages.map((m) => ({
                ...m,
                sender:
                  m.sender === "self" ? ("other" as const) : ("self" as const),
              }));
              const current: SavedConversation = {
                schema: 1,
                rubric: RUBRIC,
                messages,
                self,
                other,
                relation,
                lines: a.lines,
                events: a.events,
                overview: a.overview,
                trend: a.trend,
                analyzedCount: a.analyzedCount,
                completed: a.status === "complete",
              };
              sidesRef.current = upsertSide(sidesRef.current, current);
              const hit = findSide(sidesRef.current, ms, relation);
              const nextSelf = other;
              const nextOther = self === "__self_absent__" ? "我" : self;
              setSelf(hit?.self || nextSelf);
              setOther(hit?.other || nextOther);
              setMessages(hit?.messages || ms);
              setSettings(false);
              if (hit) {
                a.restore({ schema: 1, ...hit, sides: sidesRef.current });
                setNotice("这个身份之前分析过，已直接用缓存。");
                return;
              }
              a.reset();
              a.run(ms, relation);
            }}
          >
            交换双方身份
          </button>
          <button className="secondary danger" onClick={clear}>
            清空聊天，重新开始
          </button>
          <p>
            已保存 {messages.length.toLocaleString()}{" "}
            条聊天。记录保存在本机浏览器；
            {redeemEnabled
              ? "默认走服务端内置 Key + 兑换码额度。"
              : "默认走服务端内置 Key，无限次免费分析。"}
            自己的 Key 只留在本机，不会写入服务器。
          </p>
        </Modal>
      )}

      {detail === "clear" && (
        <Modal title="开始新的聊天？" close={closeDetail}>
          <p>当前聊天、分析和本机浏览器保存的记录都会删除（仅本机，不影响其他设备）。</p>
          <button className="primary" onClick={clear}>
            开始新聊天
          </button>
          <button className="secondary" onClick={() => setDetail(null)}>
            保留当前聊天
          </button>
        </Modal>
      )}

      {detail && detail !== "clear" && (
        <Modal
          title={
            detail === "overview"
              ? "对方对你的好感度"
              : detail === "action"
                ? "下一步"
                : detail === "performance"
                  ? "我的发挥"
                  : chosen?.sender === "other"
                    ? "情绪与意图"
                    : "回复评价"
          }
          close={closeDetail}
        >
          {detail === "overview" ? (
            <>
              <p>
                估的是对方对你的好感信号（0—100），不是你对对方，也不是「喜欢你的概率」。
              </p>
              <p>
                根据近期对话和相关历史原话评分，旧分数不参与计算。证据少时仍保留分数供娱乐参考。
              </p>
              {!!ov?.memoryEvidenceIds?.length && (
                <details>
                  <summary>参考的历史原话</summary>
                  {[...new Set(ov.memoryEvidenceIds)].map((id) => {
                    const m = messages.find((m) => m.id === id);
                    return m ? (
                      <blockquote key={id}>
                        {m.sender === "self" ? self : other}：{m.text}
                      </blockquote>
                    ) : null;
                  })}
                </details>
              )}
              {ov?.affinityDimensions && (
                <div className="affinity-breakdown">
                  {ov.affinityDimensions.map((d) => (
                    <div key={d.key}>
                      <span>{d.label}</span>
                      <meter
                        min={0}
                        max={100}
                        value={d.judgment.value ?? 0}
                        aria-label={`${d.label} ${d.judgment.value} 分`}
                      />
                      <strong>{d.judgment.value}</strong>
                      <small>
                        占 {d.weight}% · {statusLabel(d.judgment)}
                      </small>
                    </div>
                  ))}
                </div>
              )}
              {ov?.boundaryApplied && (
                <p>
                  对方表达了明确且仍有效的拒绝边界。综合原分{" "}
                  {ov.affinityRawValue}，最终好感度最多显示 25 分。
                </p>
              )}
              {ov && (
                <p>
                  本轮判断：{statusLabel(ov.affinity)}。综合确定度{" "}
                  {Math.round(ov.affinity.confidence * 100)}%。
                </p>
              )}
            </>
          ) : detail === "action" ? (
            <>
              <h3>{ov ? ACTIONS[ov.action]?.label : "等待聊天"}</h3>
              <p>{ov ? ACTIONS[ov.action]?.detail : "导入后生成建议。"}</p>
              {ov?.actionEvidenceId && (
                <blockquote>
                  {messages.find((m) => m.id === ov.actionEvidenceId)?.text}
                </blockquote>
              )}
            </>
          ) : detail === "performance" ? (
            <>
              <div className="detail-score">
                {quality ?? "—"}
                <span>/100</span>
              </div>
              <p>
                已完成分析的我方回复平均分。Jev
                根据发出时的前文评价表达质量，再按固定分数区间显示评级。
              </p>
              <div className="reply-guide">
                {REPLY_RATINGS.map((v) => (
                  <p key={v.label}>
                    <strong>
                      {v.label} · {v.range} 分
                    </strong>
                    ：{v.description}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <>
              <blockquote>{chosen?.text}</blockquote>
              {chosen?.sender === "other" ? (
                <>
                  <h3>情绪</h3>
                  <div className="emotion-distribution">
                    {Object.entries(result?.emotions || {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([key, p]) => (
                        <div key={key}>
                          <span>
                            {EMOTIONS[key as keyof typeof EMOTIONS]?.label ||
                              key}
                          </span>
                          <div className="probability-track">
                            <i style={{ width: `${p * 100}%` }} />
                          </div>
                          <b>
                            {p > 0 && p < 0.005
                              ? "<1%"
                              : `${Math.round(p * 100)}%`}
                          </b>
                        </div>
                      ))}
                  </div>
                  <h3 className="intent-detail-heading">意图</h3>
                  <div className="intent-distribution">
                    {Object.entries(result?.intents || {})
                      .filter(([key, p]) => key in INTENTS && p > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([key, p]) => (
                        <div key={key} className="intent-detail-item">
                          <div>
                            <strong>
                              {INTENTS[key as keyof typeof INTENTS].label}
                            </strong>
                            <b>
                              {p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`}
                            </b>
                          </div>
                          <p>{INTENTS[key as keyof typeof INTENTS].criteria}</p>
                        </div>
                      ))}
                    {!result?.intents && <p>意图尚未分析。</p>}
                  </div>
                  <p>
                    两行分别展示主要情绪与主要沟通意图的候选解读，不代表测量真实内心。每行最多显示前三项，保留原始概率，不重新凑成
                    100%。
                  </p>
                </>
              ) : (
                <>
                  <h3 className="reply-verdict">
                    回复评级：
                    {replyRating(result?.score.value)?.label ?? "待判断"}
                  </h3>
                  <p>
                    {replyRating(result?.score.value)?.description ??
                      "当前语境不足以判断表达质量"}
                  </p>
                  <p>
                    回复评分 {result?.score.value ?? "—"} / 100 ·{" "}
                    {result && statusLabel(result.score)}
                  </p>
                </>
              )}
              <p>结合当前已导入的上下文判断，不代表对方真实想法。</p>
            </>
          )}
        </Modal>
      )}

      {overlap && (
        <Modal title="这段可能重复了" close={closeOverlap}>
          <p>相同内容也可能是新消息，请选择如何合并。</p>
          <button
            className="primary"
            onClick={() => {
              add(overlap, "skip");
              setOverlap(null);
            }}
          >
            跳过重合部分
          </button>
          <button
            className="secondary"
            onClick={() => {
              add(overlap, "append");
              setOverlap(null);
            }}
          >
            作为新消息追加
          </button>
        </Modal>
      )}

      {toast && (
        <div className="copy-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </main>
  );
}
