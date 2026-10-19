import { FileCode2, FolderOpen, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecentWorkspace } from "./recents";
import { fileName } from "./utils";

interface Props { busy: boolean; onOpenTex: () => void; recents: RecentWorkspace[]; onRecent: (entry: RecentWorkspace) => void }

export default function Home(props: Props) {
  return <main id="main-content" tabIndex={-1} className="home-workspace page-transition">
    <section className="home-opening" aria-labelledby="home-title">
      <span className="home-mark"><FileCode2 aria-hidden="true" /></span>
      <div className="home-copy"><h1 id="home-title" translate="no">Texgo</h1><p>让 LaTeX 项目的图片保持最新</p></div>
      <p className="home-drop-hint">拖入 main.tex 开始</p>
      <Button disabled={props.busy} onClick={props.onOpenTex}>{props.busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <FolderOpen data-icon="inline-start" aria-hidden="true" />}打开 LaTeX 项目</Button>
      {props.recents.length > 0 && <section className="home-recents" aria-label="最近项目"><h2>最近项目</h2><ul className="recent-list">{props.recents.slice(0, 5).map((entry) => <li key={entry.path}><Button variant="ghost" className="recent-open" disabled={props.busy} onClick={() => props.onRecent(entry)}><FileCode2 aria-hidden="true" /><span className="recent-copy"><strong>{fileName(entry.path)}</strong><span title={entry.path}>{entry.path}</span></span></Button></li>)}</ul></section>}
    </section>
  </main>;
}
