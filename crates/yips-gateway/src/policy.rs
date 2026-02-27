//! Authentication and rate-limiting policies for inbound gateway traffic.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

/// Allowlist authentication policy.
#[derive(Debug, Clone)]
pub struct AuthPolicy {
    allow_user_ids: HashSet<String>,
}

impl AuthPolicy {
    /// Create an auth policy from an allowlist of user IDs.
    pub fn new(allow_user_ids: HashSet<String>) -> Self {
        Self { allow_user_ids }
    }

    /// Returns true when user is allowed by policy.
    pub fn is_allowed(&self, user_id: &str) -> bool {
        self.allow_user_ids.is_empty() || self.allow_user_ids.contains(user_id)
    }
}

/// Rate-limit outcome for a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateLimitDecision {
    Allowed,
    Denied { retry_after_secs: u64 },
}

/// Clock abstraction to make rate-limit tests deterministic.
pub trait NowProvider: Send + Sync + 'static {
    fn now(&self) -> Instant;
}

/// Production clock using `Instant::now`.
#[derive(Debug, Clone, Default)]
pub struct SystemNow;

impl NowProvider for SystemNow {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// In-memory per-user sliding-window rate limiter.
#[derive(Debug)]
pub struct RateLimiter<C: NowProvider> {
    max_requests: u32,
    window: Duration,
    per_user_events: HashMap<String, VecDeque<Instant>>,
    clock: C,
}

impl<C: NowProvider> RateLimiter<C> {
    /// Create a new in-memory sliding-window rate limiter.
    pub fn new(max_requests: u32, window: Duration, clock: C) -> Self {
        Self {
            max_requests,
            window,
            per_user_events: HashMap::new(),
            clock,
        }
    }

    /// Check and record one request for user.
    pub fn check_and_record(&mut self, user_id: &str) -> RateLimitDecision {
        let now = self.clock.now();
        let events = self.per_user_events.entry(user_id.to_string()).or_default();

        while let Some(oldest) = events.front() {
            if now.saturating_duration_since(*oldest) >= self.window {
                events.pop_front();
            } else {
                break;
            }
        }

        if events.len() as u32 >= self.max_requests {
            let retry_after_secs = events
                .front()
                .map(|oldest| {
                    let elapsed = now.saturating_duration_since(*oldest);
                    let remaining = self.window.saturating_sub(elapsed);
                    if remaining.subsec_nanos() == 0 {
                        remaining.as_secs()
                    } else {
                        remaining.as_secs() + 1
                    }
                })
                .unwrap_or(self.window.as_secs());

            return RateLimitDecision::Denied { retry_after_secs };
        }

        events.push_back(now);
        RateLimitDecision::Allowed
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use super::{AuthPolicy, NowProvider, RateLimitDecision, RateLimiter};

    #[derive(Clone)]
    struct FakeClock {
        now: Arc<Mutex<Instant>>,
    }

    impl FakeClock {
        fn new(start: Instant) -> Self {
            Self {
                now: Arc::new(Mutex::new(start)),
            }
        }

        fn advance(&self, delta: Duration) {
            let mut now = self.now.lock().unwrap();
            *now += delta;
        }
    }

    impl NowProvider for FakeClock {
        fn now(&self) -> Instant {
            *self.now.lock().unwrap()
        }
    }

    #[test]
    fn empty_allowlist_allows_all_users() {
        let auth = AuthPolicy::new(HashSet::new());
        assert!(auth.is_allowed("u1"));
        assert!(auth.is_allowed("u2"));
    }

    #[test]
    fn non_empty_allowlist_blocks_unknown_users() {
        let mut allow = HashSet::new();
        allow.insert("u1".to_string());
        let auth = AuthPolicy::new(allow);

        assert!(auth.is_allowed("u1"));
        assert!(!auth.is_allowed("u2"));
    }

    #[test]
    fn sliding_window_allows_first_n_requests() {
        let clock = FakeClock::new(Instant::now());
        let mut limiter = RateLimiter::new(2, Duration::from_secs(60), clock);

        assert_eq!(limiter.check_and_record("u1"), RateLimitDecision::Allowed);
        assert_eq!(limiter.check_and_record("u1"), RateLimitDecision::Allowed);
    }

    #[test]
    fn sliding_window_denies_n_plus_one_request() {
        let clock = FakeClock::new(Instant::now());
        let mut limiter = RateLimiter::new(2, Duration::from_secs(60), clock);

        assert_eq!(limiter.check_and_record("u1"), RateLimitDecision::Allowed);
        assert_eq!(limiter.check_and_record("u1"), RateLimitDecision::Allowed);
        assert!(matches!(
            limiter.check_and_record("u1"),
            RateLimitDecision::Denied { .. }
        ));
    }

    #[test]
    fn request_allowed_again_after_window_expires() {
        let clock = FakeClock::new(Instant::now());
        let mut limiter = RateLimiter::new(1, Duration::from_secs(60), clock.clone());

        assert_eq!(limiter.check_and_record("u1"), RateLimitDecision::Allowed);
        assert!(matches!(
            limiter.check_and_record("u1"),
            RateLimitDecision::Denied { .. }
        ));

        clock.advance(Duration::from_secs(61));

        assert_eq!(limiter.check_and_record("u1"), RateLimitDecision::Allowed);
    }

    #[test]
    fn limiter_state_is_per_user() {
        let clock = FakeClock::new(Instant::now());
        let mut limiter = RateLimiter::new(1, Duration::from_secs(60), clock);

        assert_eq!(limiter.check_and_record("u1"), RateLimitDecision::Allowed);
        assert!(matches!(
            limiter.check_and_record("u1"),
            RateLimitDecision::Denied { .. }
        ));
        assert_eq!(limiter.check_and_record("u2"), RateLimitDecision::Allowed);
    }
}
