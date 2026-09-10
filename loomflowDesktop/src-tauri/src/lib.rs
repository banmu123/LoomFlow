use serde::{Deserialize, Serialize};

// ===== Workflow CRUD Commands =====
// These commands bridge the frontend to SQLite via tauri-plugin-sql.
// The frontend calls these through @tauri-apps/api/core invoke().

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowRecord {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub data: String, // JSON string of TinyflowData
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowVersionRecord {
    pub id: String,
    pub workflow_id: String,
    pub version: i64,
    pub title: String,
    pub description: Option<String>,
    pub data: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionRecord {
    pub id: String,
    pub workflow_id: String,
    pub status: String,
    pub input: Option<String>,
    pub output: Option<String>,
    pub error: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionLogRecord {
    pub id: String,
    pub execution_id: String,
    pub node_id: Option<String>,
    pub level: String,
    pub message: String,
    pub created_at: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:loomflow.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "create_workflows_and_versions",
                            sql: include_str!("../migrations/001_initial.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "create_executions_and_logs",
                            sql: include_str!("../migrations/002_executions.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "create_settings",
                            sql: include_str!("../migrations/003_settings.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "create_ai_models",
                            sql: include_str!("../migrations/004_ai_models.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 5,
                            description: "create_conversations_and_messages",
                            sql: include_str!("../migrations/005_conversations.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 6,
                            description: "create_flow_events",
                            sql: include_str!("../migrations/006_flow_events.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_app_info,])
        .build(tauri::generate_context!())
        .expect("error while building LoomFlow Desktop");

    app.run(|_app, event| handle_run_event(event));
}

/// 区分平台的运行时事件处理。
///
/// 目前只有 macOS 开发态需要额外做事（接管 Dock 图标），
/// 其余平台保持空实现，避免 `event` 参数未使用告警。
#[cfg(all(target_os = "macos", debug_assertions))]
fn handle_run_event(event: tauri::RunEvent) {
    // 等应用就绪后再设置：此时 NSApplication 已完成启动，
    // 图标不会被随后的启动流程覆盖。
    if let tauri::RunEvent::Ready = event {
        apply_dev_dock_icon();
    }
}

#[cfg(not(all(target_os = "macos", debug_assertions)))]
fn handle_run_event(_event: tauri::RunEvent) {}

/// macOS 开发态手动接管 Dock 图标。
///
/// 背景：`tauri dev` 运行的是裸可执行文件，不是 .app bundle —— 没有
/// `Contents/Resources/icon.icns`，Info.plist 里也没有 `CFBundleIconFile`，
/// Mach-O 更没有 `__icns` 段（可用 `otool -l | grep __icns` 验证），
/// 于是 Dock 只能显示系统通用的 `exec` 图标，与产品图标不一致。
///
/// 这里在运行时复用**打包用的同一张图标**设置应用图标，让开发态与正式版视觉一致。
/// 仅在 macOS + debug 构建下编译，release / Windows / Linux 完全不受影响。
#[cfg(all(target_os = "macos", debug_assertions))]
fn apply_dev_dock_icon() {
    use objc2::AnyThread;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    // 与 bundle.icon 同源的 PNG，避免开发态与正式版出现两套图标
    const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

    let Some(mtm) = MainThreadMarker::new() else {
        // 不在主线程：NSApplication 只能在主线程访问，直接跳过
        return;
    };

    let data = NSData::with_bytes(ICON_PNG);
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    // SAFETY: 已通过 MainThreadMarker 确认处于主线程，且 image 为有效对象。
    unsafe { app.setApplicationIconImage(Some(&image)) };
}

/// 返回应用元信息（供前端展示版本号等）
#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "LoomFlow Desktop",
        "version": env!("CARGO_PKG_VERSION"),
    })
}
