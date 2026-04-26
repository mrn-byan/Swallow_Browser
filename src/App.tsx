import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface Tab {
  id: string;
  title: string;
  url: string;
}

let counter = 0;
const genId = () => String(++counter);

function App() {
  const [tabs, setTabs]       = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");

  // タブ作成
  const createTab = useCallback(async (url = "https://www.google.com") => {
    const id  = genId();
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const tab: Tab = { id, title: normalized, url: normalized };

    setTabs(prev => [...prev, tab]);
    setActiveId(id);
    setUrlInput(normalized);

    await invoke("new_tab",    { tabId: id, url: normalized });
    await invoke("switch_tab", { tabId: id });
  }, []);

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

  // アドレスバーでナビゲート
  const navigate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = urlInput.startsWith("http") ? urlInput : `https://${urlInput}`;

    if (!activeId) {
      await createTab(normalized);
      return;
    }

    setTabs(prev => prev.map(t =>
      t.id === activeId ? { ...t, url: normalized, title: normalized } : t
    ));
    setUrlInput(normalized);
    await invoke("navigate_tab", { tabId: activeId, url: normalized });
  }, [activeId, urlInput, createTab]);

  const goBack    = () => activeId && invoke("go_back",    { tabId: activeId });
  const goForward = () => activeId && invoke("go_forward", { tabId: activeId });
  const reload    = () => activeId && invoke("reload_tab", { tabId: activeId });

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
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => closeTab(tab.id, e)}
            >✕</button>
          </div>
        ))}
        <button className="tab-new" onClick={() => createTab()}>＋</button>
      </div>

      {/* アドレスバー */}
      <header className="chrome-toolbar">
        <div className="nav-controls">
          <button className="nav-icon" onClick={goBack}>◀</button>
          <button className="nav-icon" onClick={goForward}>▶</button>
          <button className="nav-icon" onClick={reload}>↻</button>
        </div>
        <form onSubmit={navigate} className="omni-box">
          <input
            type="text"
            className="url-input"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="URLを入力または検索"
            disabled={tabs.length === 0}
          />
        </form>
      </header>

      <main className="view-viewport" />
    </div>
  );
}

export default App;