/**
 * Lightweight three-way merge for a plain-text document.
 *
 * Each side's change relative to the common base is reduced to a single
 * splice (common prefix / common suffix diff). If the two splices touch
 * different regions, both are applied. If they overlap, the remote change
 * is kept and the local insertion is placed right after it, so no typed text
 * is silently dropped.
 *
 * This is deliberately simple; for rich multi-cursor editing use a CRDT
 * (e.g. Yjs) instead.
 */
export type Splice = { start: number; end: number; text: string };

/** Single splice that turns `base` into `next` (end is exclusive, in base coords). */
export function diff(base: string, next: string): Splice {
  let start = 0;
  const maxPrefix = Math.min(base.length, next.length);
  while (start < maxPrefix && base[start] === next[start]) start++;

  let baseEnd = base.length;
  let nextEnd = next.length;
  while (baseEnd > start && nextEnd > start && base[baseEnd - 1] === next[nextEnd - 1]) {
    baseEnd--;
    nextEnd--;
  }
  return { start, end: baseEnd, text: next.slice(start, nextEnd) };
}

function isNoop(s: Splice) {
  return s.start === s.end && s.text === "";
}

export function apply(doc: string, s: Splice) {
  return doc.slice(0, s.start) + s.text + doc.slice(s.end);
}

/** Maps a position in the pre-splice text to the post-splice text. */
export function transformIndex(index: number, s: Splice): number {
  if (index <= s.start) return index;
  if (index >= s.end) return index + s.text.length - (s.end - s.start);
  // Inside a replaced region: move to the end of the replacement.
  return s.start + s.text.length;
}

/**
 * Merges `local` and `remote`, both derived from `base`. Returns the merged
 * text plus the remote splice (in local coordinates) so callers can keep the
 * user's caret in the right place.
 */
export function merge(base: string, local: string, remote: string) {
  const mine = diff(base, local);
  const theirs = diff(base, remote);

  if (isNoop(mine)) return { text: remote, remoteSplice: diff(local, remote) };
  if (isNoop(theirs) || local === remote) return { text: local, remoteSplice: diff(local, local) };

  let merged: string;
  // Checked first so that two insertions at the same spot put the remote text first.
  if (theirs.end <= mine.start) {
    // Their change is entirely before mine: shift mine by their length delta.
    const delta = theirs.text.length - (theirs.end - theirs.start);
    merged = apply(apply(base, theirs), {
      start: mine.start + delta,
      end: mine.end + delta,
      text: mine.text
    });
  } else if (mine.end <= theirs.start) {
    // My change is entirely before theirs: apply theirs first, mine is unaffected.
    merged = apply(apply(base, theirs), mine);
  } else {
    // Overlapping edits: keep the remote change and append my inserted text after it.
    const afterTheirs = theirs.start + theirs.text.length;
    const remoteDoc = apply(base, theirs);
    merged = apply(remoteDoc, { start: afterTheirs, end: afterTheirs, text: mine.text });
  }

  return { text: merged, remoteSplice: diff(local, merged) };
}
