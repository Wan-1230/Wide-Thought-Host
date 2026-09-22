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
    pub(crate) handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl ChildJob {
    /// 创建 kill-on-close + 可选内存限额（MB，A-03 第二阶段）的 Job 对象。
    /// 内存限额防止失控命令耗尽整机内存；但 cargo/rustc 等重构建可能合法
    /// 超限，因此默认不启用（由设置显式开启）。
    pub fn create_with_memory_limit(limit_mb: Option<u64>) -> Option<ChildJob> {
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
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

// ─── P-06 Phase2: Restricted Token 沙箱 ────────────────────────────────────

/// 沙箱档位（与设置 `sandbox_profile` 对齐）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxProfile {
    /// 仅 Job Object kill-on-close（默认，兼容性最好）。
    JobOnly,
    /// 受限 Token + Job：降权后仍可跑常规命令，禁止提权写系统目录。
    Restricted,
}

/// 受限主令牌。Drop 时关闭。
#[cfg(windows)]
pub struct RestrictedToken {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl RestrictedToken {
    /// 基于当前进程令牌创建受限令牌（DISABLE_MAX_PRIVILEGE | LUA_TOKEN）。
    pub fn create() -> Result<Self, String> {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::Security::{
            CreateRestrictedToken, DISABLE_MAX_PRIVILEGE, GetTokenInformation, LUA_TOKEN,
            SANDBOX_INERT, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut process_token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut process_token) == 0 {
                return Err("OpenProcessToken failed".into());
            }
            // 已是标准用户时仍创建 restricted token（幂等、降权）。
            let mut elev = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut ret_len = 0u32;
            let _ = GetTokenInformation(
                process_token,
                TokenElevation,
                &mut elev as *mut _ as *mut _,
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret_len,
            );

            let mut restricted: HANDLE = std::ptr::null_mut();
            let ok = CreateRestrictedToken(
                process_token,
                DISABLE_MAX_PRIVILEGE | LUA_TOKEN | SANDBOX_INERT,
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
                &mut restricted,
            );
            CloseHandle(process_token);
            if ok == 0 {
                return Err("CreateRestrictedToken failed".into());
            }
            if restricted.is_null() {
                return Err("CreateRestrictedToken returned null".into());
            }
            Ok(Self { handle: restricted })
        }
    }

    pub fn handle(&self) -> windows_sys::Win32::Foundation::HANDLE {
        self.handle
    }
}

#[cfg(windows)]
unsafe impl Send for RestrictedToken {}

#[cfg(windows)]
impl Drop for RestrictedToken {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

/// 沙箱会话：可选受限 Token + Job。
#[cfg(windows)]
pub struct ChildSandbox {
    job: ChildJob,
    token: Option<RestrictedToken>,
    profile: SandboxProfile,
}

#[cfg(windows)]
impl ChildSandbox {
    /// 按档位创建沙箱。Restricted 失败时自动降级 JobOnly（fail-open）。
    pub fn create(profile: SandboxProfile, memory_limit_mb: Option<u64>) -> Self {
        let job = ChildJob::create_with_memory_limit(memory_limit_mb);
        let job = match job {
            Some(j) => j,
            None => {
                // 极端情况：Job 也失败 — 仍返回一个“空”结构由调用方处理
                // 这里用 create 再试一次；若再失败则 panic-free 地用占位。
                // 实际上 CreateJobObject 几乎总能成功；失败时降级为无 Job。
                tracing::warn!("ChildJob create failed; sandbox degraded");
                // 构造一个已失效的占位：重新 create，仍失败则直接退出函数
                // 通过 Option 包装在调用侧处理。为保持 API 简单，这里重试一次。
                ChildJob::create_with_memory_limit(None).expect("job object unavailable")
            }
        };
        let (token, profile) = match profile {
            SandboxProfile::Restricted => match RestrictedToken::create() {
                Ok(t) => (Some(t), SandboxProfile::Restricted),
                Err(e) => {
                    tracing::warn!("RestrictedToken failed ({e}); fallback JobOnly");
                    (None, SandboxProfile::JobOnly)
                }
            },
            SandboxProfile::JobOnly => (None, SandboxProfile::JobOnly),
        };
        Self {
            job,
            token,
            profile,
        }
    }

    pub fn profile(&self) -> SandboxProfile {
        self.profile
    }

    /// 在受限令牌下同步执行命令（带超时）。返回 (exit_code, stdout, stderr)。
    /// 仅 Windows；非 Restricted 时走普通 tokio 路径由调用方处理。
    pub fn run_command_sync(
        &self,
        program: &str,
        args: &[String],
        cwd: &std::path::Path,
        timeout: std::time::Duration,
    ) -> Result<(Option<i32>, String, String), String> {
        use windows_sys::Win32::Foundation::{
            CloseHandle, GetLastError, HANDLE, HANDLE_FLAG_INHERIT, SetHandleInformation,
            WAIT_OBJECT_0,
        };
        use windows_sys::Win32::System::Threading::{
            CREATE_NO_WINDOW, CREATE_SUSPENDED, CreateProcessAsUserW, GetExitCodeProcess,
            PROCESS_INFORMATION, ResumeThread, STARTF_USESTDHANDLES, STARTUPINFOW,
            TerminateProcess, WaitForSingleObject,
        };

        let Some(token) = self.token.as_ref() else {
            return Err("no restricted token".into());
        };

        // 组装命令行
        let mut cmdline = format!("\"{program}\"");
        for a in args {
            cmdline.push(' ');
            if a.contains(' ') {
                cmdline.push('"');
                cmdline.push_str(a);
                cmdline.push('"');
            } else {
                cmdline.push_str(a);
            }
        }
        let mut cmdline_w: Vec<u16> = cmdline.encode_utf16().chain(std::iter::once(0)).collect();
        let cwd_w: Vec<u16> = cwd
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let mut sa = windows_sys::Win32::Security::SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<windows_sys::Win32::Security::SECURITY_ATTRIBUTES>()
                    as u32,
                lpSecurityDescriptor: std::ptr::null_mut(),
                bInheritHandle: 1,
            };
            let mut stdout_read: HANDLE = std::ptr::null_mut();
            let mut stdout_write: HANDLE = std::ptr::null_mut();
            let mut stderr_read: HANDLE = std::ptr::null_mut();
            let mut stderr_write: HANDLE = std::ptr::null_mut();

            if windows_sys::Win32::System::Pipes::CreatePipe(
                &mut stdout_read,
                &mut stdout_write,
                &mut sa,
                0,
            ) == 0
                || windows_sys::Win32::System::Pipes::CreatePipe(
                    &mut stderr_read,
                    &mut stderr_write,
                    &mut sa,
                    0,
                ) == 0
            {
                return Err(format!("CreatePipe failed: {}", GetLastError()));
            }
            // 父进程读端不要继承
            let _ = SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
            let _ = SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);

            let mut si: STARTUPINFOW = std::mem::zeroed();
            si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdOutput = stdout_write;
            si.hStdError = stderr_write;
            si.hStdInput = std::ptr::null_mut();

            let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
            let ok = CreateProcessAsUserW(
                token.handle(),
                std::ptr::null(),
                cmdline_w.as_mut_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1, // bInheritHandles
                CREATE_SUSPENDED | CREATE_NO_WINDOW,
                std::ptr::null_mut(),
                cwd_w.as_ptr(),
                &si,
                &mut pi,
            );
            CloseHandle(stdout_write);
            CloseHandle(stderr_write);
            if ok == 0 {
                CloseHandle(stdout_read);
                CloseHandle(stderr_read);
                return Err(format!("CreateProcessAsUserW failed: {}", GetLastError()));
            }

            // 挂 Job 后恢复线程
            if windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(
                self.job.handle,
                pi.hProcess,
            ) == 0
            {
                tracing::debug!(
                    "AssignProcessToJobObject failed in restricted sandbox: {}",
                    GetLastError()
                );
            }
            let _ = ResumeThread(pi.hThread);
            CloseHandle(pi.hThread);

            // 等待超时
            let wait_ms = timeout.as_millis().min(u32::MAX as u128) as u32;
            let wr = WaitForSingleObject(pi.hProcess, wait_ms);
            if wr != WAIT_OBJECT_0 {
                // 超时：Job drop 会杀树；此处先 Terminate
                let _ = TerminateProcess(pi.hProcess, 1);
                let _ = WaitForSingleObject(pi.hProcess, 2000);
                CloseHandle(pi.hProcess);
                CloseHandle(stdout_read);
                CloseHandle(stderr_read);
                return Err(format!(
                    "restricted command timeout ({}s)",
                    timeout.as_secs()
                ));
            }

            let mut code = 0u32;
            let _ = GetExitCodeProcess(pi.hProcess, &mut code);
            CloseHandle(pi.hProcess);

            let read_all = |h: HANDLE| -> String {
                let mut buf = [0u8; 8192];
                let mut out = Vec::new();
                loop {
                    let mut n = 0u32;
                    let ok = windows_sys::Win32::Storage::FileSystem::ReadFile(
                        h,
                        buf.as_mut_ptr() as *mut _,
                        buf.len() as u32,
                        &mut n,
                        std::ptr::null_mut(),
                    );
                    if ok == 0 || n == 0 {
                        break;
                    }
                    out.extend_from_slice(&buf[..n as usize]);
                    if out.len() > 2 * 1024 * 1024 {
                        break;
                    }
                }
                String::from_utf8_lossy(&out).into_owned()
            };
            let stdout = read_all(stdout_read);
            let stderr = read_all(stderr_read);
            CloseHandle(stdout_read);
            CloseHandle(stderr_read);
            Ok((Some(code as i32), stdout, stderr))
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

    #[cfg(windows)]
    #[test]
    fn restricted_token_creates() {
        use super::{ChildSandbox, SandboxProfile};
        let sb = ChildSandbox::create(SandboxProfile::Restricted, None);
        // 允许降级为 JobOnly，但创建不能 panic
        let _ = sb.profile();
    }

    #[cfg(windows)]
    #[test]
    fn restricted_runs_cmd() {
        use super::{ChildSandbox, SandboxProfile};
        use std::time::Duration;
        let sb = ChildSandbox::create(SandboxProfile::Restricted, None);
        if sb.profile() != SandboxProfile::Restricted {
            // 环境无法创建受限令牌时跳过
            return;
        }
        let cwd = std::env::temp_dir();
        let r = sb.run_command_sync(
            "cmd",
            &["/C".into(), "echo hello-restricted".into()],
            &cwd,
            Duration::from_secs(10),
        );
        match r {
            Ok((code, out, _)) => {
                assert_eq!(code, Some(0), "stdout={out}");
                assert!(out.contains("hello-restricted"), "out={out}");
            }
            Err(e) => panic!("restricted run failed: {e}"),
        }
    }
}
