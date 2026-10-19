import { FileCode2, FolderOpen, Images, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  busy: boolean;
  onOpenTex: () => void;
  onOpenDirectory: () => void;
}

export default function Home(props: Props) {
  return <main id="main-content" tabIndex={-1} className="home-workspace">
    <section className="home-opening" aria-labelledby="home-title">
      <span className="home-mark"><FileCode2 aria-hidden="true" /></span>
      <h1 id="home-title">打开 .tex 主文件</h1>
      <p className="home-drop-hint">拖入 .tex 主文件，或选择一个项目</p>
      <div className="home-actions">
        <Button disabled={props.busy} onClick={props.onOpenTex}>{props.busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <FolderOpen data-icon="inline-start" aria-hidden="true" />}打开 .tex 主文件</Button>
        <Button variant="outline" disabled={props.busy} onClick={props.onOpenDirectory}><Images data-icon="inline-start" aria-hidden="true" />批量转换图片</Button>
      </div>
    </section>
  </main>;
}
