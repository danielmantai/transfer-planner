import { describe, it, expect } from 'vitest';
import {
  toCents,
  formatMoney,
  distributeCents,
  computeTargetsCents,
  computeTransferPlan,
  validateTargets,
} from './engine';

// Helper: build account objects
function acct(name, dollars, status = 'keep') {
  return { name, balanceCents: toCents(dollars), status };
}

function pctTarget(name, pct) {
  return { name, targetType: 'percentage', targetValue: pct };
}

function dolTarget(name, dollars) {
  return { name, targetType: 'dollar', targetValue: dollars };
}

// Helper: verify money conservation
function assertMoneyConserved(accounts, plan) {
  const totalStart = accounts.reduce((s, a) => s + a.balanceCents, 0);
  const totalEnd = plan.results.reduce((s, r) => s + r.endCents, 0);
  expect(totalEnd).toBe(totalStart);
}

// Helper: verify closing accounts end at 0
function assertClosedAccountsZero(plan) {
  for (const r of plan.results) {
    if (r.status === 'close') {
      expect(r.endCents).toBe(0);
    }
  }
}

describe('Utility functions', () => {
  it('toCents converts correctly', () => {
    expect(toCents(15234.67)).toBe(1523467);
    expect(toCents('15234.67')).toBe(1523467);
    expect(toCents(0)).toBe(0);
    expect(toCents(0.01)).toBe(1);
    expect(toCents(0.1)).toBe(10);
  });

  it('formatMoney formats correctly', () => {
    expect(formatMoney(1523467)).toBe('$15,234.67');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(100)).toBe('$1.00');
    expect(formatMoney(-500)).toBe('-$5.00');
  });

  it('distributeCents distributes evenly with remainder', () => {
    const result = distributeCents(1000, 3);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(result).toEqual([334, 333, 333]);
  });
});

describe('Test 1: Simple Rebalance (Drift Correction)', () => {
  it('should use exactly 2 transfers for 2 surplus accounts', () => {
    const total = 100000_00; // $100,000
    const accounts = [
      acct('A', 25000), // 25% - over
      acct('B', 22000), // 22% - over
      acct('C', 18000), // 18% - under
      acct('D', 20000), // 20% - at target
      acct('E', 15000), // 15% - under
    ];
    const targets = [
      pctTarget('A', 20),
      pctTarget('B', 20),
      pctTarget('C', 20),
      pctTarget('D', 20),
      pctTarget('E', 20),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    expect(plan.transfers.length).toBe(2);
    assertMoneyConserved(accounts, plan);

    // D should be untouched
    const dResult = plan.results.find(r => r.name === 'D');
    expect(dResult.endCents).toBe(dResult.startCents);
  });
});

describe('Test 2: Close and Redistribute', () => {
  it('should close 2 accounts and distribute to 4 equally', () => {
    const accounts = [
      acct('A', 10000, 'keep'),
      acct('B', 15000, 'keep'),
      acct('C', 12000, 'keep'),
      acct('D', 8000, 'keep'),
      acct('E', 20000, 'close'),
      acct('F', 25000, 'close'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('A', 25),
      pctTarget('B', 25),
      pctTarget('C', 25),
      pctTarget('D', 25),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    // At least 2 transfers (from closing accounts), possibly more if keep accounts need adjusting
    expect(plan.transfers.length).toBeGreaterThanOrEqual(2);
    assertMoneyConserved(accounts, plan);
    assertClosedAccountsZero(plan);
  });
});

describe('Test 3: Fund Swap (Close Some, Open New)', () => {
  it('should handle closing, keeping, and opening accounts', () => {
    const accounts = [
      acct('A', 15000, 'keep'),
      acct('B', 15000, 'keep'),
      acct('C', 20000, 'close'),
      acct('D', 20000, 'close'),
      acct('E', 0, 'new'),
      acct('F', 0, 'new'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('A', 25),
      pctTarget('B', 25),
      pctTarget('E', 25),
      pctTarget('F', 25),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    assertMoneyConserved(accounts, plan);
    assertClosedAccountsZero(plan);
    expect(plan.feasible).toBe(true);
  });
});

describe('Test 4: Complete Restructure', () => {
  it('should create 5 transfers for 5 closing accounts', () => {
    const accounts = [
      acct('A', 10000, 'close'),
      acct('B', 15000, 'close'),
      acct('C', 20000, 'close'),
      acct('D', 25000, 'close'),
      acct('E', 30000, 'close'),
      acct('N1', 0, 'new'),
      acct('N2', 0, 'new'),
      acct('N3', 0, 'new'),
      acct('N4', 0, 'new'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('N1', 25),
      pctTarget('N2', 25),
      pctTarget('N3', 25),
      pctTarget('N4', 25),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    expect(plan.transfers.length).toBe(5);
    assertMoneyConserved(accounts, plan);
    assertClosedAccountsZero(plan);
  });
});

describe('Test 5: Dollar Amount Targets', () => {
  it('should handle exact dollar targets summing to pool', () => {
    const accounts = [
      acct('A', 30000, 'keep'),
      acct('B', 20000, 'keep'),
      acct('C', 15000, 'keep'),
      acct('D', 15000, 'keep'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      dolTarget('A', 25000),
      dolTarget('B', 25000),
      dolTarget('C', 20000),
      dolTarget('D', 10000),
    ];

    const validation = validateTargets(accounts, targets);
    expect(validation.valid).toBe(true);

    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    assertMoneyConserved(accounts, plan);

    // Verify ending balances match targets
    expect(plan.results.find(r => r.name === 'A').endCents).toBe(toCents(25000));
    expect(plan.results.find(r => r.name === 'B').endCents).toBe(toCents(25000));
    expect(plan.results.find(r => r.name === 'C').endCents).toBe(toCents(20000));
    expect(plan.results.find(r => r.name === 'D').endCents).toBe(toCents(10000));
  });
});

describe('Test 6: Mixed Targets (Some %, Some $)', () => {
  it('should handle mixed percentage and dollar targets', () => {
    const accounts = [
      acct('A', 40000, 'keep'),
      acct('B', 20000, 'keep'),
      acct('C', 25000, 'keep'),
      acct('D', 15000, 'keep'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    // Fund A gets $30,000 flat. Rest split evenly by percentage.
    const targets = [
      dolTarget('A', 30000),
      pctTarget('B', 33.34),
      pctTarget('C', 33.33),
      pctTarget('D', 33.33),
    ];

    const validation = validateTargets(accounts, targets);
    expect(validation.valid).toBe(true);

    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    assertMoneyConserved(accounts, plan);
    // Fund A should end at $30,000
    expect(plan.results.find(r => r.name === 'A').endCents).toBe(toCents(30000));
  });
});

describe('Test 7: Account Already at Target', () => {
  it('should leave an account already at target untouched', () => {
    const accounts = [
      acct('A', 30000, 'keep'),
      acct('B', 25000, 'keep'), // already at target
      acct('C', 25000, 'keep'),
      acct('D', 20000, 'keep'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('A', 20),
      pctTarget('B', 25),
      pctTarget('C', 30),
      pctTarget('D', 25),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    assertMoneyConserved(accounts, plan);

    // B should not be touched (it's at target)
    const bResult = plan.results.find(r => r.name === 'B');
    expect(bResult.endCents).toBe(bResult.startCents);

    // B should not appear as a source in any transfer
    for (const t of plan.transfers) {
      expect(t.from).not.toBe('B');
    }
  });
});

describe('Test 8: Impossible Constraint', () => {
  it('should detect impossible max transfers constraint', () => {
    const accounts = [
      acct('A', 10000, 'close'),
      acct('B', 15000, 'close'),
      acct('C', 20000, 'close'),
      acct('D', 0, 'new'),
      acct('E', 0, 'new'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('D', 50),
      pctTarget('E', 50),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap, { maxTransfers: 1 });

    expect(plan.feasible).toBe(false);
    expect(plan.message).toContain('3');
    expect(plan.message).toContain('1');
    expect(plan.minTransfersNeeded).toBe(3);
  });
});

describe('Test 9: Tiny Amounts and Rounding', () => {
  it('should handle fractional cents without losing money', () => {
    // $50,123.47 total, 5 accounts at 20% each = $10,024.694 per account
    const accounts = [
      acct('A', 15000, 'keep'),
      acct('B', 12000, 'keep'),
      acct('C', 10123.47, 'keep'),
      acct('D', 8000, 'keep'),
      acct('E', 5000, 'keep'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    expect(total).toBe(5012347); // $50,123.47

    const targets = [
      pctTarget('A', 20),
      pctTarget('B', 20),
      pctTarget('C', 20),
      pctTarget('D', 20),
      pctTarget('E', 20),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);

    // Verify target map sums to total
    let targetSum = 0;
    for (const [, v] of targetMap) targetSum += v;
    expect(targetSum).toBe(total);

    const plan = computeTransferPlan(accounts, targetMap);
    assertMoneyConserved(accounts, plan);
  });
});

describe('Test 10: One Large Source, Many Small Destinations', () => {
  it('should produce 1 transfer from large source to 5 destinations', () => {
    const accounts = [
      acct('X', 50000, 'close'),
      acct('A', 0, 'new'),
      acct('B', 0, 'new'),
      acct('C', 0, 'new'),
      acct('D', 0, 'new'),
      acct('E', 0, 'new'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('A', 20),
      pctTarget('B', 20),
      pctTarget('C', 20),
      pctTarget('D', 20),
      pctTarget('E', 20),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    expect(plan.transfers.length).toBe(1);
    expect(plan.transfers[0].from).toBe('X');
    expect(plan.transfers[0].distributions.length).toBe(5);
    assertMoneyConserved(accounts, plan);
    assertClosedAccountsZero(plan);

    // Each destination gets $10,000
    for (const d of plan.transfers[0].distributions) {
      expect(d.amountCents).toBe(toCents(10000));
    }
  });
});

describe('Test 11: Tight Tolerance Requires More Transfers', () => {
  it('exact tolerance may require more transfers than relaxed', () => {
    const accounts = [
      acct('A', 25000, 'keep'),
      acct('B', 22000, 'keep'),
      acct('C', 18000, 'keep'),
      acct('D', 20000, 'keep'),
      acct('E', 15000, 'keep'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('A', 20),
      pctTarget('B', 20),
      pctTarget('C', 20),
      pctTarget('D', 20),
      pctTarget('E', 20),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);

    const exactPlan = computeTransferPlan(accounts, targetMap, {
      toleranceType: 'exact',
      toleranceValue: 0,
    });

    const relaxedPlan = computeTransferPlan(accounts, targetMap, {
      toleranceType: 'percent',
      toleranceValue: 3,
    });

    // Relaxed should require <= exact transfers
    expect(relaxedPlan.transfers.length).toBeLessThanOrEqual(exactPlan.transfers.length);
    assertMoneyConserved(accounts, exactPlan);
    assertMoneyConserved(accounts, relaxedPlan);
  });
});

describe('Test 12: Generous Tolerance Reduces Transfers', () => {
  it('2% tolerance should reduce transfer count', () => {
    const accounts = [
      acct('A', 17500, 'keep'),
      acct('B', 16000, 'keep'),
      acct('C', 16500, 'keep'),
      acct('D', 17000, 'keep'),
      acct('E', 16500, 'keep'),
      acct('F', 16500, 'keep'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('A', 16.67),
      pctTarget('B', 16.67),
      pctTarget('C', 16.67),
      pctTarget('D', 16.67),
      pctTarget('E', 16.67),
      pctTarget('F', 16.65),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);

    const exactPlan = computeTransferPlan(accounts, targetMap, {
      toleranceType: 'exact',
    });
    const tolerantPlan = computeTransferPlan(accounts, targetMap, {
      toleranceType: 'percent',
      toleranceValue: 2,
    });

    expect(tolerantPlan.transfers.length).toBeLessThanOrEqual(exactPlan.transfers.length);
    assertMoneyConserved(accounts, tolerantPlan);
  });
});

describe('Test 13: Single Account Close, No Other Changes', () => {
  it('should produce 1 transfer to distribute closed account', () => {
    const accounts = [
      acct('A', 20000, 'keep'),
      acct('B', 20000, 'keep'),
      acct('C', 20000, 'keep'),
      acct('D', 20000, 'keep'),
      acct('E', 20000, 'close'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('A', 25),
      pctTarget('B', 25),
      pctTarget('C', 25),
      pctTarget('D', 25),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    // Only 1 transfer needed (from E)
    expect(plan.transfers.length).toBe(1);
    expect(plan.transfers[0].from).toBe('E');
    assertMoneyConserved(accounts, plan);
    assertClosedAccountsZero(plan);
  });
});

describe('Test 14: Zero-Balance New Account', () => {
  it('should warn about 0% target accounts', () => {
    const accounts = [
      acct('A', 50000, 'keep'),
      acct('B', 50000, 'keep'),
      acct('C', 0, 'new'),
    ];
    const targets = [
      pctTarget('A', 50),
      pctTarget('B', 50),
      pctTarget('C', 0),
    ];

    const validation = validateTargets(accounts, targets);
    expect(validation.warnings.length).toBeGreaterThan(0);
    expect(validation.warnings[0]).toContain('0%');
  });
});

describe('Money conservation invariant', () => {
  it('ending balances always equal starting balances', () => {
    // Random scenario
    const accounts = [
      acct('A', 12345.67, 'keep'),
      acct('B', 23456.78, 'close'),
      acct('C', 34567.89, 'keep'),
      acct('D', 0, 'new'),
    ];
    const total = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const targets = [
      pctTarget('A', 30),
      pctTarget('C', 40),
      pctTarget('D', 30),
    ];
    const targetMap = computeTargetsCents(accounts, targets, total);
    const plan = computeTransferPlan(accounts, targetMap);

    assertMoneyConserved(accounts, plan);
    assertClosedAccountsZero(plan);
  });
});
