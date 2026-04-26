use tauri::{WebviewUrl, Manager, LogicalPosition, LogicalSize};

const BAR_HEIGHT: f64 = 100.0; // タブバー40px + アドレスバー60px

fn is_url_safe(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    let allowed_schemes = ["https://", "http://"];
    if !allowed_schemes.iter().any(|s| lower.starts_with(s)) {
        return false;
    }
    let forbidden = ["<", ">", "\"", "'", "`", "javascript:", "data:",
                     "vbscript:", "file:", "%3c", "%3e", "\n", "\r"];
    !forbidden.iter().any(|p| lower.contains(p))
}

fn normalize_url(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{}", url)
    }
}

// タブ新規作成
#[tauri::command]
async fn new_tab(app_handle: tauri::AppHandle, tab_id: String, url: String) {
    let normalized = normalize_url(&url);
    if !is_url_safe(&normalized) {
        eprintln!("[new_tab] 拒否: {}", url);
        return;
    }

    let Some(window) = app_handle.get_window("main") else { return };

    let size = match window.inner_size() {
        Ok(s) => s,
        Err(e) => { eprintln!("サイズ取得失敗: {e}"); return; }
    };

    let label = format!("tab_{}", tab_id);
    let builder = tauri::webview::WebviewBuilder::new(
        &label,
        WebviewUrl::External(normalized.parse().unwrap()),
    );

    if let Err(e) = window.add_child(
        builder.auto_resize(),
        LogicalPosition::new(0.0, BAR_HEIGHT),
        LogicalSize::new(size.width as f64, size.height as f64 - BAR_HEIGHT),
    ) {
        eprintln!("add_child失敗: {e}");
    }
}

// タブ切り替え（対象を表示・他を非表示）
#[tauri::command]
async fn switch_tab(app_handle: tauri::AppHandle, tab_id: String) {
    let target = format!("tab_{}", tab_id);
    for (label, webview) in app_handle.webviews() {
        if !label.starts_with("tab_") { continue; }
        if label == target {
            let _ = webview.show();
        } else {
            let _ = webview.hide();
        }
    }
}

// タブを閉じる
#[tauri::command]
async fn close_tab(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.close();
    }
}

// 現在のタブでURL変更
#[tauri::command]
async fn navigate_tab(app_handle: tauri::AppHandle, tab_id: String, url: String) {
    let normalized = normalize_url(&url);
    if !is_url_safe(&normalized) {
        eprintln!("[navigate_tab] 拒否: {}", url);
        return;
    }
    let label = format!("tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        if let Err(e) = webview.navigate(normalized.parse().unwrap()) {
            eprintln!("navigate失敗: {e}");
        }
    }
}

// 戻る
#[tauri::command]
async fn go_back(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.eval("history.back()");
    }
}

// 進む
#[tauri::command]
async fn go_forward(app_handle: tauri::AppHandle, tab_id: String) {
    let label = format!("tab_{}", tab_id);
    if let Some(webview) = app_handle.get_webview(&label) {
        let _ = webview.eval("history.forward()");
    }
}

// リロード
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
            new_tab,
            switch_tab,
            close_tab,
            navigate_tab,
            go_back,
            go_forward,
            reload_tab,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}