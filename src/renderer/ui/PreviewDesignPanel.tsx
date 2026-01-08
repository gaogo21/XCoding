import { Copy, RotateCcw } from "lucide-react";
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

type ElementContextPayload = {
  previewId: string;
  nodeId: number;
  xcodingElementId: string;
  elementOpeningTag: string;
  cssSelector: string;
  domPath: string;
  stableSelector: string;
  attributes: Array<{ name: string; value: string }>;
  timestamp: number;
};

type CssRulesPayload = {
  previewId: string;
  nodeId: number;
  inlineStyle: Array<{ name: string; value: string }>;
  matchedRules: Array<{
    selector: string;
    sourceUrl?: string;
    styleSheetId?: string;
    declarations: Array<{ name: string; value: string }>;
  }>;
  inheritedRules: Array<{
    selector: string;
    sourceUrl?: string;
    declarations: Array<{ name: string; value: string }>;
  }>;
  cssVariables: Array<{ name: string; value: string }>;
  timestamp: number;
};

type Props = {
  previewId: string;
  isActive: boolean;
  onInjectAI?: (text: string) => void;
  isAiInputFocused?: boolean;
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

// Format ElementContext for AI injection (Phase 1)
function formatElementContextForAI(ctx: ElementContextPayload): string {
  const lines = [
    `ELEMENT: ${ctx.elementOpeningTag}`,
    `CSS_SELECTOR: ${ctx.cssSelector}`,
    `DOM_PATH: ${ctx.domPath}`,
    `XCODING_ID: ${ctx.xcodingElementId}`,
    `STABLE_SELECTOR: ${ctx.stableSelector}`
  ];
  return lines.join("\n");
}

// Format CSS Rules for AI injection (Phase 2)
function formatCssRulesForAI(css: CssRulesPayload): string {
  const lines: string[] = ["CSS RULES:"];

  // Inline styles
  if (css.inlineStyle.length > 0) {
    lines.push("INLINE STYLE:");
    for (const { name, value } of css.inlineStyle) {
      lines.push(`  ${name}: ${value};`);
    }
  }

  // Matched rules
  if (css.matchedRules.length > 0) {
    lines.push("MATCHED RULES:");
    for (const rule of css.matchedRules) {
      const source = rule.sourceUrl || rule.styleSheetId || "";
      lines.push(`  ${rule.selector}${source ? ` /* ${source} */` : ""} {`);
      for (const { name, value } of rule.declarations) {
        lines.push(`    ${name}: ${value};`);
      }
      lines.push("  }");
    }
  }

  // Inherited rules
  if (css.inheritedRules.length > 0) {
    lines.push("INHERITED:");
    for (const rule of css.inheritedRules) {
      lines.push(`  ${rule.selector} {`);
      for (const { name, value } of rule.declarations) {
        lines.push(`    ${name}: ${value};`);
      }
      lines.push("  }");
    }
  }

  // CSS Variables
  if (css.cssVariables.length > 0) {
    lines.push("CSS VARIABLES:");
    for (const { name, value } of css.cssVariables) {
      lines.push(`  ${name}: ${value};`);
    }
  }

  return lines.join("\n");
}

function FieldRow({
  label,
  value,
  editable,
  inputValue,
  onChange,
  onCommit,
  isOverridden
}: {
  label: string;
  value: string;
  editable: boolean;
  inputValue: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  isOverridden?: boolean;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
      onCommit();
    }
  };

  return (
    <div className="grid grid-cols-[1fr_1fr] items-center gap-2">
      <div className={`truncate text-[11px] ${isOverridden ? "text-[var(--vscode-charts-blue)] font-medium" : "text-[var(--vscode-descriptionForeground)]"}`}>
        {label}{isOverridden ? " *" : ""}
      </div>
      {editable ? (
        <input
          className={`min-w-0 rounded bg-[var(--vscode-input-background)] px-2 py-1 text-[11px] text-[var(--vscode-input-foreground)] outline-none ring-1 ${isOverridden ? "ring-[var(--vscode-charts-blue)]" : "ring-[var(--vscode-input-border)]"} focus:ring-[var(--vscode-focusBorder)]`}
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
      ) : (
        <div className="truncate text-[11px] text-[var(--vscode-foreground)]">{value || "-"}</div>
      )}
    </div>
  );
}

export default function PreviewDesignPanel({ previewId, isActive, onInjectAI, isAiInputFocused }: Props) {
  const { t } = useI18n();
  const [inspectEnabled, setInspectEnabled] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [computed, setComputed] = useState<Record<string, string>>({});
  const [boxModel, setBoxModel] = useState<any>(null);

  // Element Context state (Phase 1)
  const [elementContext, setElementContext] = useState<ElementContextPayload | null>(null);
  // CSS Rules state (Phase 2)
  const [cssRules, setCssRules] = useState<CssRulesPayload | null>(null);

  // Tab state for switching between Design/Element/CSS views
  const [activeTab, setActiveTab] = useState<"design" | "element" | "css">("element");

  // Use refs to get latest values in callbacks (avoid stale closure)
  const onInjectAIRef = useRef(onInjectAI);
  const isAiInputFocusedRef = useRef(isAiInputFocused);
  onInjectAIRef.current = onInjectAI;
  isAiInputFocusedRef.current = isAiInputFocused;
  const pendingInjectRef = useRef<{ nodeId: number; text: string; timer: number | null } | null>(null);

  const draftRef = useRef<Record<string, string>>({});
  const [, forceDraftTick] = useState(0);

  // M2: Track applied overrides (property -> value) for reset functionality
  const appliedOverridesRef = useRef<Record<string, string>>({});
  const [, forceOverridesTick] = useState(0);

  // M3: Track last apply status for showing hints
  const [applyStatus, setApplyStatus] = useState<{
    property: string;
    ok: boolean;
    message: string;
  } | null>(null);

  // Original computed values snapshot for comparison
  const originalComputedRef = useRef<Record<string, string>>({});

  function setDraft(key: string, value: string) {
    draftRef.current = { ...draftRef.current, [key]: value };
    forceDraftTick((v) => v + 1);
  }

  function resetDraftFromComputed(nextComputed: Record<string, string>, isNewSelection = false) {
    const next: Record<string, string> = {};
    for (const key of EDITABLE_FIELDS) {
      // If we have an applied override, use that; otherwise use computed
      const override = appliedOverridesRef.current[key];
      next[key] = override !== undefined ? override : (nextComputed[key] ?? "");
    }
    draftRef.current = next;
    forceDraftTick((v) => v + 1);

    // Save original computed snapshot on new selection
    if (isNewSelection) {
      const orig: Record<string, string> = {};
      for (const key of EDITABLE_FIELDS) orig[key] = nextComputed[key] ?? "";
      originalComputedRef.current = orig;
    }
  }

  // M2: Reset all overrides for current element
  async function resetAllOverrides() {
    if (!selectedNodeId) return;
    const overrides = { ...appliedOverridesRef.current };
    for (const property of Object.keys(overrides)) {
      // Write empty value to remove inline style
      await window.xcoding.preview.styleSet({ previewId, nodeId: selectedNodeId, property, value: "" });
    }
    appliedOverridesRef.current = {};
    forceOverridesTick((v) => v + 1);
    setApplyStatus(null);
  }

  // M3: Generate failure hint based on computed styles
  function generateFailureHint(property: string, computedStyles: Record<string, string>): string {
    const reasons: string[] = [];
    const display = computedStyles["display"] ?? "";

    if (property === "width" || property === "height") {
      // Check if inline element
      if (display === "inline") {
        reasons.push("该元素是行内元素（display:inline），width/height 可能不生效");
      }
      // Check flex/grid constraints
      if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid") {
        reasons.push("该元素是 flex/grid 容器，子元素可能受布局约束");
      }
      // Check min/max constraints
      const minW = computedStyles["min-width"];
      const maxW = computedStyles["max-width"];
      const minH = computedStyles["min-height"];
      const maxH = computedStyles["max-height"];
      if (property === "width" && (minW && minW !== "0px" && minW !== "auto")) {
        reasons.push(`min-width (${minW}) 可能限制了宽度`);
      }
      if (property === "width" && (maxW && maxW !== "none")) {
        reasons.push(`max-width (${maxW}) 可能限制了宽度`);
      }
      if (property === "height" && (minH && minH !== "0px" && minH !== "auto")) {
        reasons.push(`min-height (${minH}) 可能限制了高度`);
      }
      if (property === "height" && (maxH && maxH !== "none")) {
        reasons.push(`max-height (${maxH}) 可能限制了高度`);
      }
    }

    // Generic fallback
    if (reasons.length === 0) {
      reasons.push("可能受父容器布局约束或其他 CSS 规则影响");
    }

    return reasons.slice(0, 3).join("；");
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
      const newNodeId = Number(e.nodeId ?? 0) || null;
      // When selecting a new element, clear overrides for the new element
      if (newNodeId !== selectedNodeId) {
        appliedOverridesRef.current = {};
        forceOverridesTick((v) => v + 1);
        setApplyStatus(null);
      }
      setSelectedNodeId(newNodeId);
      setComputed(e.computed ?? {});
      setBoxModel(e.boxModel ?? null);
      resetDraftFromComputed(e.computed ?? {}, true);
    });

    const offUpdated = window.xcoding.preview.onElementUpdated((e: ElementUpdatedPayload) => {
      if (String(e.previewId ?? "") !== previewId) return;
      setComputed(e.computed ?? {});
      resetDraftFromComputed(e.computed ?? {}, false);
    });

    // Phase 1: Element Context
    const offContext = window.xcoding.preview.onElementContext((e: ElementContextPayload) => {
      console.log("[Design] onElementContext raw event, e.previewId:", e.previewId, "expected previewId:", previewId);
      if (String(e.previewId ?? "") !== previewId) return;
      console.log("[Design] onElementContext matched!");
      setElementContext(e);

      // Auto-inject to AI if not focused (per requirement)
      // Use refs to get latest values and avoid stale closure
      const injectFn = onInjectAIRef.current;
      // Note: clicks inside Electron `BrowserView` don't always trigger a DOM blur for the chat input
      // because it's a different webContents. If this UI webContents isn't focused, treat AI input as not focused.
      const isFocused = Boolean(isAiInputFocusedRef.current) && document.hasFocus();
      console.log("[Design] onElementContext received, injectFn:", !!injectFn, "isFocused:", isFocused);
      if (!injectFn || isFocused) return;

      const aiBlock = formatElementContextForAI(e);
      console.log("[Design] Injecting to AI:", aiBlock.substring(0, 100) + "...");

      const pending = pendingInjectRef.current;
      if (pending?.timer) window.clearTimeout(pending.timer);
      pendingInjectRef.current = {
        nodeId: Number(e.nodeId ?? 0),
        text: aiBlock,
        timer: window.setTimeout(() => {
          const cur = pendingInjectRef.current;
          if (!cur || cur.nodeId !== Number(e.nodeId ?? 0)) return;
          pendingInjectRef.current = null;
          injectFn(aiBlock);
        }, 80)
      };
    });

    // Phase 2: CSS Rules
    const offCss = window.xcoding.preview.onElementCss((e: CssRulesPayload) => {
      if (String(e.previewId ?? "") !== previewId) return;
      setCssRules(e);

      // Auto-inject CSS rules to AI if not focused (per requirement)
      // Use refs to get latest values and avoid stale closure
      const injectFn = onInjectAIRef.current;
      const isFocused = Boolean(isAiInputFocusedRef.current) && document.hasFocus();
      console.log("[Design] onElementCss received, injectFn:", !!injectFn, "isFocused:", isFocused);
      if (!injectFn || isFocused) return;

      const cssBlock = formatCssRulesForAI(e);
      console.log("[Design] Injecting CSS to AI:", cssBlock.substring(0, 100) + "...");

      const pending = pendingInjectRef.current;
      const nodeId = Number(e.nodeId ?? 0);
      if (pending && pending.nodeId === nodeId) {
        if (pending.timer) window.clearTimeout(pending.timer);
        pendingInjectRef.current = null;
        injectFn(`${pending.text}\n\n${cssBlock}`);
        return;
      }

      // Fallback: CSS arrived without a matching ElementContext (or too late).
      injectFn(cssBlock);
    });

    return () => {
      offInspect();
      offSelected();
      offUpdated();
      offContext();
      offCss();
    };
  }, [previewId]);

  useEffect(() => {
    if (isActive) return;
    setInspectEnabled(false);
    setSelectedNodeId(null);
    setComputed({});
    setBoxModel(null);
    setElementContext(null);
    setCssRules(null);
    draftRef.current = {};
    forceDraftTick((v) => v + 1);
  }, [isActive]);

  // Also reset Element Context and CSS Rules when inspect is disabled
  useEffect(() => {
    if (!inspectEnabled) {
      setElementContext(null);
      setCssRules(null);
    }
  }, [inspectEnabled]);

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
    const originalValue = originalComputedRef.current[property] ?? "";

    // Skip if value hasn't changed from original and no override exists
    if (value === originalValue && !appliedOverridesRef.current[property]) {
      return;
    }

    // Get boxModel before applying
    const beforeBoxModel = boxModel ? { width: boxModel.width, height: boxModel.height } : null;

    const result = await window.xcoding.preview.styleSet({ previewId, nodeId: selectedNodeId, property, value });

    if (!result.ok) {
      setApplyStatus({
        property,
        ok: false,
        message: "写入失败：" + (result.reason || "未知错误")
      });
      return;
    }

    // M2: Track this override
    if (value) {
      appliedOverridesRef.current = { ...appliedOverridesRef.current, [property]: value };
    } else {
      // If value is empty, remove from overrides
      const next = { ...appliedOverridesRef.current };
      delete next[property];
      appliedOverridesRef.current = next;
    }
    forceOverridesTick((v) => v + 1);

    // M3: Check if change actually took effect (for width/height)
    if (property === "width" || property === "height") {
      // Wait a bit for the updated event to arrive with new boxModel
      setTimeout(() => {
        const afterBoxModel = boxModel;
        const afterComputed = computed;

        // Compare boxModel dimensions if available
        if (beforeBoxModel && afterBoxModel) {
          const dimension = property === "width" ? "width" : "height";
          const before = beforeBoxModel[dimension];
          const after = afterBoxModel[dimension];

          // If dimension didn't change significantly, show hint
          if (Math.abs(before - after) < 1) {
            const hint = generateFailureHint(property, afterComputed);
            setApplyStatus({
              property,
              ok: false,
              message: `未生效：${hint}`
            });
            return;
          }
        }

        setApplyStatus({
          property,
          ok: true,
          message: "已生效"
        });

        // Clear success message after 2 seconds
        setTimeout(() => {
          setApplyStatus((prev) => (prev?.property === property && prev?.ok ? null : prev));
        }, 2000);
      }, 100);
    } else {
      // For non-size properties, just show success
      setApplyStatus({
        property,
        ok: true,
        message: "已生效"
      });
      setTimeout(() => {
        setApplyStatus((prev) => (prev?.property === property && prev?.ok ? null : prev));
      }, 2000);
    }
  }

  const emptyText = !inspectEnabled ? t("designEmptyStateInspectOff") : t("designEmptyStateNoSelection");

  const contentW = boxModel?.width != null ? String(boxModel.width) : "";
  const contentH = boxModel?.height != null ? String(boxModel.height) : "";

  // Copy to clipboard helper
  const copyToClipboard = (text: string) => {
    void window.xcoding.os.copyText(text);
  };

  // Render Element Context Panel (Phase 1)
  const renderElementContextPanel = () => {
    if (!elementContext) {
      return <div className="p-3 text-xs text-[var(--vscode-descriptionForeground)]">{emptyText}</div>;
    }

    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {/* ELEMENT Section */}
        <div className="space-y-1">
          <SectionTitle title="ELEMENT" />
          <div className="group relative rounded bg-[var(--vscode-editor-background)] p-2">
            <pre className="overflow-x-auto text-[11px] text-[var(--vscode-foreground)] whitespace-pre-wrap break-all">
              {elementContext.elementOpeningTag}
            </pre>
            <button
              className="absolute right-1 top-1 rounded p-1 text-[var(--vscode-descriptionForeground)] opacity-0 hover:bg-[var(--vscode-toolbar-hoverBackground)] group-hover:opacity-100"
              onClick={() => copyToClipboard(elementContext.elementOpeningTag)}
              title="Copy"
              type="button"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* PATH Section */}
        <div className="space-y-1">
          <SectionTitle title="PATH" />
          <div className="space-y-2">
            <div className="group relative">
              <div className="text-[10px] text-[var(--vscode-descriptionForeground)]">CSS_SELECTOR</div>
              <div className="rounded bg-[var(--vscode-editor-background)] p-2 text-[11px] text-[var(--vscode-foreground)] break-all">
                {elementContext.cssSelector}
              </div>
              <button
                className="absolute right-1 top-4 rounded p-1 text-[var(--vscode-descriptionForeground)] opacity-0 hover:bg-[var(--vscode-toolbar-hoverBackground)] group-hover:opacity-100"
                onClick={() => copyToClipboard(elementContext.cssSelector)}
                title="Copy"
                type="button"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <div className="group relative">
              <div className="text-[10px] text-[var(--vscode-descriptionForeground)]">DOM_PATH</div>
              <div className="rounded bg-[var(--vscode-editor-background)] p-2 text-[11px] text-[var(--vscode-foreground)] break-all">
                {elementContext.domPath}
              </div>
              <button
                className="absolute right-1 top-4 rounded p-1 text-[var(--vscode-descriptionForeground)] opacity-0 hover:bg-[var(--vscode-toolbar-hoverBackground)] group-hover:opacity-100"
                onClick={() => copyToClipboard(elementContext.domPath)}
                title="Copy"
                type="button"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <div className="group relative">
              <div className="text-[10px] text-[var(--vscode-descriptionForeground)]">STABLE_SELECTOR</div>
              <div className="rounded bg-[var(--vscode-editor-background)] p-2 text-[11px] font-mono text-[var(--vscode-foreground)] break-all">
                {elementContext.stableSelector}
              </div>
              <button
                className="absolute right-1 top-4 rounded p-1 text-[var(--vscode-descriptionForeground)] opacity-0 hover:bg-[var(--vscode-toolbar-hoverBackground)] group-hover:opacity-100"
                onClick={() => copyToClipboard(elementContext.stableSelector)}
                title="Copy"
                type="button"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        {/* ATTRIBUTES Section */}
        <div className="space-y-1">
          <SectionTitle title={`ATTRIBUTES (${elementContext.attributes.length})`} />
          <div className="max-h-40 overflow-auto rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]">
            {elementContext.attributes.length === 0 ? (
              <div className="p-2 text-[11px] text-[var(--vscode-descriptionForeground)]">No attributes</div>
            ) : (
              <table className="w-full text-[11px]">
                <tbody>
                  {elementContext.attributes.map((attr, idx) => (
                    <tr key={idx} className="border-b border-[var(--vscode-panel-border)] last:border-b-0">
                      <td className="px-2 py-1 font-medium text-[var(--vscode-foreground)]">{attr.name}</td>
                      <td className="px-2 py-1 text-[var(--vscode-descriptionForeground)] break-all">{attr.value || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render CSS Panel (Phase 2)
  const renderCssPanel = () => {
    if (!cssRules) {
      return <div className="p-3 text-xs text-[var(--vscode-descriptionForeground)]">{emptyText}</div>;
    }

    return (
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {/* INLINE STYLE Section */}
        {cssRules.inlineStyle.length > 0 && (
          <div className="space-y-1">
            <SectionTitle title="INLINE STYLE" />
            <div className="rounded bg-[var(--vscode-editor-background)] p-2">
              {cssRules.inlineStyle.map((decl, idx) => (
                <div key={idx} className="text-[11px]">
                  <span className="text-[var(--vscode-symbolIcon-propertyForeground)]">{decl.name}</span>
                  <span className="text-[var(--vscode-foreground)]">: </span>
                  <span className="text-[var(--vscode-symbolIcon-stringForeground)]">{decl.value}</span>
                  <span className="text-[var(--vscode-foreground)]">;</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MATCHED RULES Section */}
        {cssRules.matchedRules.length > 0 && (
          <div className="space-y-1">
            <SectionTitle title={`MATCHED RULES (${cssRules.matchedRules.length})`} />
            <div className="space-y-2">
              {cssRules.matchedRules.map((rule, idx) => (
                <div key={idx} className="rounded bg-[var(--vscode-editor-background)] p-2">
                  <div className="mb-1 text-[11px] font-medium text-[var(--vscode-symbolIcon-classForeground)]">
                    {rule.selector}
                    {(rule.sourceUrl || rule.styleSheetId) && (
                      <span className="ml-2 font-normal text-[var(--vscode-descriptionForeground)]">
                        /* {rule.sourceUrl || rule.styleSheetId} */
                      </span>
                    )}
                  </div>
                  {rule.declarations.map((decl, dIdx) => (
                    <div key={dIdx} className="pl-2 text-[11px]">
                      <span className="text-[var(--vscode-symbolIcon-propertyForeground)]">{decl.name}</span>
                      <span className="text-[var(--vscode-foreground)]">: </span>
                      <span className="text-[var(--vscode-symbolIcon-stringForeground)]">{decl.value}</span>
                      <span className="text-[var(--vscode-foreground)]">;</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* INHERITED Section */}
        {cssRules.inheritedRules.length > 0 && (
          <div className="space-y-1">
            <SectionTitle title="INHERITED" />
            <div className="space-y-2">
              {cssRules.inheritedRules.map((rule, idx) => (
                <div key={idx} className="rounded bg-[var(--vscode-editor-background)] p-2 opacity-75">
                  <div className="mb-1 text-[11px] font-medium text-[var(--vscode-symbolIcon-classForeground)]">
                    {rule.selector}
                  </div>
                  {rule.declarations.map((decl, dIdx) => (
                    <div key={dIdx} className="pl-2 text-[11px]">
                      <span className="text-[var(--vscode-symbolIcon-propertyForeground)]">{decl.name}</span>
                      <span className="text-[var(--vscode-foreground)]">: </span>
                      <span className="text-[var(--vscode-symbolIcon-stringForeground)]">{decl.value}</span>
                      <span className="text-[var(--vscode-foreground)]">;</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CSS VARIABLES Section */}
        {cssRules.cssVariables.length > 0 && (
          <div className="space-y-1">
            <SectionTitle title="CSS VARIABLES" />
            <div className="rounded bg-[var(--vscode-editor-background)] p-2">
              {cssRules.cssVariables.map((v, idx) => (
                <div key={idx} className="text-[11px]">
                  <span className="text-[var(--vscode-symbolIcon-variableForeground)]">{v.name}</span>
                  <span className="text-[var(--vscode-foreground)]">: </span>
                  <span className="text-[var(--vscode-symbolIcon-stringForeground)]">{v.value}</span>
                  <span className="text-[var(--vscode-foreground)]">;</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state if no CSS data */}
        {cssRules.inlineStyle.length === 0 &&
          cssRules.matchedRules.length === 0 &&
          cssRules.inheritedRules.length === 0 &&
          cssRules.cssVariables.length === 0 && (
            <div className="p-3 text-xs text-[var(--vscode-descriptionForeground)]">No CSS rules found</div>
          )}
      </div>
    );
  };

  // Render Design Panel (original)
  const renderDesignPanel = () => {
    if (!selectedNodeId) {
      return <div className="p-3 text-xs text-[var(--vscode-descriptionForeground)]">{emptyText}</div>;
    }

    return (
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

        {/* M3: Status hint */}
        {applyStatus && (
          <div
            className={`rounded p-2 text-[11px] ${
              applyStatus.ok
                ? "bg-[var(--vscode-inputValidation-infoBackground)] text-[var(--vscode-inputValidation-infoForeground)]"
                : "bg-[var(--vscode-inputValidation-warningBackground)] text-[var(--vscode-inputValidation-warningForeground)]"
            }`}
          >
            <span className="font-medium">{applyStatus.property}:</span> {applyStatus.message}
          </div>
        )}

        {/* M2: Reset button */}
        {Object.keys(appliedOverridesRef.current).length > 0 && (
          <div className="flex items-center justify-between rounded bg-[var(--vscode-editor-background)] p-2">
            <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">
              已修改 {Object.keys(appliedOverridesRef.current).length} 个属性
            </span>
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
              onClick={() => void resetAllOverrides()}
              type="button"
            >
              <RotateCcw className="h-3 w-3" />
              重置
            </button>
          </div>
        )}

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
                  onCommit={() => void commitField(field)}
                  isOverridden={!!appliedOverridesRef.current[field]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const tabClass = (tab: "design" | "element" | "css") =>
    [
      "rounded px-2 py-1 text-[11px]",
      activeTab === tab
        ? "bg-[var(--vscode-sideBarSectionHeader-background)] text-[var(--vscode-foreground)]"
        : "text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
    ].join(" ");

  return (
    <div className="flex h-full w-[320px] flex-col overflow-hidden rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]">
      {/* Header with tabs */}
      <div className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-2 py-2">
        <div className="flex items-center gap-1">
          <button className={tabClass("element")} onClick={() => setActiveTab("element")} type="button">
            Element
          </button>
          <button className={tabClass("css")} onClick={() => setActiveTab("css")} type="button">
            CSS
          </button>
          <button className={tabClass("design")} onClick={() => setActiveTab("design")} type="button">
            Design
          </button>
        </div>
        <div className="text-[10px] text-[var(--vscode-descriptionForeground)]">
          {selectedNodeId ? `#${selectedNodeId}` : ""}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "element" && renderElementContextPanel()}
      {activeTab === "css" && renderCssPanel()}
      {activeTab === "design" && renderDesignPanel()}
    </div>
  );
}
