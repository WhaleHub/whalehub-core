'use strict';
/**
 * Result collection and Telegram formatting for the daily E2E suite.
 *
 * A check records one of three outcomes:
 *   pass  — behaved as expected
 *   warn  — worth a human glance, does not fail the run
 *   fail  — something is broken; the workflow exits non-zero
 *
 * `metric()` records a number to show in the report without judging it (locked
 * AQUA, balances, TVL); trends are read by a person, not asserted here.
 */

class Report {
  constructor() {
    this.groups = [];
    this._current = null;
    this.startedAt = Date.now();
  }

  group(name) {
    this._current = { name, results: [] };
    this.groups.push(this._current);
    return this;
  }

  _push(status, name, detail) {
    if (!this._current) this.group('general');
    this._current.results.push({ status, name, detail: detail == null ? '' : String(detail) });
  }

  pass(name, detail) { this._push('pass', name, detail); }
  warn(name, detail) { this._push('warn', name, detail); }
  fail(name, detail) { this._push('fail', name, detail); }
  metric(name, detail) { this._push('metric', name, detail); }

  /** Assert helper: records pass/fail from a boolean. */
  check(condition, name, detail) {
    if (condition) this.pass(name, detail);
    else this.fail(name, detail);
    return !!condition;
  }

  get counts() {
    const c = { pass: 0, warn: 0, fail: 0, metric: 0 };
    for (const g of this.groups) for (const r of g.results) c[r.status]++;
    return c;
  }

  get failed() {
    return this.counts.fail > 0;
  }

  get failures() {
    const out = [];
    for (const g of this.groups)
      for (const r of g.results) if (r.status === 'fail') out.push({ group: g.name, ...r });
    return out;
  }

  /** Console output for local runs and the Actions log. */
  toText() {
    const ICON = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', metric: '    ' };
    const lines = [];
    for (const g of this.groups) {
      lines.push('');
      lines.push(`── ${g.name} ${'─'.repeat(Math.max(0, 56 - g.name.length))}`);
      for (const r of g.results) {
        lines.push(`  ${ICON[r.status]}  ${r.name}${r.detail ? '  —  ' + r.detail : ''}`);
      }
    }
    const c = this.counts;
    lines.push('');
    lines.push(
      `${c.fail ? 'FAILED' : 'OK'} — ${c.pass} passed, ${c.warn} warned, ${c.fail} failed ` +
        `(${((Date.now() - this.startedAt) / 1000).toFixed(1)}s)`
    );
    return lines.join('\n');
  }

  /**
   * Telegram HTML. Kept under the 4096-char limit: on a clean run we send the
   * summary plus metrics; on a failing run the failures always win the space.
   */
  toTelegram({ runUrl, sha, limit = 3900 } = {}) {
    const c = this.counts;
    const ok = !this.failed;
    const head = ok
      ? `✅ <b>WhaleHub daily E2E — all clear</b>`
      : `🚨 <b>WhaleHub daily E2E — ${c.fail} FAILED</b>`;

    const parts = [head, ''];
    parts.push(
      `<code>${c.pass} passed · ${c.warn} warned · ${c.fail} failed · ${(
        (Date.now() - this.startedAt) / 1000
      ).toFixed(1)}s</code>`
    );

    if (!ok) {
      parts.push('', '<b>Failures</b>');
      for (const f of this.failures) {
        parts.push(`• <b>${esc(f.group)}</b> — ${esc(f.name)}`);
        if (f.detail) parts.push(`  <code>${esc(f.detail.slice(0, 220))}</code>`);
      }
    }

    const warns = [];
    for (const g of this.groups)
      for (const r of g.results) if (r.status === 'warn') warns.push(`• ${esc(g.name)} — ${esc(r.name)}${r.detail ? ': ' + esc(r.detail.slice(0, 120)) : ''}`);
    if (warns.length) {
      parts.push('', '<b>Warnings</b>', ...warns);
    }

    const metrics = [];
    for (const g of this.groups)
      for (const r of g.results) if (r.status === 'metric') metrics.push(`• ${esc(r.name)}: <b>${esc(r.detail)}</b>`);
    if (metrics.length) {
      parts.push('', '<b>Metrics</b>', ...metrics);
    }

    const footer = [];
    if (sha) footer.push(`<code>${esc(sha.slice(0, 7))}</code>`);
    if (runUrl) footer.push(`<a href="${esc(runUrl)}">run log</a>`);
    if (footer.length) parts.push('', footer.join(' · '));

    let msg = parts.join('\n');
    if (msg.length > limit) msg = msg.slice(0, limit - 20) + '\n…<i>truncated</i>';
    return msg;
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { Report, esc };
