/**
 * Audio session handoff between the native call framework and LiveKit.
 *
 * One rule: **the call framework owns the audio session and the routing; LiveKit only
 * carries media.** Both frameworks want to own the session, and whichever loses produces
 * the classic "call connects but nobody can hear anything" bug. It is the single
 * highest-risk integration point in this feature, and it has no automated test — audio
 * routing on a locked screen with a Bluetooth headset is a physical-device question.
 *
 * What that means per platform:
 *
 * - **iOS.** CallKit activates the `AVAudioSession`, not the app. WebRTC must therefore
 *   run in manual-audio mode and start only when CallKit says the session is active. A
 *   WebRTC stack left to activate the session itself races CallKit and loses silently.
 *
 * - **Android.** Telecom owns routing. The app must never call
 *   `AudioManager#setCommunicationDevice` or `startBluetoothSco`; doing so fights the
 *   route Telecom has chosen and is the usual cause of audio that vanishes when a
 *   headset connects. Speaker and earpiece are requested *through* the call framework.
 */

import * as Calls from "expo-callkit-telecom";

/** The module returns expo-modules-core subscriptions; inferring the type from a
 *  listener keeps this file from depending on that package directly. */
type EventSubscription = ReturnType<typeof Calls.addAudioSessionActivatedListener>;

let audioSessionSubscriptions: EventSubscription[] = [];

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(`[call-audio] ${message}`, JSON.stringify(fields));
}

/**
 * Hands the audio session to the call framework for the call about to start.
 *
 * Called synchronously from the answer path, before the LiveKit join: the configuration
 * has to be in place before WebRTC touches the session, not after.
 */
export function configureCallAudioSession(): void {
  // false: this feature is audio-only. Video is out of scope, and claiming it here would
  // reserve a camera the call never uses.
  Calls.setRTCAudioSessionConfiguration(false);
  Calls.prepareAudioSessionForCall(false);

  if (audioSessionSubscriptions.length > 0) return;

  audioSessionSubscriptions = [
    Calls.addAudioSessionActivatedListener(() => {
      // This is the moment audio may start on iOS. Anything earlier is a race with
      // CallKit that ends in silence.
      log("audio session activated by the call framework");
    }),
    Calls.addAudioSessionDeactivatedListener(() => {
      log("audio session deactivated by the call framework");
    }),
    Calls.addAudioRouteChangedListener(({ currentRoute }) => {
      // A headset connecting or disconnecting mid-call. Nothing to do but observe: the
      // call framework has already moved the audio, and reacting would undo it. Logged
      // because "the call dropped when I unplugged my headphones" is otherwise
      // impossible to diagnose from a field report.
      log("audio route changed", {
        outputs: currentRoute?.outputs?.map((port) => port.portType),
      });
    }),
  ];
}

/** Releases the listeners when a call ends. The session itself is the framework's to
 *  tear down; restoring it here is what returns audio to whatever was playing before. */
export function releaseCallAudioSession(): void {
  audioSessionSubscriptions.forEach((subscription) => subscription.remove());
  audioSessionSubscriptions = [];
  Calls.restoreAudioSession();
}

/**
 * Routes call audio to the speaker, or back to the earpiece.
 *
 * Goes through the call framework rather than the platform audio manager, so the choice
 * is one the framework knows about and keeps across route changes.
 */
export function setCallSpeakerEnabled(enabled: boolean): void {
  Calls.setAudioSessionPortOverride(enabled);
  log("speaker override set", { enabled });
}
