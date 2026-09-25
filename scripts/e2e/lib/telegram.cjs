'use strict';
/**
 * Telegram delivery.
 *
 * Needs two secrets:
 *   TELEGRAM_BOT_TOKEN — from @BotFather
 *   TELEGRAM_CHAT_ID   — the target chat/channel (see scripts/e2e/README.md)
 *
 * With either unset the suite still runs and prints to stdout; it just says so
 * and skips delivery, so a missing secret never masks a real failure.
 */
async function sendTelegram(text, { token, chatId, silent = false } = {}) {
  token = token || process.env.TELEGRAM_BOT_TOKEN;
  chatId = chatId || process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { sent: false, reason: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set' };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: silent,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    return {
      sent: false,
      reason: `Telegram HTTP ${res.status}: ${body.description || 'unknown error'}`,
    };
  }
  return { sent: true, messageId: body.result && body.result.message_id };
}

module.exports = { sendTelegram };
