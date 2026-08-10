//! Headroom 侧车进程管理 — 启动/停止 headroom proxy，健康检查，状态查询。
//!
//! 当 headroom_enabled 时，自动启动 `headroom proxy --port PORT`，
//! 并将所有 LLM API 调用路由经过 localhost:PORT 代理以压缩 token。

use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::sleep;

/// Headroom 代理管理器状态
#[derive(Debug, Clone, PartialEq)]
pub enum HeadroomStatus {
    /// 未启用
    Disabled,
    /// 正在启动
    Starting,
    /// 运行中
    Running { port: u16 },
    /// 启动失败
    Error(String),
}

pub struct HeadroomManager {
    child: Mutex<Option<Child>>,
    port: Mutex<u16>,
    enabled: Mutex<bool>,
}

impl HeadroomManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(8787),
            enabled: Mutex::new(false),
        }
    }

    /// 获取当前状态
    pub fn status(&self) -> HeadroomStatus {
        let enabled = *self.enabled.lock().unwrap();
        if !enabled {
            return HeadroomStatus::Disabled;
        }
        let guard = self.child.lock().unwrap();
        if guard.is_some() {
            let port = *self.port.lock().unwrap();
            HeadroomStatus::Running { port }
        } else {
            // enabled 但无子进程：表示启动中或启动失败
            HeadroomStatus::Starting
        }
    }

    /// 获取代理地址（如果已启动）
    pub fn proxy_url(&self) -> Option<String> {
        match self.status() {
            HeadroomStatus::Running { port } => Some(format!("http://localhost:{}", port)),
            _ => None,
        }
    }

    /// 检查 headroom 是否安装
    pub fn is_installed() -> bool {
        Command::new("headroom")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// 自动安装 headroom（通过 pip），返回安装日志
    pub async fn auto_install() -> Result<String, String> {
        if Self::is_installed() {
            return Ok("Headroom 已安装，无需重复操作。".into());
        }
        // 尝试 pip，失败则尝试 pip3
        let pip = if Command::new("pip").arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
            "pip"
        } else if Command::new("pip3").arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
            "pip3"
        } else {
            return Err("未找到 pip。请先安装 Python 3.10+ 及 pip，然后运行: pip install headroom-ai[all]".into());
        };

        let output = tokio::task::spawn_blocking(move || {
            Command::new(pip)
                .args(["install", "headroom-ai[all]"])
                .output()
        })
        .await
        .map_err(|e| format!("安装任务启动失败: {e}"))?
        .map_err(|e| format!("安装失败: {e}"))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("安装失败: {stderr}"))
        }
    }

    /// 启动 headroom proxy
    pub async fn start(&self, port: u16) -> Result<(), String> {
        // 先停止已有进程
        self.stop();

        *self.port.lock().unwrap() = port;
        *self.enabled.lock().unwrap() = true;

        let child = Command::new("headroom")
            .args(["proxy", "--port", &port.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("无法启动 headroom proxy: {e}. 请先安装: pip install headroom-ai[all]"))?;

        *self.child.lock().unwrap() = Some(child);

        // 等待代理就绪（最多 30 秒）
        for _ in 0..30 {
            sleep(Duration::from_secs(1)).await;
            let client = reqwest::Client::new();
            if let Ok(resp) = client
                .get(format!("http://localhost:{}/health", port))
                .timeout(Duration::from_secs(2))
                .send()
                .await
            {
                if resp.status().is_success() {
                    return Ok(());
                }
            }
        }

        // 超时：清理并报错
        self.stop();
        Err(format!(
            "Headroom proxy 在端口 {port} 上启动超时（30s）。请检查 headroom 是否已安装: pip install headroom-ai[all]"
        ))
    }

    /// 停止 headroom proxy
    pub fn stop(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *self.enabled.lock().unwrap() = false;
    }
}
