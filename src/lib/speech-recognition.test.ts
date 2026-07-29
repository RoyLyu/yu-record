import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseRecognitionAlternative,
  extractRecognitionPhrases,
  getRecognitionLanguage,
} from "./speech-recognition.ts";

test("mixed recognition keeps Chinese as the primary browser language", () => {
  assert.equal(getRecognitionLanguage("mixed"), "zh-CN");
  assert.equal(getRecognitionLanguage("en-US"), "en-US");
});

test("extracts custom and scripted English terms without duplicates", () => {
  assert.deepEqual(
    extractRecognitionPhrases(
      "今天介绍 OpenAI 和 Final Cut Pro。",
      "OpenAI, GPT-5\nRoy Lyu",
    ),
    ["OpenAI", "GPT-5", "Roy Lyu", "Final Cut Pro"],
  );
});

test("prefers a lower-ranked alternative that matches the script", () => {
  assert.equal(
    chooseRecognitionAlternative(
      [
        { transcript: "开启录音", confidence: 0.82 },
        { transcript: "开始录音", confidence: 0.74 },
      ],
      "接下来点击开始录音按钮",
      [],
    ),
    "开始录音",
  );
});

test("prefers an English alternative matching the term library", () => {
  assert.equal(
    chooseRecognitionAlternative(
      [
        { transcript: "欧喷爱", confidence: 0.84 },
        { transcript: "OpenAI", confidence: 0.7 },
      ],
      "",
      ["OpenAI"],
    ),
    "OpenAI",
  );
});
