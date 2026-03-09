import { useState, useMemo } from 'react';
import {
  toCents,
  formatMoney,
  computeTransferPlan,
  validateTargets,
} from './engine';

// ─── Helpers ───────────────────────────────────────────────
let nextId = 1;
function makeAccount(name = '', balance = '', status = 'keep') {
  return { id: nextId++, name, balance, status };
}

function makeTarget(name, targetType = 'percentage', targetValue = '') {
  return { name, targetType, targetValue };
}

function parseDollarInput(val) {
  if (typeof val === 'number') return val;
  return parseFloat(String(val).replace(/[$,]/g, '')) || 0;
}

// ─── Step 1: Current State ─────────────────────────────────
function CurrentState({ accounts, setAccounts }) {
  const totalCents = accounts.reduce((s, a) => s + (a.status === 'new' ? 0 : toCents(parseDollarInput(a.balance))), 0);

  const updateAccount = (id, field, value) => {
    setAccounts(prev => prev.map(a => (a.id === id ? { ...a, [field]: value } : a)));
  };

  const addAccount = () => {
    setAccounts(prev => [...prev, makeAccount()]);
  };

  const removeAccount = (id) => {
    setAccounts(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Step 1: Current State</h2>
      <p className="text-sm text-gray-500 mb-4">
        Enter your existing accounts, their balances, and whether each will be kept, closed, or is new.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 pr-2">Account Name</th>
              <th className="pb-2 pr-2">Current Balance</th>
              <th className="pb-2 pr-2">Status</th>
              <th className="pb-2 pr-2">% of Total</th>
              <th className="pb-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(acct => {
              const cents = acct.status === 'new' ? 0 : toCents(parseDollarInput(acct.balance));
              const pct = totalCents > 0 ? ((cents / totalCents) * 100).toFixed(1) : '0.0';
              return (
                <tr key={acct.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      className="w-full border rounded px-2 py-1"
                      placeholder="Account name"
                      value={acct.name}
                      onChange={e => updateAccount(acct.id, 'name', e.target.value)}
                      aria-label="Account name"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    {acct.status === 'new' ? (
                      <span className="text-gray-400 italic px-2">$0.00 (new)</span>
                    ) : (
                      <input
                        type="text"
                        className="w-full border rounded px-2 py-1 text-right"
                        placeholder="$0.00"
                        value={acct.balance}
                        onChange={e => updateAccount(acct.id, 'balance', e.target.value)}
                        aria-label="Current balance"
                      />
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      className="border rounded px-2 py-1"
                      value={acct.status}
                      onChange={e => updateAccount(acct.id, 'status', e.target.value)}
                      aria-label="Account status"
                    >
                      <option value="keep">Keep</option>
                      <option value="close">Close</option>
                      <option value="new">New</option>
                    </select>
                  </td>
                  <td className="py-2 pr-2 text-right text-gray-500">{pct}%</td>
                  <td className="py-2">
                    <button
                      onClick={() => removeAccount(acct.id)}
                      className="text-red-400 hover:text-red-600 px-1"
                      aria-label="Remove account"
                      title="Remove"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4">
        <button
          onClick={addAccount}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
        >
          + Add Account
        </button>
        <div className="text-sm font-medium text-gray-700">
          Total Pool: <span className="font-bold">{formatMoney(totalCents)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Target State ──────────────────────────────────
function TargetState({ accounts, targets, setTargets }) {
  const totalPoolCents = accounts.reduce(
    (s, a) => s + (a.status === 'new' ? 0 : toCents(parseDollarInput(a.balance))),
    0
  );

  const destinationAccounts = accounts.filter(a => a.status !== 'close');

  // Sync targets when accounts change
  const syncedTargets = useMemo(() => {
    const result = [];
    for (const acct of destinationAccounts) {
      const existing = targets.find(t => t.name === acct.name);
      result.push(existing || makeTarget(acct.name));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationAccounts.map(a => a.name).join(',')]);

  // Update parent if synced list changed
  useMemo(() => {
    if (JSON.stringify(syncedTargets) !== JSON.stringify(targets)) {
      setTargets(syncedTargets);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedTargets]);

  const accountsForEngine = accounts.map(a => ({
    name: a.name,
    balanceCents: a.status === 'new' ? 0 : toCents(parseDollarInput(a.balance)),
    status: a.status,
  }));

  const validation = validateTargets(accountsForEngine, targets);

  const updateTarget = (name, field, value) => {
    setTargets(prev =>
      prev.map(t => (t.name === name ? { ...t, [field]: value } : t))
    );
  };

  const distributeEvenly = () => {
    const unset = targets.filter(
      t => t.targetType === 'percentage' && (!t.targetValue || t.targetValue === 0)
    );
    const setPercent = targets
      .filter(t => t.targetType === 'percentage' && t.targetValue > 0)
      .reduce((s, t) => s + parseFloat(t.targetValue), 0);

    const availablePercent = 100 - setPercent;

    if (unset.length > 0 && availablePercent > 0) {
      const each = Math.round((availablePercent / unset.length) * 100) / 100;
      setTargets(prev =>
        prev.map(t => {
          if (t.targetType === 'percentage' && (!t.targetValue || t.targetValue === 0)) {
            return { ...t, targetValue: each };
          }
          return t;
        })
      );
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Step 2: Target State</h2>
      <p className="text-sm text-gray-500 mb-4">
        Set the desired allocation for each account that will remain after transfers.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 pr-2">Account Name</th>
              <th className="pb-2 pr-2">Target Type</th>
              <th className="pb-2 pr-2">Target Value</th>
              <th className="pb-2 pr-2">Target $</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(t => {
              const targetCents = validation.targetMap?.get(t.name) || 0;
              const impliedPct =
                totalPoolCents > 0 ? ((targetCents / totalPoolCents) * 100).toFixed(2) : '0.00';
              return (
                <tr key={t.name} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 font-medium">{t.name}</td>
                  <td className="py-2 pr-2">
                    <select
                      className="border rounded px-2 py-1"
                      value={t.targetType}
                      onChange={e => updateTarget(t.name, 'targetType', e.target.value)}
                      aria-label="Target type"
                    >
                      <option value="percentage">Percentage</option>
                      <option value="dollar">Dollar Amount</option>
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-1">
                      {t.targetType === 'dollar' && <span className="text-gray-400">$</span>}
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-32 border rounded px-2 py-1 text-right"
                        value={t.targetValue}
                        onChange={e =>
                          updateTarget(t.name, 'targetValue', parseFloat(e.target.value) || '')
                        }
                        aria-label="Target value"
                      />
                      {t.targetType === 'percentage' && <span className="text-gray-400">%</span>}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right text-gray-500">
                    {formatMoney(targetCents)}
                    {t.targetType === 'dollar' && (
                      <span className="text-xs ml-1">({impliedPct}%)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {validation.warnings?.map((w, i) => (
        <div key={i} className="mt-2 text-amber-600 text-sm bg-amber-50 rounded px-3 py-2">
          {w}
        </div>
      ))}

      {!validation.valid && validation.message && (
        <div className="mt-3 text-red-600 text-sm bg-red-50 rounded px-3 py-2">
          {validation.message}
        </div>
      )}

      {validation.valid && (
        <div className="mt-3 text-green-600 text-sm bg-green-50 rounded px-3 py-2">
          Targets are valid. Total: {formatMoney(validation.totalTargetCents)}
        </div>
      )}

      <div className="mt-4">
        <button
          onClick={distributeEvenly}
          className="text-sm text-blue-600 hover:text-blue-800 underline"
        >
          Distribute remaining evenly
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Constraints ───────────────────────────────────
function Constraints({ constraints, setConstraints, surplusCount }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Step 3: Constraints</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Maximum Transfers</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max={Math.max(surplusCount, 1)}
              value={constraints.maxTransfers || surplusCount || 1}
              onChange={e =>
                setConstraints(prev => ({ ...prev, maxTransfers: parseInt(e.target.value) }))
              }
              className="flex-1"
              aria-label="Maximum transfers"
            />
            <span className="text-sm font-mono w-8 text-center">
              {constraints.maxTransfers || 'No limit'}
            </span>
            <label className="text-sm flex items-center gap-1">
              <input
                type="checkbox"
                checked={!constraints.maxTransfers}
                onChange={e =>
                  setConstraints(prev => ({
                    ...prev,
                    maxTransfers: e.target.checked ? null : (surplusCount || 1),
                  }))
                }
              />
              No limit
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Tolerance</label>
          <div className="flex items-center gap-3">
            <select
              className="border rounded px-2 py-1 text-sm"
              value={constraints.toleranceType}
              onChange={e =>
                setConstraints(prev => ({ ...prev, toleranceType: e.target.value }))
              }
              aria-label="Tolerance type"
            >
              <option value="exact">Exact (zero tolerance)</option>
              <option value="percent">Within X% of target</option>
              <option value="dollar">Round to nearest $X</option>
            </select>

            {constraints.toleranceType !== 'exact' && (
              <div className="flex items-center gap-1">
                {constraints.toleranceType === 'dollar' && (
                  <span className="text-gray-400">$</span>
                )}
                <input
                  type="number"
                  min="0"
                  step={constraints.toleranceType === 'percent' ? '0.1' : '1'}
                  className="w-24 border rounded px-2 py-1 text-right text-sm"
                  value={constraints.toleranceValue}
                  onChange={e =>
                    setConstraints(prev => ({
                      ...prev,
                      toleranceValue: parseFloat(e.target.value) || 0,
                    }))
                  }
                  aria-label="Tolerance value"
                />
                {constraints.toleranceType === 'percent' && (
                  <span className="text-gray-400">%</span>
                )}
              </div>
            )}
          </div>
        </div>

        {surplusCount > 0 && (
          <div className="text-sm text-gray-500">
            Accounts with surplus: <span className="font-semibold">{surplusCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Transfer Plan Output ──────────────────────────
function TransferPlan({ plan }) {
  if (!plan) return null;

  const copyToClipboard = () => {
    const lines = [];
    lines.push('TRANSFER PLAN');
    lines.push('='.repeat(50));
    lines.push('');

    plan.transfers.forEach((t, i) => {
      lines.push(`Transfer ${i + 1} of ${plan.transfers.length}`);
      lines.push(`FROM: ${t.from}${t.fromStatus === 'close' ? ' (closing account)' : ''}`);
      t.distributions.forEach(d => {
        lines.push(`  - Send ${formatMoney(d.amountCents)} to ${d.to}`);
      });
      const totalOut = t.distributions.reduce((s, d) => s + d.amountCents, 0);
      lines.push(`Total moved: ${formatMoney(totalOut)}`);
      lines.push('');
    });

    lines.push('RESULTS SUMMARY');
    lines.push('-'.repeat(80));
    lines.push(
      'Account'.padEnd(20) +
        'Starting'.padStart(14) +
        'Target'.padStart(14) +
        'Ending'.padStart(14) +
        'End %'.padStart(8) +
        'Dev'.padStart(8)
    );
    lines.push('-'.repeat(80));

    plan.results.forEach(r => {
      lines.push(
        r.name.padEnd(20) +
          formatMoney(r.startCents).padStart(14) +
          formatMoney(r.targetCents).padStart(14) +
          formatMoney(r.endCents).padStart(14) +
          (r.endPercent.toFixed(1) + '%').padStart(8) +
          ((r.deviationPercent >= 0 ? '+' : '') + r.deviationPercent.toFixed(1) + '%').padStart(8)
      );
    });

    navigator.clipboard.writeText(lines.join('\n'));
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Step 4: Transfer Plan</h2>

      {!plan.feasible && (
        <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
          <p className="text-red-700 font-medium">{plan.message}</p>
          {plan.suggestion && <p className="text-red-600 text-sm mt-1">{plan.suggestion}</p>}
        </div>
      )}

      {plan.message && plan.feasible && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-4">
          <p className="text-amber-700 text-sm">{plan.message}</p>
        </div>
      )}

      {plan.transfers.length === 0 && plan.feasible && (
        <div className="bg-green-50 border border-green-200 rounded p-4 mb-4">
          <p className="text-green-700">No transfers needed. All accounts are at or within tolerance of their targets.</p>
        </div>
      )}

      <div className="space-y-4 mb-6">
        {plan.transfers.map((t, i) => {
          const totalOut = t.distributions.reduce((s, d) => s + d.amountCents, 0);
          const fromResult = plan.results.find(r => r.name === t.from);
          const remainingCents = fromResult ? fromResult.endCents : 0;
          return (
            <div key={i} className="border rounded-lg p-4 bg-gray-50">
              <div className="font-semibold text-blue-800 mb-2">
                Transfer {i + 1} of {plan.transfers.length}
              </div>
              <div className="font-medium mb-2">
                FROM: {t.from}
                {t.fromStatus === 'close' && (
                  <span className="text-red-600 text-sm ml-2">(closing account)</span>
                )}
              </div>
              <ul className="ml-4 space-y-1">
                {t.distributions.map((d, j) => (
                  <li key={j} className="text-sm">
                    Send <span className="font-mono font-medium">{formatMoney(d.amountCents)}</span>{' '}
                    to <span className="font-medium">{d.to}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs text-gray-500">
                Total moved: {formatMoney(totalOut)} | Remaining in {t.from}:{' '}
                {formatMoney(remainingCents)}
              </div>
            </div>
          );
        })}
      </div>

      {plan.results.length > 0 && (
        <>
          <h3 className="font-semibold mb-2">Results Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-2">Account</th>
                  <th className="pb-2 pr-2 text-right">Starting</th>
                  <th className="pb-2 pr-2 text-right">Target</th>
                  <th className="pb-2 pr-2 text-right">Ending</th>
                  <th className="pb-2 pr-2 text-right">End %</th>
                  <th className="pb-2 pr-2 text-right">Deviation</th>
                </tr>
              </thead>
              <tbody>
                {plan.results.map(r => (
                  <tr
                    key={r.name}
                    className={`border-b last:border-b-0 ${
                      r.status === 'close' ? 'text-gray-400' : ''
                    }`}
                  >
                    <td className="py-1 pr-2 font-medium">
                      {r.name}
                      {r.status === 'close' && (
                        <span className="text-xs ml-1">(closed)</span>
                      )}
                      {r.status === 'new' && (
                        <span className="text-xs text-green-600 ml-1">(new)</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {formatMoney(r.startCents)}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {formatMoney(r.targetCents)}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">
                      {formatMoney(r.endCents)}
                    </td>
                    <td className="py-1 pr-2 text-right">{r.endPercent.toFixed(1)}%</td>
                    <td
                      className={`py-1 pr-2 text-right ${
                        Math.abs(r.deviationPercent) > 0.05
                          ? r.deviationPercent > 0
                            ? 'text-green-600'
                            : 'text-red-600'
                          : 'text-gray-500'
                      }`}
                    >
                      {r.deviationPercent >= 0 ? '+' : ''}
                      {r.deviationPercent.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="pt-2">Total</td>
                  <td className="pt-2 text-right font-mono">
                    {formatMoney(plan.results.reduce((s, r) => s + r.startCents, 0))}
                  </td>
                  <td className="pt-2 text-right font-mono">
                    {formatMoney(plan.results.reduce((s, r) => s + r.targetCents, 0))}
                  </td>
                  <td className="pt-2 text-right font-mono">
                    {formatMoney(plan.results.reduce((s, r) => s + r.endCents, 0))}
                  </td>
                  <td className="pt-2 text-right">100.0%</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <div className="flex gap-3 mt-6 no-print">
        <button
          onClick={copyToClipboard}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
        >
          Copy to Clipboard
        </button>
        <button
          onClick={() => window.print()}
          className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 text-sm"
        >
          Print
        </button>
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────
export default function App() {
  const [accounts, setAccounts] = useState([
    makeAccount('Fund A', '15234.67', 'keep'),
    makeAccount('Fund B', '12891.03', 'keep'),
  ]);

  const [targets, setTargets] = useState([]);

  const [constraints, setConstraints] = useState({
    maxTransfers: null,
    toleranceType: 'exact',
    toleranceValue: 0,
  });

  // Derived data
  const accountsForEngine = useMemo(
    () =>
      accounts.map(a => ({
        name: a.name,
        balanceCents: a.status === 'new' ? 0 : toCents(parseDollarInput(a.balance)),
        status: a.status,
      })),
    [accounts]
  );

  const validation = useMemo(
    () => validateTargets(accountsForEngine, targets),
    [accountsForEngine, targets]
  );

  const surplusCount = useMemo(() => {
    if (!validation.valid || !validation.targetMap) return 0;
    return accountsForEngine.filter(a => {
      if (a.status === 'close') return true;
      const target = validation.targetMap.get(a.name) || 0;
      return a.balanceCents > target;
    }).length;
  }, [accountsForEngine, validation]);

  const plan = useMemo(() => {
    if (!validation.valid || !validation.targetMap) return null;
    if (accounts.some(a => !a.name.trim())) return null;
    const names = accounts.map(a => a.name.trim());
    if (new Set(names).size !== names.length) return null;

    return computeTransferPlan(accountsForEngine, validation.targetMap, {
      maxTransfers: constraints.maxTransfers,
      toleranceType: constraints.toleranceType,
      toleranceValue: constraints.toleranceValue,
    });
  }, [accountsForEngine, validation, constraints, accounts]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <header className="mb-8 no-print">
        <h1 className="text-3xl font-bold text-gray-900">Transfer Planner</h1>
        <p className="text-gray-500 mt-1">
          Minimize transfer events when restructuring fund accounts.
        </p>
      </header>

      <div className="space-y-6 no-print">
        <CurrentState accounts={accounts} setAccounts={setAccounts} />
        <TargetState accounts={accounts} targets={targets} setTargets={setTargets} />
        <Constraints
          constraints={constraints}
          setConstraints={setConstraints}
          surplusCount={surplusCount}
        />
      </div>

      <div className="mt-6">
        <TransferPlan plan={plan} />
      </div>

      <footer className="mt-8 text-center text-xs text-gray-400 no-print">
        All computation runs in your browser. No data is transmitted anywhere.
      </footer>
    </div>
  );
}
