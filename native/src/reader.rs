use super::{classify, is_live, Event, Merger};
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::os::raw::{c_int, c_ulong};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PR_SET_PDEATHSIG: c_int = 1;
const SIGTERM: c_int = 15;
const POLLIN: i16 = 1;

#[repr(C)]
struct PollFd {
    fd: RawFd,
    events: i16,
    revents: i16,
}

const _: () = assert!(std::mem::size_of::<PollFd>() == 8);

// Both Android's bionic and the Linux host use an unsigned long for nfds_t.
extern "C" {
    fn poll(fds: *mut PollFd, nfds: c_ulong, timeout: i32) -> c_int;
    fn prctl(option: c_int, ...) -> c_int;
    fn getppid() -> c_int;
}

fn wait_readable(fd: RawFd, timeout: i32) -> io::Result<bool> {
    let mut item = PollFd {
        fd,
        events: POLLIN,
        revents: 0,
    };
    // One valid pollfd points to live stack storage for the duration of this call.
    match unsafe { poll(&mut item, 1, timeout) } {
        -1 => Err(io::Error::last_os_error()),
        count => Ok(count != 0),
    }
}

/// The worker records the wrapper shell as the listener identity. If that shell
/// dies, ask the kernel to terminate this process too, so no orphan keeps
/// writing events into the session.
fn adopt_parent_exit() {
    unsafe { prctl(PR_SET_PDEATHSIG, SIGTERM as c_ulong) };
    // The parent may have died before the prctl call took effect.
    if unsafe { getppid() } <= 1 {
        std::process::exit(0);
    }
}

fn report(kind: &str) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "@native-error:{kind}");
    let _ = out.flush();
}

pub fn listen() -> io::Result<()> {
    adopt_parent_exit();
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    let [shell, script, session] = arguments.as_slice() else {
        report("args");
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Expected shell, script, session",
        ));
    };
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let mut child = match Command::new(shell)
        .arg(script)
        .arg("--logcat")
        .arg(session)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            report("spawn");
            return Err(error);
        }
    };
    let Some(reader) = child.stdout.take() else {
        report("stdout");
        let _ = child.kill();
        let _ = child.wait();
        return Err(io::Error::other("native listener started without a pipe"));
    };
    let result = forward(reader, io::stdout().lock(), cutoff);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn forward(reader: impl Read + AsRawFd, mut out: impl Write, cutoff: Duration) -> io::Result<()> {
    let mut reader = reader;
    let mut incoming = Vec::new();
    let mut chunk = [0_u8; 8192];
    let mut merger = Merger::new();
    writeln!(out, "@ready")?;
    out.flush()?;
    loop {
        // Only a pending merge window needs a timeout. Otherwise block in read.
        if merger.is_pending() {
            let timeout = merger
                .timeout(Instant::now())
                .unwrap_or(Duration::ZERO)
                .as_nanos()
                .div_ceil(1_000_000) as i32;
            match wait_readable(reader.as_raw_fd(), timeout) {
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
                Ok(false) => {
                    if let Some(event) = merger.flush() {
                        Event::write_to(&event, &mut out)?;
                        out.flush()?;
                    }
                    continue;
                }
                Ok(true) => {}
            }
        }
        let count = loop {
            match reader.read(&mut chunk) {
                Ok(count) => break count,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            }
        };
        if count == 0 {
            // Match the shell reader: keep the last event before reporting EOF.
            if let Some(event) = merger.flush() {
                Event::write_to(&event, &mut out)?;
                out.flush()?;
            }
            return Ok(());
        }
        incoming.extend_from_slice(&chunk[..count]);
        let mut consumed = 0;
        for line in incoming.split_inclusive(|byte| *byte == b'\n') {
            if !line.ends_with(b"\n") {
                break;
            }
            consumed += line.len();
            let Ok(line) = std::str::from_utf8(&line[..line.len() - 1]) else {
                continue;
            };
            if !is_live(line, cutoff) {
                continue;
            }
            let Some(event) = classify(line) else {
                continue;
            };
            let now = Instant::now();
            if let Some(previous) = merger.take_expired(now) {
                Event::write_to(&previous, &mut out)?;
                out.flush()?;
            }
            // Convert transient logcat slices into owned storage before retaining them.
            if let Some(event) = merger.push(event.into_owned(), now) {
                Event::write_to(&event, &mut out)?;
                out.flush()?;
            }
        }
        incoming.drain(..consumed);
        if incoming.len() > 65536 {
            incoming.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixStream;
    use std::sync::{Arc, Mutex};
    use std::thread;

    type Record = (Instant, String);
    type CollectorState = Arc<Mutex<(String, Vec<Record>)>>;

    #[derive(Clone, Default)]
    struct Collector {
        state: CollectorState,
    }

    impl Collector {
        fn records(&self) -> Vec<Record> {
            self.state.lock().unwrap().1.clone()
        }
    }

    impl Write for Collector {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            let mut state = self.state.lock().unwrap();
            state.0.push_str(&String::from_utf8_lossy(buffer));
            while let Some(index) = state.0.find('\n') {
                let line = state.0[..index].to_string();
                state.0 = state.0[index + 1..].to_string();
                state.1.push((Instant::now(), line));
            }
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn spawn_forward() -> (UnixStream, Collector, thread::JoinHandle<io::Result<()>>) {
        let (reader, writer) = UnixStream::pair().unwrap();
        let sink = Collector::default();
        let handle = {
            let sink = sink.clone();
            thread::spawn(move || forward(reader, sink, Duration::ZERO))
        };
        (writer, sink, handle)
    }

    const APP_ONE: &[u8] = b"12.200 1 1 I wm_set_resumed_activity: [0,one.app/.Main,resume]\n";
    const APP_TWO: &[u8] = b"12.300 1 1 I wm_set_resumed_activity: [0,two.app/.Main,resume]\n";

    #[test]
    fn lone_app_waits_for_merge_window() {
        let (mut writer, sink, handle) = spawn_forward();
        let start = Instant::now();
        writer.write_all(APP_ONE).unwrap();
        thread::sleep(Duration::from_millis(400));
        drop(writer);
        handle.join().unwrap().unwrap();
        let records = sink.records();
        assert_eq!(records[0].1, "@ready");
        let app = records
            .iter()
            .find(|(_, line)| line == "@app:one.app")
            .expect("app event");
        assert!(app.0.duration_since(start) >= Duration::from_millis(180));
    }

    #[test]
    fn conflicting_apps_merge_to_conflict() {
        let (mut writer, sink, handle) = spawn_forward();
        writer.write_all(APP_ONE).unwrap();
        thread::sleep(Duration::from_millis(50));
        writer.write_all(APP_TWO).unwrap();
        thread::sleep(Duration::from_millis(400));
        drop(writer);
        handle.join().unwrap().unwrap();
        let records = sink.records();
        assert!(
            records.iter().any(|(_, line)| line == "@conflict"),
            "{records:?}"
        );
        assert!(!records.iter().any(|(_, line)| line.starts_with("@app:")));
    }

    #[test]
    fn eof_flushes_pending_event() {
        let (mut writer, sink, handle) = spawn_forward();
        writer.write_all(APP_ONE).unwrap();
        drop(writer);
        handle.join().unwrap().unwrap();
        let records = sink.records();
        assert!(
            records.iter().any(|(_, line)| line == "@app:one.app"),
            "{records:?}"
        );
    }

    #[test]
    fn invalid_utf8_is_skipped() {
        let (mut writer, sink, handle) = spawn_forward();
        writer.write_all(b"12.200 1 1 I \xff\n").unwrap();
        writer.write_all(APP_ONE).unwrap();
        drop(writer);
        handle.join().unwrap().unwrap();
        let records = sink.records();
        assert!(
            records.iter().any(|(_, line)| line == "@app:one.app"),
            "{records:?}"
        );
    }
}
