import { Search } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/controls/input-group";

export default function WorkspaceSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <InputGroup className="h-8! w-[clamp(180px,28vw,360px)]! min-w-0! shrink bg-white/80!">
    <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
    <InputGroupInput type="search" name="imageSearch" autoComplete="off" spellCheck={false} aria-label="搜索图片" placeholder="搜索图片路径或格式" value={value} onChange={(event) => onChange(event.target.value)} />
  </InputGroup>;
}
