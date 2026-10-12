//! Minimal, lossless XML DOM for OOXML parts.
//!
//! OOXML is plain XML (no DTDs, no external entities), so a small parser is
//! enough and lets us keep everything we do not understand verbatim: element
//! names stay as written (`w:p`), attributes keep their order, and comments,
//! CDATA and processing instructions survive a parse → serialize cycle.

use std::fmt::Write as _;

#[derive(Debug, Clone, PartialEq)]
pub enum XNode {
    Element(XElement),
    Text(String),
    /// Comments, CDATA sections and processing instructions, kept verbatim.
    Raw(String),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct XElement {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<XNode>,
}

#[derive(Debug, Clone)]
pub struct XmlError(pub String);

impl std::fmt::Display for XmlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "xml: {}", self.0)
    }
}

/// A parsed part: the prolog (`<?xml …?>` and anything before the root) and the root.
#[derive(Debug, Clone)]
pub struct XDocument {
    pub prolog: String,
    pub root: XElement,
}

impl XDocument {
    pub fn parse(src: &str) -> Result<Self, XmlError> {
        let src = src.strip_prefix('\u{feff}').unwrap_or(src);
        let mut p = Parser { s: src.as_bytes(), src, i: 0 };
        let mut prolog = String::new();
        loop {
            p.skip_ws_into(&mut prolog);
            if p.starts_with("<?") || p.starts_with("<!--") || p.starts_with("<!DOCTYPE") {
                let start = p.i;
                p.skip_special()?;
                prolog.push_str(&src[start..p.i]);
            } else {
                break;
            }
        }
        let root = p.element()?;
        Ok(XDocument { prolog, root })
    }

    pub fn to_string(&self) -> String {
        let mut out = String::with_capacity(4096);
        if self.prolog.trim().is_empty() {
            out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
        } else {
            out.push_str(&self.prolog);
        }
        self.root.write(&mut out);
        out
    }
}

/// Parse a fragment that holds one or more sibling elements (raw attrs we stored).
pub fn parse_fragment(src: &str) -> Result<Vec<XNode>, XmlError> {
    let wrapped = format!("<oel-frag>{src}</oel-frag>");
    let mut p = Parser { s: wrapped.as_bytes(), src: &wrapped, i: 0 };
    let root = p.element()?;
    Ok(root.children)
}

struct Parser<'a> {
    s: &'a [u8],
    src: &'a str,
    i: usize,
}

impl<'a> Parser<'a> {
    fn starts_with(&self, pat: &str) -> bool {
        self.s[self.i..].starts_with(pat.as_bytes())
    }

    fn err<T>(&self, msg: &str) -> Result<T, XmlError> {
        Err(XmlError(format!("{msg} at byte {}", self.i)))
    }

    fn skip_ws_into(&mut self, out: &mut String) {
        let start = self.i;
        while self.i < self.s.len() && self.s[self.i].is_ascii_whitespace() {
            self.i += 1;
        }
        out.push_str(&self.src[start..self.i]);
    }

    fn skip_ws(&mut self) {
        while self.i < self.s.len() && self.s[self.i].is_ascii_whitespace() {
            self.i += 1;
        }
    }

    /// Skip `<?…?>`, `<!--…-->`, `<![CDATA[…]]>` or `<!DOCTYPE…>`.
    fn skip_special(&mut self) -> Result<(), XmlError> {
        let end = if self.starts_with("<?") {
            "?>"
        } else if self.starts_with("<!--") {
            "-->"
        } else if self.starts_with("<![CDATA[") {
            "]]>"
        } else {
            ">"
        };
        match find(&self.s[self.i..], end.as_bytes()) {
            Some(off) => {
                self.i += off + end.len();
                Ok(())
            }
            None => self.err("unterminated markup"),
        }
    }

    fn name(&mut self) -> Result<String, XmlError> {
        let start = self.i;
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if c.is_ascii_whitespace() || c == b'>' || c == b'/' || c == b'=' {
                break;
            }
            self.i += 1;
        }
        if start == self.i {
            return self.err("expected a name");
        }
        Ok(self.src[start..self.i].to_string())
    }

    fn element(&mut self) -> Result<XElement, XmlError> {
        if !self.starts_with("<") {
            return self.err("expected '<'");
        }
        self.i += 1;
        let name = self.name()?;
        let mut el = XElement { name, attrs: Vec::new(), children: Vec::new() };
        loop {
            self.skip_ws();
            if self.starts_with("/>") {
                self.i += 2;
                return Ok(el);
            }
            if self.starts_with(">") {
                self.i += 1;
                break;
            }
            let key = self.name()?;
            self.skip_ws();
            if !self.starts_with("=") {
                return self.err("expected '='");
            }
            self.i += 1;
            self.skip_ws();
            let q = self.s.get(self.i).copied();
            if q != Some(b'"') && q != Some(b'\'') {
                return self.err("expected a quote");
            }
            self.i += 1;
            let start = self.i;
            while self.i < self.s.len() && Some(self.s[self.i]) != q {
                self.i += 1;
            }
            let val = unescape(&self.src[start..self.i]);
            self.i += 1;
            el.attrs.push((key, val));
        }
        // Children
        loop {
            if self.i >= self.s.len() {
                return self.err("unexpected end of input");
            }
            if self.starts_with("</") {
                self.i += 2;
                let close = self.name()?;
                if close != el.name {
                    return self.err(&format!("mismatched </{close}> for <{}>", el.name));
                }
                self.skip_ws();
                self.i += 1; // '>'
                return Ok(el);
            }
            if self.starts_with("<!--") || self.starts_with("<?") || self.starts_with("<![CDATA[") {
                let start = self.i;
                self.skip_special()?;
                let raw = &self.src[start..self.i];
                if let Some(inner) = raw.strip_prefix("<![CDATA[").and_then(|r| r.strip_suffix("]]>")) {
                    el.children.push(XNode::Text(inner.to_string()));
                } else {
                    el.children.push(XNode::Raw(raw.to_string()));
                }
                continue;
            }
            if self.starts_with("<") {
                let child = self.element()?;
                el.children.push(XNode::Element(child));
                continue;
            }
            let start = self.i;
            while self.i < self.s.len() && self.s[self.i] != b'<' {
                self.i += 1;
            }
            el.children.push(XNode::Text(unescape(&self.src[start..self.i])));
        }
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

pub fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        rest = &rest[pos..];
        let Some(end) = rest.find(';') else {
            out.push_str(rest);
            return out;
        };
        let ent = &rest[1..end];
        let ch = match ent {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn escape_text(s: &str, out: &mut String) {
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            // Characters XML 1.0 forbids (Word sometimes has them in pasted text).
            c if (c as u32) < 0x20 && c != '\t' && c != '\n' && c != '\r' => {}
            c => out.push(c),
        }
    }
}

pub fn escape_attr(s: &str, out: &mut String) {
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str("&#10;"),
            '\t' => out.push_str("&#9;"),
            c if (c as u32) < 0x20 && c != '\r' => {}
            c => out.push(c),
        }
    }
}

impl XElement {
    pub fn new(name: &str) -> Self {
        XElement { name: name.to_string(), attrs: Vec::new(), children: Vec::new() }
    }

    pub fn with_attr(mut self, k: &str, v: impl Into<String>) -> Self {
        self.set_attr(k, v);
        self
    }

    pub fn with_child(mut self, c: XElement) -> Self {
        self.children.push(XNode::Element(c));
        self
    }

    pub fn attr(&self, key: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    pub fn set_attr(&mut self, key: &str, val: impl Into<String>) {
        let val = val.into();
        if let Some(slot) = self.attrs.iter_mut().find(|(k, _)| k == key) {
            slot.1 = val;
        } else {
            self.attrs.push((key.to_string(), val));
        }
    }

    pub fn remove_attr(&mut self, key: &str) {
        self.attrs.retain(|(k, _)| k != key);
    }

    /// Local name without the namespace prefix (`w:p` → `p`).
    pub fn local(&self) -> &str {
        local(&self.name)
    }

    pub fn elements(&self) -> impl Iterator<Item = &XElement> {
        self.children.iter().filter_map(|c| match c {
            XNode::Element(e) => Some(e),
            _ => None,
        })
    }

    pub fn elements_mut(&mut self) -> impl Iterator<Item = &mut XElement> {
        self.children.iter_mut().filter_map(|c| match c {
            XNode::Element(e) => Some(e),
            _ => None,
        })
    }

    pub fn child(&self, name: &str) -> Option<&XElement> {
        self.elements().find(|e| e.name == name)
    }

    pub fn child_mut(&mut self, name: &str) -> Option<&mut XElement> {
        self.elements_mut().find(|e| e.name == name)
    }

    /// First child with this local name, whatever its prefix (`x:row` and `row`).
    pub fn child_local(&self, local_name: &str) -> Option<&XElement> {
        self.elements().find(|e| e.local() == local_name)
    }

    pub fn child_local_mut(&mut self, local_name: &str) -> Option<&mut XElement> {
        self.elements_mut().find(|e| e.local() == local_name)
    }

    pub fn children_local<'a>(&'a self, local_name: &'a str) -> impl Iterator<Item = &'a XElement> + 'a {
        self.elements().filter(move |e| e.local() == local_name)
    }

    /// The namespace prefix of this element's name (`x:worksheet` → `Some("x")`).
    pub fn prefix(&self) -> Option<&str> {
        self.name.split_once(':').map(|(p, _)| p)
    }

    /// Give every unprefixed element in this subtree a prefix, so elements we
    /// build fit a part written with a prefixed default namespace.
    pub fn apply_prefix(&mut self, prefix: Option<&str>) {
        let Some(p) = prefix else { return };
        if !self.name.contains(':') {
            self.name = format!("{p}:{}", self.name);
        }
        for e in self.elements_mut() {
            e.apply_prefix(Some(p));
        }
    }

    pub fn remove_children(&mut self, name: &str) {
        self.children.retain(|c| !matches!(c, XNode::Element(e) if e.name == name));
    }

    /// Value of `w:val` on a child element (`<w:jc w:val="center"/>`).
    pub fn child_val(&self, name: &str) -> Option<&str> {
        self.child(name).and_then(|c| c.attr("w:val"))
    }

    /// Depth-first search for the first descendant with this name.
    pub fn find(&self, name: &str) -> Option<&XElement> {
        for e in self.elements() {
            if e.name == name {
                return Some(e);
            }
            if let Some(found) = e.find(name) {
                return Some(found);
            }
        }
        None
    }

    /// Depth-first search for the first descendant with this local name, whatever its prefix.
    pub fn find_local(&self, local_name: &str) -> Option<&XElement> {
        for e in self.elements() {
            if e.local() == local_name {
                return Some(e);
            }
            if let Some(found) = e.find_local(local_name) {
                return Some(found);
            }
        }
        None
    }

    pub fn find_mut(&mut self, name: &str) -> Option<&mut XElement> {
        for e in self.elements_mut() {
            if e.name == name {
                return Some(e);
            }
            if let Some(found) = e.find_mut(name) {
                return Some(found);
            }
        }
        None
    }

    pub fn text_content(&self) -> String {
        let mut s = String::new();
        self.collect_text(&mut s);
        s
    }

    fn collect_text(&self, out: &mut String) {
        for c in &self.children {
            match c {
                XNode::Text(t) => out.push_str(t),
                XNode::Element(e) => e.collect_text(out),
                XNode::Raw(_) => {}
            }
        }
    }

    pub fn write(&self, out: &mut String) {
        out.push('<');
        out.push_str(&self.name);
        for (k, v) in &self.attrs {
            out.push(' ');
            out.push_str(k);
            out.push_str("=\"");
            escape_attr(v, out);
            out.push('"');
        }
        if self.children.is_empty() {
            out.push_str("/>");
            return;
        }
        out.push('>');
        for c in &self.children {
            write_node(c, out);
        }
        out.push_str("</");
        out.push_str(&self.name);
        out.push('>');
    }

    pub fn to_xml(&self) -> String {
        let mut s = String::new();
        self.write(&mut s);
        s
    }

    /// Start tag only (`<w:document xmlns:w="…">`), used to rebuild a part around new content.
    pub fn open_tag(&self) -> String {
        let mut out = String::new();
        let _ = write!(out, "<{}", self.name);
        for (k, v) in &self.attrs {
            out.push(' ');
            out.push_str(k);
            out.push_str("=\"");
            escape_attr(v, &mut out);
            out.push('"');
        }
        out.push('>');
        out
    }
}

pub fn write_node(n: &XNode, out: &mut String) {
    match n {
        XNode::Element(e) => e.write(out),
        XNode::Text(t) => escape_text(t, out),
        XNode::Raw(r) => out.push_str(r),
    }
}

pub fn nodes_to_xml(nodes: &[XNode]) -> String {
    let mut s = String::new();
    for n in nodes {
        write_node(n, &mut s);
    }
    s
}

pub fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_markup() {
        let src = "<?xml version=\"1.0\"?>\n<w:p a=\"1\" b='x &amp; y'><w:r><w:t xml:space=\"preserve\"> a &lt; b </w:t></w:r><!-- c --><w:x/></w:p>";
        let doc = XDocument::parse(src).unwrap();
        assert_eq!(doc.root.attr("b"), Some("x & y"));
        assert_eq!(doc.root.find("w:t").unwrap().text_content(), " a < b ");
        let out = doc.to_string();
        assert!(out.contains("<!-- c -->"));
        assert!(out.contains("b=\"x &amp; y\""));
        assert_eq!(XDocument::parse(&out).unwrap().root, doc.root);
    }

    #[test]
    fn fragments() {
        let nodes = parse_fragment("<w:b/><w:sz w:val=\"24\"/>").unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes_to_xml(&nodes), "<w:b/><w:sz w:val=\"24\"/>");
    }
}
