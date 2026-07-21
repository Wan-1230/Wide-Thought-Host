//! Windows 凭据管理器封装。
//!
//! 敏感值只以 Generic Credential 形式存储，前端和普通配置文件只保留
//! “是否已配置”的布尔状态。

const TARGET_PREFIX: &str = "com.wth.desktop";

fn target_name(kind: &str, id: &str) -> Result<String, String> {
    let valid = |value: &str| {
        !value.is_empty()
            && value.len() <= 160
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if !valid(kind) || !valid(id) {
        return Err("凭据标识包含非法字符".into());
    }
    Ok(format!("{TARGET_PREFIX}/{kind}/{id}"))
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
pub fn write_secret(kind: &str, id: &str, secret: &str) -> Result<(), String> {
    use windows::Win32::Security::Credentials::{
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredWriteW,
    };
    use windows::core::PWSTR;

    let target = target_name(kind, id)?;
    let mut target_wide = wide(&target);
    let mut username_wide = wide("Wide Thought Host");
    let mut blob = secret.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target_wide.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(username_wide.as_mut_ptr()),
        ..Default::default()
    };

    // SAFETY: CREDENTIALW 中所有指针在调用期间均指向有效且稳定的缓冲区。
    unsafe { CredWriteW(&credential, 0) }.map_err(|e| format!("写入 Windows 凭据失败：{e}"))
}

#[cfg(windows)]
pub fn read_secret(kind: &str, id: &str) -> Result<Option<String>, String> {
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{
        CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW,
    };
    use windows::core::{HRESULT, PCWSTR};

    let target = target_name(kind, id)?;
    let target_wide = wide(&target);
    let mut raw: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: raw 是有效的出参；成功后由 CredFree 释放。
    match unsafe {
        CredReadW(
            PCWSTR(target_wide.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
            &mut raw,
        )
    } {
        Ok(()) => {
            if raw.is_null() {
                return Ok(None);
            }
            // SAFETY: CredReadW 成功时返回有效结构和 CredentialBlob 缓冲区。
            let value = unsafe {
                let credential = &*raw;
                let bytes = std::slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                );
                String::from_utf8(bytes.to_vec())
                    .map_err(|_| "Windows 凭据不是有效 UTF-8".to_string())
            };
            // SAFETY: raw 由 CredReadW 分配，只释放一次。
            unsafe { CredFree(raw.cast()) };
            value.map(Some)
        }
        Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(None),
        Err(error) => Err(format!("读取 Windows 凭据失败：{error}")),
    }
}

#[cfg(windows)]
pub fn delete_secret(kind: &str, id: &str) -> Result<(), String> {
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredDeleteW};
    use windows::core::{HRESULT, PCWSTR};

    let target = target_name(kind, id)?;
    let target_wide = wide(&target);
    // SAFETY: target_wide 是以 NUL 结尾的有效 UTF-16 字符串。
    match unsafe { CredDeleteW(PCWSTR(target_wide.as_ptr()), CRED_TYPE_GENERIC, None) } {
        Ok(()) => Ok(()),
        Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(()),
        Err(error) => Err(format!("删除 Windows 凭据失败：{error}")),
    }
}

#[cfg(not(windows))]
pub fn write_secret(_kind: &str, _id: &str, _secret: &str) -> Result<(), String> {
    Err("当前平台尚未实现安全凭据存储".into())
}

#[cfg(not(windows))]
pub fn read_secret(_kind: &str, _id: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(windows))]
pub fn delete_secret(_kind: &str, _id: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::target_name;

    #[test]
    fn credential_target_is_namespaced() {
        assert_eq!(
            target_name("provider", "openai").unwrap(),
            "com.wth.desktop/provider/openai"
        );
        assert!(target_name("provider", "../bad").is_err());
    }
}
