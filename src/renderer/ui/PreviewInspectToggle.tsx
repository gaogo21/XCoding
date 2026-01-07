import { MousePointerClick } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "./i18n";

type Props = {
  previewId: string;
  isActive: boolean;
};

export default function PreviewInspectToggle({ previewId, isActive }: Props) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const disabled = !isActive;

  const className = useMemo(() => {
    return [
      "flex items-center gap-1 rounded px-2 py-1 text-[11px]",
      enabled
        ? "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]"
        : "bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]",
      disabled ? "cursor-not-allowed opacity-60" : ""
    ].join(" ");
  }, [disabled, enabled]);

  useEffect(() => {
    const off = window.xcoding.preview.onInspectState((e) => {
      if (String(e.previewId ?? "") !== previewId) return;
      setEnabled(Boolean(e.enabled));
    });
    return () => off();
  }, [previewId]);

  useEffect(() => {
    if (isActive) return;
    // When this tab is not active, treat Inspect as off in the UI.
    setEnabled(false);
  }, [isActive]);

  async function toggle() {
    if (disabled) return;
    const next = !enabled;
    setEnabled(next);
    const res = await window.xcoding.preview.inspectSet({ previewId, enabled: next });
    if (!res.ok) setEnabled(false);
  }

  return (
    <button className={className} onClick={() => void toggle()} type="button" title={t("inspect")}>
      <MousePointerClick className="h-3.5 w-3.5" />
      {t("inspect")}
    </button>
  );
}

