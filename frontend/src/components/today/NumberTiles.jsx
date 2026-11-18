// Today's numbers (C8B): one row of four equal tiles, every number 2xl.
//   DIALS         "15 of 100" with a thin goal bar; EDIT (supervisors) changes
//                 the file's daily goal (the edit logic of the old
//                 DailyGoalTracker on the Leads page, moved here)
//   CONTACTS · CONNECT RATE · DUE (overdue + today, the overdue part muted)
import { useState } from 'react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import { useCampaign } from '../../hooks/useCampaign';
import { useAuth } from '../../hooks/useAuth';
import * as api from '../../lib/api';

const DEFAULT_GOAL = 100;

export const goalFrom = (campaign) => {
  const n = Number(campaign?.daily_goal);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GOAL;
};

function Tile({ label, action = null, children, testId }) {
  return (
    <Panel className="flex min-h-[7.5rem] flex-col p-4" data-testid={testId}>
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="label">{label}</span>
        {action}
      </div>
      <div className="mt-1 flex flex-1 flex-col justify-between gap-2">{children}</div>
    </Panel>
  );
}

const Big = ({ children }) => <p className="font-mono text-2xl font-medium tabular-nums text-foreground">{children}</p>;
const Sub = ({ children }) => <p className="font-mono text-xs tabular-nums text-muted-foreground">{children}</p>;

function DialsTile({ dials }) {
  const { active, refresh } = useCampaign();
  const { user } = useAuth();
  const canEdit = user?.role === 'supervisor'; // only a supervisor changes a file
  const goal = goalFrom(active);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal));
  const pct = goal > 0 ? Math.min(100, Math.round((dials / goal) * 100)) : 0;

  const saveGoal = (e) => {
    e.preventDefault();
    const next = Number(draft);
    if (Number.isInteger(next) && next > 0 && active) {
      api.updateCampaign(active.id, { dailyGoal: next }).then(refresh).catch(() => {});
    }
    setEditing(false);
  };

  const action =
    canEdit && !editing ? (
      <Button
        variant="ghost"
        size="sm"
        className="px-2"
        aria-label="Edit daily goal"
        onClick={() => {
          setDraft(String(goal));
          setEditing(true);
        }}
      >
        Edit
      </Button>
    ) : null;

  return (
    <Tile label="Dials" action={action} testId="tile-dials">
      {editing ? (
        <form onSubmit={saveGoal} className="flex items-center gap-2">
          <label htmlFor="daily-goal" className="label">
            Goal
          </label>
          <Field id="daily-goal" type="number" min="1" value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-8 w-20 py-1 font-mono tabular-nums" autoFocus />
          <Button type="submit" variant="solid" size="sm">
            Save
          </Button>
        </form>
      ) : (
        <p className="font-mono tabular-nums">
          <span className="text-2xl font-medium text-foreground">{dials}</span>
          <span className="text-sm text-muted-foreground"> of {goal}</span>
        </p>
      )}
      <div className="h-1 w-full bg-muted" role="meter" aria-label="Daily goal · dials" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={dials}>
        <div className="h-1 bg-foreground" style={{ width: `${pct}%` }} />
      </div>
    </Tile>
  );
}

export default function NumberTiles({ stats, due, overdue }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="numbers-strip">
      <DialsTile dials={stats.dials} />
      <Tile label="Contacts">
        <Big>{stats.contacts}</Big>
      </Tile>
      <Tile label="Connect rate">
        <Big>{stats.connectRate}%</Big>
      </Tile>
      <Tile label="Due">
        <Big>{due}</Big>
        <Sub>{overdue} overdue</Sub>
      </Tile>
    </div>
  );
}
