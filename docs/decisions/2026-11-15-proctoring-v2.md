# Proctoring v2 (2026-11-15)

Decisions made on 2026-11-15 about what proctoring captures and how the integrity label is set. Two of them reverse recommendations in `2026-11-10-pilot-decisions.md`. That file stays as the record of what was recommended then.

## D6 reversed: full screen can be required

**Was:** keep full screen optional and tune thresholds after about 30 pilot attempts (option A in D6). Requiring it was rejected because it can break the calculator and accessibility tools.

**Now:** each assessment has a "Require full screen" setting. When it is on, the task area is covered until the candidate is in full screen, the timer keeps running (D4), and each exit is recorded as a down period that the `downtime` rule judges. The built-in calculator lives inside the page, so it still works. A recruiter can waive full screen for one candidate (D9), which covers accessibility tools that need other windows. Browsers with no Fullscreen API run in the window. The full-screen exit count rule only applies when full screen is not required.

**Why:** the team wants the option for rounds where leaving the window matters, and the waiver removes the main objection. It is a setting, not a default, so no round has it unless someone chooses it.

## D7 reversed: an on-device gaze check exists

**Was:** no face check for the pilot; later, on-device face counting only, after legal review.

**Now:** a "Gaze check" setting (needs the camera) runs MediaPipe Face Landmarker in the candidate's browser. It looks at head turn and tilt (more than 25 degrees left or right, or 20 degrees up or down, for 1 second), whether a face is there (2 seconds without one), and whether two or more faces are in view. **Only events leave the device**: looking away with a direction, looking back, no face, face back, multiple faces with a count. No image, landmark or face template is sent or stored, and nothing identifies who someone is. If the device can't run it, the camera stays on and the candidate is told.

**Still open (D3):** the consent wording for this needs the lawyer's review before candidates outside North Carolina take a test with it on. The notice already says that only the result is sent, never the image or a face template. The model files are self-hosted, about 19 MB, and cached after the first load.

## Microphone

A "Microphone" setting records short clips (up to 15 seconds) only when speech is heard, plus when speech starts and stops. There is a sound check on the system check, a cover if the microphone is lost, and a per-invite waiver. Audio is kept under the same retention clock as images and is seen only by the people who can see snapshots. It is not transcribed.

## New label rules

The attempt label is now based on how serious the combination of flags is, rather than only how many flags there are.

- **Suspicious:** left the window together with camera off, screen sharing stopped, monitoring down or no face in view; copied text then left the window within 10 seconds; more than one face in view; speech together with looking away or with leaving the window; or three or more different kinds of flag.
- **Review:** any other flag. This is the middle group.
- **Clear:** no flags.

The report lists the reasons in plain words, for example "Left the test window, and the camera was turned off".

**The reasoning, in the product owner's words:** "if they left tabs and camera messed up it has to be flagged suspicious; review should be a middle group". Before this, one flag meant review and three meant suspicious, so a candidate who left the window and also turned the camera off could stay at review. Pairs that point to outside help now go straight to suspicious; a single unusual thing stays at review for a person to look at.

Nothing here rejects anyone. The label only tells the recruiter where to look first.

## Other changes in the same release

- While away from the window, screenshots at about 2 s and 6 s, then every 10 s, and one on return, shown as a filmstrip per absence on the report.
- Copy and cut are recorded by length only (like paste); copy then leave is its own rule.
- Pasting the emailed code as `123 456` fills all six digits.
- Consent version `2026-11-15.proctoring-v2`; the agree box names what this assessment captures.

## Open items

- Full screen, speech detection and the gaze angles have not been tried in real browsers with real people. Thresholds are first guesses; review flag rates after about 30 attempts, as D6 said.
- The report doesn't show the length of an audio clip.
- Legal review (D3) before candidates outside North Carolina.
