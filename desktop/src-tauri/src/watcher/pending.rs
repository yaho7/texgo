use std::{collections::BTreeSet, path::PathBuf, time::{Duration, Instant}};
pub(super) const DEBOUNCE: Duration = Duration::from_millis(500);
pub(super) const MAX_PATHS: usize = 1024;
#[derive(Default)]
pub(crate) struct Batch { pub paths: Vec<PathBuf>, pub force: bool }
#[derive(Default)]
pub(super) struct Pending { paths: BTreeSet<PathBuf>, force: bool, deadline: Option<Instant> }
impl Pending {
    pub fn push(&mut self, paths: impl IntoIterator<Item = PathBuf>, force: bool, now: Instant) {
        self.force |= force;
        for path in paths {
            if self.force { break; }
            self.paths.insert(path);
            if self.paths.len() > MAX_PATHS { self.force = true; }
        }
        if self.force { self.paths.clear(); }
        if self.force || !self.paths.is_empty() { self.deadline = Some(now + DEBOUNCE); }
    }
    pub fn deadline(&self) -> Option<Instant> { self.deadline }
    pub fn take_due(&mut self, now: Instant) -> Option<Batch> {
        if !self.deadline.is_some_and(|deadline| now >= deadline) { return None; }
        self.deadline = None;
        Some(Batch { paths: std::mem::take(&mut self.paths).into_iter().collect(), force: std::mem::take(&mut self.force) })
    }
}
#[cfg(test)]
#[path = "pending_tests.rs"]
mod tests;
