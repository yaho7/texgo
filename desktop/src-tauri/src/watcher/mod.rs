//! One bounded native event worker per open desktop workspace. The handle stays
//! outside Workspace so preview snapshots remain independent and cloneable.
mod pending;
use pending::{Batch, Pending};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{path::{Path, PathBuf}, sync::{Arc, Condvar, Mutex}, thread, time::{Duration, Instant}};

pub(crate) const FALLBACK_INTERVAL: Duration = Duration::from_secs(30);
#[derive(Default)]
struct Inbox { pending: Pending, stopped: bool, retry: bool }
type Shared = Arc<(Mutex<Inbox>, Condvar)>;
pub(crate) struct Service {
    #[cfg_attr(not(feature = "desktop"), allow(dead_code))]
    pub session: u64,
    shared: Shared,
}

impl Drop for Service {
    fn drop(&mut self) {
        let (lock, wake) = &*self.shared;
        if let Ok(mut inbox) = lock.lock() { inbox.stopped = true; wake.notify_one(); }
    }
}
impl Service {
    pub fn start(root: PathBuf, session: u64, callback: impl FnMut(Batch) -> Result<(), String> + Send + 'static) -> Result<Self, String> {
        Self::start_with_interval(root, session, FALLBACK_INTERVAL, callback)
    }
    fn start_with_interval(root: PathBuf, session: u64, interval: Duration, mut callback: impl FnMut(Batch) -> Result<(), String> + Send + 'static) -> Result<Self, String> {
        let shared = Arc::new((Mutex::new(Inbox::default()), Condvar::new()));
        // Registration completes before returning, so a save immediately after
        // opening a project cannot fall into a worker startup gap.
        let mut backend = attach(&root, &shared);
        let worker = shared.clone();
        thread::Builder::new().name("texgo-observation".into()).spawn(move || {
            let mut fallback_at = Instant::now() + interval;
            loop {
                let (lock, wake) = &*worker;
                let Ok(mut inbox) = lock.lock() else { return; };
                if inbox.stopped { return; }
                let now = Instant::now();
                let fallback = now >= fallback_at;
                let batch = inbox.pending.take_due(now);
                if fallback || batch.is_some() {
                    let retry = fallback && (inbox.retry || backend.is_none());
                    if fallback { inbox.retry = false; fallback_at = now + interval; }
                    drop(inbox);
                    if retry { backend = attach(&root, &worker); }
                    // Callback may queue behind a foreground workspace mutation.
                    // Native producers keep coalescing into the bounded inbox.
                    if let Err(error) = callback(batch.unwrap_or_default()) {
                        eprintln!("Texgo workspace observation: {error}");
                        // A root can become inaccessible without a backend
                        // error (for example a disconnected network mount).
                        // Keep polling and re-register on the next fallback.
                        if let Ok(mut inbox) = worker.0.lock() { inbox.retry = true; }
                    }
                    continue;
                }
                let deadline = inbox.pending.deadline().map_or(fallback_at, |pending| pending.min(fallback_at));
                let _ = wake.wait_timeout(inbox, deadline.saturating_duration_since(now));
            }
        }).map_err(|error| error.to_string())?;
        Ok(Self { session, shared })
    }
}

fn attach(root: &Path, shared: &Shared) -> Option<RecommendedWatcher> {
    let sink = shared.clone();
    let watched_root = root.to_path_buf();
    let registered = (|| {
        let mut backend = RecommendedWatcher::new(move |result: notify::Result<Event>| {
            let (lock, wake) = &*sink;
            let Ok(mut inbox) = lock.lock() else { return; };
            if inbox.stopped { return; }
            match result {
                Ok(event) => queue_event(&mut inbox, &watched_root, event, Instant::now()),
                Err(error) => {
                    eprintln!("Texgo native observation: {error}");
                    inbox.retry = true;
                    inbox.pending.push([], true, Instant::now());
                }
            }
            wake.notify_one();
        }, Config::default().with_follow_symlinks(false))?;
        backend.watch(root, RecursiveMode::Recursive)?;
        Ok::<_, notify::Error>(backend)
    })();
    match registered {
        Ok(backend) => Some(backend),
        Err(error) => { eprintln!("Texgo native observation unavailable; retaining metadata fallback: {error}"); None }
    }
}

fn within_observed_root(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| !relative.components().any(|component| {
        matches!(component, std::path::Component::Normal(name) if matches!(name.to_str(), Some(".git" | "node_modules" | "target" | "dist")))
    }))
}

#[cfg(test)]
mod service_tests;

#[cfg(test)]
mod event_tests;

fn queue_event(inbox: &mut Inbox, root: &Path, event: Event, now: Instant) {
    if !event.need_rescan() && matches!(event.kind, EventKind::Access(_)) { return; }
    let rescan = event.need_rescan();
    inbox.retry |= rescan;
    // Keep resource paths regardless of suffix, and directory rename paths
    // regardless of dots. Workspace decides whether a path is a known resource
    // or requires only the authoritative metadata comparison.
    let paths = event.paths.into_iter().filter(|path| within_observed_root(root, path));
    inbox.pending.push(paths, rescan, now);
}
