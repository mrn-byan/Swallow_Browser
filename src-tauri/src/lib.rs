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
        // ドメインっぽければhttpsを付ける
        format!("https://{}", trimmed)
    } else {
        // それ以外はGoogle検索
        format!("https://www.google.com/search?q={}", urlencoding::encode(trimmed))
    }
}

#[tauri::command]
async fn new_tab(app_handle: tauri::AppHandle, tab_id: String, url: String) {
    let normalized = normalize_url(&url);
    if !is_url_safe(&normalized) { return; }

    let Some(window) = app_handle.get_window("main") else { return };
    let size = match window.inner_size() {
        Ok(s) => s,
        Err(e) => { eprintln!("サイズ取得失敗: {e}"); return; }
    };

    let label = format!("tab_{}", tab_id);

    // ページ遷移・タイトル変更を検知してReactに通知するスクリプト
    let init_script = format!(r#"
        (function() {{
            const TAB_ID = "{}";
            function notifyRust(event, data) {{
                window.__TAURI_INTERNALS__.invoke('tab_event', {{ tabId: TAB_ID, event, data }});
            }}

            // URL変化を監視
            let lastUrl = location.href;
            const observer = new MutationObserver(() => {{
                if (location.href !== lastUrl) {{
                    lastUrl = location.href;
                    notifyRust('url_changed', {{ url: location.href }});
                }}
            }});
            observer.observe(document, {{ subtree: true, childList: true }});

            // タイトル変化を監視
            const titleObserver = new MutationObserver(() => {{
                notifyRust('title_changed', {{ title: document.title }});
            }});

            document.addEventListener('DOMContentLoaded', () => {{
                titleObserver.observe(document.querySelector('title') || document.head, {{
                    childList: true, characterData: true, subtree: true
                }});
                notifyRust('title_changed', {{ title: document.title }});
                notifyRust('url_changed', {{ url: location.href }});
            }});

            // ページロード完了時
            window.addEventListener('load', () => {{
                notifyRust('title_changed', {{ title: document.title }});
                notifyRust('url_changed', {{ url: location.href }});
            }});
        }})();
    "#, tab_id);

    let builder = tauri::webview::WebviewBuilder::new(
        &label,
        WebviewUrl::External(normalized.parse().unwrap()),
    ).initialization_script(&init_script);

    if let Err(e) = window.add_child(
        builder.auto_resize(),
        LogicalPosition::new(0.0, BAR_HEIGHT),
        LogicalSize::new(size.width as f64, size.height as f64 - BAR_HEIGHT),
    ) {
        eprintln!("add_child失敗: {e}");
    }
}

// WebviewからのイベントをReactに転送
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
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.close();
    }
}

#[tauri::command]
async fn navigate_tab(app_handle: tauri::AppHandle, tab_id: String, url: String) {
    let normalized = normalize_url(&url);
    if !is_url_safe(&normalized) { return; }
    let label = format!("tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.navigate(normalized.parse().unwrap());
    }
}

#[tauri::command]
async fn go_back(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.eval("history.back()");
    }
}

#[tauri::command]
async fn go_forward(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.eval("history.forward()");
    }
}

#[tauri::command]
async fn reload_tab(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.eval("location.reload()");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            new_tab, switch_tab, close_tab,
            navigate_tab, go_back, go_forward, reload_tab,
            tab_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}