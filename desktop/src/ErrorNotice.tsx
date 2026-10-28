import { nativeText, isKnownMessage } from "./nativeText";
import { t } from "./i18n";
import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/controls/alert";
import IconButton from "./IconButton";
import "./history-diagnostics.css";

export default function ErrorNotice({ message, file, onClose, className }: { message: string; file?: string; onClose?: () => void; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  // Native Chinese messages already describe the operation and safe recovery.
  // Unknown technical messages do not justify guessing a cause or retrying writes.
  const display = nativeText(message);
  const readable = isKnownMessage(message) || /^[\u3400-\u9fff]/u.test(display);
  const summary = readable ? display.length > 300 ? `${display.slice(0, 300)}…` : display : t("errorNotice.checkThatTheAffectedFilesAreAccessibleTechnicalDetailsExplain");
  return <Alert variant="destructive" role="alert" className={className}>
    <TriangleAlert aria-hidden="true" /><AlertTitle>{t("errorNotice.operationIncomplete")}</AlertTitle>
    <AlertDescription className="error-notice-description">
      <div className="error-notice-content">
        <p>{summary}</p>
        {file && <p>{t("errorNotice.affectedFiles")}{file}</p>}
        <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>{t("errorNotice.technicalDetails")}</summary>
          {expanded && <pre>{message}</pre>}
        </details>
      </div>
      {onClose && <IconButton label={t("errorNotice.dismissError")} onClick={onClose}><X aria-hidden="true" /></IconButton>}
    </AlertDescription>
  </Alert>;
}
