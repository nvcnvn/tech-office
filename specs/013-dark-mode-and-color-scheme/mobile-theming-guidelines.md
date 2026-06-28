# Mobile Application Theming Guidelines

**Feature**: 013-dark-mode-and-color-scheme  
**Date**: 2025-11-09  
**Status**: Documentation Only (No Implementation Required)  
**Purpose**: Guidelines for future mobile application theme integration

---

## Overview

This document provides guidelines for implementing the unified color scheme system in future mobile applications (iOS, Android, React Native). The backend RPC service (`PreferenceService`) is already designed to support mobile clients - this document covers mobile-specific implementation patterns.

**Key Principles**:
- Reuse backend `PreferenceService` (no mobile-specific backend changes needed)
- Follow platform conventions (iOS Human Interface Guidelines, Material Design)
- Maintain visual consistency with web application
- Support platform-specific dark mode behaviors

---

## Architecture

### Dual Storage Pattern (Same as Web)

**Client-Side Storage** (Immediate Availability):
- **iOS**: `UserDefaults.standard`
- **Android**: `SharedPreferences`
- **React Native**: `AsyncStorage` or `@react-native-async-storage/async-storage`

**Server-Side Storage** (Cross-Device Sync):
- Backend: `iam.user_preference` table (already implemented)
- RPC: `PreferenceService` (already implemented)
- Same sync mechanism as web (30-second polling or push notifications)

**Storage Flow**:
```
User changes theme
  → Save to platform storage (instant)
  → RPC: UpdateUserPreference (background)
  → Other devices: Poll or receive push notification
  → Update local theme
```

---

## Platform Integration

### iOS (Swift/SwiftUI)

**System Theme Detection**:
```swift
// Detect current system theme
let userInterfaceStyle = UITraitCollection.current.userInterfaceStyle

switch userInterfaceStyle {
case .dark:
    // System is in dark mode
case .light:
    // System is in light mode
case .unspecified:
    // Use default (light)
}
```

**Theme Storage**:
```swift
// Save theme preference
UserDefaults.standard.set("dark", forKey: "theme_preference_\(employeeID)")

// Load theme preference
let savedTheme = UserDefaults.standard.string(forKey: "theme_preference_\(employeeID)")
```

**Theme Provider (SwiftUI)**:
```swift
class ThemeManager: ObservableObject {
    @Published var themeMode: ThemeMode = .light
    
    func loadTheme() {
        // 1. Load from UserDefaults (instant)
        if let saved = UserDefaults.standard.string(...) {
            self.themeMode = saved == "dark" ? .dark : .light
        } else {
            // 2. Detect system preference (first visit)
            self.themeMode = UITraitCollection.current.userInterfaceStyle == .dark ? .dark : .light
        }
        
        // 3. Sync with server (background)
        fetchServerPreference()
    }
    
    func toggleTheme() {
        themeMode = themeMode == .light ? .dark : .light
        saveThemePreference()
    }
}
```

**System Theme Monitoring**:
```swift
// Listen for system theme changes (only if preference_source == "os_default")
NotificationCenter.default.addObserver(
    forName: UITraitCollection.didChangeNotification,
    object: nil,
    queue: .main
) { _ in
    if preferenceSource == "os_default" {
        // Update theme to match system
    }
}
```

---

### Android (Kotlin/Jetpack Compose)

**System Theme Detection**:
```kotlin
// Detect system theme
val currentNightMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK

val isDarkMode = when (currentNightMode) {
    Configuration.UI_MODE_NIGHT_YES -> true
    Configuration.UI_MODE_NIGHT_NO -> false
    else -> false // Default to light
}
```

**Theme Storage**:
```kotlin
// Save theme preference
val prefs = getSharedPreferences("app_preferences", Context.MODE_PRIVATE)
prefs.edit()
    .putString("theme_preference_$employeeID", "dark")
    .apply()

// Load theme preference
val savedTheme = prefs.getString("theme_preference_$employeeID", null)
```

**Theme Provider (Jetpack Compose)**:
```kotlin
class ThemeViewModel : ViewModel() {
    private val _themeMode = MutableStateFlow(ThemeMode.LIGHT)
    val themeMode: StateFlow<ThemeMode> = _themeMode.asStateFlow()
    
    fun loadTheme() {
        // 1. Load from SharedPreferences (instant)
        val saved = sharedPrefs.getString("theme_preference_...", null)
        if (saved != null) {
            _themeMode.value = if (saved == "dark") ThemeMode.DARK else ThemeMode.LIGHT
        } else {
            // 2. Detect system preference (first visit)
            val isSystemDark = resources.configuration.uiMode and 
                Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
            _themeMode.value = if (isSystemDark) ThemeMode.DARK else ThemeMode.LIGHT
        }
        
        // 3. Sync with server (background)
        fetchServerPreference()
    }
    
    fun toggleTheme() {
        _themeMode.value = if (_themeMode.value == ThemeMode.LIGHT) {
            ThemeMode.DARK
        } else {
            ThemeMode.LIGHT
        }
        saveThemePreference()
    }
}

// In Composable
@Composable
fun AppTheme(
    viewModel: ThemeViewModel = viewModel(),
    content: @Composable () -> Unit
) {
    val themeMode by viewModel.themeMode.collectAsState()
    
    MaterialTheme(
        colorScheme = if (themeMode == ThemeMode.DARK) darkColorScheme() else lightColorScheme(),
        content = content
    )
}
```

**System Theme Monitoring**:
```kotlin
// Listen for system theme changes
override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    
    val nightModeFlags = newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK
    if (preferenceSource == "os_default") {
        when (nightModeFlags) {
            Configuration.UI_MODE_NIGHT_YES -> setTheme(ThemeMode.DARK)
            Configuration.UI_MODE_NIGHT_NO -> setTheme(ThemeMode.LIGHT)
        }
    }
}
```

---

### React Native

**System Theme Detection**:
```typescript
import { useColorScheme } from 'react-native';

function App() {
  const systemColorScheme = useColorScheme(); // 'light' | 'dark' | null
  
  // Use systemColorScheme as fallback for first visit
}
```

**Theme Storage** (AsyncStorage):
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Save theme preference
await AsyncStorage.setItem(`theme_preference_${employeeID}`, 'dark');

// Load theme preference
const savedTheme = await AsyncStorage.getItem(`theme_preference_${employeeID}`);
```

**Theme Provider** (React Context):
```typescript
import React, { createContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [theme, setTheme] = useState<ThemeMode>('light');
  
  useEffect(() => {
    loadTheme();
  }, []);
  
  const loadTheme = async () => {
    // 1. Load from AsyncStorage (instant)
    const saved = await AsyncStorage.getItem(`theme_preference_${employeeID}`);
    if (saved) {
      setTheme(saved as ThemeMode);
    } else {
      // 2. Use system preference (first visit)
      setTheme(systemColorScheme || 'light');
    }
    
    // 3. Sync with server (background)
    fetchServerPreference();
  };
  
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    AsyncStorage.setItem(`theme_preference_${employeeID}`, newTheme);
    saveToServer(newTheme);
  };
  
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

**System Theme Monitoring**:
```typescript
import { Appearance } from 'react-native';

// Listen for system theme changes
useEffect(() => {
  const subscription = Appearance.addChangeListener(({ colorScheme }) => {
    if (preferenceSource === 'os_default') {
      setTheme(colorScheme || 'light');
    }
  });
  
  return () => subscription.remove();
}, [preferenceSource]);
```

---

## Design Tokens Export

### From Web to Mobile

**Export Strategy**: Convert TypeScript theme tokens to JSON for mobile consumption

**Web Theme Tokens** (`frontend/packages/ui/src/theme/tokens.ts`):
```typescript
export const lightTheme = {
  palette: {
    primary: { main: '#1976d2', light: '#42a5f5', dark: '#1565c0' },
    secondary: { main: '#dc004e', light: '#f50057', dark: '#c51162' },
    background: { default: '#ffffff', paper: '#f5f5f5' },
    text: { primary: '#000000', secondary: '#666666' },
    // ...
  },
  spacing: 8,
  borderRadius: 4,
  // ...
};
```

**Export Script** (`scripts/export-theme-tokens.js`):
```javascript
import { lightTheme, darkTheme } from '../packages/ui/src/theme/tokens.ts';
import fs from 'fs';

const tokens = {
  light: lightTheme,
  dark: darkTheme,
};

fs.writeFileSync(
  'mobile-theme-tokens.json',
  JSON.stringify(tokens, null, 2)
);
```

**Mobile Import** (iOS):
```swift
// Load JSON tokens
if let path = Bundle.main.path(forResource: "mobile-theme-tokens", ofType: "json"),
   let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
   let tokens = try? JSONDecoder().decode(ThemeTokens.self, from: data) {
    // Use tokens.light or tokens.dark
}
```

**Mobile Import** (Android):
```kotlin
// Load JSON tokens
val json = resources.openRawResource(R.raw.mobile_theme_tokens)
    .bufferedReader()
    .use { it.readText() }
val tokens = Json.decodeFromString<ThemeTokens>(json)
```

---

## Cross-Device Sync

### Polling Approach (Simple)

**Implementation**:
```typescript
// Poll every 30 seconds
useEffect(() => {
  const interval = setInterval(async () => {
    const response = await preferenceClient.getUserPreference({});
    
    // Check if server preference differs from local
    if (response.preference?.themeMode !== localTheme) {
      // Update local theme
      setTheme(response.preference.themeMode);
      await AsyncStorage.setItem('theme_preference_...', response.preference.themeMode);
    }
  }, 30000); // 30 seconds
  
  return () => clearInterval(interval);
}, []);
```

**Pros**:
- Simple implementation
- Reuses existing RPC service
- No additional backend infrastructure

**Cons**:
- 30-second sync latency
- Unnecessary network requests if theme hasn't changed

---

### Push Notification Approach (Advanced)

**Implementation** (if real-time sync critical):
1. Backend emits theme change event to notification system
2. Firebase Cloud Messaging (FCM) or APNs sends silent push to mobile devices
3. Mobile app receives push, fetches updated preference
4. Apply new theme

**Backend Event Emission** (add to `UpdateUserPreference`):
```go
// After updating preference
if err := s.notificationLogic.PublishPreferenceChangeEvent(ctx, tx, params); err != nil {
    // Log error, don't fail the request
    slog.WarnContext(ctx, "failed to emit preference change event", "error", err)
}
```

**Mobile Push Handler**:
```swift
// iOS
func userNotificationCenter(_ center: UNUserNotificationCenter, 
                           didReceive response: UNNotificationResponse,
                           withCompletionHandler completionHandler: @escaping () -> Void) {
    if response.notification.request.content.categoryIdentifier == "preference_change" {
        // Fetch updated preference
        themeManager.syncWithServer()
    }
    completionHandler()
}
```

**Pros**:
- Real-time sync (< 5 seconds)
- Efficient (only when preference changes)

**Cons**:
- Adds complexity (push notification setup)
- Requires FCM/APNs configuration

**Recommendation**: Start with polling (simple), upgrade to push notifications if sync latency becomes issue.

---

## Platform-Specific Considerations

### iOS Specific

**Dark Mode Forced by System**:
- iOS allows users to force dark mode system-wide for all apps
- Respect user's manual app-level selection over system force
- Use `overrideUserInterfaceStyle` to enforce app theme

```swift
// Force app theme (ignore system override)
if preferenceSource == "manual" {
    window?.overrideUserInterfaceStyle = themeMode == .dark ? .dark : .light
}
```

**Dynamic Type Support**:
- Ensure theme colors work with iOS Dynamic Type (accessibility font sizes)
- Test light/dark themes at all accessibility text sizes

**Safe Area Insets**:
- Apply theme colors to safe area backgrounds
- Avoid white/black bands at top/bottom in notched devices

---

### Android Specific

**Force Dark Mode**:
- Android 10+ has system-level force dark mode
- Use `AppCompatDelegate.setDefaultNightMode()` to override

```kotlin
// Force app theme (ignore system override)
if (preferenceSource == "manual") {
    AppCompatDelegate.setDefaultNightMode(
        if (themeMode == ThemeMode.DARK) {
            AppCompatDelegate.MODE_NIGHT_YES
        } else {
            AppCompatDelegate.MODE_NIGHT_NO
        }
    )
}
```

**Material Design 3**:
- Use Material You dynamic colors (Android 12+)
- Ensure theme colors harmonize with user's wallpaper-based theme

**Edge-to-Edge Display**:
- Apply theme colors to system bars (status bar, navigation bar)
- Use `WindowInsetsController` for proper system bar theming

---

## Testing Guidelines

### Manual Testing Checklist

**iOS**:
- [ ] Theme toggle works in app
- [ ] Theme persists across app restarts
- [ ] System theme detection works on first launch
- [ ] Manual selection overrides system theme
- [ ] Cross-device sync works (test with another device)
- [ ] Works with iOS Dark Mode forced by system
- [ ] Safe area colors correct in light/dark
- [ ] Dynamic Type accessibility works in both themes

**Android**:
- [ ] Theme toggle works in app
- [ ] Theme persists across app restarts
- [ ] System theme detection works on first launch
- [ ] Manual selection overrides system theme
- [ ] Cross-device sync works (test with another device)
- [ ] Works with Android Force Dark Mode
- [ ] System bars (status/navigation) themed correctly
- [ ] Material You colors harmonize with theme

**React Native**:
- [ ] Theme toggle works (both iOS and Android)
- [ ] AsyncStorage persistence works
- [ ] System theme detection works (`useColorScheme`)
- [ ] Manual selection overrides system
- [ ] Cross-device sync works
- [ ] Platform-specific behaviors handled correctly

---

## WCAG AA Compliance (Mobile)

**Same Requirements as Web**:
- Normal text: 4.5:1 contrast ratio minimum
- Large text: 3:1 contrast ratio minimum
- Interactive elements: 3:1 contrast against background

**Mobile-Specific Considerations**:
- Small screens: Higher contrast preferred (easier readability)
- Outdoor usage: Light theme with high contrast for sunlight visibility
- Night usage: Dark theme with true blacks for OLED battery savings

**Testing Tools**:
- iOS: Accessibility Inspector (Xcode)
- Android: Accessibility Scanner
- Manual: Use contrast checker with extracted colors

---

## Future Enhancements

**Automatic Theme Switching** (Sunrise/Sunset):
- Use device location + time to switch theme automatically
- Add preference option: "Auto (follows time of day)"
- Backend: Store preference as `theme_mode: 'auto'`

**Custom Theme Colors** (Brand Theming):
- Allow organizations to define custom color palettes
- Store in `organization.custom_theme` table
- Apply organization theme on login

**High Contrast Mode**:
- Add third theme mode: `'high_contrast'`
- Increase contrast ratios beyond WCAG AA (AAA level)
- Useful for accessibility (low vision users)

**Theme Scheduling**:
- Allow users to schedule theme changes (e.g., dark mode at 8pm)
- Store schedule in `additional_preferences` JSONB field

---

## Summary

**Key Takeaways**:
1. Reuse backend `PreferenceService` (already supports mobile)
2. Use platform-specific storage (UserDefaults, SharedPreferences, AsyncStorage)
3. Follow dual-storage pattern (local + server sync)
4. Respect platform conventions (system theme detection)
5. Manual selection overrides system preference
6. Export design tokens from web theme for consistency
7. Start with polling sync (simple), upgrade to push if needed
8. Test on both platforms with accessibility tools

**No Backend Changes Required**: Mobile apps can integrate immediately using existing `PreferenceService` RPC endpoints.

---

**Document Status**: Documentation Complete  
**Implementation Status**: No mobile app exists yet - ready when needed  
**Backend Readiness**: ✅ PreferenceService supports mobile clients
