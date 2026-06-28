import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Link from 'next/link';

import { docsLastReviewed, evolvingFeatures, getFeatureAnchor, productFeatures } from '../content';

const statusColor = (status: string) => {
  if (status === 'Available now') return 'success';
  if (status === 'Role-dependent') return 'warning';
  if (status === 'Mobile in progress') return 'info';
  return 'default';
};

export default function FeaturesReferencePage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Paper
        sx={{
          p: { xs: 2.5, md: 3.5 },
          borderRadius: 5,
          bgcolor: 'var(--docs-panel-strong)',
          border: '1px solid var(--docs-line)',
          boxShadow: '0 24px 60px rgba(23, 32, 44, 0.07)',
        }}
      >
        <Stack spacing={1.25}>
          <Chip label={`Reviewed ${docsLastReviewed}`} size="small" sx={{ alignSelf: 'flex-start', bgcolor: 'var(--docs-accent-soft)', color: 'var(--docs-accent)' }} />
          <Typography variant="overline" sx={{ color: 'var(--docs-accent)', letterSpacing: '0.16em' }}>
            Lookup Index
          </Typography>
          <Typography variant="h1">Feature Reference</Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 820 }}>
            Use this page when you already know the capability you need. Each feature card shows what it does, what people commonly use it for, and which guide explains the full workflow.
          </Typography>
        </Stack>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
        {productFeatures.map((feature, index) => (
          <Box key={feature.title} id={getFeatureAnchor(feature.title)} sx={{ scrollMarginTop: 96 }}>
            <Accordion
              defaultExpanded={index < 2}
              disableGutters
              sx={{
                borderRadius: 4,
                overflow: 'hidden',
                border: '1px solid var(--docs-line)',
                bgcolor: 'rgba(255, 250, 242, 0.84)',
                boxShadow: '0 20px 50px rgba(23, 32, 44, 0.05)',
                '&:before': { display: 'none' },
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2.25, py: 0.5 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <Typography variant="h3">{feature.title}</Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label={feature.status} size="small" color={statusColor(feature.status)} sx={{ fontWeight: 700 }} />
                    <Chip label={feature.audience} size="small" variant="outlined" />
                    <Chip label={feature.platforms} size="small" variant="outlined" />
                    {feature.tags.slice(0, 4).map((tag) => (
                      <Chip key={tag} label={tag} size="small" sx={{ bgcolor: 'rgba(139, 77, 43, 0.08)' }} />
                    ))}
                  </Stack>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 2.25, pb: 2.25 }}>
                <Typography variant="body2" color="text.secondary" paragraph>{feature.summary}</Typography>
                <Divider sx={{ my: 2, borderColor: 'var(--docs-line)' }} />
                <Typography variant="h6" gutterBottom>Highlights</Typography>
                <Box component="ul" sx={{ pl: 2.5, mt: 0, mb: 2 }}>
                  {feature.highlights.map((item) => (
                    <Typography component="li" variant="body2" key={item} sx={{ mb: 0.75 }}>{item}</Typography>
                  ))}
                </Box>
                <Typography variant="h6" gutterBottom>Common tasks</Typography>
                <Box component="ul" sx={{ pl: 2.5, mt: 0 }}>
                  {feature.commonTasks.map((item) => (
                    <Typography component="li" variant="body2" key={item} sx={{ mb: 0.75 }}>{item}</Typography>
                  ))}
                </Box>
                <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>Related guides</Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {feature.relatedGuides.map((guide) => (
                    <Button key={guide.href} component={Link} href={guide.href} size="small" variant="outlined">
                      {guide.label}
                    </Button>
                  ))}
                </Stack>
                <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>Tags</Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {feature.tags.map((tag) => (
                    <Chip key={tag} label={tag} size="small" variant="outlined" />
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Box>
        ))}
      </Box>

      <Paper
        sx={{
          p: 3,
          borderRadius: 4,
          bgcolor: 'rgba(255, 255, 255, 0.56)',
          border: '1px solid var(--docs-line)',
        }}
      >
        <Typography variant="h3" gutterBottom>Evolving areas</Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          These are active iteration areas. They should be mentioned carefully in docs until parity and final behavior are verified.
        </Typography>
        <Box component="ul" sx={{ pl: 2.5, mb: 0 }}>
          {evolvingFeatures.map((item) => (
            <Typography component="li" variant="body2" key={item} sx={{ mb: 0.75 }}>{item}</Typography>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
