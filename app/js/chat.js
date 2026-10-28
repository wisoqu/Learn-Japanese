/* ==========================================================================
   chat.js — Общая часть чата: системный промт, рендер, отправка
   --------------------------------------------------------------------------
   Чат по умолчанию выключен. Он включается, когда пользователь вводит
   Gemini API ключ — ключ уходит в наш FastAPI-прокси, а не в консоль.
   ========================================================================== */

import { t, I18N } from "./i18n.js";
import * as API from "./api.js";
import { settings } from "./settings.js";
import { progress } from "./srs.js";

/** Контекст обучения, который мы подставляем в промт. */
export function studyContext(ctx) {
  const lines = [];
  if (ctx.setName) lines.push(`Мудровский алфавит: ${ctx.setName}.`);
  if (ctx.rowLabel) lines.push(`Сейчас учится строке: ${ctx.rowLabel}.`);
  if (ctx.progress) lines.push(`Пройдено строк: ${ctx.progress.rows} из ${ctx.progress.total}.`);
  if (ctx.learned) lines.push(`Изучено символов: ${ctx.learned}.`);
  if (ctx.accuracy) lines.push(`Общая точность ответов: ${Math.round(ctx.accuracy * 100)}%.`);
  if (ctx.due) lines.push(`К повторению сегодня: ${ctx.due} карточек.`);
  if (ctx.lang) lines.push(`Язык пользователя: ${ctx.lang}. Отвечайте на этом языке.`);
  return lines.join("\n");
}

export function systemPrompt(ctx) {
  const study = studyContext(ctx);
  return `Ты — добрый, терпеливый учитель японского языка в приложении для изучения канадзи.
${study}

Правила:
- Отвечайте на языке пользователя (רוסский/английский/японский), но всегда показывайте японские слова кана + ромадзи, например: さ行 (sa-gyō) — «строка са».
- Если человек делает ошибку — мягко покажите правильный вариант и краткую причину, не читайте нотации.
- Короткие ответы: 1–4 предложения. Покажи пример разбора strokes, если спрашивают про письмо.
- Можно задавать короткий вопрос-задачу, чтобы проверить, усвоил ли человек символ. Не больше одного вопроса за раз.
- Не придумываешь значения иероглифов, если не уверен — скажи, что нужно проверить в словаре.
- Не консультируй по другим темам: приложение занимается только обучением.
- Будь поддерживающим, без эмодзи в каждом предложении.`;
}

/** Преобразуем диалог в messages для Gemini. */
export function toGeminiMessages(history, ctx) {
  const out = [{ role: "system", parts: [{ text: systemPrompt(ctx) }] }];
  for (const m of history.slice(-24)) {
    out.push({ role: m.role === "ai" ? "model" : "user", parts: [{ text: m.text }] });
  }
  return out;
}

export function chatEnabled() {
  return !!(API.chatKey && settings.get("geminiKey") === API.chatKey);
}

/**
 * Отправить сообщение и потоком писать ответ в onDelta.
 * @returns {Promise<string>} полный текст ответа
 */
export async function sendMessage(text, history, ctx, { onDelta, signal } = {}) {
  const key = settings.get("geminiKey");
  if (!key) throw new Error("no-key");
  API.chatKey = key;
  API.model = settings.get("geminiModel") || "gemini-2.0-flash";
  const msgs = toGeminiMessages([...history, { role: "user", text }], ctx);
  let full = "";
  await API.chatStream(msgs, {
    onDelta: (d) => { full += d; onDelta && onDelta(d, full); },
    signal,
  });
  return full;
}

/** Проверить ключ один раз — вызывается из настроек. */
export async function testKey(key) {
  const saved = settings.get("geminiKey");
  if (key) settings.set("geminiKey", key);
  API.chatKey = key || settings.get("geminiKey");
  API.model = settings.get("geminiModel") || "gemini-2.0-flash";
  try {
    await API.chatStream([{ role: "user", parts: [{ text: "одно слово: こんにちは" }] }], {});
    return true;
  } catch (e) {
    return false;
  }
}
