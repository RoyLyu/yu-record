const TERMINAL_PUNCTUATION_RE = /[。！？!?…]$/;
const ANY_PUNCTUATION_RE = /[，。！？；：、,.!?;:]/;
const QUESTION_RE =
  /^(为什么|为何|怎么|怎样|如何|是否|能否|可不可以|有没有)|(?:吗|呢|么|是不是|对不对|好不好)$/;

function getTerminalPunctuation(value: string) {
  return QUESTION_RE.test(value) ? "？" : "。";
}

function splitByLength(value: string, maximumLength: number) {
  const characters = Array.from(value);
  const segments: string[] = [];

  for (let index = 0; index < characters.length; index += maximumLength) {
    segments.push(characters.slice(index, index + maximumLength).join(""));
  }

  return segments;
}

function splitWordsByLength(value: string, maximumLength: number) {
  const segments: string[] = [];
  let currentSegment = "";

  value.split(" ").forEach((word) => {
    const candidate = currentSegment ? `${currentSegment} ${word}` : word;
    if (currentSegment && candidate.length > maximumLength) {
      segments.push(currentSegment);
      currentSegment = word;
    } else {
      currentSegment = candidate;
    }
  });

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

export function punctuateFinalTranscript(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (TERMINAL_PUNCTUATION_RE.test(normalized)) {
    return normalized;
  }

  if (ANY_PUNCTUATION_RE.test(normalized)) {
    return `${normalized}${getTerminalPunctuation(normalized)}`;
  }

  const segments = normalized.includes(" ")
    ? splitWordsByLength(normalized, 32)
    : splitByLength(normalized, 20);
  const terminal = getTerminalPunctuation(normalized);

  return segments
    .map((segment, index) =>
      index === segments.length - 1 ? `${segment}${terminal}` : `${segment}，`,
    )
    .join("");
}
