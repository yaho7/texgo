export interface Preferences {
  startup: "home" | "lastWorkspace";
  autoWatch: boolean;
  autoUpdate: boolean;
  recursive: boolean;
  dpi: number;
  jpegQuality: number;
  outputDir: string;
  afterConversion: "stay" | "history" | "review";
  allowUnreviewed: boolean;
  notifySuccess: boolean;
  notifyFailure: boolean;
  notifyUnchanged: boolean;
  shortcutEnabled: boolean;
  shortcut: string;
  closeAction: "background" | "quit";
}
export const defaultPreferences: Preferences = {
  startup: "home", autoWatch: true, autoUpdate: true, recursive: true,
  dpi: 300, jpegQuality: 90, outputDir: "texgo-pdf", afterConversion: "stay", allowUnreviewed: false,
  notifySuccess: true, notifyFailure: true, notifyUnchanged: false,
  shortcutEnabled: true, shortcut: "CommandOrControl+Alt+Enter", closeAction: "background",
};
