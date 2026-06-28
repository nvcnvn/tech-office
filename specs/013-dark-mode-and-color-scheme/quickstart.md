# Quickstart: Unified Color Scheme System with Light/Dark Mode

**Feature**: 013-dark-mode-and-color-scheme  
**Date**: 2025-11-09  
**Purpose**: Validate theme preference functionality through manual testing scenarios

## Prerequisites

1. **Backend Running**: `cd backend && go run cmd/main.go`
2. **Frontend Running**: `cd frontend && pnpm web dev`
3. **Database Migrated**: `cd backend && ./scripts/migrate.sh` (includes user_preference table)
4. **Test Organization**: Have at least one organization with test employees

## Test Scenarios

### Scenario 1: First Visit - OS Preference Detection (FR-017)

**Objective**: Verify system respects OS/browser color scheme preference on first visit

**Steps**:
1. **Setup**: Clear browser localStorage and cookies (simulate first-time user)
2. **Set OS to Dark Mode**: 
   - macOS: System Preferences → General → Appearance → Dark
   - Windows: Settings → Personalization → Colors → Dark
   - Linux: System theme settings
3. **Open Application**: Navigate to signin page
4. **Sign In**: Use test credentials
5. **Observe**:
   - ✅ Dark theme should be applied immediately (no flash of light theme)
   - ✅ Page background, text, components use dark colors
   - ✅ Theme toggle in header shows "dark" mode active

**Expected Result**:
- Application loads in dark mode
- No FOUT (Flash of Unstyled Theme)
- Console logs show: `Theme preference detected from OS: dark`
- localStorage contains: `theme_preference_{employee_id}: "dark"`
- Backend database: `user_preference` record with `theme_mode: 'dark'`, `preference_source: 'os_default'`

**Validation**:
```bash
# Check database
docker compose exec postgres psql -U postgres -d tech_office_db -c "
  SELECT employee_id, theme_mode, preference_source 
  FROM iam.user_preference 
  WHERE organization_id = 'YOUR_ORG_ID'
  LIMIT 5;
"
```

---

### Scenario 2: Manual Theme Toggle (FR-001, FR-003, FR-015, FR-016)

**Objective**: Verify theme toggle functionality with smooth transitions

**Steps**:
1. **Setup**: Start from Scenario 1 (dark mode active)
2. **Locate Toggle**: Find theme toggle button in header (sun/moon icon)
3. **Click Toggle**: Click the theme toggle button
4. **Observe Transition**:
   - ✅ Smooth 700ms transition (not instant, not jarring)
   - ✅ Colors gradually fade from dark to light
   - ✅ No layout shifts or flickering
   - ✅ Toggle icon updates (moon → sun)
5. **Verify Persistence**:
   - Open browser DevTools → Application → Local Storage
   - ✅ Check `theme_preference_{employee_id}` is now `"light"`
6. **Check Settings Page**:
   - Navigate to workspace/settings
   - ✅ Theme preference shows "Light" selected

**Expected Result**:
- Theme changes smoothly within 700ms
- All UI elements update (text, backgrounds, borders, shadows)
- localStorage updated immediately
- Database updated (check with query from Scenario 1)
- `preference_source` changed to `'manual'`

**Performance Check**:
- Open DevTools → Performance tab
- Record theme toggle action
- ✅ Main thread should not block > 100ms (NFR-001)

---

### Scenario 3: Cross-Page Consistency (FR-004)

**Objective**: Verify theme applies consistently across all application sections

**Steps**:
1. **Setup**: Set theme to dark mode
2. **Navigate Through Domains**:
   - workspace/organization (departments, employees)
   - workspace/chat (channels, messages)
   - workspace/notifications
   - workspace/search
3. **Verify Each Page**:
   - ✅ Background colors consistent
   - ✅ Text readable (proper contrast)
   - ✅ Buttons, inputs, cards all dark-themed
   - ✅ Icons and illustrations appropriate for dark mode
4. **Check Components**:
   - Data tables (sortable headers, rows)
   - Forms (inputs, dropdowns, checkboxes)
   - Dialogs and modals
   - Navigation sidebar
   - Header and user profile menu

**Expected Result**:
- Zero visual inconsistencies
- All components follow dark theme
- No "forgotten" components with wrong colors

---

### Scenario 4: Session Persistence (FR-011, FR-012)

**Objective**: Verify theme preference persists across sessions

**Steps**:
1. **Setup**: Set theme to dark mode
2. **Close Browser**: Completely quit browser (not just close tab)
3. **Reopen Browser**: Launch browser
4. **Navigate to Application**: Go to signin page
5. **Sign In**: Use same test credentials
6. **Observe**:
   - ✅ Dark theme applied immediately on load
   - ✅ No flash of light theme (FOUT prevention)
   - ✅ Theme persists from previous session

**Expected Result**:
- Theme preference survives browser restart
- localStorage value persists
- Database value unchanged

**Validation**:
```javascript
// Browser console
console.log(localStorage.getItem('theme_preference_YOUR_EMPLOYEE_ID'));
// Should output: "dark"
```

---

### Scenario 5: Cross-Device Sync (FR-013)

**Objective**: Verify theme preference syncs across multiple devices/sessions

**Steps**:
1. **Setup Device A**: Sign in, set theme to light mode
2. **Setup Device B**: Sign in with same account (different browser/device/tab)
3. **Device B Initial State**: Should show light mode (synced from server)
4. **Device A Action**: Change theme to dark mode
5. **Wait 30 seconds**: Allow polling interval to trigger
6. **Device B Observation**:
   - ✅ After ~30 seconds, theme automatically changes to dark
   - ✅ Smooth transition (same 700ms animation)
   - ✅ No user action required

**Expected Result**:
- Device B syncs theme change from Device A
- Sync latency: ~30 seconds (polling interval)
- Both devices show identical theme

**Advanced Test**:
- Open 3+ tabs/devices simultaneously
- Change theme on one device
- All others sync within 30-60 seconds

---

### Scenario 6: OS Preference Override Prevention (FR-018)

**Objective**: Verify manual selection is NOT overridden by OS preference changes

**Steps**:
1. **Setup**: OS in dark mode, application in light mode (manually selected)
2. **Verify Baseline**:
   - Database: `preference_source: 'manual'`
   - Application displays light theme
3. **Change OS Preference**: Switch OS to light mode
4. **Wait 5 seconds**: Give browser time to detect change
5. **Observe Application**:
   - ✅ Application STAYS in light mode (no change)
   - ✅ OS preference change ignored
   - ✅ Manual selection preserved

**Expected Result**:
- Manual theme selection takes precedence
- OS preference changes do NOT trigger theme updates
- `preference_source: 'manual'` acts as lock

**Contrast Test** (OS Default Behavior):
1. Clear preferences (reset to defaults)
2. Sign in (OS preference detected)
3. Change OS preference
4. Application SHOULD update to match OS (only when `preference_source: 'os_default'`)

---

### Scenario 7: WCAG AA Compliance (FR-008)

**Objective**: Verify color contrast ratios meet WCAG 2.1 Level AA

**Steps**:
1. **Install Tools**:
   - Chrome Extension: "axe DevTools" or "WAVE"
   - Manual: Use https://webaim.org/resources/contrastchecker/
2. **Test Light Theme**:
   - Run accessibility audit in DevTools
   - ✅ No contrast errors for normal text (4.5:1 minimum)
   - ✅ No contrast errors for large text (3:1 minimum)
3. **Test Dark Theme**:
   - Same checks as light theme
   - ✅ Dark backgrounds have sufficient contrast with light text
4. **Check Components**:
   - Buttons (default, hover, active states)
   - Form inputs (borders, labels, placeholders)
   - Links (visited, unvisited, hover)
   - Error messages (red text on background)
   - Success messages (green text on background)

**Expected Result**:
- Zero WCAG AA violations in both themes
- All text readable (no low-contrast "ghost" text)
- Interactive elements clearly visible

**Sample Checks**:
- Light theme body text: #000000 on #FFFFFF = 21:1 ✅
- Dark theme body text: #FFFFFF on #121212 = 15.8:1 ✅
- Primary button: Check foreground/background contrast

---

### Scenario 8: Flash of Wrong Theme Prevention (FR-005, NFR-002)

**Objective**: Verify no FOUT during initial page load

**Steps**:
1. **Setup**: Set theme to dark mode, sign out
2. **Throttle Network**: DevTools → Network → Slow 3G (simulate slow connection)
3. **Clear Cache**: Hard refresh (Cmd+Shift+R or Ctrl+Shift+R)
4. **Sign In**: Use test credentials
5. **Observe Load Sequence**:
   - ✅ Page renders immediately with dark theme
   - ✅ No flash of light theme before dark theme applies
   - ✅ Theme applied before React hydration completes
6. **Check Performance**:
   - Open DevTools → Performance → Record page load
   - ✅ Theme detection script runs < 20ms (synchronous, inline)
   - ✅ First Contentful Paint (FCP) shows correct theme

**Expected Result**:
- Dark theme visible from first paint
- No color flicker or flash
- Inline script prevents FOUT

**Validation** (View Page Source):
```html
<head>
  <script>
    (function() {
      const stored = localStorage.getItem('theme_preference_...');
      if (stored) {
        document.documentElement.setAttribute('data-theme', stored);
      }
      // ... OS preference fallback
    })();
  </script>
</head>
```

---

### Scenario 9: Settings Page Theme Control (FR-014)

**Objective**: Verify theme toggle accessible in both header and settings page

**Steps**:
1. **Header Toggle**:
   - Locate toggle in workspace header (top-right area)
   - ✅ Visible on all pages
   - ✅ Clickable, provides immediate feedback
2. **Settings Page Toggle**:
   - Navigate to workspace/settings
   - Click "Appearance" tab
   - ✅ Theme preference section visible
   - ✅ Radio buttons or toggle for light/dark
   - ✅ Current selection highlighted
3. **Sync Test**:
   - Change theme in settings page
   - ✅ Header toggle updates immediately
   - Navigate to header, change theme
   - Return to settings page
   - ✅ Settings page selection updated

**Expected Result**:
- Two theme controls stay in sync
- Both functional and accessible
- Settings page provides more explanation/context

---

### Scenario 10: Component Update Coverage (User Requirement)

**Objective**: Verify ALL existing components support theming

**Steps**:
1. **Create Checklist**: List all component types
   - [ ] Layout (header, sidebar, footer)
   - [ ] Navigation (tabs, links, breadcrumbs)
   - [ ] Forms (inputs, selects, checkboxes, radios, buttons)
   - [ ] Data display (tables, cards, lists, chips)
   - [ ] Feedback (alerts, snackbars, dialogs, tooltips)
   - [ ] Overlays (modals, drawers, popovers)
   - [ ] Media (avatars, badges, icons)
   - [ ] Organization domain components
   - [ ] Chat domain components
   - [ ] Notification components
2. **Test Each Component**:
   - Switch between light and dark themes
   - ✅ All components update colors
   - ✅ No hardcoded colors remaining
   - ✅ Proper contrast in both themes
3. **Edge Cases**:
   - Disabled states (buttons, inputs)
   - Error states (form validation)
   - Loading states (skeletons, spinners)
   - Empty states (no data messages)

**Expected Result**:
- 100% component coverage
- No visual inconsistencies
- All components follow theme palette

---

## Performance Validation

### Theme Toggle Performance (NFR-001)

**Objective**: Verify theme changes feel instantaneous

**Test**:
1. Open DevTools → Performance
2. Start recording
3. Click theme toggle
4. Stop recording after transition completes
5. **Analyze**:
   - ✅ Time to Interactive < 100ms
   - ✅ No long tasks (> 50ms)
   - ✅ Layout shifts minimal

**Expected Metrics**:
- Perceived latency: < 100ms
- Transition duration: 700ms
- Total time: < 800ms

### Initial Load Performance (NFR-002)

**Objective**: Verify theme preference loading doesn't block render

**Test**:
1. Open DevTools → Lighthouse
2. Run performance audit
3. **Check Metrics**:
   - ✅ First Contentful Paint (FCP) < 1.5s
   - ✅ Time to Interactive (TTI) < 3.5s
   - ✅ Largest Contentful Paint (LCP) < 2.5s
4. **Verify Theme Script**:
   - Inline script runs synchronously (< 20ms)
   - Does NOT block critical rendering path
   - Theme applied before React hydration

**Expected Result**:
- Lighthouse score: > 90
- No performance regression from theme system

---

## Rollback Validation

**Objective**: Verify clean rollback if issues discovered

**Steps**:
1. **Export Preferences** (backup):
   ```sql
   COPY iam.user_preference TO '/tmp/preferences_backup.csv' CSV HEADER;
   ```
2. **Revert Backend Deployment**: Roll back to previous version
3. **Run Down Migration**:
   ```bash
   cd backend && ./scripts/migrate.sh down
   ```
4. **Verify Rollback**:
   - ✅ Table dropped successfully
   - ✅ Application still functional (default light theme)
   - ✅ No errors in backend logs
5. **Frontend Revert**: Deploy previous frontend version
6. **Validation**:
   - ✅ Users see default theme (light mode)
   - ✅ No broken UI components
   - ✅ Can re-deploy fix and restore preferences from backup

---

## Success Criteria

**All scenarios must pass**:
- ✅ Scenario 1: OS preference detection works
- ✅ Scenario 2: Manual toggle functional with smooth transitions
- ✅ Scenario 3: Theme consistent across all pages
- ✅ Scenario 4: Session persistence works
- ✅ Scenario 5: Cross-device sync functional
- ✅ Scenario 6: Manual selection not overridden by OS
- ✅ Scenario 7: WCAG AA compliance verified
- ✅ Scenario 8: No FOUT detected
- ✅ Scenario 9: Both toggles functional and synced
- ✅ Scenario 10: All components themed correctly

**Performance criteria met**:
- ✅ Theme toggle < 100ms perceived latency
- ✅ 700ms smooth transitions
- ✅ No blocking on initial render
- ✅ Lighthouse score > 90

**Constitution compliance**:
- ✅ Integration tests pass in `backend/integration/theme_preference_test.go`
- ✅ Multi-tenant isolation verified (organization_id filters)
- ✅ Cross-stack constant alignment verified (DB, backend, frontend)

---

## Troubleshooting

**Issue**: FOUT visible on slow connections

**Solution**: Verify inline script in `<head>` runs before render

---

**Issue**: Cross-device sync not working

**Debug**:
```bash
# Check polling logs in browser console
# Check backend RPC logs
# Verify network requests every 30 seconds
```

---

**Issue**: Theme transition too fast or too slow

**Solution**: Adjust CSS transition duration in theme provider

---

**Issue**: Some components not themed

**Solution**: Search codebase for hardcoded colors:
```bash
cd frontend
grep -r "#1976d2" apps/web/src/  # Find hardcoded colors
grep -r "rgb(25," apps/web/src/
```

---

## Post-Implementation Checklist

- [ ] All 10 test scenarios pass
- [ ] Performance validation complete
- [ ] WCAG AA compliance verified
- [ ] Integration tests pass
- [ ] Component update coverage 100%
- [ ] Mobile theming guidelines documented
- [ ] Rollback procedure tested
- [ ] User documentation updated
- [ ] Backend logs show no errors
- [ ] Frontend console shows no warnings

**Ready for production deployment**: ✅
