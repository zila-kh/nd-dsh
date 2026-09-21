use anyhow::{Context, Result, bail};
use std::ffi::c_void;
use std::mem::size_of;
use std::os::windows::io::RawHandle;
use std::ptr::null;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};

#[derive(Debug)]
pub struct WindowsJob {
    handle: HANDLE,
}

unsafe impl Send for WindowsJob {}
unsafe impl Sync for WindowsJob {}

impl WindowsJob {
    pub fn assign(process: RawHandle) -> Result<Self> {
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error()).context("create Windows Job Object");
        }

        let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&information as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
                u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                    .context("Windows Job Object information size overflow")?,
            )
        };
        if configured == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(error).context("configure Windows Job Object kill-on-close");
        }

        if process.is_null() {
            unsafe {
                CloseHandle(handle);
            }
            bail!("managed Windows process has no native handle");
        }
        let assigned = unsafe { AssignProcessToJobObject(handle, process as HANDLE) };
        if assigned == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(error).context("assign managed process to Windows Job Object");
        }

        Ok(Self { handle })
    }
}

impl Drop for WindowsJob {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                CloseHandle(self.handle);
            }
            self.handle = std::ptr::null_mut();
        }
    }
}
