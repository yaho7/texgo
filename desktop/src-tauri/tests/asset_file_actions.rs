use std::{fs, path::PathBuf};
use texgo_desktop::Workspace;

fn fixture(name: &str) -> (tempfile::TempDir, Workspace, String, String, PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    image::RgbImage::new(2, 2).save(&path).unwrap();
    fs::write(root.join("main.tex"), format!("\\includegraphics{{{name}}}")).unwrap();
    let workspace = Workspace::open(&root.join("main.tex")).unwrap();
    let id = workspace.project().images[0].id.clone();
    let main = workspace.project().main_file.clone();
    (directory, workspace, id, main, path)
}

#[test]
fn resolves_owned_unicode_source_without_mutating_project() {
    let (_directory, workspace, id, main, path) = fixture("图 像/压力.png");
    let before = serde_json::to_value(workspace.project()).unwrap();
    assert_eq!(workspace.asset_path(&id, &main).unwrap(), path);
    assert_eq!(serde_json::to_value(workspace.project()).unwrap(), before);
}
#[test]
fn rejects_unknown_missing_and_stale_project() {
    let (_directory, workspace, id, main, path) = fixture("plot.png");
    assert!(workspace.asset_path("unknown", &main).is_err());
    assert!(workspace.asset_path(&id, "/another/main.tex").is_err());
    fs::remove_file(path).unwrap();
    assert!(workspace.asset_path(&id, &main).is_err());
}
#[test]
fn rejects_unresolved_and_directory_sources() {
    let (_directory, mut workspace, id, main, path) = fixture("plot.png");
    fs::remove_file(&path).unwrap();
    workspace.refresh().unwrap();
    assert!(workspace.asset_path(&id, &main).is_err());
    fs::create_dir(&path).unwrap();
    assert!(workspace.asset_path(&id, &main).is_err());
}
#[cfg(unix)]
#[test]
fn rejects_symlink_leaf_and_parent() {
    use std::os::unix::fs::symlink;
    let (directory, workspace, id, main, path) = fixture("figures/plot.png");
    let outside = tempfile::tempdir().unwrap();
    fs::copy(&path, outside.path().join("plot.png")).unwrap();
    fs::remove_file(&path).unwrap();
    symlink(outside.path().join("plot.png"), &path).unwrap();
    assert!(workspace.asset_path(&id, &main).is_err());
    fs::remove_file(&path).unwrap(); fs::remove_dir(path.parent().unwrap()).unwrap();
    symlink(outside.path(), directory.path().join("figures")).unwrap();
    assert!(workspace.asset_path(&id, &main).is_err());
}
#[test]
fn rejects_replaced_root_even_at_same_path() {
    let (_directory, workspace, id, main, path) = fixture("plot.png");
    let root = path.parent().unwrap();
    let saved = root.with_extension("saved");
    fs::rename(root, &saved).unwrap();
    fs::create_dir(root).unwrap();
    fs::copy(saved.join("main.tex"), root.join("main.tex")).unwrap();
    fs::copy(saved.join("plot.png"), root.join("plot.png")).unwrap();
    let result = workspace.asset_path(&id, &main);
    fs::remove_dir_all(root).unwrap(); fs::rename(saved, root).unwrap();
    assert!(result.is_err());
}
