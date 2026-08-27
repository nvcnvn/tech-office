/**
 * SFIcon — renders Ionicons as a substitute for SF Symbols
 *
 * expo-image@2.4.x does not support the `sf:` prefix for SF Symbols.
 * This component maps SF Symbol names to Ionicons equivalents.
 *
 * Usage:
 *   <SFIcon name="chevron.right" size={14} color={palette.text.disabled} />
 *   <SFIcon name="magnifyingglass" size={20} color={palette.primary.main} style={{ marginLeft: 4 }} />
 *
 * When expo-image is upgraded to a version that supports `sf:`, this
 * component can be removed and replaced with expo-image Image.
 */

import React from "react";
import { type ViewStyle, type StyleProp } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Maps SF Symbol names to Ionicons names.
 * Only symbols actually used in the app are mapped.
 */
const SF_TO_IONICONS: Record<string, IoniconsName> = {
  // Navigation
  "chevron.right": "chevron-forward",
  "chevron.left": "chevron-back",
  "chevron.down": "chevron-down",
  xmark: "close",
  "xmark.circle": "close-circle-outline",
  "xmark.circle.fill": "close-circle",

  // Chat
  "bubble.left": "chatbubble-outline",
  "bubble.left.fill": "chatbubble",
  "bubble.left.and.bubble.right": "chatbubbles-outline",
  "bubble.left.and.bubble.right.fill": "chatbubbles",
  "bubble.left.and.text.bubble.right": "chatbubbles-outline",
  "plus.bubble": "chatbubble-ellipses-outline",
  "plus.bubble.fill": "chatbubble-ellipses",
  envelope: "mail-outline",
  "envelope.fill": "mail",
  "paperplane.fill": "send",
  paperclip: "attach",
  at: "at",
  number: "text",
  lock: "lock-closed-outline",
  "lock.fill": "lock-closed",
  pin: "pin-outline",
  "pin.fill": "pin",
  "face.smiling": "happy-outline",
  "face.smiling.fill": "happy",
  "arrowshape.turn.up.left": "arrow-undo-outline",
  "arrowshape.turn.up.left.fill": "arrow-undo",
  "arrow.up": "arrow-up",
  phone: "call-outline",
  "phone.fill": "call",
  "phone.down.fill": "call",
  mic: "mic-outline",
  "mic.fill": "mic",
  "play.fill": "play",
  "pause.fill": "pause",
  "stop.fill": "stop-circle",

  // Tasks
  checkmark: "checkmark",
  "checkmark.circle": "checkmark-circle-outline",
  "checkmark.circle.fill": "checkmark-circle",
  "checkmark.square": "checkbox-outline",
  "checkmark.square.fill": "checkbox",
  "checkmark.square.trianglebadge.exclamationmark": "checkbox-outline",
  square: "square-outline",
  plus: "add",
  "plus.circle": "add-circle-outline",
  "plus.circle.fill": "add-circle",
  folder: "folder-outline",
  "folder.fill": "folder",
  flag: "flag-outline",
  "flag.fill": "flag",
  "text.bubble": "chatbox-outline",
  "text.bubble.fill": "chatbox",
  eye: "eye-outline",
  "eye.fill": "eye",
  "eye.slash": "eye-off-outline",
  "eye.slash.fill": "eye-off",
  "list.bullet.indent": "list",
  checklist: "list-outline",
  "arrow.right.circle": "arrow-forward-circle-outline",
  repeat: "repeat",
  "repeat.circle.fill": "sync-circle",

  // Calendar
  calendar: "calendar-outline",
  "calendar.fill": "calendar",
  "calendar.badge.clock": "calendar-outline",
  "calendar.badge.exclamationmark": "calendar-outline",
  "mappin.and.ellipse": "location-outline",
  clock: "time-outline",
  "clock.fill": "time",
  "person.2": "people-outline",
  "person.2.fill": "people",
  "person.text.rectangle": "person-outline",
  "hand.thumbsup": "thumbs-up-outline",
  "hand.thumbsup.fill": "thumbs-up",

  // Notifications
  bell: "notifications-outline",
  "bell.fill": "notifications",
  "bell.slash": "notifications-off-outline",
  "bell.slash.fill": "notifications-off",
  alarm: "alarm-outline",

  // People & Profile
  person: "person-outline",
  "person.fill": "person",
  "person.crop.circle": "person-circle-outline",
  "person.crop.circle.fill": "person-circle",
  "person.crop.circle.badge.checkmark": "person-circle-outline",
  "person.crop.rectangle": "card-outline",
  "person.badge.shield.checkmark": "shield-checkmark-outline",

  // More menu / Settings
  gear: "settings-outline",
  gearshape: "settings-outline",
  "gearshape.fill": "settings",
  "questionmark.circle": "help-circle-outline",
  "questionmark.circle.fill": "help-circle",
  "rectangle.portrait.and.arrow.right": "log-out-outline",
  magnifyingglass: "search",

  // Documents & Files
  doc: "document-outline",
  "doc.text": "document-text-outline",
  "doc.text.fill": "document-text",
  "doc.on.doc": "copy-outline",
  "doc.on.doc.fill": "copy",

  // Common actions
  pencil: "create-outline",
  camera: "camera-outline",
  "camera.fill": "camera",
  trash: "trash-outline",
  "trash.fill": "trash",

  // Compliance & safety (Feature 036)
  "hand.raised": "hand-left-outline",
  "hand.raised.fill": "hand-left",
  "hand.raised.slash": "hand-left-outline",
  "lock.shield": "shield-outline",
  "lock.shield.fill": "shield-checkmark",
  "person.crop.circle.badge.minus": "person-remove-outline",
  "square.and.arrow.up": "share-outline",
  "arrow.down.circle": "arrow-down-circle-outline",
  "arrow.clockwise": "refresh",
  "arrow.uturn.backward": "arrow-undo",
  "arrow.up.arrow.down": "swap-vertical",
  "line.3.horizontal.decrease": "filter",
  "info.circle": "information-circle-outline",
  "info.circle.fill": "information-circle",
  ellipsis: "ellipsis-horizontal",
  "ellipsis.circle": "ellipsis-horizontal-circle-outline",
  "ellipsis.circle.fill": "ellipsis-horizontal-circle",
  tray: "file-tray-outline",

  // Status
  "circle.fill": "ellipse",
  circle: "ellipse-outline",
  "moon.fill": "moon",
  "minus.circle": "remove-circle-outline",
  "minus.circle.fill": "remove-circle",
  "exclamationmark.circle": "alert-circle-outline",
  "exclamationmark.circle.fill": "alert-circle",
  "exclamationmark.triangle": "warning-outline",
  "exclamationmark.triangle.fill": "warning",
  "clock.badge.exclamationmark.fill": "alert-circle",

  // Misc
  "building.2": "business-outline",
  "building.2.fill": "business",
  keypad: "keypad-outline",
  "keypad.fill": "keypad",
  "wifi.slash": "cloud-offline-outline",
};

interface SFIconProps {
  /** SF Symbol name (without "sf:" prefix). */
  name: string;
  /** Icon size in dp. */
  size: number;
  /** Tint color. */
  color?: string;
  /** Additional style for the wrapping view. */
  style?: StyleProp<ViewStyle>;
}

export function SFIcon({ name, size, color, style }: SFIconProps) {
  const ioniconsName = SF_TO_IONICONS[name] ?? "help-outline";
  return (
    <Ionicons name={ioniconsName} size={size} color={color} style={style} />
  );
}
