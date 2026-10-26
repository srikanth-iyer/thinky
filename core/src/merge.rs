//! Three-way merge of a page's blocks, for when the file changed on disk (phone, widget,
//! Claude) while it was being edited here. Changes in different places are combined;
//! changes to the same place give up, and the user chooses.

use crate::doc::{Doc, DocBlock};

type Key<'a> = (usize, &'a str);

fn keys(b: &[DocBlock]) -> Vec<Key<'_>> {
    b.iter().map(|x| (x.depth, x.text.as_str())).collect()
}

/// Matched index pairs of a longest common subsequence, in order. None if too big to diff.
fn lcs(a: &[Key], b: &[Key]) -> Option<Vec<(usize, usize)>> {
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
    let mut out: Vec<DocBlock> = vec![];
    let (mut po, mut pa, mut pb) = (0, 0, 0);
    let chunk = |out: &mut Vec<DocBlock>, oe: usize, ae: usize, be: usize, po: usize, pa: usize, pb: usize| -> bool {
        let (oc, ac, bc) = (&o[po..oe], &a[pa..ae], &b[pb..be]);
        if ac == oc {
            out.extend_from_slice(&theirs[pb..be]);
        } else if bc == oc || ac == bc {
            out.extend_from_slice(&mine[pa..ae]);
        } else if let Some(v) = edits_and_insertions(oc, ac, &mine[pa..ae], bc, &theirs[pb..be]) {
            out.extend(v);
        } else if let Some(v) = edits_and_insertions(oc, bc, &theirs[pb..be], ac, &mine[pa..ae]) {
            out.extend(v);
        } else {
            return false;
        }
        true
    };
    for oi in 0..o.len() {
        let (Some(ai), Some(bi)) = (in_a[oi], in_b[oi]) else { continue };
        if ai < pa || bi < pb {
            continue;
        }
        if !chunk(&mut out, oi, ai, bi, po, pa, pb) {
            return None;
        }
        out.push(theirs[bi].clone());
        po = oi + 1;
        pa = ai + 1;
        pb = bi + 1;
    }
    if !chunk(&mut out, o.len(), a.len(), b.len(), po, pa, pb) {
        return None;
    }
    Some(out)
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
