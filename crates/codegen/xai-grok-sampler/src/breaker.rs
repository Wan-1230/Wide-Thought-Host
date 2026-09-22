//! Circuit-breaker integration for the sampling path.
//!
//! One breaker per upstream `base_url`. The breaker trips when the sliding
//! window's error rate crosses the threshold (429/5xx/connect/timeout), so a
//! degraded upstream fails fast instead of burning the per-request retry
//! budget (up to 15 attempts) against a dead endpoint.
//!
//! Knobs come from `CB_SAMPLER_*` env vars (same shape as the generic
//! `CB_*` set): `CB_SAMPLER_ENABLED=0` disables the integration entirely;
//! the remaining variables tune window/threshold/open-duration.

use std::sync::OnceLock;

use xai_circuit_breaker::{BreakerConfig, CircuitBreakerRegistry, Outcome};
use xai_grok_sampling_types::SamplingError;

/// Prefix for sampler-specific circuit-breaker env knobs.
const ENV_PREFIX: &str = "CB_SAMPLER_";

fn registry() -> &'static CircuitBreakerRegistry {
    static REGISTRY: OnceLock<CircuitBreakerRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        CircuitBreakerRegistry::new(BreakerConfig::from_env_with_prefix(ENV_PREFIX))
    })
}

/// Probe the breaker for `base_url`. `Err` means the circuit is open — the
/// caller must fail the request fast without consuming retry budget.
pub(crate) fn probe(base_url: &str) -> Result<(), xai_circuit_breaker::BreakerOpen> {
    match registry().get(base_url) {
        Some(breaker) => breaker.check(),
        // Integration disabled via config; always allow.
        None => Ok(()),
    }
}

/// Record a successful attempt against the breaker for `base_url`.
pub(crate) fn record_success(base_url: &str) {
    if let Some(breaker) = registry().get(base_url) {
        breaker.record(Outcome::Success);
    }
}

/// Record a failed attempt against the breaker for `base_url` when the
/// failure indicates upstream health. Client-side failures (auth,
/// serialization, doom-loop, truncation) do not count.
pub(crate) fn record_failure_if_upstream_fault(base_url: &str, error: &SamplingError) {
    if !is_upstream_fault(error) {
        return;
    }
    if let Some(breaker) = registry().get(base_url) {
        breaker.record(Outcome::Failure);
    }
}

/// True when `error` reflects upstream service health rather than a
/// client-side problem. Mirrors the default breaker failure codes
/// (429/5xx) plus transport-level faults.
fn is_upstream_fault(error: &SamplingError) -> bool {
    match error {
        SamplingError::Api { status, .. } => status.is_server_error() || status.as_u16() == 429,
        SamplingError::Http(e) => {
            e.is_connect() || e.is_timeout() || e.status().is_some_and(|s| s.is_server_error())
        }
        // The stream stalled mid-flight — an upstream health signal.
        SamplingError::IdleTimeout { .. } => true,
        // Client-side or deterministic failures: not upstream health.
        SamplingError::Auth(_)
        | SamplingError::Serialization(_)
        | SamplingError::EmptyResponse { .. }
        | SamplingError::DoomLoopDetected { .. }
        | SamplingError::MaxTokensTruncation => false,
        // Ambiguous stream-level errors are not counted so a
        // poisoned-but-healthy endpoint does not trip the breaker.
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use xai_circuit_breaker::CircuitBreaker;

    fn api_error(status: u16) -> SamplingError {
        SamplingError::Api {
            status: reqwest::StatusCode::from_u16(status).unwrap(),
            message: "test".to_string(),
            model_metadata: None,
            retry_after_secs: None,
            should_retry: None,
        }
    }

    #[test]
    fn upstream_fault_classification() {
        // Failure codes trip the breaker.
        assert!(is_upstream_fault(&api_error(429)));
        assert!(is_upstream_fault(&api_error(500)));
        assert!(is_upstream_fault(&api_error(503)));
        // Client errors do not.
        assert!(!is_upstream_fault(&api_error(400)));
        assert!(!is_upstream_fault(&api_error(401)));
        assert!(!is_upstream_fault(&api_error(404)));
        // Deterministic/model-level failures do not.
        assert!(!is_upstream_fault(&SamplingError::MaxTokensTruncation));
        assert!(!is_upstream_fault(&SamplingError::Auth("no key".into())));
        assert!(!is_upstream_fault(&SamplingError::DoomLoopDetected {
            triggers: vec![],
            aborted_at_chunk: None,
        }));
        // Idle timeout is an upstream health signal.
        assert!(is_upstream_fault(&SamplingError::IdleTimeout {
            elapsed_secs: 30
        }));
    }

    /// Endpoint-keyed behavior: enough upstream faults trip the breaker,
    /// and the tripped breaker fails the probe.
    #[test]
    fn breaker_trips_after_error_rate_crosses_threshold() {
        let breaker = CircuitBreaker::new(BreakerConfig::server());
        // 5 successes then 5 failures in a 10-sample window = 50% error
        // rate, exactly at the server preset's threshold.
        for _ in 0..5 {
            breaker.record(Outcome::Success);
        }
        for i in 0..4 {
            breaker.record(Outcome::Failure);
            assert!(
                breaker.check().is_ok(),
                "breaker must stay closed below threshold (failure {i})"
            );
        }
        breaker.record(Outcome::Failure);
        assert!(
            breaker.is_open(),
            "50% error rate over 10 samples must trip"
        );
        assert!(breaker.check().is_err());
    }

    /// A successful half-open probe closes the breaker after the open
    /// duration (via the mock clock, no real sleeping).
    #[test]
    fn breaker_recovers_after_open_duration() {
        let clock = std::sync::Arc::new(xai_circuit_breaker::MockClock::new());
        let breaker = CircuitBreaker::with_clock(BreakerConfig::server(), clock.clone());
        for _ in 0..10 {
            breaker.record(Outcome::Failure);
        }
        assert!(breaker.is_open());
        clock.advance(Duration::from_secs(11));
        // Half-open: a probe slot is available, and a successful probe
        // closes the breaker (probe_success → Closed).
        assert!(breaker.check().is_ok());
        breaker.record(Outcome::Success);
        assert_eq!(
            breaker.state(),
            xai_circuit_breaker::BreakerState::Closed,
            "successful probe must close the breaker"
        );
        assert!(breaker.check().is_ok());
    }
}
