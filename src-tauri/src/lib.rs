use tauri::{WebviewUrl, Manager, LogicalPosition, LogicalSize, Emitter};

const BAR_HEIGHT: f64 = 100.0;

fn is_url_safe(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    if !["https://", "http://"].iter().any(|s| lower.starts_with(s)) {
        return false;
    }
    !["<", ">", "\"", "'", "`", "javascript:", "data:", "vbscript:", "file:", "%3c", "%3e", "\n", "\r"]
        .iter().any(|p| lower.contains(p))
}

fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.contains('.') && !trimmed.contains(' ') {
        format!("https://{}", trimmed)
    } else {
        format!("https://www.google.com/search?q={}", urlencoding::encode(trimmed))
    }
}

// ✅ resize_webview から参照されるので run() より前に定義
fn webview_rect(
    win_w: f64, win_h: f64, vertical: bool,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    if vertical {
        // 垂直タブ: サイドバー200px + ツールバー60px
        (
            LogicalPosition::new(200.0, 60.0),
            LogicalSize::new(win_w - 200.0, win_h - 60.0),
        )
    } else {
        // 水平タブ: タブバー40px + アドレスバー60px = 100px
        (
            LogicalPosition::new(0.0, BAR_HEIGHT),
            LogicalSize::new(win_w, win_h - BAR_HEIGHT),
        )
    }
}

#[tauri::command]
async fn new_tab(app_handle: tauri::AppHandle, tab_id: String, url: String, vertical: bool) {
    let normalized = normalize_url(&url);
    if !is_url_safe(&normalized) { return; }

    let Some(window) = app_handle.get_window("main") else { return };
    let size = match window.inner_size() {
        Ok(s) => s,
        Err(e) => { eprintln!("サイズ取得失敗: {e}"); return; }
    };

    let (pos, sz) = webview_rect(size.width as f64, size.height as f64, vertical);
    let label = format!("tab_{}", tab_id);

    let init_script = format!(r#"
        (function() {{
            const TAB_ID = "{}";
            function notifyRust(event, data) {{
                window.__TAURI_INTERNALS__.invoke('tab_event', {{ tabId: TAB_ID, event, data }});
            }}
            let lastUrl = location.href;
            new MutationObserver(() => {{
                if (location.href !== lastUrl) {{
                    lastUrl = location.href;
                    notifyRust('url_changed', {{ url: location.href }});
                }}
            }}).observe(document, {{ subtree: true, childList: true }});
            document.addEventListener('DOMContentLoaded', () => {{
                notifyRust('title_changed', {{ title: document.title }});
                notifyRust('url_changed',   {{ url: location.href }});
                const tEl = document.querySelector('title');
                if (tEl) new MutationObserver(() =>
                    notifyRust('title_changed', {{ title: document.title }})
                ).observe(tEl, {{ childList: true, characterData: true, subtree: true }});
            }});
            window.addEventListener('load', () => {{
                notifyRust('title_changed', {{ title: document.title }});
                notifyRust('url_changed',   {{ url: location.href }});
            }});
        }})();
    "#, tab_id);

    let builder = tauri::webview::WebviewBuilder::new(
        &label,
        WebviewUrl::External(normalized.parse().unwrap()),
    ).initialization_script(&init_script);

    if let Err(e) = window.add_child(builder.auto_resize(), pos, sz) {
        eprintln!("add_child失敗: {e}");
    }
}

#[tauri::command]
async fn tab_event(
    app_handle: tauri::AppHandle,
    tab_id: String,
    event: String,
    data: serde_json::Value,
) {
    let _ = app_handle.emit(&format!("tab_{}_{}", tab_id, event), data);
}

#[tauri::command]
async fn switch_tab(app_handle: tauri::AppHandle, tab_id: String) {
    let target = format!("tab_{}", tab_id);
    for (label, webview) in app_handle.webviews() {
        if !label.starts_with("tab_") { continue; }
        if label == target { let _ = webview.show(); }
        else               { let _ = webview.hide(); }
    }
}

#[tauri::command]
async fn close_tab(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(wv) = app_handle.get_webview(&label) { let _ = wv.close(); }
}

#[tauri::command]
async fn navigate_tab(app_handle: tauri::AppHandle, tab_id: String, url: String) {
    let normalized = normalize_url(&url);
    if !is_url_safe(&normalized) { return; }
    let label = format!("tab_{}", tab_id);
    if let Some(wv) = app_handle.get_webview(&label) {
        let _ = wv.navigate(normalized.parse().unwrap());
    }
}

#[tauri::command]
async fn go_back(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(wv) = app_handle.get_webview(&label) { let _ = wv.eval("history.back()"); }
}

#[tauri::command]
async fn go_forward(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(wv) = app_handle.get_webview(&label) { let _ = wv.eval("history.forward()"); }
}

#[tauri::command]
async fn reload_tab(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(wv) = app_handle.get_webview(&label) { let _ = wv.eval("location.reload()"); }
}

#[tauri::command]
async fn resize_webview(
    app_handle: tauri::AppHandle,
    tab_id: String,
    offset_top: f64,
    vertical: bool,
) {
    let Some(window) = app_handle.get_window("main") else { return };
    let size = match window.inner_size() {
        Ok(s) => s,
        Err(_) => return,
    };

    let win_w = size.width as f64;
    let win_h = size.height as f64;
    let (base_pos, _) = webview_rect(win_w, win_h, vertical);

    let label = format!("tab_{}", tab_id);
    if let Some(wv) = app_handle.get_webview(&label) {
        let new_top = base_pos.y + offset_top;
        let _ = wv.set_position(LogicalPosition::new(base_pos.x, new_top));
        let _ = wv.set_size(LogicalSize::new(
            win_w - base_pos.x,
            (win_h - new_top).max(0.0),
        ));
    }
}

// ✅ run() は必ずファイルの末尾に
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            new_tab, switch_tab, close_tab,
            navigate_tab, go_back, go_forward, reload_tab,
            tab_event, resize_webview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}