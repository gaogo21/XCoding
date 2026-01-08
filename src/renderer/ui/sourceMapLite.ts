type SourceMapV3 = {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  names?: string[];
  mappings: string;
};

type DecodedSegment = {
  genCol: number; // 0-based
  src: number;
  srcLine: number; // 0-based
  srcCol: number; // 0-based
  name?: number;
};

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INT: Record<string, number> = Object.fromEntries(Array.from(BASE64_CHARS).map((c, i) => [c, i]));

function decodeVlqValue(str: string, indexRef: { i: number }) {
  let result = 0;
  let shift = 0;
  let continuation: number;
  do {
    const ch = str[indexRef.i++];
    const val = BASE64_INT[ch];
    if (val == null) throw new Error("vlq_bad_char");
    continuation = val & 32;
    const digit = val & 31;
    result += digit << shift;
    shift += 5;
  } while (continuation);

  const isNeg = (result & 1) === 1;
  const shifted = result >> 1;
  return isNeg ? -shifted : shifted;
}

function decodeMappings(map: SourceMapV3): DecodedSegment[][] {
  const lines: DecodedSegment[][] = [];
  let genLine = 0;

  let prevGenCol = 0;
  let prevSrc = 0;
  let prevSrcLine = 0;
  let prevSrcCol = 0;
  let prevName = 0;

  const mappings = map.mappings || "";
  lines.push([]);

  const indexRef = { i: 0 };
  while (indexRef.i < mappings.length) {
    const ch = mappings[indexRef.i];
    if (ch === ";") {
      indexRef.i++;
      genLine++;
      prevGenCol = 0;
      lines.push([]);
      continue;
    }
    if (ch === ",") {
      indexRef.i++;
      continue;
    }

    // segment: 1,4,5 fields
    const genColDelta = decodeVlqValue(mappings, indexRef);
    prevGenCol += genColDelta;

    // If no further fields, it's an unmapped segment.
    if (indexRef.i >= mappings.length) {
      continue;
    }
    const nextCh = mappings[indexRef.i];
    if (nextCh === "," || nextCh === ";") {
      continue;
    }

    const srcDelta = decodeVlqValue(mappings, indexRef);
    prevSrc += srcDelta;
    const srcLineDelta = decodeVlqValue(mappings, indexRef);
    prevSrcLine += srcLineDelta;
    const srcColDelta = decodeVlqValue(mappings, indexRef);
    prevSrcCol += srcColDelta;

    let name: number | undefined;
    if (indexRef.i < mappings.length) {
      const peek = mappings[indexRef.i];
      if (peek !== "," && peek !== ";") {
        const nameDelta = decodeVlqValue(mappings, indexRef);
        prevName += nameDelta;
        name = prevName;
      }
    }

    const seg: DecodedSegment = { genCol: prevGenCol, src: prevSrc, srcLine: prevSrcLine, srcCol: prevSrcCol, name };
    if (!lines[genLine]) lines[genLine] = [];
    lines[genLine].push(seg);
  }

  return lines;
}

function joinSourceRoot(sourceRoot: string | undefined, source: string) {
  const root = (sourceRoot || "").trim();
  if (!root) return source;
  if (source.startsWith("/") || source.includes("://")) return source;
  const r = root.endsWith("/") ? root : root + "/";
  return r + source;
}

export type OriginalPosition = { source: string; line: number; column: number };

export class SourceMapLite {
  private map: SourceMapV3;
  private decoded: DecodedSegment[][];

  constructor(map: SourceMapV3) {
    if (!map || typeof map !== "object") throw new Error("map_invalid");
    if (typeof map.mappings !== "string") throw new Error("map_missing_mappings");
    if (!Array.isArray(map.sources)) throw new Error("map_missing_sources");
    this.map = map;
    this.decoded = decodeMappings(map);
  }

  originalPositionFor(generatedLine1: number, generatedColumn0: number): OriginalPosition | null {
    const lineIdx = Math.max(0, generatedLine1 - 1);
    const segments = this.decoded[lineIdx];
    if (!segments || segments.length === 0) return null;
    const col = Math.max(0, generatedColumn0);

    // Find last segment whose genCol <= col
    let candidate: DecodedSegment | null = null;
    for (const seg of segments) {
      if (seg.genCol > col) break;
      candidate = seg;
    }
    if (!candidate) return null;
    const src = this.map.sources[candidate.src];
    if (typeof src !== "string") return null;
    const source = joinSourceRoot(this.map.sourceRoot, src);
    return { source, line: candidate.srcLine + 1, column: candidate.srcCol };
  }
}
