use crate::localization::tr;
use tauri::{menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder}, Emitter};

pub(crate) fn refresh(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open-project", tr("openLaTeXProject", &[])).accelerator("CmdOrCtrl+O").build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", tr("rescan", &[])).accelerator("CmdOrCtrl+R").build(app)?;
    let convert = MenuItemBuilder::with_id("convert", tr("performNextProjectAction", &[])).accelerator("CmdOrCtrl+Enter").build(app)?;
    let review = MenuItemBuilder::with_id("review", tr("reviewReferences", &[])).accelerator("CmdOrCtrl+Shift+Enter").build(app)?;
    let undo = MenuItemBuilder::with_id("undo-task", tr("undoLastOperation", &[])).build(app)?;
    let update = MenuItemBuilder::with_id("check-updates", tr("checkForUpdates", &[])).build(app)?;
    let close = MenuItemBuilder::with_id("close-project", tr("closeCurrentProject", &[])).build(app)?;
    let file = SubmenuBuilder::new(app, tr("project", &[])).item(&open).item(&close).separator().item(&refresh).build()?;
    let task = SubmenuBuilder::new(app, tr("tasks", &[])).items(&[&convert, &review]).separator().item(&undo).build()?;
    let edit = SubmenuBuilder::new(app, tr("edit", &[])).items(&[
        &PredefinedMenuItem::undo(app, Some(&tr("editUndo", &[])))?, &PredefinedMenuItem::redo(app, Some(&tr("editRedo", &[])))?,
        &PredefinedMenuItem::cut(app, Some(&tr("editCut", &[])))?, &PredefinedMenuItem::copy(app, Some(&tr("editCopy", &[])))?, &PredefinedMenuItem::paste(app, Some(&tr("editPaste", &[])))?, &PredefinedMenuItem::select_all(app, Some(&tr("editSelectAll", &[])))?,
    ]).build()?;
    let settings = MenuItemBuilder::with_id("settings", tr("settings", &[])).accelerator("CmdOrCtrl+,").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", tr("quitTexgo", &[])).build(app)?;
    let help = SubmenuBuilder::new(app, tr("help", &[])).item(&settings).item(&update).separator().item(&quit).build()?;
    let builder = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let builder = builder.item(&SubmenuBuilder::new(app, "Texgo")
        .item(&PredefinedMenuItem::about(app, Some(&tr("aboutTexgo", &[])), None)?).separator()
        .item(&PredefinedMenuItem::hide(app, Some(&tr("hideTexgo", &[])))?).item(&PredefinedMenuItem::hide_others(app, Some(&tr("hideOthers", &[])))?).separator()
        .item(&PredefinedMenuItem::quit(app, Some(&tr("quitTexgo", &[])))?).build()?);
    app.set_menu(builder.items(&[&file, &edit, &task, &help]).build()?)?;

    Ok(())
}

pub(crate) fn install(app: &tauri::App) -> tauri::Result<()> {
    refresh(app.handle())?;
    app.on_menu_event(|handle, event| { if event.id().as_ref() == "quit" { handle.exit(0); return; } let _ = handle.emit("menu-action", event.id().as_ref()); });
    Ok(())
}
