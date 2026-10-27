use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use std::{collections::BTreeMap, fs, io::Read, path::{Component, Path, PathBuf}, sync::Arc, time::SystemTime};

/// A directory capability retained for one workspace lifetime. Every component
/// is opened without following links, including during initial root capture.
#[derive(Clone)]
pub(crate) struct ObservationRoot { path: PathBuf, directory: Arc<Dir> }
impl ObservationRoot {
    pub(crate) fn open(root: &Path) -> Result<Self, String> {
        Ok(Self { path: root.to_path_buf(), directory: Arc::new(Self::open_root(root).map_err(|error| error.to_string())?) })
    }
    fn open_root(root: &Path) -> std::io::Result<Dir> {
        if !root.is_absolute() { return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Workspace root must be absolute")); }
        let mut boundary = PathBuf::new();
        let mut names = Vec::new();
        for component in root.components() {
            match component {
                Component::Prefix(_) | Component::RootDir => boundary.push(component.as_os_str()),
                Component::Normal(name) => names.push(name),
                _ => return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Workspace root must be canonical")),
            }
        }
        let mut directory = Dir::open_ambient_dir(boundary, cap_std::ambient_authority())?;
        // The APIs' no-follow flag applies to the last component. Opening one
        // component at a time protects every ancestor on Unix and Windows.
        for name in names { directory = directory.open_dir_nofollow(name)?; }
        Ok(directory)
    }
    pub(crate) fn path(&self) -> &Path { &self.path }
    fn validate_current_root(&self) -> Result<(), String> {
        let current = Self::open_root(&self.path).map_err(|error| error.to_string())?;
        let actual = current.dir_metadata().map_err(|error| error.to_string())?;
        let expected = self.directory.dir_metadata().map_err(|error| error.to_string())?;
        if actual.dev() != expected.dev() || actual.ino() != expected.ino() {
            return Err("Workspace root changed; reopen the project".into());
        }
        Ok(())
    }
    pub(crate) fn validate_project(&self, main: &Path) -> Result<(), String> {
        self.validate_current_root()?;
        crate::journal::safe_path(&self.path, main)?;
        if main.parent() != Some(self.path.as_path()) || main.canonicalize().map_err(|error| error.to_string())? != main {
            return Err("Workspace main file changed; reopen the project".into());
        }
        Ok(())
    }
    fn open_file(&self, path: &Path) -> Option<cap_std::fs::File> {
        let relative = path.strip_prefix(&self.path).ok()?;
        let mut components = relative.components().peekable();
        let mut directory = self.directory.clone();
        while let Some(component) = components.next() {
            let Component::Normal(name) = component else { return None; };
            if components.peek().is_some() { directory = Arc::new(directory.open_dir_nofollow(name).ok()?); }
            else { return directory.open_with(name, OpenOptions::new().read(true).follow(FollowSymlinks::No)).ok(); }
        }
        None
    }
}

pub(crate) type Snapshot = BTreeMap<PathBuf, (u64, Option<SystemTime>)>;

pub(crate) fn snapshot(root: &Path) -> Result<Snapshot, String> {
    let mut result = BTreeMap::new();
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let mut visited = 0usize;
    while let Some((directory, depth)) = pending.pop() {
        if depth > 64 { return Err("项目目录层级过深，无法自动检测变化".into()); }
        for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            visited += 1;
            if visited > 50_000 { return Err("项目文件过多，无法自动检测变化".into()); }
            if matches!(entry.file_name().to_str(), Some(".git" | "node_modules" | "target" | "dist")) { continue; }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() { continue; }
            let path = entry.path();
            // Journal writes, SVG dependencies and managed PDFs are included. No file contents are read here.
            if kind.is_dir() { pending.push((path, depth + 1)); }
            else if kind.is_file() && relevant_path(&path) {
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                result.insert(path, (metadata.len(), metadata.modified().ok()));
            }
        }
    }
    Ok(result)
}

/// Validate every path component before reading bytes, and reject a concurrent
/// metadata change rather than acknowledging bytes we did not write.
pub(crate) fn verified_metadata(root: &ObservationRoot, path: &Path, expected: &str) -> Option<(u64, Option<SystemTime>)> {
    verified_metadata_with_hooks(root, path, expected, || {}, |_| {})
}

fn verified_metadata_with_hooks(root: &ObservationRoot, path: &Path, expected: &str, before_open: impl FnOnce(), after_read: impl FnOnce(&[u8])) -> Option<(u64, Option<SystemTime>)> {
    root.validate_current_root().ok()?;
    crate::journal::safe_path(&root.path, path).ok()?;
    before_open();
    // Metadata and content are read from the same no-follow handle. A leaf,
    // ancestor, or root pathname swap cannot redirect this read outside the
    // directory capability captured when the workspace was opened.
    let mut file = root.open_file(path)?;
    let before = file.metadata().ok()?;
    if !before.is_file() { return None; }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    after_read(&bytes);
    let after = file.metadata().ok()?;
    // An atomic replacement can leave the old handle readable. Acknowledge
    // only if the currently named no-follow leaf is still that same file.
    let current = root.open_file(path)?.metadata().ok()?;
    if after.dev() != current.dev() || after.ino() != current.ino()
        || after.len() != current.len() || after.modified().ok() != current.modified().ok() { return None; }
    root.validate_current_root().ok()?;
    crate::journal::safe_path(&root.path, path).ok()?;
    let before = (before.len(), before.modified().ok().map(|time| time.into_std()));
    let after = (after.len(), after.modified().ok().map(|time| time.into_std()));
    (before == after && crate::workspace::digest(&bytes) == expected).then_some(after)
}

pub(crate) fn relevant_path(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(),
        "tex" | "bib" | "sty" | "cls" | "cfg" | "png" | "jpg" | "jpeg" | "svg" | "webp" | "tif" | "tiff" | "bmp" | "gif" | "eps" | "ps" | "pdf" | "json" | "ttf" | "otf" | "woff" | "woff2"))
}

#[cfg(all(test, unix))]
mod nofollow_race_tests {
    use super::*;
    use std::{cell::RefCell, os::unix::fs::symlink};
    #[test]
    fn leaf_swapped_after_validation_never_reads_outside_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let output = root.join("a.pdf");
        let external = outside.path().join("a.pdf");
        fs::write(&output, b"inside").unwrap();
        fs::write(&external, b"outside").unwrap();
        let anchor = ObservationRoot::open(&root).unwrap();
        let read = RefCell::new(Vec::new());
        let result = verified_metadata_with_hooks(&anchor, &output, &crate::workspace::digest(b"inside"), || {
            fs::remove_file(&output).unwrap();
            symlink(&external, &output).unwrap();
        }, |bytes| read.borrow_mut().extend_from_slice(bytes));
        assert!(result.is_none());
        assert!(read.borrow().is_empty(), "symlink leaf must fail before reading any bytes");
    }
    #[test]
    fn ancestor_swapped_after_validation_never_reads_outside_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.join("outputs")).unwrap();
        let output = root.join("outputs/a.pdf");
        fs::write(&output, b"inside").unwrap();
        fs::write(outside.path().join("a.pdf"), b"outside").unwrap();
        let anchor = ObservationRoot::open(&root).unwrap();
        let read = RefCell::new(Vec::new());
        let result = verified_metadata_with_hooks(&anchor, &output, &crate::workspace::digest(b"inside"), || {
            fs::rename(root.join("outputs"), root.join("saved")).unwrap();
            symlink(outside.path(), root.join("outputs")).unwrap();
        }, |bytes| read.borrow_mut().extend_from_slice(bytes));
        assert!(result.is_none());
        assert!(read.borrow().is_empty(), "symlink ancestor must fail before reading any bytes");
    }
    #[test]
    fn leaf_replaced_after_handle_read_is_not_acknowledged_as_self_write() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let output = root.join("a.pdf");
        fs::write(&output, b"inside").unwrap();
        let anchor = ObservationRoot::open(&root).unwrap();
        let result = verified_metadata_with_hooks(&anchor, &output, &crate::workspace::digest(b"inside"), || {}, |_| {
            let replacement = root.join("replacement.pdf");
            fs::write(&replacement, b"edited").unwrap();
            fs::rename(&replacement, &output).unwrap();
        });
        assert!(result.is_none(), "the opened file must still be the leaf named by the path when acknowledging its metadata");
    }
    #[test]
    fn root_path_swap_cannot_redirect_an_existing_anchor() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().canonicalize().unwrap().join("project");
        fs::create_dir(&root).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let output = root.join("a.pdf");
        fs::write(&output, b"inside").unwrap();
        fs::write(outside.path().join("a.pdf"), b"outside").unwrap();
        let anchor = ObservationRoot::open(&root).unwrap();
        let read = RefCell::new(Vec::new());
        let _ = verified_metadata_with_hooks(&anchor, &output, &crate::workspace::digest(b"inside"), || {
            fs::rename(&root, root.with_file_name("saved")).unwrap();
            symlink(outside.path(), &root).unwrap();
        }, |bytes| read.borrow_mut().extend_from_slice(bytes));
        assert_eq!(&*read.borrow(), b"inside", "the retained anchor must still read the original root after pathname replacement");
    }
}
