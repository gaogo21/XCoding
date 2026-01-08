import { MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type SelectionHintProps = {
  slot: number;
  onTrigger: () => void;
};

type SelectionInfo = {
  slot: number;
  hasSelection: boolean;
  position: { x: number; y: number } | null;
  content: string;
};

export default function SelectionHint({ slot, onTrigger }: SelectionHintProps) {
  const [info, setInfo] = useState<SelectionInfo | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const apply = (detail: any) => {
      if (!detail || typeof detail !== "object") return;
      if (Number(detail.slot) !== slot) return;
      const content = typeof detail.activeSelectionContent === "string" ? detail.activeSelectionContent : "";
      const hasSelection = content.trim().length > 0;
      const position = detail.selectionPosition ?? null;

      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (!hasSelection) {
        // Delay hide to avoid flicker
        hideTimerRef.current = window.setTimeout(() => {
          setVisible(false);
          setInfo(null);
        }, 100);
        return;
      }

      setInfo({ slot: Number(detail.slot), hasSelection, position, content });
      setVisible(true);
    };

    const onFileSelection = (e: Event) => apply((e as CustomEvent)?.detail);
    const onTerminalSelection = (e: Event) => apply((e as CustomEvent)?.detail);

    window.addEventListener("xcoding:fileSelectionChanged", onFileSelection as any);
    window.addEventListener("xcoding:terminalSelectionChanged", onTerminalSelection as any);
    return () => {
      window.removeEventListener("xcoding:fileSelectionChanged", onFileSelection as any);
      window.removeEventListener("xcoding:terminalSelectionChanged", onTerminalSelection as any);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [slot]);

  const handleClick = () => {
    if (!info) return;
    onTrigger();
    setVisible(false);
  };

  if (!visible || !info?.hasSelection) return null;

  // Position the hint near the selection
  const style: React.CSSProperties = info.position
    ? {
        position: "fixed",
        left: info.position.x,
        top: info.position.y + 8,
        zIndex: 9999
      }
    : {
        position: "fixed",
        right: 80,
        bottom: 80,
        zIndex: 9999
      };

  return (
    <div style={style}>
      <button
        className="flex items-center gap-1.5 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2.5 py-1.5 text-[12px] text-[var(--vscode-foreground)] shadow-lg hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
        onClick={handleClick}
        type="button"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        <span>Chat</span>
        <kbd className="ml-1 rounded bg-[var(--vscode-badge-background)] px-1 py-0.5 text-[10px] text-[var(--vscode-badge-foreground)]">
          ⌘L
        </kbd>
      </button>
    </div>
  );
}
