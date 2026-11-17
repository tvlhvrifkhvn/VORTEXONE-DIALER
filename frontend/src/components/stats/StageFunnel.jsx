// Reports → STAGE FUNNEL (C6C): per file and period, how many leads reached
// each stage (at least that far), the conversion from the stage before,
// wins, lost, and cost per win once call rates are set.
import Panel from '../ui/Panel';
import SectionLabel from '../ui/SectionLabel';
import FileTag from '../ui/FileTag';
import { formatCents } from '../../lib/format';

function FileFunnel({ file, showFile }) {
  const top = file.stages[0]?.reached || 0;
  return (
    <Panel className="space-y-3 p-4">
      {showFile && <FileTag number={file.fileNumber} name={file.name} />}
      {top === 0 ? (
        <p className="text-sm text-muted-foreground">No stage changes in this period.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="label py-2 pr-2 font-medium">Stage</th>
              <th className="label w-1/3 py-2 pr-2 font-medium">Reached</th>
              <th className="label py-2 text-right font-medium">From previous</th>
            </tr>
          </thead>
          <tbody>
            {file.stages.map((s) => (
              <tr key={s.id} className="border-b last:border-b-0">
                <td className="py-2 pr-2 text-foreground">
                  {s.name}
                  {s.kind === 'won' && <span className="label ml-2">won</span>}
                </td>
                <td className="py-2 pr-2">
                  {/* The Meter's 8px bar (same tokens), with the count beside it. */}
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-right font-mono tabular-nums text-foreground">{s.reached}</span>
                    <div className="h-2 flex-1 bg-muted" aria-hidden="true">
                      <div className="h-2 bg-foreground" style={{ width: `${top ? Math.round((s.reached / top) * 100) : 0}%` }} />
                    </div>
                  </div>
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-foreground">{s.conversionPct === null ? '—' : `${s.conversionPct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="label">Wins</dt>
          <dd className="font-mono text-lg tabular-nums text-foreground">{file.wins}</dd>
        </div>
        <div>
          <dt className="label">Lost</dt>
          <dd className="font-mono text-lg tabular-nums text-foreground">{file.lost}</dd>
        </div>
        <div>
          <dt className="label">Cost per win</dt>
          <dd className="font-mono text-lg tabular-nums text-foreground">
            {!file.ratesSet ? <span className="text-sm text-muted-foreground">Rates not set</span> : file.costPerWinCents === null ? '—' : formatCents(file.costPerWinCents)}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

export default function StageFunnel({ data, index = '05' }) {
  const files = data?.files || [];
  return (
    <section className="space-y-2" data-testid="stage-funnel">
      <SectionLabel index={index} title="Stage funnel" meta={data?.period ? data.period.label : undefined} />
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files.</p>
      ) : (
        files.map((f) => <FileFunnel key={f.campaignId} file={f} showFile={files.length > 1} />)
      )}
    </section>
  );
}
