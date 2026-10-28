import { useState } from "react";
import { FileImage, FileWarning } from "lucide-react";

export default function AssetThumbnail({ source, problem = false }: { source?: string | null; problem?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span aria-hidden="true" className="pointer-events-none flex h-12 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-black/10 bg-white text-muted-foreground shadow-sm" title={source === null || source === failed ? "缩略图不可用" : undefined}>
    {source && source !== failed ? <img width={56} height={48} className="h-full w-full object-contain" src={source} alt="" draggable={false} onError={() => setFailed(source)} /> : problem ? <FileWarning className="size-4" /> : <FileImage className="size-4" />}
  </span>;
}
