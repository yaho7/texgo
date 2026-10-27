use super::*;
use std::{fs, sync::mpsc};

#[test]
fn real_native_source_save_refreshes_a_workspace() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    image::RgbImage::new(20, 10).save(root.join("a.png")).unwrap();
    fs::write(root.join("main.tex"), r"\includegraphics{a.png}").unwrap();
    let mut workspace = crate::Workspace::open(&root.join("main.tex")).unwrap();
    let options = crate::preferences::Preferences::default().options(vec![]);
    workspace.update_pending_with_results(&options, &std::sync::atomic::AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    let (sender, receiver) = mpsc::channel();
    let _service = Service::start(root.clone(), 7, move |batch| {
        if let Some(project) = workspace.reconcile_observation(&batch.paths, batch.force)? { let _ = sender.send(project); }
        Ok(())
    }).unwrap();
    image::RgbImage::new(31, 11).save(root.join("a.png")).unwrap();
    let project = receiver.recv_timeout(Duration::from_secs(10)).expect("native source save should refresh without frontend polling");
    assert_eq!(project.status.pending_images, 1);
    assert!(project.images[0].update_available);
}

#[test]
fn initialization_failure_keeps_fallback_and_retries() {
    let directory = tempfile::tempdir().unwrap();
    let absent = directory.path().join("temporarily-unavailable");
    let (sender, receiver) = mpsc::channel();
    let _service = Service::start_with_interval(absent.clone(), 4, Duration::from_millis(40), move |_| { let _ = sender.send(()); Ok(()) }).unwrap();
    receiver.recv_timeout(Duration::from_secs(2)).expect("failed native init must retain fallback");
    fs::create_dir(&absent).unwrap();
    fs::write(absent.join("main.tex"), "save").unwrap();
    receiver.recv_timeout(Duration::from_secs(2)).expect("fallback retries continue after the root returns");
}

#[test]
fn a_dropped_service_stops_its_fallback_worker() {
    let directory = tempfile::tempdir().unwrap();
    let (sender, receiver) = mpsc::channel();
    let service = Service::start_with_interval(directory.path().to_path_buf(), 5, Duration::from_secs(1), move |_| { let _ = sender.send(()); Ok(()) }).unwrap();
    drop(service);
    assert!(matches!(receiver.recv_timeout(Duration::from_secs(2)), Err(mpsc::RecvTimeoutError::Disconnected)));
}
