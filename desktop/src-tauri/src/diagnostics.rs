#![cfg_attr(not(feature = "desktop"), allow(dead_code))]
//! Content-free, optional desktop diagnostics. Headless callers leave the global
//! sink uninitialized: JSON-RPC stdout and project files are never log targets.
use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, File, OpenOptions};
use serde::Serialize;
use std::{io::{self, Read, Write}, path::{Component, Path, PathBuf}, sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Mutex, OnceLock}, time::{Instant, SystemTime, UNIX_EPOCH}};

const LIMIT: u64 = 1024 * 1024;
const RETAIN: usize = 4; // current plus three previous files
const HEADER: &[u8] = b"{\"format\":\"texgo-diagnostics-v1\"}\n";
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static LOGGER: OnceLock<Logger> = OnceLock::new();
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Category { Workspace, Scanner, Conversion, Journal, Watcher, Automation, Notification }
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Level { Debug, Warn, Error }
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Event { Started, Completed, Failed, BackendUnavailable, ActionUnavailable, TrayUnavailable }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Record { time: u64, level: Level, category: Category, event: Event, count: u32, duration_ms: u32 }
struct Sink { directory: Dir, file: File, bytes: u64, limit: u64 }
pub(crate) struct Logger { debug: AtomicBool, sink: Mutex<Option<Sink>> }

impl Logger {
    fn open(path: &Path, debug: bool, limit: u64) -> io::Result<Self> {
        let directory = open_directory(path)?;
        prune(&directory, None)?;
        let (file, bytes) = create_file(&directory)?;
        prune(&directory, Some(&file))?;
        Ok(Self { debug: AtomicBool::new(debug), sink: Mutex::new(Some(Sink { directory, file, bytes, limit })) })
    }
    fn record(&self, category: Category, level: Level, event: Event, count: usize, elapsed: u128) {
        if matches!(level, Level::Debug) && !self.debug.load(Ordering::Relaxed) { return; }
        let record = Record { time: now(), level, category, event, count: count.min(u32::MAX as usize) as u32, duration_ms: elapsed.min(u32::MAX as u128) as u32 };
        let Ok(mut bytes) = serde_json::to_vec(&record) else { return; };
        bytes.push(b'\n');
        let Ok(mut guard) = self.sink.lock() else { return; };
        let Some(sink) = guard.as_mut() else { return; };
        // An I/O failure disables this optional sink. Never retry through an
        // arbitrary replacement path, and never include the native error text.
        if sink.write(&bytes).is_err() { *guard = None; }
    }
}
impl Sink {
    fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        if self.file.metadata()?.nlink() != 1 { return Err(invalid()); }
        if self.bytes + bytes.len() as u64 > self.limit {
            let (file, length) = create_file(&self.directory)?;
            self.file = file; self.bytes = length;
            prune(&self.directory, Some(&self.file))?;
        }
        self.file.write_all(bytes)?;
        self.bytes += bytes.len() as u64;
        Ok(())
    }
}
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u64::MAX as u128) as u64 }
fn invalid() -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, "Unsafe diagnostics location") }
#[cfg(feature = "desktop")]
pub(crate) fn ensure_directory(path: &Path) -> io::Result<()> { open_directory(path).map(|_| ()) }
fn open_directory(path: &Path) -> io::Result<Dir> {
    if !path.is_absolute() { return Err(invalid()); }
    let mut boundary = PathBuf::new(); let mut names = Vec::new();
    for component in path.components() {
        match component { Component::Prefix(_) | Component::RootDir => boundary.push(component.as_os_str()), Component::Normal(name) => names.push(name), _ => return Err(invalid()) }
    }
    let mut directory = Dir::open_ambient_dir(boundary, cap_std::ambient_authority())?;
    for name in names {
        match directory.create_dir(name) { Ok(()) => (), Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (), Err(e) => return Err(e) }
        directory = directory.open_dir_nofollow(name)?;
    }
    Ok(directory)
}
fn create_file(directory: &Dir) -> io::Result<(File, u64)> {
    // Never append/truncate a previous leaf, even if a name has been replaced.
    // The retained handle remains the only write target throughout its lifetime.
    for _ in 0..16 {
        let name = format!("texgo-{:020}-{:010}-{:020}.jsonl", now(), std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed));
        match directory.open_with(&name, OpenOptions::new().write(true).create_new(true).follow(FollowSymlinks::No)) {
            Ok(mut file) => { file.write_all(HEADER)?; return Ok((file, HEADER.len() as u64)); }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "Diagnostics name collision"))
}
fn prune(directory: &Dir, current: Option<&File>) -> io::Result<()> {
    // Wall-clock ordering applies only to archives. A clock rollback must not
    // make a newly created current file the oldest deletion candidate.
    let protected = current.map(|file| file.metadata()).transpose()?.map(|metadata| (metadata.dev(), metadata.ino()));
    let mut owned = Vec::new();
    for entry in directory.entries()? {
        let entry = entry?; let name = entry.file_name(); let Some(text) = name.to_str() else { continue; };
        if !text.starts_with("texgo-") || !text.ends_with(".jsonl") { continue; }
        let before = directory.symlink_metadata(&name)?;
        if !before.is_file() || before.nlink() != 1 { return Err(invalid()); }
        // A FIFO/device replacement after the type check must not block app
        // startup. Validate the opened handle too before reading its marker.
        let file = directory.open_with(&name, OpenOptions::new().read(true).nonblock(true).follow(FollowSymlinks::No))?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.nlink() != 1 || metadata.dev() != before.dev() || metadata.ino() != before.ino() { return Err(invalid()); }
        let mut header = vec![0; HEADER.len()];
        // Unknown files are preserved, including matching filenames.
        if file.take(HEADER.len() as u64).read_exact(&mut header).is_ok() && header == HEADER
            && protected != Some((metadata.dev(), metadata.ino())) { owned.push(name); }
    }
    owned.sort();
    let archive_limit = if protected.is_some() { RETAIN - 1 } else { RETAIN };
    let remove = owned.len().saturating_sub(archive_limit);
    for name in owned.into_iter().take(remove) { directory.remove_file(name)?; }
    Ok(())
}
#[cfg(feature = "desktop")]
pub(crate) fn initialize(path: &Path, debug: bool) { if let Ok(logger) = Logger::open(path, debug, LIMIT) { let _ = LOGGER.set(logger); } }
pub(crate) fn set_debug(enabled: bool) { if let Some(logger) = LOGGER.get() { logger.debug.store(enabled, Ordering::Relaxed); } }
pub(crate) fn event(category: Category, level: Level, event: Event, count: usize) { if let Some(logger) = LOGGER.get() { logger.record(category, level, event, count, 0); } }
pub(crate) fn trace<T, E>(category: Category, action: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
    let start = Instant::now(); event(category, Level::Debug, Event::Started, 0);
    let result = action();
    if let Some(logger) = LOGGER.get() { logger.record(category, if result.is_ok() { Level::Debug } else { Level::Error }, if result.is_ok() { Event::Completed } else { Event::Failed }, 1, start.elapsed().as_millis()); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn logs(path: &Path) -> Vec<PathBuf> { let mut files: Vec<_> = std::fs::read_dir(path).unwrap().map(|e| e.unwrap().path()).filter(|p|p.extension().is_some_and(|e|e=="jsonl")).collect(); files.sort(); files }
    fn temp() -> tempfile::TempDir { tempfile::tempdir().unwrap() }
    #[test]
    fn filters_at_runtime_and_serializes_only_typed_bounded_fields() {
        let dir = temp(); let path = dir.path().canonicalize().unwrap(); let logger = Logger::open(&path, false, LIMIT).unwrap();
        logger.record(Category::Scanner, Level::Debug, Event::Completed, 1, 1);
        logger.record(Category::Workspace, Level::Warn, Event::Failed, usize::MAX, u128::MAX);
        logger.debug.store(true, Ordering::Relaxed);
        logger.record(Category::Conversion, Level::Debug, Event::Completed, 2, 3);
        logger.debug.store(false, Ordering::Relaxed);
        logger.record(Category::Journal, Level::Debug, Event::Completed, 3, 4);
        let text = std::fs::read_to_string(&logs(&path)[0]).unwrap();
        let records: Vec<serde_json::Value> = text.lines().skip(1).map(|l|serde_json::from_str(l).unwrap()).collect();
        assert_eq!(records.len(), 2); assert_eq!(records[0]["level"], "warn"); assert_eq!(records[0]["count"], u32::MAX); assert_eq!(records[0]["durationMs"], u32::MAX);
        assert_eq!(records[1]["category"], "conversion");
        assert_eq!(records[1].as_object().unwrap().keys().cloned().collect::<Vec<_>>(), ["category", "count", "durationMs", "event", "level", "time"]);
    }
    #[test]
    fn rotation_restart_and_concurrent_lines_are_bounded() {
        let dir = temp(); let path = dir.path().canonicalize().unwrap();
        for _ in 0..6 { let logger = Logger::open(&path, true, 1024).unwrap(); std::thread::scope(|scope| { for _ in 0..4 { let logger = &logger; scope.spawn(move || for _ in 0..12 { logger.record(Category::Watcher, Level::Debug, Event::Completed, 1, 1); }); } }); }
        let files = logs(&path); assert_eq!(files.len(), RETAIN);
        for file in files { let bytes = std::fs::read(file).unwrap(); assert!(bytes.len() <= 1024); for line in bytes.split(|b|*b==b'\n').filter(|l|!l.is_empty()) { serde_json::from_slice::<serde_json::Value>(line).unwrap(); } }
    }
    #[test]
    #[cfg(unix)]
    fn clock_rollback_never_prunes_the_current_file_at_startup_or_rotation() {
        let dir = temp(); let path = dir.path().canonicalize().unwrap();
        for index in 0..RETAIN {
            std::fs::write(path.join(format!("texgo-99999999999999999999-0000000000-{index:020}.jsonl")), HEADER).unwrap();
        }
        let logger = Logger::open(&path, true, 1024).unwrap();
        logger.record(Category::Workspace, Level::Debug, Event::Completed, 7, 0);
        let named_current = || {
            let sink = logger.sink.lock().unwrap(); let identity = sink.as_ref().unwrap().file.metadata().unwrap();
            let file = logs(&path).into_iter().find(|file| { let metadata = std::fs::metadata(file).unwrap(); metadata.dev() == identity.dev() && metadata.ino() == identity.ino() }).expect("current handle must retain a directory entry");
            let text = std::fs::read_to_string(file).unwrap();
            assert!(text.lines().skip(1).any(|line| serde_json::from_str::<serde_json::Value>(line).unwrap()["category"] == "workspace"));
        };
        named_current(); assert_eq!(logs(&path).len(), RETAIN);
        for _ in 0..32 { logger.record(Category::Workspace, Level::Debug, Event::Completed, 1, 0); }
        named_current(); assert_eq!(logs(&path).len(), RETAIN);
    }
    #[test]
    fn unavailable_disk_is_optional_and_unrelated_files_are_preserved() {
        let dir = temp(); let path = dir.path().canonicalize().unwrap();
        let other = path.join("texgo-unrelated.jsonl"); std::fs::write(&other, "private unrelated bytes").unwrap();
        let logger = Logger::open(&path, true, LIMIT).unwrap(); logger.record(Category::Journal, Level::Error, Event::Failed, 0, 0);
        assert_eq!(std::fs::read_to_string(other).unwrap(), "private unrelated bytes");
        let file = path.join("file"); std::fs::write(&file, "untouched").unwrap(); assert!(Logger::open(&file.join("logs"), true, LIMIT).is_err()); assert_eq!(std::fs::read_to_string(file).unwrap(), "untouched");
        let logger = Logger { debug: AtomicBool::new(true), sink: Mutex::new(None) }; logger.record(Category::Scanner, Level::Error, Event::Failed, 0, 0);
    }
    #[test]
    fn write_failure_disables_the_sink_without_panicking_or_retrying_paths() {
        let dir = temp(); let path = dir.path().canonicalize().unwrap(); let logger = Logger::open(&path, true, LIMIT).unwrap();
        let file = logs(&path).pop().unwrap();
        // A retained read-only handle deterministically simulates write failure,
        // without permissions/root assumptions or touching a device/home path.
        logger.sink.lock().unwrap().as_mut().unwrap().file = File::from_std(std::fs::File::open(file).unwrap());
        logger.record(Category::Journal, Level::Error, Event::Failed, 0, 0);
        assert!(logger.sink.lock().unwrap().is_none());
        logger.record(Category::Journal, Level::Error, Event::Failed, 0, 0);
    }
    #[cfg(unix)]
    #[test]
    fn a_matching_fifo_cannot_block_optional_logger_startup() {
        let dir = temp(); let path = dir.path().canonicalize().unwrap(); let fifo = path.join("texgo-unsafe.jsonl");
        assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || { let _ = sender.send(Logger::open(&path, true, LIMIT).is_err()); });
        assert!(receiver.recv_timeout(std::time::Duration::from_secs(1)).expect("FIFO must be rejected without opening a blocking reader"));
        worker.join().unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn replaced_leaf_never_redirects_the_retained_write_handle() {
        let dir = temp(); let path = dir.path().canonicalize().unwrap(); let logger = Logger::open(&path, true, LIMIT).unwrap();
        let current = logs(&path).pop().unwrap(); let retained = path.join("retained");
        std::fs::rename(&current, &retained).unwrap(); let unrelated = path.join("private"); std::fs::write(&unrelated, "private data").unwrap();
        std::os::unix::fs::symlink(&unrelated, &current).unwrap();
        logger.record(Category::Workspace, Level::Error, Event::Failed, 1, 0);
        assert_eq!(std::fs::read_to_string(&unrelated).unwrap(), "private data");
        assert!(std::fs::read_to_string(&retained).unwrap().contains("workspace"));
        // Newly introduced hard links cause the optional sink to stop writing.
        std::fs::hard_link(&retained, path.join("linked")).unwrap();
        let before = std::fs::read(&retained).unwrap(); logger.record(Category::Workspace, Level::Error, Event::Failed, 1, 0);
        assert!(logger.sink.lock().unwrap().is_none()); assert_eq!(std::fs::read(&retained).unwrap(), before);
    }
    #[cfg(unix)]
    #[test]
    fn links_are_never_followed_or_written() {
        let dir = temp(); let path = dir.path().canonicalize().unwrap(); let target = path.join("target"); std::fs::create_dir(&target).unwrap();
        let link = path.join("link"); std::os::unix::fs::symlink(&target, &link).unwrap(); assert!(Logger::open(&link, true, LIMIT).is_err()); assert!(logs(&target).is_empty());
        let original = path.join("original"); std::fs::write(&original, "private").unwrap(); let leaf = target.join("texgo-unsafe.jsonl");
        std::os::unix::fs::symlink(&original, &leaf).unwrap(); assert!(Logger::open(&target, true, LIMIT).is_err()); std::fs::remove_file(&leaf).unwrap();
        std::fs::hard_link(&original, &leaf).unwrap(); assert!(Logger::open(&target, true, LIMIT).is_err()); assert_eq!(std::fs::read_to_string(original).unwrap(), "private");
    }
}
