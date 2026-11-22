#![cfg_attr(not(any(unix, test)), allow(dead_code))]

use std::{
    borrow::Cow,
    time::{Duration, Instant},
};

const MERGE_WINDOW: Duration = Duration::from_millis(200);

#[derive(Debug, PartialEq, Eq)]
enum Event<'a> {
    App(Cow<'a, str>),
    Focus,
    Conflict,
    Keyguard,
    Screen(&'static str),
}

impl Event<'_> {
    #[cfg(unix)]
    fn into_owned(self) -> Event<'static> {
        match self {
            Self::App(package) => Event::App(Cow::Owned(package.into_owned())),
            Self::Focus => Event::Focus,
            Self::Conflict => Event::Conflict,
            Self::Keyguard => Event::Keyguard,
            Self::Screen(power) => Event::Screen(power),
        }
    }

    fn write_to(&self, mut out: impl std::io::Write) -> std::io::Result<()> {
        match self {
            Self::App(package) => writeln!(out, "@app:{package}"),
            Self::Focus => writeln!(out, "@focus"),
            Self::Conflict => writeln!(out, "@conflict"),
            Self::Keyguard => writeln!(out, "@keyguard"),
            Self::Screen(power) => writeln!(out, "@screen:{power}"),
        }
    }
}

fn package_is_valid(value: &str) -> bool {
    value.contains('.')
        && value.split('.').all(|part| {
            !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        })
}

fn classify(line: &str) -> Option<Event<'_>> {
    let (_, message) = line.split_once(" I ")?;
    let (tag, fields) = message.split_once(": ")?;
    match tag.trim_end() {
        "screen_toggled" => match fields {
            "0" | "[0]" => Some(Event::Screen("asleep")),
            "1" | "[1]" => Some(Event::Screen("awake")),
            _ => None,
        },
        "power_screen_state" => match fields
            .strip_prefix('[')?
            .strip_suffix(']')?
            .split_once(',')?
            .0
        {
            "0" => Some(Event::Screen("asleep")),
            "1" => Some(Event::Screen("awake")),
            _ => None,
        },
        "wm_set_keyguard_shown" => Some(Event::Keyguard),
        "wm_set_resumed_activity" | "am_set_resumed_activity" => {
            let app = || {
                let fields = fields.strip_prefix('[')?.strip_suffix(']')?;
                let (user, fields) = fields.split_once(',')?;
                if user.is_empty() || !user.bytes().all(|ch| ch.is_ascii_digit()) {
                    return None;
                }
                let (component, _) = fields.split_once(',')?;
                let (package, _) = component.trim_start_matches(' ').split_once('/')?;
                package_is_valid(package).then_some(Event::App(Cow::Borrowed(package)))
            };
            Some(app().unwrap_or(Event::Focus))
        }
        "wm_resume_activity"
        | "am_resume_activity"
        | "wm_restart_activity"
        | "am_restart_activity"
        | "wm_relaunch_resume_activity"
        | "am_relaunch_resume_activity" => Some(Event::Focus),
        "wm_focused_root_task" | "wm_focused_stack" | "wm_task_moved" => Some(Event::Conflict),
        _ => None,
    }
}

fn merge<'a>(pending: Event<'a>, next: Event<'a>) -> Event<'a> {
    match (pending, next) {
        (Event::Conflict, _) => Event::Conflict,
        (Event::App(previous), Event::App(next)) if previous != next => Event::Conflict,
        (app @ Event::App(_), Event::Focus) => app,
        (_, next) => next,
    }
}

/// Collects events for the fixed merge window. The deadline starts at the first
/// pending event and never slides, so a busy stream still reports within 200ms.
struct Merger {
    pending: Option<Event<'static>>,
    deadline: Option<Instant>,
}

impl Merger {
    fn new() -> Self {
        Self {
            pending: None,
            deadline: None,
        }
    }

    fn is_pending(&self) -> bool {
        self.pending.is_some()
    }

    #[cfg_attr(not(unix), allow(dead_code))]
    fn timeout(&self, now: Instant) -> Option<Duration> {
        self.deadline
            .map(|deadline| deadline.saturating_duration_since(now))
    }

    fn take_expired(&mut self, now: Instant) -> Option<Event<'static>> {
        let deadline = self.deadline?;
        if now < deadline {
            return None;
        }
        self.deadline = None;
        self.pending.take()
    }

    #[cfg_attr(not(unix), allow(dead_code))]
    fn flush(&mut self) -> Option<Event<'static>> {
        self.deadline = None;
        self.pending.take()
    }

    fn push(&mut self, event: Event<'static>, now: Instant) -> Option<Event<'static>> {
        match event {
            // Screen and keyguard changes are authoritative and bypass merging.
            Event::Keyguard | Event::Screen(_) => {
                self.deadline = None;
                self.pending = None;
                Some(event)
            }
            next => {
                if self.pending.is_none() {
                    self.deadline = Some(now + MERGE_WINDOW);
                }
                self.pending = Some(match self.pending.take() {
                    Some(previous) => merge(previous, next),
                    None => next,
                });
                None
            }
        }
    }
}

fn is_live(line: &str, cutoff: Duration) -> bool {
    let Some(stamp) = line.split_ascii_whitespace().next() else {
        return false;
    };
    let Some((seconds, fraction)) = stamp.split_once('.') else {
        return false;
    };
    if fraction.len() > 9 || fraction.is_empty() {
        return false;
    }
    match (seconds.parse(), fraction.parse::<u32>()) {
        (Ok(seconds), Ok(fraction_value)) => {
            Duration::new(
                seconds,
                fraction_value * 10_u32.pow(9 - fraction.len() as u32),
            ) > cutoff
        }
        _ => false,
    }
}

#[cfg(unix)]
mod reader;

#[cfg(unix)]
fn main() -> std::io::Result<()> {
    reader::listen()
}

#[cfg(not(unix))]
fn main() {
    eprintln!("The native reader runs on Android or Linux.");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_event_samples() {
        for line in include_str!("../../tools/event_fixtures.tsv").lines() {
            let (expected, raw) = line.split_once('\t').unwrap();
            let mut output = Vec::new();
            if let Some(event) = classify(raw) {
                event.write_to(&mut output).unwrap();
            }
            let result = std::str::from_utf8(&output).unwrap().trim();
            assert_eq!(result, expected, "{raw}");
        }
    }

    #[test]
    fn conflicting_and_duplicate_apps() {
        assert_eq!(
            merge(Event::App("one.app".into()), Event::Focus),
            Event::App("one.app".into())
        );
        assert_eq!(
            merge(Event::App("one.app".into()), Event::App("one.app".into())),
            Event::App("one.app".into())
        );
        assert_eq!(
            merge(Event::App("one.app".into()), Event::App("two.app".into())),
            Event::Conflict
        );
    }

    #[test]
    fn drops_historical_event() {
        let cutoff = Duration::from_millis(12_100);
        assert!(!is_live("12.099 rest", cutoff));
        assert!(!is_live("12.100 rest", cutoff));
        assert!(is_live("12.101 rest", cutoff));
    }

    #[test]
    fn merger_expires_after_hard_window() {
        let start = Instant::now();
        let mut merger = Merger::new();
        assert_eq!(merger.push(Event::App("one.app".into()), start), None);
        assert!(merger
            .take_expired(start + Duration::from_millis(199))
            .is_none());
        assert_eq!(
            merger.take_expired(start + Duration::from_millis(200)),
            Some(Event::App("one.app".into()))
        );
        assert!(!merger.is_pending());
    }

    #[test]
    fn merger_does_not_slide_the_window() {
        let start = Instant::now();
        let mut merger = Merger::new();
        merger.push(Event::App("one.app".into()), start);
        merger.push(Event::Focus, start + Duration::from_millis(150));
        assert!(merger
            .take_expired(start + Duration::from_millis(199))
            .is_none());
        assert_eq!(
            merger.take_expired(start + Duration::from_millis(200)),
            Some(Event::App("one.app".into()))
        );
    }

    #[test]
    fn merger_reports_conflict_within_window() {
        let start = Instant::now();
        let mut merger = Merger::new();
        merger.push(Event::App("one.app".into()), start);
        merger.push(
            Event::App("two.app".into()),
            start + Duration::from_millis(50),
        );
        assert_eq!(
            merger.take_expired(start + Duration::from_millis(200)),
            Some(Event::Conflict)
        );
    }

    #[test]
    fn merger_emits_screen_immediately_and_drops_pending() {
        let start = Instant::now();
        let mut merger = Merger::new();
        merger.push(Event::App("one.app".into()), start);
        assert_eq!(
            merger.push(Event::Screen("asleep"), start + Duration::from_millis(10)),
            Some(Event::Screen("asleep"))
        );
        assert!(!merger.is_pending());
        assert!(merger
            .take_expired(start + Duration::from_secs(1))
            .is_none());
    }
}
