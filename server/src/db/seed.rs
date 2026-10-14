//! Port of `src/db/seed.ts`: the demo org's people, graph, and the documents behind it.

use anyhow::{Result, bail};

use super::store::{Db, NewSource, NodeChange, StoredNode, Vectors, edge_id, node_key, source_id};
use crate::contract::types::*;
use crate::time::{HOUR_MS, iso, now_ms};

pub fn demo_org(created_at: &str) -> Org {
    Org {
        id: "demo".into(),
        name: "Demo Co".into(),
        description: "We build an AI support assistant for enterprise support teams. Voice mode, which lets agents talk to it, is our next launch.".into(),
        websites: ["github.com", "ads.google.com", "app.hubspot.com", "crm.example.com", "docs.example.com", "console.cloud.example.com"]
            .map(String::from)
            .to_vec(),
        context: "Customers and prospects: Acme (renewal), Globex (voice mode pilot). Our code lives in the acme/voice and acme/api repos. GPU inference is our biggest infrastructure cost.".into(),
        created_at: created_at.into(),
    }
}

pub fn seed_users() -> Vec<User> {
    let u = |id: &str, name: &str, role: &str| User { id: id.into(), name: name.into(), role: role.into(), team_description: String::new() };
    vec![
        u("priya", "Priya Shah", "Product manager. Roadmap, launch dates, milestones, feature readiness, and what sales can promise customers."),
        u("devon", "Devon Park", "Software engineer. Code, services, builds, latency, what is shipping, what is blocked, and technical dependencies."),
        u("sam", "Sam Ortiz", "Account executive. Deals, renewals, pilots, customer stakeholders, and which shipped features are safe to sell."),
        u("mina", "Mina Rao", "Growth marketer. Google Ads campaigns, daily ad budget, launch messaging, spend, and cost per signup."),
    ]
}

struct SeedNode {
    id: &'static str,
    label: &'static str,
    t: NodeType,
    domain: Domain,
    summary: &'static str,
    todo: Option<&'static str>,
    links: &'static [(&'static str, &'static str)],
    owner: Option<&'static str>,
    status: Status,
    sellable: bool,
    source: Option<(SourceKind, &'static str)>,
    hours_ago: i64,
}

use Domain::*;
use NodeType as T;
use Status as S;

const SEED_NODES: &[SeedNode] = &[
    SeedNode { id: "voice-mode", label: "Voice mode", t: T::Feature, domain: Engineering, summary: "Talk to the assistant hands free. In beta with ten pilot customers, full release after the latency fix.", todo: None, links: &[("Voice mode beta notes", "https://example.com/docs/voice-beta")], owner: Some("Devon Park"), status: S::OnTrack, sellable: true, source: Some((SourceKind::Code, "4f2a1c9")), hours_ago: 30 },
    SeedNode { id: "voice-latency-fix", label: "Voice latency fix", t: T::Task, domain: Engineering, summary: "Cut voice reply delay from 2.4 seconds to under 1 second. Waiting on the new audio streaming service.", todo: Some("Pair with whoever picks up the audio streaming service."), links: &[], owner: Some("Devon Park"), status: S::Blocked, sellable: false, source: Some((SourceKind::Code, "9b31e07")), hours_ago: 6 },
    SeedNode { id: "audio-streaming-service", label: "Audio streaming service", t: T::Feature, domain: Engineering, summary: "New service that streams audio in small chunks so voice replies can start before the full answer is ready.", todo: None, links: &[], owner: None, status: S::OnTrack, sellable: false, source: Some((SourceKind::Code, "c07d5a2")), hours_ago: 52 },
    SeedNode { id: "sso-login", label: "SSO login", t: T::Feature, domain: Engineering, summary: "Customers sign in with Okta or Google Workspace. Shipped to every plan last week.", todo: None, links: &[("SSO setup guide", "https://example.com/docs/sso")], owner: Some("Devon Park"), status: S::Done, sellable: true, source: Some((SourceKind::Code, "e11b8f4")), hours_ago: 170 },
    SeedNode { id: "usage-export-api", label: "Usage export API", t: T::Feature, domain: Engineering, summary: "Admins can download usage data as CSV. Built behind a flag and not public yet.", todo: None, links: &[], owner: Some("Devon Park"), status: S::OnTrack, sellable: false, source: Some((SourceKind::Code, "a5c2d10")), hours_ago: 20 },
    SeedNode { id: "voice-mode-general-release", label: "Voice mode general release", t: T::Milestone, domain: Engineering, summary: "Voice mode opens to every customer. Target date is November 14.", todo: Some("Confirm the date once the latency fix has a delivery estimate."), links: &[], owner: Some("Priya Shah"), status: S::OnTrack, sellable: false, source: None, hours_ago: 48 },
    SeedNode { id: "acme-renewal", label: "Acme renewal", t: T::Deal, domain: Sales, summary: "Annual renewal worth 180k. Acme asked for voice mode and SSO before they sign.", todo: None, links: &[], owner: Some("Sam Ortiz"), status: S::OnTrack, sellable: false, source: Some((SourceKind::Extension, "https://crm.example.com/deals/acme-renewal")), hours_ago: 4 },
    SeedNode { id: "jordan-lee-acme-cto", label: "Jordan Lee, Acme CTO", t: T::Stakeholder, domain: Sales, summary: "Only contact on the Acme renewal. Cares most about SSO and admin controls.", todo: None, links: &[], owner: None, status: S::Unknown, sellable: false, source: Some((SourceKind::Extension, "https://crm.example.com/deals/acme-renewal")), hours_ago: 4 },
    SeedNode { id: "globex-pilot", label: "Globex pilot", t: T::Deal, domain: Sales, summary: "Voice mode pilot for 40 support agents. Decision expected at the end of the month.", todo: Some("Send the pilot success criteria before Friday."), links: &[], owner: Some("Sam Ortiz"), status: S::OnTrack, sellable: false, source: Some((SourceKind::Extension, "https://crm.example.com/deals/globex-pilot")), hours_ago: 26 },
    SeedNode { id: "ana-cruz-globex-support", label: "Ana Cruz, Globex support VP", t: T::Stakeholder, domain: Sales, summary: "Runs the support team in the pilot. Wants faster voice replies.", todo: None, links: &[], owner: None, status: S::Unknown, sellable: false, source: None, hours_ago: 26 },
    SeedNode { id: "raj-iyer-globex-it", label: "Raj Iyer, Globex IT lead", t: T::Stakeholder, domain: Sales, summary: "Signs off on security review for the pilot.", todo: None, links: &[], owner: None, status: S::Unknown, sellable: false, source: None, hours_ago: 26 },
    SeedNode { id: "q4-search-campaign", label: "Q4 search campaign", t: T::Campaign, domain: Marketing, summary: "Google Ads search campaign for voice mode. Daily budget raised from 400 to 650 dollars today.", todo: None, links: &[("Campaign in Google Ads", "https://ads.google.com/aw/campaigns")], owner: Some("Mina Rao"), status: S::OnTrack, sellable: false, source: Some((SourceKind::Extension, "https://ads.google.com/aw/campaigns")), hours_ago: 2 },
    SeedNode { id: "cost-per-signup", label: "Cost per signup", t: T::Metric, domain: Marketing, summary: "Paid search cost per signup is 38 dollars this week, up from 31 last week.", todo: Some("Check which ad groups drove the increase."), links: &[], owner: Some("Mina Rao"), status: S::AtRisk, sellable: false, source: Some((SourceKind::Extension, "https://ads.google.com/aw/overview")), hours_ago: 2 },
    SeedNode { id: "voice-launch-messaging", label: "Voice launch messaging", t: T::Decision, domain: Marketing, summary: "Lead with hands free support for agents. Do not promise sub second replies until the latency fix ships.", todo: None, links: &[], owner: Some("Priya Shah"), status: S::OnTrack, sellable: false, source: None, hours_ago: 72 },
    SeedNode { id: "gpu-capacity-supplier", label: "GPU capacity supplier", t: T::Supplier, domain: Ops, summary: "Cloud GPU reservation that runs voice inference. Contract renews in November.", todo: None, links: &[], owner: None, status: S::OnTrack, sellable: false, source: None, hours_ago: 120 },
    SeedNode { id: "inference-cost-overrun", label: "Inference cost overrun", t: T::Risk, domain: Ops, summary: "Voice inference spend is 20 percent over plan this month.", todo: None, links: &[], owner: None, status: S::AtRisk, sellable: false, source: None, hours_ago: 10 },
];

const SEED_EDGES: &[(&str, Relation, &str)] = &[
    ("audio-streaming-service", Relation::Blocks, "voice-latency-fix"),
    ("voice-latency-fix", Relation::Blocks, "voice-mode-general-release"),
    ("voice-mode", Relation::PartOf, "voice-mode-general-release"),
    ("voice-mode", Relation::Influences, "acme-renewal"),
    ("sso-login", Relation::Influences, "acme-renewal"),
    ("jordan-lee-acme-cto", Relation::PartOf, "acme-renewal"),
    ("voice-mode", Relation::Influences, "globex-pilot"),
    ("ana-cruz-globex-support", Relation::PartOf, "globex-pilot"),
    ("raj-iyer-globex-it", Relation::PartOf, "globex-pilot"),
    ("q4-search-campaign", Relation::Feeds, "cost-per-signup"),
    ("voice-launch-messaging", Relation::Governs, "q4-search-campaign"),
    ("voice-mode-general-release", Relation::Influences, "voice-launch-messaging"),
    ("gpu-capacity-supplier", Relation::Feeds, "voice-mode"),
    ("inference-cost-overrun", Relation::Influences, "gpu-capacity-supplier"),
];

struct SeedSource {
    kind: SourceKind,
    r: &'static str,
    title: &'static str,
    text: &'static str,
    author: Option<&'static str>,
    hours_ago: i64,
    changes: &'static [(&'static str, ChangeKind, Option<Status>)],
}

use ChangeKind::{Created, Updated};

/// The documents behind the seed graph, so the feed and citations have something real to point at.
const SEED_SOURCES: &[SeedSource] = &[
    SeedSource { kind: SourceKind::Code, r: "acme/voice@9c1e2ab4d7f0", title: "acme/voice 9c1e2ab: voice/stream_client.ts, voice/config.ts", text: "--- voice/stream_client.ts\n+// Chunked replies need the new audio streaming service. Until it is deployed we fall back to full buffering.\n+if (!streamingService.available) return bufferFullReply(answer)\n--- voice/config.ts\n-LATENCY_TARGET_MS = 2400\n+LATENCY_TARGET_MS = 900\nCommit message: Latency fix blocked on audio streaming service rollout. Measured 2.4s p50 on pilot traffic.", author: Some("devon"), hours_ago: 6, changes: &[("voice-latency-fix", Updated, Some(S::OnTrack))] },
    SeedSource { kind: SourceKind::Extension, r: "https://ads.google.com/aw/campaigns?campaignId=q4-search-voice", title: "Google Ads: Q4 search, voice mode", text: "Campaign Q4 search voice mode. Daily budget 650 USD (was 400). Clicks 2,140. Conversions 61. Cost per conversion 38.20 USD, last week 31.05 USD. Top keyword: hands free support assistant.", author: Some("mina"), hours_ago: 2, changes: &[("q4-search-campaign", Updated, Some(S::OnTrack)), ("cost-per-signup", Updated, Some(S::OnTrack))] },
    SeedSource { kind: SourceKind::Extension, r: "https://app.hubspot.com/contacts/deals/acme-renewal", title: "HubSpot deal: Acme annual renewal", text: "Acme renewal, 180,000 USD, stage: negotiation, close date Nov 30. Contact: Jordan Lee, CTO. Notes: asked for voice mode and SSO before signing. Jordan wants admin controls for SSO and a date for voice general availability.", author: Some("sam"), hours_ago: 4, changes: &[("acme-renewal", Updated, Some(S::OnTrack)), ("jordan-lee-acme-cto", Created, None)] },
    SeedSource { kind: SourceKind::Extension, r: "https://docs.example.com/globex-pilot-kickoff", title: "Globex pilot kickoff notes", text: "Voice mode pilot for 40 Globex support agents. Ana Cruz runs support and wants faster voice replies. Raj Iyer from IT signs off on the security review. Decision at end of month.", author: Some("sam"), hours_ago: 26, changes: &[("globex-pilot", Created, None), ("ana-cruz-globex-support", Created, None), ("raj-iyer-globex-it", Created, None)] },
    SeedSource { kind: SourceKind::Extension, r: "https://docs.example.com/globex-kickoff-priya", title: "Globex kickoff, Priya's notes", text: "Globex kickoff for the voice mode pilot: 40 support agents. Ana Cruz (support) wants voice replies to feel faster. Raj Iyer (IT) owns the security review sign off. They decide at the end of the month.", author: Some("priya"), hours_ago: 25, changes: &[("globex-pilot", Updated, Some(S::OnTrack))] },
    SeedSource { kind: SourceKind::Extension, r: "https://ads.google.com/aw/campaigns?campaignId=q4-search-voice&date=yesterday", title: "Google Ads: Q4 search, voice mode (yesterday)", text: "Campaign Q4 search voice mode. Daily budget 400 USD. Clicks 1,610. Conversions 52. Cost per conversion 31.05 USD. Top keyword: hands free support assistant.", author: Some("mina"), hours_ago: 26, changes: &[] },
    SeedSource { kind: SourceKind::Extension, r: "https://docs.example.com/voice-launch-plan", title: "Voice mode launch plan", text: "General release target November 14. Depends on the latency fix landing by November 1. Messaging: lead with hands free support for agents. Do not promise sub second replies until the latency fix ships.", author: Some("priya"), hours_ago: 48, changes: &[("voice-mode-general-release", Updated, Some(S::OnTrack)), ("voice-launch-messaging", Updated, Some(S::OnTrack))] },
    SeedSource { kind: SourceKind::Extension, r: "https://console.cloud.example.com/billing/voice-inference", title: "Cloud billing: voice inference", text: "Voice inference spend month to date 41,300 USD against a plan of 34,400 USD, 20 percent over. GPU reservation renews November 20.", author: Some("priya"), hours_ago: 10, changes: &[("inference-cost-overrun", Created, None)] },
    SeedSource { kind: SourceKind::Code, r: "acme/api@51d0e3f8a2c1", title: "acme/api 51d0e3f: exports/usage.ts, flags.ts", text: "--- exports/usage.ts\n+export async function usageCsv(orgId) { ... }\n--- flags.ts\n+USAGE_EXPORT: false // not public yet\nCommit message: Usage export to CSV for admins, behind a flag.", author: Some("devon"), hours_ago: 20, changes: &[("usage-export-api", Created, None)] },
    SeedSource { kind: SourceKind::Code, r: "acme/voice@4f2a1c9e88b0", title: "acme/voice 4f2a1c9: voice/beta.ts", text: "--- voice/beta.ts\n+BETA_CUSTOMERS = 10\nCommit message: Voice mode beta opened to ten pilot customers.", author: Some("devon"), hours_ago: 30, changes: &[("voice-mode", Updated, Some(S::OnTrack))] },
];

/// Seeds demo users and graph when the store is empty, or always when `force` is set. True when it seeded.
pub fn seed_demo(db: &Db, force: bool) -> Result<bool> {
    if !force && !db.list_users()?.is_empty() {
        return Ok(false);
    }
    let now = now_ms();
    db.tx(|db| {
        db.reset()?;
        db.save_org(&demo_org(&iso(now)))?;
        for u in seed_users() {
            db.save_user(&u)?;
        }
        for n in SEED_NODES {
            let (source_kind, source_ref) = n.source.unwrap_or((SourceKind::Manual, "seed"));
            db.save_node(&StoredNode {
                id: n.id.into(),
                key: node_key(n.t, n.label),
                label: n.label.into(),
                node_type: n.t,
                domain: n.domain,
                summary: n.summary.into(),
                todo: n.todo.map(String::from),
                read_links: n.links.iter().map(|(t, u)| ReadLink { title: (*t).into(), url: (*u).into() }).collect(),
                owner: n.owner.map(String::from),
                status: n.status,
                sellable: n.sellable,
                source_kind,
                source_ref: source_ref.into(),
                updated_at: iso(now - n.hours_ago * HOUR_MS),
                vectors: Vectors::default(),
            })?;
        }
        for (source, relation, target) in SEED_EDGES {
            let edge = Edge { id: edge_id(source, *relation, target), source: (*source).into(), target: (*target).into(), relation: *relation, source_ref: "seed".into() };
            if !db.add_edge(&edge)? {
                bail!("seed edge failed: {}", edge.id);
            }
        }
        let status_of = |id: &str| SEED_NODES.iter().find(|n| n.id == id).map(|n| n.status).unwrap_or(S::Unknown);
        for s in SEED_SOURCES {
            let created_at = iso(now - s.hours_ago * HOUR_MS);
            let changes: Vec<NodeChange> = s
                .changes
                .iter()
                .map(|(node, change, from)| NodeChange { node_id: (*node).into(), change: *change, status_from: *from, status_to: status_of(node) })
                .collect();
            db.save_source(
                &NewSource {
                    id: source_id(s.kind, s.r, &created_at),
                    kind: s.kind,
                    source_ref: s.r.into(),
                    title: s.title.into(),
                    text: s.text.into(),
                    author_id: s.author.map(String::from),
                    created_at,
                    image: None,
                    ocr_text: None,
                    image_status: None,
                },
                &changes,
            )?;
            if let Some(a) = s.author {
                db.add_touches(a, &changes.iter().map(|c| c.node_id.clone()).collect::<Vec<_>>())?;
            }
        }
        Ok(())
    })?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::store::Store;

    #[test]
    fn seeds_once() {
        let store = Store::memory().unwrap();
        let db = store.db();
        assert!(seed_demo(&db, false).unwrap());
        assert!(!seed_demo(&db, false).unwrap());
        let c = db.counts().unwrap();
        assert_eq!((c.nodes, c.edges, c.sources), (16, 14, 10));
        assert_eq!(db.list_users().unwrap().len(), 4);
        assert_eq!(db.get_org().unwrap().unwrap().name, "Demo Co");
        assert!(db.touched_node_ids("sam").unwrap().contains(&"globex-pilot".to_string()));
    }
}
