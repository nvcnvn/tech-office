#!/usr/bin/env node
/**
 * Self-check for the compliance-prose rule's region parser (Feature 054).
 *
 * Run with `node scripts/check-compliance-prose.check.js`.
 *
 * The parser decides whether a sentence naming an absent capability is a recorded
 * absence or a false promise to a store reviewer. Both mistakes are silent: an
 * over-wide section quietly exempts the next false claim somebody writes under it,
 * and an under-wide one fails the build on a row that has been correct since 053.
 * Only an assertion catches either, so the boundary cases from
 * specs/054-compliance-prose-age-rating/contracts/prose-gate.md are asserted here
 * against in-memory strings rather than by mutating tracked documents.
 *
 * Covers scenarios G2, G5 and G6.
 */

const assert = require("node:assert/strict");
const {
  CAPABILITY_TERMS,
  RECORDED_ABSENCE_SECTIONS,
  recordedAbsenceLines,
} = require("./check-store-manifest.js");

/** The rule's own predicate, over one in-memory document. */
function unsatisfiedMatches(content, headings, declared = new Set()) {
  const exempt = recordedAbsenceLines(content, headings);
  const found = [];
  content.split("\n").forEach((line, index) => {
    const lower = line.toLowerCase();
    for (const [term, declaration] of CAPABILITY_TERMS) {
      if (!lower.includes(term)) continue;
      if (declared.has(declaration)) continue;
      if (exempt.has(index + 1)) continue;
      found.push({ line: index + 1, term });
    }
  });
  return found;
}

// --- G2: a recorded absence in a declared section is not a false promise -------
// The shape of permission-justifications.md's two tables as they have stood since
// feature 053. The gate must not punish the entries that record why the app does
// NOT ask for something — they are the reason the exemption exists at all.
{
  const doc = [
    "# Permission justifications",
    "",
    "## iOS",
    "",
    "### `NSLocationWhenInUseUsageDescription`",
    "",
    "The app captures a single coordinate when the person checks in.",
    "",
    "## Permissions deliberately blocked",
    "",
    "| Permission | Why it is blocked |",
    "|---|---|",
    "| `android.permission.USE_BIOMETRIC` | There is no biometric sign-in anywhere. |",
    "",
    "## Keys deliberately absent",
    "",
    "| Key | Why it is absent |",
    "|---|---|",
    "| `NSFaceIDUsageDescription` | There is no Face ID sign-in anywhere in the app. |",
    "",
    "## Export compliance",
    "",
    "`ITSAppUsesNonExemptEncryption` is set to `false`.",
  ].join("\n");

  const headings = RECORDED_ABSENCE_SECTIONS["permission-justifications.md"];
  assert.deepEqual(
    unsatisfiedMatches(doc, headings),
    [],
    "G2: biometric rows inside the two declared tables must not be reported"
  );
}

// --- G5: a deeper sub-heading does not close the section ----------------------
{
  const doc = [
    "## Keys deliberately absent",
    "",
    "There is no Face ID sign-in anywhere in the app.",
    "",
    "### `NSFaceIDUsageDescription`",
    "",
    "Still no Face ID sign-in, and still inside the section.",
    "",
    "#### A deeper heading again",
    "",
    "And still no fingerprint sign-in.",
  ].join("\n");

  assert.deepEqual(
    unsatisfiedMatches(doc, ["Keys deliberately absent"]),
    [],
    "G5: sub-headings deeper than the section's own level must not close it"
  );

  // The section's own heading line is inside the section, and so is every line to
  // the end of the file when nothing closes it.
  const exempt = recordedAbsenceLines(doc, ["Keys deliberately absent"]);
  assert.ok(exempt.has(1), "G5: the heading line itself is inside the section");
  assert.ok(exempt.has(11), "G5: an unclosed section runs to end of file");
}

// --- G6: the section ends at the next heading of the same or shallower level ---
{
  const doc = [
    "## Not collected", // 1
    "", // 2
    "- Health, fitness, or biometric identifiers.", // 3 — exempt
    "", // 4
    "## Retention", // 5 — same level, closes the section
    "Face ID sign-in makes the app faster to open.", // 6 — a false promise
  ].join("\n");

  assert.deepEqual(
    unsatisfiedMatches(doc, ["Not collected"]),
    [{ line: 6, term: "face id" }],
    "G6: a term on the first line after the closing heading must fail"
  );
}

// A shallower heading closes it too, not only an equal one.
{
  const doc = ["### Not requested", "No fingerprint sign-in.", "## Contact", "Touch ID is available."].join("\n");
  assert.deepEqual(unsatisfiedMatches(doc, ["Not requested"]), [{ line: 4, term: "touch id" }]);
}

// Headings are matched case-insensitively after trimming, and a declared heading
// that never appears is not an error — it means the document has no absences yet.
{
  const doc = ["  ##   not COLLECTED  ", "No biometric identifiers."].join("\n");
  assert.deepEqual(unsatisfiedMatches(doc, ["Not collected"]), []);
  assert.deepEqual(unsatisfiedMatches("Nothing to see here.", ["Not collected"]), []);
}

// A declared capability may be described: the rule is keyed on the allow-list, not
// on the term (scenario G7's prose half).
{
  const doc = "Face ID makes signing in faster.";
  assert.deepEqual(unsatisfiedMatches(doc, []), [{ line: 1, term: "face id" }]);
  assert.deepEqual(unsatisfiedMatches(doc, [], new Set(["NSFaceIDUsageDescription"])), []);
}

console.log("compliance-prose: all checks passed");
