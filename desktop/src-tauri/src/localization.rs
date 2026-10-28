//! Presentation resources only. Project identities, journals and error codes stay unchanged.
use std::{collections::BTreeMap, sync::{OnceLock, atomic::{AtomicBool, Ordering}}};
static ENGLISH: AtomicBool = AtomicBool::new(false);
#[derive(Clone)]
enum Part { Literal(String), Variable(String) }
struct Message { key: String, chinese: Vec<Part>, english: Vec<Part>, recursive: Vec<String>, weight: usize }
struct Catalog { messages: Vec<Message> }
fn parts(input: &str) -> Vec<Part> {
    let mut result = Vec::new(); let mut rest = input;
    while let Some(start) = rest.find("{arg") {
        let Some(end) = rest[start..].find('}').map(|end| start + end) else { break; };
        result.push(Part::Literal(rest[..start].into()));
        result.push(Part::Variable(rest[start + 1..end].into())); rest = &rest[end + 1..];
    }
    result.push(Part::Literal(rest.into())); result
}
fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let zh: BTreeMap<String,String> = serde_json::from_str(include_str!("../../src/locales/zh-CN/native.json")).expect("valid Chinese native catalog");
        let en: BTreeMap<String,String> = serde_json::from_str(include_str!("../../src/locales/en-US/native.json")).expect("valid English native catalog");
        let parameters: BTreeMap<String,Vec<String>> = serde_json::from_str(include_str!("../../src/locales/native-parameters.json")).expect("valid native parameter catalog");
        let mut messages: Vec<_> = zh.into_iter().map(|(key,value)| {
            let chinese = parts(&value); let weight = chinese.iter().map(|part| match part { Part::Literal(value) => value.len(), _ => 0 }).sum();
            Message { english: parts(en.get(&key).expect("native key parity")), recursive: parameters.get(&key).cloned().unwrap_or_default(), key, chinese, weight }
        }).collect();
        messages.sort_by_key(|message| std::cmp::Reverse(message.weight)); Catalog { messages }
    })
}
fn render(parts: &[Part], values: &BTreeMap<String,String>) -> String {
    parts.iter().map(|part| match part { Part::Literal(text) => text.clone(), Part::Variable(name) => values.get(name).cloned().unwrap_or_else(|| format!("{{{name}}}")) }).collect()
}
fn capture(parts: &[Part], input: &str) -> Option<BTreeMap<String,String>> {
    let mut remaining = input; let mut values = BTreeMap::new();
    for (index,part) in parts.iter().enumerate() {
        match part {
            Part::Literal(literal) => { remaining = remaining.strip_prefix(literal)?; },
            Part::Variable(name) => {
                let following = match parts.get(index + 1) { Some(Part::Literal(value)) => value.as_str(), _ => "" };
                let end = if following.is_empty() { remaining.len() } else { remaining.find(following)? };
                values.insert(name.clone(), remaining[..end].into()); remaining = &remaining[end..];
            }
        }
    }
    remaining.is_empty().then_some(values)
}
pub(crate) fn set_language(language: &str) { ENGLISH.store(language == "en-US", Ordering::SeqCst); }
pub(crate) fn tr(key: &str, arguments: &[&str]) -> String { tr_for(key, arguments, ENGLISH.load(Ordering::SeqCst)) }
fn tr_for(key: &str, arguments: &[&str], english: bool) -> String {
    let Some(message) = catalog().messages.iter().find(|message| message.key == key) else { return key.into(); };
    let values = arguments.iter().enumerate().map(|(index,value)| (format!("arg{index}"), (*value).to_string())).collect();
    render(if english { &message.english } else { &message.chinese }, &values)
}
pub(crate) fn text(input: &str) -> String { text_for(input, ENGLISH.load(Ordering::SeqCst), 0) }
fn text_for(input: &str, english: bool, depth: usize) -> String {
    if !english || depth > 4 { return input.into(); }
    for message in &catalog().messages {
        if let Some(mut values) = capture(&message.chinese, input) {
            for name in &message.recursive { if let Some(value) = values.get_mut(name) { *value = text_for(value, english, depth + 1); } }
            return render(&message.english, &values);
        }
    }
    input.into()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_catalogs_have_matching_keys_and_parameters() {
        let zh: BTreeMap<String,String> = serde_json::from_str(include_str!("../../src/locales/zh-CN/native.json")).unwrap();
        let en: BTreeMap<String,String> = serde_json::from_str(include_str!("../../src/locales/en-US/native.json")).unwrap();
        assert_eq!(zh.keys().collect::<Vec<_>>(), en.keys().collect::<Vec<_>>());
        for message in &catalog().messages {
            let names = |parts: &[Part]| parts.iter().filter_map(|part| if let Part::Variable(name) = part {Some(name.clone())} else {None}).collect::<std::collections::BTreeSet<_>>();
            assert_eq!(names(&message.chinese), names(&message.english), "{}", message.key);
        }
    }
    #[test]
    fn translates_nested_errors_and_preserves_paths_and_unknown_details() {
        let path = "/论文/实验结果.tex";
        let input = format!("{path} 在审核期间已被修改或无法验证。Texgo 未修改引用文件，请重新扫描引用。");
        let output = text_for(&input, true, 0);
        assert!(output.contains(path)); assert!(output.contains("Texgo did not edit"));
        assert_eq!(text_for(&input, false, 0), input);
        assert_eq!(text_for("unknown OS failure", true, 0), "unknown OS failure");
        assert!(text_for("后台任务失败：工作区状态不可用", true, 0).contains("Workspace state is unavailable"));
    }
}
