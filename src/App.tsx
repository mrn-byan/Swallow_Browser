import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UI, type Lang } from "./i18n";
import "./App.css";

interface Tab      { id: string; title: string; url: string; favicon: string; }
interface Bookmark { id: string; title: string; url: string; favicon: string; }
const PANEL_HEIGHT = 320;
let counter = 0;
const genId = () => String(++counter);

function getFavicon(url: string) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).origin}&sz=32`; }
  catch { return ""; }
}

export default function App() {
  const [tabs, setTabs]                   = useState<Tab[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);
  const [urlInput, setUrlInput]           = useState("");
  const [vertical, setVertical]           = useState(false);
  const [bookmarks, setBookmarks]         = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  // ↓ この2行をすぐ下に追加
const openPanel = useCallback(async (panel: "bookmarks" | "settings") => {
  setShowBookmarks(panel === "bookmarks");
  setShowSettings(panel === "settings");
  if (activeId) {
    await invoke("resize_webview", {
      tabId: activeId,
      offsetTop: PANEL_HEIGHT,
      vertical,
    });
  }
}, [activeId, vertical]);

const closePanel = useCallback(async () => {
  setShowBookmarks(false);
  setShowSettings(false);
  if (activeId) {
    await invoke("resize_webview", {
      tabId: activeId,
      offsetTop: 0,
      vertical,
    });
  }
}, [activeId, vertical]);
  const [showSettings, setShowSettings]   = useState(false);
  const [lang, setLang]                   = useState<Lang>("ja");
  const listenersRef = useRef<Map<string, () => void>>(new Map());

  const t = (key: string) => UI[lang][key] ?? key;

  useEffect(() => {
    invoke<Bookmark[]>("get_bookmarks").then(setBookmarks);
  }, []);

  const registerListeners = useCallback((id: string) => {
    const p1 = listen<{ url: string }>(`tab_${id}_url_changed`, ({ payload }) => {
      setTabs(prev => prev.map(tab =>
        tab.id === id
          ? { ...tab, url: payload.url, favicon: getFavicon(payload.url) }
          : tab
      ));
      setActiveId(cur => { if (cur === id) setUrlInput(payload.url); return cur; });
    });
    const p2 = listen<{ title: string }>(`tab_${id}_title_changed`, ({ payload }) => {
      if (!payload.title) return;
      setTabs(prev => prev.map(tab =>
        tab.id === id ? { ...tab, title: payload.title } : tab
      ));
    });
    Promise.all([p1, p2]).then(([u1, u2]) =>
      listenersRef.current.set(id, () => { u1(); u2(); })
    );
  }, []);

  const createTab = useCallback(async (url = "https://www.google.com") => {
    const id   = genId();
    const norm = url.startsWith("http") ? url : `https://${url}`;
    setTabs(prev => [...prev, {
      id, title: t("newTab"), url: norm, favicon: getFavicon(norm),
    }]);
    setActiveId(id);
    setUrlInput(norm);
    registerListeners(id);
    await invoke("new_tab",    { tabId: id, url: norm, vertical });
    await invoke("switch_tab", { tabId: id });
  }, [registerListeners, vertical, lang]);

  const switchTab = useCallback(async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    setActiveId(id);
    setUrlInput(tab.url);
    await invoke("switch_tab", { tabId: id });
  }, [tabs]);

  const closeTab = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    listenersRef.current.get(id)?.();
    listenersRef.current.delete(id);
    await invoke("close_tab", { tabId: id });
    setTabs(prev => {
      const next = prev.filter(tab => tab.id !== id);
      if (id === activeId) {
        const fb = next[next.length - 1];
        if (fb) {
          setActiveId(fb.id);
          setUrlInput(fb.url);
          invoke("switch_tab", { tabId: fb.id });
        } else {
          setActiveId(null);
          setUrlInput("");
        }
      }
      return next;
    });
  }, [activeId]);

  const navigate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId) { await createTab(urlInput); return; }
    const norm = urlInput.startsWith("http") ? urlInput : `https://${urlInput}`;
    setTabs(prev => prev.map(tab =>
      tab.id === activeId ? { ...tab, url: norm } : tab
    ));
    setUrlInput(norm);
    await invoke("navigate_tab", { tabId: activeId, url: urlInput });
  }, [activeId, urlInput, createTab]);

  const goBack    = () => activeId && invoke("go_back",    { tabId: activeId });
  const goForward = () => activeId && invoke("go_forward", { tabId: activeId });
  const reload    = () => activeId && invoke("reload_tab", { tabId: activeId });

  const translate = async () => {
    const tab = tabs.find(t => t.id === activeId);
    if (!tab) return;
    const tl    = lang === "ja" ? "ja" : "en";
    const gtUrl = `https://translate.google.com/translate?sl=auto&tl=${tl}&u=${encodeURIComponent(tab.url)}`;
    await invoke("navigate_tab", { tabId: activeId, url: gtUrl });
  };

  const addBookmark = async () => {
    const tab = tabs.find(t => t.id === activeId);
    if (!tab) return;
    const bm: Bookmark = { id: genId(), title: tab.title, url: tab.url, favicon: tab.favicon };
    const updated = await invoke<Bookmark[]>("add_bookmark", { bookmark: bm });
    setBookmarks(updated);
  };

  const removeBookmark = async (id: string) => {
    const updated = await invoke<Bookmark[]>("remove_bookmark", { id });
    setBookmarks(updated);
  };

  useEffect(() => () => { listenersRef.current.forEach(fn => fn()); }, []);

  const activeTab    = tabs.find(t => t.id === activeId);
  const isBookmarked = bookmarks.some(b => b.url === activeTab?.url);

  
  const TabItem = ({ tab }: { tab: Tab }) => (
    <div
      className={`tab ${tab.id === activeId ? "tab-active" : ""}`}
      onClick={() => switchTab(tab.id)}
    >
      {tab.favicon
        ? <img className="tab-favicon" src={tab.favicon} alt=""
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        : <span className="tab-favicon-placeholder">🌐</span>
      }
      <span className="tab-title">{tab.title}</span>
      <button className="tab-close" onClick={e => closeTab(tab.id, e)}>✕</button>
    </div>
  );

  return (
    <div className={`browser-shell ${vertical ? "layout-vertical" : "layout-horizontal"}`}>

      {/* ── 垂直タブ: 左サイドバー ── */}
      {vertical && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-logo">🦅 Swallow</span>
            <button className="icon-btn" onClick={() => setVertical(false)} title={t("horizontal")}>⇔</button>
          </div>
          <div className="sidebar-tabs">
            {tabs.map(tab => <TabItem key={tab.id} tab={tab} />)}
            <button className="tab-new" onClick={() => createTab()}>＋ {t("newTab")}</button>
          </div>
          <div className="sidebar-footer">
            <button
              className={`sidebar-footer-btn ${showBookmarks ? "footer-btn-active" : ""}`}
              onClick={() => showBookmarks ? closePanel() : openPanel("bookmarks")}
              title={t("bookmarks")}
            >🔖</button>
            <button
              className={`sidebar-footer-btn ${showSettings ? "footer-btn-active" : ""}`}
              onClick={() => showSettings ? closePanel() : openPanel("settings")}
              title={t("settings")}
            >⚙️</button>
          </div>
        </aside>
      )}

      <div className="main-area">

        {/* ── 水平タブバー ── */}
        {!vertical && (
          <div className="tab-bar">
            {tabs.map(tab => <TabItem key={tab.id} tab={tab} />)}
            <button className="tab-new-h" onClick={() => createTab()}>＋</button>
            <div className="tab-bar-spacer" />
            <button
              className="icon-btn tab-bar-icon"
              onClick={() => setVertical(true)}
              title={t("vertical")}
            >⇕</button>
          </div>
        )}

        {/* ── アドレスバー ── */}
        <header className="toolbar">
          <div className="nav-controls">
            <button className="nav-icon" onClick={goBack}    title={t("back")}>◀</button>
            <button className="nav-icon" onClick={goForward} title={t("forward")}>▶</button>
            <button className="nav-icon" onClick={reload}    title={t("reload")}>↻</button>
          </div>

          <form onSubmit={navigate} className="omni-box">
            {activeTab?.favicon && (
              <img className="omni-favicon" src={activeTab.favicon} alt="" />
            )}
            <input
              type="text"
              className="url-input"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onFocus={e => e.target.select()}
              placeholder={t("searchOrUrl")}
              disabled={!activeId}
            />
          </form>

          <div className="toolbar-actions">
            <button
              className={`nav-icon ${isBookmarked ? "bookmarked" : ""}`}
              onClick={addBookmark}
              title={t("addBookmark")}
            >{isBookmarked ? "★" : "☆"}</button>

            <button
              className={`nav-icon ${showBookmarks ? "panel-btn-active" : ""}`}
              onClick={() => showBookmarks ? closePanel() : openPanel("bookmarks")}
              title={t("bookmarkList")}
            >🔖</button>

            <button
              className="nav-icon"
              onClick={translate}
              title={t("translate")}
            >🌐</button>

            <button
              className={`nav-icon ${showSettings ? "panel-btn-active" : ""}`}
              onClick={() => showSettings ? closePanel() : openPanel("settings")}
              title={t("settings")}
            >⚙️</button>
          </div>
        </header>

        {/* ── ブックマークパネル ── */}
        {showBookmarks && (
          <div className="panel bookmark-panel">
            <div className="panel-header">
              <span>{t("bookmarks")}</span>
              <button className="panel-close" onClick={closePanel}>✕</button>
            </div>
            {bookmarks.length === 0
              ? <p className="panel-empty">{t("noBookmarks")}</p>
              : bookmarks.map(bm => (
                  <div key={bm.id} className="bookmark-item">
                    {bm.favicon && <img src={bm.favicon} className="bm-favicon" alt="" />}
                    <button
                      className="bm-title"
                      onClick={() => { createTab(bm.url); closePanel(); }}
                    >{bm.title || bm.url}</button>
                    <button className="bm-remove" onClick={() => removeBookmark(bm.id)}>✕</button>
                  </div>
                ))
            }
          </div>
        )}

        {/* ── 設定パネル ── */}
        {showSettings && (
          <div className="panel settings-panel">
            <div className="panel-header">
              <span>{t("settings")}</span>
              <button className="panel-close" onClick={closePanel}>✕</button>
            </div>

            <div className="settings-row">
              <span className="settings-label">{t("language")}</span>
              <div className="settings-options">
                {(["ja", "en"] as Lang[]).map(l => (
                  <button
                    key={l}
                    className={`option-btn ${lang === l ? "option-active" : ""}`}
                    onClick={() => setLang(l)}
                  >{l === "ja" ? "🇯🇵 日本語" : "🇺🇸 English"}</button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">{t("tabLayout")}</span>
              <div className="settings-options">
                <button
                  className={`option-btn ${!vertical ? "option-active" : ""}`}
                  onClick={() => setVertical(false)}
                >⬆ {t("horizontal")}</button>
                <button
                  className={`option-btn ${vertical ? "option-active" : ""}`}
                  onClick={() => setVertical(true)}
                >⬅ {t("vertical")}</button>
              </div>
            </div>
          </div>
        )}

        <main className="view-viewport" />
      </div>
    </div>
  );
}