package preference

// Theme mode constants
// MUST align with:
// - Database CHECK constraint: iam.user_preference.theme_mode
// - Proto enum: rpc.v1.ThemeMode
// - Frontend TypeScript type: ThemeMode in packages/apis/src/types.ts
const (
	ThemeModeLight = "light"
	ThemeModeDark  = "dark"
)

// Preference source constants
// MUST align with:
// - Database CHECK constraint: iam.user_preference.preference_source
// - Proto enum: rpc.v1.PreferenceSource
// - Frontend TypeScript type: PreferenceSource in packages/apis/src/types.ts
const (
	PreferenceSourceManual    = "manual"
	PreferenceSourceOSDefault = "os_default"
)

// IsValidThemeMode checks if the given theme mode is valid
func IsValidThemeMode(mode string) bool {
	return mode == ThemeModeLight || mode == ThemeModeDark
}

// IsValidPreferenceSource checks if the given preference source is valid
func IsValidPreferenceSource(source string) bool {
	return source == PreferenceSourceManual || source == PreferenceSourceOSDefault
}
