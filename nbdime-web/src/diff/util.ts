// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  valueIn, sortByKey, shallowCopy, accumulateLengths
} from '../common/util';

import {
  IDiffEntry, IDiffArrayEntry, IDiffPatch, IDiffAddRange, IDiffRemoveRange,
  IDiffAdd, opAddRange, opRemoveRange, validateSequenceOp
} from './diffentries';

/**
 * The indentation to use for JSON stringify.
 */
export const JSON_INDENT = '  ';


/**
 * Search the list of diffs for an entry with the given key.
 *
 * Returns the first found entry, or null if not entry was found.
 */
export
function getDiffKey(diff: IDiffEntry[] | null, key: string | number) : IDiffEntry[] | null {
  if (!diff) {
    return null;
  }
  for (let i=0; i < diff.length; ++i) {
    if (diff[i].key === key) {
      return (diff[i] as IDiffPatch).diff;
    }
  }
  return null;
}


function validateStringDiff(base: string[], entry: IDiffArrayEntry, lineToChar: number[]): void {
  // First valdiate line ops:
  validateSequenceOp(base, entry);

  if (entry.op === 'patch') {
    let line = base[entry.key];
    let diff = entry.diff;
    if (diff !== null) {
      for (let d of diff) {
        validateSequenceOp(line, d);
      }
    }
  }
}

/**
 * Check whether existing collection of diff ops shares a key with the new
 * diffop, and if they  also have the same op type.
 */
function overlaps(existing: IDiffArrayEntry[], newv: IDiffArrayEntry): boolean {
  if (existing.length < 1) {
    return false;
  }
  for (let e of existing) {
    if (e.op === newv.op) {
      if (e.key === newv.key) {
        // Found a match
        return true;
      } else if (e.op === 'removerange') {
        let first = e.key < newv.key ? e : newv as IDiffRemoveRange;
        let last = e.key > newv.key ? e : newv as IDiffRemoveRange;
        if (first.key + first.length >= last.key) {
          // Overlapping deletes
          // Above check is open ended to allow for sanity check here:
          if (first.key + first.length !== last.key) {
            throw 'Overlapping delete diff ops: ' +
              'Two operation remove same characters!';
          }
          return true;
        }
      }
    }
  }
  return false;
}


/**
 * Combines two ops into a new one that does the same
 */
function combineOps(a: IDiffArrayEntry, b: IDiffArrayEntry): IDiffArrayEntry {
  let combined: IDiffArrayEntry;
  if (b.op === 'addrange') {
    combined = opAddRange(a.key, (a as IDiffAddRange).valuelist);
    // valuelist can also be string, but string also has concat:
    (combined.valuelist as any[]).concat(b.valuelist as any[]);
    return combined;
  } else if (b.op === 'removerange') {
    if (a.op !== 'removerange') {
      throw 'Cannot combine operations: ' + a + ', ' + b;
    }
    combined = opRemoveRange(a.key, a.length + b.length);
  } else {
    throw 'Invalid string lines op to combine: ' + b;
  }
  combined.source = a.source;
  if (b.source !== a.source) {
    throw 'Cannot combine diff ops with different sources in one string line';
  }
  return combined;
}


/**
 * Translates a diff of strings split by str.splitlines() to a diff of the
 * joined multiline string
 */
export
function flattenStringDiff(val: string[] | string, diff: IDiffArrayEntry[]): IDiffArrayEntry[] {

  if (typeof val === 'string') {
    // Split lines (retaining newlines):
    let lines = val.match(/^.*([\n\r]|$)/gm);
    if (lines) {
      val = lines;
    } else {
      val = [val];
    }
  }
  let lineToChar = [0].concat(accumulateLengths(val));
  let flattened: IDiffArrayEntry[] = [];
  for (let e of diff) {
    // Frist validate op:
    validateStringDiff(val, e, lineToChar);
    let lineOffset = lineToChar[e.key];
    if (e.op === 'patch') {
      let pdiff = e.diff as IDiffArrayEntry[];
      if (pdiff !== null) {
        for (let p of pdiff) {
          let d = shallowCopy(p);
          d.key += lineOffset;
          if (overlaps(flattened, d)) {
            flattened[-1] = combineOps(flattened[-1], d);
          } else {
            flattened.push(d);
          }
        }
      }
    } else {
      // Other ops simply have keys which refer to lines
      let d: IDiffEntry | null = null;
      if (e.op === 'addrange') {
        d = opAddRange(lineOffset,
                       (e.valuelist as any[]).join(''));
      } else if (e.op === 'removerange') {
        let idx = e.key + e.length;
        d = opRemoveRange(lineOffset,
                          lineToChar[idx] - lineOffset);
      } else {
        throw 'Invalid string lines op: ' + e;
      }
      d.source = e.source;

      if (overlaps(flattened, d)) {
        flattened[-1] = combineOps(flattened[-1], d);
      } else {
        flattened.push(d);
      }
    }
  }
  // Finally, sort on key (leaving equal items in original order)
  // This is done since the original diffs are sorted deeper first!
  return sortByKey(flattened, 'key');
}