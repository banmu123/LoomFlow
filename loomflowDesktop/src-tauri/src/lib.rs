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
    tauri::Builder::default()
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
                    ],
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LoomFlow Desktop");
}

/// 返回应用元信息（供前端展示版本号等）
#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "LoomFlow Desktop",
        "version": env!("CARGO_PKG_VERSION"),
    })
}
