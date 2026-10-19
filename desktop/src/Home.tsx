import { Clock3, FileCode2, FolderOpen, Images, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import IconButton from "./IconButton";
import type { RecentWorkspace } from "./recents";
import { workspaceKey } from "./recents";
import { fileName } from "./utils";

interface Props {
  busy: boolean;
  recursive: boolean;
  recents: RecentWorkspace[];
  failedRecent: string | null;
  onRecursive: (value: boolean) => void;
  onOpenTex: () => void;
  onOpenDirectory: () => void;
  onRecent: (entry: RecentWorkspace) => void;
  onRemove: (entry: RecentWorkspace) => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export default function Home(props: Props) {
  return <main id="main-content" tabIndex={-1} className="home-workspace">
    <section className="home-opening" aria-labelledby="home-title">
      <span className="home-mark"><FileCode2 aria-hidden="true" /></span>
      <h1 id="home-title">打开 .tex 主文件</h1>
      <div className="home-actions">
        <Button disabled={props.busy} onClick={props.onOpenTex}>{props.busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <FolderOpen data-icon="inline-start" aria-hidden="true" />}打开 .tex 主文件</Button>
        <Button variant="outline" disabled={props.busy} onClick={props.onOpenDirectory}><Images data-icon="inline-start" aria-hidden="true" />转换图片目录</Button>
      </div>
      <Field orientation="horizontal" className="home-recursive">
        <FieldLabel htmlFor="home-recursive" className="checkbox-option">
          <Checkbox id="home-recursive" name="recursive" checked={props.recursive} disabled={props.busy} onCheckedChange={(checked) => props.onRecursive(checked === true)} />
          <span>图片目录包含子目录</span>
        </FieldLabel>
      </Field>
    </section>
    <section className="recent-section" aria-labelledby="recent-title">
      <header><h2 id="recent-title"><Clock3 aria-hidden="true" />最近打开</h2><span>{props.recents.length}</span></header>
      {props.recents.length === 0 ? <p className="recent-empty">暂无最近记录</p> : <ul className="recent-list">
        {props.recents.map((entry) => <li key={workspaceKey(entry)} className="recent-item">
          <Button variant="ghost" className="recent-open" disabled={props.busy} aria-label={`打开最近${entry.mode === "tex" ? "项目" : "目录"} ${entry.path}`} onClick={() => props.onRecent(entry)}>
            {entry.mode === "tex" ? <FileCode2 aria-hidden="true" /> : <Images aria-hidden="true" />}
            <span className="recent-copy"><strong>{fileName(entry.path)}</strong><span title={entry.path}>{entry.path}</span>{props.failedRecent === workspaceKey(entry) && <span className="text-destructive">无法打开，请检查路径或重新选择</span>}</span>
            <Badge variant="secondary">{entry.mode === "tex" ? "TeX" : "目录"}</Badge>
            <time dateTime={new Date(entry.openedAt).toISOString()}>{dateFormat.format(entry.openedAt)}</time>
          </Button>
          <IconButton label={`移除最近记录 ${entry.path}`} disabled={props.busy} onClick={() => props.onRemove(entry)}><X aria-hidden="true" /></IconButton>
        </li>)}
      </ul>}
    </section>
  </main>;
}
