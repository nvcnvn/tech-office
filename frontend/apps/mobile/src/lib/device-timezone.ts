/**
 * The device's IANA timezone, for a ritual created on this phone.
 *
 * IANA rather than a UTC offset: `loadTimezone` in the scheduler tries `time.LoadLocation`
 * before parsing an offset string, and an offset zone does not observe daylight saving — a
 * 06:00 opening checklist defined in July in Europe/London would fire at 05:00 local from
 * November. Hermes on RN 0.83 ships Intl with timeZone on both platforms, so this needs no
 * dependency.
 */
export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
