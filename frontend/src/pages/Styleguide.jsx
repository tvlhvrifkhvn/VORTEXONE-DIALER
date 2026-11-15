import { useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import Badge from '../components/ui/Badge';
import Keycap from '../components/ui/Keycap';
import SectionLabel from '../components/ui/SectionLabel';
import FileTag from '../components/ui/FileTag';
import StatusDot from '../components/ui/StatusDot';
import Meter from '../components/ui/Meter';
import Segmented from '../components/ui/Segmented';
import Dialog from '../components/ui/Dialog';
import StatCard from '../components/stats/StatCard';
import StatusBadge from '../components/leads/StatusBadge';
import AttemptBadge from '../components/leads/AttemptBadge';
import { STATUS_LABELS } from '../styles/theme';

// Hidden page (not in the nav): every primitive from docs/DESIGN.md, with
// sample data only. No API calls.

// Swatch classes are written out in full so Tailwind generates them.
const TOKENS = [
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

const SIZES = [
  { key: 'xs', cls: 'text-xs', spec: '12/16' },
  { key: 'sm', cls: 'text-sm', spec: '13/18' },
  { key: 'base', cls: 'text-base', spec: '14/20' },
  { key: 'lg', cls: 'text-lg', spec: '16/24' },
  { key: 'xl', cls: 'text-xl', spec: '20/28' },
  { key: '2xl', cls: 'text-2xl', spec: '28/32' },
  { key: 'display', cls: 'text-display', spec: '56/56' },
];

const ROWS = [
  { id: 1, name: 'Demo Agent 01', phone: '+1 (214) 555-0101', state: 'TX', attempts: 1, status: 'new' },
  { id: 2, name: 'Demo Agent 02', phone: '+1 (214) 555-0102', state: 'FL', attempts: 4, status: 'voicemail' },
  { id: 3, name: 'Demo Agent 03', phone: '+1 (214) 555-0103', state: 'CA', attempts: 2, status: 'callback_scheduled' },
  { id: 4, name: 'Demo Agent 04', phone: '+1 (214) 555-0104', state: 'TX', attempts: 5, status: 'cold' },
  { id: 5, name: 'Demo Agent 05', phone: '+1 (214) 555-0105', state: 'FL', attempts: 0, status: 'dnc' },
];

const dollars = (n) => `$${n}`;

function Section({ index, title, meta, children }) {
  return (
    <section className="mt-12">
      <SectionLabel index={index} title={title} meta={meta} />
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FieldLabel({ htmlFor, children }) {
  return (
    <label htmlFor={htmlFor} className="label mb-2 block">
      {children}
    </label>
  );
}

function Swatches({ theme }) {
  return (
    <div data-theme={theme} className="border bg-background p-4 text-foreground">
      <div className="label mb-4">{theme}</div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TOKENS.map((t) => (
          <li key={t.name} className="flex items-center gap-2">
            <span aria-hidden="true" className={`h-8 w-8 shrink-0 border border-strong ${t.cls}`} />
            <span className="min-w-0">
              <span className="block truncate font-mono text-xs">{t.name}</span>
              <span className="block font-mono text-xs text-muted-foreground">{t[theme]}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Styleguide() {
  const [demoTheme, setDemoTheme] = useState('ink');
  const [lines, setLines] = useState('1');
  const [selected, setSelected] = useState(new Set([2]));

  const toggleRow = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] px-6 pb-12">
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.01em]">Styleguide</h1>
        <p className="mt-2 text-muted-foreground">
          Every primitive in src/components/ui/, as set out in docs/DESIGN.md. Sample data only.
        </p>

        <Section index="01" title="Tokens" meta="INK · PAPER">
          <div className="grid gap-6 lg:grid-cols-2">
            <Swatches theme="ink" />
            <Swatches theme="paper" />
          </div>
        </Section>

        <Section index="02" title="Type">
          <NeuCard className="p-6">
            <ul className="space-y-4">
              {SIZES.map((s) => (
                <li key={s.key} className="flex items-baseline gap-6">
                  <span className="label w-24 shrink-0">
                    {s.key} {s.spec}
                  </span>
                  <span className={s.cls}>Vortex One Outreach</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-baseline gap-8 border-t pt-4">
              <span className="label">Label style · 12px mono</span>
              <span className="font-mono tabular-nums">+1 (214) 555-0101</span>
              <span className="font-mono tabular-nums">04:32</span>
              <span className="font-mono tabular-nums">$41.20</span>
            </div>
          </NeuCard>
        </Section>

        <Section index="03" title="Buttons">
          <NeuCard className="space-y-6 p-6">
            <div className="flex flex-wrap items-center gap-4">
              <NeuButton variant="primary">Start dialing →</NeuButton>
              <NeuButton>Export PDF ↓</NeuButton>
              <NeuButton variant="ghost">Log out</NeuButton>
              <NeuButton active aria-pressed="true">
                Pressed
              </NeuButton>
              <NeuButton disabled>Disabled</NeuButton>
              <NeuButton>⊘ DNC</NeuButton>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <NeuButton variant="primary" className="min-h-12 w-64">
                <Keycap>Esc</Keycap> End call
              </NeuButton>
              <NeuButton className="min-h-11">
                <Keycap>M</Keycap> Mute
              </NeuButton>
              <NeuButton className="min-h-11">
                <Keycap>V</Keycap> Voicemail
              </NeuButton>
              <NeuButton className="min-h-11">
                <Keycap>N</Keycap> No answer
              </NeuButton>
              <NeuButton className="min-h-11">
                <Keycap>D</Keycap> Outcome
              </NeuButton>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <Segmented
                label="Theme (display only)"
                options={[
                  { value: 'ink', label: 'Ink' },
                  { value: 'paper', label: 'Paper' },
                ]}
                value={demoTheme}
                onChange={setDemoTheme}
              />
              <Segmented
                label="Lines"
                options={[
                  { value: '1', label: '1' },
                  { value: '2', label: '2' },
                  { value: '3', label: '3' },
                ]}
                value={lines}
                onChange={setLines}
              />
            </div>
          </NeuCard>
        </Section>

        <Section index="04" title="Fields">
          <NeuCard className="grid gap-6 p-6 md:grid-cols-2">
            <div>
              <FieldLabel htmlFor="sg-name">Lead name</FieldLabel>
              <NeuInput id="sg-name" className="w-full" placeholder="Demo Agent 01" />
            </div>
            <div>
              <FieldLabel htmlFor="sg-state">State</FieldLabel>
              <NeuInput as="select" id="sg-state" className="w-full" defaultValue="TX">
                <option value="TX">TX</option>
                <option value="FL">FL</option>
                <option value="CA">CA</option>
              </NeuInput>
            </div>
            <div className="md:col-span-2">
              <FieldLabel htmlFor="sg-notes">Notes</FieldLabel>
              <NeuInput as="textarea" id="sg-notes" rows={3} className="w-full" placeholder="What did they say?" />
            </div>
            <div>
              <FieldLabel htmlFor="sg-phone">Phone</FieldLabel>
              <NeuInput
                id="sg-phone"
                className="w-full border-2 border-primary font-mono"
                defaultValue="+1 214 555"
                aria-invalid="true"
                aria-describedby="sg-phone-error"
              />
              <p id="sg-phone-error" className="mt-2 text-sm text-signal">
                <span className="label mr-2 text-signal">Error</span>Enter a 10-digit US number.
              </p>
            </div>
            <div>
              <FieldLabel htmlFor="sg-disabled">Brokerage</FieldLabel>
              <NeuInput id="sg-disabled" className="w-full opacity-40" disabled defaultValue="Keller Williams" />
            </div>
          </NeuCard>
        </Section>

        <Section index="05" title="Tags">
          <NeuCard className="space-y-6 p-6">
            <div className="flex flex-wrap gap-2">
              {Object.keys(STATUS_LABELS).map((s) => (
                <StatusBadge key={s} status={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <AttemptBadge attempts={2} maxAttempts={5} />
              <AttemptBadge attempts={4} maxAttempts={5} />
              <AttemptBadge attempts={5} maxAttempts={5} />
            </div>
            <div className="flex flex-wrap gap-6">
              <FileTag number={1} name="Real Estate" />
              <FileTag number={2} name="Insurance Supplementing" />
            </div>
            <div className="flex flex-wrap gap-6">
              <StatusDot tone="signal">Ringing</StatusDot>
              <StatusDot tone="live">Connected</StatusDot>
              <StatusDot tone="signal">REC</StatusDot>
            </div>
          </NeuCard>
        </Section>

        <Section index="06" title="Meters">
          <NeuCard className="grid gap-8 p-6 md:grid-cols-2">
            <Meter label="Daily goal" value={42} max={100} tone="goal" />
            <Meter label="Spend · Nov" value={24} max={60} tone="budget" format={dollars} />
            <Meter label="Spend · Nov" value={48} max={60} tone="budget" format={dollars} />
            <Meter label="Spend · Nov" value={60} max={60} tone="budget" format={dollars} />
          </NeuCard>
        </Section>

        <Section index="07" title="Stats">
          <div className="flex flex-wrap gap-4">
            <StatCard label="Dials today" value="42" size="display" />
            <StatCard label="Connected" value="11" hint="26% of dials" />
            <StatCard label="Talk time" value="1:48:20" />
          </div>
        </Section>

        <Section index="08" title="Table" meta={`${selected.size} SELECTED`}>
          <div className="max-h-80 overflow-auto border bg-card">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b">
                  <th className="label w-12 px-4 py-3 font-medium">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="label px-4 py-3 font-medium">Lead</th>
                  <th className="label px-4 py-3 font-medium">Phone</th>
                  <th className="label px-4 py-3 font-medium">State</th>
                  <th className="label px-4 py-3 text-right font-medium">Attempts</th>
                  <th className="label px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const on = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={`h-12 border-b border-l-[3px] hover:bg-muted ${
                        on ? 'border-l-primary bg-muted' : 'border-l-transparent'
                      }`}
                    >
                      <td className="px-4">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleRow(r.id)}
                          aria-label={`Select ${r.name}`}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                      <td className="px-4">{r.name}</td>
                      <td className="px-4 font-mono tabular-nums">{r.phone}</td>
                      <td className="px-4 font-mono">{r.state}</td>
                      <td className="px-4 text-right">
                        <AttemptBadge attempts={r.attempts} maxAttempts={5} />
                      </td>
                      <td className="px-4">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section index="09" title="Dialog">
          <Dialog inline title="End this call?" onClose={() => {}}>
            <p>The lead returns to the queue if you leave without an outcome.</p>
            <div className="mt-6 flex justify-end gap-4">
              <NeuButton>Keep talking</NeuButton>
              <NeuButton variant="primary">End call</NeuButton>
            </div>
          </Dialog>
        </Section>

        <Section index="10" title="Toast">
          <div role="status" className="inline-block border border-l-[3px] border-strong border-l-primary bg-card px-4 py-3 text-foreground">
            Callback saved for Tue 10:30 CST.
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
