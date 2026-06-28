'use client';

import { useMemo, useState } from 'react';
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Chip,
  InputAdornment,
  List,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  docNavGroups,
  employeeGuideSections,
  getFeatureAnchor,
  ownerGuideSections,
  productFeatures,
} from '../content';

const normalize = (value: string) => value.toLowerCase().trim();

type SearchEntry = {
  href: string;
  title: string;
  category: string;
  summary: string;
  tags: string[];
  personas: string[];
  searchText: string;
};

const matchesQuery = (entry: SearchEntry, query: string) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return false;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const combined = normalize([entry.title, entry.category, entry.summary, entry.searchText, ...entry.tags, ...entry.personas].join(' '));

  return combined.includes(normalizedQuery) || queryTokens.every((token) => combined.includes(token));
};

const searchScore = (entry: SearchEntry, query: string) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return 0;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const title = normalize(entry.title);
  const summary = normalize(entry.summary);
  const category = normalize(entry.category);
  const tags = entry.tags.map(normalize);
  const combined = normalize([entry.title, entry.summary, entry.searchText, ...entry.tags, ...entry.personas].join(' '));

  if (!matchesQuery(entry, normalizedQuery)) {
    return 0;
  }

  let score = 0;

  if (title === normalizedQuery) score += 20;
  if (title.startsWith(normalizedQuery)) score += 12;
  if (title.includes(normalizedQuery)) score += 8;
  if (summary.includes(normalizedQuery)) score += 5;
  if (category.includes(normalizedQuery)) score += 3;
  if (tags.some((tag) => tag === normalizedQuery)) score += 7;

  score += queryTokens.reduce((tokenScore, token) => {
    let tokenPoints = 0;
    if (title.includes(token)) tokenPoints += 4;
    if (summary.includes(token)) tokenPoints += 2;
    if (tags.some((tag) => tag.includes(token))) tokenPoints += 2;
    if (combined.includes(token)) tokenPoints += 1;
    return tokenScore + tokenPoints;
  }, 0);

  return score;
};

export function DocsNavigation() {
  const pathname = usePathname();
  const [query, setQuery] = useState('');

  const searchEntries = useMemo<SearchEntry[]>(() => {
    const overviewEntries: SearchEntry[] = [
      {
        href: '/docs',
        title: 'Docs overview',
        category: 'Start Here',
        summary: 'Learn how to use the docs by role, workflow, and feature lookup.',
        tags: ['overview', 'quickstart', 'search', 'workflow'],
        personas: ['Both'],
        searchText: 'owner admin employee feature reference how to use docs start here',
      },
      {
        href: '/docs/features',
        title: 'Feature Reference',
        category: 'Feature Reference',
        summary: 'Look up capabilities, common tasks, and related workflow guides.',
        tags: ['reference', 'lookup', 'features'],
        personas: ['Both'],
        searchText: 'feature lookup capability index common tasks related guides',
      },
    ];

    const ownerEntries = ownerGuideSections.map((section) => ({
      href: `/docs/guides/owner#${getFeatureAnchor(section.title)}`,
      title: section.title,
      category: 'Owner / IT Admin',
      summary: section.summary,
      tags: section.tags,
      personas: ['Owner / IT Admin'],
      searchText: [section.example, ...section.steps, ...section.relatedFeatures.map((feature) => feature.label)].join(' '),
    }));

    const employeeEntries = employeeGuideSections.map((section) => ({
      href: `/docs/guides/employee#${getFeatureAnchor(section.title)}`,
      title: section.title,
      category: 'Employee',
      summary: section.summary,
      tags: section.tags,
      personas: ['Employee'],
      searchText: [section.example, ...section.steps, ...section.relatedFeatures.map((feature) => feature.label)].join(' '),
    }));

    const featureEntries = productFeatures.map((feature) => ({
      href: `/docs/features#${getFeatureAnchor(feature.title)}`,
      title: feature.title,
      category: 'Feature Reference',
      summary: feature.summary,
      tags: feature.tags,
      personas: [feature.audience],
      searchText: [...feature.highlights, ...feature.commonTasks, ...feature.relatedGuides.map((guide) => guide.label), feature.platforms, feature.status].join(' '),
    }));

    return [...overviewEntries, ...ownerEntries, ...employeeEntries, ...featureEntries];
  }, []);

  const filteredGroups = useMemo(() => {
    return docNavGroups;
  }, []);

  const searchResults = useMemo(() => {
    const normalizedQuery = normalize(query);

    if (!normalizedQuery) {
      return [];
    }

    return searchEntries
      .map((entry) => ({ entry, score: searchScore(entry, normalizedQuery) }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title))
      .slice(0, 18)
      .map((result) => result.entry);
  }, [query, searchEntries]);

  return (
    <Box
      component="nav"
      aria-label="Documentation navigation"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Box
        sx={{
          p: 1.25,
          borderRadius: 2,
          border: '1px solid var(--docs-line)',
          bgcolor: '#fdfcf6',
        }}
      >
        <TextField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks, steps, tags, or features"
          aria-label="Search documentation"
          size="small"
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 1.5,
              bgcolor: '#fffdf7',
            },
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Searches guide titles, examples, steps, common tasks, and tags.
        </Typography>
      </Box>

      {query ? (
        searchResults.length === 0 ? (
          <Box sx={{ p: 2, border: '1px solid var(--docs-line)', borderRadius: 2, bgcolor: '#fffdf7' }}>
            <Typography variant="body2" color="text.secondary">
              No docs match that search.
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              borderRadius: 2,
              overflow: 'hidden',
              border: '1px solid var(--docs-line)',
              bgcolor: '#fffdf7',
              boxShadow: '0 12px 24px rgba(15,23,42,0.04)',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 1.25, bgcolor: '#f7f8f4' }}>
              <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.14em' }}>
                Search Results
              </Typography>
              <Chip label={searchResults.length} size="small" variant="outlined" />
            </Stack>
            <List disablePadding>
              {searchResults.map((result, index) => {
                const itemPath = result.href.split('#')[0];
                const selected = pathname === itemPath;

                return (
                  <ListItemButton
                    key={result.href}
                    component={Link}
                    href={result.href}
                    selected={selected}
                    sx={{
                      alignItems: 'flex-start',
                      flexDirection: 'column',
                      gap: 0.75,
                      px: 1.5,
                      py: 1.25,
                      borderTop: index === 0 ? '1px solid transparent' : '1px solid var(--docs-line)',
                      borderLeft: selected ? '4px solid var(--docs-accent-ink)' : '4px solid transparent',
                      bgcolor: selected ? 'rgba(217, 233, 143, 0.28)' : 'transparent',
                      transition: 'background-color 150ms ease, transform 150ms ease',
                      '&:hover': {
                        bgcolor: 'rgba(217, 233, 143, 0.18)',
                        transform: 'translateX(2px)',
                      },
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: '100%' }}>
                      <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--docs-ink)' }}>
                        {result.title}
                      </Typography>
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
                        <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700 }}>
                          {result.category}
                        </Typography>
                        <LaunchRoundedIcon fontSize="small" />
                      </Stack>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', width: '100%' }}>
                      {result.summary}
                    </Typography>
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                      {result.personas.map((persona) => (
                        <Chip key={persona} label={persona} size="small" variant="outlined" />
                      ))}
                      {result.tags.slice(0, 3).map((tag) => (
                        <Chip key={tag} label={tag} size="small" sx={{ bgcolor: 'rgba(217, 233, 143, 0.24)' }} />
                      ))}
                    </Stack>
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        )
      ) : (
        filteredGroups.map((group) => (
          <Box
            key={group.title}
            sx={{
              borderRadius: 2,
              overflow: 'hidden',
              border: '1px solid var(--docs-line)',
              bgcolor: '#fffdf7',
              boxShadow: '0 12px 24px rgba(15,23,42,0.04)',
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ px: 1.5, py: 1.25, bgcolor: '#f7f8f4' }}
            >
              <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.14em' }}>
                {group.title}
              </Typography>
              <Chip label={group.items.length} size="small" variant="outlined" />
            </Stack>
            <List disablePadding>
              {group.items.map((item, index) => {
                const itemPath = item.href.split('#')[0];
                const selected = pathname === itemPath;

                return (
                  <ListItemButton
                    key={item.href}
                    component={Link}
                    href={item.href}
                    selected={selected}
                    sx={{
                      alignItems: 'flex-start',
                      flexDirection: 'column',
                      gap: 0.75,
                      px: 1.5,
                      py: 1.25,
                      borderTop: index === 0 ? '1px solid transparent' : '1px solid var(--docs-line)',
                      borderLeft: selected ? '4px solid var(--docs-accent-ink)' : '4px solid transparent',
                      bgcolor: selected ? 'rgba(217, 233, 143, 0.28)' : 'transparent',
                      transition: 'background-color 150ms ease, transform 150ms ease',
                      '&:hover': {
                        bgcolor: 'rgba(217, 233, 143, 0.18)',
                        transform: 'translateX(2px)',
                      },
                    }}
                  >
                    <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--docs-ink)' }}>
                      {item.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.description}
                    </Typography>
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                      {item.personas.map((persona) => (
                        <Chip key={persona} label={persona} size="small" variant="outlined" />
                      ))}
                      {item.tags.slice(0, 3).map((tag) => (
                        <Chip key={tag} label={tag} size="small" sx={{ bgcolor: 'rgba(217, 233, 143, 0.24)' }} />
                      ))}
                    </Stack>
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        ))
      )}
    </Box>
  );
}
