import { BrowserView } from "electron";
import { broadcast, mainWindow } from "../app/windowManager";

// ========== ElementContext Types & Constants (Phase 1) ==========
export type ElementContext = {
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

export type CssRulesContext = {
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

// Limits from requirements
const LIMITS = {
  elementOpeningTagMaxBytes: 2048,
  pathTextMaxBytes: 1024,
  attributesMaxItems: 50,
  cssMaxTotalChars: 12288,
  cssMaxRules: 30,
  cssMaxDeclarationsPerRule: 20,
  truncateSuffix: "…(truncated)"
};

// CSS property whitelist for Phase 2
const CSS_PROPERTY_WHITELIST = new Set([
  "display", "position", "top", "right", "bottom", "left", "z-index",
  "flex", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "gap",
  "grid", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "font", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
  "color", "background", "background-color",
  "border", "border-width", "border-style", "border-color", "border-radius",
  "box-shadow", "opacity", "transform", "overflow", "overflow-x", "overflow-y"
]);

// Generate random short ID for data-xcoding-element-id
function generateXcodingElementId(): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `xcoding-el-${rand}`;
}

// Truncate string with suffix if exceeds max bytes
function truncateWithSuffix(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return str;
  const suffix = LIMITS.truncateSuffix;
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const targetBytes = maxBytes - suffixBytes;
  let result = str;
  while (Buffer.byteLength(result, "utf8") > targetBytes && result.length > 0) {
    result = result.slice(0, -1);
  }
  return result + suffix;
}

// Extract opening tag from outerHTML (up to first >)
function extractOpeningTag(outerHTML: string): string {
  const match = outerHTML.match(/^<[^>]*>/s);
  if (match) return match[0];
  return outerHTML.split(">")[0] + ">";
}

type PreviewEntry = {
  id: string;
  view: BrowserView;
  url: string;
  inspectInputListener?: ((event: Electron.Event, input: Electron.Input) => void) | null;
  inspect: {
    enabled: boolean;
    selectedNodeId: number | null;
    mode: "none" | "overlay" | "dom" | "injected";
    capabilities: {
      dom: boolean;
      css: boolean;
      overlay: boolean;
      overlayInspect: boolean;
      domInspect: boolean;
      binding: boolean;
    };
    // Track injected xcoding-element-ids for cleanup on Inspect close
    injectedElementIds: Map<number, string>;
  };
};

const previews = new Map<string, PreviewEntry>();
let activePreviewId: string | null = null;

const INSPECT_BINDING_NAME = "__xcodingInspectSend";
const INSPECT_CURSOR_STYLE_ID = "__xcodingInspectCursorStyle";

function debugLog(previewId: string, message: string) {
  const text = `[preview:${previewId}] ${message}`;
  try {
    // eslint-disable-next-line no-console
    console.log(text);
  } catch {
    // ignore
  }
  try {
    broadcast("preview:console", { previewId, level: "debug", text, timestamp: Date.now() });
  } catch {
    // ignore
  }
}

const INSPECT_SELECTED_HIGHLIGHT_CONFIG = {
  // Cursor/Chrome DevTools-like legacy tooltip (blue pill), not the Material card.
  showInfo: true,
  displayAsMaterial: false,
  showAccessibilityInfo: false,
  borderColor: { r: 26, g: 115, b: 232, a: 1 },
  contentColor: { r: 26, g: 115, b: 232, a: 0.08 },
  paddingColor: { r: 0, g: 0, b: 0, a: 0 },
  marginColor: { r: 0, g: 0, b: 0, a: 0 }
};

const INSPECT_SELECTED_HIGHLIGHT_CONFIG_NO_A11Y = {
  showInfo: true,
  displayAsMaterial: false,
  borderColor: { r: 26, g: 115, b: 232, a: 1 },
  contentColor: { r: 26, g: 115, b: 232, a: 0.08 },
  paddingColor: { r: 0, g: 0, b: 0, a: 0 },
  marginColor: { r: 0, g: 0, b: 0, a: 0 }
};

// Use Overlay.setInspectMode for picking (DevTools-like hover highlight). In overlay/dom modes, we rely on InspectMode
// to draw the highlight (Cursor-like), and only fall back to Overlay.highlightNode in injected mode.
const INSPECT_PICK_HIGHLIGHT_CONFIG = {
  // Cursor-like inspect hover highlight (same look as selection).
  showInfo: true,
  displayAsMaterial: false,
  showAccessibilityInfo: false,
  borderColor: { r: 26, g: 115, b: 232, a: 1 },
  contentColor: { r: 26, g: 115, b: 232, a: 0.08 },
  paddingColor: { r: 0, g: 0, b: 0, a: 0 },
  marginColor: { r: 0, g: 0, b: 0, a: 0 }
};

const INSPECT_PICK_HIGHLIGHT_CONFIG_NO_A11Y = {
  showInfo: true,
  displayAsMaterial: false,
  borderColor: { r: 26, g: 115, b: 232, a: 1 },
  contentColor: { r: 26, g: 115, b: 232, a: 0.08 },
  paddingColor: { r: 0, g: 0, b: 0, a: 0 },
  marginColor: { r: 0, g: 0, b: 0, a: 0 }
};

async function sendCommandSafe(entry: PreviewEntry, method: string, params?: Record<string, unknown>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await entry.view.webContents.debugger.sendCommand(method, params);
    return { ok: true as const, result };
  } catch (error) {
    return { ok: false as const, error };
  }
}

async function highlightSelectedNode(entry: PreviewEntry, nodeId: number) {
  const enabled = await sendCommandSafe(entry, "Overlay.enable");
  if (!enabled.ok) return;

  await sendCommandSafe(entry, "Overlay.hideHighlight");
  let resp = await sendCommandSafe(entry, "Overlay.highlightNode", {
    nodeId,
    highlightConfig: INSPECT_SELECTED_HIGHLIGHT_CONFIG
  });
  if (!resp.ok) {
    // Some Chromium/Electron versions don't support `showAccessibilityInfo`.
    resp = await sendCommandSafe(entry, "Overlay.highlightNode", {
      nodeId,
      highlightConfig: INSPECT_SELECTED_HIGHLIGHT_CONFIG_NO_A11Y
    });
  }
  if (!resp.ok) {
    const msg = String((resp.error as any)?.message ?? "");
    debugLog(entry.id, `Overlay.highlightNode failed: ${msg || "unknown"}`);
  }
}

function injectedInspectCursorScript(enabled: boolean) {
  if (!enabled) {
    return `
(function(){
  try {
    var style = document.getElementById(${JSON.stringify(INSPECT_CURSOR_STYLE_ID)});
    if (style && style.parentNode) style.parentNode.removeChild(style);
  } catch {}
})();`;
  }

  return `
(function(){
  try {
    var id = ${JSON.stringify(INSPECT_CURSOR_STYLE_ID)};
    var style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      style.textContent =
        "html, body, html * { cursor: crosshair !important; }\\n";
      (document.head || document.documentElement).appendChild(style);
    }
  } catch {}
})();`;
}

function injectedInspectScript(enabled: boolean) {
  if (!enabled) {
    return `
(function(){
  try {
    window.__XCODING_INSPECT_ENABLED = false;
    // Back-compat cleanup for older injected versions that modified DOM outlines.
    if (typeof window.__XCODING_INSPECT_CLEAR === "function") window.__XCODING_INSPECT_CLEAR();
    if (typeof window.__XCODING_INSPECT_UNINSTALL === "function") window.__XCODING_INSPECT_UNINSTALL();
  } catch {}
})();`;
  }

  return `
(function(){
  var VERSION = 2;
  function __xcodingSend(msg) {
    try {
      if (typeof window["${INSPECT_BINDING_NAME}"] === "function") {
        window["${INSPECT_BINDING_NAME}"](JSON.stringify(msg));
        return;
      }
    } catch {}
    try {
      // Fallback when Runtime bindings aren't available for this document/context.
      console.log("__XCODING_INSPECT__", JSON.stringify(msg));
    } catch {}
  }
  // If an older injected script is already installed, upgrade in-place.
  if (window.__XCODING_INSPECT_INSTALLED && window.__XCODING_INSPECT_VERSION !== VERSION) {
    try {
      if (typeof window.__XCODING_INSPECT_UNINSTALL === "function") window.__XCODING_INSPECT_UNINSTALL();
      if (typeof window.__XCODING_INSPECT_CLEAR === "function") window.__XCODING_INSPECT_CLEAR();
    } catch {}
    try {
      window.__XCODING_INSPECT_INSTALLED = false;
    } catch {}
  }

  if (window.__XCODING_INSPECT_INSTALLED) {
    window.__XCODING_INSPECT_ENABLED = true;
    __xcodingSend({ type: "enabled" });
    return;
  }

  window.__XCODING_INSPECT_VERSION = VERSION;
  window.__XCODING_INSPECT_INSTALLED = true;
  window.__XCODING_INSPECT_ENABLED = true;

  function onPointerDown(e){
    if (!window.__XCODING_INSPECT_ENABLED) return;
    try {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    } catch {}
    __xcodingSend({ type: "pointerdown", x: e.clientX, y: e.clientY });
  }

  // Capture phase ensures we block page interaction reliably.
  document.addEventListener("pointerdown", onPointerDown, true);

  window.__XCODING_INSPECT_UNINSTALL = function(){
    try { document.removeEventListener("pointerdown", onPointerDown, true); } catch {}
    try { window.__XCODING_INSPECT_ENABLED = false; } catch {}
  };

  __xcodingSend({ type: "installed" });
})();`;
}

function interceptClickScript(enabled: boolean) {
  if (!enabled) {
    return `
(function(){
  try { window.__XCODING_INTERCEPT_ENABLED = false; } catch {}
})();`;
  }
  return `
(function(){
  if (window.__XCODING_INTERCEPT_INSTALLED) {
    window.__XCODING_INTERCEPT_ENABLED = true;
    return;
  }
  window.__XCODING_INTERCEPT_INSTALLED = true;
  window.__XCODING_INTERCEPT_ENABLED = true;
  document.addEventListener("click", function(e){
    if (!window.__XCODING_INTERCEPT_ENABLED) return;
    try {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    } catch {}
  }, true);
})();`;
}

async function fetchNodeData(entry: PreviewEntry, nodeId: number) {
  const computedResp = await sendCommandSafe(entry, "CSS.getComputedStyleForNode", { nodeId });
  if (!computedResp.ok) debugLog(entry.id, `CSS.getComputedStyleForNode failed nodeId=${nodeId}`);
  const computedArray = computedResp.ok && computedResp.result && (computedResp.result as any).computedStyle;
  const computed: Record<string, string> = {};
  if (Array.isArray(computedArray)) {
    for (const item of computedArray) {
      const name = String(item?.name ?? "");
      if (!name) continue;
      computed[name] = String(item?.value ?? "");
    }
  }

  const boxResp = await sendCommandSafe(entry, "DOM.getBoxModel", { nodeId });
  if (!boxResp.ok) debugLog(entry.id, `DOM.getBoxModel failed nodeId=${nodeId}`);
  const boxModel = boxResp.ok ? (boxResp.result as any)?.model ?? null : null;

  return { computed, boxModel };
}

// ========== Phase 1: Build ElementContext ==========
async function buildElementContext(entry: PreviewEntry, nodeId: number): Promise<ElementContext | null> {
  const previewId = entry.id;
  const timestamp = Date.now();

  // 1. Get or generate xcodingElementId
  let xcodingElementId = entry.inspect.injectedElementIds.get(nodeId);
  if (!xcodingElementId) {
    xcodingElementId = generateXcodingElementId();
    // Inject data-xcoding-element-id attribute to the element
    const injectResp = await sendCommandSafe(entry, "DOM.setAttributeValue", {
      nodeId,
      name: "data-xcoding-element-id",
      value: xcodingElementId
    });
    if (injectResp.ok) {
      entry.inspect.injectedElementIds.set(nodeId, xcodingElementId);
      debugLog(previewId, `Injected data-xcoding-element-id="${xcodingElementId}" to nodeId=${nodeId}`);
    } else {
      debugLog(previewId, `Failed to inject data-xcoding-element-id to nodeId=${nodeId}`);
    }
  }

  // 2. Get outerHTML for opening tag
  const outerResp = await sendCommandSafe(entry, "DOM.getOuterHTML", { nodeId });
  let elementOpeningTag = "";
  if (outerResp.ok) {
    const outerHTML = String((outerResp.result as any)?.outerHTML ?? "");
    elementOpeningTag = extractOpeningTag(outerHTML);
    elementOpeningTag = truncateWithSuffix(elementOpeningTag, LIMITS.elementOpeningTagMaxBytes);
  }

  // 3. Get attributes
  const attrsResp = await sendCommandSafe(entry, "DOM.getAttributes", { nodeId });
  const rawAttrs: string[] = attrsResp.ok ? ((attrsResp.result as any)?.attributes ?? []) : [];
  const attributes: Array<{ name: string; value: string }> = [];
  for (let i = 0; i < rawAttrs.length && attributes.length < LIMITS.attributesMaxItems; i += 2) {
    const name = String(rawAttrs[i] ?? "");
    const value = String(rawAttrs[i + 1] ?? "");
    if (name) attributes.push({ name, value });
  }
  if (rawAttrs.length / 2 > LIMITS.attributesMaxItems) {
    attributes.push({ name: LIMITS.truncateSuffix, value: "" });
  }

  // 4. Build CSS_SELECTOR and DOM_PATH by traversing parent chain
  let cssSelector = "";
  let domPath = "";
  const pathParts: string[] = [];

  // Get node description
  const descResp = await sendCommandSafe(entry, "DOM.describeNode", { nodeId, depth: 0 });
  if (descResp.ok) {
    const node = (descResp.result as any)?.node;
    if (node) {
      const buildSelectorPart = (n: any): string => {
        const tag = String(n?.localName ?? n?.nodeName ?? "").toLowerCase();
        const id = String(n?.attributes?.find?.((a: string, i: number, arr: string[]) => arr[i - 1] === "id") ?? "");
        const classAttr = String(n?.attributes?.find?.((a: string, i: number, arr: string[]) => arr[i - 1] === "class") ?? "");
        
        // Parse attributes array (alternating name/value)
        const attrs = n?.attributes ?? [];
        let nodeId = "";
        let nodeClass = "";
        for (let i = 0; i < attrs.length; i += 2) {
          if (attrs[i] === "id") nodeId = attrs[i + 1] || "";
          if (attrs[i] === "class") nodeClass = attrs[i + 1] || "";
        }

        let part = tag;
        if (nodeId) part += `#${nodeId}`;
        if (nodeClass) {
          const classes = nodeClass.split(/\s+/).filter(Boolean).slice(0, 3);
          part += classes.map((c: string) => `.${c}`).join("");
        }
        return part;
      };

      // Build selector for current node
      const currentPart = buildSelectorPart(node);
      pathParts.unshift(currentPart);

      // Traverse parent chain using DOM.requestNode on parent
      let currentNodeId = nodeId;
      let depth = 0;
      const maxDepth = 10;

      while (depth < maxDepth) {
        const parentResp = await sendCommandSafe(entry, "DOM.describeNode", { nodeId: currentNodeId, depth: 0 });
        if (!parentResp.ok) break;
        const parentNodeId = (parentResp.result as any)?.node?.parentId;
        if (!parentNodeId) break;

        const parentDescResp = await sendCommandSafe(entry, "DOM.describeNode", { nodeId: parentNodeId, depth: 0 });
        if (!parentDescResp.ok) break;
        const parentNode = (parentDescResp.result as any)?.node;
        if (!parentNode || parentNode.nodeName === "#document") break;

        const parentPart = buildSelectorPart(parentNode);
        if (parentPart && parentPart !== "html" && parentPart !== "body") {
          pathParts.unshift(parentPart);
        }
        currentNodeId = parentNodeId;
        depth++;
      }

      cssSelector = currentPart;
      domPath = pathParts.join(" > ");
    }
  }

  // Truncate paths if needed
  cssSelector = truncateWithSuffix(cssSelector, LIMITS.pathTextMaxBytes);
  domPath = truncateWithSuffix(domPath, LIMITS.pathTextMaxBytes);

  // 5. Build stable selector
  const stableSelector = `[data-xcoding-element-id="${xcodingElementId}"]`;

  return {
    previewId,
    nodeId,
    xcodingElementId,
    elementOpeningTag,
    cssSelector,
    domPath,
    stableSelector,
    attributes,
    timestamp
  };
}

// ========== Phase 2: Build CSS Rules Context ==========
async function buildCssRulesContext(entry: PreviewEntry, nodeId: number): Promise<CssRulesContext | null> {
  const previewId = entry.id;
  const timestamp = Date.now();

  const inlineStyle: Array<{ name: string; value: string }> = [];
  const matchedRules: CssRulesContext["matchedRules"] = [];
  const inheritedRules: CssRulesContext["inheritedRules"] = [];
  const cssVariables: Array<{ name: string; value: string }> = [];

  // 1. Get inline styles
  const inlineResp = await sendCommandSafe(entry, "CSS.getInlineStylesForNode", { nodeId });
  if (inlineResp.ok) {
    const inlineStyleObj = (inlineResp.result as any)?.inlineStyle;
    const cssProperties = inlineStyleObj?.cssProperties ?? [];
    let count = 0;
    for (const prop of cssProperties) {
      const name = String(prop?.name ?? "");
      const value = String(prop?.value ?? "");
      if (name && CSS_PROPERTY_WHITELIST.has(name) && count < LIMITS.cssMaxDeclarationsPerRule) {
        inlineStyle.push({ name, value });
        count++;
      }
    }
  }

  // 2. Get matched rules
  const matchedResp = await sendCommandSafe(entry, "CSS.getMatchedStylesForNode", { nodeId });
  if (matchedResp.ok) {
    const matchedCSSRules = (matchedResp.result as any)?.matchedCSSRules ?? [];
    let ruleCount = 0;

    for (const ruleMatch of matchedCSSRules) {
      if (ruleCount >= LIMITS.cssMaxRules) break;

      const rule = ruleMatch?.rule;
      if (!rule) continue;

      const selectorList = rule?.selectorList?.selectors ?? [];
      const selector = selectorList.map((s: any) => String(s?.text ?? "")).join(", ") || String(rule?.selectorList?.text ?? "");
      
      const styleSheetId = String(rule?.styleSheetId ?? "");
      let sourceUrl = "";

      // Try to get source URL from styleSheetId
      if (styleSheetId) {
        const sheetResp = await sendCommandSafe(entry, "CSS.getStyleSheetText", { styleSheetId });
        // sourceURL might be in the rule origin
        sourceUrl = String(rule?.origin === "regular" ? rule?.style?.styleSheetId : "") || "";
      }

      const cssProperties = rule?.style?.cssProperties ?? [];
      const declarations: Array<{ name: string; value: string }> = [];
      let declCount = 0;

      for (const prop of cssProperties) {
        if (declCount >= LIMITS.cssMaxDeclarationsPerRule) break;
        const name = String(prop?.name ?? "");
        const value = String(prop?.value ?? "");
        if (name && CSS_PROPERTY_WHITELIST.has(name)) {
          declarations.push({ name, value });
          declCount++;
        }
        // Collect CSS variables
        if (name.startsWith("--") && cssVariables.length < 20) {
          cssVariables.push({ name, value });
        }
      }

      if (declarations.length > 0 || selector) {
        matchedRules.push({
          selector,
          sourceUrl: sourceUrl || undefined,
          styleSheetId: styleSheetId || undefined,
          declarations
        });
        ruleCount++;
      }
    }

    // 3. Get inherited rules (first layer only for MVP)
    const inherited = (matchedResp.result as any)?.inherited ?? [];
    if (inherited.length > 0) {
      const firstInherited = inherited[0];
      const inheritedMatchedRules = firstInherited?.matchedCSSRules ?? [];

      for (const ruleMatch of inheritedMatchedRules.slice(0, 5)) {
        const rule = ruleMatch?.rule;
        if (!rule) continue;

        const selectorList = rule?.selectorList?.selectors ?? [];
        const selector = selectorList.map((s: any) => String(s?.text ?? "")).join(", ");

        const cssProperties = rule?.style?.cssProperties ?? [];
        const declarations: Array<{ name: string; value: string }> = [];

        for (const prop of cssProperties.slice(0, LIMITS.cssMaxDeclarationsPerRule)) {
          const name = String(prop?.name ?? "");
          const value = String(prop?.value ?? "");
          if (name && CSS_PROPERTY_WHITELIST.has(name)) {
            declarations.push({ name, value });
          }
        }

        if (declarations.length > 0) {
          inheritedRules.push({ selector, declarations });
        }
      }
    }
  }

  return {
    previewId,
    nodeId,
    inlineStyle,
    matchedRules,
    inheritedRules,
    cssVariables,
    timestamp
  };
}

// Cleanup injected xcoding-element-ids when Inspect closes
async function cleanupInjectedElementIds(entry: PreviewEntry) {
  const ids = entry.inspect.injectedElementIds;
  if (ids.size === 0) return;

  debugLog(entry.id, `Cleaning up ${ids.size} injected element IDs`);

  for (const [nodeId, xcodingId] of ids) {
    await sendCommandSafe(entry, "DOM.removeAttribute", {
      nodeId,
      name: "data-xcoding-element-id"
    });
  }

  ids.clear();
}

async function resolveBackendNodeId(entry: PreviewEntry, backendNodeId: number): Promise<number | null> {
  // `pushNodesByBackendIdsToFrontend` typically requires a frontend document tree to exist.
  // In DevTools, this is established by calling `DOM.getDocument` after enabling DOM.
  const tryPush = async () => {
    const resp = await sendCommandSafe(entry, "DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: [backendNodeId] });
    const nodeIds = resp.ok ? (resp.result as any)?.nodeIds : null;
    if (Array.isArray(nodeIds) && typeof nodeIds[0] === "number") return nodeIds[0];
    return null;
  };

  const first = await tryPush();
  if (first) return first;

  await sendCommandSafe(entry, "DOM.getDocument", { depth: 1, pierce: true });
  return await tryPush();
}

async function handleNodeSelected(entry: PreviewEntry, nodeId: number) {
  entry.inspect.selectedNodeId = nodeId;
  debugLog(entry.id, `handleNodeSelected nodeId=${nodeId}`);
  // In Overlay/DOM inspect modes, the highlight is drawn by InspectMode itself (Cursor-like hover highlight).
  // Only fall back to manual highlight for injected/coordinate-based picking modes.
  if (entry.inspect.mode !== "overlay" && entry.inspect.mode !== "dom") {
    await highlightSelectedNode(entry, nodeId);
  }
  const { computed, boxModel } = await fetchNodeData(entry, nodeId);
  debugLog(entry.id, `computedKeys=${Object.keys(computed).length} boxModel=${boxModel ? "yes" : "no"}`);
  broadcast("preview:element:selected", { previewId: entry.id, nodeId, computed, boxModel, timestamp: Date.now() });

  // Phase 1: Build and broadcast ElementContext
  const elementContext = await buildElementContext(entry, nodeId);
  if (elementContext) {
    debugLog(entry.id, `ElementContext built: cssSelector=${elementContext.cssSelector}, xcodingId=${elementContext.xcodingElementId}`);
    broadcast("preview:element:context", elementContext);
  }

  // Phase 2: Build and broadcast CssRulesContext
  const cssRulesContext = await buildCssRulesContext(entry, nodeId);
  if (cssRulesContext) {
    debugLog(entry.id, `CssRulesContext built: inlineStyle=${cssRulesContext.inlineStyle.length}, matchedRules=${cssRulesContext.matchedRules.length}`);
    broadcast("preview:element:css", cssRulesContext);
  }
}

async function resolveNodeIdAtPoint(entry: PreviewEntry, x: number, y: number): Promise<number | null> {
  const loc = await sendCommandSafe(entry, "DOM.getNodeForLocation", { x, y, includeUserAgentShadowDOM: true });
  if (loc.ok) {
    const directNodeId = Number((loc.result as any)?.nodeId ?? 0);
    if (directNodeId) return directNodeId;

    const backendNodeId = Number((loc.result as any)?.backendNodeId ?? 0);
    if (backendNodeId) {
      const resolved = await resolveBackendNodeId(entry, backendNodeId);
      if (resolved) return resolved;
    }
  } else {
    const msg = String((loc.error as any)?.message ?? "");
    debugLog(entry.id, `DOM.getNodeForLocation failed: ${msg || "unknown"}`);
  }

  // Fallback for older Electron CDP versions: elementFromPoint -> DOM.requestNode
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const expr = `(() => { try { return document.elementFromPoint(${xi}, ${yi}); } catch { return null; } })()`;
  const evalResp = await sendCommandSafe(entry, "Runtime.evaluate", {
    expression: expr,
    returnByValue: false,
    awaitPromise: false,
    userGesture: true
  });
  if (!evalResp.ok) {
    const msg = String((evalResp.error as any)?.message ?? "");
    debugLog(entry.id, `Runtime.evaluate(elementFromPoint) failed: ${msg || "unknown"}`);
    return null;
  }

  const objectId = String((evalResp.result as any)?.result?.objectId ?? "");
  if (!objectId) {
    debugLog(entry.id, "Runtime.evaluate(elementFromPoint) returned no objectId");
    return null;
  }

  const req = await sendCommandSafe(entry, "DOM.requestNode", { objectId });
  const nodeId = req.ok ? Number((req.result as any)?.nodeId ?? 0) : 0;
  if (!nodeId) {
    const msg = String((req.error as any)?.message ?? "");
    debugLog(entry.id, `DOM.requestNode failed: ${msg || "unknown"}`);
  }

  void sendCommandSafe(entry, "Runtime.releaseObject", { objectId });
  return nodeId || null;
}

function ensureInspectInputCapture(entry: PreviewEntry) {
  if (entry.inspectInputListener) return;

  let lastPickAt = 0;
  const wc = entry.view.webContents;

  const listener = (event: Electron.Event, input: Electron.Input) => {
    if (!entry.inspect.enabled) return;
    const type = String((input as any)?.type ?? "");
    // Only intercept clicks/presses. Keep mouse move unmodified so hover effects can still render.
    if (type !== "mouseDown") return;

    const x = Number((input as any)?.x ?? NaN);
    const y = Number((input as any)?.y ?? NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const now = Date.now();
    if (now - lastPickAt < 60) return;
    lastPickAt = now;

    try {
      // If we failed to inject our own capture script, block page interaction here.
      if (entry.inspect.mode !== "injected" && typeof (event as any)?.preventDefault === "function") (event as any).preventDefault();
    } catch {
      // ignore
    }

    void (async () => {
      debugLog(entry.id, `before-input-event mouseDown x=${x} y=${y}`);
      const nodeId = await resolveNodeIdAtPoint(entry, x, y);
      debugLog(entry.id, `before-input-event resolved nodeId=${nodeId ?? 0}`);
      if (!nodeId) return;
      await handleNodeSelected(entry, nodeId);
    })();
  };

  entry.inspectInputListener = listener;
  wc.on("before-input-event", listener);
  debugLog(entry.id, "inspect input capture attached");
}

function removeInspectInputCapture(entry: PreviewEntry) {
  const wc = entry.view.webContents;
  const listener = entry.inspectInputListener;
  if (!listener) return;
  entry.inspectInputListener = null;
  try {
    wc.removeListener("before-input-event", listener);
  } catch {
    // ignore
  }
  debugLog(entry.id, "inspect input capture removed");
}

async function enterInspect(entry: PreviewEntry) {
  if (entry.inspect.enabled) return { ok: true as const };
  entry.inspect.selectedNodeId = null;

  debugLog(entry.id, "enterInspect");

  // Best-effort: clear any previous injected/intercept state before entering inspect.
  // This avoids "stuck click interception" when toggling modes or after navigation races.
  await sendCommandSafe(entry, "Runtime.evaluate", { expression: interceptClickScript(false), awaitPromise: false, userGesture: true });
  await sendCommandSafe(entry, "Runtime.evaluate", { expression: injectedInspectScript(false), awaitPromise: false, userGesture: true });
  await sendCommandSafe(entry, "Overlay.setInspectMode", { mode: "none" });
  await sendCommandSafe(entry, "DOM.setInspectMode", { mode: "none" });
  await sendCommandSafe(entry, "Overlay.hideHighlight");

  const runtime = await sendCommandSafe(entry, "Runtime.enable");
  debugLog(entry.id, `Runtime.enable ok=${runtime.ok}`);
  const dom = await sendCommandSafe(entry, "DOM.enable");
  entry.inspect.capabilities.dom = dom.ok;
  if (dom.ok) await sendCommandSafe(entry, "DOM.getDocument", { depth: 1, pierce: true });
  debugLog(entry.id, `DOM.enable ok=${dom.ok}`);
  if (!dom.ok) {
    entry.inspect.enabled = false;
    entry.inspect.mode = "none";
    broadcast("preview:inspect:state", { previewId: entry.id, enabled: false });
    debugLog(entry.id, "inspect unsupported: DOM.enable failed");
    return { ok: false as const, reason: "unsupported" as const };
  }

  if (!entry.inspect.capabilities.css) {
    const css = await sendCommandSafe(entry, "CSS.enable");
    entry.inspect.capabilities.css = css.ok;
    debugLog(entry.id, `CSS.enable ok=${css.ok}`);
  }

  // Cursor behavior: crosshair cursor while Inspect is on.
  await sendCommandSafe(entry, "Runtime.evaluate", { expression: injectedInspectCursorScript(true), awaitPromise: false, userGesture: true });

  // Try DevTools-like pick mode first: Overlay.setInspectMode emits Overlay.inspectNodeRequested with backendNodeId.
  const overlay = await sendCommandSafe(entry, "Overlay.enable");
  entry.inspect.capabilities.overlay = overlay.ok;
  debugLog(entry.id, `Overlay.enable ok=${overlay.ok}`);

  if (entry.inspect.capabilities.overlay) {
    let overlayInspect = await sendCommandSafe(entry, "Overlay.setInspectMode", {
      mode: "searchForNode",
      highlightConfig: INSPECT_PICK_HIGHLIGHT_CONFIG
    });
    if (!overlayInspect.ok) {
      overlayInspect = await sendCommandSafe(entry, "Overlay.setInspectMode", {
        mode: "searchForNode",
        highlightConfig: INSPECT_PICK_HIGHLIGHT_CONFIG_NO_A11Y
      });
    }
    entry.inspect.capabilities.overlayInspect = overlayInspect.ok;
    debugLog(entry.id, `Overlay.setInspectMode ok=${overlayInspect.ok}`);
    if (overlayInspect.ok) {
      entry.inspect.enabled = true;
      entry.inspect.mode = "overlay";
      broadcast("preview:inspect:state", { previewId: entry.id, enabled: true });
      debugLog(entry.id, "inspect enabled mode=overlay");
      return { ok: true as const };
    }
  }

  let domInspect = await sendCommandSafe(entry, "DOM.setInspectMode", {
    mode: "searchForNode",
    highlightConfig: INSPECT_PICK_HIGHLIGHT_CONFIG
  });
  if (!domInspect.ok) {
    domInspect = await sendCommandSafe(entry, "DOM.setInspectMode", {
      mode: "searchForNode",
      highlightConfig: INSPECT_PICK_HIGHLIGHT_CONFIG_NO_A11Y
    });
  }
  entry.inspect.capabilities.domInspect = domInspect.ok;
  debugLog(entry.id, `DOM.setInspectMode ok=${domInspect.ok}`);
  if (domInspect.ok) {
    entry.inspect.enabled = true;
    entry.inspect.mode = "dom";
    broadcast("preview:inspect:state", { previewId: entry.id, enabled: true });
    debugLog(entry.id, "inspect enabled mode=dom");
    return { ok: true as const };
  }

  // Always try to ensure binding exists for the current document/context.
  const binding = await sendCommandSafe(entry, "Runtime.addBinding", { name: INSPECT_BINDING_NAME });
  if (!binding.ok) {
    const msg = String((binding.error as any)?.message ?? "");
    if (msg.includes("already exists") || msg.includes("Already exists")) {
      entry.inspect.capabilities.binding = true;
      debugLog(entry.id, "Runtime.addBinding already exists");
    } else {
      entry.inspect.capabilities.binding = false;
      debugLog(entry.id, `Runtime.addBinding failed: ${msg || "unknown"}`);
    }
  } else {
    entry.inspect.capabilities.binding = true;
    debugLog(entry.id, "Runtime.addBinding ok=true");
  }

  const bindingTypeResp = await sendCommandSafe(entry, "Runtime.evaluate", {
    expression: `typeof window[${JSON.stringify(INSPECT_BINDING_NAME)}]`,
    awaitPromise: false,
    userGesture: true
  });
  const bindingType = bindingTypeResp.ok ? String((bindingTypeResp.result as any)?.result?.value ?? "") : "unknown";
  debugLog(entry.id, `binding typeof=${bindingType}`);

  const injected = await sendCommandSafe(entry, "Runtime.evaluate", { expression: injectedInspectScript(true), awaitPromise: false, userGesture: true });
  debugLog(entry.id, `inject ok=${injected.ok}`);
  entry.inspect.enabled = true;
  entry.inspect.mode = injected.ok ? "injected" : "none";
  broadcast("preview:inspect:state", { previewId: entry.id, enabled: true });
  debugLog(entry.id, `inspect enabled mode=${entry.inspect.mode}`);
  // Ensure we can always pick nodes even if bindings/console events are flaky.
  // This uses Electron's before-input-event as the most reliable capture point.
  ensureInspectInputCapture(entry);
  return { ok: true as const };
}

async function exitInspect(entry: PreviewEntry, opts?: { force?: boolean }) {
  const force = Boolean(opts?.force);
  if (!force && !entry.inspect.enabled) return;

  entry.inspect.enabled = false;
  entry.inspect.selectedNodeId = null;
  debugLog(entry.id, "exitInspect");
  removeInspectInputCapture(entry);

  // Cleanup injected xcoding-element-ids (per requirement: remove on Inspect close)
  await cleanupInjectedElementIds(entry);

  // Best-effort cleanup in all modes. Some targets can fail individual CDP calls depending on timing
  // (navigation, crashed renderer, context destroyed). We try multiple ways to ensure we never
  // leave the preview in a state where clicks are still intercepted.
  let overlayNone = await sendCommandSafe(entry, "Overlay.setInspectMode", { mode: "none", highlightConfig: INSPECT_PICK_HIGHLIGHT_CONFIG });
  if (!overlayNone.ok) {
    overlayNone = await sendCommandSafe(entry, "Overlay.setInspectMode", { mode: "none", highlightConfig: INSPECT_PICK_HIGHLIGHT_CONFIG_NO_A11Y });
  }
  debugLog(entry.id, `Overlay.setInspectMode(none) ok=${overlayNone.ok}`);

  let domNone = await sendCommandSafe(entry, "DOM.setInspectMode", { mode: "none", highlightConfig: INSPECT_PICK_HIGHLIGHT_CONFIG });
  if (!domNone.ok) {
    domNone = await sendCommandSafe(entry, "DOM.setInspectMode", { mode: "none", highlightConfig: INSPECT_PICK_HIGHLIGHT_CONFIG_NO_A11Y });
  }
  debugLog(entry.id, `DOM.setInspectMode(none) ok=${domNone.ok}`);
  await sendCommandSafe(entry, "Overlay.hideHighlight");
  await sendCommandSafe(entry, "Overlay.disable");
  await sendCommandSafe(entry, "Runtime.evaluate", { expression: interceptClickScript(false), awaitPromise: false, userGesture: true });
  await sendCommandSafe(entry, "Runtime.evaluate", { expression: injectedInspectScript(false), awaitPromise: false, userGesture: true });
  await sendCommandSafe(entry, "Runtime.evaluate", {
    expression: injectedInspectCursorScript(false),
    awaitPromise: false,
    userGesture: true
  });

  entry.inspect.mode = "none";
  broadcast("preview:inspect:state", { previewId: entry.id, enabled: false });
}

async function resetInspectOnNavigation(entry: PreviewEntry) {
  if (!entry.inspect.enabled && !entry.inspect.selectedNodeId) return;
  await exitInspect(entry, { force: true });
}

function attachPreviewDebugger(previewId: string, view: BrowserView) {
  const wc = view.webContents;
  const debuggerApi = wc.debugger;
  try {
    debuggerApi.attach("1.3");
  } catch {
    return;
  }
  debugLog(previewId, "debugger attached");

  debuggerApi.on("message", (_event, method, params) => {
    if (method === "Runtime.consoleAPICalled") {
      const level = String(params.type ?? "log");
      const args = Array.isArray(params.args) ? params.args : [];
      const values = args.map((a: { value?: unknown; description?: unknown }) => String(a.value ?? a.description ?? ""));

      // Fallback channel for Inspect events when Runtime bindings aren't available.
      if (values[0] === "__XCODING_INSPECT__") {
        const entry = previews.get(previewId);
        if (!entry || !entry.inspect.enabled) return;
        const raw = values[1] ?? "";
        debugLog(previewId, `consoleInspect ${raw.slice(0, 200)}`);
        try {
          const msg = JSON.parse(raw) as { type?: string; x?: number; y?: number };
          if (msg?.type === "installed" || msg?.type === "enabled") return;
          if (msg?.type !== "click" && msg?.type !== "pointerdown") return;
          const x = Number(msg?.x ?? NaN);
          const y = Number(msg?.y ?? NaN);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          void (async () => {
            const nodeId = await resolveNodeIdAtPoint(entry, x, y);
            debugLog(previewId, `console resolved nodeId=${nodeId ?? 0}`);
            if (!nodeId) return;
            await handleNodeSelected(entry, nodeId);
          })();
        } catch {
          // ignore
        }
        return;
      }

      const text = values.join(" ");
      broadcast("preview:console", { previewId, level, text, timestamp: Date.now() });
      return;
    }

    if (method === "Runtime.bindingCalled" && params && params.name === INSPECT_BINDING_NAME) {
      const entry = previews.get(previewId);
      if (!entry || !entry.inspect.enabled) return;
      const payload = String(params.payload ?? "");
      debugLog(previewId, `bindingCalled ${payload.slice(0, 200)}`);
      try {
        const msg = JSON.parse(payload) as { type?: string; x?: number; y?: number };
        if (msg?.type === "installed" || msg?.type === "enabled") return;
        if (msg?.type !== "click" && msg?.type !== "pointerdown") return;
        const x = Number(msg?.x ?? NaN);
        const y = Number(msg?.y ?? NaN);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        void (async () => {
          const nodeId = await resolveNodeIdAtPoint(entry, x, y);
          debugLog(previewId, `binding resolved nodeId=${nodeId ?? 0}`);
          if (!nodeId) return;
          await handleNodeSelected(entry, nodeId);
        })();
      } catch {
        // ignore
      }
      return;
    }

    if (method === "Overlay.inspectNodeRequested" || method === "DOM.inspectNodeRequested") {
      const entry = previews.get(previewId);
      if (!entry || !entry.inspect.enabled) return;
      void (async () => {
        const backendNodeId = Number((params as any)?.backendNodeId ?? 0);
        const directNodeId = Number((params as any)?.nodeId ?? 0);
        debugLog(previewId, `${method} backendNodeId=${backendNodeId} nodeId=${directNodeId}`);
        const nodeId = directNodeId || (backendNodeId ? await resolveBackendNodeId(entry, backendNodeId) : null);
        if (!nodeId) return;
        await handleNodeSelected(entry, nodeId);
      })();
      return;
    }

    if (method === "Network.responseReceived") {
      const response = params.response ?? {};
      broadcast("preview:network", {
        previewId,
        requestId: String(params.requestId ?? ""),
        url: String(response.url ?? ""),
        status: Number(response.status ?? 0),
        method: String(params.type ?? ""),
        timestamp: Date.now()
      });
    }
  });

  const entry = previews.get(previewId);
  if (entry) {
    void (async () => {
      await sendCommandSafe(entry, "Runtime.enable");
      await sendCommandSafe(entry, "Network.enable");
      const dom = await sendCommandSafe(entry, "DOM.enable");
      entry.inspect.capabilities.dom = dom.ok;
      if (dom.ok) {
        // Prime the frontend DOM tree so backendNodeId->nodeId resolution works reliably.
        await sendCommandSafe(entry, "DOM.getDocument", { depth: 1, pierce: true });
      }
      const css = await sendCommandSafe(entry, "CSS.enable");
      entry.inspect.capabilities.css = css.ok;
      const overlay = await sendCommandSafe(entry, "Overlay.enable");
      entry.inspect.capabilities.overlay = overlay.ok;
      const binding = await sendCommandSafe(entry, "Runtime.addBinding", { name: INSPECT_BINDING_NAME });
      entry.inspect.capabilities.binding = binding.ok;
    })();
  }

  wc.on("dom-ready", () => {
    const e = previews.get(previewId);
    if (!e) return;
    if (!e.inspect.capabilities.dom) return;
    // Navigation resets the inspected document; refresh the DOM tree mapping.
    void sendCommandSafe(e, "DOM.getDocument", { depth: 1, pierce: true });
  });

  wc.on("did-navigate", () => {
    const e = previews.get(previewId);
    if (!e) return;
    void resetInspectOnNavigation(e);
  });

  wc.on("did-navigate-in-page", () => {
    const e = previews.get(previewId);
    if (!e) return;
    void resetInspectOnNavigation(e);
  });
}

export function createPreview(previewId: string, url: string) {
  if (!mainWindow) return { ok: false as const, reason: "no_window" as const };
  if (previews.has(previewId)) return { ok: true as const };

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  previews.set(previewId, {
    id: previewId,
    view,
    url,
    inspectInputListener: null,
    inspect: {
      enabled: false,
      selectedNodeId: null,
      mode: "none",
      capabilities: { dom: false, css: false, overlay: false, overlayInspect: false, domInspect: false, binding: false },
      injectedElementIds: new Map()
    }
  });
  attachPreviewDebugger(previewId, view);
  void view.webContents.loadURL(url);
  return { ok: true as const };
}

export function showPreview(previewId: string, bounds: { x: number; y: number; width: number; height: number }) {
  if (!mainWindow) return { ok: false as const, reason: "no_window" as const };
  const entry = previews.get(previewId);
  if (!entry) return { ok: false as const, reason: "not_found" as const };

  if (activePreviewId && activePreviewId !== previewId) {
    const prev = previews.get(activePreviewId);
    if (prev) {
      void exitInspect(prev, { force: true });
      mainWindow.removeBrowserView(prev.view);
    }
  }
  activePreviewId = previewId;

  mainWindow.addBrowserView(entry.view);
  entry.view.setBounds(bounds);
  entry.view.setAutoResize({ width: false, height: false });
  return { ok: true as const };
}

export function hidePreview(previewId: string) {
  if (!mainWindow) return { ok: true as const };
  if (!activePreviewId || activePreviewId !== previewId) return { ok: true as const };
  const entry = previews.get(previewId);
  if (entry) {
    void exitInspect(entry, { force: true });
    mainWindow.removeBrowserView(entry.view);
  }
  activePreviewId = null;
  return { ok: true as const };
}

export function setPreviewBounds(previewId: string, bounds: { x: number; y: number; width: number; height: number }) {
  const entry = previews.get(previewId);
  if (!entry) return { ok: false as const, reason: "not_found" as const };
  entry.view.setBounds(bounds);
  return { ok: true as const };
}

export function navigatePreview(previewId: string, url: string) {
  const entry = previews.get(previewId);
  if (!entry) return { ok: false as const, reason: "not_found" as const };
  entry.url = url;
  void resetInspectOnNavigation(entry);
  void entry.view.webContents.loadURL(url);
  return { ok: true as const };
}

export function destroyPreview(previewId: string) {
  const entry = previews.get(previewId);
  if (!entry) return { ok: true as const };
  if (mainWindow) mainWindow.removeBrowserView(entry.view);
  void exitInspect(entry, { force: true });
  try {
    entry.view.webContents.debugger.detach();
  } catch {
    // ignore
  }
  entry.view.webContents.close();
  previews.delete(previewId);
  if (activePreviewId === previewId) activePreviewId = null;
  return { ok: true as const };
}

export async function setPreviewInspect(previewId: string, enabled: boolean) {
  const entry = previews.get(previewId);
  if (!entry) return { ok: false as const, reason: "not_found" as const };
  if (enabled) return await enterInspect(entry);
  await exitInspect(entry, { force: true });
  return { ok: true as const };
}

export async function setPreviewStyle(previewId: string, payload: { nodeId: number; property: string; value: string }) {
  const entry = previews.get(previewId);
  if (!entry) return { ok: false as const, reason: "not_found" as const };
  const nodeId = Number(payload.nodeId ?? 0);
  const property = String(payload.property ?? "").trim();
  const value = String(payload.value ?? "");
  if (!nodeId || !property) return { ok: false as const, reason: "bad_request" as const };

  const resolved = await sendCommandSafe(entry, "DOM.resolveNode", { nodeId });
  const objectId = resolved.ok ? String((resolved.result as any)?.object?.objectId ?? "") : "";
  if (!objectId) return { ok: false as const, reason: "resolve_failed" as const };

  const apply = await sendCommandSafe(entry, "Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: "function(p,v){ try { this.style.setProperty(p,v); } catch(e) {} }",
    arguments: [{ value: property }, { value }],
    awaitPromise: false,
    userGesture: true
  });
  if (!apply.ok) return { ok: false as const, reason: "apply_failed" as const };

  const { computed } = await fetchNodeData(entry, nodeId);
  broadcast("preview:element:updated", { previewId, nodeId, computed, timestamp: Date.now() });
  return { ok: true as const };
}
