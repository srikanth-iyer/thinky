use outline_core::*;

const REAL: &str = "seed-list:: 42\ntags:: [[garden]]\n\n- Water the beans at dusk\n  row-id:: 1a2b3c4d\n      \n    ~\n    \n      from the seed packet,\n- [[Garden/bean rows 2024]]\n\t- three rows of beans\n\t- ```python\n\t  - not a bullet\n\t  ```\n\t\t- deep\n\t\t  id:: 0f1e2d3c\n-\n### heading outside\n";

#[test]
fn roundtrip_untouched_is_identical() {
    for s in [REAL, "", "- a", "- a\n", "x\n- a\r\n\t- b\r\n", "title:: T\n\n\n- a\n\n\n- b\n"] {
        let d = split_doc(s);
        assert_eq!(join_doc(&d), s, "roundtrip failed for {s:?}");
    }
}

#[test]
fn structure() {
    let d = split_doc(REAL);
    assert_eq!(d.preamble, "seed-list:: 42\ntags:: [[garden]]\n\n");
    assert_eq!(d.indent, "\t");
    let texts: Vec<(usize, &str)> = d.blocks.iter().map(|b| (b.depth, b.text.as_str())).collect();
    assert_eq!(texts[0].0, 0);
    assert!(texts[0].1.starts_with("Water the beans at dusk\nrow-id:: 1a2b3c4d"));
    assert_eq!(texts[2], (1, "three rows of beans"));
    assert_eq!(texts[3], (1, "```python\n- not a bullet\n```"));
    assert_eq!(texts[4], (2, "deep\nid:: 0f1e2d3c"));
    assert_eq!(texts[5], (0, "\n### heading outside"));
}

#[test]
fn edits_only_touch_changed_blocks() {
    let mut d = split_doc(REAL);
    d.blocks[2].text = "two rows of peas".into();
    d.blocks[4].depth = 1;
    d.blocks.push(DocBlock { depth: 0, text: "new [[thing]]\nstatus:: todo".into(), raw: None, plain: false });
    let out = join_doc(&d);
    assert!(out.contains("\t- two rows of peas\n"));
    assert!(out.contains("\t- deep\n\t  id:: 0f1e2d3c\n"));
    assert!(out.ends_with("- new [[thing]]\n  status:: todo\n"));
    // untouched blocks still verbatim
    assert!(out.contains("  row-id:: 1a2b3c4d\n      \n    ~\n"));
    assert!(out.starts_with("seed-list:: 42\n"));
}

#[test]
fn spaces_indent_and_crlf_preserved_on_edit() {
    let s = "- a\r\n  - b\r\n";
    let mut d = split_doc(s);
    assert_eq!(d.indent, "  ");
    assert!(d.crlf);
    d.blocks.push(DocBlock { depth: 1, text: "c".into(), raw: None, plain: false });
    assert_eq!(join_doc(&d), "- a\r\n  - b\r\n  - c\r\n");
}

#[test]
fn hash_detects_change() {
    assert_eq!(content_hash("abc"), content_hash("abc"));
    assert_ne!(content_hash("abc"), content_hash("abd"));
}

/// Shapes of eight unusual files (made up, in the shapes other apps write).
#[test]
fn notes_written_outside_logseq() {
    let cases = [
        "```ShoppingList\n/\t\t\t\n```",
        "https://example.com/recipes/",
        "Good morning, notebook",
        "[[Bread flours]]",
        "* **Garden**\n\t* [ ] buy seeds\n\t* https://example.com/wiki/Seeds_(spring)\n\t\t* <div style=\"x\"></div",
        "[[Shopping]] \nOnions from the stall.\n\nThe stall opens at eight.\nSecond line\n\n\nLast paragraph",
    ];
    for s in cases {
        let d = split_doc(s);
        assert_eq!(join_doc(&d), s, "roundtrip {s:?}");
        assert!(!d.blocks.is_empty(), "content must be visible as blocks: {s:?}");
    }
    // paragraphs become separate blocks; '*' bullets keep their depth
    let d = split_doc(cases[5]);
    let t: Vec<&str> = d.blocks.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(t, vec!["[[Shopping]] \nOnions from the stall.", "The stall opens at eight.\nSecond line", "Last paragraph"]);
    assert!(d.blocks.iter().all(|b| b.plain && b.depth == 0));
    let d = split_doc(cases[4]);
    let shape: Vec<(usize, bool)> = d.blocks.iter().map(|b| (b.depth, b.plain)).collect();
    assert_eq!(shape, vec![(0, false), (1, false), (1, false), (2, false)]);
    assert_eq!(d.blocks[1].text, "[ ] buy seeds");
}

#[test]
fn editing_a_paragraph_turns_the_rest_into_bullets() {
    let s = "tags:: x\n\nPara one\n\nPara two\n- a bullet\n";
    let mut d = split_doc(s);
    assert_eq!(d.preamble, "tags:: x\n\n");
    assert_eq!(d.blocks.len(), 3);
    // untouched: identical
    assert_eq!(join_doc(&d), s);
    // edit the first paragraph: it and every later paragraph must become bullets,
    // otherwise "Para two" would read as a continuation line of the new bullet
    d.blocks[0].text = "Para one, edited".into();
    assert_eq!(join_doc(&d), "tags:: x\n\n- Para one, edited\n- Para two\n- a bullet\n");
    // edit only the second paragraph: the first stays a verbatim paragraph
    let mut d = split_doc(s);
    d.blocks[1].text = "Para two, edited".into();
    assert_eq!(join_doc(&d), "tags:: x\n\nPara one\n\n- Para two, edited\n- a bullet\n");
}

#[test]
fn parse_agrees_with_split() {
    let s = "tags:: x\nPara with [[A]]\n\nSecond para [[B]]\n* star bullet [[C]]\n\tkey:: [[D]]\n- dash";
    let p = parse_page(s, &[]);
    let texts: Vec<&str> = p.blocks.iter().map(|b| b.text.as_str()).collect();
    // block text is the editable text, property lines included
    assert_eq!(texts, vec!["Para with [[A]]", "Second para [[B]]", "star bullet [[C]]\nkey:: [[D]]", "dash"]);
    assert_eq!(p.blocks[2].refs, vec!["C".to_string(), "D".to_string()]);
    assert_eq!(p.blocks.iter().map(|b| b.line).collect::<Vec<_>>(), vec![1, 3, 4, 6]);
    assert_eq!(p.blocks[2].props, vec![("key".to_string(), "[[D]]".to_string())]);
    assert_eq!(p.tags, vec!["x"]);
}

#[test]
fn yaml_front_matter_is_page_properties() {
    let s = "---\nalias: Brine strength test, Pickle trials\ntags: [baking, \"sourdough bread\"]\naliases:\n  - PKL\n  - \"Quick pickles\"\ntitle: Not a rename\n---\n- ## Outline\n\t- related to [[apron/briny sourdough bread recipe]]\n";
    let d = split_doc(s);
    assert!(d.preamble.starts_with("---\n") && d.preamble.ends_with("---\n"));
    assert_eq!(d.blocks.len(), 2);
    assert_eq!(join_doc(&d), s);
    let p = parse_page(s, &[]);
    assert_eq!(p.aliases, vec!["Brine strength test", "Pickle trials", "PKL", "Quick pickles"]);
    assert_eq!(p.tags, vec!["baking", "sourdough bread"]);
    assert_eq!(p.title, None);
    // a horizontal rule that is not front matter stays content
    let hr = "---\nJust a paragraph after a rule\n\nmore";
    let d = split_doc(hr);
    assert_eq!(d.preamble, "");
    assert_eq!(join_doc(&d), hr);
}

#[test]
fn unclosed_code_fence_ends_at_the_next_bullet() {
    // typing ``` and pausing must not swallow the rest of the page
    let s = "- first ```\n- second\n\t- child\n\t\t- grandchild\n- third\n";
    let d = split_doc(s);
    assert_eq!(d.blocks.iter().map(|b| b.depth).collect::<Vec<_>>(), vec![0, 0, 1, 2, 0]);
    assert_eq!(join_doc(&d), s);
    // a real code block inside a bullet keeps list-looking lines as code
    let s = "- code:\n  ```\n  - not a bullet\n  ```\n- next\n";
    let d = split_doc(s);
    assert_eq!(d.blocks.len(), 2);
    assert_eq!(d.blocks[0].text, "code:\n```\n- not a bullet\n```");
}

#[test]
fn deeper_indentation_inside_a_block_is_kept() {
    // Obsidian-style tab-indented code under a bullet
    let s = "* setup script\n\t```python\n\tdef f():\n\t\treturn 1\n\t```\n";
    let mut d = split_doc(s);
    assert_eq!(d.blocks[0].text, "setup script\n```python\ndef f():\n\treturn 1\n```");
    d.blocks[0].text = d.blocks[0].text.replace("setup", "Setup");
    let out = join_doc(&d);
    assert_eq!(out, "- Setup script\n  ```python\n  def f():\n  \treturn 1\n  ```\n");
    assert_eq!(split_doc(&out).blocks[0].text, d.blocks[0].text);
}

#[test]
fn bullets_between_rules_are_not_front_matter() {
    let s = "---\n- a\n- b\n---\nafter\n";
    let d = split_doc(s);
    assert_eq!(d.preamble, "");
    assert_eq!(join_doc(&d), s);
    let s = "---\naliases:\n- x\n- y\n---\n- body\n";
    assert_eq!(split_doc(s).preamble, "---\naliases:\n- x\n- y\n---\n");
}

#[test]
fn logseq_file_names() {
    for (name, stem) in [
        ("a/b", "a___b"),
        ("Why?", "Why%3F"),
        ("a:b", "a%3Ab"),
        ("hydration__/x", "hydration_%5F___x"),
        ("CON", "CON___"),
        ("con", "con___"),
        ("Nul", "Nul___"),
        ("com1", "com1___"),
        (".hidden", "%2Ehidden"),
        ("100% sure", "100% sure"),
        ("%2F", "%252F"),
        ("#tag page", "%23tag page"),
        ("a___b", "a%5F%5F%5Fb"),
        ("Héla Barton", "Héla Barton"),
    ] {
        assert_eq!(file_stem_for(name), stem, "{name}");
        // and it reads back as the same name
        let v = Vault::new();
        if !["CON", "con", "Nul", "com1"].contains(&name) {
            assert_eq!(v.title_from_path(&format!("pages/{stem}.md")).0, name, "{name}");
        }
    }
}
