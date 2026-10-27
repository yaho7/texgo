import type { RecentWorkspace } from "./recents";
import { recentOpenedAt, recentProjectPath } from "./recentPresentation";

export default function RecentProjectDetails({ entry, failed = false }: { entry: RecentWorkspace; failed?: boolean }) {
  const { name, directory } = recentProjectPath(entry.path);
  const opened = recentOpenedAt(entry.openedAt);
  return <span className="recent-copy">
    <strong>{name}</strong>
    <span title={directory}>{directory}</span>
    {opened.iso ? <time className="recent-time" dateTime={opened.iso} title={opened.iso}>{opened.label}</time> : <span className="recent-time">{opened.label}</span>}
    {failed && <span className="text-destructive">无法打开，请重新选择</span>}
  </span>;
}
