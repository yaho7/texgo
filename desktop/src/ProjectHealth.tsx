import type { WorkspaceStatus } from "./types";

export default function ProjectHealth({ status }: { status: WorkspaceStatus }) {
  return <section className="project-health" aria-label="项目状态">
    <dl>
      <div><dt>图片</dt><dd>{status.totalImages}</dd></div>
      <div><dt>待更新</dt><dd>{status.pendingImages}</dd></div>
      <div><dt>问题</dt><dd>{status.problemCount}</dd></div>
      <div><dt>待审核引用</dt><dd>{status.pendingReferences}</dd></div>
    </dl>
  </section>;
}
