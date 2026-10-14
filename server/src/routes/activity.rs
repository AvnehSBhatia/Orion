//! Port of `app/api/activity/route.ts`: what people are capturing and committing right now.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::activity_query;
use crate::contract::types::{ActivityCounts, ActivityPerson, ActivityResponse};
use crate::server::deps::AppState;
use crate::server::http::{ApiResult, QueryValue, ok};
use crate::time::{HOUR_MS, iso, now_ms};

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<ActivityResponse> {
    let q = activity_query(&auth.scope(q, false)?)?;
    let store = state.store(&org_or_default(q.org_id))?;
    let db = store.db();
    let now = now_ms();
    let last_hour_at = iso(now - HOUR_MS);
    let recent = db.source_authors_since(&iso(now - 24 * HOUR_MS))?;
    let names: HashMap<String, String> = db.list_users()?.into_iter().map(|u| (u.id, u.name)).collect();

    // Newest first, so the first row seen per author is their latest.
    let mut order: Vec<String> = vec![];
    let mut by_author: HashMap<String, ActivityPerson> = HashMap::new();
    for s in &recent {
        let key = s.author_id.clone().unwrap_or_default();
        if let Some(p) = by_author.get_mut(&key) {
            p.count += 1;
        } else {
            let name = match &s.author_id {
                Some(a) => names.get(a).cloned().unwrap_or_else(|| a.clone()),
                None => "Unknown".into(),
            };
            order.push(key.clone());
            by_author.insert(key, ActivityPerson { author_id: s.author_id.clone(), name, count: 1, last_at: s.created_at.clone() });
        }
    }
    let mut people: Vec<ActivityPerson> = order.into_iter().filter_map(|k| by_author.remove(&k)).collect();
    people.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| b.last_at.cmp(&a.last_at)));

    let sources = db.list_sources(None, q.limit as i64)?.iter().map(|s| db.to_public_source(s)).collect::<anyhow::Result<Vec<_>>>()?;
    let c = db.counts()?;
    let last_hour = recent.iter().filter(|s| s.created_at >= last_hour_at).count() as i64;
    let n_people = people.len() as i64;
    ok(ActivityResponse {
        sources,
        people,
        counts: ActivityCounts { nodes: c.nodes, edges: c.edges, sources: c.sources, last_hour, people: n_people },
    })
}
