//! Regression coverage for the Windows duplex transport.
//!
//! Windows serializes I/O on a synchronous pipe handle: while the host's reader
//! thread holds a pending read, a write from the forwarding thread waits for that
//! read to complete — and the desktop sends nothing new while it awaits a reply.
//! Both directions therefore stall, and a command/response round trip never
//! completes.
//!
//! This test drives the real host binary over a named pipe and asserts that each
//! desktop message reaches Chrome and that a Chrome response reaches the desktop
//! with no further desktop->host traffic.

#![cfg(windows)]

use std::fs::File;
use std::io::{Read, Write};
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{ERROR_PIPE_CONNECTED, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE,
    PIPE_UNLIMITED_INSTANCES, PIPE_WAIT, PeekNamedPipe,
};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

#[test]
fn response_reaches_the_desktop_while_the_reader_is_idle() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    let pipe_name = format!(
        r"\\.\pipe\nd-browser-host-duplex-{}-{unique}",
        std::process::id()
    );
    let wide: Vec<u16> = pipe_name.encode_utf16().chain(std::iter::once(0)).collect();

    let server = unsafe {
        CreateNamedPipeW(
            wide.as_ptr(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            64 * 1024,
            64 * 1024,
            0,
            std::ptr::null(),
        )
    };
    assert!(
        server != INVALID_HANDLE_VALUE,
        "CreateNamedPipeW failed: {}",
        std::io::Error::last_os_error()
    );

    let directory = std::env::temp_dir().join(format!("nd-browser-host-duplex-{unique}"));
    std::fs::create_dir_all(&directory).expect("create discovery directory");
    let discovery = directory.join("browser-companion.json");
    std::fs::write(
        &discovery,
        serde_json::json!({ "version": 1, "endpoint": pipe_name, "token": "duplex-test-token" })
            .to_string(),
    )
    .expect("write discovery file");

    let mut child = Command::new(env!("CARGO_BIN_EXE_nd-browser-host"))
        .env("ND_BROWSER_COMPANION_DISCOVERY", &discovery)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn nd-browser-host");
    let mut stdin = child.stdin.take().expect("host stdin");
    let mut stdout = child.stdout.take().expect("host stdout");
    let mut stderr = child.stderr.take().expect("host stderr");

    let connected = unsafe { ConnectNamedPipe(server, std::ptr::null_mut()) };
    if connected == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(ERROR_PIPE_CONNECTED as i32) {
            panic!(
                "{}",
                failure(
                    &mut child,
                    &mut stderr,
                    &format!("ConnectNamedPipe failed: {error}")
                )
            );
        }
    }
    let mut pipe = unsafe { File::from_raw_handle(server) };

    let mut desktop_pending = Vec::new();
    let mut host_pending = Vec::new();

    let auth = read_line(&mut pipe, &mut desktop_pending, HANDSHAKE_TIMEOUT).unwrap_or_else(|| {
        panic!(
            "{}",
            failure(&mut child, &mut stderr, "the host never sent its auth line")
        )
    });
    assert!(
        auth.contains("\"kind\":\"auth\""),
        "unexpected auth: {auth}"
    );
    write_line(
        &mut pipe,
        &serde_json::json!({ "version": 1, "kind": "auth.ok" }).to_string(),
    );
    expect_frame(
        &mut stdout,
        &mut host_pending,
        &mut child,
        &mut stderr,
        "auth.ok",
    );

    write_frame(
        &mut stdin,
        &serde_json::json!({
            "version": 1,
            "kind": "browser.hello",
            "installationId": "duplex-test",
            "browser": "chrome",
            "profileLabel": "duplex test",
            "extensionVersion": "0.1.0"
        })
        .to_string(),
    );
    let hello =
        read_line(&mut pipe, &mut desktop_pending, HANDSHAKE_TIMEOUT).unwrap_or_else(|| {
            panic!(
                "{}",
                failure(
                    &mut child,
                    &mut stderr,
                    "the host never forwarded browser.hello"
                )
            )
        });
    assert!(
        hello.contains("\"kind\":\"browser.hello\""),
        "unexpected hello: {hello}"
    );
    write_line(
        &mut pipe,
        &serde_json::json!({ "version": 1, "kind": "browser.hello.ok", "connectionId": "duplex-test" })
            .to_string(),
    );
    expect_frame(
        &mut stdout,
        &mut host_pending,
        &mut child,
        &mut stderr,
        "browser.hello.ok",
    );
    write_line(
        &mut pipe,
        &serde_json::json!({ "version": 1, "kind": "command", "id": "duplex-1", "method": "tabs.list", "params": {} })
            .to_string(),
    );

    let command = expect_frame(
        &mut stdout,
        &mut host_pending,
        &mut child,
        &mut stderr,
        "command",
    );
    assert!(
        command.contains("duplex-1"),
        "unexpected command frame: {command}"
    );

    // Nothing else is sent from the desktop past this point: the response must
    // reach the desktop on its own, against an idle (pending) reader thread.
    write_frame(
        &mut stdin,
        &serde_json::json!({ "version": 1, "kind": "response", "id": "duplex-1", "result": [] })
            .to_string(),
    );
    let response =
        read_line(&mut pipe, &mut desktop_pending, RESPONSE_TIMEOUT).unwrap_or_else(|| {
            panic!(
                "{}",
                failure(
                    &mut child,
                    &mut stderr,
                    "the Chrome response never reached the desktop"
                )
            )
        });
    assert!(
        response.contains("\"kind\":\"response\"") && response.contains("duplex-1"),
        "unexpected response line: {response}"
    );

    let _ = child.kill();
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&directory);
}

fn failure(child: &mut Child, stderr: &mut ChildStderr, message: &str) -> String {
    let _ = child.kill();
    let _ = child.wait();
    let mut text = String::new();
    let _ = stderr.read_to_string(&mut text);
    format!("{message}\nhost stderr: {}", text.trim())
}

fn expect_frame(
    stdout: &mut ChildStdout,
    pending: &mut Vec<u8>,
    child: &mut Child,
    stderr: &mut ChildStderr,
    kind: &str,
) -> String {
    let frame = read_frame(stdout, pending, HANDSHAKE_TIMEOUT).unwrap_or_else(|| {
        panic!(
            "{}",
            failure(
                child,
                stderr,
                &format!("the {kind} frame never reached Chrome")
            )
        )
    });
    assert!(
        frame.contains(&format!("\"kind\":\"{kind}\"")),
        "expected a {kind} frame, received: {frame}"
    );
    frame
}

fn write_line(pipe: &mut File, line: &str) {
    pipe.write_all(format!("{line}\n").as_bytes())
        .expect("write desktop line");
    pipe.flush().expect("flush desktop line");
}

fn write_frame(stdin: &mut ChildStdin, payload: &str) {
    let bytes = payload.as_bytes();
    let mut frame = (bytes.len() as u32).to_le_bytes().to_vec();
    frame.extend_from_slice(bytes);
    stdin.write_all(&frame).expect("write native frame");
    stdin.flush().expect("flush native frame");
}

fn read_line<R: Read + AsRawHandle>(
    reader: &mut R,
    pending: &mut Vec<u8>,
    timeout: Duration,
) -> Option<String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(index) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=index).collect();
            return Some(
                String::from_utf8(line)
                    .expect("utf8 line")
                    .trim()
                    .to_owned(),
            );
        }
        if !pump(reader, pending, deadline) {
            return None;
        }
    }
}

fn read_frame<R: Read + AsRawHandle>(
    reader: &mut R,
    pending: &mut Vec<u8>,
    timeout: Duration,
) -> Option<String> {
    let deadline = Instant::now() + timeout;
    while pending.len() < 4 {
        if !pump(reader, pending, deadline) {
            return None;
        }
    }
    let size = u32::from_le_bytes([pending[0], pending[1], pending[2], pending[3]]) as usize;
    while pending.len() < 4 + size {
        if !pump(reader, pending, deadline) {
            return None;
        }
    }
    let payload: Vec<u8> = pending.drain(..4 + size).skip(4).collect();
    Some(String::from_utf8(payload).expect("utf8 frame"))
}

/// Reads whatever the pipe has buffered without ever parking a blocking read, so
/// the test's own handle cannot stall its writes the way the host's used to.
fn pump<R: Read + AsRawHandle>(reader: &mut R, sink: &mut Vec<u8>, deadline: Instant) -> bool {
    loop {
        let mut available = 0u32;
        let peeked = unsafe {
            PeekNamedPipe(
                reader.as_raw_handle() as HANDLE,
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                &mut available,
                std::ptr::null_mut(),
            )
        };
        assert!(
            peeked != 0,
            "PeekNamedPipe failed: {}",
            std::io::Error::last_os_error()
        );
        if available > 0 {
            let mut buffer = vec![0u8; available as usize];
            let read = reader.read(&mut buffer).expect("read from pipe");
            sink.extend_from_slice(&buffer[..read]);
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
