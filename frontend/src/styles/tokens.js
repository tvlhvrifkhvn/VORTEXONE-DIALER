// The token table from docs/DESIGN.md section 1, for the /styleguide
// swatches. The live values are the CSS variables in globals.css; keep the
// two in step. Swatch classes are written out in full so Tailwind generates them.
export const TOKENS = [
  { name: '--background', cls: 'bg-background', ink: '#0E0E0E', paper: '#E4E4E2' },
  { name: '--card', cls: 'bg-card', ink: '#1A1A1A', paper: '#F2F2F0' },
  { name: '--muted', cls: 'bg-muted', ink: '#222220', paper: '#D6D6D3' },
  { name: '--foreground', cls: 'bg-foreground', ink: '#F2F2F0', paper: '#0E0E0E' },
  { name: '--muted-foreground', cls: 'bg-muted-foreground', ink: '#8A8A88', paper: '#5A5A58' },
  { name: '--border', cls: 'bg-border', ink: '#2E2E2C', paper: '#C4C4C0' },
  { name: '--border-strong', cls: 'bg-strong', ink: '#8A8A88', paper: '#0E0E0E' },
  { name: '--primary', cls: 'bg-primary', ink: '#FF4D1F', paper: '#FF4D1F' },
  { name: '--primary-foreground', cls: 'bg-primary-foreground', ink: '#0E0E0E', paper: '#0E0E0E' },
  { name: '--primary-border', cls: 'bg-primary-border', ink: '#FF4D1F', paper: '#0E0E0E' },
  { name: '--signal-text', cls: 'bg-signal', ink: '#FF4D1F', paper: '#0E0E0E' },
  { name: '--live', cls: 'bg-live', ink: '#1F9D55', paper: '#1F9D55' },
  { name: '--ring', cls: 'bg-foreground', ink: '#F2F2F0', paper: '#0E0E0E' },
  { name: '--meter-track', cls: 'bg-meter-track', ink: '#2E2E2C', paper: '#0E0E0E' },
];
