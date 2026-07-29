export type SpeechLanguage = "mixed" | "zh-CN" | "en-US";

export interface RecognitionAlternative {
  transcript: string;
  confidence?: number;
}

const LATIN_PHRASE_RE =
  /[A-Za-z][A-Za-z0-9.+#&'’/-]*(?:\s+[A-Za-z][A-Za-z0-9.+#&'’/-]*){0,3}/g;
const SEPARATOR_RE = /[\n,，;；]+/;
const NORMALIZE_RE = /[\s\u3000，。！？；：、“”‘’（）《》【】…—,.!?;:'"()[\]{}<>_\-]/g;

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(NORMALIZE_RE, "");
}

export function getRecognitionLanguage(language: SpeechLanguage) {
  return language === "en-US" ? "en-US" : "zh-CN";
}

export function extractRecognitionPhrases(
  script: string,
  customVocabulary: string,
) {
  const phrases = [
    ...customVocabulary
      .split(SEPARATOR_RE)
      .map((phrase) => phrase.trim())
      .filter(Boolean),
    ...(script.match(LATIN_PHRASE_RE) ?? []).map((phrase) => phrase.trim()),
  ];
  const seen = new Set<string>();

  return phrases.filter((phrase) => {
    const key = phrase.toLocaleLowerCase();
    if (
      phrase.length > 60 ||
      !/[A-Za-z]/.test(phrase) ||
      seen.has(key)
    ) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 40);
}

export function chooseRecognitionAlternative(
  alternatives: RecognitionAlternative[],
  context: string,
  phrases: string[],
) {
  if (alternatives.length === 0) {
    return "";
  }

  const normalizedContext = normalize(context);
  const normalizedPhrases = phrases.map(normalize).filter(Boolean);
  let bestTranscript = alternatives[0].transcript;
  let bestScore = Number.NEGATIVE_INFINITY;

  alternatives.forEach((alternative, index) => {
    const transcript = alternative.transcript.trim();
    const normalizedTranscript = normalize(transcript);
    let score = (alternative.confidence ?? 0) * 2 - index * 0.04;

    if (
      normalizedContext &&
      normalizedTranscript.length >= 2 &&
      normalizedContext.includes(normalizedTranscript)
    ) {
      score += 5;
    }

    normalizedPhrases.forEach((phrase) => {
      if (normalizedTranscript.includes(phrase)) {
        score += 2;
      }
    });

    if (score > bestScore) {
      bestScore = score;
      bestTranscript = transcript;
    }
  });

  return bestTranscript;
}
