use super::*;
#[test]
fn rapid_events_trail_and_coalesce() {
    let mut pending = Pending::default();
    let start = Instant::now();
    pending.push([PathBuf::from("a.tex")], false, start);
    pending.push([PathBuf::from("a.tex"), PathBuf::from("b.png")], false, start + Duration::from_millis(300));
    assert!(pending.take_due(start + Duration::from_millis(500)).is_none());
    let batch = pending.take_due(start + Duration::from_millis(800)).unwrap();
    assert_eq!(batch.paths.len(), 2);
    assert!(!batch.force);
    assert!(pending.take_due(start + Duration::from_secs(2)).is_none());
}
#[test]
fn overflow_coalesces_to_one_safe_rescan() {
    let mut pending = Pending::default();
    let now = Instant::now();
    pending.push((0..MAX_PATHS + 1).map(|n| PathBuf::from(format!("{n}.png"))), false, now);
    let batch = pending.take_due(now + DEBOUNCE).unwrap();
    assert!(batch.force);
    assert!(batch.paths.is_empty());
}
#[test]
fn rescan_signal_survives_coalescing() {
    let mut pending = Pending::default();
    let now = Instant::now();
    pending.push([], true, now);
    assert!(pending.take_due(now + DEBOUNCE).unwrap().force);
}
