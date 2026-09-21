// The tolerant parser. The native contract makes this a fallback, and the
// worker records which path handled each response so the evals can say how
// often the fallback still runs.
//
//   native      the text parsed as-is
//   recovered   fences stripped, or the outermost object cut out and parsed
//   failed      nothing parseable; a truncated response is reported as such

export function parseJson(text, { stopReason = null } = {}) {
  const raw = String(text ?? '').trim();
  try {
    return { ok: true, path: 'native', value: JSON.parse(raw) };
  } catch {
    // fall through
  }
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return { ok: true, path: 'recovered', value: JSON.parse(unfenced) };
  } catch {
    // fall through
  }
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return { ok: true, path: 'recovered', value: JSON.parse(unfenced.slice(start, end + 1)) };
    } catch {
      // fall through
    }
  }
  const truncated = stopReason === 'max_tokens' || (start >= 0 && end <= start);
  return { ok: false, path: 'failed', error: truncated ? 'response was cut off before the JSON closed' : 'response was not JSON' };
}
