use super::*;
use notify::event::{AccessKind, Flag, ModifyKind, RenameMode};
#[test]
fn read_events_do_not_feed_back_into_observation() {
    let mut inbox = Inbox::default();
    queue_event(&mut inbox, Path::new("/paper"), Event::new(EventKind::Access(AccessKind::Read)).add_path("/paper/a.png".into()), Instant::now());
    assert!(inbox.pending.deadline().is_none());
}
#[test]
fn rescan_is_honored_even_on_access_or_filtered_paths() {
    let mut inbox = Inbox::default();
    let now = Instant::now();
    queue_event(&mut inbox, Path::new("/paper"), Event::new(EventKind::Access(AccessKind::Read)).add_path("/outside/ignored.log".into()).set_flag(Flag::Rescan), now);
    assert!(inbox.pending.take_due(now + pending::DEBOUNCE).unwrap().force);
    assert!(inbox.retry);
}
#[test]
fn dotted_directory_rename_is_not_lost_to_extension_filtering() {
    let mut inbox = Inbox::default();
    let now = Instant::now();
    queue_event(&mut inbox, Path::new("/paper"), Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
        .add_path("/paper/figures.v1".into()).add_path("/paper/figures.v2".into()), now);
    assert_eq!(inbox.pending.take_due(now + pending::DEBOUNCE).unwrap().paths.len(), 2);
}
#[test]
fn outside_paths_and_private_build_trees_are_not_observed() {
    let mut inbox = Inbox::default();
    queue_event(&mut inbox, Path::new("/paper"), Event::new(EventKind::Any).add_path("/outside/a.png".into()).add_path("/paper/.git/a.tex".into()), Instant::now());
    assert!(inbox.pending.deadline().is_none());
}

#[test]
fn arbitrary_resource_extensions_reach_the_dependency_policy() {
    let mut inbox = Inbox::default();
    let now = Instant::now();
    queue_event(&mut inbox, Path::new("/paper"), Event::new(EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Any))).add_path("/paper/linked.data".into()), now);
    assert_eq!(inbox.pending.take_due(now + pending::DEBOUNCE).unwrap().paths, vec![PathBuf::from("/paper/linked.data")]);
}
