import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackOperation, runTrackedPipeline, patchOperationInteractionId, setLatencyRepoAccessor } from '../latency-tracker.js';
import { OperationName, OperationType, OperationMetadata } from '../operation-constants.js';

// ── Setup ────────────────────────────────────────────────────────────

let mockCreate: ReturnType<typeof vi.fn>;
let mockFinalize: ReturnType<typeof vi.fn>;
let mockPatchInteractionId: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCreate = vi.fn(async (data: any) => ({ id: data.id ?? 'ol-test', ...data }));
  mockFinalize = vi.fn(async () => {});
  mockPatchInteractionId = vi.fn(async () => {});
  setLatencyRepoAccessor(() => ({ create: mockCreate, finalize: mockFinalize, patchInteractionId: mockPatchInteractionId }) as any);
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

  it('persists a completed record with correct fields', async () => {
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

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0];
    expect(data.operationName).toBe(OperationName.LLM_INTERPRETATION);
    expect(data.operationType).toBe(OperationType.LLM);
    expect(data.providerName).toBe('xai');
    expect(data.model).toBe('grok-3-mini');
    expect(data.status).toBe('completed');
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
    expect(data.correlationId).toBe('corr-1');
    expect(data.guildId).toBe('g1');
    expect(data.memberId).toBe('m1');
    expect(data.metadata).toEqual({ task: OperationMetadata.Task.INTERPRETATION });
    expect(data.startedAt).toBeInstanceOf(Date);
  });

  it('persists a failed record when the operation throws', async () => {
    const err = new Error('provider timeout');

    await expect(
      trackOperation(
        { operationName: OperationName.LLM_RESPONSE, operationType: OperationType.LLM, providerName: 'xai' },
        async () => { throw err; },
      ),
    ).rejects.toThrow('provider timeout');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0];
    expect(data.status).toBe('failed');
    expect(data.operationName).toBe(OperationName.LLM_RESPONSE);
  });

  it('still returns the result when persistence fails (best-effort)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB down'));

    const { result } = await trackOperation(
      { operationName: 'test_op', operationType: 'test' },
      async () => 'success',
    );

    expect(result).toBe('success');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('still throws the original error when persistence also fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      trackOperation(
        { operationName: 'test_op', operationType: 'test' },
        async () => { throw new Error('original'); },
      ),
    ).rejects.toThrow('original');
  });

  it('works when no repo accessor is configured', async () => {
    setLatencyRepoAccessor(() => undefined);

    const { result, durationMs } = await trackOperation(
      { operationName: 'test_op', operationType: 'test' },
      async () => 'no-repo',
    );

    expect(result).toBe('no-repo');
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it('leaves provider/model null for non-model operations', async () => {
    await trackOperation(
      { operationName: OperationName.GUILD_BOOTSTRAP, operationType: OperationType.PIPELINE },
      async () => {},
    );

    const data = mockCreate.mock.calls[0][0];
    expect(data.providerName).toBeNull();
    expect(data.model).toBeNull();
  });

  it('returns the operationId from the persisted record', async () => {
    const { operationId } = await trackOperation(
      { operationName: 'test_op', operationType: 'test' },
      async () => 'ok',
    );

    expect(operationId).toBe('ol-test');
  });

  it('persists interactionId and parentOperationId from context', async () => {
    await trackOperation(
      {
        operationName: OperationName.LLM_RESPONSE,
        operationType: OperationType.LLM,
        context: {
          correlationId: 'corr-1',
          guildId: 'g1',
          memberId: 'm1',
          interactionId: 'int-abc',
          parentOperationId: 'parent-xyz',
        },
      },
      async () => 'ok',
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0];
    expect(data.interactionId).toBe('int-abc');
    expect(data.parentOperationId).toBe('parent-xyz');
  });

  it('uses two-phase persistence when operationId is provided', async () => {
    const preAssignedId = 'pre-assigned-uuid';
    const { operationId } = await trackOperation(
      { operationName: 'parent_op', operationType: 'pipeline', operationId: preAssignedId },
      async () => 'ok',
    );

    // Phase 1: running placeholder inserted before fn()
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createData = mockCreate.mock.calls[0][0];
    expect(createData.id).toBe(preAssignedId);
    expect(createData.status).toBe('running');
    expect(createData.durationMs).toBeNull();

    // Phase 2: finalized after fn()
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    expect(mockFinalize.mock.calls[0][0]).toBe(preAssignedId);
    expect(mockFinalize.mock.calls[0][1]).toBe('completed');
    expect(mockFinalize.mock.calls[0][2]).toBeGreaterThanOrEqual(0);

    expect(operationId).toBe(preAssignedId);
  });

  it('two-phase parent row exists before child inserts', async () => {
    const parentId = 'parent-pre-gen';
    const insertOrder: string[] = [];

    mockCreate.mockImplementation(async (data: any) => {
      insertOrder.push(`create:${data.operationName}:${data.status}`);
      return { id: data.id ?? 'ol-test', ...data };
    });
    mockFinalize.mockImplementation(async () => {
      insertOrder.push('finalize:parent_op');
    });

    await trackOperation(
      { operationName: 'parent_op', operationType: 'pipeline', operationId: parentId },
      async () => {
        await trackOperation(
          {
            operationName: 'child_op',
            operationType: 'llm',
            context: { parentOperationId: parentId },
          },
          async () => 'child-result',
        );
        return 'parent-result';
      },
    );

    // Parent running row inserted first, then child, then parent finalized
    expect(insertOrder).toEqual([
      'create:parent_op:running',
      'create:child_op:completed',
      'finalize:parent_op',
    ]);

    // Child references the parent ID
    const childData = mockCreate.mock.calls[1][0];
    expect(childData.parentOperationId).toBe(parentId);
  });

  it('persists providerDurationMs extracted via enrich callback', async () => {
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

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0];
    expect(data.providerDurationMs).toBe(42);
  });

  it('persists null providerDurationMs when provider does not report timing', async () => {
    await trackOperation(
      { operationName: OperationName.LLM_RESPONSE, operationType: OperationType.LLM, providerName: 'xai' },
      async () => ({ content: 'hello', model: 'grok-3-mini', providerDurationMs: undefined as number | undefined }),
      (resp) => ({ providerDurationMs: resp.providerDurationMs ?? null }),
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = mockCreate.mock.calls[0][0];
    expect(data.providerDurationMs).toBeNull();
  });

  it('finalizes with failed status when two-phase operation throws', async () => {
    const opId = 'fail-two-phase';

    await expect(
      trackOperation(
        { operationName: 'parent_op', operationType: 'pipeline', operationId: opId },
        async () => { throw new Error('boom'); },
      ),
    ).rejects.toThrow('boom');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].status).toBe('running');

    expect(mockFinalize).toHaveBeenCalledTimes(1);
    expect(mockFinalize.mock.calls[0][0]).toBe(opId);
    expect(mockFinalize.mock.calls[0][1]).toBe('failed');
  });
});

describe('patchOperationInteractionId', () => {
  it('delegates to repo.patchInteractionId with correct args', async () => {
    await patchOperationInteractionId('op-123', 'int-456');

    expect(mockPatchInteractionId).toHaveBeenCalledTimes(1);
    expect(mockPatchInteractionId).toHaveBeenCalledWith('op-123', 'int-456');
  });

  it('is a no-op when no repo accessor is configured', async () => {
    setLatencyRepoAccessor(() => undefined);

    await expect(patchOperationInteractionId('op-1', 'int-2')).resolves.toBeUndefined();
  });

  it('swallows errors from the repo (best-effort)', async () => {
    mockPatchInteractionId.mockRejectedValueOnce(new Error('DB down'));

    await expect(patchOperationInteractionId('op-1', 'int-2')).resolves.toBeUndefined();
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

  it('passes operationType and context to every persisted record', async () => {
    const sharedContext = { correlationId: 'corr-pipe', guildId: 'g-pipe' };

    await runTrackedPipeline({ operationType: 'pipeline', context: sharedContext }, [
      ['step_a', async () => 'a'],
      ['step_b', async () => 'b'],
    ]);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    for (const call of mockCreate.mock.calls) {
      const data = call[0];
      expect(data.operationType).toBe('pipeline');
      expect(data.correlationId).toBe('corr-pipe');
      expect(data.guildId).toBe('g-pipe');
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
