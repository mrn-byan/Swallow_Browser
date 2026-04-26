import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface Tab {
  id: string;
  title: string;
  url: string;
  favicon: string;
}

let counter = 0;
const genId = () => String(++counter);

function getFavicon(url: string): string {
  try {
    const origin = new URL(url).origin;
    return `https://www.google.com/s2/favicons?domain=${origin}&sz=32`;
  } catch {
    return "";
  }
}

function App() {
  const [tabs, setTabs]         = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const listenersRef            = useRef<Map<string, () => void>>(new Map());

  // タブのイベントリスナーを登録
  const registerListeners = useCallback((id: string) => {
    // URL変化
    const urlPromise = listen<{ url: string }>(`tab_${id}_url_changed`, ({ payload }) => {
      setTabs(prev => prev.map(t =>
        t.id === id ? { ...t, url: payload.url, favicon: getFavicon(payload.url) } : t
      ));
      // アクティブタブならアドレスバーも更新
      setActiveId(current => {
        if (current === id) setUrlInput(payload.url);
        return current;
      });
    });

    // タイトル変化
    const titlePromise = listen<{ title: string }>(`tab_${id}_title_changed`, ({ payload }) => {
      if (!payload.title) return;
      setTabs(prev => prev.map(t =>
        t.id === id ? { ...t, title: payload.title } : t
      ));
    });

    // アンリスン関数を保存
    Promise.all([urlPromise, titlePromise]).then(([unlisten1, unlisten2]) => {
      listenersRef.current.set(id, () => { unlisten1(); unlisten2(); });
    });
  }, []);

  // タブ作成
  const createTab = useCallback(async (url = "https://www.google.com") => {
    const id = genId();
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const tab: Tab = {
      id,
      title: "読み込み中...",
      url: normalized,
      favicon: getFavicon(normalized),
    };

    setTabs(prev => [...prev, tab]);
    setActiveId(id);
    setUrlInput(normalized);

    registerListeners(id);
    await invoke("new_tab",    { tabId: id, url: normalized });
    await invoke("switch_tab", { tabId: id });
  }, [registerListeners]);

  // タブ切り替え
  const switchTab = useCallback(async (id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    setActiveId(id);
    setUrlInput(tab.url);
    await invoke("switch_tab", { tabId: id });
  }, [tabs]);

  // タブを閉じる
  const closeTab = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // リスナー解除
    listenersRef.current.get(id)?.();
    listenersRef.current.delete(id);

    await invoke("close_tab", { tabId: id });

    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeId) {
        if (next.length > 0) {
          const fallback = next[next.length - 1];
          setActiveId(fallback.id);
          setUrlInput(fallback.url);
          invoke("switch_tab", { tabId: fallback.id });
        } else {
          setActiveId(null);
          setUrlInput("");
        }
      }
      return next;
    });
  }, [activeId]);

  // ナビゲート
  const navigate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId) { await createTab(urlInput); return; }
    await invoke("navigate_tab", { tabId: activeId, url: urlInput });
  }, [activeId, urlInput, createTab]);

  const goBack    = () => activeId && invoke("go_back",    { tabId: activeId });
  const goForward = () => activeId && invoke("go_forward", { tabId: activeId });
  const reload    = () => activeId && invoke("reload_tab", { tabId: activeId });

  // アンマウント時にリスナー全解除
  useEffect(() => {
    return () => { listenersRef.current.forEach(fn => fn()); };
  }, []);

  return (
    <div className="browser-shell">

      {/* タブバー */}
      <div className="tab-bar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeId ? "tab-active" : ""}`}
            onClick={() => switchTab(tab.id)}
          >
            {tab.favicon && (
              <img
                className="tab-favicon"
                src={tab.favicon}
                alt=""
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <span className="tab-title">{tab.title}</span>
            <button className="tab-close" onClick={e => closeTab(tab.id, e)}>✕</button>
          </div>
        ))}
        <button className="tab-new" onClick={() => createTab()}>＋</button>
      </div>

      {/* アドレスバー */}
      <header className="chrome-toolbar">
        <div className="nav-controls">
          <button className="nav-icon" onClick={goBack}    title="戻る">◀</button>
          <button className="nav-icon" onClick={goForward} title="進む">▶</button>
          <button className="nav-icon" onClick={reload}    title="再読み込み">↻</button>
        </div>
        <form onSubmit={navigate} className="omni-box">
          {activeId && tabs.find(t => t.id === activeId)?.favicon && (
            <img
              className="omni-favicon"
              src={tabs.find(t => t.id === activeId)?.favicon}
              alt=""
            />
          )}
          <input
            type="text"
            className="url-input"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onFocus={e => e.target.select()}
            placeholder="URLを入力またはGoogle検索"
            disabled={tabs.length === 0}
          />
        </form>
      </header>

      <main className="view-viewport" />
    </div>
  );
}

export default App;