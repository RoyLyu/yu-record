import assert from "node:assert/strict";
import test from "node:test";
import { punctuateFinalTranscript } from "./caption-format.ts";

test("adds a full stop when a recognition segment ends", () => {
  assert.equal(punctuateFinalTranscript("今天天气很好"), "今天天气很好。");
});

test("uses final recognition pauses and breaks long Chinese segments", () => {
  assert.equal(
    punctuateFinalTranscript("这是一个没有标点而且会连续显示很长时间的实时字幕测试"),
    "这是一个没有标点而且会连续显示很长时间的，实时字幕测试。",
  );
});

test("recognizes common Chinese question forms", () => {
  assert.equal(punctuateFinalTranscript("为什么没有声音"), "为什么没有声音？");
  assert.equal(punctuateFinalTranscript("现在可以开始了吗"), "现在可以开始了吗？");
});

test("keeps punctuation already returned by recognition", () => {
  assert.equal(
    punctuateFinalTranscript("大家好，欢迎来到屿录"),
    "大家好，欢迎来到屿录。",
  );
});

test("does not add a comma after every recognized Latin word", () => {
  assert.equal(
    punctuateFinalTranscript("OK now we can start recording"),
    "OK now we can start recording.",
  );
});

test("uses English question punctuation for English recognition", () => {
  assert.equal(
    punctuateFinalTranscript("Can we start recording now"),
    "Can we start recording now?",
  );
});
