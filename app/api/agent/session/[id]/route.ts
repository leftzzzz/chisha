import { configureCloudflareAgentSessionStore } from '@/lib/agent/cloudflareSessionStore';
import { deleteAgentSessionAsync, getAgentSessionAsync } from '@/lib/agent/session';

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function GET(_request: Request, context: RouteContext) {
  await configureCloudflareAgentSessionStore();

  const { id } = await context.params;
  const session = await getAgentSessionAsync(id);

  if (!session) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  return jsonResponse({
    id: session.id,
    version: session.version,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    pendingQuestion: session.pendingQuestion,
    goal: session.goal
      ? {
          rawQuery: session.goal.rawQuery,
          primaryKeywords: session.goal.primaryKeywords,
          requestedItems: session.goal.requestedItems,
          acceptableCategories: session.goal.acceptableCategories,
          allowBroaden: session.goal.allowBroaden,
        }
      : undefined,
    actionCount: session.actions.length,
    observationCount: session.observations.length,
    actions: session.actions.map((action) => ({
      id: action.id,
      type: action.action.type,
      summary: action.summary,
      createdAt: action.createdAt,
    })),
    observations: session.observations.map((observation) => ({
      actionId: observation.actionId,
      keywords: observation.plan.keywords,
      searchIntent: observation.plan.searchIntent,
      rawCount: observation.rawCount,
      acceptedPrimaryCount: observation.acceptedPrimaryIds.length,
      candidateCount: observation.candidateIds.length,
      hardRejectedCount: observation.hardRejected.length,
      unmetConstraints: observation.unmetConstraints.slice(0, 5),
    })),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  await configureCloudflareAgentSessionStore();

  const { id } = await context.params;
  await deleteAgentSessionAsync(id);
  return jsonResponse({ ok: true });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
