use tauri::{menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder}, Emitter};

pub(crate) fn install(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open-project", "打开 LaTeX 项目…").accelerator("CmdOrCtrl+O").build(app)?;
    let directory = MenuItemBuilder::with_id("open-directory", "批量转换图片…").accelerator("CmdOrCtrl+Shift+O").build(app)?;
    let add = MenuItemBuilder::with_id("add-directory", "添加图片目录…").build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", "重新扫描").accelerator("CmdOrCtrl+R").build(app)?;
    let convert = MenuItemBuilder::with_id("convert", "转换所选图片").accelerator("CmdOrCtrl+Enter").build(app)?;
    let review = MenuItemBuilder::with_id("review", "检查引用变更").accelerator("CmdOrCtrl+Shift+Enter").build(app)?;
    let undo = MenuItemBuilder::with_id("undo-task", "撤销最近任务").build(app)?;
    let update = MenuItemBuilder::with_id("check-updates", "检查应用更新…").build(app)?;
    let file = SubmenuBuilder::new(app, "文件").items(&[&open, &directory, &add]).separator().item(&refresh).build()?;
    let task = SubmenuBuilder::new(app, "任务").items(&[&convert, &review]).separator().item(&undo).build()?;
    let edit = SubmenuBuilder::new(app, "编辑").items(&[
        &PredefinedMenuItem::undo(app, None)?, &PredefinedMenuItem::redo(app, None)?,
        &PredefinedMenuItem::cut(app, None)?, &PredefinedMenuItem::copy(app, None)?, &PredefinedMenuItem::paste(app, None)?, &PredefinedMenuItem::select_all(app, None)?,
    ]).build()?;
    let settings = MenuItemBuilder::with_id("settings", "设置…").accelerator("CmdOrCtrl+,").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出 Texgo").build(app)?;
    let help = SubmenuBuilder::new(app, "帮助").item(&settings).item(&update).separator().item(&quit).build()?;
    let builder = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let builder = builder.item(&SubmenuBuilder::new(app, "Texgo")
        .item(&PredefinedMenuItem::about(app, None, None)?).separator()
        .item(&PredefinedMenuItem::hide(app, None)?).item(&PredefinedMenuItem::hide_others(app, None)?).separator()
        .item(&PredefinedMenuItem::quit(app, None)?).build()?);
    app.set_menu(builder.items(&[&file, &edit, &task, &help]).build()?)?;
    app.on_menu_event(|handle, event| { if event.id().as_ref() == "quit" { handle.exit(0); return; } let _ = handle.emit("menu-action", event.id().as_ref()); });
    Ok(())
}
