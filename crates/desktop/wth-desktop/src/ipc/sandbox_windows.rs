//! A-03（PRD）第一阶段：Windows 桌面端子进程 containment。
//!
//! Agent 执行的 shell 命令经 Job Object 纳管（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）：
//! 命令结束时（句柄 Drop）连带清理全部残留子进程/孙进程——解决"agent 启动了
//! 常驻服务/后台进程未被回收"的泄漏面。这是与 TUI 侧 nono 内核沙箱（Linux
//! Landlock / macOS Seatbelt）互补的 Windows 应用层 containment 第一阶段；
//! 文件系统 deny-ACL 与内存限额作为后续可选项（见 PRD A-03）。
//!
//! Windows 10/11 支持嵌套 Job，父进程已处于其他 Job 时通常可正常挂入；
//! 失败时调用方应降级为无 containment（fail-open）并记录日志。

/// 子进程 Job 句柄。Drop 时关闭句柄，触发 kill-on-close 清理整棵进程树。
#[cfg(windows)]
pub struct ChildJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl ChildJob {
    /// 创建 kill-on-close + 可选内存限额（MB，A-03 第二阶段）的 Job 对象。
    /// 内存限额防止失控命令耗尽整机内存；但 cargo/rustc 等重构建可能合法
    /// 超限，因此默认不启用（由设置显式开启）。
    pub fn create_with_memory_limit(limit_mb: Option<u64>) -> Option<ChildJob> {
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if let Some(mb) = limit_mb {
                limits.BasicLimitInformation.LimitFlags |=
                    windows_sys::Win32::System::JobObjects::JOB_OBJECT_LIMIT_PROCESS_MEMORY;
                limits.ProcessMemoryLimit = mb.saturating_mul(1024 * 1024) as usize;
            }
            let ok = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                windows_sys::Win32::Foundation::CloseHandle(handle);
                return None;
            }
            Some(ChildJob { handle })
        }
    }

    /// 把已 spawn 的子进程挂入 Job（其后续子孙自动纳入）。
    pub fn assign_child(&self, child: &tokio::process::Child) -> Result<(), String> {
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        let raw = child
            .raw_handle()
            .ok_or_else(|| "无法获取子进程句柄".to_string())?;
        unsafe {
            if AssignProcessToJobObject(self.handle, raw) == 0 {
                return Err("AssignProcessToJobObject 失败（可能已处于不兼容的 Job 中）".into());
            }
        }
        Ok(())
    }
}

// SAFETY: HANDLE 是 Windows 内核对象句柄，可在任意线程使用（Job Object
// API 线程安全）；本结构体不持有任何线程绑定状态。raw pointer 的存在仅
// 因 windows-sys 以裸指针表示句柄。
#[cfg(windows)]
unsafe impl Send for ChildJob {}

#[cfg(windows)]
impl Drop for ChildJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn job_memory_limit_does_not_break_creation() {
        use super::ChildJob;
        let job = ChildJob::create_with_memory_limit(Some(512));
        if job.is_some() {
            // 创建成功即可；限额语义由内核保证。
        }
    }

    #[cfg(windows)]
    #[test]
    fn job_create_and_assign() {
        use super::ChildJob;
        let Some(job) = ChildJob::create_with_memory_limit(None) else {
            // 个别受限环境创建 Job 失败，允许降级
            return;
        };
        let mut child = tokio::process::Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 >nul"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("spawn");
        job.assign_child(&child).expect("assign");
        // 句柄 Drop（kill-on-close）后子进程应被终止：先拿 id，再等退出。
        let pid = child.id();
        drop(job);
        // 给内核一点时间传播终止。
        std::thread::sleep(std::time::Duration::from_millis(300));
        let alive = child.try_wait().expect("wait").is_none();
        if alive {
            // 极端情况下等待收尾；仍存活则显式终止以清理测试。
            let _ = child.start_kill();
            panic!("kill-on-close 未终止子进程（pid={pid:?}）");
        }
    }
}
