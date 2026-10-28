import native from "./native.json";
import common from "./common.json";
import app from "./app.json";
import applicationUpdate from "./applicationUpdate.json";
import assetActions from "./assetActions.json";
import assetFileActions from "./assetFileActions.json";
import assetList from "./assetList.json";
import assetPreview from "./assetPreview.json";
import assetProblems from "./assetProblems.json";
import assetThumbnail from "./assetThumbnail.json";
import backgroundAutomation from "./backgroundAutomation.json";
import commandBar from "./commandBar.json";
import conversion from "./conversion.json";
import conversionHistory from "./conversionHistory.json";
import dialog from "./dialog.json";
import errorNotice from "./errorNotice.json";
import history from "./history.json";
import historyPresentation from "./historyPresentation.json";
import home from "./home.json";
import pdfPreview from "./pdfPreview.json";
import presets from "./presets.json";
import recentPresentation from "./recentPresentation.json";
import recentProjectDetails from "./recentProjectDetails.json";
import reviewDialog from "./reviewDialog.json";
import reviewFlow from "./reviewFlow.json";
import secondaryViews from "./secondaryViews.json";
import settings from "./settings.json";
import shortcuts from "./shortcuts.json";
import utils from "./utils.json";
import validation from "./validation.json";
import workbenchMenu from "./workbenchMenu.json";
import workspace from "./workspace.json";
import workspaceSearch from "./workspaceSearch.json";
import workspaceSidebar from "./workspaceSidebar.json";
import type { Catalog } from "../../i18n";
export default { native, common, app, applicationUpdate, assetActions, assetFileActions, assetList, assetPreview, assetProblems, assetThumbnail, backgroundAutomation, commandBar, conversion, conversionHistory, dialog, errorNotice, history, historyPresentation, home, pdfPreview, presets, recentPresentation, recentProjectDetails, reviewDialog, reviewFlow, secondaryViews, settings, shortcuts, utils, validation, workbenchMenu, workspace, workspaceSearch, workspaceSidebar } satisfies Catalog;

import { IntlMessageFormat } from "intl-messageformat";
const messages = new Map<string, IntlMessageFormat>();
export function formatMessage(message: string, values: Record<string, string | number>): string {
  let compiled = messages.get(message);
  if (!compiled) { compiled = new IntlMessageFormat(message, "en-US", undefined, {ignoreTag:true}); messages.set(message, compiled); }
  return String(compiled.format(values));
}
