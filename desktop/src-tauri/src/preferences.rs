use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use crate::ConversionOptions;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub startup: String,
    pub auto_watch: bool,
    pub auto_update: bool,
    pub dpi: u32,
    pub jpeg_quality: u8,
    pub output_dir: String,
    pub allow_unreviewed: bool,
    pub notify_success: bool,
    pub notify_failure: bool,
    pub notify_unchanged: bool,
    pub shortcut_enabled: bool,
    pub shortcut: String,
    pub close_action: String,
    #[serde(default)]
    pub debug_logging: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self { startup: "home".into(), auto_watch: true, auto_update: true,
            dpi: 300, jpeg_quality: 90, output_dir: "texgo-pdf".into(),
            allow_unreviewed: false, notify_success: true, notify_failure: true, notify_unchanged: false,
            shortcut_enabled: true, shortcut: "CommandOrControl+Alt+Enter".into(), close_action: "background".into(), debug_logging: false }
    }
}

impl Preferences {
    pub fn options(&self, image_ids: Vec<String>) -> ConversionOptions {
        ConversionOptions { image_ids, quality: "custom".into(), dpi: self.dpi, jpeg_quality: self.jpeg_quality, output_dir: self.output_dir.clone() }
    }
    pub fn validate(&self) -> Result<(), String> {
        crate::conversion::validate(&self.options(vec![]))?;
        // The same path policy as a real conversion, without touching a workspace.
        if !matches!(self.startup.as_str(), "home" | "lastWorkspace")
            || !matches!(self.close_action.as_str(), "background" | "quit") { return Err("无效的设置选项".into()); }
        if self.shortcut_enabled && (self.shortcut.trim().is_empty() || self.shortcut.len() > 100) { return Err("请输入全局快捷键".into()); }
        Ok(())
    }
    pub fn load(path: &Path) -> Result<Self, String> {
        match fs::read(path) {
            Ok(bytes) => {
                let value: Self = serde_json::from_slice(&bytes).map_err(|e| format!("设置文件损坏：{e}"))?;
                value.validate()?;
                Ok(value)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("无法读取设置：{e}")),
        }
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
        let parent = path.parent().ok_or("设置目录不存在")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let root = parent.canonicalize().map_err(|e| e.to_string())?;
        crate::journal::output_directory(&root, &self.output_dir)?;
        crate::workspace::save_atomic(path, &serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_migration_and_atomic_persistence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("preferences.json");
        let mut prefs = Preferences::load(&path).unwrap();
        assert_eq!(prefs.jpeg_quality, 90);
        assert!(!prefs.debug_logging);
        assert!(!prefs.allow_unreviewed && prefs.notify_success && prefs.notify_failure && !prefs.notify_unchanged);
        prefs.auto_watch = false; prefs.shortcut_enabled = false; prefs.debug_logging = true;
        prefs.save(&path).unwrap();
        assert_eq!(Preferences::load(&path).unwrap(), prefs);
        fs::write(&path, r#"{"autoWatch":false,"recursive":false,"afterConversion":"history"}"#).unwrap();
        assert_eq!(Preferences::load(&path).unwrap().jpeg_quality, 90);
        assert!(!Preferences::load(&path).unwrap().auto_watch);
        assert!(!Preferences::load(&path).unwrap().debug_logging);
    }
    #[test]
    fn invalid_values_never_replace_valid_preferences() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("preferences.json");
        let mut prefs = Preferences::default(); prefs.save(&path).unwrap();
        prefs.output_dir = "../outside".into(); assert!(prefs.save(&path).is_err());
        assert_eq!(Preferences::load(&path).unwrap(), Preferences::default());
        prefs = Preferences::default(); prefs.dpi = 0; assert!(prefs.save(&path).is_err());
        fs::write(&path, "bad json").unwrap(); assert!(Preferences::load(&path).is_err());
    }
}
