import { z } from 'zod';
import type { PluginConsoleContext, PluginConsoleOperationDeclaration } from '@wabs/plugin-sdk/console-operations';
import type { ManagedGroupPlugin } from '@wabs/plugin-sdk/managed-group-plugin';
import { ONBOARDING_PLUGIN_ID as id } from './constants';
import { database } from './onboarding';
import { allowedUpdate, wakeUpdates } from './updateDelivery';
import { editEdition, editionRequest } from './updateEditions';

const stateAction = id + '.editionState';
const editAction = id + '.editEdition';
const operations = [
  { actionId: stateAction, access: 'read', description: 'Preview the current edition and eligible subscriber count' },
  { actionId: editAction, access: 'mutation', description: 'Save, dismiss or publish the reviewed edition' }
] as const;
export const editionActions = operations.map(operation => ({ ...operation, scope: 'scope' as const, timeoutMs: 60_000 }));
export const editionConsoleOperations: PluginConsoleOperationDeclaration[] = operations.map(({ actionId, access, description }) =>
  ({ operationId: actionId, access, authorization: 'operator', description }));
export const deliveryService = { serviceId: id + '.delivery.v1', methods: [{ name: 'allowDelivery', access: 'read' as const, timeoutMs: 60_000 }] };
const guard = z.object({ identityId: z.string().min(1), edition: z.number().int().positive(), attempt: z.number().int().positive(), recipient: z.string().min(1) }).strict();

export const editionExternalActions: NonNullable<ManagedGroupPlugin['registerExternalActions']> = context =>
  operations.map(({ actionId }) => ({
    actionId, inputSchema: editionRequest, outputSchema: z.record(z.unknown()), resolveScopeId: raw => editionRequest.parse(raw).scopeId,
    async handler(raw, call) {
      call.signal.throwIfAborted();
      const request = editionRequest.parse(raw);
      if ((request.operation === 'inspect') !== (actionId === stateAction)) throw new Error('Invalid edition operation.');
      const db = database(context);
      if (!db) throw new Error('Edition storage unavailable.');
      const editionScope = (await context.memberScopeFor?.(request.scopeId))?.id ?? request.scopeId;
      if (editionScope !== request.scopeId) throw new Error('Open the community scope to manage its shared editions.');
      const result = await editEdition(context, db, request);
      if (request.operation === 'publish' || request.operation === 'inspect') await wakeUpdates(context, request.scopeId);
      return result;
    }
  }));

export function editionConsole(context: PluginConsoleContext) {
  return operations.map(({ actionId }) => ({ operationId: actionId, async handler(raw: unknown) {
    const request = editionRequest.parse(raw);
    await context.assertScope(request.scopeId);
    const result = await context.executeRuntimeAction(actionId, request);
    if (request.operation !== 'inspect') await context.audit(id + '.edition.' + request.operation, { revision: request.revision }, { scopeId: request.scopeId });
    return result;
  } }));
}

export const editionServices: NonNullable<ManagedGroupPlugin['registerServices']> = context => [{
  ...deliveryService, methods: [{ ...deliveryService.methods[0]!, inputSchema: guard, outputSchema: z.object({ allowed: z.boolean() }),
    async handler(raw, call) {
      if (call.callerPluginId !== id) return { allowed: false };
      return { allowed: await allowedUpdate(context, call.scopeId, guard.parse(raw)) };
    } }]
}];
