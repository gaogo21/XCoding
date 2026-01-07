import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n";

type ElementSelectedPayload = {
  previewId: string;
  nodeId: number;
  computed: Record<string, string>;
  boxModel?: any;
  timestamp: number;
};

type ElementUpdatedPayload = {
  previewId: string;
  nodeId: number;
  computed: Record<string, string>;
  timestamp: number;
};

type Props = {
  previewId: string;
  isActive: boolean;
};

const EDITABLE_FIELDS = new Set([
  "width",
  "height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left"
]);

function normalizeValue(raw: string) {
  const v = raw.trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (["auto", "none", "initial", "inherit", "unset"].includes(lower)) return lower;
  if (/^-?\d+(\.\d+)?$/.test(v)) return `${v}px`;
  return v;
}

function SectionTitle({ title }: { title: string }) {
  return <div className="mb-2 text-xs font-semibold text-[var(--vscode-foreground)]">{title}</div>;
}

function FieldRow({
  label,
  value,
  editable,
  inputValue,
  onChange,
  onBlur
}: {
  label: string;
  value: string;
  editable: boolean;
  inputValue: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr] items-center gap-2">
      <div className="truncate text-[11px] text-[var(--vscode-descriptionForeground)]">{label}</div>
      {editable ? (
        <input
          className="min-w-0 rounded bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-[var(--vscode-input-foreground)] outline-none ring-1 ring-[var(--vscode-input-border)] focus:ring-[var(--vscode-focusBorder)]"
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          spellCheck={false}
        />
      ) : (
        <div className="truncate text-[11px] text-[var(--vscode-foreground)]">{value || "-"}</div>
      )}
    </div>
  );
}

export default function PreviewDesignPanel({ previewId, isActive }: Props) {
  const { t } = useI18n();
  const [inspectEnabled, setInspectEnabled] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [computed, setComputed] = useState<Record<string, string>>({});
  const [boxModel, setBoxModel] = useState<any>(null);

  const draftRef = useRef<Record<string, string>>({});
  const [, forceDraftTick] = useState(0);

  function setDraft(key: string, value: string) {
    draftRef.current = { ...draftRef.current, [key]: value };
    forceDraftTick((v) => v + 1);
  }

  function resetDraftFromComputed(nextComputed: Record<string, string>) {
    const next: Record<string, string> = {};
    for (const key of EDITABLE_FIELDS) next[key] = nextComputed[key] ?? "";
    draftRef.current = next;
    forceDraftTick((v) => v + 1);
  }

  useEffect(() => {
    const offInspect = window.xcoding.preview.onInspectState((e) => {
      if (String(e.previewId ?? "") !== previewId) return;
      const enabled = Boolean(e.enabled);
      setInspectEnabled(enabled);
      if (!enabled) {
        setSelectedNodeId(null);
        setComputed({});
        setBoxModel(null);
        draftRef.current = {};
        forceDraftTick((v) => v + 1);
      }
    });

    const offSelected = window.xcoding.preview.onElementSelected((e: ElementSelectedPayload) => {
      if (String(e.previewId ?? "") !== previewId) return;
      setSelectedNodeId(Number(e.nodeId ?? 0) || null);
      setComputed(e.computed ?? {});
      setBoxModel(e.boxModel ?? null);
      resetDraftFromComputed(e.computed ?? {});
    });

    const offUpdated = window.xcoding.preview.onElementUpdated((e: ElementUpdatedPayload) => {
      if (String(e.previewId ?? "") !== previewId) return;
      setComputed(e.computed ?? {});
      resetDraftFromComputed(e.computed ?? {});
    });

    return () => {
      offInspect();
      offSelected();
      offUpdated();
    };
  }, [previewId]);

  useEffect(() => {
    if (isActive) return;
    setInspectEnabled(false);
    setSelectedNodeId(null);
    setComputed({});
    setBoxModel(null);
    draftRef.current = {};
    forceDraftTick((v) => v + 1);
  }, [isActive]);

  const sections = useMemo(() => {
    return [
      { title: t("designPosition"), fields: ["position", "top", "right", "bottom", "left", "z-index"] },
      { title: t("designLayout"), fields: ["display", "flex-direction", "justify-content", "align-items", "gap"] },
      { title: t("designSize"), fields: ["width", "height", "min-width", "min-height", "max-width", "max-height"] },
      {
        title: t("designSpacing"),
        fields: [
          "margin-top",
          "margin-right",
          "margin-bottom",
          "margin-left",
          "padding-top",
          "padding-right",
          "padding-bottom",
          "padding-left"
        ]
      }
    ];
  }, [t]);

  async function commitField(property: string) {
    if (!selectedNodeId) return;
    const raw = draftRef.current[property] ?? "";
    const value = normalizeValue(raw);
    await window.xcoding.preview.styleSet({ previewId, nodeId: selectedNodeId, property, value });
  }

  const emptyText = !inspectEnabled ? t("designEmptyStateInspectOff") : t("designEmptyStateNoSelection");

  const contentW = boxModel?.width != null ? String(boxModel.width) : "";
  const contentH = boxModel?.height != null ? String(boxModel.height) : "";

  return (
    <div className="flex h-full w-[320px] flex-col overflow-hidden rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]">
      <div className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-3 py-2">
        <div className="text-xs font-semibold text-[var(--vscode-sideBarTitle-foreground)]">{t("designPanel")}</div>
        <div className="text-[10px] text-[var(--vscode-descriptionForeground)]">{selectedNodeId ? `nodeId ${selectedNodeId}` : ""}</div>
      </div>

      {!selectedNodeId ? (
        <div className="p-3 text-xs text-[var(--vscode-descriptionForeground)]">{emptyText}</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
          <div className="space-y-1">
            <SectionTitle title={t("designBoxModel")} />
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <div className="rounded bg-[var(--vscode-editor-background)] px-2 py-1 text-[11px] text-[var(--vscode-foreground)]">
                {t("designContentWidth")}: {contentW || "-"}
              </div>
              <div className="rounded bg-[var(--vscode-editor-background)] px-2 py-1 text-[11px] text-[var(--vscode-foreground)]">
                {t("designContentHeight")}: {contentH || "-"}
              </div>
            </div>
          </div>

          {sections.map((s) => (
            <div className="space-y-2" key={s.title}>
              <SectionTitle title={s.title} />
              <div className="space-y-1">
                {s.fields.map((field) => (
                  <FieldRow
                    key={field}
                    label={field}
                    value={computed[field] ?? ""}
                    editable={EDITABLE_FIELDS.has(field)}
                    inputValue={draftRef.current[field] ?? ""}
                    onChange={(next) => setDraft(field, next)}
                    onBlur={() => void commitField(field)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

