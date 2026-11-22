# Spyder

A personal Windows app that holds its user accountable for how they spend their working time. It does this by making every minute of work hours belong to a labelled session.

## Language

### Time frame

**Work hours**:
The user's scheduled working window for a given day (e.g. 10:00–17:00), from the weekday schedule or today's override.
_Avoid_: business hours, shift

**Off hours**:
Any time outside work hours. Activity is still recorded, but no sessions or prompts happen.
_Avoid_: after hours, personal time

**Workday %**:
The share of today's work hours that has already elapsed, from 0 to 100.
_Avoid_: day progress, completion

**Day off**:
A weekday with no work hours in the schedule. It doesn't break a streak.
_Avoid_: weekend, holiday

**Day override**:
Work hours set for today only, replacing the weekday schedule for that one day.
_Avoid_: exception, custom hours

**Keep working**:
The user's explicit choice to extend today's work hours by a fixed step (30 minutes by default) after they've ended.
_Avoid_: overtime (that's per session), extend day

### Sessions

**Session**:
A labelled block of the user's time. Every moment of work hours belongs to exactly one session or one away period, unless it is untracked.
_Avoid_: task, entry, timer

**Planned session**:
A session named and given a duration before it starts. It counts up or down.
_Avoid_: focus session, named timer

**Timed session**:
A session given only a duration. It's named when the time is up.
_Avoid_: anonymous timer

**Open session**:
A session with no duration that counts up until the user says what they did. It starts automatically whenever nothing else is running during work hours.
_Avoid_: free session, stopwatch, auto session

**Break**:
A session the user spends resting. It's not work time.
_Avoid_: pause (a pause *creates* a break)

**Segment**:
One continuous interval during which a session was actually running. A session is made up of one or more segments.
_Avoid_: span, chunk

**Label**:
The name (and optional project) that says what a session was for.
_Avoid_: tag, title

**Project**:
A user-defined grouping that sessions can belong to (e.g. "Client A", "Admin").
_Avoid_: client, category

**Pause**:
Setting the current session aside by starting a break. **Resume** ends that break and continues the paused session.
_Avoid_: stop, hold

**Time up**:
The moment a planned or timed session (or a break with a duration) reaches its planned duration.
_Avoid_: timeout, expiry

**Overtime**:
Time a planned or timed session runs past its planned duration.
_Avoid_: overrun, extra time

**Check-in**:
A periodic question during an open session asking what the user has been doing.
_Avoid_: reminder, ping

**Merge**:
Folding two or more sessions of the same day into one of them, chosen by the user. The kept session keeps its label, kind and plan and gains the others' time. Time between them stays as it was.
_Avoid_: combine, join

**Delete**:
Removing a session after the fact. Its time becomes untracked.
_Avoid_: discard, remove

**Untracked**:
Work-hours time that belongs to no session and no away period, usually because the user deleted the session it was in. It doesn't count as work time and isn't a leftover.
_Avoid_: gap, unaccounted, deleted time

### Absence

**Away period**:
An interval when the user wasn't at the computer (idle, asleep, locked, or Spyder not running), which the user then classifies.
_Avoid_: idle time, AFK, gap

**Away classification**:
What the user says an away period was: Break, Meeting, Offline work, Not working, or Working.

### Activity

**Activity**:
A record of which app (and website, for browsers) was in the foreground, and for how long.
_Avoid_: usage, event, sample

**Category**:
How an app or site counts: Productive, Neutral, Distracting, or Uncategorized. It's derived from rules.
_Avoid_: label, type

**Rule**:
A user- or default-defined mapping from an app, domain or title keyword to a category.

**Title pattern**:
A mapping from a Firefox window title to the site it shows (e.g. a title ending in "- YouTube" means youtube.com).
_Avoid_: title rule (rules assign categories; title patterns identify sites)

**Private browsing**:
Activity in a private browser window. It's recorded without a title or site and can't be categorized.
_Avoid_: incognito

**Distraction**:
Time spent on Distracting apps/sites during a work session.

**Nudge**:
A real-time warning shown after 5 continuous minutes of distraction during a work session.
_Avoid_: block, alert

### Accountability

**Work time**:
Time in non-break sessions, plus away time classified as Meeting or Offline work.

**Productive time**:
Work time minus distraction time.
_Avoid_: focus time, deep work

**Daily goal**:
The amount of productive time the user aims for each workday.

**Day score**:
Productive time as a percentage of scheduled work hours.
_Avoid_: focus score, productivity score

**Streak**:
The number of consecutive scheduled workdays on which the daily goal was met.

**Review**:
The end-of-day ritual: label leftover time, look at the day, and write wins and improvements.
_Avoid_: report (the report is what the review looks at), journal

**Leftover**:
A finished session with no label, or an away period with no classification, that the review asks the user to resolve.
_Avoid_: gap, untracked (untracked time is deliberate, not pending)

**Win**:
One entry under "Today's wins" in a review.

**Improvement**:
One entry under "How I'll improve" in a review.

**KPI**:
A user-defined daily number (e.g. "Calls made") recorded in the review and charted over time.
_Avoid_: metric, stat

**Planned vs actual**:
A planned session's intended duration compared with its real elapsed time.

### Interface

**Widget**:
The small always-on-top bar showing the running session's timer, today's productive time and the percent of day. It only displays; session controls live in the dashboard.
_Avoid_: overlay, HUD, timer window

**Prompt**:
A question Spyder puts to the user (time up, label, check-in, away, break over). Only one is shown at a time; the rest wait in a queue.
_Avoid_: popup, dialog, notification

**Dashboard**:
The main window with the Today, Week, Month, Review, Rules and Settings pages.
_Avoid_: app window, main screen
