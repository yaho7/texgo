import { FileCode2, FolderOpen, Images, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";

interface Props {
  busy: boolean;
  recursive: boolean;
  onRecursive: (value: boolean) => void;
  onOpenTex: () => void;
  onOpenDirectory: () => void;
}

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
  </main>;
}
