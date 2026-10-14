//! Port of `src/llm/extract.ts`. STUB: signatures, constants, and prompts are final; bodies are `todo!()`.
//! Tests to port: `src/llm/extract.test.ts`, the aboutLines half of `src/contract/org.test.ts` (below).
#![allow(unused_variables, unused_imports, dead_code)]

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use serde_json::Value;

use super::openrouter::LlmClient;
use crate::contract::types::{CodeFile, Domain, FeatureCard, NodeType, Org};
use crate::db::store::{GraphUpdate, StoredNode};

/// The page as visible text; the screenshot goes to the embedder, not the extractor.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureInput {
    pub url: String,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CodeInput {
    pub repo: String,
    pub commit_sha: String,
    pub files: Vec<CodeFile>,
    pub cards: Option<Vec<FeatureCard>>,
}

/// `Pick<StoredNode, "id" | "label" | "type" | "domain">`
#[derive(Debug, Clone, PartialEq)]
pub struct KnownNode {
    pub id: String,
    pub label: String,
    pub node_type: NodeType,
    pub domain: Domain,
}

impl From<&StoredNode> for KnownNode {
    fn from(n: &StoredNode) -> Self {
        KnownNode { id: n.id.clone(), label: n.label.clone(), node_type: n.node_type, domain: n.domain }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Author {
    pub name: String,
    pub role: String,
}

/// Who the org is and who sent the document, so the model can tell this org's work from everything else.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ExtractContext {
    pub org: Option<Org>,
    pub author: Option<Author>,
}

#[async_trait]
pub trait Extractor: Send + Sync {
    async fn from_capture(&self, input: &CaptureInput, known: &[KnownNode], about: Option<&ExtractContext>) -> Result<GraphUpdate>;
    async fn from_code(&self, input: &CodeInput, known: &[KnownNode], about: Option<&ExtractContext>) -> Result<GraphUpdate>;
}

pub const MAX_CAPTURE_NODES: usize = 8;
pub const MAX_CODE_NODES: usize = 8;
pub const MAX_KNOWN_IN_PROMPT: usize = 200;
pub const CODE_TYPES: [NodeType; 5] = [NodeType::Feature, NodeType::Task, NodeType::Milestone, NodeType::Decision, NodeType::Risk];

pub const EXTRACT_PROMPT: &str = "You read the visible text of a page someone in an organization had open. Output the few things a teammate would need to know changed: projects, campaigns, budgets, deals, owners, dates, statuses, decisions.
Use the organization profile, when given, to judge what is this organization's work and to name things the way it does. A page on one of its websites is usually work. Personal pages (personal email, shopping, social media, news, school) and anything unrelated to the organization return empty lists.
Never invent values. Skip navigation, menus, and ads. At most 8 nodes.
When something on the page is already in the known nodes list, reuse that label exactly so it updates instead of duplicating. Add edges only when the page shows the relationship.
Write in plain sentences. Never use em dashes or exclamation marks.
Answer with JSON matching the schema. If nothing useful is on the page, return empty lists.";

pub const CODE_PROMPT: &str = "You read a code change and write feature cards that anyone on the team, including sales, can understand and repeat.
For each meaningful change: a label, a plain-language summary of what a customer or teammate gets (not how the code works), status, release, and sellable.
release is shipped, in_beta, or in_progress. sellable is true only when release is shipped or in_beta. Skip refactors, tests, and tooling unless they change what users get. At most 8 cards.
Reuse a known label exactly when the change extends an existing feature. Add edges for what blocks or feeds what.
When the author wrote feature cards for the change, keep their labels, summaries, and release status unless the diff contradicts them, and add anything they missed.
Write in plain sentences. Never use em dashes or exclamation marks.
Answer with JSON matching the schema. If nothing user facing changed, return empty lists.";

/// The `build_update` strict JSON schema (nodes with every NodeProp, edges).
pub fn build_update_schema() -> Value {
    todo!("port BUILD_UPDATE_SCHEMA from src/llm/extract.ts")
}

/// The `feature_cards` strict JSON schema (code node props without domain, plus release and sellable).
pub fn feature_cards_schema() -> Value {
    todo!("port FEATURE_CARDS_SCHEMA from src/llm/extract.ts")
}

/// True when the URL's host is one of `sites` or a subdomain of one.
pub fn host_in(url: &str, sites: &[String]) -> bool {
    todo!("port hostIn from src/llm/extract.ts")
}

/// The domain a role's own words point to, by whichever keyword appears first. None if none.
pub fn domain_for_role(role: Option<&str>) -> Option<Domain> {
    todo!("port domainForRole from src/llm/extract.ts")
}

/// The org profile and author, as the first lines of the model's input. Empty when nothing is known.
pub fn about_lines(about: Option<&ExtractContext>, url: Option<&str>) -> String {
    todo!("port aboutLines from src/llm/extract.ts")
}

/// The author's cards as text for the model and for the stored source.
pub fn card_lines(cards: Option<&[FeatureCard]>) -> String {
    todo!("port cardLines from src/llm/extract.ts")
}

/// The author's cards as graph nodes, for when the model is unavailable.
pub fn cards_to_update(cards: &[FeatureCard], domain: Domain) -> GraphUpdate {
    todo!("port cardsToUpdate from src/llm/extract.ts")
}

/// The known-nodes block of the prompt.
pub fn known_list(known: &[KnownNode]) -> String {
    todo!("port knownList from src/llm/extract.ts")
}

/// Graph extraction through an OpenAI-compatible model (DeepSeek on OpenRouter by default).
pub struct LlmExtractor {
    pub llm: Arc<dyn LlmClient>,
    pub model: String,
}

impl LlmExtractor {
    pub fn new(llm: Arc<dyn LlmClient>, model: impl Into<String>) -> Self {
        LlmExtractor { llm, model: model.into() }
    }
}

#[async_trait]
impl Extractor for LlmExtractor {
    async fn from_capture(&self, input: &CaptureInput, known: &[KnownNode], about: Option<&ExtractContext>) -> Result<GraphUpdate> {
        todo!("port LlmExtractor.fromCapture from src/llm/extract.ts")
    }

    async fn from_code(&self, input: &CodeInput, known: &[KnownNode], about: Option<&ExtractContext>) -> Result<GraphUpdate> {
        todo!("port LlmExtractor.fromCode from src/llm/extract.ts")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn org() -> Org {
        Org {
            id: "lumen".into(),
            name: "Lumen".into(),
            description: "We make a budgeting app for small restaurants.".into(),
            websites: vec!["github.com".into(), "lumen.atlassian.net".into()],
            context: "Our main customer is Tasty Bowl.".into(),
            created_at: "2026-10-10T12:00:00.000Z".into(),
        }
    }

    // From src/contract/org.test.ts: "tells the model what the org does, whether the page is on its websites, and who sent it".
    #[test]
    #[ignore = "stub: llm::extract not ported yet"]
    fn about_lines_describe_org_page_and_sender() {
        let about = ExtractContext { org: Some(org()), author: Some(Author { name: "Devon Park".into(), role: "Engineer on the mobile app.".into() }) };
        let on = about_lines(Some(&about), Some("https://lumen.atlassian.net/browse/APP-12"));
        assert!(on.contains("What it does: We make a budgeting app"));
        assert!(on.contains("Websites it works on: github.com, lumen.atlassian.net"));
        assert!(on.contains("This page is on one of those websites."));
        assert!(on.contains("Sent by: Devon Park."));
        assert!(about_lines(Some(&about), Some("https://mail.google.com/")).contains("This page is not on one of those websites."));
        assert_eq!(about_lines(Some(&ExtractContext::default()), None), "");
    }
}
