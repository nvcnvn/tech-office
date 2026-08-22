---
name: building-native-ui
description: Repo-specific guide for designing and building professional mobile workspace UX with Expo Router. Covers target-user UX priorities, native patterns, styling, navigation, animations, and native tabs.
license: MIT
---

# Tech Office Mobile UX Guidelines

## References

Consult these resources as needed:

```
references/
  animations.md          Reanimated: entering, exiting, layout, scroll-driven, gestures
  controls.md            Native iOS: Switch, Slider, SegmentedControl, DateTimePicker, Picker
  form-sheet.md          Form sheets in expo-router: configuration, footers and background interaction. 
  gradients.md           CSS gradients via experimental_backgroundImage (New Arch only)
  icons.md               SF Symbols via expo-image (sf: source), names, animations, weights
  media.md               Camera, audio, video, and file saving
  route-structure.md     Route conventions, dynamic routes, groups, folder organization
  search.md              Search bar with headers, useSearch hook, filtering patterns
  storage.md             SQLite, AsyncStorage, SecureStore
  tabs.md                NativeTabs, migration from JS tabs, iOS 26 features
  toolbar-and-headers.md Stack headers and toolbar buttons, menus, search (iOS only)
  visual-effects.md      Blur (expo-blur) and liquid glass (expo-glass-effect)
  webgpu-three.md        3D graphics, games, GPU visualizations with WebGPU and Three.js
  zoom-transitions.md    Apple Zoom: fluid zoom transitions with Link.AppleZoom (iOS 18+)
```

## Product UX Priorities

This repo targets operational users, including low-tech workers. The model must optimize for clarity and completion speed, not feature density.

- Do not mirror the web workspace 1:1 on mobile. Mobile should prioritize the most frequent field workflows and quick status checks.
- Prefer task-first flows over feature-first menus. A user should immediately understand what they can do next.
- Reduce cognitive load aggressively. Fewer choices, fewer nested menus, fewer competing cards.
- Use explicit icon plus text labels for primary actions and navigation. Do not rely on icons alone for important actions.
- Keep interaction patterns consistent across screens. Similar lists, detail pages, forms, and action bars should behave the same way.
- Prefer progressive disclosure. Show the minimum needed to complete the current job, then reveal advanced options when needed.
- Every screen should have one obvious primary action. Secondary actions should be visually quieter and grouped.
- Favor high-visibility, practical layouts over decorative dashboard treatments.

## Workspace Visual Direction

Default to a professional workspace environment unless the user explicitly asks for a different aesthetic.

- Prefer a high-contrast light theme for primary business flows.
- Use neutral surfaces, restrained accent colors, subtle 1px borders, and clear visual hierarchy.
- Avoid playful consumer-app styling for core workflows: heavy gradients, oversized hero cards, glass overload, floating ornaments, and decorative motion.
- Use platform-native typography and weights. Prioritize readability and hierarchy over expressive branding.
- Components should feel systematic: consistent corner radius, spacing rhythm, border treatment, and pressed/disabled/loading states.
- Status colors should be semantic and restrained. Reserve saturated colors for alerts, destructive actions, or true priority states.
- Dense information is acceptable only when scanability stays high through spacing, grouping, and typographic contrast.

## Screen Composition Rules

- Start from the user's main job-to-be-done for that screen. Design around the task, not around showcasing modules.
- Prefer vertical flow with clear sections over complex nested layouts.
- Put the most important information and action in the first viewport.
- Lists should expose the few fields users actually scan. Push metadata and advanced controls into detail screens or bottom sheets.
- Forms should be broken into small logical groups with short labels, helpful defaults, and minimal required typing.
- Empty states should explain what the screen is for and provide the next action.
- Loading states should preserve layout structure and avoid large content jumps.
- Use summaries and chips sparingly; they should clarify status, not create noise.

## Navigation And IA Rules

- Top-level navigation should map to recurring jobs, not backend domains.
- Keep tab count low and labels explicit.
- Avoid deep navigation stacks when a sheet, picker, or focused follow-up screen will do.
- Search, filters, and sort controls should appear where they help completion, not by default on every screen.
- Destructive actions should never compete with primary actions in the same visual weight.

## Touch And Interaction Rules

- Ensure controls have comfortable tap targets. Header actions need a real 44x44 touch zone and should not sit flush against the safe-area corner.
- Prefer inline confirmation for low-risk actions and explicit confirmation for destructive or irreversible actions.
- Use haptics to reinforce success, toggle changes, and important confirmations, but keep them subtle.
- Motion should support comprehension: screen entry, list insertion, state change, and confirmation. Avoid decorative animation without UX value.
- Copy should be short, literal, and action-oriented. Prefer "Mark complete" over abstract or marketing-style labels.

## Design Review Checklist

When designing or refactoring a mobile screen, verify:

- Is the primary task obvious within 3 seconds?
- Can a first-time low-tech user complete the main action without guessing?
- Are icon-only actions limited to universally understood cases?
- Is the screen still clear with real business data and long names?
- Are component states consistent with the rest of the app?
- Is the layout usable with one hand and readable in bright environments?
- Is there unnecessary web-style density or a dashboard treatment that should be simplified?

## Running the App

**CRITICAL: Always try Expo Go first before creating custom builds.**

Most Expo apps work in Expo Go without any custom native code. Before running `npx expo run:ios` or `npx expo run:android`:

1. **Start with Expo Go**: Run `npx expo start` and scan the QR code with Expo Go
2. **Check if features work**: Test your app thoroughly in Expo Go
3. **Only create custom builds when required** - see below

### When Custom Builds Are Required

You need `npx expo run:ios/android` or `eas build` ONLY when using:

- **Local Expo modules** (custom native code in `modules/`)
- **Apple targets** (widgets, app clips, extensions via `@bacons/apple-targets`)
- **Third-party native modules** not included in Expo Go
- **Custom native configuration** that can't be expressed in `app.json`

### When Expo Go Works

Expo Go supports a huge range of features out of the box:

- All `expo-*` packages (camera, location, notifications, etc.)
- Expo Router navigation
- Most UI libraries (reanimated, gesture handler, etc.)
- Push notifications, deep links, and more

**If you're unsure, try Expo Go first.** Creating custom builds adds complexity, slower iteration, and requires Xcode/Android Studio setup.

## Code Style

- Be cautious of unterminated strings. Ensure nested backticks are escaped; never forget to escape quotes correctly.
- Always use import statements at the top of the file.
- Always use kebab-case for file names, e.g. `comment-card.tsx`
- Always remove old route files when moving or restructuring navigation
- Never use special characters in file names
- Configure tsconfig.json with path aliases, and prefer aliases over relative imports for refactors.

## Routes

See `./references/route-structure.md` for detailed route conventions.

- Routes belong in the `app` directory.
- Never co-locate components, types, or utilities in the app directory. This is an anti-pattern.
- Ensure the app always has a route that matches "/", it may be inside a group route.

## Library Preferences

- Never use modules removed from React Native such as Picker, WebView, SafeAreaView, or AsyncStorage
- Never use legacy expo-permissions
- `expo-audio` not `expo-av`
- `expo-video` not `expo-av`
- `expo-image` with `source="sf:name"` for SF Symbols, not `expo-symbols` or `@expo/vector-icons`
- `react-native-safe-area-context` not react-native SafeAreaView
- `process.env.EXPO_OS` not `Platform.OS`
- `React.use` not `React.useContext`
- `expo-image` Image component instead of intrinsic element `img`
- `expo-glass-effect` for liquid glass backdrops

## Responsiveness

- Always wrap root component in a scroll view for responsiveness
- Use `<ScrollView contentInsetAdjustmentBehavior="automatic" />` instead of `<SafeAreaView>` for smarter safe area insets
- `contentInsetAdjustmentBehavior="automatic"` should be applied to FlatList and SectionList as well
- Use flexbox instead of Dimensions API
- ALWAYS prefer `useWindowDimensions` over `Dimensions.get()` to measure screen size
- Large-title tab index screens should use automatic content inset adjustment on the root ScrollView, FlatList, or SectionList so first content stays below the header and notch

## Behavior

- Use expo-haptics conditionally on iOS to make more delightful experiences
- Use views with built-in haptics like `<Switch />` from React Native and `@react-native-community/datetimepicker`
- When a route belongs to a Stack, its first child should almost always be a ScrollView with `contentInsetAdjustmentBehavior="automatic"` set
- When adding a `ScrollView` to the page it should almost always be the first component inside the route component
- Prefer `headerSearchBarOptions` in Stack.Screen options to add a search bar
- Use the `<Text selectable />` prop on text containing data that could be copied
- Consider formatting large numbers like 1.4M or 38k
- Never use intrinsic elements like 'img' or 'div' unless in a webview or Expo DOM component

# Styling

Follow Apple Human Interface Guidelines.

## General Styling Rules

- Prefer flex gap over margin and padding styles
- Prefer padding over margin where possible
- Always account for safe area, either with stack headers, tabs, or ScrollView/FlatList `contentInsetAdjustmentBehavior="automatic"`
- Ensure both top and bottom safe area insets are accounted for
- Mobile tab bar height must use the runtime bottom inset, not a hardcoded home-indicator value
- Inline styles not StyleSheet.create unless reusing styles is faster
- Add entering and exiting animations for state changes
- Use `{ borderCurve: 'continuous' }` for rounded corners unless creating a capsule shape
- ALWAYS use a navigation stack title instead of a custom text element on the page
- When padding a ScrollView, use `contentContainerStyle` padding and gap instead of padding on the ScrollView itself (reduces clipping)
- CSS and Tailwind are not supported - use inline styles
- Prefer subtle separators and surface contrast over heavy shadows to define structure in workspace screens
- Reuse a small set of component recipes for cards, rows, filters, forms, banners, and action bars instead of inventing new compositions per screen

## Text Styling

- Add the `selectable` prop to every `<Text/>` element displaying important data or error messages
- Counters should use `{ fontVariant: 'tabular-nums' }` for alignment
- Favor short, literal labels and helper text. Do not use vague marketing copy in operational flows

## Shadows

Use CSS `boxShadow` style prop. NEVER use legacy React Native shadow or elevation styles.

```tsx
<View style={{ boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)" }} />
```

'inset' shadows are supported.

# Navigation

## Link

Use `<Link href="/path" />` from 'expo-router' for navigation between routes.

```tsx
import { Link } from 'expo-router';

// Basic link
<Link href="/path" />

// Wrapping custom components
<Link href="/path" asChild>
  <Pressable>...</Pressable>
</Link>
```

Whenever possible, include a `<Link.Preview>` to follow iOS conventions. Add context menus and previews frequently to enhance navigation.

## Stack

- ALWAYS use `_layout.tsx` files to define stacks
- Use Stack from 'expo-router/stack' for native navigation stacks

### Page Title

Set the page title in Stack.Screen options:

```tsx
<Stack.Screen options={{ title: "Home" }} />
```

## Context Menus

Add long press context menus to Link components:

```tsx
import { Link } from "expo-router";

<Link href="/settings" asChild>
  <Link.Trigger>
    <Pressable>
      <Card />
    </Pressable>
  </Link.Trigger>
  <Link.Menu>
    <Link.MenuAction
      title="Share"
      icon="square.and.arrow.up"
      onPress={handleSharePress}
    />
    <Link.MenuAction
      title="Block"
      icon="nosign"
      destructive
      onPress={handleBlockPress}
    />
    <Link.Menu title="More" icon="ellipsis">
      <Link.MenuAction title="Copy" icon="doc.on.doc" onPress={() => {}} />
      <Link.MenuAction
        title="Delete"
        icon="trash"
        destructive
        onPress={() => {}}
      />
    </Link.Menu>
  </Link.Menu>
</Link>;
```

## Link Previews

Use link previews frequently to enhance navigation:

```tsx
<Link href="/settings">
  <Link.Trigger>
    <Pressable>
      <Card />
    </Pressable>
  </Link.Trigger>
  <Link.Preview />
</Link>
```

Link preview can be used with context menus.

## Modal

Present a screen as a modal:

```tsx
<Stack.Screen name="modal" options={{ presentation: "modal" }} />
```

Prefer this to building a custom modal component.

## Sheet

Present a screen as a dynamic form sheet:

```tsx
<Stack.Screen
  name="sheet"
  options={{
    presentation: "formSheet",
    sheetGrabberVisible: true,
    sheetAllowedDetents: [0.5, 1.0],
    contentStyle: { backgroundColor: "transparent" },
  }}
/>
```

- Using `contentStyle: { backgroundColor: "transparent" }` makes the background liquid glass on iOS 26+.

## Common route structure

A standard app layout with tabs and stacks inside each tab:

```
app/
  _layout.tsx — <NativeTabs />
  (index,search)/
    _layout.tsx — <Stack />
    index.tsx — Main list
    search.tsx — Search view
```

```tsx
// app/_layout.tsx
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { Theme } from "../components/theme";

export default function Layout() {
  return (
    <Theme>
      <NativeTabs>
        <NativeTabs.Trigger name="(index)">
          <Icon sf="list.dash" />
          <Label>Items</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(search)" role="search" />
      </NativeTabs>
    </Theme>
  );
}
```

Create a shared group route so both tabs can push common screens:

```tsx
// app/(index,search)/_layout.tsx
import { Stack } from "expo-router/stack";
import { PlatformColor } from "react-native";

export default function Layout({ segment }) {
  const screen = segment.match(/\((.*)\)/)?.[1]!;
  const titles: Record<string, string> = { index: "Items", search: "Search" };

  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerLargeStyle: { backgroundColor: "transparent" },
        headerTitleStyle: { color: PlatformColor("label") },
        headerLargeTitle: true,
        headerBlurEffect: "none",
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name={screen} options={{ title: titles[screen] }} />
      <Stack.Screen name="i/[id]" options={{ headerLargeTitle: false }} />
    </Stack>
  );
}
```
