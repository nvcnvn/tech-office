/**
 * Self-check for the device timezone read. Run with `npm run check:device-timezone`.
 *
 * The failure this guards is silent and seasonal: if the read throws or returns an empty
 * string and we send that through, a ritual is scheduled in a zone nobody chose and the
 * drift only shows up when daylight saving moves.
 */

import assert from "node:assert/strict";

import { getDeviceTimezone } from "./device-timezone.ts";

// A working Intl returns a non-empty IANA name.
{
  const zone = getDeviceTimezone();
  assert.equal(typeof zone, "string");
  assert.ok(zone.length > 0, "a timezone is never an empty string");
}

// A throwing Intl falls back to UTC rather than propagating.
{
  const realIntl = globalThis.Intl;
  try {
    // @ts-expect-error — deliberately replacing Intl for the duration of the check.
    globalThis.Intl = {
      DateTimeFormat() {
        throw new Error("no Intl on this runtime");
      },
    };
    assert.equal(getDeviceTimezone(), "UTC", "a throwing Intl falls back to UTC");
  } finally {
    globalThis.Intl = realIntl;
  }
}

// An Intl that resolves no zone at all also falls back rather than sending "".
{
  const realIntl = globalThis.Intl;
  try {
    // @ts-expect-error — deliberately replacing Intl for the duration of the check.
    globalThis.Intl = {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "" }) }),
    };
    assert.equal(getDeviceTimezone(), "UTC", "an unresolved zone falls back to UTC");
  } finally {
    globalThis.Intl = realIntl;
  }
}

console.log("device-timezone: ok");
