import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import IconButton from "./IconButton";
import "./history-diagnostics.css";

export default function ErrorNotice({ message, file, onClose, className }: { message: string; file?: string; onClose?: () => void; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  // Native Chinese messages already describe the operation and safe recovery.
  // Unknown technical messages do not justify guessing a cause or retrying writes.
  const readable = /^[\u3400-\u9fff]/u.test(message);
  const summary = readable ? message.length > 300 ? `${message.slice(0, 300)}…` : message : "请检查相关文件是否仍可访问，并查看技术信息了解失败详情。";
  return <Alert variant="destructive" role="alert" className={className}>
    <TriangleAlert aria-hidden="true" /><AlertTitle>操作未完成</AlertTitle>
    <AlertDescription className="error-notice-description">
      <div className="error-notice-content">
        <p>{summary}</p>
        {file && <p>相关文件：{file}</p>}
        <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>技术信息</summary>
          {expanded && <pre>{message}</pre>}
        </details>
      </div>
      {onClose && <IconButton label="关闭错误提示" onClick={onClose}><X aria-hidden="true" /></IconButton>}
    </AlertDescription>
  </Alert>;
}
