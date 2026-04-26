import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackOperation, runTrackedPipeline } from '../latency-tracker.js';
import { OperationName, OperationType, OperationMetadata } from '../operation-constants.js';

// ── Setup ────────────────────────────────────────────────────────────

vi.mock('../logger.js', () => {
  const mockDebug = vi.fn();
  return {
    createLogger: vi.fn(() => ({ debug: mockDebug })),
    __mockDebug: mockDebug,
  };
});

let mockDebug: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  mockDebug = (await import('../logger.js') as any).__mockDebug;
  mockDebug.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('trackOperation', () => {
  it('returns the wrapped result and a positive durationMs', async () => {
    const { result, durationMs } = await trackOperation(
      { operationName: 'test_op', operationType: 'test' },
      async () => 42,
    );

    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits a completed log entry with correct fields', async () => {
    await trackOperation(
      {
        operationName: OperationName.LLM_INTERPRETATION,
        operationType: OperationType.LLM,
        providerName: 'xai',
        model: 'grok-3-mini',
        context: {
          correlationId: 'corr-1',
          guildId: 'g1',
          memberId: 'm1',
        },
        metadata: { task: OperationMetadata.Task.INTERPRETATION },
      },
      async () => 'ok',
    );

    expect(mockDebug).toHaveBeenCalledTimes(1);
    const [logObj, msg] = mockDebug.mock.calls[0];
    expect(msg).toBe(`${OperationName.LLM_INTERPRETATION} completed`);
    expect(logObj.status).toBe('completed');
    expect(logObj.durationMs).toBeGreaterThanOrEqual(0);
    expect(logObj.correlationId).toBe('corr-1');
    expect(logObj.guildId).toBe('g1');
    expect(logObj.memberId).toBe('m1');
    expect(logObj.metadata.operationName).toBe(OperationName.LLM_INTERPRETATION);
    expect(logObj.metadata.operationType).toBe(OperationType.LLM);
    expect(logObj.metadata.providerName).toBe('xai');
    expect(logObj.metadata.model).toBe('grok-3-mini');
    expect(logObj.metadata.task).toBe(OperationMetadata.Task.INTERPRETATION);
  });

  it('emits a failed log entry when the operation throws', async () => {
    await expect(
      trackOperation(
        { operationName: OperationName.LLM_RESPONSE, operationType: OperationType.LLM, providerName: 'xai' },
        async () => { throw new Error('provider timeout'); },
      ),
    ).rejects.toThrow('provider timeout');

    expect(mockDebug).toHaveBeenCalledTimes(1);
    const [logObj, msg] = mockDebug.mock.calls[0];
    expect(msg).toBe(`${OperationName.LLM_RESPONSE} failed`);
    expect(logObj.status).toBe('failed');
  });

  it('does not have operationId on the returned result', async () => {
    const tracked = await trackOperation(
      { operationName: 'test_op', operationType: 'test' },
      async () => 'ok',
    );

    expect(tracked).toEqual({ result: 'ok', durationMs: expect.any(Number) });
    expect('operationId' in tracked).toBe(false);
  });

  it('includes enriched providerDurationMs in emitted log', async () => {
    await trackOperation(
      {
        operationName: OperationName.LLM_RESPONSE,
        operationType: OperationType.LLM,
        providerName: 'xai',
        model: 'grok-3-mini',
      },
      async () => ({ content: 'hello', model: 'grok-3-mini', providerDurationMs: 42 }),
      (resp) => ({ providerDurationMs: resp.providerDurationMs ?? null }),
    );

    expect(mockDebug).toHaveBeenCalledTimes(1);
    const [logObj] = mockDebug.mock.calls[0];
    expect(logObj.metadata.providerDurationMs).toBe(42);
  });

  it('emits interactionId from context', async () => {
    await trackOperation(
      {
        operationName: OperationName.LLM_RESPONSE,
        operationType: OperationType.LLM,
        context: {
          correlationId: 'corr-1',
          guildId: 'g1',
          memberId: 'm1',
          interactionId: 'int-abc',
        },
      },
      async () => 'ok',
    );

    expect(mockDebug).toHaveBeenCalledTimes(1);
    const [logObj] = mockDebug.mock.calls[0];
    expect(logObj.interactionId).toBe('int-abc');
  });

  it('omits undefined provider/model from metadata', async () => {
    await trackOperation(
      { operationName: OperationName.GUILD_BOOTSTRAP, operationType: OperationType.PIPELINE },
      async () => {},
    );

    const [logObj] = mockDebug.mock.calls[0];
    expect(logObj.metadata.providerName).toBeUndefined();
    expect(logObj.metadata.model).toBeUndefined();
  });
});

describe('runTrackedPipeline', () => {
  it('executes all steps in declaration order', async () => {
    const executionOrder: string[] = [];

    await runTrackedPipeline({ operationType: 'pipeline' }, [
      ['step_a', async () => { executionOrder.push('a'); }],
      ['step_b', async () => { executionOrder.push('b'); }],
      ['step_c', async () => { executionOrder.push('c'); }],
    ]);

    expect(executionOrder).toEqual(['a', 'b', 'c']);
  });

  it('returns collected results as an array', async () => {
    const results = await runTrackedPipeline({ operationType: 'pipeline' }, [
      ['step_a', async () => 'alpha'],
      ['step_b', async () => 42],
      ['step_c', async () => ({ key: 'value' })],
    ]);

    expect(results).toEqual(['alpha', 42, { key: 'value' }]);
  });

  it('emits a log entry per step with shared context', async () => {
    const sharedContext = { correlationId: 'corr-pipe', guildId: 'g-pipe' };

    await runTrackedPipeline({ operationType: 'pipeline', context: sharedContext }, [
      ['step_a', async () => 'a'],
      ['step_b', async () => 'b'],
    ]);

    expect(mockDebug).toHaveBeenCalledTimes(2);
    for (const call of mockDebug.mock.calls) {
      const [logObj] = call;
      expect(logObj.correlationId).toBe('corr-pipe');
      expect(logObj.guildId).toBe('g-pipe');
      expect(logObj.metadata.operationType).toBe('pipeline');
    }
  });

  it('re-throws on the first failing step and stops subsequent steps', async () => {
    const executionOrder: string[] = [];

    await expect(
      runTrackedPipeline({ operationType: 'pipeline' }, [
        ['step_a', async () => { executionOrder.push('a'); }],
        ['step_b', async () => { throw new Error('step_b failed'); }],
        ['step_c', async () => { executionOrder.push('c'); }],
      ]),
    ).rejects.toThrow('step_b failed');

    expect(executionOrder).toEqual(['a']);
  });
});
