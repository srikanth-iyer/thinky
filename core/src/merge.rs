//! Three-way merge of a page's blocks, for when the file changed on disk (phone, widget,
//! Claude) while it was being edited here. Changes in different places are combined;
//! changes to the same place give up, and the user chooses.

use crate::doc::{Doc, DocBlock};
use serde::Serialize;
use std::collections::HashSet;

/// A note as compared: its level and words.
pub(crate) type Key<'a> = (usize, &'a str);

pub(crate) fn keys(b: &[DocBlock]) -> Vec<Key<'_>> {
    b.iter().map(|x| (x.depth, x.text.as_str())).collect()
}

/// Matched index pairs of a longest common subsequence, in order. None if too big to diff.
/// (Also how a page's earlier version differs from it now: app/history.rs.)
pub(crate) fn lcs(a: &[Key], b: &[Key]) -> Option<Vec<(usize, usize)>> {
    // common prefix and suffix first: most edits touch a small part of a page
    let mut pre = 0;
    while pre < a.len() && pre < b.len() && a[pre] == b[pre] {
        pre += 1;
    }
    let mut suf = 0;
    while suf < a.len() - pre && suf < b.len() - pre && a[a.len() - 1 - suf] == b[b.len() - 1 - suf] {
        suf += 1;
    }
    let (am, bm) = (&a[pre..a.len() - suf], &b[pre..b.len() - suf]);
    if am.len().saturating_mul(bm.len()) > 4_000_000 {
        return None;
    }
    let (n, m) = (am.len(), bm.len());
    let mut t = vec![0u32; (n + 1) * (m + 1)];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            t[i * (m + 1) + j] = if am[i] == bm[j] {
                t[(i + 1) * (m + 1) + j + 1] + 1
            } else {
                t[(i + 1) * (m + 1) + j].max(t[i * (m + 1) + j + 1])
            };
        }
    }
    let mut out: Vec<(usize, usize)> = (0..pre).map(|i| (i, i)).collect();
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if am[i] == bm[j] {
            out.push((pre + i, pre + j));
            i += 1;
            j += 1;
        } else if t[(i + 1) * (m + 1) + j] >= t[i * (m + 1) + j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    out.extend((0..suf).map(|k| (a.len() - suf + k, b.len() - suf + k)));
    Some(out)
}

/// Merge `mine` and `theirs`, both edited from `base`. Unchanged and their blocks keep their
/// exact file lines (`raw`). None when both changed the same place.
pub fn merge_blocks(base: &[DocBlock], mine: &[DocBlock], theirs: &[DocBlock]) -> Option<Vec<DocBlock>> {
    let mut out = vec![];
    for p in clash_parts(base, mine, theirs)? {
        match p {
            Part::Same { blocks } => out.extend(blocks),
            Part::Clash { .. } => return None,
        }
    }
    Some(out)
}

/// One stretch of the page between notes both sides left as they were (`oc` before, `ac` here, `bc`
/// there; `mine`/`theirs` the stretch's notes; `was` and `next`: see `both_added`): the notes it ends
/// up with, or None when both changed it in ways that can't be combined (a clash, for him to choose).
fn stretch(oc: &[Key], ac: &[Key], bc: &[Key], mine: &[DocBlock], theirs: &[DocBlock], was: Option<&HashSet<&str>>, next: Option<usize>) -> Option<Vec<DocBlock>> {
    if ac == oc {
        return Some(theirs.to_vec());
    }
    if bc == oc || ac == bc {
        return Some(mine.to_vec());
    }
    if oc.is_empty() {
        return both_added(mine, theirs, was, next);
    }
    if oc.len() == ac.len() && ac.len() == bc.len() && aligned(oc, ac) && aligned(oc, bc) {
        // both edited notes where they were: note by note, whichever side changed it; a note both
        // changed makes the whole stretch a clash (paired note by note, a note removed on one side
        // and one added next to it would look like an edit and come out twice)
        return (0..oc.len()).map(|k| side(oc[k], ac[k], bc[k]).map(|m| if m { mine[k].clone() } else { theirs[k].clone() })).collect();
    }
    edits_and_insertions(oc, ac, mine, bc, theirs).or_else(|| edits_and_insertions(oc, bc, theirs, ac, mine))
}

/// Every note where `xc` differs from `oc` was changed where it was: its new text isn't one of the
/// stretch's earlier notes, and its old text isn't anywhere in the changed version (else a note was
/// moved, or removed with another added next to it, and pairing them by place would mix them up).
fn aligned(oc: &[Key], xc: &[Key]) -> bool {
    let (os, xs): (HashSet<&Key>, HashSet<&Key>) = (oc.iter().collect(), xc.iter().collect());
    oc.iter().zip(xc).all(|(o, x)| o == x || (!os.contains(x) && !xs.contains(o)))
}

/// Both sides added notes at the same place (nothing was there before), e.g. a note typed at the end
/// of today's journal while the phone's widget or Claude added one: keep both, this device's first.
/// Their notes that are exactly like one of ours (same text and depth: the same note made twice) are
/// kept once. The order must leave every note under the same parent as before: ours first if none of
/// ours is shallower than their first note (it would otherwise take ours' last notes as its parent),
/// else theirs first the same way round; if neither fits, None (he chooses). Also None when one of
/// the notes has the words of a note the page already had (`was`: its texts; empty notes don't count):
/// then it was moved here, not added (or, with repeated words, it may be that note); and when `was` is
/// None: both versions took a note away from where it was (moved, removed or changed it), so a "new"
/// note here may be that note, moved on both sides. Keeping both could show a note twice. And None
/// when a note added here is shallower than `next`, the depth of the first note after this place that
/// both still have: that note (and the ones after it) would then end up under it, one side's choice.
fn both_added(mine: &[DocBlock], theirs: &[DocBlock], was: Option<&HashSet<&str>>, next: Option<usize>) -> Option<Vec<DocBlock>> {
    let was = was?;
    let added = || mine.iter().chain(theirs);
    if added().any(|x| (!x.text.trim().is_empty() && was.contains(x.text.as_str())) || next.is_some_and(|d| x.depth < d)) {
        return None;
    }
    let mut left: Vec<&DocBlock> = mine.iter().collect();
    let mut extra: Vec<DocBlock> = vec![];
    for t in theirs {
        match left.iter().position(|m| m.depth == t.depth && m.text == t.text) {
            Some(i) => {
                left.remove(i);
            }
            None => extra.push(t.clone()),
        }
    }
    let Some(t0) = extra.first() else { return Some(mine.to_vec()) };
    let Some(m0) = mine.first() else { return Some(extra) };
    let shallowest = |v: &[DocBlock]| v.iter().map(|x| x.depth).min().unwrap_or(0);
    if shallowest(mine) >= t0.depth {
        Some([mine, &extra].concat())
    } else if shallowest(&extra) >= m0.depth {
        Some([&extra, mine].concat())
    } else {
        None
    }
}

/// Which side's version of one note to keep: `Some(true)` mine, `Some(false)` theirs (also when
/// neither changed it), None when both changed it differently.
fn side(o: Key, a: Key, b: Key) -> Option<bool> {
    if a == o {
        Some(false)
    } else if b == o || a == b {
        Some(true)
    } else {
        None
    }
}

/// One side only edited blocks in place (same count, same order); the other only added
/// blocks (the original ones are all still there, in order). Combine: the added blocks, with
/// the edits applied to the original ones. E.g. a block edited on the laptop while the phone
/// appended a new bullet right after it.
fn edits_and_insertions(oc: &[Key], ec: &[Key], edited: &[DocBlock], ic: &[Key], inserted: &[DocBlock]) -> Option<Vec<DocBlock>> {
    if oc.len() != ec.len() || oc.iter().zip(ec).any(|(x, y)| x.0 != y.0 && x.1 == y.1) {
        return None;
    }
    // where each original block sits among the other side's blocks
    let mut pos = Vec::with_capacity(oc.len());
    let mut j = 0;
    for k in oc {
        while j < ic.len() && ic[j] != *k {
            j += 1;
        }
        if j == ic.len() {
            return None;
        }
        pos.push(j);
        j += 1;
    }
    let mut v = inserted.to_vec();
    for (k, p) in pos.into_iter().enumerate() {
        if ec[k] != oc[k] {
            v[p] = edited[k].clone();
        }
    }
    Some(v)
}

/// Merge whole docs (page properties too).
pub fn merge_docs(base: &Doc, mine: &Doc, theirs: &Doc) -> Option<Doc> {
    let preamble = if mine.preamble == base.preamble {
        theirs.preamble.clone()
    } else if theirs.preamble == base.preamble || theirs.preamble == mine.preamble {
        mine.preamble.clone()
    } else {
        return None;
    };
    let blocks = merge_blocks(&base.blocks, &mine.blocks, &theirs.blocks)?;
    Some(Doc { preamble, blocks, indent: theirs.indent.clone(), crlf: theirs.crlf })
}

/// One stretch of a page that was changed in two places: notes that need no choice (both
/// agree, or only one side changed them, combined as `merge_blocks` does), or a clash, where both
/// changed the same notes differently. The clash screen shows the clashes side by side.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Part {
    Same { blocks: Vec<DocBlock> },
    Clash { base: Vec<DocBlock>, mine: Vec<DocBlock>, theirs: Vec<DocBlock> },
}

/// The whole page as parts, in order: what needs no choice (as `merge_blocks` combines it), and each
/// stretch both changed in ways that can't be combined, whole. None when the page is too big to
/// compare.
pub fn clash_parts(base: &[DocBlock], mine: &[DocBlock], theirs: &[DocBlock]) -> Option<Vec<Part>> {
    let (o, a, b) = (keys(base), keys(mine), keys(theirs));
    let ma = lcs(&o, &a)?;
    let mb = lcs(&o, &b)?;
    let mut in_a = vec![None; o.len()];
    for (oi, ai) in ma {
        in_a[oi] = Some(ai);
    }
    let mut in_b = vec![None; o.len()];
    for (oi, bi) in mb {
        in_b[oi] = Some(bi);
    }
    let mut parts: Vec<Part> = vec![];
    let same = |parts: &mut Vec<Part>, v: Vec<DocBlock>| {
        if v.is_empty() {
            return;
        }
        if let Some(Part::Same { blocks }) = parts.last_mut() {
            blocks.extend(v);
        } else {
            parts.push(Part::Same { blocks: v });
        }
    };
    // the page's texts before, for both_added (None when both took a note away from its place)
    let was: HashSet<&str> = o.iter().map(|k| k.1).collect();
    let was = (0..o.len()).all(|i| in_a[i].is_some() || in_b[i].is_some()).then_some(&was);
    // the stretch from (po, pa, pb) up to (oe, ae, be), the note both have there (if any) right after
    let chunk = |parts: &mut Vec<Part>, (po, pa, pb): (usize, usize, usize), (oe, ae, be): (usize, usize, usize)| {
        let next = o.get(oe).map(|k| k.0);
        match stretch(&o[po..oe], &a[pa..ae], &b[pb..be], &mine[pa..ae], &theirs[pb..be], was, next) {
            Some(v) => same(parts, v),
            None => parts.push(Part::Clash { base: base[po..oe].to_vec(), mine: mine[pa..ae].to_vec(), theirs: theirs[pb..be].to_vec() }),
        }
    };
    let mut at = (0, 0, 0);
    for oi in 0..o.len() {
        let (Some(ai), Some(bi)) = (in_a[oi], in_b[oi]) else { continue };
        if ai < at.1 || bi < at.2 {
            continue;
        }
        chunk(&mut parts, at, (oi, ai, bi));
        same(&mut parts, vec![theirs[bi].clone()]);
        at = (oi + 1, ai + 1, bi + 1);
    }
    chunk(&mut parts, at, (o.len(), a.len(), b.len()));
    Some(parts)
}
